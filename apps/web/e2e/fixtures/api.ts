/**
 * A three-line REST client for the E2E harness.
 *
 * The specs drive the *browser*; this exists only to ARRANGE the world before a
 * page ever loads (a roll already in the log, a fight already staged) and to
 * ASSERT against the server's own record afterwards — the third leg of the
 * pool-parity check. It deliberately shares nothing with the SPA's own client:
 * if `apps/web/src/api/client.ts` breaks, these specs must still be able to say
 * what the server actually held.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 400)}`);
    this.name = 'HttpError';
  }
}

export interface ApiOptions {
  token?: string;
  body?: unknown;
  /** Accept a non-2xx answer and hand it back instead of throwing. */
  allowStatus?: number[];
}

export class Api {
  constructor(readonly baseUrl: string) {}

  async request<T>(method: string, path: string, opts: ApiOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok && !(opts.allowStatus ?? []).includes(res.status)) {
      throw new HttpError(res.status, method, path, text);
    }
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  get<T>(path: string, token?: string): Promise<T> {
    return this.request<T>('GET', path, token ? { token } : {});
  }

  post<T>(path: string, body: unknown, token?: string): Promise<T> {
    return this.request<T>('POST', path, { body, ...(token ? { token } : {}) });
  }

  patch<T>(path: string, body: unknown, token?: string): Promise<T> {
    return this.request<T>('PATCH', path, { body, ...(token ? { token } : {}) });
  }

  /** Raw fetch, for the specs that care about status codes and content types. */
  raw(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, init);
  }
}

// ---------------------------------------------------------------------------
// The slices of the server's payloads these specs actually read
// ---------------------------------------------------------------------------

export interface JoinAnswer {
  token: string;
  role: string;
  campaignId: string;
  deviceId: string;
  user?: { id: string; displayName: string };
}

export interface ProvenanceLine {
  label: string;
  value: number;
  source?: string;
}

export interface PersistedRoll {
  id: string;
  faces: number[];
  hits: number;
  visibility: string;
  createdAt: string;
  actor?: { characterId?: string };
  request: {
    pool: number;
    breakdown: ProvenanceLine[];
    limit?: { kind: string; value: number };
    meta?: Record<string, unknown>;
  };
}

export interface DerivedPool {
  total: number;
  breakdown: ProvenanceLine[];
  limit?: { kind: string; value: number };
}
