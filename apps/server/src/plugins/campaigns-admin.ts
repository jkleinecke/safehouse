/**
 * campaigns-admin plugin — the two ownership moves M1 never had (FR1.2, FR1.4).
 * Registered from `plugins/auth.ts`, because both routes are identity moves and
 * both must be GM-gated the same way the token routes are.
 *
 *   POST  /api/campaigns/:id/transfer-ownership  { toUserId }
 *   PATCH /api/characters/:id/owner              { ownerUserId }
 *
 * Transfer is not a cosmetic field flip. A campaign has exactly one GM (FR1.2),
 * so the move has to carry everything that answers "who is the GM":
 *
 *   1. `campaigns.gm_user_id`               — the owner of record.
 *   2. `memberships.role`                   — new owner → `gm`, old owner →
 *                                             `player` (they stay at the table).
 *   3. `devices.role` for this campaign     — the old GM's live tokens are
 *                                             demoted to `player`, the new GM's
 *                                             are promoted to `gm`.
 *
 * (3) is the security-relevant step and the easy one to forget: `requireRole`
 * reads `devices.role`, so leaving the previous owner's phone at `gm` would
 * hand them the GM screen forever. Demoting it also kills any pairing code they
 * minted, since `redeemInvite` re-checks the minter's `gm` membership. Kiosk
 * (`display`) devices are never touched — a TV is a TV whoever runs the table.
 *
 * The sheet-claim route is `PATCH /api/characters/:id/owner`, not
 * `PATCH /api/characters/:id`: `plugins/characters.ts` already declares that
 * method+path, and a second declaration is a Fastify boot error. Should the
 * characters plugin ever want `ownerUserId` in its own PatchBody it can call
 * `setCharacterOwner` below, and this route retires.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { campaigns, characters, devices, memberships, users, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireRole } from '../services/auth.js';

const TransferBody = z.object({
  toUserId: z.string().uuid(),
});

const OwnerBody = z.object({
  /** `null` un-claims the sheet (back to a GM-run NPC-ish PC). */
  ownerUserId: z.string().uuid().nullable(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

/** A member of this campaign, or 404 — you cannot hand the table to a stranger. */
async function requireMember(
  db: Db,
  campaignId: string,
  userId: string,
): Promise<{ id: string; displayName: string }> {
  const row = (
    await db
      .select({ id: users.id, displayName: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.campaignId, campaignId), eq(memberships.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw httpError(404, 'not_found', 'that user is not a member of this campaign');
  return row;
}

/**
 * Point a sheet at its player (FR1.1's other half: the join link binds a
 * device, the GM says which runner it is holding). Exported so the characters
 * plugin can adopt it without duplicating the membership check.
 */
export async function setCharacterOwner(
  db: Db,
  opts: { characterId: string; campaignId: string; ownerUserId: string | null },
): Promise<void> {
  if (opts.ownerUserId !== null) await requireMember(db, opts.campaignId, opts.ownerUserId);
  await db
    .update(characters)
    .set({ ownerUserId: opts.ownerUserId })
    .where(eq(characters.id, opts.characterId));
}

export default async function campaignsAdminPlugin(app: FastifyInstance): Promise<void> {
  // --- FR1.2: hand the campaign to another member --------------------------
  app.post('/api/campaigns/:id/transfer-ownership', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(TransferBody, req.body);

    const campaign = (
      await app.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
    // Belt and braces: the device says `gm`, the record has to agree.
    if (campaign.gmUserId !== auth.userId) {
      throw httpError(403, 'forbidden', 'only the current owner may transfer the campaign');
    }
    if (body.toUserId === campaign.gmUserId) {
      throw httpError(400, 'bad_request', 'that user already owns this campaign');
    }
    const incoming = await requireMember(app.db, id, body.toUserId);
    const previousGmUserId = campaign.gmUserId;

    // 1. the record
    await app.db
      .update(campaigns)
      .set({ gmUserId: incoming.id })
      .where(eq(campaigns.id, id));

    // 2. memberships — one GM, and the old one keeps a seat as a player
    await app.db
      .update(memberships)
      .set({ role: 'gm' })
      .where(and(eq(memberships.campaignId, id), eq(memberships.userId, incoming.id)));
    await app.db
      .update(memberships)
      .set({ role: 'player' })
      .where(and(eq(memberships.campaignId, id), eq(memberships.userId, previousGmUserId)));

    // 3. live device tokens (the part that actually gates the API)
    await app.db
      .update(devices)
      .set({ role: 'player' })
      .where(
        and(
          eq(devices.campaignId, id),
          eq(devices.userId, previousGmUserId),
          eq(devices.role, 'gm'),
        ),
      );
    await app.db
      .update(devices)
      .set({ role: 'gm' })
      .where(
        and(
          eq(devices.campaignId, id),
          eq(devices.userId, incoming.id),
          ne(devices.role, 'display'), // a kiosk stays a kiosk
        ),
      );

    // Table-visible history, not a silent edit (§11).
    await app.hub.emit(id, {
      type: 'log.posted',
      payload: {
        kind: 'marker',
        text: `${incoming.displayName} is running the table now.`,
        transfer: { from: previousGmUserId, to: incoming.id },
      },
    });

    return reply.send({
      campaignId: id,
      gmUserId: incoming.id,
      previousGmUserId,
      gm: { id: incoming.id, displayName: incoming.displayName },
    });
  });

  // --- claim a sheet for the phone that just scanned in --------------------
  app.patch('/api/characters/:id/owner', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const rec = (
      await app.db
        .select({ id: characters.id, campaignId: characters.campaignId, name: characters.name })
        .from(characters)
        .where(eq(characters.id, id))
        .limit(1)
    )[0];
    if (!rec) throw httpError(404, 'not_found', 'unknown character');
    assertCampaign(auth, rec.campaignId);
    const body = parse(OwnerBody, req.body);

    await setCharacterOwner(app.db, {
      characterId: rec.id,
      campaignId: rec.campaignId,
      ownerUserId: body.ownerUserId,
    });

    // The owning phone's sheet query has to refetch — gm_owner rolls and the
    // "my character" list both key off this column.
    await app.hub.emit(rec.campaignId, {
      type: 'sheet.updated',
      payload: {
        characterId: rec.id,
        name: rec.name,
        ownerUserId: body.ownerUserId,
        cause: 'ownership',
      },
    });

    return reply.send({
      characterId: rec.id,
      campaignId: rec.campaignId,
      ownerUserId: body.ownerUserId,
    });
  });
}
