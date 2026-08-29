/**
 * Cross-process durability: seed in one process, exit, serve from another.
 *
 * This is the hole the whole suite had. Every other server suite calls
 * `makeTestApp`, which sets `DATA_DIR` to a throwaway directory and opens it
 * with `getDb()` IN THE SAME PROCESS — so nothing ever wrote a durable PGlite
 * directory, let go of it, reopened it somewhere else and appended. The one
 * real user flow (`pnpm seed:demo` && `pnpm dev:server`) was therefore the one
 * flow no test covered, which is why "the shared log is frozen on a seeded
 * campaign" could be reported against a green suite.
 *
 * So: run the REAL seeder as a child process, let it exit, then reopen its
 * directory in a SECOND child process and drive the reported path — POST a
 * roll, read it back from `GET /api/campaigns/:id/log`. The vitest process
 * itself never opens the directory: PGlite is single-writer, and a second
 * opener does not error, it hangs.
 *
 * It also pins the hand-over state. An unclean exit leaves the directory to be
 * WAL-recovered by whoever opens it next, and recovery restarts each bigserial
 * ~32 values ahead of its rows (`SEQ_LOG_VALS`): before `closeDatabase` was
 * wired into the seeder this directory reopened with 21 events and a sequence
 * of 33. `last_value === max(id)` is the cheapest possible proof that the
 * seeder actually checkpointed and closed before calling `process.exit`.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');
const REOPEN_PROBE = fileURLToPath(new URL('./fixtures/reopen-probe.ts', import.meta.url));
const CAMPAIGN_NAME = 'Static on the Line';

interface RunResult {
  code: number | null;
  out: string;
}

function runScript(script: string, env: Record<string, string>, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, script], {
      cwd: join(REPO_ROOT, 'apps', 'server'),
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
      resolve({ code, out });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: `${out}\n${String(err)}` });
    });
  });
}

interface Probe {
  campaignId: string;
  seqLastValue: number | null;
  maxEventId: number | null;
  eventCount: number | null;
  logBefore: number;
  logAfter: number;
  rollStatus: number;
  rollError: string | null;
  listedRolls: number;
  rollRowCount: number | null;
  rollCreatedEvents: number | null;
}

let dataDir: string;
let seeded: RunResult;
let gmToken: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'safehouse-durability-'));
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows handle stragglers — it is a temp dir, the OS cleans up */
  }
});

it(
  'seed in one process, exit, then append and read back in another',
  async () => {
    // --- process 1: the real seeder, which then exits -----------------------
    seeded = await runScript(SEED_DEMO, { DATA_DIR: dataDir, DATABASE_URL: '' }, 240_000);
    expect(seeded.code, `seed:demo failed:\n${seeded.out}`).toBe(0);

    // `  gm       Demo GM  <token>` — the seeder's own hand-off to a human.
    const tokenMatch = /^\s*gm\s+Demo GM\s+(\S+)\s*$/m.exec(seeded.out);
    expect(tokenMatch, `no GM token in seeder output:\n${seeded.out}`).not.toBeNull();
    gmToken = tokenMatch![1]!;

    // --- process 2: the server's turn with that directory -------------------
    const probed = await runScript(
      REOPEN_PROBE,
      {
        DATA_DIR: dataDir,
        DATABASE_URL: '',
        PROBE_TOKEN: gmToken,
        PROBE_CAMPAIGN_NAME: CAMPAIGN_NAME,
      },
      240_000,
    );
    expect(probed.code, `reopen probe failed:\n${probed.out}`).toBe(0);
    const line = /^PROBE (.+)$/m.exec(probed.out);
    expect(line, `no PROBE line:\n${probed.out}`).not.toBeNull();
    const probe = JSON.parse(line![1]!) as Probe;

    // The seeder emitted events through the normal service path, so the
    // reopened directory must actually contain them.
    expect(probe.campaignId).not.toBe('');
    expect(probe.eventCount).toBeGreaterThan(0);
    expect(probe.logBefore).toBe(probe.eventCount);

    // The seeder closed cleanly: no WAL recovery, so no ~32-value sequence jump.
    expect(probe.seqLastValue).toBe(probe.maxEventId);

    // The reported failure: every append 500s on a seeded campaign.
    expect(probe.rollStatus, `roll rejected: ${probe.rollError ?? ''}`).toBe(201);

    // And the roll reaches the shared log rather than only the `rolls` table —
    // the half-commit showed up exactly as "listed under /rolls, absent from
    // /log for ever".
    expect(probe.logAfter).toBe(probe.logBefore + 1);
    expect(probe.listedRolls).toBe(1);
    expect(probe.rollRowCount).toBe(1);
    expect(probe.rollCreatedEvents).toBe(1);
  },
  300_000,
);
