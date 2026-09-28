/**
 * Table-feature side effects: WS commands up (BUILD_CONVENTIONS "commands"),
 * REST helpers for what the command catalog doesn't cover, and small
 * optimistic patches on the live store (server events overwrite them).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Combatant, Encounter, InitiativeCall, InitiativeRecipe, RollTable, WsCommandInput } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client.js';
import { fetchEncounter, fetchEncounterList, fetchLiveEncounter, fetchRollTables, liveKeys } from '../../api/live.js';
import { pickEncounterId } from '../grid/hydration.js';
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

/** Roll initiative for everyone, or for the rows named (a player: only their own). */
export function postRollInitiative(encounterId: string, combatantIds?: string[]): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/roll-initiative`, combatantIds ? { combatantIds } : {});
}

/**
 * Hand-enter initiative (FR4.2): `rolled` is the dice total off the table and
 * the server adds base and wounds; `score` is the blunt override.
 */
export function postSetInitiative(
  combatantId: string,
  body: { score?: number; rolled?: number },
): Promise<unknown> {
  return apiPost(`/api/combatants/${combatantId}/initiative`, body);
}

export function patchEncounter(
  encounterId: string,
  patch: { name?: string; state?: 'prep' | 'live' | 'done'; sceneId?: string | null; handRolls?: boolean },
): Promise<unknown> {
  return apiPatch(`/api/encounters/${encounterId}`, patch);
}

/**
 * "Next ▸" over REST, so the button can wait for the answer. `expectedActorId`
 * is who this screen shows acting: a second press after the order moved on is refused.
 */
export function postAdvance(encounterId: string, expectedActorId: string | null): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/advance`, { expectedActorId });
}

/** The GM's levers on the order: a place, never a score (SR5 p.159-161). */
export type OrderMove = { move: { combatantId: string; toIndex: number } } | { actNow: string } | { sort: 'score' };

