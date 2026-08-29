/**
 * Proximity prompts (FR12.8) — "they're at the lab door, reveal?"
 *
 * When a token lands within N metres of a named fog region that has not been
 * revealed, the GM gets a nudge. Three properties matter:
 *
 *  - it is a *suggestion*, never an action: nothing reveals itself, and the
 *    prompt points at `suggest_fog_reveal` / the fog control for the GM to use;
 *  - it is GM-only. Unrevealed regions and hidden tokens are exactly the state
 *    players must not see, so every emission is `visibility: 'gm'` and goes out
 *    ephemerally — it never lands in `ws_events` where a replay could leak it;
 *  - it does not nag. The same token/region pair fires once and stays quiet
 *    until the token walks back out of the ring.
 *
 * The geometry is pure and lives here; the scene layer only has to call
 * `emitFogProximity` after a token settles.
 */
import { eq } from 'drizzle-orm';
import type { Point, Visibility } from '@safehouse/contracts';
import { FogStateSchema, GridSchema } from '@safehouse/contracts';
import { scenes, tokens, type Db } from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { activeSceneRow } from './state-core.js';

/** Default ring: a token this close is at the door, not near the building. */
export const DEFAULT_PROXIMITY_M = 3;

export interface ProximityPrompt {
  tokenId: string;
  tokenName: string;
  tokenHidden: boolean;
  regionId: string;
  regionName: string;
  /** Metres from the token to the region edge; 0 when already inside it. */
  distanceM: number;
  inside: boolean;
  /** One line for the GM's panel. */
  message: string;
}

export interface ProximityState {
  sceneId: string;
  sceneName: string;
  radiusM: number;
  unitM: number;
  prompts: ProximityPrompt[];
}

// ---------------------------------------------------------------------------
// Geometry (pure)
// ---------------------------------------------------------------------------

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ray casting; points exactly on an edge count as inside (distance 0 anyway). */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance in GRID UNITS from a point to a polygon; 0 when inside it. */
export function distanceToPolygon(p: Point, polygon: Point[]): number {
  if (polygon.length === 0) return Number.POSITIVE_INFINITY;
  if (polygon.length < 3) return distanceToSegment(p, polygon[0]!, polygon[polygon.length - 1]!);
  if (pointInPolygon(p, polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, polygon[i]!, polygon[j]!));
  }
  return best;
}

export interface ProximityInput {
  grid: unknown;
  fog: unknown;
  tokens: Array<{ id: string; name: string; x: number; y: number; hidden: boolean }>;
  radiusM?: number;
}

/**
 * The whole rule, as a pure function: unrevealed named regions × tokens within
 * `radiusM`, nearest first.
 */
export function fogProximityPrompts(input: ProximityInput): {
  prompts: ProximityPrompt[];
  unitM: number;
  radiusM: number;
} {
  const grid = GridSchema.safeParse(input.grid);
  const unitM = grid.success ? grid.data.unitM : 1;
  const radiusM = Math.max(input.radiusM ?? DEFAULT_PROXIMITY_M, 0);
  const fog = FogStateSchema.safeParse(input.fog ?? {});
  if (!fog.success) return { prompts: [], unitM, radiusM };
  const revealed = new Set(fog.data.revealed);
  const hidden = fog.data.regions.filter((region) => !revealed.has(region.id));
  const prompts: ProximityPrompt[] = [];
  for (const token of input.tokens) {
    for (const region of hidden) {
      const distanceM = distanceToPolygon({ x: token.x, y: token.y }, region.polygon) * unitM;
      if (distanceM > radiusM) continue;
      const inside = distanceM === 0;
      prompts.push({
        tokenId: token.id,
        tokenName: token.name,
        tokenHidden: token.hidden,
        regionId: region.id,
        regionName: region.name,
        distanceM: Number(distanceM.toFixed(2)),
        inside,
        message: inside
          ? `${token.name} is inside "${region.name}" and it is still fogged — reveal?`
          : `${token.name} is ${distanceM.toFixed(1)} m from "${region.name}" — reveal?`,
      });
    }
  }
  prompts.sort((a, b) => a.distanceM - b.distanceM || a.regionName.localeCompare(b.regionName));
  return { prompts, unitM, radiusM };
}

