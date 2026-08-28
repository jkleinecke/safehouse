/**
 * Auth core (FR1.1–1.4, DESIGN.md §12/§13): QR-code join links minting
 * long-lived per-device bearer tokens; no passwords, no external IdP.
 *
 * - `POST /api/campaigns` — bootstrap: with zero campaigns in the db it
 *   creates campaign + GM user + GM device token unauthenticated; afterwards
 *   an authenticated user creates further campaigns (becoming their GM).
 * - `POST /api/campaigns/:id/invites` — GM-only, role-scoped, expiring codes.
 * - `GET  /join/:code` — mints a device + long-lived token; returns JSON
 *   `{ token, role, campaignId, user }` (the web app renders the pretty page).
 * - `GET  /api/campaigns/:id/join-qr` — `{ url, code, dataUrl }` against the
 *   server's LAN address (qrcode).
 * - `POST /api/devices/:id/revoke` — a lost phone is one tap to revoke.
 *
 * Tokens are random 256-bit values; only their sha256 hash is stored
 * (`devices.token_hash`). `Authorization: Bearer <token>` everywhere; `?token=`
 * accepted on /ws, /files and /read (see app.ts hook).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
// drizzle-orm is a declared @safehouse/server dependency (pinned to the same
// ^0.45.2 as @safehouse/db) for its query operators.
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { RoleSchema, type Role } from '@safehouse/contracts';
import { campaigns, devices, invites, memberships, users, type Db } from '@safehouse/db';

// ---------------------------------------------------------------------------
// Error envelope helper (§12: { error: { code, message, details? } })
// ---------------------------------------------------------------------------

export interface HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
}

/** Throwable error carrying status + envelope code (app.ts formats it). */
export function httpError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): HttpError {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Mint a long-lived device bearer token (256-bit, base64url). */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex — what `devices.token_hash` stores. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Unambiguous QR/join code alphabet (no 0/O/1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function mintJoinCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** First non-internal IPv4 address (the table's Wi-Fi), else 127.0.0.1. */
export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Auth context + service
// ---------------------------------------------------------------------------

/** Resolved from a device token; hangs off `req.auth`. */
export interface AuthContext {
  userId: string;
  deviceId: string;
  /** The campaign the device is bound to. */
  campaignId: string | null;
  role: Role;
  displayName: string;
}

export class AuthService {
  constructor(private readonly db: Db) {}

  /** Resolve a bearer token to its device/user context (null when invalid/revoked). */
  async resolveToken(token: string): Promise<AuthContext | null> {
    if (!token) return null;
    const rows = await this.db
      .select({ device: devices, user: users })
      .from(devices)
      .innerJoin(users, eq(devices.userId, users.id))
      .where(eq(devices.tokenHash, hashToken(token)))
      .limit(1);
    const row = rows[0];
    if (!row || row.device.revokedAt) return null;
    return {
      userId: row.user.id,
      deviceId: row.device.id,
      campaignId: row.device.campaignId,
      role: row.device.role,
      displayName: row.user.displayName,
    };
  }

  async campaignCount(): Promise<number> {
    const rows = await this.db.select({ n: sql<number>`count(*)::int` }).from(campaigns);
    return rows[0]?.n ?? 0;
  }

  /** Create campaign + GM membership + GM device for `gmUserId` (or a new user). */
  async createCampaign(opts: {
    name: string;
    gmName?: string;
    existingUserId?: string;
    deviceLabel?: string;
  }): Promise<{
    campaignId: string;
    token: string;
    deviceId: string;
    user: { id: string; displayName: string };
  }> {
    let userId = opts.existingUserId;
    let displayName = opts.gmName ?? 'GM';
    if (userId) {
      const row = (
        await this.db.select().from(users).where(eq(users.id, userId)).limit(1)
      )[0];
      if (!row) throw httpError(401, 'unauthorized', 'unknown user');
      displayName = row.displayName;
    } else {
      const inserted = await this.db.insert(users).values({ displayName }).returning();
      userId = inserted[0]!.id;
    }
    const campaign = (
      await this.db.insert(campaigns).values({ name: opts.name, gmUserId: userId }).returning()
    )[0]!;
    await this.db
      .insert(memberships)
      .values({ campaignId: campaign.id, userId, role: 'gm' })
      .onConflictDoNothing();
    const token = mintToken();
    const device = (
      await this.db
        .insert(devices)
        .values({
          userId,
          campaignId: campaign.id,
          role: 'gm',
          tokenHash: hashToken(token),
          label: opts.deviceLabel ?? "GM's device",
        })
        .returning()
    )[0]!;
    return { campaignId: campaign.id, token, deviceId: device.id, user: { id: userId, displayName } };
  }

  /** Role-scoped, expiring, optionally use-capped invite (FR1.3). */
  async createInvite(opts: {
    campaignId: string;
    role: Exclude<Role, 'gm'>;
    createdBy: string;
    expiresInMinutes?: number;
    maxUses?: number;
  }): Promise<{ code: string; role: Role; expiresAt: string | null }> {
    const minutes = opts.expiresInMinutes ?? 24 * 60;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const row = (
      await this.db
        .insert(invites)
        .values({
          campaignId: opts.campaignId,
          code: mintJoinCode(),
          role: opts.role,
          createdBy: opts.createdBy,
          maxUses: opts.maxUses ?? null,
          expiresAt,
        })
        .returning()
    )[0]!;
    return { code: row.code, role: row.role, expiresAt: row.expiresAt?.toISOString() ?? null };
  }

  /** `GET /join/:code` — mint user + membership + device token (FR1.1). */
  async redeemInvite(
    code: string,
    opts: { displayName?: string; deviceLabel?: string } = {},
  ): Promise<{
    token: string;
    role: Role;
    campaignId: string;
    deviceId: string;
    user: { id: string; displayName: string };
  }> {
    const invite = (
      await this.db.select().from(invites).where(eq(invites.code, code)).limit(1)
    )[0];
    if (!invite || invite.revokedAt) throw httpError(404, 'invite_not_found', 'unknown join code');
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw httpError(410, 'invite_expired', 'this join code has expired');
    }
    if (invite.maxUses != null && invite.uses >= invite.maxUses) {
      throw httpError(410, 'invite_exhausted', 'this join code has no uses left');
    }
    const displayName = opts.displayName?.trim() || 'Guest';
    const user = (await this.db.insert(users).values({ displayName }).returning())[0]!;
    // A display device is observer-grade in the membership table (§13).
    const membershipRole: 'gm' | 'player' | 'observer' =
      invite.role === 'player' ? 'player' : invite.role === 'gm' ? 'gm' : 'observer';
    await this.db
      .insert(memberships)
      .values({ campaignId: invite.campaignId, userId: user.id, role: membershipRole })
      .onConflictDoNothing();
    const token = mintToken();
    const device = (
      await this.db
        .insert(devices)
        .values({
          userId: user.id,
          campaignId: invite.campaignId,
          role: invite.role,
          tokenHash: hashToken(token),
          label: opts.deviceLabel ?? `${displayName}'s device`,
        })
        .returning()
    )[0]!;
    await this.db
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(eq(invites.id, invite.id));
    return {
      token,
      role: invite.role,
      campaignId: invite.campaignId,
      deviceId: device.id,
      user: { id: user.id, displayName: user.displayName },
    };
  }

  /** Revoke one device's token (FR1.3 — lost phone). Idempotent. */
  async revokeDevice(deviceId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(devices.id, deviceId), sql`${devices.revokedAt} is null`));
  }

  async getDevice(deviceId: string) {
    return (await this.db.select().from(devices).where(eq(devices.id, deviceId)).limit(1))[0];
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** 401 unless the request carries a valid device token. */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw httpError(401, 'unauthorized', 'authentication required');
  return req.auth;
}

/** 401/403 role guard (FR1.4, §13 capability matrix). */
export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthContext {
  const auth = requireAuth(req);
  if (roles.length > 0 && !roles.includes(auth.role)) {
    throw httpError(403, 'forbidden', `requires role: ${roles.join(' | ')}`);
  }
  return auth;
}

/** 403 unless the device is bound to `campaignId`. */
export function assertCampaign(auth: AuthContext, campaignId: string): void {
  if (auth.campaignId !== campaignId) {
    throw httpError(403, 'forbidden', 'device is not bound to this campaign');
  }
}

// ---------------------------------------------------------------------------
// Routes + fastify wiring (called directly on the root instance from app.ts)
// ---------------------------------------------------------------------------

const CreateCampaignBody = z.object({
  name: z.string().min(1).max(200),
  gmName: z.string().min(1).max(100).optional(),
});

const CreateInviteBody = z.object({
  role: RoleSchema.exclude(['gm']).default('player'),
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 365).optional(),
  maxUses: z.number().int().min(1).optional(),
});

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Registers core auth routes and guard decorators on the ROOT instance
 * (plain function call, not `app.register`, so decorators reach every plugin).
 * The request-auth resolution hook itself lives in app.ts.
 */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  // Bootstrap / create campaign (FR1.1).
  app.post('/api/campaigns', async (req, reply) => {
    const body = parseBody(CreateCampaignBody, req.body);
    const count = await auth.campaignCount();
    let existingUserId: string | undefined;
    if (count > 0) {
      existingUserId = requireAuth(req).userId;
    }
    const created = await auth.createCampaign({
      name: body.name,
      ...(body.gmName ? { gmName: body.gmName } : {}),
      ...(existingUserId ? { existingUserId } : {}),
    });
    return reply.status(201).send({
      campaignId: created.campaignId,
      role: 'gm' as const,
      token: created.token,
      deviceId: created.deviceId,
      user: created.user,
    });
  });

  // Role-scoped, expiring invite codes (FR1.3) — GM only, own campaign only.
  app.post('/api/campaigns/:id/invites', async (req, reply) => {
    const authCtx = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(authCtx, id);
    const body = parseBody(CreateInviteBody, req.body);
    const invite = await auth.createInvite({
      campaignId: id,
      role: body.role,
      createdBy: authCtx.userId,
      ...(body.expiresInMinutes !== undefined ? { expiresInMinutes: body.expiresInMinutes } : {}),
      ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
    });
    return reply.status(201).send({ ...invite, url: joinUrl(app, invite.code) });
  });

  // QR against the server's LAN address (FR1.1) — GM only.
  app.get('/api/campaigns/:id/join-qr', async (req, reply) => {
    const authCtx = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(authCtx, id);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const roleParsed = RoleSchema.exclude(['gm']).safeParse(q['role'] ?? 'player');
    if (!roleParsed.success) throw httpError(400, 'bad_request', 'invalid role');
    const invite = await auth.createInvite({
      campaignId: id,
      role: roleParsed.data,
      createdBy: authCtx.userId,
    });
    const url = joinUrl(app, invite.code);
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 512 });
    return reply.send({ url, code: invite.code, role: invite.role, dataUrl });
  });

  // QR join → device token (FR1.1). JSON; the web app owns the pretty page.
  app.get('/join/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const q = (req.query ?? {}) as Record<string, unknown>;
    const displayName = typeof q['name'] === 'string' ? q['name'] : undefined;
    const deviceLabel = typeof q['label'] === 'string' ? q['label'] : undefined;
    const joined = await auth.redeemInvite(code.toUpperCase(), {
      ...(displayName ? { displayName } : {}),
      ...(deviceLabel ? { deviceLabel } : {}),
    });
    return reply.send(joined);
  });

  // Revoke a lost phone (FR1.3) — the campaign's GM, or the device's own user.
  app.post('/api/devices/:id/revoke', async (req, reply) => {
    const authCtx = requireAuth(req);
    const { id } = req.params as { id: string };
    const device = await auth.getDevice(id);
    if (!device) throw httpError(404, 'not_found', 'unknown device');
    const isSelf = device.userId === authCtx.userId;
    const isGmOfCampaign =
      authCtx.role === 'gm' && device.campaignId != null && device.campaignId === authCtx.campaignId;
    if (!isSelf && !isGmOfCampaign) {
      throw httpError(403, 'forbidden', 'only the GM or the device owner may revoke');
    }
    await auth.revokeDevice(id);
    return reply.send({ revoked: true, deviceId: id });
  });
}

/** Join URL players' phones can reach: the server's LAN address (§8 auth row). */
function joinUrl(app: FastifyInstance, code: string): string {
  const address = app.server.address();
  const port =
    typeof address === 'object' && address !== null
      ? address.port
      : Number(process.env.PORT ?? 8787);
  return `http://${lanAddress()}:${port}/join/${code}`;
}
