/**
 * The TV's scene model: a REST snapshot with the live event stream folded on
 * top (FR9.20).
 *
 * Hydration is the whole point. A display device is rebooted, unplugged, or
 * simply opened halfway through a session; if it renders only the events that
 * arrive while it happens to be mounted, it shows an empty world beside a
 * table mid-firefight. So the TV reads `GET /api/scenes/:id` on mount and after
 * every reconnect, and treats the WS stream as a delta on that read — never as
 * the source of truth for state that existed before it connected.
 *
 * Idempotence is the contract: every fold below is a *set*, not an increment,
 * so replaying an event the snapshot already reflects is harmless. That is what
 * lets `asOfEventId` be captured pessimistically (before the fetch is issued)
 * without any risk of double-application.
 *
 * Secrecy (Principle 4): hidden tokens and unrevealed fog never reach this
 * device — the server filtered both before serializing. The `visibility` check
 * in the fold is defence in depth, not the boundary.
 */
import type { FogRegion, Point, Scene, Token, WsEvent } from '@safehouse/contracts';
import { rec } from '../table/views.js';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** A hydrated scene plus the point in the event stream it already reflects. */
export interface TvSceneSnapshot {
  scene: Scene;
  tokens: Token[];
  /** Highest event id the REST read is guaranteed to include. */
  asOfEventId: number;
}

/**
 * Freeform reveals accumulate only between refetches (the next REST read is
 * authoritative), but a six-hour session must still not grow a list forever.
 */
export const REVEALED_SHAPE_CAP = 500;

function shapeKey(poly: readonly Point[]): string {
  const first = poly[0];
  const last = poly[poly.length - 1];
  return `${poly.length}:${first?.x ?? 0},${first?.y ?? 0}:${last?.x ?? 0},${last?.y ?? 0}`;
}

function asPolygon(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out: Point[] = [];
  for (const raw of v) {
    const p = rec(raw);
    const x = num(p['x']);
    const y = num(p['y']);
    if (x === undefined || y === undefined) return null;
    out.push({ x, y });
  }
  return out;
}

function asRegion(v: unknown): FogRegion | null {
  const raw = rec(v);
  const id = str(raw['id']);
  const polygon = asPolygon(raw['polygon']);
  if (!id || !polygon) return null;
  return { id, name: str(raw['name']) ?? 'region', polygon };
}

const TOKEN_SOURCES = new Set<Token['source']>(['character', 'combatant', 'npc_template', 'prop']);

function asToken(v: unknown): Token | null {
  const raw = rec(v);
  const id = str(raw['id']);
  const sceneId = str(raw['sceneId']);
  const x = num(raw['x']);
  const y = num(raw['y']);
  if (!id || !sceneId || x === undefined || y === undefined) return null;
  const source = str(raw['source']) as Token['source'] | undefined;
  const bars = str(raw['barsVisibility']);
  return {
    ...(raw as unknown as Token),
    id,
    sceneId,
    x,
    y,
    // An unknown enum value would index a colour table with `undefined` inside
    // the renderer, so it is normalised here rather than at the draw call.
    source: source && TOKEN_SOURCES.has(source) ? source : 'prop',
    name: str(raw['name']) ?? 'token',
    size: num(raw['size']) ?? 1,
    rotation: num(raw['rotation']) ?? 0,
    level: 0,
    barsVisibility: bars === 'gm' || bars === 'owner' || bars === 'public' ? bars : 'owner',
    hidden: raw['hidden'] === true,
  };
}

/** Mutable working copy of the fold, so one pass allocates one result. */
interface Draft {
  tokens: Token[];
  fogRegions: FogRegion[];
  revealed: string[];
  revealedShapes: Point[][];
  environment: Scene['environment'];
  changed: boolean;
}

function upsertToken(draft: Draft, token: Token): void {
  const i = draft.tokens.findIndex((t) => t.id === token.id);
  if (i >= 0) draft.tokens[i] = token;
  else draft.tokens.push(token);
  draft.changed = true;
}

function revealRegion(draft: Draft, region: FogRegion | null, regionId: string | undefined): void {
  const id = region?.id ?? regionId;
  if (!id) return;
  if (region && !draft.fogRegions.some((r) => r.id === region.id)) {
    draft.fogRegions.push(region);
    draft.changed = true;
  }
  if (!draft.revealed.includes(id)) {
    draft.revealed.push(id);
    draft.changed = true;
  }
}

function hideRegion(draft: Draft, regionId: string | undefined): void {
  if (!regionId) return;
  const before = draft.revealed.length + draft.fogRegions.length;
  draft.revealed = draft.revealed.filter((r) => r !== regionId);
  // A player view only ever holds revealed regions, so hiding drops the
  // geometry too — the shape itself is GM knowledge again.
  draft.fogRegions = draft.fogRegions.filter((r) => r.id !== regionId);
  if (draft.revealed.length + draft.fogRegions.length !== before) draft.changed = true;
}

function addShape(draft: Draft, shape: Point[] | null, seen: Set<string>): void {
  if (!shape) return;
  const key = shapeKey(shape);
  if (seen.has(key)) return;
  seen.add(key);
  draft.revealedShapes.push(shape);
  if (draft.revealedShapes.length > REVEALED_SHAPE_CAP) draft.revealedShapes.shift();
  draft.changed = true;
}

