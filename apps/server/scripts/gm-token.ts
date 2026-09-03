/**
 * gm:token — mint a GM sign-in for a campaign that already exists, straight
 * from the database. The break-glass path when no GM device is left alive.
 *
 *   pnpm --filter @safehouse/server gm:token
 *   pnpm --filter @safehouse/server gm:token --list
 *   pnpm --filter @safehouse/server gm:token --campaign "Neon Rain"
 *   pnpm --filter @safehouse/server gm:token --origin http://192.168.1.20:8787
 *
 * Pass the flags directly, as above — a bare `--` separator is forwarded by
 * pnpm into `process.argv` and rejected here as an unknown flag, the same way
 * `seed:books` behaves.
 *
 * WHY THIS IS NOT A NEW TRUST BOUNDARY. It introduces no secret and grants
 * nothing new: whoever can run it already has a shell on the machine that owns
 * the database and could read `campaigns`/`devices` — or write them — by hand.
 * All this does is save them the INSERT, and bind the result to the campaign's
 * EXISTING owner of record (`AuthService.mintGmDevice` reads
 * `campaigns.gm_user_id`), so it can neither create a user nor invent a GM.
 *
 * WHY IT EXISTS ALONGSIDE `POST /api/gm/recover`. That route is the good path
 * and needs no shell — but it refuses anything that is not a loopback socket,
 * which correctly rules out two real deployments:
 *
 *   - Docker. In a bridge network the host arrives from the gateway address,
 *     which is not loopback, so the route refuses. Relaxing it there would
 *     also admit every phone on the venue Wi-Fi, since a container cannot tell
 *     the two apart. This script is the Docker answer instead.
 *   - A GM on a different machine from the server (a NAS, a spare box).
 *
 * WHAT IT PRINTS. Two ways in, because they suit different moments:
 *
 *   1. A single-use `gm` PAIRING CODE and the `/join/:code` URL it belongs to.
 *      This is the one to use: it is minutes-long, dies after one browser
 *      redeems it, and the SPA already knows how to handle that URL (FR1.1).
 *   2. The campaign id and a long-lived GM device TOKEN, for the sign-in
 *      screen's "paste a token" tab when the join URL is not reachable — a
 *      headless box, a phone on another subnet, a copy-paste over chat.
 *
 * The token in (2) does not expire, so it belongs in a terminal you trust; a
 * device you regret is one `POST /api/devices/:id/revoke` away (FR1.3), and
 * the printed device id is what that route wants. `--pair-only` skips it.
 *
 * WHICH DATABASE. The same resolution the server uses — `DATABASE_URL` when
 * set, otherwise PGlite under `DATA_DIR` — and the repo-root/`infra` `.env` is
 * read first, so a GM whose stack lives in Compose does not silently mint a
 * token into an empty local PGlite instead. The resolved target is printed
 * (with any password redacted) precisely so that mistake is visible.
 *
 * PGlite is single-process: with the dev server running against `./data`, this
 * cannot open the same directory. Either point it at the Compose Postgres, or
 * stop the server first, or use the loopback route while it is up.
 *
 * UNDER DOCKER. The `app` image is production-only — no source, no tsx — so it
 * cannot run this file; the one-shot image that can is the `seed` service, the
 * same way `seed:demo` is run (see infra/docker-compose.yml's header). It
 * builds from the `build` stage and talks to the `postgres` service directly:
 *
 *   docker compose -f infra/docker-compose.yml --env-file .env run --rm \
 *     --entrypoint "pnpm --filter @safehouse/server gm:token" seed \
 *     --origin http://192.168.1.20:8787
 *
 * `--origin` matters there: inside the container `lanAddress()` sees a bridge
 * address, so the default URL would point somewhere no browser can reach.
 *
 * There is also a shorter form that needs no build, using the running app's own
 * loopback recovery route — `docker compose exec` runs INSIDE the container, so
 * 127.0.0.1 really is loopback there and `assertLoopbackOrigin` is satisfied
 * honestly (a browser on the host is NOT, which is the case that route refuses):
 *
 *   docker compose -f infra/docker-compose.yml exec app node -e \
 *     "fetch('http://127.0.0.1:8787/api/gm/recover',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).then(o=>console.log(JSON.stringify(o,null,2)))"
 *
 * That prints `{ campaignId, token, … }` for the paste-a-token tab (and, with
 * more than one campaign, a 409 listing them — put the chosen id in the body).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMigrations, getDb, type Db } from '@safehouse/db';
import { loadEnvFile } from '../src/dotenv.js';
import { closeDatabase } from '../src/shutdown.js';
import { AuthService, lanAddress, type CampaignOwnerSummary } from '../src/services/auth.js';

/** Long enough to walk to the other laptop, short enough to forget safely. */
const DEFAULT_MINUTES = 30;

