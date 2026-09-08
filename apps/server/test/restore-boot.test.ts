/**
 * The two ways a real deployment hands the server a database it did not create.
 *
 * `seeded-boot.test.ts` proves the server survives a sequence that has fallen
 * behind its rows — but it manufactures that state with `setval`, which is a
 * fair proxy and not a path anyone actually walks. A campaign only ever reaches
 * it two ways, and neither had a test:
 *
 *   (a) A RESTORE. The nightly backup is a file copy of `DATA_DIR` (infra/
 *       backup.sh), so recovery is a file copy back. Nothing here had ever
 *       copied a PGlite directory and booted the server on the copy — the whole
 *       backup story was a shell script and a hope.
 *   (b) A MOVE from the embedded database to a real server. The app ships both
 *       backends: PGlite under `DATA_DIR/pglite` for a laptop, node-postgres
 *       against `DATABASE_URL` for the compose stack (BUILD_CONVENTIONS). A
 *       campaign that outgrows the first has to cross to the second with its
 *       ids intact, because `ws_events.id` is the replay cursor clients hold as
 *       `last_event_id` (§11) and every foreign key in §9.2 is a real id. There
 *       was no script for that at all, and the obvious hand-rolled version —
 *       load the rows, keep the ids, forget the sequences — is LIVE-4 exactly.
 *
 * So this file drives both against the real seeded campaign:
 *
 *   1 · seed in a child process, let it exit, BYTE-COPY the whole DATA_DIR, and
 *       boot the server on the copy. The campaign has to be whole (including
 *       the file store, which lives on disk beside the database and is the half
 *       people forget), appends have to work, and ids have to keep going up so
 *       a client's `last_event_id` still means what it meant.
 *   2 · move that same directory through `scripts/migrate-to-postgres.ts` into
 *       a fresh database, and prove the sequence pass is load-bearing: the same
 *       move with that one step skipped rejects the table's very next event.
 *
 * The target in (2) is a second PGlite by default — which is real Postgres,
 * in-process, so the SQL and the whole copy path are genuinely exercised on any
 * machine. Point `SAFEHOUSE_TEST_DATABASE_URL` at a THROWAWAY Postgres and the
 * last block repeats the move over node-postgres instead; without it that block
 * skips, because this machine has no Docker registry access and a missing
 * server must not be a red build (BUILD_CONVENTIONS: never require Docker).
 * NOTE: that block resets the target's `public` and `drizzle` schemas.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createNodePgDb,
  eventsSince,
  getDb,
  resetDbSingleton,
  type Db,
} from '@safehouse/db';
import { buildApp } from '../src/app.js';
import {
  copyOrder,
  migrateDatabase,
  parseArgs,
  planMove,
  resyncSequences,
  verifyMove,
} from '../scripts/migrate-to-postgres.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');
const CAMPAIGN_NAME = 'Static on the Line';
const PG_URL = process.env['SAFEHOUSE_TEST_DATABASE_URL'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SeedResult {
  out: string;
  campaignId: string;
  gmToken: string;
}

/** Seed in a child process and wait for it to be GONE — PGlite is single-writer. */
function seedInChildProcess(dataDir: string): Promise<SeedResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir, LOG_LEVEL: 'warn' };
    // Offline by construction (NG7).
    delete env.DATABASE_URL;
    delete env.LLM_BASE_URL;
    delete env.DISCORD_WEBHOOK_URL;
    delete env.SAFEHOUSE_BOOKS_DIR;

    const child = spawn(process.execPath, [TSX_CLI, SEED_DEMO], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const grab = (chunk: unknown): void => {
      out += String(chunk);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`seed:demo exited ${String(code)}\n${out}`));
        return;
      }
      const campaignId = /^campaign\s+(\S+)/m.exec(out)?.[1];
      const gmToken = /^\s+gm\s+.*\s(\S+)\s*$/m.exec(out)?.[1];
      if (!campaignId || !gmToken) {
        reject(new Error(`seed:demo printed no campaign id / GM token\n${out}`));
        return;
      }
      resolve({ out, campaignId, gmToken });
    });
  });
}

