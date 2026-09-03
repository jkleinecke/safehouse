/**
 * auth domain plugin — **GM-side sign-in** (FR1.1/1.2, DESIGN.md §13).
 *
 * Everything a player needs is minted by the core auth routes
 * (`src/services/auth.ts`). What was missing is the other half of FR1.1: a GM
 * whose laptop is not the one that ran the bootstrap had no way into the app
 * at all — `join-qr` and `POST /api/campaigns/:id/invites` both exclude the
 * `gm` role by construction, so the only path was hand-writing a token into
 * `localStorage`. Two routes close that, both GM-authenticated:
 *
 *   POST /api/campaigns/:id/gm-device  → a second GM token for THIS same GM,
 *                                        e.g. a phone beside the laptop.
 *   POST /api/campaigns/:id/gm-pair    → a short-lived, single-use pairing
 *                                        code (+ QR) that a fresh browser
 *                                        redeems at `GET /api/join/:code`.
 *
 * The pairing code is the interesting one, and it is deliberately narrow
 * (Principle 4 — never widen a secrecy guarantee for convenience):
 *
 * - It is an `invites` row with `role = 'gm'`, `max_uses = 1`, minutes-long TTL
 *   (default 10, hard cap 60). A code the GM forgets about expires by itself.
 * - Redeeming it does NOT create a user: `AuthService.redeemInvite` binds the
 *   new device to the identity that minted the code, and refuses if that
 *   identity is no longer this campaign's GM. So an ownership transfer
 *   invalidates every outstanding pairing code without a sweep.
 * - Nothing here lets an ordinary invite become a GM one. The player/observer/
 *   display invite routes parse their role through `RoleSchema.exclude(['gm'])`
 *   and the device inherits `invites.role` verbatim.
 *
 * BOTH of those need a GM already signed in somewhere, which leaves the cold
 * start: every GM token gone (storage cleared, laptop reimaged, the last device
 * revoked) on a database that already holds a campaign. Nothing in the app
 * could recover from that — the bootstrap route 401s once a campaign exists,
 * a pairing code needs a live GM to mint it, and pasting a token needs a
 * campaign UUID with no route to look it up. A third route closes it:
 *
 *   POST /api/gm/recover               → a GM token with NO secret at all, but
 *                                        only from the loopback interface.
 *   GET  /api/gm/recover               → same gate; which campaigns are here.
 *
 * The trade is stated plainly because it is the only place in the app where a
 * token is minted without proving anything: the documented deployment is "the
 * GM hosts the server on their laptop" (§8/§16), and a browser on that laptop
 * can already read `data/pglite` off the disk. Loopback is therefore not a
 * weaker credential than a token — it is a stronger one. Everything hangs on
 * the gate being airtight, which is why it lives in `assertLoopbackOrigin`
 * (services/auth.ts) as one pure decision with its own tests: raw socket
 * address, never `req.ip`; no forwarding header; `trustProxy` off.
 *
 * What it deliberately is NOT: it never creates a user and never invents a GM
 * (`AuthService.mintGmDevice` reads `campaigns.gm_user_id`), so a player device
 * calling it from the laptop gains nothing an anonymous curl on that same
 * laptop would not — which is the point, and why the route ignores `req.auth`
 * entirely rather than pretending to check it.
 *
 * This file also registers `campaigns-admin.ts` (ownership transfer + sheet
 * claiming) so `src/plugins/index.ts` — owned by server-core — needs no edit.
 */
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { devices } from '@safehouse/db';
import {
  assertCampaign,
  assertLoopbackOrigin,
  hashToken,
  httpError,
  joinUrl,
  mintToken,
  requireRole,
} from '../services/auth.js';
import campaignsAdminPlugin from './campaigns-admin.js';

/** Pairing codes are meant to be read aloud once and die (see header). */
const PAIR_DEFAULT_MINUTES = 10;
const PAIR_MAX_MINUTES = 60;

const GmDeviceBody = z.object({
  label: z.string().min(1).max(120).optional(),
});

const GmPairBody = z.object({
  expiresInMinutes: z.number().int().min(1).max(PAIR_MAX_MINUTES).optional(),
});