export interface Cli {
  /** Campaign uuid, or a case-insensitive substring of its name. */
  campaign?: string;
  /** Origin the join URL is built against (default: this box's LAN address). */
  origin?: string;
  minutes: number;
  dataDir?: string;
  /** Print the campaigns and exit — mints nothing. */
  list: boolean;
  /** Skip the long-lived device token; print only the pairing URL. */
  pairOnly: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = { minutes: DEFAULT_MINUTES, list: false, pairOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--campaign':
      case '-c':
        cli.campaign = next();
        break;
      case '--origin':
        cli.origin = next().replace(/\/+$/, '');
        break;
      case '--minutes':
        cli.minutes = Number(next());
        break;
      case '--data-dir':
        cli.dataDir = next();
        break;
      case '--list':
        cli.list = true;
        break;
      case '--pair-only':
        cli.pairOnly = true;
        break;
      case '--help':
      case '-h':
        cli.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (!Number.isInteger(cli.minutes) || cli.minutes < 1 || cli.minutes > 60 * 24) {
    throw new Error('--minutes must be a whole number of minutes between 1 and 1440');
  }
  return cli;
}

/**
 * Exactly one campaign, or an error that says how to disambiguate. A uuid
 * matches by id; anything else is a case-insensitive name substring, because
 * the GM knows what the table is called and not what its uuid is — which is
 * the entire problem this script exists to solve.
 */
export function pickCampaign(
  all: CampaignOwnerSummary[],
  needle: string | undefined,
): CampaignOwnerSummary {
  if (all.length === 0) {
    throw new Error(
      'this database holds no campaigns — start one in the app (the first is unauthenticated), or run `pnpm seed:demo`',
    );
  }
  if (needle === undefined) {
    if (all.length === 1) return all[0]!;
    throw new Error(
      `this database holds ${all.length} campaigns — name one with --campaign, or list them with --list`,
    );
  }
  const lower = needle.toLowerCase();
  const byId = all.filter((c) => c.id.toLowerCase() === lower);
  const matches = byId.length > 0 ? byId : all.filter((c) => c.name.toLowerCase().includes(lower));
  if (matches.length === 0) throw new Error(`no campaign matches "${needle}" — try --list`);
  if (matches.length > 1) {
    throw new Error(
      `"${needle}" matches ${matches.length} campaigns (${matches.map((c) => c.name).join(', ')}) — pass the id instead`,
    );
  }
  return matches[0]!;
}

/** `postgres://user:***@host/db`, or where the PGlite directory is. */
export function describeTarget(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['DATABASE_URL'];
  if (url && url.length > 0) return `postgres ${url.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@')}`;
  return `pglite ${(env['DATA_DIR'] ?? './data').replace(/[\\/]+$/, '')}/pglite`;
}

/**
 * Where the printed join URL points. `WEB_ORIGIN` wins when it is set (a split
 * Vite dev setup, or a Compose stack published on a name), then this box's LAN
 * address — which is right when the script runs on the host and WRONG inside a
 * container, where it resolves to a bridge address no phone can reach. Hence
 * `--origin`, and the note printed alongside the URL.
 */
export function resolveOrigin(cli: Cli, env: NodeJS.ProcessEnv = process.env): string {
  if (cli.origin) return cli.origin;
  const web = env['WEB_ORIGIN']?.trim();
  if (web) return web.replace(/\/+$/, '');
  return `http://${lanAddress()}:${env['PORT'] ?? 8787}`;
}

function campaignLine(c: CampaignOwnerSummary): string {
  const played = c.lastPlayedAt ? `last played ${c.lastPlayedAt.slice(0, 10)}` : 'never played';
  return `  ${c.id}  ${c.name}  (GM ${c.gm.displayName}, ${played})`;
}

const USAGE = [
  'gm:token — mint a GM sign-in for an existing campaign, from the database.',
  '',
  '  --campaign <id|name>   which campaign (default: the only one)',
  '  --origin <url>         origin for the join URL (default: this box on the LAN)',
  '  --minutes <n>          pairing-code lifetime, 1–1440 (default 30)',
  '  --pair-only            print only the join URL, no long-lived token',
  '  --data-dir <path>      DATA_DIR override (ignored when DATABASE_URL is set)',
  '  --list                 print the campaigns and exit',
];

/**
 * The whole of the script bar argv parsing and process exit, so a test can call
 * it against a throwaway db and assert on what it minted rather than on stdout.
 */
export async function mintGmSignIn(
  db: Db,
  cli: Cli,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ lines: string[]; token?: string; code?: string; campaignId: string }> {
  const auth = new AuthService(db);
  const all = await auth.listCampaignsWithOwner();
  const campaign = pickCampaign(all, cli.campaign);
  const origin = resolveOrigin(cli, env);
  const lines: string[] = [];
  const say = (line = ''): number => lines.push(line);

  const invite = await auth.createGmPairingCode({
    campaignId: campaign.id,
    createdBy: campaign.gm.id,
    expiresInMinutes: cli.minutes,
  });

  say(`campaign  ${campaign.name}`);
  say(`GM        ${campaign.gm.displayName}`);
  say();
  say(`Open this in the GM's browser — single use, expires in ${cli.minutes} min:`);
  say();
  say(`    ${origin}/join/${invite.code}`);
  say();
  say('If that address is not the one the GM types, re-run with');
  say('--origin http://<the address they use>:8787 — only the origin changes,');
  say(`the code is ${invite.code}.`);

  let token: string | undefined;
  if (!cli.pairOnly) {
    const minted = await auth.mintGmDevice(campaign.id, { label: 'GM device (gm:token)' });
    token = minted.token;
    say();
    say('Or use the sign-in screen\'s "paste a token" tab — this one does not expire:');
    say();
    say(`    campaign  ${minted.campaignId}`);
    say(`    token     ${minted.token}`);
    say();
    say(`Revoke it later with POST /api/devices/${minted.deviceId}/revoke.`);
  }

  return {
    lines,
    campaignId: campaign.id,
    ...(token !== undefined ? { token } : {}),
    code: invite.code,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let cli: Cli;
  try {
    cli = parseArgs(argv);
  } catch (err) {
    console.error(`[gm:token] ${err instanceof Error ? err.message : String(err)}`);
    for (const line of USAGE) console.error(`[gm:token] ${line}`);
    return 1;
  }
  if (cli.help) {
    for (const line of USAGE) console.log(line);
    return 0;
  }

  // Compose passes real environment variables; a shell start has only the file
  // (see src/dotenv.ts). Non-overriding, so an explicit DATABASE_URL still wins.
  loadEnvFile();
  if (cli.dataDir !== undefined) process.env['DATA_DIR'] = cli.dataDir;

  console.log(`[gm:token] database: ${describeTarget()}`);
  const db = getDb();
  try {
    await ensureMigrations(db);
    const auth = new AuthService(db);

    if (cli.list) {
      const all = await auth.listCampaignsWithOwner();
      if (all.length === 0) {
        console.log('[gm:token] no campaigns in this database');
        return 0;
      }
      console.log(`[gm:token] ${all.length} campaign(s):`);
      for (const c of all) console.log(campaignLine(c));
      return 0;
    }

    const result = await mintGmSignIn(db, cli);
    console.log('');
    for (const line of result.lines) console.log(line);
    console.log('');
    return 0;
  } catch (err) {
    console.error(`[gm:token] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await closeDatabase(db);
  }
}

// Run only as a CLI; tests import the pieces above without side effects.
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('[gm:token] failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