/**
 * Run `migrate-to-postgres.ts` the way the compose header tells an operator to,
 * and return its stdout. The directory must not be open in this process while
 * this runs — PGlite is single-writer and a second opener hangs rather than
 * erroring.
 */
function runMigrateCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL('../scripts/migrate-to-postgres.ts', import.meta.url));
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    const child = spawn(process.execPath, [TSX_CLI, script, ...args], {
      cwd: join(REPO_ROOT, 'apps', 'server'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const grab = (chunk: unknown): void => {
      out += String(chunk);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`migrate-to-postgres exited ${String(code)}\n${out}`));
      else resolve(out);
    });
  });
}

/** Every file under `dir` as `relative/path:size` — what a byte copy must reproduce. */
function inventory(dir: string): string[] {
  const seen: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        seen.push(`${relative(dir, full).split(sep).join('/')}:${statSync(full).size}`);
      }
    }
  };
  walk(dir);
  return seen.sort();
}

async function rowsOf<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

async function maxEventId(db: Db): Promise<number> {
  const rows = await rowsOf<{ m: string | number | null }>(
    db,
    sql`select coalesce(max(id), 0)::bigint as m from ws_events`,
  );
  return rows[0]?.m == null ? 0 : Number(rows[0]!.m);
}

/** The id `ws_events` would issue next; `is_called` is the off-by-one. */
async function nextEventSequenceValue(db: Db): Promise<number> {
  const rows = await rowsOf<{ last_value: string | number; is_called: boolean }>(
    db,
    sql`select last_value, is_called from ws_events_id_seq`,
  );
  const row = rows[0];
  if (!row) throw new Error('ws_events_id_seq is missing');
  return Number(row.last_value) + (row.is_called ? 1 : 0);
}

/** Every message down an error's `cause` chain (drizzle buries the real one). */
function messageChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

/**
 * An append with a DEFAULT id — exactly what `appendEvent` issues, and the
 * statement that collides when a sequence sits behind its rows.
 */
async function rawAppend(db: Db, type: string): Promise<unknown> {
  try {
    await db.execute(sql`
      insert into ws_events (campaign_id, type, payload)
      select campaign_id, ${type}, '{}'::jsonb from ws_events order by id limit 1
    `);
    return null;
  } catch (err) {
    return err;
  }
}

interface LogEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

/** The handful of API calls this file makes, over `app.inject`. */
class TableApi {
  constructor(
    readonly app: FastifyInstance,
    readonly campaignId: string,
    readonly gmToken: string,
  ) {}

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.gmToken}` };
  }

  campaign() {
    return this.app.inject({
      method: 'GET',
      url: `/api/campaigns/${this.campaignId}`,
      headers: this.auth(),
    });
  }

  characters() {
    return this.app.inject({
      method: 'GET',
      url: `/api/campaigns/${this.campaignId}/characters`,
      headers: this.auth(),
    });
  }

  derived(characterId: string) {
    return this.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/derived`,
      headers: this.auth(),
    });
  }

  file(id: string) {
    return this.app.inject({ method: 'GET', url: `/files/${id}`, headers: this.auth() });
  }

  async log(limit = 500): Promise<LogEvent[]> {
    const res = await this.app.inject({
      method: 'GET',
      url: `/api/campaigns/${this.campaignId}/log?limit=${limit}`,
      headers: this.auth(),
    });
    expect(res.statusCode, `GET /log -> ${res.statusCode} ${res.body}`).toBe(200);
    return (res.json() as { events: LogEvent[] }).events;
  }

  postRoll(label: string, pool = 6) {
    return this.app.inject({
      method: 'POST',
      url: '/api/rolls',
      headers: this.auth(),
      payload: {
        kind: 'simple',
        pool,
        breakdown: [{ label, value: pool }],
        visibility: 'public',
        actor: { gm: true },
        meta: { label },
      },
    });
  }
}

