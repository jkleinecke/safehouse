/**
 * Auth core (FR1.1–1.4, DESIGN.md §12/§13): QR-code join links minting
 * long-lived per-device bearer tokens; no passwords, no external IdP.
 *
 * - `POST /api/campaigns` — bootstrap: with zero campaigns in the db it
 *   creates campaign + GM user + GM device token unauthenticated; afterwards
 *   an authenticated user creates further campaigns (becoming their GM).
 * - `POST /api/campaigns/:id/invites` — GM-only, role-scoped, expiring codes.
 * - `GET|POST /api/join/:code` — mints a device + long-lived token; returns
 *   JSON `{ token, role, campaignId, user }`.
 * - `GET  /api/campaigns/:id/join-qr` — `{ url, code, dataUrl }` against the
 *   server's LAN address (qrcode).
 * - `POST /api/devices/:id/revoke` — a lost phone is one tap to revoke.
 *
 * LIVE-3: the redemption endpoint lives under `/api/` and NOWHERE ELSE.
 * `/join/:code` is the SPA route the QR encodes — when the same path was also
 * an API route, scanning the QR handed the player raw JSON instead of the join
 * screen. One path, one owner: `/join/:code` is the web app's, `/api/join/:code`
 * is the server's.
 *
 * GM identity (FR1.1/1.2) is minted or granted in these ways and no other.
 * The count used to read "three"; it was wrong, and an undercount here is how a
 * privilege path goes unreviewed, so it is spelled out:
 *
 *   1. the bootstrap `POST /api/campaigns` (unauthenticated only while the
 *      campaigns table is empty; afterwards any signed-in user, who becomes the
 *      GM of the NEW campaign and of nothing else);
 *   2. `POST /api/campaigns/:id/gm-device` — a second device for the same GM;
 *   3. `POST /api/campaigns/:id/gm-pair` → `/api/join/:code` — a short-lived
 *      pairing code, redeemed onto the SAME GM identity;
 *   4. `POST /api/campaigns/:id/transfer-ownership` — not minting but
 *      promotion: the incoming member's existing devices become `gm` and the
 *      outgoing owner's are demoted (`src/plugins/campaigns-admin.ts`);
 *   5. `POST /api/gm/recover` — no secret at all, but ONLY from a raw socket
 *      address on the loopback interface, i.e. a browser on the machine hosting
 *      the server (`assertLoopbackOrigin` below, route in `plugins/auth.ts`);
 *   6. the admin CLI `pnpm gm:token` (`scripts/gm-token.ts`), which talks to the
 *      database directly. Whoever can run it already has a shell on the box that
 *      owns the data, so it adds no trust boundary — it only saves them from
 *      writing the INSERT by hand.
 *
 * 2–6 all bind to the campaign's EXISTING owner: none of them invents a GM, and
 * none of them creates a user. An ordinary player/observer/display invite can
 * never mint `gm` either — `invites.role` is what the device inherits, and the
 * invite routes exclude `gm` from the role enum by construction.
 *
 * Tokens are random 256-bit values; only their sha256 hash is stored
 * (`devices.token_hash`). `Authorization: Bearer <token>` everywhere; `?token=`
 * accepted on /ws, /files and /read (see app.ts hook).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
// drizzle-orm is a declared @safehouse/server dependency (pinned to the same
// ^0.45.2 as @safehouse/db) for its query operators.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { RoleSchema, type Role } from '@safehouse/contracts';
import { campaigns, devices, invites, memberships, users, wsEvents, type Db } from '@safehouse/db';
import { installStarterArchetypes } from './archetypes.js';

// ---------------------------------------------------------------------------
// Error envelope helper (§12: { error: { code, message, details? } })
// ---------------------------------------------------------------------------

export interface HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  /**
   * Marks an envelope somebody wrote on purpose, as opposed to an exception
   * that fell out of a driver. `app.ts` collapses unexpected 5xx codes to
   * `internal` so a stack trace's `code` can never become API surface — but a
   * deliberate 503 like `ai_disabled` is exactly what the web app switches on,
   * so it has to survive that. This flag is the difference.
   */
  expose: true;
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
  err.expose = true;
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

