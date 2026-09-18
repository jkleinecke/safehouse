/**
 * Advancement (FR3.7, docs/CHARGEN.md §8.5 "Advancement").
 *
 *   POST /api/characters/:id/advance   { spend, state? }   the owner or the GM
 *
 * A runner improves with Karma through the ledger (`services/advance.ts`):
 * this route prices the spend on the sheet as it stands, refuses it with the
 * rule's sentence when it does not apply (a raise from a rating the sheet has
 * left, past the play maximum, a specialisation without the skill, a spell
 * for someone who casts none, the same thing already waiting on the GM), and
 * refuses it when the Karma — approved plus pending, the balance the table
 * sees after settle-up — cannot pay. Otherwise it writes one pending Karma
 * entry of −cost carrying the change, which `POST /api/ledger/:id/approve`
 * applies as a revision.
 *
 * The owner's request is always pending. The GM's own is approved and
 * applied in the same transaction — the ledger's own pattern, where a GM's
 * entry lands approved — unless the body asks for `state: 'pending'`. An
 * observer or a display improves nobody, owner or not.
 *
 * What it writes is parsed before it is written, with the schema every reader
 * parses it back through (`advanceMutationOf`): a payload that cannot be read
 * back is an entry whose approval would apply nothing to the sheet and say
 * nothing about it, so it is our fault and never stored.
 *
 * Answers 201 `{ entry, balances, quote: { label, cost, training }, revision? }`;
 * 400 `bad_request` for a body outside `AdvanceRequestSchema` (a rating past
 * `SPEND_RATING_MAX`, a name past its bound); 409 `advance_refused` with
 * `details.refusals`, or `insufficient_karma` with the cost and what is
 * available.
 */
import type { FastifyInstance } from 'fastify';
import { AdvanceRequestSchema, type AdvanceMutation } from '@safehouse/contracts';
import { quoteAdvance } from '@safehouse/rules';
import { ADVANCE_UUID_RE, LEDGER_REASON_MAX, advanceMutationOf, applyAdvance, pendingAdvanceSpends } from '../services/advance.js';
import { httpError, requireAuth } from '../services/auth.js';
import { assertCanView, requireCharacter } from '../services/characters.js';
import { balancesFor, createEntry } from './ledger.js';

export default async function advancePlugin(app: FastifyInstance): Promise<void> {
  app.post('/api/characters/:id/advance', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    if (!ADVANCE_UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown character');
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    const isOwner = rec.ownerUserId != null && rec.ownerUserId === auth.userId;
    if (auth.role !== 'gm' && !(auth.role === 'player' && isOwner)) {
      throw httpError(403, 'forbidden', "only the character's owner or the GM may improve this character");
    }
    const parsed = AdvanceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
    const body = parsed.data;
    const state = auth.role === 'gm' ? (body.state ?? 'approved') : 'pending';

    const out = await app.hub.atomic(rec.campaignId, async (tx) => {
      // Priced and checked on the sheet and the ledger as they stand inside
      // the block, so a second request racing this one sees this one.
      const current = await requireCharacter(tx.db, id);
      const pending = await pendingAdvanceSpends(tx.db, id);
      const quote = quoteAdvance(current.sheet, body.spend, { pending });
      if (quote.refusals.length > 0) {
        throw httpError(409, 'advance_refused', quote.refusals[0]!.message, { refusals: quote.refusals });
      }
      const balances = await balancesFor(tx.db, id);
      // A request waits on the projected balance; a spend approved now must
      // also be paid from what is already approved.
      const available = state === 'approved' ? Math.min(balances.karma, balances.pending.karma) : balances.pending.karma;
      if (quote.cost > available) {
        throw httpError(409, 'insufficient_karma', `${quote.label} costs ${quote.cost} Karma; ${Math.max(0, available)} is available.`, {
          cost: quote.cost,
          available,
        });
      }
      // Parsed before it is written, with the schema every reader parses it
      // back through: a payload that cannot be read is an entry whose
      // approval would apply nothing, silently (`advanceMutationOf`).
      const built = advanceMutationOf(body.spend, quote);
      if (!built.ok) {
        req.log.error({ issues: built.issues, spend: body.spend }, 'advance mutation would not round-trip');
        throw httpError(500, 'advance_unwritable', 'the advance could not be recorded; tell the GM', { issues: built.issues });
      }
      const advance: AdvanceMutation = built.advance;
      const created = await createEntry(
        tx.db,
        app.hub,
        rec.campaignId,
        {
          characterId: id,
          currency: 'karma',
          delta: -quote.cost,
          reason: quote.reason.slice(0, LEDGER_REASON_MAX),
          state,
          createdBy: auth.userId,
          payload: advance,
        },
        { tx },
      );
      const applied = state === 'approved' ? await applyAdvance(tx, auth, { characterId: id, entryId: created.entry.id, advance }) : null;
      const settled = applied ? await balancesFor(tx.db, id) : created.balances;
      return {
        entry: created.entry,
        balances: settled,
        quote: { label: quote.label, cost: quote.cost, training: quote.training },
        ...(applied ? { revision: applied.revision } : {}),
      };
    });
    return reply.status(201).send(out);
  });
}
