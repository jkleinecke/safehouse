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
import { conditionBand, visibleCombatants, type ConditionBand } from '../table/initiative.js';

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
 * INTEGRATION: payload field names assumed (`title`/`name`, `text`/`body`,
 * `attachmentId`) — align with the scenes/codex agents. P1 renders a
 * placeholder region; P2 drops the real asset in.
 */
export function tvTakeover(events: WsEvent[]): TvTakeover | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e) continue;
    if (e.type !== 'handout.revealed' && e.type !== 'wiki.revealed') continue;
    if (e.visibility !== 'public') continue;
    const p = rec(e.payload);
    return {
      id: e.id,
      ts: e.ts,
      kind: e.type === 'handout.revealed' ? 'handout' : 'codex',
      title: str(p['title']) ?? str(p['name']) ?? (e.type === 'handout.revealed' ? 'Handout' : 'Codex page'),
      ...(str(p['body']) ?? str(p['text'])
        ? { body: (str(p['body']) ?? str(p['text'])) as string }
        : {}),
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

export interface TvRibbonRow {
  id: string;
  name: string;
  score: number;
  order: number;
  acting: boolean;
  acted: boolean;
  band: ConditionBand;
}

/** Ribbon width — a TV shows the top of the order, not a spreadsheet. */
export const TV_RIBBON_CAP = 10;

/** Public combatants in acting order; the acting one is flagged for the glow. */
export function tvRibbon(
  encounter: Encounter | null | undefined,
  cap: number = TV_RIBBON_CAP,
): TvRibbonRow[] {
  const all = visibleCombatants(encounter?.combatants ?? [], { role: 'display' });
  const live = all.filter((c) => c.initScore > 0);
  const pool = live.length > 0 ? live : all;
  const sorted = [...pool].sort(
    (a, b) => b.initScore - a.initScore || b.initBase - a.initBase || (a.id < b.id ? -1 : 1),
  );
  const actingId =
    encounter?.activeCombatantId ?? sorted.find((c) => !c.actedThisPass)?.id ?? null;
  return sorted.slice(0, cap).map((c, i) => ({
    id: c.id,
    name: c.name,
    score: c.initScore,
    order: i + 1,
    acting: c.id === actingId,
    acted: c.actedThisPass,
    band: conditionBand(c.monitors),
  }));
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
 * INTEGRATION: `display.updated` is not in the §11 catalog yet — the GM
 * console agent should emit it (payload `{ blank?: boolean, ribbon?: boolean }`)
 * for FR9.21. Until then the TV just runs with the defaults.
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
