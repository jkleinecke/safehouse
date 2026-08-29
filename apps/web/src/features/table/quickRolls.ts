/**
 * `GET /api/combatants/:id/quick-rolls` — the GM-only read behind an NPC row.
 *
 * One response carries two things the tracker renders in two places: the
 * copilot rack's pools (FR10.7) and, when the campaign has asked for them, the
 * acting NPC's tactical hint (FR10.10). They share a cache entry deliberately —
 * a second request for the same row on every tick would be a request per
 * combatant per pass, and the hint is a by-product of a read the rack already
 * makes.
 *
 * The key and the query options live here rather than in either component so
 * the two observers cannot drift apart: two `useQuery` calls with the same key
 * but different `staleTime` quietly become the *shortest* of the two, which is
 * the kind of thing that turns one request into a poll.
 */
import { useQuery } from '@tanstack/react-query';
import type { LimitRef, ProvenanceEntry } from '@safehouse/contracts';
import { apiGet } from '../../api/client.js';

/** One rollable row as the server offers it. */
export interface RackEntry {
  /** Stable id the quick-roll endpoint takes (`attack:Beretta`, `defense`, …). */
  key: string;
  kind: string;
  label: string;
  pool: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  weapon?: { name: string; dv: string | null; ap: number };
}

/**
 * FR10.10's whole payload: a sentence, the tag it came from, and why.
 *
 * Note what is NOT here — no id, no target, no verb, nothing to POST. The hint
 * is advice for the person running the NPC and there is deliberately nothing to
 * "apply", which is the FR's line about never automating the opposition
 * expressed as a type. `advisoryOnly` is restated on the wire so no client can
 * mistake it for an action.
 */
export interface TacticalHint {
  roleTag: string;
  text: string;
  /** Provenance, in the Principle 3 spirit: where this line came from. */
  why: string;
  advisoryOnly: true;
}

export interface QuickRolls {
  combatantId: string;
  woundModifier: number;
  entries: RackEntry[];
  sceneModifiers: ProvenanceEntry[];
  /**
   * Present only for a GM device, on a generator-backed row, in a campaign
   * that turned hints on. Absent is the normal case (FR10.10 is off by
   * default) — never an error.
   */
  hint?: TacticalHint;
}

export const quickRollsKey = (combatantId: string) =>
  ['combatant', combatantId, 'quick-rolls'] as const;

export function useQuickRolls(combatantId: string, enabled = true) {
  return useQuery({
    queryKey: quickRollsKey(combatantId),
    queryFn: () => apiGet<QuickRolls>(`/api/combatants/${combatantId}/quick-rolls`),
    enabled,
    // A hand-added combatant has no copilot config and answers 404/empty; that
    // is a normal state, not something to retry at.
    retry: false,
    staleTime: 10_000,
  });
}