/** Boot the server on `db` and roll — the shortest proof a table can play. */
async function bootAndRoll(db: Db, seeded: SeedResult, label: string): Promise<void> {
  const highWater = await maxEventId(db);
  const app = await buildApp({ db, webDist: false, logger: false });
  try {
    const api = new TableApi(app, seeded.campaignId, seeded.gmToken);

    // The GM's device token moved with the database, so the phone in their
    // pocket still authenticates — a move that logs the table out is a failure.
    const campaign = await api.campaign();
    expect(campaign.statusCode, `GET /api/campaigns/:id -> ${campaign.body}`).toBe(200);
    expect((campaign.json() as { name: string }).name).toBe(CAMPAIGN_NAME);

    // The richest JSONB in the schema, put through the rules engine: a sheet
    // that arrived double-encoded or flattened would count as one row and
    // still be ruined, so counts alone are not proof.
    const chars = await api.characters();
    expect(chars.statusCode, chars.body).toBe(200);
    const first = (chars.json() as { characters: { id: string }[] }).characters[0];
    expect(first, 'the moved campaign has no characters').toBeDefined();
    const derived = await api.derived(first!.id);
    expect(derived.statusCode, `GET /derived -> ${derived.body.slice(0, 200)}`).toBe(200);
    const view = derived.json() as { derived: { attributes: object; pools: object } };
    expect(Object.keys(view.derived.attributes).length).toBeGreaterThan(0);
    expect(Object.keys(view.derived.pools).length).toBeGreaterThan(0);

    const res = await api.postRoll(label);
    expect(res.statusCode, `POST /api/rolls -> ${res.statusCode} ${res.body}`).toBe(201);
    const { roll } = res.json() as { roll: { id: string } };

    const created = (await api.log()).find(
      (e) => e.type === 'roll.created' && (e.payload as { id?: string }).id === roll.id,
    );
    expect(created, 'the roll committed but never reached the shared log (FR2.9)').toBeDefined();
    expect(created!.id, 'the new event reused an id a client may already hold').toBeGreaterThan(
      highWater,
    );
  } finally {
    await app.close();
  }
}

// ---------------------------------------------------------------------------
// One seeded campaign, copied before anything opens it
// ---------------------------------------------------------------------------

let dataDir = '';
let restoreDir = '';
let seeded: SeedResult;
let sourceInventory: string[] = [];
let restoreInventory: string[] = [];
let dryRun = '';
const temps: string[] = [];

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `safehouse-${tag}-`));
  temps.push(dir);
  return dir;
}

beforeAll(async () => {
  // The target database is named explicitly; nothing here may pick up a
  // DATABASE_URL from the environment and quietly write to a real server.
  delete process.env['DATABASE_URL'];

  dataDir = tempDir('restore-src');
  seeded = await seedInChildProcess(dataDir);

  // The restore: a byte copy of the whole DATA_DIR, taken while no process
  // holds it — which is the state the seeder left it in, and the state a GM's
  // backup drive sees between sessions.
  restoreDir = tempDir('restore-copy');
  cpSync(dataDir, restoreDir, { recursive: true });
  sourceInventory = inventory(dataDir);
  restoreInventory = inventory(restoreDir);

  // The operator's first command, run here because it is the last moment
  // nothing in this process holds the seeded directory open.
  dryRun = await runMigrateCli(['--data-dir', dataDir, '--dry-run']);
}, 300_000);

afterAll(() => {
  resetDbSingleton();
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows file-handle stragglers — they are temp dirs, the OS gets them */
    }
  }
});

// ===========================================================================
// 1 · the restore: boot the server on a file copy of DATA_DIR
// ===========================================================================

