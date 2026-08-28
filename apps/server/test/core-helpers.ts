/**
 * Shared helpers for the server-core test suite (test/core-*.test.ts).
 *
 * Every suite gets a throwaway on-disk PGlite under its own temp DATA_DIR
 * (BUILD_CONVENTIONS "Ports, env, database": never Docker, never the real
 * ./data). WS clients use Node 22's built-in WebSocket (no extra dep).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getDb, resetDbSingleton, type Db } from '@safehouse/db';
import { buildApp } from '../src/app.js';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  dataDir: string;
  close(): Promise<void>;
}

/**
 * Fresh temp DATA_DIR + throwaway PGlite (via getDb) + app (webDist disabled,
 * logger off). One per test file — vitest workers are separate processes, so
 * the getDb singleton never crosses suites.
 */
export async function makeTestApp(prefix: string): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), `safehouse-${prefix}-`));
  process.env.DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  resetDbSingleton();
  const db = getDb(); // PGlite at DATA_DIR/pglite
  const app = await buildApp({ db, webDist: false, logger: false });
  return {
    app,
    db,
    dataDir,
    async close() {
      await app.close();
      try {
        await (db as unknown as { $client: { close(): Promise<void> } }).$client.close();
      } catch {
        /* already closed */
      }
      resetDbSingleton();
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* Windows file-handle stragglers — temp dir, OS cleans up */
      }
    },
  };
}

export interface BootstrapResult {
  campaignId: string;
  gmToken: string;
  gmDeviceId: string;
  gmUserId: string;
}

/** POST /api/campaigns on an empty db → campaign + GM device token (FR1.1). */
export async function bootstrapCampaign(
  app: FastifyInstance,
  name = 'Neon Rain',
): Promise<BootstrapResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/campaigns',
    payload: { name, gmName: 'Whistler' },
  });
  if (res.statusCode !== 201) throw new Error(`bootstrap failed: ${res.statusCode} ${res.body}`);
  const body = res.json() as {
    campaignId: string;
    token: string;
    deviceId: string;
    user: { id: string };
  };
  return {
    campaignId: body.campaignId,
    gmToken: body.token,
    gmDeviceId: body.deviceId,
    gmUserId: body.user.id,
  };
}

export interface JoinResult {
  token: string;
  role: string;
  campaignId: string;
  deviceId: string;
  user: { id: string; displayName: string };
}

/** GM mints an invite, then redeems it via GET /join/:code (FR1.1/1.3). */
export async function joinAs(
  app: FastifyInstance,
  campaignId: string,
  gmToken: string,
  role: 'player' | 'observer' | 'display',
  name: string,
): Promise<JoinResult> {
  const inviteRes = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/invites`,
    headers: { authorization: `Bearer ${gmToken}` },
    payload: { role },
  });
  if (inviteRes.statusCode !== 201) {
    throw new Error(`invite failed: ${inviteRes.statusCode} ${inviteRes.body}`);
  }
  const { code } = inviteRes.json() as { code: string };
  const joinRes = await app.inject({
    method: 'GET',
    url: `/join/${code}?name=${encodeURIComponent(name)}`,
  });
  if (joinRes.statusCode !== 200) {
    throw new Error(`join failed: ${joinRes.statusCode} ${joinRes.body}`);
  }
  return joinRes.json() as JoinResult;
}

/** A parsed frame off the socket (persisted WsEvent or ephemeral message). */
export interface Frame {
  id?: number;
  type: string;
  payload?: unknown;
  visibility?: string;
  ownerUserId?: string;
  ephemeral?: boolean;
  [k: string]: unknown;
}

/**
 * Thin WS test client over Node's built-in WebSocket. Records every frame;
 * `next(pred)` resolves as soon as a matching frame exists (past or future).
 */
export class WsTestClient {
  readonly frames: Frame[] = [];
  closeCode: number | null = null;
  private readonly ws: WebSocket;
  private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
  private closeWaiters: Array<(code: number) => void> = [];

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (ev) => {
      const frame = JSON.parse(String(ev.data)) as Frame;
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
    this.ws.addEventListener('close', (ev) => {
      this.closeCode = ev.code;
      for (const w of this.closeWaiters) w(ev.code);
      this.closeWaiters = [];
    });
  }

  /** Connect and resolve on open (or on close, for auth-rejection tests). */
  static connect(url: string): Promise<WsTestClient> {
    return new Promise((resolve, reject) => {
      const client = new WsTestClient(url);
      const timer = setTimeout(() => reject(new Error(`ws connect timeout: ${url}`)), 8000);
      client.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.ws.addEventListener('close', () => {
        clearTimeout(timer);
        resolve(client); // rejected sockets still resolve; inspect closeCode
      });
      client.ws.addEventListener('error', () => {
        /* close follows; swallow so vitest doesn't see an unhandled error */
      });
    });
  }

  /** First frame matching `pred` (searches history, then waits). */
  next(pred: (f: Frame) => boolean, timeoutMs = 8000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ws frame timeout; got: ${JSON.stringify(this.frames.map((f) => f.type))}`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  /** Wait for the socket to close; resolves with the close code. */
  closed(timeoutMs = 8000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws close timeout')), timeoutMs);
      this.closeWaiters.push((code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  has(pred: (f: Frame) => boolean): boolean {
    return this.frames.some(pred);
  }

  send(obj: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.ws.close();
  }
}

/** ws:// URL for a listening app (host 127.0.0.1, ephemeral port). */
export function wsUrl(
  app: FastifyInstance,
  campaignId: string,
  token: string,
  lastEventId?: number,
): string {
  const address = app.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('app is not listening');
  const last = lastEventId !== undefined ? `&last_event_id=${lastEventId}` : '';
  return `ws://127.0.0.1:${address.port}/ws?campaign=${campaignId}&token=${token}${last}`;
}
