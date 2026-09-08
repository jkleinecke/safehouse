/**
 * Which build this is — the answer to "am I running the latest?".
 *
 * Nothing used to say. An image built a week ago and one built a minute ago
 * both report `ok: true`, serve the same URL and look identical in a browser,
 * so a GM who had just run `docker compose up` had no way to tell whether the
 * change they were testing was in the container at all.
 *
 * An image knows: the Dockerfile stamps `SAFEHOUSE_VERSION` (the short commit,
 * `-dirty` when uncommitted changes were built in) and `SAFEHOUSE_BUILT_AT`
 * into its environment at build time. A checkout asks git once at boot. Both
 * go out on `/healthz`, into the boot log, and into the SPA's own bundle, so
 * a browser holding a page from an older build can say so instead of quietly
 * misbehaving (see `apps/web/src/build.ts`).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface BuildInfo {
  /** Short commit, `-dirty` if the tree had uncommitted changes; `dev` when unknown. */
  version: string;
  /** When the image was built (ISO); null when running straight from a checkout. */
  builtAt: string | null;
  /** Where the answer came from. */
  source: 'image' | 'checkout' | 'unknown';
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Pure: env first (an image), then whatever `git` says (a checkout), then `dev`. */
export function buildInfoFrom(
  env: Record<string, string | undefined>,
  git: () => string | null,
): BuildInfo {
  const stamped = (env['SAFEHOUSE_VERSION'] ?? '').trim();
  if (stamped.length > 0) {
    const builtAt = (env['SAFEHOUSE_BUILT_AT'] ?? '').trim();
    return { version: stamped, builtAt: builtAt.length > 0 ? builtAt : null, source: 'image' };
  }
  const head = git();
  if (head !== null) return { version: head, builtAt: null, source: 'checkout' };
  return { version: 'dev', builtAt: null, source: 'unknown' };
}

/**
 * Short HEAD plus `-dirty`, or null when git or the repository is absent —
 * which is the normal case inside the image, where the env stamp answers
 * first and this is never reached.
 */
export function gitVersion(cwd: string = REPO_ROOT): string | null {
  try {
    // Piped, not inherited: a checkout without git prints nothing to the
    // console and simply answers null.
    const opts = { cwd, timeout: 3_000, encoding: 'utf8' as const, stdio: 'pipe' as const };
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], opts).trim();
    if (!/^[0-9a-f]{7,}$/.test(sha)) return null;
    const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], opts);
    return changed.trim().length > 0 ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

let cached: BuildInfo | null = null;

/** The running build, computed once. */
export function buildInfo(): BuildInfo {
  if (cached === null) cached = buildInfoFrom(process.env, gitVersion);
  return cached;
}
