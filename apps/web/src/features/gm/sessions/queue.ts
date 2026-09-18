/**
 * What the housekeeping queue (`Housekeeping.tsx`) says about one pending
 * ledger entry (FR3.6, FR3.7) — pure, so the GM's row is checked in a test
 * rather than by eye.
 *
 * Most entries are a number and a reason: the GM reads "Ammunition, −450¥"
 * and settles it. A career advance is different in one way that matters at
 * the table: approving it does not only move the balance, it writes the
 * character's sheet (`POST /api/ledger/:id/approve` applies the spend as an
 * `advanced` revision in the same transaction). The GM should know that
 * before pressing approve, and should see the training time the player was
 * quoted, so the row says both — in the same words the player read.
 *
 * The advance's own sentence is already the entry's reason ("Raise Agility
 * 4 → 5 · 25 Karma", written by the rules engine when the spend was priced),
 * so this adds the consequence and the time, and nothing else.
 */
import type { LedgerEntry } from '@safehouse/contracts';
import { trainingPhrase } from '@safehouse/rules';

/**
 * The second line of an advance's row: what approving it does, and how long
 * the book says the training takes (shown, never enforced — §8.5). Null for
 * every other kind of entry, which needs no second line.
 */
export function advanceNote(entry: Pick<LedgerEntry, 'advance'>): string | null {
  const advance = entry.advance;
  if (!advance) return null;
  const phrase = trainingPhrase(advance.trainingTime);
  const time = phrase === 'no training time' ? 'no training time' : `trains for ${phrase}`;
  return `Approving puts this on the sheet · ${time}`;
}
