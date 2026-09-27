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
import type { FogRegion, FogRevealAs, Point, Scene, Token, WsEvent } from '@safehouse/contracts';
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
    // The floor comes off the wire like everything else. Hard-coding 0 here
    // silently sent every runner back to the ground the moment a live event
    // touched them, so a token that took the stairs would walk back down on
    // the next update — with nothing on screen to say it had.
    level: num(raw['level']) ?? 0,
    barsVisibility: bars === 'gm' || bars === 'owner' || bars === 'public' ? bars : 'owner',
    hidden: raw['hidden'] === true,
  };
}

/** Mutable working copy of the fold, so one pass allocates one result. */
interface Draft {
  tokens: Token[];
  fogRegions: FogRegion[];
  /** Regions revealed LIVE. */
  revealed: string[];
  revealedShapes: Point[][];
  /**
   * Regions and shapes revealed AS EXPLORED (P6): shown dimmed, as
   * remembered, with nobody on them. A region is in this list or in
   * `revealed`, never both: a reveal in one fashion takes it out of the other.
   */
  exploredRegionIds: string[];
  exploredShapes: Point[][];
  /** Whether the scene is fogged at all (`FogState.active`): kept as the snapshot said it until an event says otherwise. */
  fogActive: boolean | undefined;
  environment: Scene['environment'];
  changed: boolean;
}

/** An event's word on whether the scene is fogged at all, when it carries one. */
function noteFogActive(draft: Draft, v: unknown): void {
  if (typeof v !== 'boolean' || v === draft.fogActive) return;
  draft.fogActive = v;
  draft.changed = true;
}

/** A revealed region redrawn (a public `define`): its new shape, where the TV holds it. */
function reshapeRegion(draft: Draft, region: FogRegion | null): void {
  if (!region) return;
  const i = draft.fogRegions.findIndex((r) => r.id === region.id);
  if (i < 0) return;
  draft.fogRegions[i] = region;
  draft.changed = true;
}

/**
 * The GM's reset: nothing is revealed any more, in either fashion, the scene
 * still fogged (the server's `hide` with no region).
 */
function hideAll(draft: Draft): void {
  const held =
    draft.revealed.length +
    draft.fogRegions.length +
    draft.revealedShapes.length +
    draft.exploredRegionIds.length +
    draft.exploredShapes.length;
  if (held === 0) return;
  draft.revealed = [];
  draft.fogRegions = [];
  draft.revealedShapes = [];
  draft.exploredRegionIds = [];
  draft.exploredShapes = [];
  draft.changed = true;
}

function upsertToken(draft: Draft, token: Token): void {
  const i = draft.tokens.findIndex((t) => t.id === token.id);
  if (i >= 0) draft.tokens[i] = token;
  else draft.tokens.push(token);
  draft.changed = true;
}

/**
 * The fashion a reveal event says it is (`as`, P6): `explored` shows the
 * ground dimmed with nobody on it, anything else (and an event from before
 * explored reveals, which says nothing) is live.
 */
function fashionOf(v: unknown): FogRevealAs {
  return v === 'explored' ? 'explored' : 'live';
}

/**
 * A region revealed, in `as`'s fashion: its outline held, and its id filed
 * under that fashion and taken out of the other, so a region the GM drops
 * from live to remembered (or back) is never both.
 */
function revealRegion(draft: Draft, region: FogRegion | null, regionId: string | undefined, as: FogRevealAs): void {
  const id = region?.id ?? regionId;
  if (!id) return;
  if (region && !draft.fogRegions.some((r) => r.id === region.id)) {
    draft.fogRegions.push(region);
    draft.changed = true;
  }
  const into = as === 'explored' ? 'exploredRegionIds' : 'revealed';
  const outOf = as === 'explored' ? 'revealed' : 'exploredRegionIds';
  if (!draft[into].includes(id)) {
    draft[into].push(id);
    draft.changed = true;
  }
  if (draft[outOf].includes(id)) {
    draft[outOf] = draft[outOf].filter((r) => r !== id);
    draft.changed = true;
  }
}

function hideRegion(draft: Draft, regionId: string | undefined): void {
  if (!regionId) return;
  const count = (): number => draft.revealed.length + draft.exploredRegionIds.length + draft.fogRegions.length;
  const before = count();
  // Whichever fashion it was revealed in: hidden is out of both.
  draft.revealed = draft.revealed.filter((r) => r !== regionId);
  draft.exploredRegionIds = draft.exploredRegionIds.filter((r) => r !== regionId);
  // A player view only ever holds revealed regions, so hiding drops the
  // geometry too — the shape itself is GM knowledge again.
  draft.fogRegions = draft.fogRegions.filter((r) => r.id !== regionId);
  if (count() !== before) draft.changed = true;
}

/** A painted reveal, into the list of its fashion, once however often it replays. */
function addShape(draft: Draft, shape: Point[] | null, seen: Set<string>, as: FogRevealAs): void {
  if (!shape) return;
  const key = `${as}|${shapeKey(shape)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const list = as === 'explored' ? draft.exploredShapes : draft.revealedShapes;
  list.push(shape);
  if (list.length > REVEALED_SHAPE_CAP) list.shift();
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
    exploredRegionIds: (base.scene.fog.exploredRegionIds ?? []).slice(),
    exploredShapes: (base.scene.fog.exploredShapes ?? []).slice(),
    fogActive: base.scene.fog.active,
    environment: base.scene.environment,
    changed: false,
  };
  const seenShapes = new Set([
    ...draft.revealedShapes.map((s) => `live|${shapeKey(s)}`),
    ...draft.exploredShapes.map((s) => `explored|${shapeKey(s)}`),
  ]);

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
          // In the fashion it says (`as`): live, or seen before (P6).
          const as = fashionOf(p['as']);
          revealRegion(draft, asRegion(p['region']), str(p['regionId']), as);
          addShape(draft, asPolygon(p['shape']), seenShapes, as);
        } else if (op === 'hide' && str(p['regionId']) === undefined) {
          // The GM's reset: every reveal taken back, the fog left whole.
          hideAll(draft);
        } else if (op === 'hide' || op === 'remove') {
          // A removed region is gone from the TV's picture the same way a
          // hidden one is; what it covered is the server's next answer.
          hideRegion(draft, str(p['regionId']));
        } else if (op === 'define') {
          // The GM's own define event never arrives here; its public word
          // does when it fogs an open scene or redraws a revealed region.
          reshapeRegion(draft, asRegion(p['region']));
        }
        // Whether the scene is fogged at all: what keeps a scene with
        // nothing revealed covered rather than open (`FogState.active`).
        // It is all the GM's switch (`enable`, `disable`) carries, so those
        // two fall through the ops above to here: off opens the whole map
        // with every reveal kept, on covers it again with the same holes.
        noteFogActive(draft, p['active']);
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
  const sight = base.scene.fog.sight;
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
        // The explored fashion, said only when there is some, as the server
        // says it: a scene with none folds to exactly the copy a fresh read
        // of it gives.
        ...(draft.exploredRegionIds.length > 0 ? { exploredRegionIds: draft.exploredRegionIds } : {}),
        ...(draft.exploredShapes.length > 0 ? { exploredShapes: draft.exploredShapes } : {}),
        // The party's pooled sight and memory, as the read gave it. Nothing
        // folded here changes it yet, but a fold that rebuilt the fog without
        // it would drop every square the party has seen at the first event.
        ...(sight === undefined ? {} : { sight }),
        ...(draft.fogActive === undefined ? {} : { active: draft.fogActive }),
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