/**
 * One row of `GET /api/campaigns` — enough to draw a "pick up where you left
 * off" card and nothing more. No `settings` (it can hold the Discord webhook,
 * §12) and no owner id: a campaign the caller only plays in owes them neither.
 */
export interface CampaignSummary {
  id: string;
  name: string;
  /** The caller's membership role in this campaign. */
  role: 'gm' | 'player' | 'observer';
  createdAt: string;
  /** Newest `ws_events` row, or null for a campaign that never ran. */
  lastPlayedAt: string | null;
}

/** A campaign plus its owner of record — loopback/CLI only (see below). */
export interface CampaignOwnerSummary {
  id: string;
  name: string;
  gm: { id: string; displayName: string };
  createdAt: string;
  lastPlayedAt: string | null;
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

  /**
   * When this campaign was last touched, for the campaign picker's "last
   * played" line. `ws_events` is the only table that records activity for
   * every domain at once (§11), and `game_sessions` carries no timestamp at
   * all — a campaign the GM prepped but never ran has no session row and would
   * otherwise read as never opened.
   *
   * Per campaign, not one grouped query: `ws_events_campaign_id_idx` is on
   * `(campaign_id, id)`, so "newest row for this campaign" is an index seek,
   * while `max(created_at) group by campaign_id` scans the whole table — and
   * ws_events is the biggest table the app has. The caller holds a handful of
   * campaigns, so a handful of seeks is the cheaper shape.
   */
  private async lastPlayedAt(campaignId: string): Promise<string | null> {
    const row = (
      await this.db
        .select({ at: wsEvents.createdAt })
        .from(wsEvents)
        .where(eq(wsEvents.campaignId, campaignId))
        .orderBy(desc(wsEvents.id))
        .limit(1)
    )[0];
    return row?.at?.toISOString() ?? null;
  }

