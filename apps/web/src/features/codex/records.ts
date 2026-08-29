/**
 * Codex records data layer (M5): runs (FR5.5), the in-game calendar (FR5.7),
 * contacts (FR5.8) and the thin character roster those two need.
 *
 * Split out of `api.ts`, which keeps the wiki and handouts. `api.ts` re-exports
 * everything here, so callers only ever import from one place.
 *
 * As everywhere in this feature, the server has already filtered the response
 * for this device (Principle 4): a player's run list carries finished runs and
 * their recaps and nothing else, and a contact list is owner-or-GM only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Visibility } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client.js';
import type { CalendarEntry, Favours, Objective } from './lib.js';
import { codexKeys } from './keys.js';

// ---------------------------------------------------------------------------
// Runs (FR5.5)
// ---------------------------------------------------------------------------

export interface RunRecord {
  id: string;
  campaignId?: string;
  title: string;
  state: string;
  johnsonPageId?: string | null;
  hook?: string;
  objectives?: Objective[];
  opposition?: Array<{ encounterId?: string; label?: string; note?: string }>;
  payout?: { nuyen?: number; karma?: number; notes?: string };
  awards?: {
    karma: number;
    nuyen: number;
    history: Array<{
      at: string;
      reason: string;
      entries: Array<{ characterId: string; currency: string; delta: number }>;
    }>;
  };
  recapMd?: string;
  ingameDate?: string | null;
}

export function useRuns(campaignId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.runs(campaignId ?? ''),
    queryFn: async () =>
      (await apiGet<{ runs: RunRecord[] }>(`/api/campaigns/${campaignId}/runs`)).runs,
    enabled: Boolean(campaignId),
  });
}

export type RunBody = Partial<Omit<RunRecord, 'id' | 'campaignId' | 'awards'>> & { title?: string };

export function useCreateRun(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunBody & { title: string }) =>
      (await apiPost<{ run: RunRecord }>(`/api/campaigns/${campaignId}/runs`, body)).run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.runs(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.calendar(campaignId) });
    },
  });
}

export function useUpdateRun(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, patch }: { runId: string; patch: RunBody }) =>
      (await apiPatch<{ run: RunRecord }>(`/api/runs/${runId}`, patch)).run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.runs(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.calendar(campaignId) });
    },
  });
}

export interface AwardBody {
  reason?: string;
  entries: Array<{ characterId: string; karma?: number; nuyen?: number; reason?: string }>;
}

/**
 * Awards land as **pending** ledger entries (FR5.5 → FR3.6): the settle-up
 * beat approves them at the table, so a mistyped payout is one rejection away
 * from gone.
 */
export function useAwardRun(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, body }: { runId: string; body: AwardBody }) =>
      apiPost<{ run: RunRecord }>(`/api/runs/${runId}/award`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.runs(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Calendar (FR5.7)
// ---------------------------------------------------------------------------

export function useCalendar(campaignId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.calendar(campaignId ?? ''),
    queryFn: async () =>
      apiGet<{ campaignId: string; ingameDate: string | null; entries: CalendarEntry[] }>(
        `/api/campaigns/${campaignId}/calendar`,
      ),
    enabled: Boolean(campaignId),
  });
}

export interface CalendarEventBody {
  date: string;
  title: string;
  body?: string;
  kind?: string;
  visibility?: Visibility;
  pageId?: string;
  runId?: string;
}

export function useCreateCalendarEvent(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CalendarEventBody) =>
      apiPost<unknown>(`/api/campaigns/${campaignId}/calendar`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.calendar(campaignId) });
    },
  });
}

export function useDeleteCalendarEvent(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      apiDelete<unknown>(`/api/campaigns/${campaignId}/calendar/${eventId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.calendar(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Contacts (FR5.8)
// ---------------------------------------------------------------------------

export interface ContactRecord {
  id: string;
  characterId: string;
  name: string;
  archetype: string;
  connection: number;
  loyalty: number;
  notes: string;
  favours: Favours;
  npcPageId: string | null;
  /** Present only on the GM's campaign-wide roster. */
  characterName?: string;
  npcPageTitle?: string;
}

/**
 * The campaign roster, thin — award targets and contact owners. Shares its key
 * with `useMyCharacterId`, so the two never fetch twice.
 */
export function useRoster(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['characters', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ characters: Array<{ id: string; name: string; ownerUserId?: string | null }> }>(
          `/api/campaigns/${campaignId}/characters`,
        )
      ).characters,
    enabled: Boolean(campaignId),
    staleTime: 60_000,
  });
}

export function useContacts(characterId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.contacts(characterId ?? ''),
    queryFn: async () =>
      (await apiGet<{ contacts: ContactRecord[] }>(`/api/characters/${characterId}/contacts`))
        .contacts,
    enabled: Boolean(characterId),
  });
}

export function useCampaignContacts(campaignId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.campaignContacts(campaignId ?? ''),
    queryFn: async () =>
      (await apiGet<{ contacts: ContactRecord[] }>(`/api/campaigns/${campaignId}/contacts`))
        .contacts,
    enabled: Boolean(campaignId),
  });
}

export interface ContactBody {
  name?: string;
  archetype?: string;
  connection?: number;
  loyalty?: number;
  notes?: string;
  favours?: Favours;
  npcPageId?: string | null;
}

export function useCreateContact(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactBody & { name: string }) =>
      apiPost<{ contact: ContactRecord }>(`/api/characters/${characterId}/contacts`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.contacts(characterId) });
    },
  });
}

export function useUpdateContact(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, patch }: { contactId: string; patch: ContactBody }) =>
      apiPatch<{ contact: ContactRecord }>(`/api/contacts/${contactId}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.contacts(characterId) });
    },
  });
}

export function useDeleteContact(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => apiDelete<unknown>(`/api/contacts/${contactId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.contacts(characterId) });
    },
  });
}
