/**
 * The party's sight, kept by the server (P6 sightlines; FR9.13/9.16).
 *
 * A scene with its sightlines on (`SceneVision.sight`) shows the table what
 * the runners see and no more. The rules of it live in @safehouse/rules
 * (`partySight`: walls and closed doors stop an eye, strict SR5 darkness
 * stops it unless its vision modes see through, wall faces are seen from the
 * floor in front of them). This module is the other half: WHEN that is
 * worked out, from WHAT, and what the table is told.
 *
 * ## One pass, after every committed change that can move it
 *
 * `recomputeSight` runs inside the same transaction (`Hub.atomic`) as the
 * change that called for it, after the row is written, so the table is told
 * about the new sight exactly when it is told about the move, the door or the
 * light that made it, and never about one without the other. It runs on
 * COMMITTED changes only and never on a drag frame: a drag is a hand in
 * motion, and the drop (`token.move`) is what the runner actually did. The
 * callers:
 * - a token moved (`token.move`, or a PATCH of `x`/`y`), placed, deleted,
 *   flipped hidden, sent to another floor, turned (a beam points where its
 *   token faces), or its light switched, when that token is a runner or
 *   carries a light (`affectsSight`): nobody else is in anyone's sight model;
 * - a door opened or shut, painted or traced;
 * - the scene itself: tiles painted, walls drawn, floors added, the set
 *   switched, a scene PATCH (geometry and the GM's lights, the environment's
 *   light, the grid, the vision settings, the token layers);
 * - every fog op (`forget` above all, which wipes the memory this refills);
 * - a runner's sheet saved with different eyes (`sheetVisionModes`);
 * - the scene going live (`activate`), so the table's first look at it is
 *   the party's sight as it stands, whatever was done to it while staged.
 *
 * ## What is kept
 *
 * `FogState.sight`, one pair of bitsets per floor (`FogSightSchema`):
 * - `live`, what some runner sees RIGHT NOW: a cache of this pass, stored so
 *   a plain read can decide which tokens the table may be sent (`concealer`)
 *   without working sight out again;
 * - `explored`, everything the party has ever seen there: the table's memory.
 *   The GM chose ALWAYS AUTOMATIC unmasking (2026-09-27), so every pass ORs
 *   live into explored at once. Only the GM takes a square out of it
 *   (`forget`), or fogs ground again with the reveal tools.
 *
 * And one thing the pass takes away: a square the GM's brush fogged again
 * (`FogState.brush` hidden) that a runner sees now loses the mark. The party
 * has seen it again, so it is remembered from here on like every square they
 * see; the brush fogs what they have left, never what they are looking at.
 * With the sightlines OFF the pass empties every `live` and keeps `explored`:
 * the memory is the table's, and a scene switched back on picks it up again.
 * A floor with nothing in either is dropped, and a record with no floors
 * left goes, so a scene that never had sightlines stores and sends exactly
 * the fog it always did.
 *
 * ## What the table hears
 *
 * Only when the stored sight actually changed: one public, persisted
 * `fog.updated {sceneId, op: 'sight', cols, rows, levels, active}`, the whole
 * record (a 60x40 floor is 400 base64 characters a bitset), so a device
 * folding events (the TV) replaces its copy with it and a phone re-reads the
 * scene. Then the concealment diff: every token whose answer to
 * `tokenConcealed` changed with the new sight arrives (`token.added`) or
 * leaves (`token.removed`), in that order, so a device folding in order has
 * the new sight before the guards standing in it arrive. Runners are never
 * withheld, so only everyone else comes and goes.
 *
 * And the pins: a public pin is sent only where the table is shown its
 * ground (`pinsForTable`), so a change that uncovers or covers one tells the
 * table to read the scene again (`scene.updated`, changed `['pins']`).
 *
 * All of that is the table's only while the scene is (`sceneOnTable`): on a
 * scene the GM is still staging, the sight and the brush go to the GM alone,
 * and no token arrives or leaves, because no phone holds the scene to put
 * one on. The read on `scene.activated` is the table's first word of it.
 *
 * Pooled (the GM, 2026-09-27): every phone and the TV get the same sight, the
 * union of every runner's. Nothing is kept per player.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  FOG_SIGHT_MAX_SIDE,
  SceneVisionSchema,
  sceneFogOn,
  sightlinesOn,
  type FogSight,
  type FogSightLevel,
  type FogState,
  type Pin,
  type Scene,
} from '@safehouse/contracts';
import {
  cellBitsHas,
  cellBitsUnion,
  decodeCellBits,
  emptyCellBits,
  encodeCellBits,
  eraseBrush,
  partySight,
  visionModesFor,
  type CellBits,
  type VisionMode,
  type VisionSheetLike,
} from '@safehouse/rules';
import { characters, scenes, tokens, type Db } from '@safehouse/db';
import type { EventTx } from '../hub.js';
import {
  ScenesService,
  concealer,
  normalizeFog,
  pinsForTable,
  sceneEventVisibility,
  sceneOnTable,
  serializeScene,
  serializeToken,
  tokenHidden,
  type TokenRow,
} from './scenes.js';

/**
 * The parts of a scene the concealment diff reads: sightlines move the edge
 * as much as the fog does, and a staged scene (`state`) has no table for a
 * token to arrive on.
 */