  /**
   * The campaigns this user belongs to (`GET /api/campaigns`). Scoped by
   * `memberships`, never by "everything on this server": the list is what the
   * sign-in screen shows, so a second GM sharing the box must not see the first
   * one's table (Principle 4 — filtered server-side, not by the client
   * declining to draw it).
   *
   * `role` is the MEMBERSHIP role, which is the user's standing in that
   * campaign. It can differ from the device role the API gates on — a kiosk
   * device is `display` against an `observer` membership (§13) — so the web app
   * must treat it as "what you are here", not as a capability grant.
   */
  async listCampaignsForUser(userId: string): Promise<CampaignSummary[]> {
    const rows = await this.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        role: memberships.role,
        createdAt: campaigns.createdAt,
      })
      .from(memberships)
      .innerJoin(campaigns, eq(campaigns.id, memberships.campaignId))
      .where(eq(memberships.userId, userId))
      .orderBy(desc(campaigns.createdAt));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        createdAt: r.createdAt.toISOString(),
        lastPlayedAt: await this.lastPlayedAt(r.id),
      })),
    );
  }

  /**
   * Every campaign on this server with the name of its owner of record — the
   * loopback recovery probe and the admin CLI, both of which have already
   * proven they are standing on the machine that owns the database. NEVER
   * reachable from a token: `listCampaignsForUser` is the authenticated read.
   */
  async listCampaignsWithOwner(): Promise<CampaignOwnerSummary[]> {
    const rows = await this.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        gmUserId: campaigns.gmUserId,
        gmName: users.displayName,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .innerJoin(users, eq(users.id, campaigns.gmUserId))
      .orderBy(desc(campaigns.createdAt));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        gm: { id: r.gmUserId, displayName: r.gmName },
        createdAt: r.createdAt.toISOString(),
        lastPlayedAt: await this.lastPlayedAt(r.id),
      })),
    );
  }

  /**
   * A `gm` device token for a campaign's EXISTING owner of record. The one
   * primitive behind both secret-less GM recovery paths — the loopback route
   * and the admin CLI — and the reason they cannot escalate: the identity comes
   * from `campaigns.gm_user_id`, never from the caller. No user is created, no
   * membership is invented, and a campaign id that does not exist is a 404
   * rather than a new campaign.
   *
   * The membership upsert is repair, not promotion: `onConflictDoNothing` can
   * only ever ADD the `gm` row the owner of record should already have (a
   * half-applied transfer, a hand-edited database), and can never rewrite the
   * role of a row that is already there.
   */
  async mintGmDevice(
    campaignId: string,
    opts: { label?: string } = {},
  ): Promise<{
    campaignId: string;
    campaignName: string;
    token: string;
    deviceId: string;
    user: { id: string; displayName: string };
  }> {
    const campaign = (
      await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
    const owner = (
      await this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, campaign.gmUserId))
        .limit(1)
    )[0];
    if (!owner) throw httpError(404, 'not_found', 'this campaign has no owner of record');

    await this.db
      .insert(memberships)
      .values({ campaignId: campaign.id, userId: owner.id, role: 'gm' })
      .onConflictDoNothing();

    const token = mintToken();
    const device = (
      await this.db
        .insert(devices)
        .values({
          userId: owner.id,
          campaignId: campaign.id,
          role: 'gm',
          tokenHash: hashToken(token),
          label: opts.label ?? 'GM device',
        })
        .returning()
    )[0]!;
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      token,
      deviceId: device.id,
      user: { id: owner.id, displayName: owner.displayName },
    };
  }

  /**
   * A single-use, minutes-long `gm` pairing code (see `plugins/auth.ts` for why
   * it is shaped this way). Shared by the `gm-pair` route and the admin CLI so
   * there is one definition of what a pairing code is; `createdBy` is the
   * identity the code will bind to, and `redeemInvite` re-checks that it is
   * still this campaign's GM at redemption time.
   */
  async createGmPairingCode(opts: {
    campaignId: string;
    createdBy: string;
    expiresInMinutes: number;
  }): Promise<{ code: string; expiresAt: string | null }> {
    const row = (
      await this.db
        .insert(invites)
        .values({
          campaignId: opts.campaignId,
          code: mintJoinCode(),
          role: 'gm',
          createdBy: opts.createdBy,
          maxUses: 1, // one laptop per code, always
          expiresAt: new Date(Date.now() + opts.expiresInMinutes * 60_000),
        })
        .returning()
    )[0]!;
    return { code: row.code, expiresAt: row.expiresAt?.toISOString() ?? null };
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

    // M10 cold start (FR10.1/G9): a brand-new campaign's NPC generator would
    // otherwise open on an empty dropdown, and the fix — hand-authoring
    // attribute curves and tier dials — is the evening M10 exists to give
    // back. `onlyWhenEmpty` makes this strictly additive: it can only ever
    // fire on a campaign that owns no templates at all. The rows are ordinary
    // editable templates, so undoing it is deleting them.
    //
    // Best-effort by construction: a malformed catalogue must never be able to
    // fail campaign creation, which is the one call the whole app bootstraps
    // through. The library route stays available to install by hand.
    try {
      await installStarterArchetypes(this.db, campaign.id, { onlyWhenEmpty: true });
    } catch (err) {
      console.warn('[archetypes] starter library not installed for new campaign:', err);
    }
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

  /**
   * The identity a `gm` pairing code binds to. A pairing code does NOT create a
   * user: it hands a second device to the GM who minted it, and only while that
   * identity is still this campaign's GM — so `transfer-ownership` silently
   * kills every pairing code the previous owner left lying around.
   */
  private async gmPairingIdentity(
    campaignId: string,
    createdBy: string | null,
  ): Promise<{ id: string; displayName: string }> {
    if (!createdBy) throw httpError(403, 'forbidden', 'this pairing code has no owner');
    const row = (
      await this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.campaignId, campaignId),
            eq(memberships.userId, createdBy),
            eq(memberships.role, 'gm'),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw httpError(403, 'forbidden', 'this pairing code no longer belongs to the GM');
    return row;
  }

  /** `GET|POST /api/join/:code` — mint user + membership + device token (FR1.1). */
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
    // A `gm` invite is a pairing code, not a sign-up: it re-uses the existing GM
    // identity so the second laptop is the SAME user (owned characters, GM-only
    // rolls and the `campaigns.gm_user_id` check all keep working). Every other
    // role mints a fresh guest user, as before.
    const isPairing = invite.role === 'gm';
    const displayName = opts.displayName?.trim() || 'Guest';
    const user = isPairing
      ? await this.gmPairingIdentity(invite.campaignId, invite.createdBy)
      : (await this.db.insert(users).values({ displayName }).returning())[0]!;
    // A display device is observer-grade in the membership table (§13).
    const membershipRole: 'gm' | 'player' | 'observer' =
      invite.role === 'player' ? 'player' : isPairing ? 'gm' : 'observer';
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
          label: opts.deviceLabel ?? (isPairing ? 'GM device' : `${displayName}'s device`),
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
// Loopback origin — the guard behind secret-less GM recovery
// ---------------------------------------------------------------------------

/**
 * Every header a proxy uses to say "the real client is somewhere else". Any one
 * of them present means this request did not arrive over the socket it appears
 * to have arrived over, so the loopback test below cannot be trusted.
 *
 * The list is deliberately wider than the two headers people remember: a TLS
 * terminator that only sets `x-forwarded-proto` still hides every LAN client
 * behind its own address, which is the exact failure this guard exists to
 * prevent. Fail closed — a refused recovery costs the GM one CLI invocation
 * (`pnpm gm:token`); a permitted one hands the table to whoever is on the Wi-Fi.
 */
const FORWARDED_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'x-client-ip',
  'forwarded',
] as const;

