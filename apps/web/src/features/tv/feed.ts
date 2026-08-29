/**
 * Pure projection of the live event buffer into what the table TV shows
 * (FR9.19–9.21, P1 scope). No React, no timers — the kiosk component owns
 * the clock so nothing here depends on wall time or server clock skew.
 *
 * Everything is bounded: the store already caps the event buffer, and every
 * list produced here is capped again. The TV runs for a six-hour session
 * without anyone touching it, so nothing may grow without a lid.
 */
import type { Encounter, WsEvent } from '@safehouse/contracts';
import { parseRoll, rec, type GlitchState } from '../table/views.js';
import {
  TV_RIBBON_CAP,
  tvEncounterFrom,
  tvRibbonRows,
  type TvRibbonRow,
} from './encounterState.js';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

// ---------------------------------------------------------------------------
// Big dice moments (FR9.20)
// ---------------------------------------------------------------------------

export interface TvMoment {
  id: number;
  ts: string;
  actorName: string;
  label?: string;
  pool: number;
  faces: number[];
  exploded: number[];
  hits: number;
  limitedHits: number;
  glitch: GlitchState;
  limit?: { kind: string; value: number };
  bought: boolean;
  burnedEdge: boolean;
  edge?: string | null;
  /**
   * The GM asked for this one on the big screen (FR9.20 "dice results the GM
   * flags"). The canonical flag is `meta.tv`; `meta.spotlight` and `meta.big`
   * are accepted as synonyms so a roll posted by hand with a plausible name
   * still lands. Emphasis only — every public roll already reaches the TV, so
   * an unflagged one is shown, just not shouted.
   */
  flagged: boolean;
}

/** Did the GM flag this roll for the table display? */
export function isFlaggedMeta(meta: Record<string, unknown>): boolean {
  return meta['tv'] === true || meta['spotlight'] === true || meta['big'] === true;
}

/** How many recent moments the kiosk keeps around at once. */
export const TV_MOMENT_CAP = 8;

/**
 * Public rolls, oldest → newest, capped. A `display` socket only ever
 * receives player-visible events (Principle 4); the visibility check here is
 * the honest second layer, not the security boundary.
 */
export function tvMoments(events: WsEvent[], cap: number = TV_MOMENT_CAP): TvMoment[] {
  const out: TvMoment[] = [];
  for (const e of events) {
    if (e.type !== 'roll.created' || e.visibility !== 'public') continue;
    const roll = parseRoll(e);
    if (!roll) continue;
    out.push({
      id: roll.eventId,
      ts: roll.ts,
      actorName: roll.actorName,
      ...(roll.label !== undefined ? { label: roll.label } : {}),
      pool: roll.pool,
      faces: roll.faces,
      exploded: roll.exploded,
      hits: roll.hits,
      limitedHits: roll.limitedHits,
      glitch: roll.glitch,
      ...(roll.limit !== undefined ? { limit: roll.limit } : {}),
      bought: roll.bought,
      burnedEdge: roll.burnedEdge,
      edge: roll.edge,
      flagged: isFlaggedMeta(roll.meta),
    });
    if (out.length > cap) out.shift();
  }
  return out;
}

/** The newest public roll, or null. */
export function latestMoment(events: WsEvent[]): TvMoment | null {
  const list = tvMoments(events, 1);
  return list[0] ?? null;
}

/** Glitches get drama; so does a burned point of Edge. */
export function momentDrama(moment: TvMoment): 'critical' | 'glitch' | 'edge' | 'none' {
  if (moment.glitch === 'critical') return 'critical';
  if (moment.glitch === 'glitch') return 'glitch';
  if (moment.burnedEdge || moment.edge) return 'edge';
  return 'none';
}

// ---------------------------------------------------------------------------
// Handout / codex takeover (FR9.20)
// ---------------------------------------------------------------------------

export interface TvTakeover {
  id: number;
  ts: string;
  kind: 'handout' | 'codex';
  title: string;
  body?: string;
  /** File-store id of the revealed image/PDF, when the payload carries one. */
  attachmentId?: string;
}

