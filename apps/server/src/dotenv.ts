/**
 * Load the repo-root `.env` into `process.env` for anything started from the
 * shell (`pnpm dev:server`, the seeders, the playthrough).
 *
 * Compose passes its own `--env-file`, so containers already have real
 * environment variables. Nothing outside a container did: `.env` was read by
 * `docker compose` alone, so a GM who set `LLM_BASE_URL` in the documented
 * place and ran `pnpm dev:server` got a Fixer that still reported itself
 * switched off, with no hint as to why.
 *
 * Deliberately tiny and dependency-free, and deliberately NON-OVERRIDING: a
 * variable already present in the environment always wins, so compose, CI and
 * a one-off `LLM_BASE_URL=… pnpm dev:server` all keep priority over the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Both places an env file legitimately lives, in priority order.
 *
 * `infra/.env` is second because Compose treats the compose file's directory
 * as the project directory: with `-f infra/docker-compose.yml` it auto-reads
 * `infra/.env` and never the repo root, so a GM who followed that path has
 * their settings there. Shell starts should honour either without being told
 * which one they picked.
 */
const ENV_FILES = [
  fileURLToPath(new URL('../../../.env', import.meta.url)),
  fileURLToPath(new URL('../../../infra/.env', import.meta.url)),
];

/** Parse `KEY=value` lines: `#` comments, blanks, `export ` prefixes, quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes; leave inner characters alone.
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value.charAt(0);
      if (value.endsWith(quote)) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Fill in anything the environment does not already define. Returns the keys
 * it actually set, so a caller can log them; missing file is not an error.
 */
export function loadEnvFile(file?: string): string[] {
  if (file === undefined) return ENV_FILES.flatMap((f) => loadEnvFile(f));
  if (!existsSync(file)) return [];
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(file, 'utf8'));
  } catch {
    // An unreadable .env must never stop the table from playing (Principle 5).
    return [];
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
