/**
 * `pnpm --filter @safehouse/web e2e` — the guarded entry point.
 *
 * CI must not go red because a machine has no browser binary: the E2E suite is
 * an *additional* check, and `pnpm install` alone does not download chromium.
 * So this refuses to fail on a missing browser — it says what is missing, how
 * to get it, and exits 0. Everything else (a real spec failure, a server that
 * will not boot) propagates normally.
 *
 *   node e2e/run.mjs                # skip if chromium is absent
 *   node e2e/run.mjs --require      # fail if chromium is absent
 *   node e2e/run.mjs <playwright args…>
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const require_ = args.includes('--require') || process.env.SAFEHOUSE_E2E_REQUIRE === '1';
const passthrough = args.filter((a) => a !== '--require');

let executable = null;
let probeError = null;
try {
  const { chromium } = await import('@playwright/test');
  executable = chromium.executablePath();
} catch (err) {
  probeError = err;
}

if (!executable || !existsSync(executable)) {
  const why = probeError
    ? `playwright could not be loaded (${probeError.message})`
    : `no chromium at ${executable}`;
  const message =
    `e2e: skipping the browser suite — ${why}.\n` +
    `     Install it once with: pnpm --filter @safehouse/web e2e:install`;
  if (require_) {
    console.error(message.replace('skipping', 'cannot run'));
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const child = spawn(process.execPath, [cli, 'test', ...passthrough], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', (err) => {
  console.error(`e2e: could not start playwright — ${err.message}`);
  process.exit(1);
});
