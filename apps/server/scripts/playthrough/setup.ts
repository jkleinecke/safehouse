/**
 * Playthrough setup: a throwaway world to play in.
 *
 * Fresh temp `DATA_DIR` → `seed:books --only SR5` (skipped when the PDF is not
 * beside DESIGN.md) → `seed:demo` → boot the real Fastify app on a loopback
 * port. The two seeds run as child processes on purpose: PGlite is an embedded,
 * single-process database, so the seeder has to have let go of the directory
 * before this process opens it.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { campaigns, characters, devices } from '@safehouse/db';
import { buildApp } from '../../src/app.js';
import { hashToken, mintToken } from '../../src/services/auth.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');
const SEED_BOOKS = join(REPO_ROOT, 'apps', 'server', 'scripts', 'seed-books.ts');
const CORE_PDF = join(REPO_ROOT, 'shadowrunfiftheditioncorerulebook_V2.pdf');

export const CAMPAIGN_NAME = 'Static on the Line';

export interface RunResult {
  ok: boolean;
  code: number | null;
  out: string;
}

/** Run a TypeScript entrypoint under tsx, capturing its output. */
export function runScript(
  script: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, script, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const grab = (chunk: unknown): void => {
      out += String(chunk);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out: out.trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, out: `${out}\n${String(err)}`.trim() });
    });
  });
}

export interface World {
  app: FastifyInstance;
  baseUrl: string;
  wsUrl: string;
  dataDir: string;
  campaignId: string;
  gmToken: string;
  /** Character rows of the seeded party, keyed by alias. */
  characterIds: Record<string, string>;
  booksSeeded: string;
}

export interface BootOptions {
  /** Keep the temp DATA_DIR on disk after the run (debugging). */
  keepData: boolean;
}

/** Seed a throwaway world and boot the server against it. */
export async function boot(opts: BootOptions): Promise<World> {
  const dataDir = join(tmpdir(), `safehouse-playthrough-${Date.now()}`);
  await mkdir(dataDir, { recursive: true });
  if (!opts.keepData) {
    process.on('exit', () => {
      /* best effort — rm is async, so the explicit teardown does the real work */
    });
  }

  // --- books (FR11.7): tolerate the PDF simply not being there -------------
  let booksSeeded = 'skipped — no core rulebook PDF beside DESIGN.md';
  if (existsSync(CORE_PDF)) {
    console.log('seed:books --only SR5 --max-pages 60 …');
    const res = await runScript(
      SEED_BOOKS,
      ['--only', 'SR5', '--max-pages', '60', '--data-dir', dataDir],
      { DATA_DIR: dataDir },
      10 * 60_000,
    );
    const pages = /(\d+) page\(s\) indexed/.exec(res.out)?.[1];
    booksSeeded = res.ok
      ? `SR5 registered, ${pages ?? '?'} pages of text indexed`
      : `attempted and failed (tolerated): ${res.out.split('\n').slice(-1)[0] ?? ''}`;
    console.log(`  ${booksSeeded}`);
  } else {
    console.log(`seed:books skipped — ${CORE_PDF} not present`);
  }

  // --- the demo campaign ----------------------------------------------------
  console.log('seed:demo …');
  const demo = await runScript(SEED_DEMO, [], { DATA_DIR: dataDir }, 5 * 60_000);
  if (!demo.ok) throw new Error(`seed:demo failed:\n${demo.out}`);
  console.log(`  ${CAMPAIGN_NAME} seeded into ${dataDir}`);

  // --- boot the real app ----------------------------------------------------
  process.env['DATA_DIR'] = dataDir;
  const app = await buildApp({ webDist: false, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const campaign = (
    await app.db.select().from(campaigns).where(eq(campaigns.name, CAMPAIGN_NAME)).limit(1)
  )[0];
  if (!campaign) throw new Error(`seed:demo left no campaign named "${CAMPAIGN_NAME}"`);

  // The seed prints the GM's token once and never stores it in the clear (only
  // its sha256 hash lands in `devices`). The GM's laptop reconnecting therefore
  // means a NEW device row for the same user — exactly what the app does when
  // the GM re-pairs a machine.
  // INTEGRATION: there is no "re-pair the GM's own laptop" route (invites are
  // role-scoped to player/observer/display, FR1.3), so this writes the device
  // row directly. A `POST /api/campaigns/:id/gm-device` would remove it.
  const gmToken = mintToken();
  await app.db.insert(devices).values({
    userId: campaign.gmUserId,
    campaignId: campaign.id,
    role: 'gm',
    tokenHash: hashToken(gmToken),
    label: "GM's laptop (playthrough)",
  });

  const roster = await app.db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(eq(characters.campaignId, campaign.id));
  const characterIds: Record<string, string> = {};
  for (const row of roster) characterIds[row.name] = row.id;

  return {
    app,
    baseUrl,
    wsUrl: baseUrl.replace(/^http/, 'ws'),
    dataDir,
    campaignId: campaign.id,
    gmToken,
    characterIds,
    booksSeeded,
  };
}

/**
 * Hand a seeded sheet to the phone that just scanned a code (FR1.1: the join
 * link binds a device, and the GM says which runner it is holding).
 * INTEGRATION: there is no "claim this sheet" route yet — `POST /api/characters`
 * takes `ownerUserId` at creation and `PATCH` does not — so the playthrough
 * writes the column directly. A `PATCH /api/characters/:id { ownerUserId }`
 * (GM-only) would close this.
 */
export async function assignCharacter(
  app: FastifyInstance,
  characterId: string,
  ownerUserId: string,
): Promise<void> {
  await app.db.update(characters).set({ ownerUserId }).where(eq(characters.id, characterId));
}

export async function teardown(world: World, keepData: boolean): Promise<void> {
  await world.app.close();
  if (!keepData) await rm(world.dataDir, { recursive: true, force: true }).catch(() => undefined);
}
