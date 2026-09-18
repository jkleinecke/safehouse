/**
 * The Improve panel's one write (FR3.7, docs/CHARGEN.md §8.5):
 * `POST /api/characters/:id/advance` with a Karma spend.
 *
 * The answer is a ledger entry — pending for a player, approved and already
 * on the sheet for the GM — so every query under the character refetches
 * when it settles: the ledger (the entry and the projected balance), the
 * character (a GM's applied advance is a new sheet and revision) and the
 * derived view. The socket's `ledger.changed` and `sheet.updated` would get
 * there too; this gets there first on the device that asked.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdvanceRequestInput, LedgerEntry } from '@safehouse/contracts';
import { apiPost } from '../../../api/client.js';
import { characterKey } from '../../sheet/api.js';

/** `201` from the advance route. */
export interface AdvanceResult {
  entry: LedgerEntry;
  balances: { karma: number; nuyen: number; pending: { karma: number; nuyen: number } };
  quote: { label: string; cost: number };
  /** The revision a GM's own advance wrote; absent while it waits on the ledger. */
  revision?: number;
}

export function advancePath(characterId: string): string {
  return `/api/characters/${characterId}/advance`;
}

export function useAdvance(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdvanceRequestInput) => apiPost<AdvanceResult>(advancePath(characterId), body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}