/**
 * `campaignId` is optional on purpose: the overwhelmingly common case is one
 * campaign on the laptop, and making the GM paste a UUID they cannot look up is
 * precisely the dead end this route exists to remove. With several, the caller
 * has to say which — `GET /api/gm/recover` lists them.
 */
const GmRecoverBody = z.object({
  campaignId: z.string().uuid().optional(),
  label: z.string().min(1).max(120).optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

export default async function authPlugin(app: FastifyInstance): Promise<void> {
  /**
   * A second device for the GM who is already signed in — same user, same
   * membership, a new token. Useful when the GM wants the phone in a pocket
   * and the laptop on the table.
   */
  app.post('/api/campaigns/:id/gm-device', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(GmDeviceBody, req.body);

    const token = mintToken();
    const device = (
      await app.db
        .insert(devices)
        .values({
          userId: auth.userId,
          campaignId: id,
          role: 'gm',
          tokenHash: hashToken(token),
          label: body.label ?? 'GM device',
        })
        .returning()
    )[0]!;

    return reply.status(201).send({
      campaignId: id,
      role: 'gm' as const,
      token,
      deviceId: device.id,
      user: { id: auth.userId, displayName: auth.displayName },
    });
  });

  /**
   * Pair a fresh browser (a borrowed laptop, a reinstalled phone) from the GM
   * screen already signed in. Returns the code, the SPA join URL and a QR of
   * it — the new machine scans or types it and lands on `/join/:code`, which
   * calls `GET /api/join/:code` and gets a GM token bound to this same GM user.
   */
  app.post('/api/campaigns/:id/gm-pair', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(GmPairBody, req.body);
    const minutes = body.expiresInMinutes ?? PAIR_DEFAULT_MINUTES;

    const invite = await app.authService.createGmPairingCode({
      campaignId: id,
      createdBy: auth.userId,
      expiresInMinutes: minutes,
    });

    const url = joinUrl(app, invite.code);
    return reply.status(201).send({
      code: invite.code,
      role: 'gm' as const,
      expiresAt: invite.expiresAt,
      expiresInMinutes: minutes,
      url,
      dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 512 }),
    });
  });

  /**
   * "Which campaigns are on this laptop?" — the question the sign-in screen has
   * to answer before it can offer to recover one, and the reason it is safe to
   * answer here and nowhere else: the caller has already proven they are on the
   * host (`assertLoopbackOrigin`). Off-host callers get the same content-free
   * 403 whether this server holds twelve campaigns or none.
   */
  app.get('/api/gm/recover', async (req, reply) => {
    assertLoopbackOrigin(req);
    const campaigns = await app.authService.listCampaignsWithOwner();
    return reply.send({ available: true, campaigns });
  });

  /**
   * A GM token, no secret, loopback only (see the file header for the trade).
   *
   * `req.auth` is not consulted anywhere in here, deliberately: whatever token
   * the caller happens to be holding — player, observer, kiosk, none — changes
   * nothing about the outcome, so there is no escalation to reason about. The
   * gate is the socket, and the identity comes from `campaigns.gm_user_id`.
   */
  app.post('/api/gm/recover', async (req, reply) => {
    assertLoopbackOrigin(req);
    const body = parse(GmRecoverBody, req.body);

    let campaignId = body.campaignId;
    if (campaignId === undefined) {
      const all = await app.authService.listCampaignsWithOwner();
      if (all.length === 0) {
        // Not a lockout: with an empty table `POST /api/campaigns` is open, and
        // that is the route the sign-in screen already offers.
        throw httpError(404, 'no_campaigns', 'this server has no campaigns yet');
      }
      if (all.length > 1) {
        throw httpError(
          409,
          'campaign_required',
          'this server hosts more than one campaign — say which',
          all.map((c) => ({ id: c.id, name: c.name })),
        );
      }
      campaignId = all[0]!.id;
    }

    const minted = await app.authService.mintGmDevice(campaignId, {
      label: body.label ?? 'GM device (recovered)',
    });
    return reply.status(201).send({
      campaignId: minted.campaignId,
      campaignName: minted.campaignName,
      role: 'gm' as const,
      token: minted.token,
      deviceId: minted.deviceId,
      user: minted.user,
    });
  });

  await app.register(campaignsAdminPlugin);
}
