/**
 * The three Edge actions that are not extra dice (FR2.3, FR4.4) — Seize the
 * Initiative, Blitz, Close Call — as the sheet sees them.
 *
 * The engine and the routes are the server's (`services/rolls-edge.ts`,
 * `POST /api/edge/*`). This file holds the client half: which actions are
 * offerable right now, spotting the critical glitch that earns a Close Call
 * offer, and the three thin calls. Everything that decides is pure so it can
 * be tested without a socket.
 *
 * Seize and Blitz move a position in the initiative order, so they need the
 * character's live combatant row — `GET /api/characters/:id/derived` returns
 * `combatantId` when the tracker is running and null otherwise, which is
 * exactly the condition for offering them.
 */
import type { WsEvent } from '@safehouse/contracts';
import { apiPost } from '../../api/client.js';

export type EdgeActionId = 'seize_initiative' | 'blitz' | 'close_call';

export const EDGE_ACTION_LABELS: Record<EdgeActionId, string> = {
  seize_initiative: 'Seize the Initiative',
  blitz: 'Blitz',
  close_call: 'Close Call',
};

export const EDGE_ACTION_HINTS: Record<EdgeActionId, string> = {
  seize_initiative: 'Spend 1 Edge to act first in this pass.',
  blitz: 'Spend 1 Edge to re-roll initiative with 5d6.',
  close_call: 'Spend 1 Edge to negate the glitch on that roll.',
};

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Offerability (pure)
// ---------------------------------------------------------------------------

export interface EdgeContext {
  /** Current Edge on the sheet — every action costs exactly one point. */
  edgeCurrent: number;
  /** The character's row in the running encounter, when there is one. */
  combatantId: string | null;
}

/** Seize/Blitz need Edge in hand and a seat in a live encounter. */
export function canSeizeOrBlitz(ctx: EdgeContext): boolean {
  return ctx.edgeCurrent > 0 && Boolean(ctx.combatantId);
}

export interface CloseCallOffer {
  rollId: string;
  glitch: 'glitch' | 'critical';
  /** What the roll was called, for the offer's own sentence. */
  title: string;
  /** The event that carried it — the dismissal key. */
  eventId: number;
}

function rollTitle(payload: Record<string, unknown>): string {
  const meta = rec(rec(payload['request'])['meta']);
  return str(meta['title']) ?? str(payload['actorName']) ?? 'that roll';
}

/**
 * The most recent glitch this character rolled that nobody has bought off yet
 * (FR2.3 Close Call). Scanned newest-first over the live event buffer:
 *
 *  - `roll.created` whose `actor.characterId` is ours and whose `glitch` is a
 *    glitch or a critical glitch — the offer;
 *  - a later `log.posted` carrying `edgeAction: 'close_call'` for that roll
 *    means the point was already spent, so the offer is spent too;
 *  - `dismissed` holds the roll ids the player waved away this session.
 *
 * Returns null when there is nothing to offer, which is the common case.
 */
export function findCloseCallOffer(
  events: readonly WsEvent[],
  characterId: string,
  dismissed: ReadonlySet<string> = new Set(),
): CloseCallOffer | null {
  const answered = new Set<string>();
  for (const event of events) {
    if (event.type !== 'log.posted') continue;
    const p = rec(event.payload);
    if (p['edgeAction'] !== 'close_call') continue;
    const rollId = str(p['rollId']);
    if (rollId) answered.add(rollId);
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'roll.created') continue;
    const p = rec(event.payload);
    if (str(rec(p['actor'])['characterId']) !== characterId) continue;
    const glitch = p['glitch'];
    if (glitch !== 'glitch' && glitch !== 'critical') continue;
    const rollId = str(p['id']);
    if (!rollId || answered.has(rollId) || dismissed.has(rollId)) continue;
    return { rollId, glitch, title: rollTitle(p), eventId: event.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The calls (POST /api/edge/*)
// ---------------------------------------------------------------------------

export interface EdgeActionResponse {
  action: EdgeActionId;
  edge: { max: number; current: number };
  [key: string]: unknown;
}

export function seizeInitiative(combatantId: string): Promise<EdgeActionResponse> {
  return apiPost<EdgeActionResponse>('/api/edge/seize-initiative', { combatantId });
}

export function blitz(combatantId: string): Promise<EdgeActionResponse> {
  return apiPost<EdgeActionResponse>('/api/edge/blitz', { combatantId });
}

export function closeCall(
  rollId: string,
  combatantId?: string | null,
): Promise<EdgeActionResponse> {
  return apiPost<EdgeActionResponse>('/api/edge/close-call', {
    rollId,
    ...(combatantId ? { combatantId } : {}),
  });
}
