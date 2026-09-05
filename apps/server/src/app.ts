/**
 * Fastify app builder (DESIGN.md §7/§12; BUILD_CONVENTIONS "Server
 * architecture"). Exported for tests; `src/index.ts` boots it on PORT (8787).
 *
 * Wiring: cookie + multipart + websocket + static (serves apps/web/dist in
 * prod when present), db via getDb() + ensureMigrations on boot, the WS hub
 * (§11) on /ws, core auth routes, and one plugin per domain from
 * src/plugins/index.ts. Pino stays quiet under vitest.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { ensureMigrations, getDb, type Db } from '@safehouse/db';
import { Hub } from './hub.js';
import { AuthService, registerAuthRoutes, type AuthContext } from './services/auth.js';
import { registerPlugins } from './plugins/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle handle (PGlite or node-postgres — @safehouse/db). */
    db: Db;
    /** WS hub: rooms, emit/emitEphemeral, onCommand, replay (§11). */
    hub: Hub;
    /** Token minting/resolution, invites, devices (FR1.1–1.4). */
    authService: AuthService;
  }
  interface FastifyRequest {
    /** Resolved device-token context; null when unauthenticated. */
    auth: AuthContext | null;
  }
}

export interface BuildAppOptions {
  /** Injected db (tests pass a throwaway PGlite); defaults to getDb(). */
  db?: Db;
  /** Fastify logger option; defaults to quiet under vitest, pino info otherwise. */
  logger?: FastifyServerOptions['logger'];
  /** Web build dir to serve; `false` disables, default apps/web/dist if present. */
  webDist?: string | false;
}

/** Paths where a bearer token is also accepted as `?token=` (WS/files/read). */
const QUERY_TOKEN_PREFIXES = ['/ws', '/files', '/read'];

function tokenFrom(req: { headers: Record<string, unknown>; url: string; query: unknown }): string | null {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  if (QUERY_TOKEN_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}?`) || req.url.startsWith(`${p}/`))) {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (typeof q['token'] === 'string') return q['token'];
  }
  return null;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const underTest = process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;
  const app = Fastify({
    logger: opts.logger ?? (underTest ? false : { level: process.env.LOG_LEVEL ?? 'info' }),
  });

  // --- db: getDb + ensureMigrations on boot -------------------------------
  const db = opts.db ?? getDb();
  await ensureMigrations(db);
  app.decorate('db', db);

  // --- services -----------------------------------------------------------
  const hub = new Hub(db, app.log);
  app.decorate('hub', hub);
  const authService = new AuthService(db);
  app.decorate('authService', authService);

  // --- core fastify plugins -----------------------------------------------
  const secret = process.env.SESSION_SECRET;
  await app.register(fastifyCookie, secret ? { secret } : {});
  // 25 MB a file. The default is Fastify's 1 MiB `bodyLimit`, which silently
  // rejected any photo off a phone — the exact file a player reaches for when
  // asked for a portrait, and a limit that presented as "nothing happened".
  // Generous rather than tight on purpose: this is a GM's own laptop serving
  // their own table, and a battlemap scan is legitimately large.
  await app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyWebsocket);

  // --- request auth resolution (Bearer, or ?token= on /ws /files /read) ---
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const token = tokenFrom(req);
    req.auth = token ? await authService.resolveToken(token) : null;
  });

  // --- error envelope (§12) ----------------------------------------------
  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = (err ?? {}) as {
      statusCode?: unknown;
      code?: unknown;
      details?: unknown;
      message?: unknown;
      expose?: unknown;
    };
    const statusCode = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500;
    if (statusCode >= 500) app.log.error(err);
    // A 5xx `code` is normally collapsed to `internal`: an exception out of a
    // driver must never turn its own `code` into API surface. An error built by
    // `httpError` is different — somebody chose that envelope, and the web app
    // switches on codes like `ai_disabled` / `ai_unreachable` to tell "the
    // Fixer is off" from "the box is down". `expose` keeps those intact.
    const deliberate = e.expose === true && typeof e.code === 'string' && e.code.length > 0;
    const code = deliberate
      ? (e.code as string)
      : typeof e.code === 'string' && e.code.length > 0 && statusCode < 500
        ? e.code
        : statusCode >= 500
          ? 'internal'
          : 'bad_request';
    const message =
      typeof e.message === 'string' && e.message.length > 0 ? e.message : 'internal error';
    void reply.status(statusCode).send({
      error: {
        code,
        message,
        ...(e.details !== undefined ? { details: e.details } : {}),
      },
    });
  });

  // --- health -------------------------------------------------------------
  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));

  // --- core auth routes (bootstrap, invites, join, QR, revoke) ------------
  registerAuthRoutes(app, authService);

  // --- WS: /ws?campaign=&token=[&last_event_id=] (§11) --------------------
  app.get('/ws', { websocket: true }, (socket, req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const campaignId = typeof q['campaign'] === 'string' ? q['campaign'] : null;
    const auth = req.auth;
    if (!campaignId || !auth || auth.campaignId !== campaignId) {
      socket.send(
        JSON.stringify({
          type: 'error',
          payload: { code: 'unauthorized', message: 'valid ?campaign= and token required' },
          ephemeral: true,
        }),
      );
      socket.close(4401, 'unauthorized');
      return;
    }
    const client = hub.joinRoom(socket, campaignId, {
      userId: auth.userId,
      role: auth.role,
      deviceId: auth.deviceId,
      displayName: auth.displayName,
    });
    socket.send(
      JSON.stringify({
        type: 'hello',
        payload: { campaignId, userId: auth.userId, role: auth.role },
        ephemeral: true,
      }),
    );
    const rawLast = q['last_event_id'] ?? q['lastEventId'];
    if (typeof rawLast === 'string' && rawLast.length > 0) {
      void hub.replaySince(client, Number(rawLast)).catch((err) => {
        app.log.error(err, 'ws replay failed');
      });
    }
  });

  // --- static web build (prod) --------------------------------------------
  const defaultWebDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const webRoot =
    opts.webDist === false ? null : (opts.webDist ?? (existsSync(defaultWebDist) ? defaultWebDist : null));
  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/', wildcard: true });
  }
  // `/join/:code` is deliberately absent: it is an SPA route (the QR target),
  // and the token-minting endpoint moved to `/api/join/:code` (LIVE-3). Keeping
  // `/join` here would 404 the join screen in production instead of serving it.
  const API_PREFIXES = ['/api', '/ws', '/files', '/read', '/healthz'];
  app.setNotFoundHandler((req, reply) => {
    const spaEligible =
      webRoot !== null &&
      req.method === 'GET' &&
      !API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
    if (spaEligible) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: `route ${req.method} ${req.url} not found` } });
  });

  // --- domain plugins (every one is built; the list is plugins/index.ts) --
  await app.register(registerPlugins);

  return app;
}

// Re-exports for feature-agent convenience (one import site for guards).
export { httpError, requireAuth, requireRole, assertCampaign } from './services/auth.js';
