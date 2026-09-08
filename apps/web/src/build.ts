/**
 * The build this bundle came from, baked in by Vite (`define` in
 * vite.config.ts) from the same stamp the server carries in its environment:
 * the short commit, `-dirty` when uncommitted changes were built in, and the
 * time the image was built. `dev` when nothing was known.
 *
 * The server's answer to the same question is `/healthz`. The footer compares
 * the two (see `components/shell/BuildBadge.tsx`), because a tab left open
 * across a rebuild keeps running the old bundle against the new server, and
 * that is the one mismatch a reload fixes and nothing else explains.
 */
declare const __SAFEHOUSE_VERSION__: string | undefined;
declare const __SAFEHOUSE_BUILT_AT__: string | undefined;

export interface ClientBuild {
  version: string;
  builtAt: string | null;
}

const stamped = (value: string | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const CLIENT_BUILD: ClientBuild = {
  // `typeof` on an undeclared global is safe, which is what keeps vitest —
  // which does not run the Vite config — from throwing here.
  version: stamped(typeof __SAFEHOUSE_VERSION__ === 'undefined' ? undefined : __SAFEHOUSE_VERSION__) ?? 'dev',
  builtAt: stamped(typeof __SAFEHOUSE_BUILT_AT__ === 'undefined' ? undefined : __SAFEHOUSE_BUILT_AT__),
};

/** The commit without its `-dirty` flag: two builds of one commit are one build. */
export function commitOf(version: string): string {
  return version.endsWith('-dirty') ? version.slice(0, -'-dirty'.length) : version;
}
