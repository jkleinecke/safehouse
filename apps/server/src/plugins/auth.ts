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
 * This file also registers `campaigns-admin.ts` (ownership transfer + sheet
 * claiming) so `src/plugins/index.ts` — owned by server-core — needs no edit.
 */
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { devices, invites } from '@safehouse/db';
import {
  assertCampaign,
  hashToken,
  httpError,
  joinUrl,
  mintJoinCode,
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

    const row = (
      await app.db
        .insert(invites)
        .values({
          campaignId: id,
          code: mintJoinCode(),
          role: 'gm',
          createdBy: auth.userId,
          maxUses: 1, // one laptop per code, always
          expiresAt: new Date(Date.now() + minutes * 60_000),
        })
        .returning()
    )[0]!;

    const url = joinUrl(app, row.code);
    return reply.status(201).send({
      code: row.code,
      role: 'gm' as const,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      expiresInMinutes: minutes,
      url,
      dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 512 }),
    });
  });

  await app.register(campaignsAdminPlugin);
}