/**
 * The newest reveal, or null.
 *
 * The two events name things differently, which is why this reads a list
 * rather than one field: `wiki.revealed` carries `title` (plugins/codex.ts),
 * `handout.revealed` carries `pageTitle` and an optional `note`. `name` /
 * `text` / `body` are tolerated so a hand-posted reveal still shows something
 * better than "Handout".
 */
export function tvTakeover(events: WsEvent[]): TvTakeover | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e) continue;
    if (e.type !== 'handout.revealed' && e.type !== 'wiki.revealed') continue;
    if (e.visibility !== 'public') continue;
    const p = rec(e.payload);
    const title = str(p['title']) ?? str(p['pageTitle']) ?? str(p['name']);
    const body = str(p['body']) ?? str(p['text']) ?? str(p['note']);
    return {
      id: e.id,
      ts: e.ts,
      kind: e.type === 'handout.revealed' ? 'handout' : 'codex',
      title: title ?? (e.type === 'handout.revealed' ? 'Handout' : 'Codex page'),
      ...(body ? { body } : {}),
      ...(str(p['attachmentId']) ? { attachmentId: str(p['attachmentId']) as string } : {}),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Idle card: scene + in-game date (FR9.20)
// ---------------------------------------------------------------------------

export interface TvScene {
  id: string | null;
  name: string | null;
}

/** Scene identity from the newest `scene.activated`, or null. */
export function tvScene(events: WsEvent[]): TvScene | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e || e.type !== 'scene.activated') continue;
    const p = rec(e.payload);
    const scene = rec(p['scene']);
    return {
      id: str(p['sceneId']) ?? str(p['id']) ?? str(scene['id']) ?? null,
      name: str(p['name']) ?? str(p['sceneName']) ?? str(scene['name']) ?? null,
    };
  }
  return null;
}

/** In-game date from the newest `clock.advanced`, or null. */
export function tvIngameDate(events: WsEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e || e.type !== 'clock.advanced') continue;
    const p = rec(e.payload);
    return str(p['ingameDate']) ?? str(p['date']) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Initiative ribbon (FR9.20)
// ---------------------------------------------------------------------------

/**
 * The ribbon itself lives in `encounterState.ts`, because on a display device
 * the roster does NOT arrive inside the encounter object — it rides beside it
 * in the public `encounter.updated` delta and in `GET /api/encounters/:id`.
 * These two are the typed-`Encounter` doorway into it.
 */
export { TV_RIBBON_CAP, type TvRibbonRow } from './encounterState.js';

/** Public combatants in acting order; the acting one is flagged for the glow. */
export function tvRibbon(
  encounter: Encounter | null | undefined,
  cap: number = TV_RIBBON_CAP,
): TvRibbonRow[] {
  return tvRibbonRows(tvEncounterFrom(encounter), cap);
}

/** True when the TV should switch from the idle card to the fight. */
export function isEncounterLive(encounter: Encounter | null | undefined): boolean {
  if (!encounter) return false;
  if (encounter.state === 'done') return false;
  const rows = encounter.combatants ?? [];
  return encounter.state === 'live' && rows.length > 0;
}

// ---------------------------------------------------------------------------
// GM steering (FR9.21)
// ---------------------------------------------------------------------------

export interface TvControls {
  /** One-tap "blank the table". */
  blank: boolean;
  /** Per-layer toggle: hide the ribbon during pure roleplay. */
  ribbon: boolean;
}

export const DEFAULT_TV_CONTROLS: TvControls = { blank: false, ribbon: true };

/**
 * GM steering state from the newest `display.updated` event.
 *
 * `display.updated` is emitted by the hub's `display.set` handler (GM-only,
 * public visibility) carrying the FULL state, so the newest event is always
 * the whole answer — which is what lets a kiosk that rebooted mid-session come
 * back blanked if that is how the GM left it.
 */
export function tvControls(events: WsEvent[]): TvControls {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e || e.type !== 'display.updated') continue;
    const p = rec(e.payload);
    return {
      blank: p['blank'] === true,
      ribbon: p['ribbon'] !== false,
    };
  }
  return DEFAULT_TV_CONTROLS;
}
