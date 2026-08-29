/**
 * The check that was missing when the shared log died.
 *
 * Every unit suite here seeds its world INSIDE the process that then asserts
 * against it: `makeTestApp` builds a fresh temp PGlite and bootstraps over
 * `app.inject`, so the database it meets is one it created a moment earlier and
 * has never let go of. That is the sequence a real table never plays:
 *
 *     one process writes the campaign  →  that process exits
 *     another process opens the SAME directory  →  it writes an event
 *     someone reads the log back
 *
 * `ws_events.id` is a bigserial, and a serial's next value lives in a sequence
 * BESIDE the table rather than in it, so the two can be separated by anything
 * that moves rows without moving sequence state — a file-copy restore, or the
 * ordinary way of moving this database between backends (load the rows with
 * their ids intact into a fresh schema and the sequence is still at 1). When
 * they are separated, every append collides on a primary key the server never
 * chose: `POST /api/rolls` 500s AFTER the roll row is already committed, table
 * talk 500s, the clock 500s, and `GET /api/campaigns/:id/log` freezes on
 * whatever the seeder wrote. The table's shared log — the core of FR2.9 — is
 * dead, and the whole unit suite, the playthrough and the browser suite all
 * say the build is fine, because none of them is ever HANDED a database.
 *
 * So this file owns both halves of that gap:
 *
 *   1. THE SHAPE — spawn `seed:demo` as a child process, wait for it to exit,
 *      open the directory it left behind, and then write and read back every
 *      kind of event a session produces. Nothing is mocked and no state is
 *      carried over in memory: the only thing shared with the seeder is the
 *      bytes on disk. (The playthrough and the browser harness both spawn the
 *      seeder too, but they go on to drive a whole session; this is the small,
 *      fast, unambiguous version, and it is the one CI runs first.)
 *   2. THE STATE — a directory whose sequence has fallen behind its rows, which
 *      is the condition the failure is actually made of and which no seed
 *      produces on its own (crash recovery only ever skips ids FORWARD). A
 *      counterfactual proves the drift really is fatal to an append; the tests
 *      beside it prove that booting the server against such a directory repairs
 *      it, in both of the off-by-one states a restore can leave behind.
 *
 * Runtime is dominated by three PGlite boots and one full demo seed (~10 s).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDbSingleton, type Db } from '@safehouse/db';
import { buildApp } from '../src/app.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');
const CAMPAIGN_NAME = 'Static on the Line';

// ---------------------------------------------------------------------------
// The child process
// ---------------------------------------------------------------------------

interface SeedResult {
  code: number | null;
  out: string;
  campaignId: string;
  gmToken: string;
}

/**
 * Run `seed:demo` in its own process against `dataDir` and wait for it to be
 * GONE. PGlite is embedded and single-writer: the seeder must have released the
 * directory before this process opens it, and `close` fires only after exit —
 * which is precisely the boundary no other check crosses.
 *
 * Only two strings are read out of the output (the campaign id and the GM's
 * token, printed once and never stored in the clear); everything else the
 * assertions need is fetched from the server afterwards.
 */
function seedInChildProcess(dataDir: string): Promise<SeedResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir, LOG_LEVEL: 'warn' };
    // Offline by construction (NG7): no external database, no model, no webhook,
    // and none of the 300 MB of rulebook PDFs this test has no use for.
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
      resolve({ code, out, campaignId, gmToken });
    });
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface LogEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  visibility: string;
  ts: string;
}

/** Rows out of `db.execute`, which differs in shape between the two drivers. */
async function rowsOf<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/** Highest `ws_events.id` in the whole database (the sequence is global). */
async function maxEventId(db: Db): Promise<number> {
  const rows = await rowsOf<{ m: string | number | null }>(
    db,
    sql`select coalesce(max(id), 0)::bigint as m from ws_events`,
  );
  const value = rows[0]?.m;
  return value == null ? 0 : Number(value);
}

/**
 * Every message down an error's `cause` chain. Drizzle wraps a driver error in
 * "Failed query: …", which is exactly the 500 body the table saw — the reason
 * it happened is one link further down.
 */
function messageChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

/** `last_value` / `is_called` of the ws_events id sequence. */
async function sequenceState(db: Db): Promise<{ lastValue: number; isCalled: boolean }> {
  const rows = await rowsOf<{ last_value: string | number; is_called: boolean }>(
    db,
    sql`select last_value, is_called from ws_events_id_seq`,
  );
  const row = rows[0];
  if (!row) throw new Error('ws_events_id_seq is missing');
  return { lastValue: Number(row.last_value), isCalled: row.is_called };
}

/**
 * Put the sequence back behind the rows — the state a directory arrives in
 * when its rows were moved without it (a file-copy restore, or the ordinary
 * "load the rows into a fresh schema with their ids intact" migration between
 * backends). Nothing in the app does this; the test has to build it.
 */
async function rewindSequence(db: Db, to: number, isCalled: boolean): Promise<void> {
  await db.execute(sql`select setval('ws_events_id_seq', ${to}::bigint, ${isCalled}::boolean)`);
}

