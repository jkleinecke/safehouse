/**
 * GET /healthz — unauthenticated, and it carries the server's build stamp.
 *
 * Plain `fetch` rather than `apiGet`: no token is needed, and this is asked
 * from the front door where there may be no session at all. A failure here
 * must not retire anything.
 */
import { useQuery } from '@tanstack/react-query';

export interface ServerBuild {
  ok: boolean;
  ts: string;
  /** Short commit (`-dirty` if built from uncommitted changes); `dev` when unknown. */
  version: string;
  /** ISO time the image was built; null when the server runs from a checkout. */
  builtAt: string | null;
  source: 'image' | 'checkout' | 'unknown';
}

export async function fetchServerBuild(): Promise<ServerBuild> {
  const res = await fetch('/healthz', { cache: 'no-store' });
  if (!res.ok) throw new Error(`healthz ${res.status}`);
  return (await res.json()) as ServerBuild;
}

export function useServerBuild() {
  return useQuery({
    queryKey: ['healthz'],
    queryFn: fetchServerBuild,
    retry: 0,
    staleTime: 60_000,
    // A tab left open across a `pnpm docker:up` notices within minutes.
    refetchInterval: 5 * 60_000,
  });
}
