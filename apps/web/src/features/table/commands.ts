/**
 * Table-feature side effects: WS commands up (BUILD_CONVENTIONS "commands"),
 * REST helpers for what the command catalog doesn't cover, and small
 * optimistic patches on the live store (server events overwrite them).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Combatant, Encounter, RollTable, WsCommandInput } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost } from '../../api/client.js';
import { fetchLiveEncounter, fetchRollTables, liveKeys } from '../../api/live.js';
import { getSession } from '../../api/session.js';
import { getLiveSocket } from '../../live/socket.js';
import { useLiveStore } from '../../live/store.js';

/** Send a typed WS command on the campaign's live socket. */
export function sendCommand(campaignId: string, cmd: WsCommandInput): boolean {
  const session = getSession();
  if (!session || session.campaignId !== campaignId) return false;
  const socket = getLiveSocket({ campaignId, token: session.token });
  socket.connect();
  return socket.send(cmd);
}

/** Optimistically patch one combatant in the store; the next
 *  `encounter.updated` event is authoritative and overwrites it. */
export function patchCombatantLocal(combatantId: string, patch: Partial<Combatant>): void {
  const enc = useLiveStore.getState().encounter;
  if (!enc?.combatants) return;
  useLiveStore.setState({
    encounter: {
      ...enc,
      combatants: enc.combatants.map((c) => (c.id === combatantId ? { ...c, ...patch } : c)),
    },
  });
}

// ---------------------------------------------------------------------------
// REST — endpoints beyond the WS command catalog
// ---------------------------------------------------------------------------

/** Post a table-talk line / scene marker into the session log (FR2.9) —
 *  `log.posted` has no WS command, so this is the rolls plugin's REST route. */
export function postTableTalk(
  campaignId: string,
  text: string,
  kind: 'talk' | 'marker' = 'talk',
): Promise<unknown> {
  return apiPost(`/api/campaigns/${campaignId}/log`, { text, kind });
}

/** End the current initiative pass (−10 all scores, FR4.3).
 *  `encounter.advance` (WS) advances the actor; this closes the pass. */
export function postEndPass(encounterId: string): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/end-pass`);
}

/** Start a new combat turn — re-rolls initiative for everyone (FR4.3). */
export function postNewTurn(encounterId: string): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/new-turn`);
}

/**
 * Pay an interrupt action's initiative cost (FR4.4). The route is scoped to
 * the combatant, not the encounter — the server derives the fight from the
 * combatant row.
 */
export function postInterrupt(
  _encounterId: string,
  combatantId: string,
  action: { id: string; name: string; cost: number },
): Promise<unknown> {
  return apiPost(`/api/combatants/${combatantId}/interrupt`, {
    actionId: action.id,
    name: action.name,
    cost: action.cost,
  });
}

/** Hand-edit a combatant (score, monitors, effects — FR4.8). */
export function patchCombatant(combatantId: string, patch: Partial<Combatant>): Promise<unknown> {
  return apiPatch(`/api/combatants/${combatantId}`, patch);
}

// ---------------------------------------------------------------------------
// Rollable tables (FR2.11)
// ---------------------------------------------------------------------------

/** Campaign tables plus the shipped defaults (`campaign_id IS NULL`), already
 *  visibility-filtered server-side. Shares its key with the hydration pass, so
 *  the pane is populated on first paint rather than after a round trip. */
export function useRollTables(campaignId: string | undefined) {
  return useQuery<RollTable[]>({
    queryKey: liveKeys.rollTables(campaignId ?? ''),
    queryFn: () => fetchRollTables(campaignId as string),
    enabled: Boolean(campaignId),
    staleTime: 60_000,
  });
}

export interface RollTableResult {
  text?: string;
  entry?: { text?: string };
}

/** POST /api/roll-tables/:id/roll (§12) — server logs the result as an event. */
export function rollOnTable(tableId: string): Promise<RollTableResult> {
  return apiPost<RollTableResult>(`/api/roll-tables/${tableId}/roll`);
}

// ---------------------------------------------------------------------------
// Encounter hydration (LIVE-1)
// ---------------------------------------------------------------------------

/**
 * Encounter rows for the campaign. NOTE: this route serialises the encounter
 * WITHOUT its combatants, so it can pick which fight is live but can never
 * populate the tracker — reaching for it alone is what made a live encounter
 * with eight staged combatants render "no combatants yet".
 */
export function useEncounterList(campaignId: string | undefined) {
  return useQuery({
    queryKey: liveKeys.encounters(campaignId ?? ''),
    queryFn: async () =>
      (
        await apiGet<{ encounters: Encounter[] }>(`/api/campaigns/${campaignId}/encounters`)
      ).encounters,
    enabled: Boolean(campaignId),
    staleTime: 30_000,
  });
}

export interface TrackerEncounter {
  encounter: Encounter | null;
  /** False only while the first REST read is still in flight. */
  asked: boolean;
  failed: boolean;
}

/**
 * The fight the tracker draws, hydrated from REST and kept current by
 * `encounter.updated` on top.
 *
 * Precedence: a live event wins on the turn structure (it is newer than any
 * read), but a delta payload that carries no combatants must not blank the
 * roster — the hydrated rows are merged back under it. When the GM switches to
 * a different encounter mid-session the id changes and the read is redone.
 */
export function useTrackerEncounter(campaignId: string | undefined): TrackerEncounter {
  const qc = useQueryClient();
  const live = useLiveStore((s) => s.encounter);
  const query = useQuery({
    queryKey: liveKeys.encounter(campaignId ?? ''),
    queryFn: () => fetchLiveEncounter(campaignId as string),
    enabled: Boolean(campaignId),
    staleTime: 15_000,
  });
  const rest = query.data ?? null;
  const liveId = live?.id ?? null;
  const refetchedFor = useRef<string | null>(null);

  // A fight we have no roster for arrived over the socket: re-read once so its
  // combatants land. Once per id — the read may legitimately keep answering
  // with a different encounter (the socket can announce a PREP fight while a
  // different one is live), and retrying on every render would spin.
  useEffect(() => {
    if (!campaignId || !liveId) return;
    if (rest && rest.id === liveId) return;
    if (refetchedFor.current === liveId) return;
    refetchedFor.current = liveId;
    void qc.invalidateQueries({ queryKey: liveKeys.encounter(campaignId) });
  }, [campaignId, liveId, rest, qc]);

  const encounter = useMemo<Encounter | null>(() => {
    if (!live) return rest;
    if (live.combatants && live.combatants.length > 0) return live;
    if (rest && rest.id === live.id) {
      return { ...rest, ...live, ...(rest.combatants ? { combatants: rest.combatants } : {}) };
    }
    return live;
  }, [live, rest]);

  return {
    encounter,
    asked: query.isFetched || live !== null,
    failed: query.isError,
  };
}
