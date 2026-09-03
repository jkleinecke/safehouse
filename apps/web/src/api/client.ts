/**
 * Fetch wrapper for the Safehouse REST API (DESIGN.md §12).
 * - Bearer token from the localStorage session (BUILD_CONVENTIONS "Auth").
 * - Canonical error envelope `{ error: { code, message, details? } }`.
 * - A 401 retires the token that earned it (see `SESSION_EXPIRED_EVENT`).
 */
import { QueryClient } from '@tanstack/react-query';
import { clearSessionForToken, getToken } from './session.js';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-serialised unless it is FormData. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the Authorization header (the join endpoint mints the token). */
  anonymous?: boolean;
  /**
   * Leave stored sessions alone on a 401. For the two calls that *expect* one:
   * proving a pasted token before it is stored, and the loopback GM recovery
   * probe, which refuses on every device that is not the server's own machine.
   */
  keepSessionOn401?: boolean;
}

/**
 * A stored token the server has rejected.
 *
 * `getSession()` is pure storage — it cannot tell a live token from a revoked
 * one, so before this the app rendered the whole GM shell under a dead token
 * and 401'd every call in silence, with no way back but a menu item nobody
 * knew to look for. The wrapper now retires the exact token that failed (never
 * the role, never another campaign's session) and says so once; the shell
 * listens and returns that tab to the front door.
 */
export const SESSION_EXPIRED_EVENT = 'safehouse:session-expired';

export interface SessionExpiredDetail {
  /** The token that was rejected — compare before reacting. */
  token: string;
  /** The request that found out. */
  path: string;
}

function announceExpiry(detail: SessionExpiredDetail): void {
  // Not a DOM in sight during unit tests, and `CustomEvent` is not in node's
  // globals on every version we run on — a missing listener is not a failure.
  if (typeof globalThis.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  try {
    globalThis.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail }));
  } catch {
    // ignore
  }
}

/** The token this request actually carried, whoever supplied it. */
function bearerOf(headers: Record<string, string>): string | null {
  const value = headers['Authorization'];
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isErrorEnvelope(v: unknown): v is { error: { code: string; message: string; details?: unknown } } {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

/** Core request helper. `path` is app-relative, e.g. `/api/campaigns/abc`. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = opts.anonymous ? null : getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : 'Network error');
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.keepSessionOn401) {
      const sent = bearerOf(headers);
      if (sent) {
        clearSessionForToken(sent);
        announceExpiry({ token: sent, path });
      }
    }
    if (isErrorEnvelope(json)) {
      const { code, message, details } = json.error;
      throw new ApiError(res.status, code, message, details);
    }
    throw new ApiError(res.status, `http_${res.status}`, res.statusText || `HTTP ${res.status}`);
  }

  return json as T;
}

export const apiGet = <T>(path: string, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(path, { ...opts, method: 'GET' });

export const apiPost = <T>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(path, { ...opts, method: 'POST', body });

export const apiPatch = <T>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(path, { ...opts, method: 'PATCH', body });

/**
 * Whole-resource replacement, as distinct from `apiPatch`'s merge.
 *
 * The difference is load-bearing for ordered lists: "remove the middle floor"
 * cannot be expressed as a patch without inventing ids for positions, so those
 * endpoints take the whole list and PUT says so.
 */
export const apiPut = <T>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(path, { ...opts, method: 'PUT', body });

export const apiDelete = <T>(path: string, opts?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(path, { ...opts, method: 'DELETE' });

/** Shared TanStack Query client (provided in App.tsx). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});
