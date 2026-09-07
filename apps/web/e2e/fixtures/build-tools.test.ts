/**
 * The harness can find the compilers it shells out to.
 *
 * pnpm does NOT hoist, so `<pkg>/node_modules/<tool>` is present for some
 * packages and absent for others on a perfectly normal install — `typescript`
 * resolves at the workspace root here and NOT under `apps/server`, which is
 * exactly the shape that already broke `viteBin` once with a MODULE_NOT_FOUND
 * at boot. A resolver that guesses one location is a boot failure waiting for
 * somebody else's machine, and it fails at the least useful moment: after the
 * suite has started, in a spec that has nothing to do with it.
 *
 * A VITEST file under `e2e/`, safe only because `playwright.config.ts` pins
 * `testMatch` to `*.spec.ts` — see the note in `port.test.ts`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_DIST, tscBin } from './harness.js';

describe('the build tools the harness shells out to', () => {
  it('finds a real tsc, wherever pnpm put it', () => {
    const bin = tscBin();
    expect(existsSync(bin)).toBe(true);
    // Resolved, not assumed: the whole point is that we looked.
    expect(bin.endsWith('tsc')).toBe(true);
  });

  it('knows where the built server it boots is meant to land', () => {
    expect(SERVER_DIST.endsWith(join('apps', 'server', 'dist', 'index.js'))).toBe(true);
  });
});