export function postOrder(encounterId: string, body: OrderMove): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/order`, body);
}

/** Hold a Delayed Action, or stop holding it (p.161). */
export function postDelay(combatantId: string, delayed: boolean): Promise<unknown> {
  return apiPost(`/api/combatants/${combatantId}/delay`, { delayed });
}

/** Drop one status effect (FR4.7). */
export function deleteEffect(combatantId: string, effectId: string): Promise<unknown> {
  return apiDelete(`/api/combatants/${combatantId}/effects/${effectId}`);
}

// ---------------------------------------------------------------------------
// Guided initiative: call, recipes, entries, NPCs, start
// ---------------------------------------------------------------------------

/** Call for initiative: turn 1 for a fight not yet live, else the next Combat Turn. */
export function postCallInitiative(encounterId: string): Promise<InitiativeCall> {
  return apiPost<InitiativeCall>(`/api/encounters/${encounterId}/initiative/call`);
}

/** The recipes: every row for the GM, a player's own runner only. */
export function fetchInitiativeCall(encounterId: string): Promise<InitiativeCall> {
  return apiGet<InitiativeCall>(`/api/encounters/${encounterId}/initiative`);
}

/** One row's score: app dice, the table's dice total, or a final score. */
export type InitiativeInput = { app: true } | { rolled: number } | { score: number };

export function postEnterInitiative(
  combatantId: string,
  input: InitiativeInput,
): Promise<{ recipe: InitiativeRecipe }> {
  return apiPost<{ recipe: InitiativeRecipe }>(`/api/combatants/${combatantId}/initiative/enter`, input);
}

/** App dice for every NPC row still blank. */
export function postRollNpcs(encounterId: string): Promise<InitiativeCall> {
  return apiPost<InitiativeCall>(`/api/encounters/${encounterId}/initiative/roll-npcs`);
}

/** Start the turn with whatever is in; blank rows join late (p.160). */
export function postStartTurn(encounterId: string): Promise<unknown> {
  return apiPost(`/api/encounters/${encounterId}/initiative/start`);
}

// ---------------------------------------------------------------------------
// Fight management (FR4.1, FR4.8 "dumb mode") — a fight with nothing but
// names and typed scores must work, from the tracker, with no other screen.
// ---------------------------------------------------------------------------

export function createEncounter(
  campaignId: string,
  name: string,
  sceneId?: string | null,
): Promise<Encounter> {
  return apiPost<{ encounter: Encounter }>(`/api/campaigns/${campaignId}/encounters`, {
    name,
    ...(sceneId ? { sceneId } : {}),
  }).then((r) => r.encounter);
}

export function deleteEncounter(encounterId: string): Promise<unknown> {
  return apiDelete(`/api/encounters/${encounterId}`);
}

export interface HandCombatantInput {
  name: string;
  initBase: number;
  initDice: number;
  initKind: Combatant['initKind'];
  /** GM-only rows never reach a player (FR4.9). */
  hidden: boolean;
  physicalBoxes: number;
  stunBoxes: number;
}

/** A row typed in by hand: a name, a line, its boxes (FR4.8). */
export function addCombatant(encounterId: string, input: HandCombatantInput): Promise<Combatant> {
  return apiPost<{ combatant: Combatant }>(`/api/encounters/${encounterId}/combatants`, {
    source: 'manual',
    name: input.name,
    initBase: input.initBase,
    initDice: input.initDice,
    initKind: input.initKind,
    visibility: input.hidden ? 'gm' : 'public',
    monitors: {
      physical: { max: input.physicalBoxes, filled: 0 },
      stun: { max: input.stunBoxes, filled: 0 },
      overflow: { max: 0, filled: 0 },
    },
  }).then((r) => r.combatant);
}

export function deleteCombatant(combatantId: string): Promise<unknown> {
  return apiDelete(`/api/combatants/${combatantId}`);
}

/** Drop a row from the roster on screen ahead of the server's word. */
export function removeCombatantLocal(combatantId: string): void {
  const enc = useLiveStore.getState().encounter;
  if (!enc?.combatants) return;
  useLiveStore.setState({
    encounter: { ...enc, combatants: enc.combatants.filter((c) => c.id !== combatantId) },
  });
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

/** The scene's fight with its rows, or null when it has none. */
async function fetchSceneEncounter(campaignId: string, sceneId: string): Promise<Encounter | null> {
  const id = pickEncounterId(await fetchEncounterList(campaignId), sceneId);
  return id ? fetchEncounter(id) : null;
}

export interface TrackerEncounter {
  encounter: Encounter | null;
  /** False only while the first REST read is still in flight. */
  asked: boolean;
  /** The REST read itself has answered (the socket alone does not count). */
  fetched: boolean;
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
export function useTrackerEncounter(
  campaignId: string | undefined,
  /** A fight the GM picked by hand (the picker); null follows "the live one". */
  pickedId: string | null = null,
  /** The map's scene: follow that scene's fight (`pickEncounterId`) instead. */
  sceneId: string | null = null,
): TrackerEncounter {
  const qc = useQueryClient();
  const live = useLiveStore((s) => s.encounter);
  const key = liveKeys.encounter(campaignId ?? '');
  const query = useQuery({
    queryKey: pickedId ? [...key, pickedId] : sceneId ? [...key, 'scene', sceneId] : key,
    queryFn: () =>
      pickedId
        ? fetchEncounter(pickedId)
        : sceneId
          ? fetchSceneEncounter(campaignId as string, sceneId)
          : fetchLiveEncounter(campaignId as string),
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
    if (!campaignId || !liveId || pickedId) return;
    if (rest && rest.id === liveId) return;
    if (refetchedFor.current === liveId) return;
    refetchedFor.current = liveId;
    void qc.invalidateQueries({ queryKey: liveKeys.encounter(campaignId) });
  }, [campaignId, liveId, rest, qc, pickedId]);

  const encounter = useMemo<Encounter | null>(() => {
    // A picked fight (or the scene's) is the one on screen whatever the socket is announcing.
    const target = pickedId ?? (sceneId ? (rest?.id ?? null) : null);
    if (target && live && live.id !== target) return rest;
    // A scene with no fight yet shows none, not another scene's prep fight off the socket.
    if (sceneId && !pickedId && !rest && live && live.sceneId !== sceneId && live.state !== 'live') return null;
    if (!live) return rest;
    if (live.combatants && live.combatants.length > 0) return live;
    if (rest && rest.id === live.id) {
      return { ...rest, ...live, ...(rest.combatants ? { combatants: rest.combatants } : {}) };
    }
    return live;
  }, [live, rest, pickedId, sceneId]);

  return {
    encounter,
    asked: query.isFetched || live !== null,
    fetched: query.isFetched,
    failed: query.isError,
  };
}