function isIpv4Loopback(addr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return false;
  // 127.0.0.0/8 in full: `127.0.0.1` is the common case, `127.0.0.53` (systemd)
  // and `127.94.0.1` (macOS aliases) are the same interface.
  return octets[0] === 127;
}

function isIpv6Loopback(addr: string): boolean {
  if (!addr.includes(':')) return false;
  const halves = addr.split('::');
  if (halves.length > 2) return false;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
      : head;
  if (groups.length !== 8) return false;
  // ::1 — every group zero but the last, which is one.
  return groups.every(
    (g, i) => /^[0-9a-f]{1,4}$/.test(g) && Number.parseInt(g, 16) === (i === 7 ? 1 : 0),
  );
}

/**
 * Is this raw socket peer address the machine the server is running on?
 *
 * Pure and exported because it IS the security decision (the route around it is
 * three lines), so it is what the tests aim at directly. Accepts 127.0.0.0/8,
 * `::1` in any spelling, and the IPv4-mapped form Node reports on a dual-stack
 * listener (`::ffff:127.0.0.1`). Everything else — including `0.0.0.0`, `::`,
 * a hostname, and an empty or missing address — is false.
 */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (typeof address !== 'string') return false;
  let addr = address.trim().toLowerCase();
  const zone = addr.indexOf('%'); // fe80::1%eth0
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  if (addr.length === 0) return false;
  // An IPv4 peer wearing a v6 hat on a dual-stack socket.
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return isIpv4Loopback(addr) || isIpv6Loopback(addr);
}

/**
 * The host part of an authority, port stripped: `[::1]:8787` → `[::1]`,
 * `localhost:5173` → `localhost`. Null for anything that is not one — a bare
 * unbracketed IPv6, a `user@host` form, trailing junk — because the only use
 * below is an allow-list, and an authority we cannot parse is one we refuse.
 */