class TestApp {
  constructor(
    readonly app: FastifyInstance,
    readonly campaignId: string,
    readonly gmToken: string,
  ) {}

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.gmToken}` };
  }

  async log(limit = 200): Promise<LogEvent[]> {
    const res = await this.app.inject({
      method: 'GET',
      url: `/api/campaigns/${this.campaignId}/log?limit=${limit}`,
      headers: this.auth(),
    });
    expect(res.statusCode, `GET /log → ${res.statusCode} ${res.body}`).toBe(200);
    return (res.json() as { events: LogEvent[] }).events;
  }

  async rollIds(): Promise<string[]> {
    const res = await this.app.inject({
      method: 'GET',
      url: `/api/campaigns/${this.campaignId}/rolls?limit=200`,
      headers: this.auth(),
    });
    expect(res.statusCode, `GET /rolls → ${res.statusCode} ${res.body}`).toBe(200);
    return (res.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id);
  }

  /** The GM rolls a free pool from the table composer (FR2.8). */
  postRoll(pool = 6, label = 'seeded-boot probe') {
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

  postTalk(text: string) {
    return this.app.inject({
      method: 'POST',
      url: `/api/campaigns/${this.campaignId}/log`,
      headers: this.auth(),
      payload: { kind: 'talk', text, visibility: 'public' },
    });
  }

  advanceClock(to: string) {
    return this.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${this.campaignId}`,
      headers: this.auth(),
      payload: { ingameDate: to },
    });
  }
}

// ---------------------------------------------------------------------------

let dataDir = '';
let seeded: SeedResult;
let db: Db;
let api: TestApp;
let seededEventCount = 0;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'safehouse-seeded-boot-'));

  // 1 — another process writes the world, and exits.
  seeded = await seedInChildProcess(dataDir);

  // 2 — this process opens the directory it left behind. `getDb()` is the same
  //     call `src/index.ts` makes, so the server sees exactly what a real
  //     `pnpm dev:server` after a `pnpm seed:demo` would see.
  process.env['DATA_DIR'] = dataDir;
  delete process.env['DATABASE_URL'];
  resetDbSingleton();
  db = getDb();
  const app = await buildApp({ db, webDist: false, logger: false });
  api = new TestApp(app, seeded.campaignId, seeded.gmToken);
  seededEventCount = (await api.log(500)).length;
});

afterAll(async () => {
  if (api) await api.app.close();
  try {
    await (db as unknown as { $client: { close(): Promise<void> } }).$client.close();
  } catch {
    /* already closed */
  }
  resetDbSingleton();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows file-handle stragglers — it is a temp dir, the OS gets it */
  }
});

// ===========================================================================
// 1 · the shape: seed in one process, serve from the next
// ===========================================================================

