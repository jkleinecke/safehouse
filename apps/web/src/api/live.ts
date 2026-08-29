/**
 * REST reads that back the live views (LIVE-1 hydration).
 *
 * Every one of these answers the question "what does the server already hold?"
 * — the question the web app never used to ask. They are deliberately plain
 * fetchers with no React in them: the hydration hook drives them through
 * TanStack Query, and tests drive them directly against a stubbed `fetch`.
 *
 * Each reader is defensive about the response shape. The encounters domain is
 * still settling where `state` / `turn` / `pass` live in the payload, so
 * `normalizeEncounter` accepts every variant rather than guessing one.
 */
import type { Encounter, RollTable, WsEvent } from '@safehouse/contracts';
import { normalizeEncounter, pickLiveEncounter, rec } from '../live/merge.js';
import { apiGet } from './client.js';
import type { CampaignSummary } from './campaigns.js';

/** How much log history a fresh mount backfills (server caps at 500). */
export const LOG_BACKFILL_LIMIT = 200;

/**
 * Query keys. The first three intentionally match the keys the feature hooks
 * already use (`useCampaign`, `useEncounterList`, `useRollTables`) so one
 * hydration pass warms the caches those hooks read.
 */
export const liveKeys = {
  campaign: (campaignId: string) => ['campaign', campaignId] as const,
  encounters: (campaignId: string) => ['encounters', campaignId] as const,
  rollTables: (campaignId: string) => ['roll-tables', campaignId] as const,
  log: (campaignId: string) => ['live', 'log', campaignId] as const,
  encounter: (encounterId: string) => ['live', 'encounter', encounterId] as const,
  session: (campaignId: string) => ['live', 'session', campaignId] as const,
};

// ---------------------------------------------------------------------------
// Session log (FR2.9)
// ---------------------------------------------------------------------------

/**
 * `GET /api/campaigns/:id/log` — the interleaved log, already visibility
 * filtered server-side (Principle 4). The route answers NEWEST FIRST; the log
 * renders oldest → newest, so the order is flipped here, once, rather than in
 * every consumer.
 */
export async function fetchSessionLog(
  campaignId: string,
  limit: number = LOG_BACKFILL_LIMIT,
): Promise<WsEvent[]> {
  const res = await apiGet<{ events?: unknown }>(
    `/api/campaigns/${campaignId}/log?limit=${Math.max(1, Math.min(500, limit))}`,
  );
  const raw = Array.isArray(res?.events) ? (res.events as unknown[]) : [];
  const events = raw.filter(
    (e): e is WsEvent => typeof rec(e)['id'] === 'number' && typeof rec(e)['type'] === 'string',
  );
  // Sort rather than reverse: the merge is order-insensitive anyway, but an
  // ascending window keeps the log stable if the route's order ever changes.
  return events.slice().sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Encounters (FR4.1–4.10)
// ---------------------------------------------------------------------------

/** `GET /api/campaigns/:id/encounters` — list rows; combatants are NOT here. */
export async function fetchEncounterList(campaignId: string): Promise<Encounter[]> {
  const res = await apiGet<{ encounters?: unknown }>(`/api/campaigns/${campaignId}/encounters`);
  const raw = Array.isArray(res?.encounters) ? (res.encounters as unknown[]) : [];
  return raw
    .map((e) => normalizeEncounter(e))
    .filter((e): e is Encounter => e !== null);
}

/**
 * `GET /api/encounters/:id` — the composed view: the encounter row, its
 * combatants (full for a GM, the reduced player projection otherwise), the
 * acting combatant and the turn structure.
 */
export async function fetchEncounter(encounterId: string): Promise<Encounter | null> {
  const res = await apiGet<unknown>(`/api/encounters/${encounterId}`);
  return normalizeEncounter(res, encounterId);
}

/**
 * The fight the tracker should show, combatants included — two hops, because
 * the list route carries no combatants and the detail route needs an id.
 * Returns `null` when the campaign has no encounters at all (an honest empty).
 */
export async function fetchLiveEncounter(campaignId: string): Promise<Encounter | null> {
  const list = await fetchEncounterList(campaignId);
  const chosen = pickLiveEncounter(list);
  if (!chosen) return null;
  const full = await fetchEncounter(chosen.id);
  return full ?? chosen;
}

// ---------------------------------------------------------------------------
// Campaign + live mode (FR1.5, FR6.2)
// ---------------------------------------------------------------------------

export async function fetchCampaign(campaignId: string): Promise<CampaignSummary> {
  return apiGet<CampaignSummary>(`/api/campaigns/${campaignId}`);
}

export interface LiveModeInfo {
  live: boolean;
  sessionId: string | null;
  /** Sockets currently in this campaign's room — presence, coarsely. */
  connected: number;
}

/** `GET /api/campaigns/:id/live` — live-mode flag and connected device count. */
export async function fetchLiveMode(campaignId: string): Promise<LiveModeInfo> {
  const res = await apiGet<Record<string, unknown>>(`/api/campaigns/${campaignId}/live`);
  const o = rec(res);
  return {
    live: o['live'] === true,
    sessionId: typeof o['sessionId'] === 'string' ? o['sessionId'] : null,
    connected: typeof o['connected'] === 'number' ? o['connected'] : 0,
  };
}

// ---------------------------------------------------------------------------
// Rollable tables (FR2.11)
// ---------------------------------------------------------------------------

export async function fetchRollTables(campaignId: string): Promise<RollTable[]> {
  const res = await apiGet<{ tables?: unknown }>(`/api/campaigns/${campaignId}/roll-tables`);
  return Array.isArray(res?.tables) ? (res.tables as RollTable[]) : [];
}