function authorityHost(authority: string): string | null {
  const value = authority.trim().toLowerCase();
  if (value.length === 0) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end === -1) return null;
    const port = value.slice(end + 1);
    if (port.length > 0 && !/^:\d{1,5}$/.test(port)) return null;
    return value.slice(0, end + 1);
  }
  const colon = value.indexOf(':');
  if (colon === -1) return /^[a-z0-9.-]+$/.test(value) ? value : null;
  if (!/^\d{1,5}$/.test(value.slice(colon + 1))) return null;
  const host = value.slice(0, colon);
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

/**
 * Does this `Host` header name the machine as ITSELF? `localhost` and the
 * loopback literals only — deliberately not the box's LAN name or address,
 * which is how every other client on the Wi-Fi reaches it.
 */
export function isLoopbackAuthority(authority: string | null | undefined): boolean {
  if (typeof authority !== 'string') return false;
  const host = authorityHost(authority);
  if (host === null) return false;
  return host === 'localhost' || isLoopbackAddress(host);
}

/**
 * The same test for an `Origin` header, which carries a scheme. The literal
 * string `null` (a sandboxed iframe, a cross-origin redirect) fails the regex
 * and is therefore refused, which is the right answer: it is a browser telling
 * us it will not vouch for where the page came from.
 */
