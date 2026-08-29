/**
 * Boot the REAL stack for the E2E run: a throwaway `DATA_DIR`, the demo
 * campaign seeded through the app's own HTTP surface, and the built Fastify
 * server serving the built SPA on one origin — exactly the production posture
 * (`docker compose up`), which is also the only posture in which `/join/:code`
 * has to resolve to the join SCREEN rather than the API's JSON (LIVE-3).
 *
 * Nothing is mocked. The dice are the server's CSPRNG, the database is PGlite,
 * and the only thing missing is a model (`LLM_BASE_URL` stays unset, NG7).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api, type DerivedPool, type JoinAnswer, type PersistedRoll } from './api';
import type { DeviceSession, World } from './world';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');
const SERVER_DIST = join(REPO_ROOT, 'apps', 'server', 'dist', 'index.js');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');

/** Distinctive strings the secrecy spec looks for. Never book content. */
export const GM_ONLY_LOG_TEXT =
  'GM-ONLY-E2E: the second courier is already inside and nobody has seen him.';
export const PUBLIC_LOG_TEXT = 'PUBLIC-E2E: the freight door grinds half open.';

export interface Booted {
  world: World;
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Build freshness — an E2E run against a stale bundle proves nothing
// ---------------------------------------------------------------------------

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = statSync(join(entry.parentPath, entry.name));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      // A file that vanished between the listing and the stat is not a reason
      // to skip the build — treat the tree as fresh-enough and move on.
    }
  }
  return newest;
}

