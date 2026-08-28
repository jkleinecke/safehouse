/**
 * Fetch wrapper for the Safehouse REST API (DESIGN.md §12).
 * - Bearer token from the localStorage session (BUILD_CONVENTIONS "Auth").
 * - Canonical error envelope `{ error: { code, message, details? } }`.
 */
import { QueryClient } from '@tanstack/react-query';
import { getToken } from './session.js';

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