export function isLoopbackOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== 'string') return false;
  const m = /^https?:\/\/([^/?#]+)$/i.exec(origin.trim());
  return m !== null && isLoopbackAuthority(m[1]!);
}

/** The forwarding header that makes this request untrustworthy, or null. */
export function forwardedHeader(headers: Record<string, unknown>): string | null {
  for (const name of FORWARDED_HEADERS) {
    const value = headers[name];
    if (value !== undefined && value !== null && String(value).length > 0) return name;
  }
  return null;
}

/**
 * The open-table switch: `SAFEHOUSE_OPEN_TABLE=1`.
 *
 * Off (the default), GM recovery is gated on `assertLoopbackOrigin` below and
 * a token can only be minted on the machine hosting the server. On, anyone who
 * can reach the app may list every campaign — with the name of the GM who
 * started it — and claim the GM chair of any of them.
 *
 * That is a deliberate, temporary posture for a private table: friends around
 * a laptop on a home network, where "who is the GM tonight" is a social fact
 * and not something the software needs to adjudicate. It is NOT a mode to run
 * on a machine reachable from the internet, because it is exactly what it
 * looks like — no credential of any kind stands between a request and the GM
 * console.
 *
 * It is one flag, read in one place, and the guards it bypasses are still here
 * intact underneath. Turning it off is the whole of "add real auth later".
 *
 * Read per request rather than cached at import: tests toggle it, and a config
 * value this consequential should never be a thing you have to restart to be
 * sure about.
 */
export function openTableMode(): boolean {
  const raw = process.env['SAFEHOUSE_OPEN_TABLE'];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * 403 unless this request provably originates on the machine hosting the
 * server. The whole basis of secret-less GM recovery: the documented
 * deployment is "hosted from the GM's laptop" (§8/§16), and a browser on that
 * laptop is already as trusted as the filesystem — it could read the database
 * directly. So loopback earns a GM token; nothing else does.
 *
 * Three tests, all of which must pass, and the order matters:
 *
 * 1. `req.socket.remoteAddress`, NOT `req.ip`. Fastify's `ip` becomes the
 *    left-most `X-Forwarded-For` entry the moment `trustProxy` is on, and that
 *    header is attacker-controlled — a phone on the table's Wi-Fi could claim
 *    to be 127.0.0.1 and mint itself the GM screen. The raw socket peer is the
 *    kernel's answer and cannot be spelled by the client.
 * 2. No forwarding header at all. Behind a reverse proxy EVERY client arrives
 *    from loopback, so test (1) would pass for the entire LAN. There is no
 *    proxy in `infra/` today; this is what keeps adding one from silently
 *    opening the door.
 * 3. `trustProxy` off. Fastify only defines `req.ips` when it is on, so its
 *    presence is the runtime signal — and a proxy trusted but not yet in front
 *    of the app is a configuration mid-flight, not a state to mint tokens in.
 *
 * Tests 1–3 answer "did this connection come from this machine". They do NOT
 * answer "did the person at this machine ask for it", and a browser is exactly
 * the client that can be made to ask on somebody else's behalf over a genuine
 * loopback socket:
 *
 * - DNS REBINDING. `evil.example` first resolves to the attacker's server, the
 *   GM's browser loads a page from it, then the name re-resolves to 127.0.0.1.
 *   The page's next `fetch('/api/gm/recover')` leaves the same browser, arrives
 *   over a real loopback socket with no forwarding header, and is SAME-ORIGIN
 *   with the attacker's script — which therefore reads the minted GM token.
 *   Every one of 1–3 passes. The one thing that still differs from a genuine
 *   local request is `Host`, which says `evil.example`.
 * - PLAIN CSRF. `fetch('http://127.0.0.1:8787/api/gm/recover', { method: 'POST' })`
 *   from any page sends no `Content-Type`, needs no preflight, and reaches the
 *   handler. The reply is unreadable without CORS (the app registers none), but
 *   the device row is minted regardless.
 *
 * So two more, on the headers a browser writes itself and page script cannot
 * forge (both are forbidden header names):
 *
 * 4. `Host` must name this machine AS ITSELF — `localhost` or a loopback
 *    literal. Not its LAN name: that is how everyone else reaches it.
 * 5. `Origin`, when the browser sends one, must be one of those names too.
 *
 * Both are conditional on the header being present, deliberately. The other
 * callers of this route are not browsers and are not the threat: `curl`, and
 * the `docker compose exec app node -e "fetch(...)"` form in the CLI's header,
 * both send a loopback `Host` and no `Origin` at all.
 *
 * NOT covered, because no header can: a reverse proxy running ON loopback in
 * front of the app that sets none of the forwarding headers test 2 looks for.
 * Vite's dev proxy is exactly that — `xfwd` is off by default, and the string
 * shorthand (`'/api': target`) turns `changeOrigin` ON, so it rewrites both
 * `Host` and `Origin` to the target as well. Every client of a dev server
 * started with `--host` therefore presents to this guard as the GM's own
 * browser. The dev server binds localhost unless told otherwise; keep it that
 * way, and reach the app on `:8787` when testing from the LAN.
 *
 * The refusal is deliberately uniform and content-free: it reveals nothing
 * about whether this server has campaigns, how many, or who owns them. A LAN
 * client learns only that this endpoint is not for them.
 *
 * A NOTE ON DOCKER (and why there is no flag to relax this): in a bridge
 * network the host arrives from the gateway address, not loopback, so this
 * refuses — correctly, because the container cannot tell the host apart from
 * any other LAN client. `pnpm gm:token` is the Docker path, and it is safe for
 * the opposite reason: it needs a shell on the box that owns the database.
 */
export function assertLoopbackOrigin(req: FastifyRequest): void {
  // The open-table switch, checked first and nowhere else: with it on there is
  // no gate at all, and every test below is skipped rather than weakened. See
  // `openTableMode` for what that means and why it is a flag, not a deletion.
  if (openTableMode()) return;
  const refuse = (why: string): never => {
    throw httpError(403, 'forbidden', `GM recovery is available only ${why}`);
  };
  if (req.ips !== undefined) {
    refuse('when the server is not behind a trusted proxy');
  }
  const forwarded = forwardedHeader(req.headers as Record<string, unknown>);
  if (forwarded !== null) {
    refuse(`on a direct connection (this request carried ${forwarded})`);
  }
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    refuse('on the machine hosting the server');
  }
  const headers = req.headers as Record<string, unknown>;
  // `:authority` is HTTP/2's spelling of Host, and under http2 `host` is absent
  // — so reading only `host` would skip test 4 entirely the day someone turns
  // http2 on. Over HTTP/1.1 no client can send it: `:` is not a legal header
  // name character, so node's parser rejects the request before this runs.
  const host = headers['host'] ?? headers[':authority'];
  if (host !== undefined && !isLoopbackAuthority(typeof host === 'string' ? host : null)) {
    refuse('at this machine\'s own name (this request asked for another host)');
  }
  const origin = headers['origin'];
  if (origin !== undefined && !isLoopbackOrigin(typeof origin === 'string' ? origin : null)) {
    refuse('from a page this machine served');
  }
}

// ---------------------------------------------------------------------------
// Routes + fastify wiring (called directly on the root instance from app.ts)
// ---------------------------------------------------------------------------

const CreateCampaignBody = z.object({
  name: z.string().min(1).max(200),
  gmName: z.string().min(1).max(100).optional(),
});

/**
 * `gm` is excluded on purpose (FR1.3): an ordinary invite is role-scoped to
 * player/observer/display, and no amount of body-fiddling turns one into a GM
 * device. GM devices come from the pairing routes in `plugins/auth.ts`.
 */
const CreateInviteBody = z.object({
  role: RoleSchema.exclude(['gm']).default('player'),
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 365).optional(),
  maxUses: z.number().int().min(1).optional(),
});

