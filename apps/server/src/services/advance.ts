/**
 * Career-mode advancement (FR3.7, docs/CHARGEN.md §8.5 "Advancement"): a
 * runner in play spends Karma on a raise, a specialisation, a spell, and the
 * GM says yes where every other Karma spend is settled — the ledger.
 *
 * So an advance is a ledger entry before it is a sheet change. Asking writes
 * a *pending* Karma entry of −cost whose `payload` is the change it pays for
 * (`AdvanceMutation`: the spend, the Karma and training time quoted, our
 * label); approving that entry applies the change to the sheet as a new
 * revision, cause `advanced`, in the same transaction that approves it;
 * rejecting it leaves the sheet as it is. Nothing about the sheet moves until
 * the GM approves, which is exactly when the book has the Karma paid (p. 105).
 *
 * The rules are the engine's, run twice: when the spend is asked for (against
 * the sheet as it is and every advance already waiting, so the same raise is
 * not queued twice) and again at approval, because the sheet may have moved
 * in between — a rollback, a GM edit, another advance approved first. A spend
 * that no longer applies, or that would now cost a different amount, is
 * refused at approval with the rule's sentence rather than applied to a sheet
 * it was not priced against.
 *
 * Everything here runs inside a `Hub.atomic` block through `tx.db` — the
 * deadlock rule — and the route (`plugins/advance.ts`) and the ledger's
 * settle step (`plugins/ledger.ts`) are its only callers.
 */
import { and, eq } from 'drizzle-orm';
import { AdvanceMutationSchema, SheetV1Schema, type AdvanceMutation, type KarmaSpend } from '@safehouse/contracts';
import { advanceRefusals, applySpend, karmaCostOf, type AdvanceQuote } from '@safehouse/rules';
import { ledgerBalance, ledgerEntries, type Db } from '@safehouse/db';
import type { EventTx } from '../hub.js';
import { httpError, type AuthContext } from './auth.js';
import { recordRevision, requireCharacter, saveCharacter } from './characters.js';

/** The revision cause an approved advance writes (FR3.8 history). */
export const ADVANCED_CAUSE = 'advanced';

/** A malformed id answers 404 like an unknown one, before it reaches Postgres. */
export const ADVANCE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The advance a ledger entry's payload carries, or null for any other entry. */
export function advanceOf(payload: unknown): AdvanceMutation | null {
  if (payload === null || payload === undefined) return null;
  const parsed = AdvanceMutationSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** The longest a ledger `reason` may be — `CreateEntryBody`'s bound, which every other writer is held to. */
export const LEDGER_REASON_MAX = 500;

/**
 * The change an entry will carry, checked against the schema it will be read
 * back through (`advanceOf`).
 *
 * This is the one asymmetry worth closing by hand: the route writes the
 * payload without validating it, while every reader parses it. A payload
 * that fails to parse is not an error anywhere — the entry simply becomes a
 * plain Karma spend, and the GM approving it applies nothing to the sheet,
 * silently. So the write is parsed first and a payload that cannot be read
 * back is refused as a fault of ours, never stored.
 */
export function advanceMutationOf(
  spend: KarmaSpend,
  quote: Pick<AdvanceQuote, 'label' | 'cost' | 'training'>,
): { ok: true; advance: AdvanceMutation } | { ok: false; issues: unknown } {
  const parsed = AdvanceMutationSchema.safeParse({
    kind: 'advance',
    spend,
    cost: quote.cost,
    trainingTime: { steps: [...quote.training.steps], total: quote.training.total },
    label: quote.label,
  });
  return parsed.success ? { ok: true, advance: parsed.data } : { ok: false, issues: parsed.error.issues };
}

/** The spends of a character's advances still waiting on the GM. */
export async function pendingAdvanceSpends(db: Db, characterId: string): Promise<KarmaSpend[]> {
  const rows = await db
    .select({ payload: ledgerEntries.payload })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.characterId, characterId), eq(ledgerEntries.state, 'pending')));
  return rows.flatMap((r) => {
    const advance = advanceOf(r.payload);
    return advance ? [advance.spend] : [];
  });
}

export interface AppliedAdvance {
  revision: number;
}

/**
 * Apply an approved advance to its character's sheet: re-check it against the
 * sheet as it stands now, apply it, snapshot the revision and announce the
 * change — all through `tx`. Throws, and so rolls the approval back, when the
 * spend no longer applies (`409 advance_stale`), when its price has moved
 * since it was quoted (`409 advance_repriced`), or when the approved Karma
 * cannot pay for it (`409 insufficient_karma`, the entry already counted as
 * approved in that balance).
 */
export async function applyAdvance(
  tx: EventTx,
  auth: AuthContext,
  input: { characterId: string; entryId: string; advance: AdvanceMutation },
): Promise<AppliedAdvance> {
  const { characterId, entryId, advance } = input;
  const rec = await requireCharacter(tx.db, characterId);
  const refusals = advanceRefusals(rec.sheet, advance.spend);
  if (refusals.length > 0) {
    throw httpError(409, 'advance_stale', `${advance.label} no longer applies: ${refusals[0]!.message}`, { refusals });
  }
  const cost = karmaCostOf(advance.spend, rec.sheet);
  if (cost !== advance.cost) {
    throw httpError(
      409,
      'advance_repriced',
      `${advance.label} costs ${cost} Karma now, not the ${advance.cost} it was asked for at; reject it and ask again.`,
      { quoted: advance.cost, cost },
    );
  }
  const balance = await ledgerBalance(tx.db, characterId);
  if (balance.karma < 0) {
    throw httpError(
      409,
      'insufficient_karma',
      `${advance.label} would leave ${balance.karma} Karma; approve the Karma it is paid from first.`,
      { karma: balance.karma },
    );
  }
  // `inPlay`: a Magic or Resonance raise was asked for in the ratings the
  // sheet shows, and an adept's Magic brings its free power point (p. 279).
  const sheet = SheetV1Schema.parse(applySpend(rec.sheet, advance.spend, { inPlay: true }));
  await saveCharacter(tx.db, characterId, { sheet, play: rec.play });
  const revision = await recordRevision(tx.db, { characterId, sheet, cause: ADVANCED_CAUSE, createdBy: auth.userId });
  await tx.emit({
    type: 'sheet.updated',
    payload: { characterId, name: rec.name, revision, cause: ADVANCED_CAUSE, entryId, advance: advance.label },
  });
  return { revision };
}
