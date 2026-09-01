/**
 * Party roster data layer (DESIGN.md §12) — GM-only reads plus the three
 * writes a GM actually makes while looking at the party.
 *
 * LIVE-1 is the rule this module exists to keep: every query here refetches on
 * mount and on reconnect, so the roster a GM opens (or comes back to after a
 * lock screen) is the server's state, not "whatever events happened to arrive
 * while this tab was open". Live events only ever invalidate — see
 * `usePartyLive` — they never build the list.
 *
 * The network functions are exported as plain `async` calls beside their hooks
 * so the contract they post can be tested without a DOM.
 */
import { useEffect } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { apiGet, apiPost } from '../../../api/client.js';
import { useCampaign } from '../../../api/campaigns.js';
import { useLiveStore, type SocketStatus } from '../../../live/store.js';
import {
  normalizeDerived,
  normalizeMember,
  sortMembers,
  type AwardRequest,
  type DamageRequest,
  type DerivedSnapshot,
  type PartyMember,
  type RosterToken,
} from './roster.js';

/**
 * Hydration policy for every roster query (LIVE-1). Deliberately a local
 * constant rather than an import from `features/sheet`: features do not reach
 * into each other's internals, and this is three lines.
 */
export const PARTY_HYDRATE = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnReconnect: 'always',
} as const;

/**
 * Same key the grid's `useCharacters` and the shell's `useMyCharacterId` use,
 * and deliberately the same RAW payload — `.characters` straight off the wire.
 * Normalisation happens in `select`, which is per-observer, so sharing the
 * cache entry cannot hand another consumer a shape it did not ask for.
 */
export const partyKey = (campaignId: string) => ['characters', campaignId] as const;

/** Roster derived-view keys are namespaced away from the sheet's own cache. */
export const partyDerivedKey = (characterId: string) =>
  ['party-derived', characterId] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** GET /api/campaigns/:id/characters → every PC with sheet, play and balances. */
export function useParty(campaignId: string | undefined) {
  return useQuery({
    queryKey: partyKey(campaignId ?? ''),
    queryFn: async () =>
      (
        await apiGet<{ campaignId: string; characters: unknown[] }>(
          `/api/campaigns/${campaignId}/characters`,
        )
      ).characters,
    select: (rows: unknown[]) => sortMembers(rows.map(normalizeMember)),
    enabled: Boolean(campaignId),
    ...PARTY_HYDRATE,
  });
}

/**
 * GET /api/characters/:id/derived, one per PC — the authoritative pools, with
 * the active scene's environment already folded in. One request per character
 * is the honest cost of a screen that shows every character's live numbers;
 * the roster renders from the local engine in the meantime rather than
 * blocking on the fan-out.
 */
export function useDerivedRows(
  members: readonly PartyMember[] | undefined,
): Record<string, DerivedSnapshot | null> {
  const ids = (members ?? []).map((m) => m.id);
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: partyDerivedKey(id),
      queryFn: async () => normalizeDerived(await apiGet<unknown>(`/api/characters/${id}/derived`)),
      enabled: id.length > 0,
      retry: 0,
      ...PARTY_HYDRATE,
    })),
    combine: (results) => {
      const out: Record<string, DerivedSnapshot | null> = {};
      results.forEach((result, i) => {
        const id = ids[i];
        if (id) out[id] = result.data ?? null;
      });
      return out;
    },
  });
}

export interface PartyScene {
  sceneId: string | null;
  sceneName: string | null;
  tokens: RosterToken[];
}

/**
 * The scene the table is on plus its tokens, so a row can say where that PC is
 * standing and jump the GM to them. The live store's `activeSceneId` refines
 * the campaign record; the campaign record is what makes it survive a reload.
 */