export type ConcealmentScene = Pick<Scene, 'state' | 'tokenLayers' | 'fog' | 'vision'>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Whose eyes
// ---------------------------------------------------------------------------

/**
 * The slice of a stored sheet the vision modes are read from, taken
 * defensively: a sheet is jsonb written by several builds and importers, and
 * a runner whose sheet has a stray shape in its gear list should see with
 * the eyes the rest of it gives them, not stop the whole party's sight.
 */
function visionSheet(raw: unknown): VisionSheetLike {
  if (!isRecord(raw)) return {};
  const named = (list: unknown) =>
    Array.isArray(list)
      ? list
          .filter(isRecord)
          .filter((e): e is Record<string, unknown> & { name: string } => typeof e['name'] === 'string')
          .map((e) => ({ name: e.name, ...(typeof e['note'] === 'string' ? { note: e['note'] } : {}) }))
      : [];
  const identity = raw['identity'];
  const metatype = isRecord(identity) && typeof identity['metatype'] === 'string' ? identity['metatype'] : undefined;
  return {
    ...(metatype !== undefined ? { identity: { metatype } } : {}),
    augments: named(raw['augments']),
    gear: named(raw['gear']),
    qualities: named(raw['qualities']),
  };
}

/**
 * The eyes a stored sheet gives its runner (`visionModesFor`), worked out on
 * the server from the sheet itself, so the TV and the phones need no sheets
 * to show what a troll sees in the dark. Exported for the sheet save, which
 * asks it of the sheet before and after to learn whether a runner's eyes
 * changed.
 */
export function sheetVisionModes(raw: unknown): VisionMode[] {
  return visionModesFor(visionSheet(raw));
}

