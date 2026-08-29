/**
 * Playwright global setup: build the SPA if it is stale, seed a throwaway
 * campaign, boot the real server, arrange a table mid-session, and hand the
 * result to the workers through a JSON file.
 *
 * Returning a function makes it the global teardown, so the server handle and
 * the temp `DATA_DIR` never have to leave this closure.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './harness';
import { WORLD_ENV } from './world';

export const E2E_PORT = Number(process.env.SAFEHOUSE_E2E_PORT ?? 8791);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

async function portIsFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return false;
  } catch {
    return true;
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const log = (s: string) => console.log(s);

  if (!(await portIsFree(E2E_PORT))) {
    throw new Error(
      `e2e: something is already listening on :${E2E_PORT}. Stop it, or set SAFEHOUSE_E2E_PORT.`,
    );
  }

  const booted = await boot(E2E_PORT, log);

  const dir = mkdtempSync(join(tmpdir(), 'safehouse-e2e-world-'));
  const file = join(dir, 'world.json');
  writeFileSync(file, JSON.stringify(booted.world, null, 2));
  process.env[WORLD_ENV] = file;

  return async () => {
    await booted.stop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir */
    }
  };
}