export function usePartyScene(campaignId: string | undefined): PartyScene {
  const liveSceneId = useLiveStore((s) => s.activeSceneId);
  const { data: campaign } = useCampaign(campaignId);
  const sceneId = liveSceneId ?? campaign?.activeSceneId ?? null;

  // Same route and cache entry as the Grid's composed-scene query, so the two
  // share one fetch; `select` narrows it to what a roster row needs.
  const { data } = useQuery({
    queryKey: ['scene', sceneId],
    queryFn: () =>
      apiGet<{ scene: Scene; tokens: RosterToken[] }>(`/api/scenes/${sceneId}`),
    select: (body): PartyScene => ({
      sceneId: body.scene?.id ?? null,
      sceneName: body.scene?.name ?? null,
      tokens: body.tokens ?? [],
    }),
    enabled: Boolean(sceneId),
    retry: false,
    ...PARTY_HYDRATE,
  });

  return data ?? { sceneId, sceneName: null, tokens: [] };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** POST /api/characters/:id/damage — monitors are live-play, not a revision. */
export async function postDamage(characterId: string, req: DamageRequest): Promise<unknown> {
  return apiPost<unknown>(`/api/characters/${characterId}/damage`, {
    monitor: req.monitor,
    boxes: Math.max(0, Math.trunc(req.boxes)),
    op: req.op,
    ...(req.note ? { note: req.note } : {}),
  });
}

/**
 * POST /api/characters/:id/ledger — karma and nuyen move ONLY as ledger
 * entries (FR3.6). A GM device's entry is approved on arrival; the amount and
 * the reason are append-only from that point on.
 */
export async function postAward(characterId: string, req: AwardRequest): Promise<unknown> {
  return apiPost<unknown>(`/api/characters/${characterId}/ledger`, {
    currency: req.currency,
    delta: Math.trunc(req.delta),
    reason: req.reason,
  });
}

// Creating / importing a character (`POST /api/characters`) and handing a
// sheet to a device (`PATCH /api/characters/:id/owner`) live in `../home/api`
// beside the console's own AddCharacter control; this screen reuses those
// rather than opening a second write path to the same routes.

/** Everything the roster re-reads when one character moves. */
export function invalidateMember(qc: QueryClient, campaignId: string, characterId: string): void {
  void qc.invalidateQueries({ queryKey: partyKey(campaignId) });
  void qc.invalidateQueries({ queryKey: partyDerivedKey(characterId) });
  // The sheet's own cache, so opening the row afterwards is not stale.
  void qc.invalidateQueries({ queryKey: ['character', characterId] });
}

export function useApplyDamage(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { characterId: string; req: DamageRequest }) =>
      postDamage(vars.characterId, vars.req),
    onSettled: (_data, _err, vars) => invalidateMember(qc, campaignId, vars.characterId),
  });
}

export function useAward(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { characterId: string; req: AwardRequest }) =>
      postAward(vars.characterId, vars.req),
    onSettled: (_data, _err, vars) => invalidateMember(qc, campaignId, vars.characterId),
  });
}

// ---------------------------------------------------------------------------
// Live refinement (§11) — events invalidate, they never build the roster
// ---------------------------------------------------------------------------

const ROSTER_EVENTS = new Set([
  'sheet.updated',
  'combatant.damaged',
  'ledger.changed',
  'encounter.updated',
  'scene.activated',
  'scene.updated',
]);

export function usePartyLive(campaignId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!campaignId) return;
    let seen = useLiveStore.getState().lastEventId;
    return useLiveStore.subscribe((state) => {
      if (state.lastEventId <= seen) return;
      const fresh = state.events.filter((e) => e.id > seen);
      seen = state.lastEventId;
      if (!fresh.some((e) => ROSTER_EVENTS.has(e.type))) return;
      void qc.invalidateQueries({ queryKey: partyKey(campaignId) });
      void qc.invalidateQueries({ queryKey: ['party-derived'] });
    });
  }, [campaignId, qc]);

  // Re-hydrate after a reconnect: gap replay covers what the hub still holds,
  // a refetch covers everything older than its buffer (LIVE-1).
  useEffect(() => {
    if (!campaignId) return;
    let previous: SocketStatus = useLiveStore.getState().status;
    return useLiveStore.subscribe((state) => {
      const next = state.status;
      if (next === previous) return;
      const reconnected = previous === 'offline' && next === 'online';
      previous = next;
      if (!reconnected) return;
      void qc.invalidateQueries({ queryKey: partyKey(campaignId) });
      void qc.invalidateQueries({ queryKey: ['party-derived'] });
    });
  }, [campaignId, qc]);
}