describe('a campaign seeded by one process and served by the next', () => {
  it('really did cross a process boundary, and the server opened the same bytes', async () => {
    expect(seeded.code, seeded.out).toBe(0);

    const res = await api.app.inject({
      method: 'GET',
      url: `/api/campaigns/${seeded.campaignId}`,
      headers: { authorization: `Bearer ${seeded.gmToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { name: string }).name).toBe(CAMPAIGN_NAME);

    // The seeder emits through the same services a GM clicking the UI would,
    // so the directory arrives carrying a real backlog of persisted events. If
    // this is ever 0 every assertion below becomes vacuous.
    expect(
      seededEventCount,
      'the seeder left no ws_events behind — this suite would prove nothing',
    ).toBeGreaterThan(10);
  });

  it('accepts a roll, persists it, AND lands it in the shared log', async () => {
    const highWater = await maxEventId(db);

    const res = await api.postRoll(6, 'first roll after the reboot');
    expect(res.statusCode, `POST /api/rolls → ${res.statusCode} ${res.body}`).toBe(201);
    const { roll } = res.json() as { roll: { id: string; request: { pool: number } } };

    expect(await api.rollIds()).toContain(roll.id);

    const events = await api.log();
    const created = events.find(
      (e) => e.type === 'roll.created' && (e.payload as { id?: string }).id === roll.id,
    );
    expect(
      created,
      `the roll persisted but never reached the log; log types: ${events.map((e) => e.type).join(', ')}`,
    ).toBeDefined();
    expect(created!.id).toBeGreaterThan(highWater);
  });

  it('never half-commits a roll: what is in the table is in the log', async () => {
    const before = new Set(await api.rollIds());
    const posted: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await api.postRoll(5 + i, `atomicity probe ${i}`);
      // A 5xx here is the defect in its original form: the `rolls` row commits
      // and the event append throws, so the roll exists and the table never
      // hears about it. Either both happen or neither may.
      expect(res.statusCode, `POST /api/rolls → ${res.statusCode} ${res.body}`).toBe(201);
      posted.push((res.json() as { roll: { id: string } }).roll.id);
    }

    const persisted = (await api.rollIds()).filter((id) => !before.has(id));
    const broadcast = new Set(
      (await api.log(500))
        .filter((e) => e.type === 'roll.created')
        .map((e) => (e.payload as { id?: string }).id)
        .filter((id): id is string => typeof id === 'string'),
    );

    expect(persisted.sort()).toEqual([...posted].sort());
    for (const id of persisted) {
      expect(broadcast.has(id), `roll ${id} is in \`rolls\` but not in the log`).toBe(true);
    }
  });

  it('appends table talk to the shared log', async () => {
    const text = 'seeded-boot: the freight door grinds half open';
    const res = await api.postTalk(text);
    expect(res.statusCode, `POST /log → ${res.statusCode} ${res.body}`).toBe(201);
    const { event } = res.json() as { event: { id: number } };

    const events = await api.log();
    const posted = events.find((e) => e.id === event.id);
    expect(posted, 'table talk answered 201 but never appeared in GET /log').toBeDefined();
    expect(JSON.stringify(posted!.payload)).toContain(text);
  });

  it('advances the clock, and says so in the log', async () => {
    const res = await api.advanceClock('2076-06-13');
    expect(res.statusCode, `PATCH /api/campaigns/:id → ${res.statusCode} ${res.body}`).toBe(200);
    expect((res.json() as { ingameDate: string }).ingameDate).toBe('2076-06-13');

    const advanced = (await api.log()).filter((e) => e.type === 'clock.advanced');
    expect(advanced.length, 'the clock moved without telling the table (§11)').toBeGreaterThan(0);
    expect((advanced[0]!.payload as { to?: string }).to).toBe('2076-06-13');
  });

  it('has grown the log the whole way through — a reader sees every write', async () => {
    const events = await api.log(500);
    expect(
      events.length,
      'GET /log is frozen on what the seeder wrote; nothing this suite appended is readable',
    ).toBeGreaterThan(seededEventCount);
  });
});

// ===========================================================================
// 2 · the state: a directory whose sequence fell behind its rows
// ===========================================================================

describe('a data directory whose ws_events sequence fell behind its rows', () => {
  it('is genuinely fatal to an append — the counterfactual', async () => {
    const high = await maxEventId(db);
    expect(high).toBeGreaterThan(1);
    await rewindSequence(db, 1, true);

    // No repair, no boot: a raw insert with a DEFAULT id, exactly what
    // `appendEvent` issues. It must collide, or the tests below are vacuous.
    let thrown: unknown = null;
    try {
      await db.execute(sql`
        insert into ws_events (campaign_id, type, payload)
        select campaign_id, 'seeded-boot.counterfactual', '{}'::jsonb
        from ws_events order by id limit 1
      `);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'a rewound sequence let an append through — the premise is wrong').not.toBeNull();
    expect(messageChain(thrown)).toMatch(/duplicate key|ws_events_pkey|unique/i);
  });

  // `is_called = false` means `last_value` is the NEXT id to be issued;
  // `true` means it was already used. A restore can leave either, and the two
  // are off by one — a repair that handles only one of them still ships the bug.
  for (const isCalled of [true, false]) {
    it(`is repaired when the server boots against it (is_called = ${String(isCalled)})`, async () => {
      const high = await maxEventId(db);
      await rewindSequence(db, 1, isCalled);
      expect((await sequenceState(db)).lastValue).toBe(1);

      // The boot path — `buildApp` runs the migrations and whatever reconciling
      // goes with them, the same way `src/index.ts` does on `pnpm dev:server`.
      const booted = await buildApp({ db, webDist: false, logger: false });
      try {
        const after = await sequenceState(db);
        expect(
          after.lastValue,
          'booting left the sequence behind the rows it has to clear',
        ).toBeGreaterThanOrEqual(high);

        const rebooted = new TestApp(booted, seeded.campaignId, seeded.gmToken);
        const res = await rebooted.postRoll(4, 'after a sequence repair');
        expect(res.statusCode, `POST /api/rolls → ${res.statusCode} ${res.body}`).toBe(201);
        const { roll } = res.json() as { roll: { id: string } };

        const created = (await rebooted.log()).find(
          (e) => e.type === 'roll.created' && (e.payload as { id?: string }).id === roll.id,
        );
        expect(created, 'the append survived but the event never reached the log').toBeDefined();
        // Forward only: ids clients already hold as `last_event_id` must never
        // be re-issued, or replay silently truncates (§11).
        expect(created!.id).toBeGreaterThan(high);
      } finally {
        await booted.close();
      }
    });
  }

  it('leaves a healthy sequence alone — repair is never a rewind', async () => {
    const before = await sequenceState(db);
    const high = await maxEventId(db);
    expect(before.lastValue).toBeGreaterThanOrEqual(high);

    const booted = await buildApp({ db, webDist: false, logger: false });
    try {
      const after = await sequenceState(db);
      expect(after.lastValue).toBeGreaterThanOrEqual(before.lastValue);
    } finally {
      await booted.close();
    }
  });
});
