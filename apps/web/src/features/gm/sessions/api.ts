/**
 * Sessions data layer (M6): session CRUD + start/end (FR6.2), pending ledger
 * approvals (FR3.6 housekeeping), recap publish to Discord (FR6.3).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { LedgerEntry } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';

/** §9.2 `game_sessions` (camelCase over the wire). `prepNotesMd` is GM-only
 *  and simply absent from a player's copy (Principle 4). */
export interface GameSession {
  id: string;
  campaignId: string;
  /** Real-world date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Attending member/user ids or display names — hand-editable. */
  attendance: string[];
  prepNotesMd?: string;
  recapMd?: string;
  state: 'planned' | 'live' | 'done';
}

export function useSessions(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'sessions'],
    queryFn: async () =>
      (await apiGet<{ sessions: GameSession[] }>(`/api/campaigns/${campaignId}/sessions`)).sessions,
    enabled: Boolean(campaignId),
  });
}

const invalidateSessions = (campaignId: string) => () => {
  void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'sessions'] });
  void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
};

export function useCreateSession(campaignId: string) {
  return useMutation({
    mutationFn: async (body: { date: string }) =>
      (await apiPost<{ session: GameSession }>(`/api/campaigns/${campaignId}/sessions`, body))
        .session,
    onSuccess: invalidateSessions(campaignId),
  });
}

export function useUpdateSession(campaignId: string) {
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<GameSession> }) =>
      (await apiPatch<{ session: GameSession }>(`/api/sessions/${id}`, patch)).session,
    onSuccess: invalidateSessions(campaignId),
  });
}

/**
 * Live mode is campaign-scoped, not session-scoped: starting resumes the given
 * session (or creates today's) and refuses if another one is already live
 * (409 `session_live`).
 */
export function useStartSession(campaignId: string) {
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await apiPost<{ session: GameSession; live: boolean }>(
          `/api/campaigns/${campaignId}/sessions/start`,
          { sessionId: id },
        )
      ).session,
    onSuccess: invalidateSessions(campaignId),
  });
}

export function useEndSession(campaignId: string) {
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiPost<{ session: GameSession }>(`/api/sessions/${id}/end`)).session,
    onSuccess: invalidateSessions(campaignId),
  });
}

/** FR6.3: an explicit GM action posts the recap to the campaign webhook. */
export function usePublishRecap(campaignId: string) {
  return useMutation({
    mutationFn: (id: string) => apiPost<unknown>(`/api/sessions/${id}/publish-recap`, {}),
    onSuccess: invalidateSessions(campaignId),
  });
}

// --- Housekeeping: pending ledger approvals ---------------------------------

/** Ledger entry + enough context to render the approval row. */
export type PendingLedgerEntry = LedgerEntry & { characterName?: string };

export function usePendingLedger(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'ledger', 'pending'],
    queryFn: async () =>
      (
        await apiGet<{ entries: PendingLedgerEntry[] }>(
          `/api/campaigns/${campaignId}/ledger?state=pending`,
        )
      ).entries,
    enabled: Boolean(campaignId),
  });
}

const invalidateLedger = (campaignId: string) => () => {
  void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'ledger'] });
};

export function useApproveLedger(campaignId: string) {
  return useMutation({
    /** POST /api/ledger/:entryId/approve (§12, verbatim). */
    mutationFn: (entryId: string) => apiPost<unknown>(`/api/ledger/${entryId}/approve`),
    onSuccess: invalidateLedger(campaignId),
  });
}

export function useRejectLedger(campaignId: string) {
  return useMutation({
    /** POST /api/ledger/:entryId/reject — symmetric with approve. */
    mutationFn: (entryId: string) => apiPost<unknown>(`/api/ledger/${entryId}/reject`),
    onSuccess: invalidateLedger(campaignId),
  });
}