/** The eyes of each runner on the table, by token id; a runner with no sheet here sees normally. */
async function modesByToken(db: Db, campaignId: string, party: readonly TokenRow[]): Promise<Map<string, VisionMode[]>> {
  const ids = [...new Set(party.map((t) => t.sourceId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: characters.id, sheet: characters.sheet })
    .from(characters)
    .where(and(inArray(characters.id, ids), eq(characters.campaignId, campaignId)));
  const bySheet = new Map(rows.map((r) => [r.id, sheetVisionModes(r.sheet)]));
  const out = new Map<string, VisionMode[]>();
  for (const t of party) {
    const modes = t.sourceId !== null ? bySheet.get(t.sourceId) : undefined;
    if (modes !== undefined) out.set(t.id, modes);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** Floors the sight record can key: "0" to "99" (`FogSightSchema`). */
const SIGHT_FLOORS = 100;

/** Floor keys in floor order, so the stored record (and its comparison) never depends on insertion order. */
function floorOrder(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => Number(a) - Number(b));
}

/**
 * The record with the party's sight of right now: `live` per floor exactly
 * as `partySight` found it (a floor nobody stands on has none), and each
 * floor's memory with it ORed in. The memory is read on the grid it was
 * written for and kept by position (`cellBitsUnion`), so a scene resized
 * since loses only the squares that no longer fit, and never shears a row.
 */
function withLive(prior: FogSight | undefined, cols: number, rows: number, live: ReadonlyMap<number, CellBits>): FogSight | undefined {
  const levels: Record<string, FogSightLevel> = {};
  const keys = floorOrder([...Object.keys(prior?.levels ?? {}), ...[...live.keys()].map(String)]);
  for (const key of keys) {
    // The record keys a floor in two digits (`FogSightSchema`); a runner on a
    // floor past that (only an imported token could stand there) is not
    // kept, rather than writing a record the next read would throw away
    // whole, and the party's memory of every floor with it.
    if (Number(key) >= SIGHT_FLOORS) continue;
    const now = live.get(Number(key)) ?? emptyCellBits(cols, rows);
    const stored = prior?.levels[key];
    const memory = prior !== undefined && stored !== undefined ? decodeCellBits(stored.explored, prior.cols, prior.rows) : null;
    const floor = { live: encodeCellBits(now), explored: encodeCellBits(memory ? cellBitsUnion(now, memory) : now) };
    if (floor.live !== '' || floor.explored !== '') levels[key] = floor;
  }
  return Object.keys(levels).length > 0 ? { cols, rows, levels } : undefined;
}

/**
 * The record with the sightlines off: no floor is seen by anyone, and every
 * floor's memory is kept as it was, on the grid it was written for.
 */
function withoutLive(prior: FogSight | undefined): FogSight | undefined {
  if (prior === undefined) return undefined;
  const levels: Record<string, FogSightLevel> = {};
  for (const key of floorOrder(Object.keys(prior.levels))) {
    const explored = prior.levels[key]?.explored ?? '';
    if (explored !== '') levels[key] = { live: '', explored };
  }
  return Object.keys(levels).length > 0 ? { cols: prior.cols, rows: prior.rows, levels } : undefined;
}

/** Two records say the same thing: the same grid, and the same two strings on every floor. */
function sameSight(a: FogSight | undefined, b: FogSight | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  for (const key of floorOrder([...Object.keys(a.levels), ...Object.keys(b.levels)])) {
    const x = a.levels[key];
    const y = b.levels[key];
    if ((x?.live ?? '') !== (y?.live ?? '') || (x?.explored ?? '') !== (y?.explored ?? '')) return false;
  }
  return true;
}

/**
 * The public `fog.updated {op: 'brush'}` payload: the GM's brush as it now
 * is, every floor, whole (`FogBrushSchema`: `cols`, `rows`, `levels`), so a
 * device folding events (the TV) replaces its copy with it and a phone reads
 * the scene again. A record that is gone says `levels: {}` on the scene's
 * sight grid. `active` is whether the scene is fogged at all, as on every
 * public fog event; `extra` carries what the event is about (a stroke's
 * `level`).
 *
 * Public because nothing in it is the GM's secret: every mark is ground the
 * table is shown open, dimmed, or as fog.
 */
export function brushEventPayload(
  sceneId: string,
  scene: Scene,
  active: boolean,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const brush = scene.fog.brush ?? { ...sightGrid(scene), levels: {} };
  return { sceneId, op: 'brush', ...extra, cols: brush.cols, rows: brush.rows, levels: brush.levels, active };
}

/**
 * The grid the party's sight is kept on: the scene's, up to
 * `FOG_SIGHT_MAX_SIDE` squares each way. A grid bigger than that (none a
 * table plays) has sight kept for its first 1024 squares each way, and the
 * ground past them is never seen: the bitsets could not say it, and the rays
 * to reach it would be millions a move.
 */
function sightGrid(scene: Scene): { cols: number; rows: number } {
  return {
    cols: Math.min(scene.grid.cols, FOG_SIGHT_MAX_SIDE),
    rows: Math.min(scene.grid.rows, FOG_SIGHT_MAX_SIDE),
  };
}

/**
 * What the party sees on `scene` right now, floor by floor (`partySight`).
 *
 * The eyes are the runners on the table: tokens of a character (`source`
 * 'character'), not hidden by their flag or their layer. A runner the GM is
 * holding back (not yet through the door, a layer not yet shown) is not on
 * the table, and what it would see is not the table's either. Each sees with
 * the modes its sheet gives it.
 *
 * The lights are every token's that the GM has not hidden: a guard's
 * flashlight lights his corridor for the party whether or not the party can
 * see HIM, which is exactly how a runner spots a patrol in the dark. A token
 * the GM has hidden is not there yet, and neither is its light.
 *
 * Per floor, `partySight` builds the sight model and the light map ONCE and
 * shares them across every runner on it; the rays per runner are the cost
 * that is left (about 2 ms a runner on a lit 60x40 map). Caching the model
 * and the light map across moves was considered and left out: the key that
 * says "the geometry has not changed" is the whole tile record, walls, doors
 * and lights, as dear to build as the model it would save, and a move
 * carrying a light changes the light map anyway.
 */
async function currentSight(db: Db, scene: Scene): Promise<Map<number, CellBits>> {
  const rows = await new ScenesService(db).tokensOf(scene.id);
  const onTable = rows.filter((t) => !tokenHidden(t, scene));
  const party = onTable.filter((t) => t.source === 'character');
  if (party.length === 0) return new Map();
  const modes = await modesByToken(db, scene.campaignId, party);
  const grid = sightGrid(scene);
  const sight = partySight(
    { ...scene, grid: { ...scene.grid, ...grid } },
    party.map(serializeToken),
    modes,
    // Serialized first: a stored light that no longer fits its schema is no light.
    { lightTokens: onTable.map(serializeToken).filter((t) => t.light !== null && t.light.on !== false) },
  );
  return sight.levels;
}

/**
 * Whether a token can move the party's sight at all: a runner (a pair of
 * eyes), or anything carrying a light that is switched on. Tokens are not in
 * the sight model (bodies do not block a look; walls and doors do), so a
 * guard with no torch can be walked, hidden, shown or sent upstairs without
 * anyone's sight changing, and the routes skip the pass for him: on a busy
 * map that is most of the GM's moves, each of which would otherwise cast
 * every runner's rays again for nothing. Asked of a token before and after a
 * change, so a light switched off (or a runner turned into a prop) counts.
 */
export function affectsSight(token: { source: string; light?: unknown }): boolean {
  if (token.source === 'character') return true;
  return isRecord(token.light) && token.light['on'] !== false;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * Tokens arriving on the table and leaving it because the SCENE changed
 * around them (a layer shown or hidden, a fog region revealed or hidden, the
 * fog switched, the party's sight moved) rather than because the token
 * itself did.
 *
 * Every token on the scene is asked `tokenConcealed` against the scene as it
 * was and as it is now (each read once, `concealer`). One that comes out of
 * concealment is a public `token.added` (a NEW entity arriving, FR9.7,
 * carrying where it stands); one that goes into it is a public
 * `token.removed`. Tokens whose answer did not change say nothing, so a
 * change costs one event per token it actually uncovers or covers. Players'
 * maps and the TV already fold both, so neither needs to know WHY a token
 * came or went: only the server knows that, and it is the server's secret.
 *
 * Nothing at all on a scene that is not the table's once the change is made
 * (`sceneOnTable`): a scene the GM is staging has no table to arrive on, and
 * a guard "arriving" there was a public event with his name and where he
 * stood, on a scene no player could open. The table reads the scene whole
 * when it goes live.
 *
 * Runs inside the caller's transaction, after the scene write, so the tokens
 * are read through the same handle and the events commit with it.
 */
export async function emitConcealmentChanges(
  tx: EventTx,
  sceneId: string,
  before: ConcealmentScene,
  after: ConcealmentScene,
): Promise<void> {
  if (!sceneOnTable(after)) return;
  const was = concealer(before);
  const now = concealer(after);
  for (const row of await new ScenesService(tx.db).tokensOf(sceneId)) {
    const hidBefore = was(row);
    const hidNow = now(row);
    if (hidBefore && !hidNow) await tx.emit({ type: 'token.added', payload: { token: serializeToken(row) } });
    if (!hidBefore && hidNow) await tx.emit({ type: 'token.removed', payload: { tokenId: row.id, sceneId } });
  }
}

export interface SightPassOptions {
  /**
   * The scene as it was before the caller's change, when the caller hands
   * its own concealment diff to the pass (a scene PATCH, a fog op): the
   * tokens are then diffed ONCE, from that scene to the one the pass leaves,
   * rather than twice with a moment in between in which a guard left the
   * table and came straight back. Its sight is also what the pass compares
   * against to decide whether the table needs telling, so a `forget` whose
   * memory the pass refills from what the runners still see says nothing.
   * Absent: the scene as the pass finds it.
   */
  before?: ConcealmentScene | undefined;
  /**
   * Send the `op: 'sight'` event even if the sight itself did not change,
   * because the `active` it carries did: a vision PATCH turning sightlines
   * on fogs the scene for the table, and a TV folding events learns that
   * from this bit.
   */
  announce?: boolean | undefined;
}

export interface SightPass {
  /** The scene's fog as the pass left it (stored). */
  fog: FogState;
  /** Whether the table was told (`fog.updated`, op 'sight'). */
  told: boolean;
}

/**
 * Work out the party's sight on scene `sceneId` again, keep it, and tell the
 * table (see the top of this file). Inside the caller's `Hub.atomic` block,
 * after its write; every read and write goes through `tx.db`.
 *
 * The scene row is read `FOR UPDATE`: two passes on one scene (two runners
 * moving at once) take turns, and the second works from the tokens and the
 * memory the first committed, so neither writes the other's squares out of
 * the party's memory.
 *
 * Scenes without sightlines: every `live` is emptied if any was stored, the
 * memory is kept, and otherwise nothing is written and nothing is sent; a
 * caller's concealment diff (`before`) still runs, exactly as it did before
 * the pass existed.
 */
export async function recomputeSight(tx: EventTx, sceneId: string, opts: SightPassOptions = {}): Promise<SightPass> {
  const row = await new ScenesService(tx.db).sceneRow(sceneId, { lock: true });
  // The commonest call of all is a scene that has never had sightlines: a
  // runner's step, a door, a stroke of paint on any scene run the old way.
  // With the sightlines off, no party memory stored, and the caller asking
  // for neither a token diff (`before`) nor an announcement, the pass below
  // provably writes nothing and says nothing (no live squares to empty, no
  // memory to keep, no runner's sight to spend a brush mark), so it is
  // answered from the fog and the vision settings alone, without reading
  // the whole scene: `serializeScene` parses every painted floor, about 5 ms
  // on a 58x54 two-storey map, on every step of every such scene. The row is
  // still read FOR UPDATE, so a PATCH switching the sightlines on in the
  // same moment is waited for, and then seen.
  if (opts.before === undefined && opts.announce !== true) {
    const bare = normalizeFog(row.fog);
    const geometry = isRecord(row.geometry) ? row.geometry : {};
    const vision = SceneVisionSchema.safeParse(geometry['vision']);
    if (bare.sight === undefined && !sightlinesOn(vision.success ? vision.data : undefined)) {
      return { fog: bare, told: false };
    }
  }
  const stored = serializeScene(row);
  const prior = stored.fog.sight;

  let next: FogSight | undefined;
  let seen: Map<number, CellBits> | null = null;
  if (sightlinesOn(stored.vision)) {
    const { cols, rows } = sightGrid(stored);
    seen = await currentSight(tx.db, stored);
    next = withLive(prior, cols, rows, seen);
  } else {
    next = withoutLive(prior);
  }

  const fog: FogState = { ...stored.fog };
  if (next !== undefined) fog.sight = next;
  else delete fog.sight;
  // The brush's "fogged again" is spent on every square a runner sees now
  // (see the top of this file). `eraseBrush` hands back the very record when
  // no such square is seen, which is every pass on a scene the brush never
  // fogged: nothing written, nothing said.
  const priorBrush = stored.fog.brush;
  const live = seen;
  const brush =
    live === null || live.size === 0
      ? priorBrush
      : eraseBrush(
          priorBrush,
          (level, col, row) => {
            const bits = live.get(level);
            return bits !== undefined && cellBitsHas(bits, col, row);
          },
          ['hidden'],
        );
  if (brush !== undefined) fog.brush = brush;
  else delete fog.brush;
  const brushMoved = brush !== priorBrush;
  if (!sameSight(prior, next) || brushMoved) {
    await tx.db.update(scenes).set({ fog }).where(eq(scenes.id, sceneId));
  }
  const after: Scene = { ...stored, fog };
  // The table's, or the GM's alone while the scene is staged (`sceneOnTable`).
  const heard = sceneEventVisibility(after);
  if (brushMoved) {
    await tx.emit({ type: 'fog.updated', payload: brushEventPayload(sceneId, after, sceneFogOn(after)), visibility: heard });
  }

  const reference = opts.before !== undefined ? opts.before.fog.sight : prior;
  const told = !sameSight(reference, next) || opts.announce === true;
  if (told) {
    const grid = next ?? { ...sightGrid(stored), levels: {} };
    await tx.emit({
      type: 'fog.updated',
      payload: {
        sceneId,
        op: 'sight',
        cols: grid.cols,
        rows: grid.rows,
        levels: grid.levels,
        active: sceneFogOn(after),
      },
      visibility: heard,
    });
  }
  if (told || brushMoved || opts.before !== undefined) {
    const was = opts.before ?? stored;
    await emitConcealmentChanges(tx, sceneId, was, after);
    // The pins the table is sent moved with the fog under them (the pins
    // themselves did not: a geometry write says so in its own event).
    if (sceneOnTable(after) && !samePins(pinsForTable({ ...after, fog: was.fog, vision: was.vision }), pinsForTable(after))) {
      await tx.emit({ type: 'scene.updated', payload: { sceneId, changed: ['pins'] } });
    }
  }
  return { fog, told };
}

/** Two pin lists name the same pins, in any order. */
function samePins(a: readonly Pin[], b: readonly Pin[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((p) => p.id));
  return b.every((p) => ids.has(p.id));
}

/**
 * A runner's eyes changed: their sheet was saved with other vision modes
 * (`sheetVisionModes`), thermographic cybereyes fitted, low-light goggles
 * lost. The party's sight is worked out again on every scene they stand on,
 * in the save's own transaction, so a troll's player who adds the eyes sees
 * the dark room open on the table with the same commit. Cheap to ask: the
 * save compares the modes before and after, and only a change calls this.
 */
export async function recomputeSightForCharacter(tx: EventTx, characterId: string): Promise<void> {
  const rows = await tx.db
    .select({ sceneId: tokens.sceneId })
    .from(tokens)
    .where(and(eq(tokens.source, 'character'), eq(tokens.sourceId, characterId)));
  // In a fixed order: each pass locks its scene to the end of the
  // transaction, and two saves locking the same scenes in opposite orders
  // would deadlock, and one of them fail.
  for (const sceneId of [...new Set(rows.map((r) => r.sceneId))].sort()) await recomputeSight(tx, sceneId);
}