/** `POST /api/join/:code` body (the GET form takes `?name=` / `?label=`). */
const JoinBody = z.object({
  name: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(120).optional(),
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
    if (count > 0 && !openTableMode()) {
      existingUserId = requireAuth(req).userId;
    } else if (count > 0) {
      // Open table (FR1.7): anybody may start one, and naming a GM starts a
      // NEW identity rather than borrowing the caller's — otherwise every
      // campaign on a shared laptop reads "started by" whoever bootstrapped
      // the box, and the picker's whole way of telling tables apart collapses
      // to one name. A signed-in caller who names nobody stays themselves.
      if (body.gmName === undefined) existingUserId = req.auth?.userId;
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

  // QR join → device token (FR1.1). JSON, under /api; `/join/:code` belongs to
  // the SPA (LIVE-3 — the two used to be the same path, and the API won).
  const join = async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = req.params as { code: string };
    const q = (req.query ?? {}) as Record<string, unknown>;
    const body: { name?: string; label?: string } =
      req.method === 'POST' ? parseBody(JoinBody, req.body) : {};
    const displayName = body.name ?? (typeof q['name'] === 'string' ? q['name'] : undefined);
    const deviceLabel = body.label ?? (typeof q['label'] === 'string' ? q['label'] : undefined);
    const joined = await auth.redeemInvite(code.toUpperCase(), {
      ...(displayName ? { displayName } : {}),
      ...(deviceLabel ? { deviceLabel } : {}),
    });
    return reply.send(joined);
  };
  app.get('/api/join/:code', join);
  app.post('/api/join/:code', join);

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

/**
 * The URL a QR encodes: the **SPA** route `/join/:code` on an address the
 * table's phones can reach (§8 auth row). The page then calls
 * `GET /api/join/:code` for the token — scanning must land on the join screen,
 * never on raw JSON (LIVE-3).
 *
 * Default origin is this server's LAN address, which is right in production
 * (the server serves the built SPA). Set `WEB_ORIGIN` (e.g.
 * `http://192.168.1.20:5173`) when Vite is serving the SPA on another port.
 */
export function joinUrl(app: FastifyInstance, code: string): string {
  const override = process.env.WEB_ORIGIN?.trim();
  if (override) return `${override.replace(/\/+$/, '')}/join/${code}`;
  const address = app.server.address();
  const port =
    typeof address === 'object' && address !== null
      ? address.port
      : Number(process.env.PORT ?? 8787);
  return `http://${lanAddress()}:${port}/join/${code}`;
}
