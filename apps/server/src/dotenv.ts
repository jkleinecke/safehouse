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
 * Which file each key would come from, and where two files disagree.
 *
 * The trap this exists for: there are two legitimate `.env` locations and the
 * loader is non-overriding, so the repo root silently beats `infra/.env` for
 * every key both define. Edit the wrong one and nothing happens — no error, no
 * warning, and the app keeps using a value you can no longer see anywhere on
 * screen. That is indistinguishable from "the .env file isn't working", and it
 * cost a real debugging session.
 *
 * Key names only, never values: these files hold SESSION_SECRET and the
 * database password, and a diagnostic that leaks them into the log is worse
 * than the confusion it solves.
 */
export interface EnvConflict {
  key: string;
  /** The file that wins, then the one shadowed by it. */
  winner: string;
  shadowed: string;
}

export function envFileConflicts(files: readonly string[] = ENV_FILES): EnvConflict[] {
  const seen = new Map<string, { file: string; value: string }>();
  const out: EnvConflict[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, { file, value });
      } else if (first.value !== value) {
        // Same key, different value, two files. Exactly the silent-shadow case.
        out.push({ key, winner: first.file, shadowed: file });
      }
    }
  }
  return out;
}

/** Which of the env files defines `key`, in win order. Null if none does. */
export function envFileFor(key: string, files: readonly string[] = ENV_FILES): string | null {
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      if (key in parseEnvFile(readFileSync(file, 'utf8'))) return file;
    } catch {
      continue;
    }
  }
  return null;
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