// ---------------------------------------------------------------------------
// Live read
// ---------------------------------------------------------------------------

export async function fogProximityState(
  db: Db,
  campaignId: string,
  opts: { sceneId?: string; radiusM?: number } = {},
): Promise<ProximityState> {
  const row = opts.sceneId
    ? (await db.select().from(scenes).where(eq(scenes.id, opts.sceneId)).limit(1))[0]
    : await activeSceneRow(db, campaignId);
  if (!row || row.campaignId !== campaignId) throw httpError(404, 'not_found', 'no scene to read');
  const tokenRows = await db.select().from(tokens).where(eq(tokens.sceneId, row.id));
  const { prompts, unitM, radiusM } = fogProximityPrompts({
    grid: row.grid,
    fog: row.fog,
    tokens: tokenRows.map((t) => ({
      id: t.id,
      name: t.name,
      x: t.x,
      y: t.y,
      hidden: t.hidden,
    })),
    ...(opts.radiusM !== undefined ? { radiusM: opts.radiusM } : {}),
  });
  return { sceneId: row.id, sceneName: row.name, radiusM, unitM, prompts };
}

// ---------------------------------------------------------------------------
// Emission (GM-only, ephemeral, de-duplicated)
// ---------------------------------------------------------------------------

export interface ProximityHub {
  emitEphemeral(
    campaignId: string,
    input: { type: string; payload: unknown; visibility?: Visibility },
  ): void;
}

/** token+region pairs already announced, per campaign, until they walk away. */
const announced = new Map<string, Set<string>>();

/** Test/reset seam — a fresh app process starts quiet anyway. */
export function resetProximityMemory(campaignId?: string): void {
  if (campaignId === undefined) announced.clear();
  else announced.delete(campaignId);
}

/**
 * Emit a GM-only `fixer.suggestion` for every newly-close token/region pair.
 * Returns the prompts actually emitted (the repeats are dropped), so callers
 * can log or test what fired.
 *
 * Called from the `token.move` handler in `plugins/scenes.ts` — after the
 * COMMIT, never on drag frames, or the GM would get a strobe instead of a
 * nudge. That call site wraps this in a catch: a suggestion that fails must
 * never turn a legal move into an error.
 */
export async function emitFogProximity(
  db: Db,
  hub: ProximityHub | undefined,
  campaignId: string,
  opts: { sceneId?: string; radiusM?: number } = {},
): Promise<ProximityPrompt[]> {
  let state: ProximityState;
  try {
    state = await fogProximityState(db, campaignId, opts);
  } catch {
    return [];
  }
  const seen = announced.get(campaignId) ?? new Set<string>();
  const live = new Set<string>();
  const fresh: ProximityPrompt[] = [];
  for (const prompt of state.prompts) {
    const key = `${state.sceneId}|${prompt.tokenId}|${prompt.regionId}`;
    live.add(key);
    if (!seen.has(key)) fresh.push(prompt);
  }
  // Keys for other scenes stay remembered; this scene's set is replaced.
  const kept = [...seen].filter((key) => !key.startsWith(`${state.sceneId}|`));
  announced.set(campaignId, new Set([...kept, ...live]));
  if (fresh.length === 0) return [];
  hub?.emitEphemeral(campaignId, {
    type: 'fixer.suggestion',
    payload: {
      kind: 'fog_proximity',
      sceneId: state.sceneId,
      sceneName: state.sceneName,
      radiusM: state.radiusM,
      prompts: fresh,
      /** Nothing has changed on the table — this is a nudge (Principle 8). */
      action: { tool: 'suggest_fog_reveal', regions: fresh.map((p) => p.regionId) },
    },
    visibility: 'gm',
  });
  return fresh;
}