describe('a DATA_DIR restored from a file copy', () => {
  let db: Db;
  let api: TableApi;
  let seededMax = 0;
  let seededEvents = 0;
  let arrivedMax = 0;
  let arrivedNext = 0;

  beforeAll(async () => {
    process.env['DATA_DIR'] = restoreDir;
    resetDbSingleton();
    db = getDb();
    // Read the state the copy ARRIVED in, before `buildApp` runs migrations and
    // the sequence guard — otherwise the repair hides what was there.
    arrivedMax = await maxEventId(db);
    arrivedNext = await nextEventSequenceValue(db);

    const app = await buildApp({ db, webDist: false, logger: false });
    api = new TableApi(app, seeded.campaignId, seeded.gmToken);
    seededMax = await maxEventId(db);
    seededEvents = (await api.log()).length;
  }, 120_000);

  afterAll(async () => {
    if (api) await api.app.close();
    await closeDb(db).catch(() => undefined);
    resetDbSingleton();
  });

  it('is a byte copy of the original, database files and all', () => {
    expect(restoreInventory).toEqual(sourceInventory);
    expect(
      restoreInventory.some((entry) => entry.startsWith('pglite/')),
      'the copy contains no PGlite files — this suite would prove nothing',
    ).toBe(true);
  });

  it('arrives needing no repair — a cold copy carries its sequences', () => {
    // Worth pinning, because it settles where the LIVE-4 directory could have
    // come from: a sequence lives in the data files, so copying a cleanly
    // closed DATA_DIR brings it along and the restored campaign is already
    // consistent. The drift has to come from somewhere else — a copy taken
    // while the app was writing, or a logical move that carries the rows and
    // not the sequences, which is what block 2 below builds on purpose.
    expect(arrivedMax).toBeGreaterThan(10);
    expect(
      arrivedNext,
      'the restored copy was already primed to collide before the server touched it',
    ).toBeGreaterThan(arrivedMax);
  });

  it('opens with the campaign whole: settings, characters, and the log', async () => {
    const res = await api.campaign();
    expect(res.statusCode, res.body).toBe(200);
    const campaign = res.json() as { name: string; ingameDate?: string | null };
    expect(campaign.name).toBe(CAMPAIGN_NAME);
    expect(campaign.ingameDate).toBeTruthy();

    const chars = await api.characters();
    expect(chars.statusCode, chars.body).toBe(200);
    const list = (chars.json() as { characters: { id: string }[] }).characters;
    expect(list.length).toBeGreaterThan(0);

    // The sheet JSONB is readable enough for the rules engine to derive from.
    const derived = await api.derived(list[0]!.id);
    expect(derived.statusCode, derived.body.slice(0, 200)).toBe(200);
    expect(
      Object.keys((derived.json() as { derived: { pools: object } }).derived.pools).length,
    ).toBeGreaterThan(0);

    expect(
      seededEvents,
      'the restored log is empty — the copy carried no events across',
    ).toBeGreaterThan(10);
  });

  it('brings the file store with it — a restored map still serves its bytes', async () => {
    const rows = await rowsOf<{ id: string; path: string; size: number | string }>(
      db,
      sql`select id::text as id, path, size from attachments order by created_at limit 1`,
    );
    const attachment = rows[0];
    expect(attachment, 'the seeded campaign uploaded no attachment to restore').toBeDefined();

    // The bytes are beside the database, not inside it: `DATA_DIR/files`.
    const onDisk = statSync(join(restoreDir, 'files', attachment!.path));
    expect(onDisk.size).toBe(Number(attachment!.size));

    const res = await api.file(attachment!.id);
    expect(res.statusCode, `GET /files/:id -> ${res.statusCode} ${res.body.slice(0, 200)}`).toBe(
      200,
    );
    expect(res.rawPayload.length).toBe(Number(attachment!.size));
  });

  it('accepts the next roll and lands it in the shared log', async () => {
    const res = await api.postRoll('first roll after the restore');
    expect(res.statusCode, `POST /api/rolls -> ${res.statusCode} ${res.body}`).toBe(201);
    const { roll } = res.json() as { roll: { id: string } };

    const created = (await api.log()).find(
      (e) => e.type === 'roll.created' && (e.payload as { id?: string }).id === roll.id,
    );
    expect(created, 'the roll committed but never reached the log — LIVE-4 in a restore').toBeDefined();
    expect(created!.id).toBeGreaterThan(seededMax);
  });

  it('keeps ids going up, so a client resumes from its last_event_id', async () => {
    await api.postRoll('second roll after the restore');
    const fresh = await eventsSince(db, seeded.campaignId, seededMax);
    expect(fresh.length, 'replay from the pre-restore cursor returned nothing').toBeGreaterThan(0);

    const ids = fresh.map((e) => Number(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(Math.min(...ids)).toBeGreaterThan(seededMax);
    expect(new Set(ids).size, 'an id was issued twice').toBe(ids.length);

    // And nothing is queued to collide on the next append.
    expect(await nextEventSequenceValue(db)).toBeGreaterThan(await maxEventId(db));
  });
});

// ===========================================================================
// 2 · the move: PGlite -> a fresh database, ids preserved
// ===========================================================================

describe('a PGlite campaign moved into a fresh database', () => {
  let source: Db;

  beforeAll(async () => {
    // The ORIGINAL seeded directory (the restore block used the copy).
    process.env['DATA_DIR'] = dataDir;
    resetDbSingleton();
    source = getDb();
  }, 120_000);

  afterAll(async () => {
    await closeDb(source).catch(() => undefined);
    resetDbSingleton();
  });

  it('takes the flags compose.yaml tells the operator to type', () => {
    expect(
      parseArgs(['--data-dir', './data', '--database-url', 'postgres://x/y', '--dry-run']),
    ).toMatchObject({ dataDir: './data', databaseUrl: 'postgres://x/y', dryRun: true });
    expect(() => parseArgs(['--databse-url', 'x'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--database-url'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--batch-size', '0'])).toThrow(/positive integer/);
  });

  it('answers `--dry-run` the way the compose header promises', () => {
    // Ran as a child process against the seeded directory before anything in
    // this process opened it — the operator's command, not an exported function.
    expect(dryRun).toMatch(/dry run/i);
    expect(dryRun).toMatch(/ws_events/);
    expect(dryRun).toMatch(/nothing was written/i);
    // The half a database migration cannot move, counted so it is not forgotten.
    expect(dryRun).toMatch(/copy the file store too: [1-9]\d* entr/i);
  });

  it('plans the copy without touching anything: counts and a safe order', async () => {
    const plan = await planMove(source);
    expect(plan.totalRows).toBeGreaterThan(0);

    const counted = new Map(plan.rows.map((r) => [r.table, r.sourceRows]));
    expect(counted.get('campaigns')).toBe(1);
    expect(counted.get('ws_events') ?? 0).toBeGreaterThan(10);

    // Parents before children, or every foreign key fails on the way in.
    expect(plan.order.indexOf('users')).toBeLessThan(plan.order.indexOf('campaigns'));
    expect(plan.order.indexOf('campaigns')).toBeLessThan(plan.order.indexOf('characters'));
    expect(plan.order.indexOf('scenes')).toBeLessThan(plan.order.indexOf('tokens'));
  });

  it('orders a table after every table it points at', () => {
    const { order, cyclic } = copyOrder(
      ['tokens', 'scenes', 'campaigns'],
      new Map([
        ['tokens', new Set(['scenes'])],
        ['scenes', new Set(['campaigns'])],
      ]),
    );
    expect(order).toEqual(['campaigns', 'scenes', 'tokens']);
    expect(cyclic).toEqual([]);
  });

  // -- the naive move: rows with their ids, sequences left behind ------------
  describe('copied with the sequence pass skipped — the hand-rolled version', () => {
    let naive: Db;
    let sourceMax = 0;

    beforeAll(async () => {
      process.env['DATA_DIR'] = tempDir('move-naive');
      resetDbSingleton();
      naive = getDb();
      sourceMax = await maxEventId(source);
      await migrateDatabase({ source, target: naive, resyncSequences: false });
    }, 180_000);

    afterAll(async () => {
      await closeDb(naive).catch(() => undefined);
      resetDbSingleton();
    });

    it('does carry every row and every id across', async () => {
      const report = await verifyMove(source, naive);
      for (const table of report.tables) {
        expect(table.targetRows, `\`${table.table}\` lost rows in the move`).toBe(table.sourceRows);
      }
      expect(await maxEventId(naive)).toBe(sourceMax);
      expect(sourceMax).toBeGreaterThan(10);
    });

    it('and is still broken: its sequence would re-issue an id that exists', async () => {
      const report = await verifyMove(source, naive);
      expect(report.ok, 'verification passed a move that has not moved its sequences').toBe(false);
      expect(report.problems.join(' ')).toMatch(/collide/i);
      expect(await nextEventSequenceValue(naive)).toBeLessThanOrEqual(sourceMax);
    });

    it('rejects the table’s very next event — LIVE-4, reached the real way', async () => {
      const thrown = await rawAppend(naive, 'restore-boot.counterfactual');
      expect(thrown, 'the naive move accepted an append — the premise is wrong').not.toBeNull();
      expect(messageChain(thrown)).toMatch(/duplicate key|ws_events_pkey|unique/i);
    });

    it('is repaired by the pass the script runs by default', async () => {
      const repairs = await resyncSequences(naive);
      expect(repairs.map((r) => r.sequence).join(' ')).toMatch(/ws_events_id_seq/);
      expect(await nextEventSequenceValue(naive)).toBeGreaterThan(sourceMax);
      expect(await verifyMove(source, naive)).toMatchObject({ ok: true });

      expect(await rawAppend(naive, 'restore-boot.after-repair')).toBeNull();
    });
  });

  // -- the move as the script performs it ----------------------------------
  describe('copied by the script', () => {
    let target: Db;
    let sourceMax = 0;

    beforeAll(async () => {
      process.env['DATA_DIR'] = tempDir('move-target');
      resetDbSingleton();
      target = getDb();
      sourceMax = await maxEventId(source);
    }, 120_000);

    afterAll(async () => {
      await closeDb(target).catch(() => undefined);
      resetDbSingleton();
    });

    it('verifies clean, with ids preserved and every sequence past its rows', async () => {
      const report = await migrateDatabase({ source, target });
      expect(report.problems.join('; ')).toBe('');
      expect(report.ok).toBe(true);

      expect(report.tables.length).toBeGreaterThan(5);
      for (const table of report.tables) expect(table.ok).toBe(true);

      const events = report.sequences.find((s) => s.table === 'ws_events');
      expect(events, 'nothing checked the ws_events sequence').toBeDefined();
      expect(events!.sourceMax).toBe(events!.targetMax);
      expect(events!.nextValue).toBeGreaterThan(events!.targetMax!);

      // The repair is reported, not silent: this move really did have to move
      // a sequence, which is the whole hazard.
      expect(report.repairs.map((r) => r.sequence).join(' ')).toMatch(/ws_events_id_seq/);
    }, 180_000);

    it('refuses to copy into a database that already holds rows', async () => {
      await expect(migrateDatabase({ source, target })).rejects.toThrow(/not empty/i);
    }, 120_000);

    it('boots the server on the moved database and plays', async () => {
      await bootAndRoll(target, seeded, 'first roll after the move');
      expect(await maxEventId(target)).toBeGreaterThan(sourceMax);
    }, 120_000);
  });
});

// ===========================================================================
// 3 · the same move over node-postgres — skipped unless a server is offered
// ===========================================================================

describe.skipIf(!PG_URL)('the move into a real Postgres server', () => {
  let source: Db;
  let target: Db;
  let sourceMax = 0;

  beforeAll(async () => {
    process.env['DATA_DIR'] = dataDir;
    resetDbSingleton();
    source = getDb();
    sourceMax = await maxEventId(source);

    target = createNodePgDb(PG_URL!);
    // SAFEHOUSE_TEST_DATABASE_URL is documented as a throwaway database.
    await target.execute(sql`drop schema if exists drizzle cascade`);
    await target.execute(sql`drop schema if exists public cascade`);
    await target.execute(sql`create schema public`);
  }, 180_000);

  afterAll(async () => {
    await closeDb(source).catch(() => undefined);
    await closeDb(target).catch(() => undefined);
    resetDbSingleton();
  });

  it('moves the campaign across the driver boundary with its ids', async () => {
    const report = await migrateDatabase({ source, target });
    expect(report.problems.join('; ')).toBe('');
    expect(report.ok).toBe(true);
    expect(await maxEventId(target)).toBe(sourceMax);

    const events = report.sequences.find((s) => s.table === 'ws_events');
    expect(events!.nextValue).toBeGreaterThan(sourceMax);
  }, 300_000);

  it('boots the server on it and plays', async () => {
    await bootAndRoll(target, seeded, 'first roll on postgres');
    expect(await maxEventId(target)).toBeGreaterThan(sourceMax);
  }, 180_000);
});