/** Rebuild the SPA when `src` is newer than `dist` (skippable in CI). */
export async function ensureWebBuild(log: (s: string) => void): Promise<void> {
  if (!existsSync(SERVER_DIST)) {
    throw new Error(
      `e2e: ${SERVER_DIST} is missing — run \`pnpm build\` first (the specs drive the built server).`,
    );
  }
  if (process.env.SAFEHOUSE_E2E_NO_BUILD === '1') {
    if (!existsSync(join(WEB_DIST, 'index.html'))) {
      throw new Error('e2e: apps/web/dist is missing and SAFEHOUSE_E2E_NO_BUILD=1 forbids building it.');
    }
    return;
  }

  const built = existsSync(join(WEB_DIST, 'index.html'))
    ? statSync(join(WEB_DIST, 'index.html')).mtimeMs
    : 0;
  const source = await newestMtime(join(REPO_ROOT, 'apps', 'web', 'src'));
  if (built > source) {
    log('e2e: apps/web/dist is current, skipping the SPA build');
    return;
  }

  log('e2e: building the SPA (apps/web/dist is stale)…');
  await run(process.execPath, [join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: join(REPO_ROOT, 'apps', 'web'),
  });
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out}\n${err}`)),
    );
  });
}

/** Env every child gets: no model, no webhook, no external database (NG7). */
function childEnv(dataDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir, LOG_LEVEL: 'warn', ...extra };
  delete env.DATABASE_URL;
  delete env.LLM_BASE_URL;
  delete env.DISCORD_WEBHOOK_URL;
  // The seeded PDFs are 300 MB of book; nothing here needs them.
  delete env.SAFEHOUSE_BOOKS_DIR;
  return env;
}

/**
 * `seed:demo` runs BEFORE the server, in its own process: PGlite locks its
 * directory, so the seed and the server can never hold it at the same time.
 * Only two things are read back out of its output — the campaign id and the
 * GM's token; everything else the specs need is fetched over REST afterwards,
 * so a change to the seed's pretty-printing cannot break the suite.
 */
async function seedDemo(dataDir: string): Promise<{ campaignId: string; gmToken: string }> {
  const stdout = await run(process.execPath, ['--import', 'tsx', SEED_DEMO], {
    env: childEnv(dataDir),
  });
  const campaignId = /^campaign\s+(\S+)/m.exec(stdout)?.[1];
  const gmToken = /^\s+gm\s+.*\s(\S+)\s*$/m.exec(stdout)?.[1];
  if (!campaignId || !gmToken) {
    throw new Error(`e2e: could not read the campaign id / GM token out of seed:demo\n${stdout}`);
  }
  return { campaignId, gmToken };
}

async function startServer(dataDir: string, port: number, logPath: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER_DIST], {
    cwd: REPO_ROOT,
    env: childEnv(dataDir, { PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const capture = (d: Buffer) => {
    log += d.toString();
    writeFileSync(logPath, log);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  let exited = false;
  child.on('exit', () => (exited = true));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`e2e: server exited before it was healthy\n${log}`);
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return child;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`e2e: server never answered ${base}/healthz\n${log}`);
}

// ---------------------------------------------------------------------------
// Arrangement — a table mid-session, before any browser opens
// ---------------------------------------------------------------------------

interface CharacterRow {
  id: string;
  name: string;
  ownerUserId?: string | null;
}
interface SceneRow {
  id: string;
  name: string;
  environment?: { light?: number };
}
interface TokenRow {
  id: string;
  name: string;
  hidden?: boolean;
}
interface CombatantRow {
  id: string;
  name: string;
  visibility?: string;
}

async function arrange(api: Api, campaignId: string, gmToken: string): Promise<World> {
  const gm: DeviceSession = { token: gmToken, role: 'gm', campaignId };

  const campaign = await api.get<{ name: string; activeSceneId?: string | null }>(
    `/api/campaigns/${campaignId}`,
    gmToken,
  );
  const { characters } = await api.get<{ characters: CharacterRow[] }>(
    `/api/campaigns/${campaignId}/characters`,
    gmToken,
  );
  const byAlias: Record<string, string> = {};
  for (const c of characters) byAlias[c.name] = c.id;

  const playerAlias = 'Whisper';
  const playerCharacterId = byAlias[playerAlias];
  if (!playerCharacterId) {
    throw new Error(`e2e: the demo seed has no character named ${playerAlias}`);
  }

  // --- a player device that actually OWNS a sheet --------------------------
  // Invites are not character-bound (a join mints a fresh user), so the E2E
  // player is joined over REST and then handed the sheet by the GM — the same
  // `PATCH /api/characters/:id/owner` a GM taps when a phone scans in.
  const playerInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'player' },
    gmToken,
  );
  const joined = await api.get<JoinAnswer>(
    `/api/join/${playerInvite.code}?name=${encodeURIComponent(playerAlias)}&label=E2E%20phone`,
  );
  await api.patch(
    `/api/characters/${playerCharacterId}/owner`,
    { ownerUserId: joined.user?.id },
    gmToken,
  );
  const player: DeviceSession = { token: joined.token, role: 'player', campaignId };

  // Codes the browser specs redeem themselves (unlimited uses, 24 h).
  const displayInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'display' },
    gmToken,
  );
  const spectatorInvite = await api.post<{ code: string }>(
    `/api/campaigns/${campaignId}/invites`,
    { role: 'player' },
    gmToken,
  );

  // --- the session is live (FR6.2) -----------------------------------------
  await api.post(`/api/campaigns/${campaignId}/sessions/start`, {}, gmToken);

  // --- the scene, its hidden tokens, and a fight staged from it ------------
  const sceneId = campaign.activeSceneId;
  if (!sceneId) throw new Error('e2e: the demo seed left no active scene');
  const scene = await api.get<{ scene: SceneRow; tokens: TokenRow[] }>(
    `/api/scenes/${sceneId}`,
    gmToken,
  );
  const hiddenTokenNames = scene.tokens.filter((t) => t.hidden).map((t) => t.name);
  if (hiddenTokenNames.length === 0) {
    throw new Error('e2e: the demo scene has no hidden tokens — the secrecy spec would be vacuous');
  }

  const staged = await api.post<{ encounterId: string; combatantIds: string[] }>(
    `/api/scenes/${sceneId}/stage-encounter`,
    { name: 'Pier 23 — the freight door' },
    gmToken,
  );
  await api.patch(`/api/encounters/${staged.encounterId}`, { state: 'live' }, gmToken);
  await api.post(`/api/encounters/${staged.encounterId}/roll-initiative`, {}, gmToken);
  const encounter = await api.get<{
    encounter?: { name?: string };
    name?: string;
    combatants: CombatantRow[];
  }>(`/api/encounters/${staged.encounterId}`, gmToken);
  const publicCombatants = (
    await api.get<{ combatants: CombatantRow[] }>(
      `/api/encounters/${staged.encounterId}`,
      player.token,
    )
  ).combatants.map((c) => c.name);

  // --- one roll already on the record, before any page mounts (LIVE-1) -----
  const derived = await api.get<{ derived: { pools: Record<string, DerivedPool> } }>(
    `/api/characters/${playerCharacterId}/derived`,
    player.token,
  );
  const perception = derived.derived.pools['skill.perception'];
  if (!perception) throw new Error(`e2e: ${playerAlias} has no perception pool`);

  const { roll } = await api.post<{ roll: PersistedRoll }>(
    '/api/rolls',
    {
      kind: 'simple',
      pool: perception.total,
      breakdown: perception.breakdown,
      ...(perception.limit ? { limit: perception.limit } : {}),
      edge: null,
      visibility: 'public',
      actor: { characterId: playerCharacterId },
      meta: { poolRef: 'skill.perception', title: 'perception', label: 'perception' },
    },
    player.token,
  );

  // --- two log lines: one the table shares, one only the GM may ever see ---
  await api.post(
    `/api/campaigns/${campaignId}/log`,
    { kind: 'marker', text: PUBLIC_LOG_TEXT, visibility: 'public' },
    gmToken,
  );
  await api.post(
    `/api/campaigns/${campaignId}/log`,
    { kind: 'marker', text: GM_ONLY_LOG_TEXT, visibility: 'gm' },
    gmToken,
  );

  return {
    baseUrl: api.baseUrl,
    campaignId,
    campaignName: campaign.name,
    gm,
    player,
    playerAlias,
    playerCharacterId,
    characters: byAlias,
    sceneId,
    sceneName: scene.scene.name,
    sceneLight: scene.scene.environment?.light ?? 0,
    encounterId: staged.encounterId,
    encounterName: encounter.encounter?.name ?? encounter.name ?? 'encounter',
    stagedCombatants: staged.combatantIds.length,
    publicCombatants,
    hiddenTokenNames,
    gmOnlyLogText: GM_ONLY_LOG_TEXT,
    publicLogText: PUBLIC_LOG_TEXT,
    seededRoll: {
      id: roll.id,
      pool: roll.request.pool,
      label: 'perception',
      actorName: playerAlias,
    },
    codes: { display: displayInvite.code, player: spectatorInvite.code },
  };
}

// ---------------------------------------------------------------------------
// Entry point used by global setup
// ---------------------------------------------------------------------------

export async function boot(port: number, log: (s: string) => void): Promise<Booted> {
  await ensureWebBuild(log);

  const dataDir = mkdtempSync(join(tmpdir(), 'safehouse-e2e-'));
  const serverLog = join(dataDir, 'server.log');
  log(`e2e: seeding the demo campaign into ${dataDir}`);
  const { campaignId, gmToken } = await seedDemo(dataDir);

  log(`e2e: booting the built server on :${port}`);
  const server = await startServer(dataDir, port, serverLog);

  const api = new Api(`http://127.0.0.1:${port}`);
  let world: World;
  try {
    world = await arrange(api, campaignId, gmToken);
  } catch (err) {
    server.kill();
    throw err;
  }
  log(
    `e2e: world ready — campaign ${world.campaignId}, ${world.stagedCombatants} combatants staged, ` +
      `roll ${world.seededRoll.id} (pool ${world.seededRoll.pool}) on the record`,
  );

  return {
    world,
    stop: async () => {
      server.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* the OS gets the temp dir */
      }
    },
  };
}
