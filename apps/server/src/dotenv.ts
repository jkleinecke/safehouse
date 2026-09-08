/**
 * Load the repo-root `.env` into `process.env` for anything started from the
 * shell (`pnpm dev:server`, the seeders, the playthrough).
 *
 * There is ONE env file and it lives at the repo root. Compose reads the same
 * file on its own, because `compose.yaml` sits beside it. That is what retired
 * `infra/.env`: while the compose file lived in `infra/`, Compose took its
 * project directory from there and read `infra/.env` — never the root one —
 * and the two copies drifted until nobody could say which value was live. The
 * loader reads only the root file now, and warns by name if the old one is
 * still lying around (see `retiredEnvFiles`).
 *
 * Deliberately tiny and dependency-free, and deliberately NON-OVERRIDING: a
 * variable already present in the environment always wins, so compose, CI and
 * a one-off `LLM_BASE_URL=… pnpm dev:server` all keep priority over the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The one env file: `<repo>/.env`. */
export const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Where an env file used to be read from and no longer is. Anything found
 * here is worth a loud line at boot: a value edited there changes nothing,
 * and that is indistinguishable from "the .env file isn't working".
 */
export const RETIRED_ENV_FILES: readonly string[] = [
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

/** The retired locations that still have a file in them. */
export function retiredEnvFiles(files: readonly string[] = RETIRED_ENV_FILES): string[] {
  return files.filter((f) => existsSync(f));
}

/** The env file, if it defines `key`. Null means the process environment did. */
export function envFileFor(key: string, file: string = ENV_FILE): string | null {
  if (!existsSync(file)) return null;
  try {
    return key in parseEnvFile(readFileSync(file, 'utf8')) ? file : null;
  } catch {
    return null;
  }
}

/**
 * A URL safe to print. Strips `user:pass@` — some OpenAI-compatible setups put
 * a key there, and this string goes to a log the GM may well paste into a chat.
 */
export function redactUrl(url: string): string {
  return url.replace(new RegExp(String.raw`//[^/@]*@`), '//***@');
}

/**
 * Fill in anything the environment does not already define. Returns the keys
 * it actually set, so a caller can log them; a missing file is not an error.
 */
export function loadEnvFile(file: string = ENV_FILE): string[] {
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