/**
 * Fold every applicable event newer than the snapshot into a fresh snapshot.
 * Returns `base` itself when nothing applied, so React memoisation and the
 * stage's diffing both see a stable identity between idle renders.
 */
export function mergeSceneEvents(
  base: TvSceneSnapshot | null,
  events: readonly WsEvent[],
): TvSceneSnapshot | null {
  if (!base) return null;
  const sceneId = base.scene.id;

  const draft: Draft = {
    tokens: base.tokens.slice(),
    fogRegions: base.scene.fog.regions.slice(),
    revealed: base.scene.fog.revealed.slice(),
    revealedShapes: base.scene.fog.revealedShapes.slice(),
    environment: base.scene.environment,
    changed: false,
  };
  const seenShapes = new Set(draft.revealedShapes.map(shapeKey));

  for (const event of events) {
    if (event.id <= base.asOfEventId) continue;
    // A display socket is never sent a non-public event; refusing one here
    // means a stale or mis-scoped buffer still cannot paint GM state.
    if (event.visibility !== 'public') continue;
    const p = rec(event.payload);
    if (str(p['sceneId']) !== undefined && str(p['sceneId']) !== sceneId) continue;

    switch (event.type) {
      case 'token.added':
      case 'token.updated': {
        const token = asToken(p['token']);
        if (token && token.sceneId === sceneId && !token.hidden) upsertToken(draft, token);
        break;
      }
      case 'token.moved': {
        const tokenId = str(p['tokenId']) ?? str(rec(p['token'])['id']);
        const x = num(p['x']) ?? num(rec(p['token'])['x']);
        const y = num(p['y']) ?? num(rec(p['token'])['y']);
        if (!tokenId || x === undefined || y === undefined) break;
        const i = draft.tokens.findIndex((t) => t.id === tokenId);
        const current = draft.tokens[i];
        if (i < 0 || !current) break;
        const rotation = num(p['rotation']) ?? current.rotation;
        draft.tokens[i] = { ...current, x, y, rotation };
        draft.changed = true;
        break;
      }
      case 'token.removed': {
        const tokenId = str(p['tokenId']);
        if (!tokenId) break;
        const next = draft.tokens.filter((t) => t.id !== tokenId);
        if (next.length !== draft.tokens.length) {
          draft.tokens = next;
          draft.changed = true;
        }
        break;
      }
      case 'fog.updated': {
        const op = str(p['op']) ?? 'reveal';
        if (op === 'reveal') {
          revealRegion(draft, asRegion(p['region']), str(p['regionId']));
          addShape(draft, asPolygon(p['shape']), seenShapes);
        } else if (op === 'hide') {
          hideRegion(draft, str(p['regionId']));
        }
        // 'define' is GM-visibility and never arrives here.
        break;
      }
      case 'scene.updated': {
        const env = p['environment'];
        if (env && typeof env === 'object') {
          draft.environment = { ...draft.environment, ...(env as Scene['environment']) };
          draft.changed = true;
        }
        break;
      }
      default:
        break;
    }
  }

  if (!draft.changed) return base;
  return {
    asOfEventId: base.asOfEventId,
    tokens: draft.tokens,
    scene: {
      ...base.scene,
      environment: draft.environment,
      fog: {
        regions: draft.fogRegions,
        revealed: draft.revealed,
        revealedShapes: draft.revealedShapes,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Which scene is on the table
// ---------------------------------------------------------------------------

/**
 * The campaign's active scene id: the newest `scene.activated` in the buffer,
 * else whatever the REST read said. The event wins because a TV that has been
 * connected since before the switch has newer information than a cached query.
 */
export function tvActiveSceneId(
  events: readonly WsEvent[],
  fallback: string | null | undefined,
): string | null {
  // Selected by highest event id, not by array position. The live store keeps
  // its buffer ascending, but "which map is on the table" is the one answer
  // that must not depend on that invariant holding at every call site.
  let bestId = -1;
  let best: string | null = null;
  for (const e of events) {
    if (e.type !== 'scene.activated' || e.visibility !== 'public' || e.id <= bestId) continue;
    const p = rec(e.payload);
    const id = str(p['sceneId']) ?? str(p['id']) ?? str(rec(p['scene'])['id']);
    if (!id) continue;
    bestId = e.id;
    best = id;
  }
  return best ?? fallback ?? null;
}

// ---------------------------------------------------------------------------
// Staged fog reveals (FR9.14 → FR9.20 "staged reveals animate in")
// ---------------------------------------------------------------------------

export interface TvReveal {
  id: number;
  ts: string;
  name: string;
}

/** The newest named region reveal, for the announcement sweep. */
export function tvReveal(events: readonly WsEvent[]): TvReveal | null {
  let best: TvReveal | null = null;
  for (const e of events) {
    if (e.type !== 'fog.updated' || e.visibility !== 'public') continue;
    if (best && e.id <= best.id) continue;
    const p = rec(e.payload);
    if ((str(p['op']) ?? 'reveal') !== 'reveal') continue;
    const name = str(rec(p['region'])['name']);
    if (!name) continue;
    best = { id: e.id, ts: e.ts, name };
  }
  return best;
}
