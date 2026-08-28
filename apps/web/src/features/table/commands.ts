/**
 * Table-feature side effects: WS commands up (BUILD_CONVENTIONS "commands"),
 * REST helpers for what the command catalog doesn't cover, and small
 * optimistic patches on the live store (server events overwrite them).
 */
import { useQuery } from '@tanstack/react-query';
import type { Combatant, RollTable, WsCommandInput } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost } from '../../api/client.js';
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
 *  visibility-filtered server-side. */
export function useRollTables(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['roll-tables', campaignId],
    queryFn: async () =>
      (await apiGet<{ tables: RollTable[] }>(`/api/campaigns/${campaignId}/roll-tables`)).tables,
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
// Encounter bootstrap — the store only hears future `encounter.updated`s
// ---------------------------------------------------------------------------

/** Encounters for the campaign, combatants included. */
export function useEncounterList(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ encounters: import('@safehouse/contracts').Encounter[] }>(
          `/api/campaigns/${campaignId}/encounters`,
        )
      ).encounters,
    enabled: Boolean(campaignId),
    staleTime: 30_000,
  });
}
