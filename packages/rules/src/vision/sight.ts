/**
 * What the party's eyes see (P6 sightlines; FR9.16; docs/VISION.md §3, §4).
 *
 * `visibleFrom` answers "which squares could a ray reach from here": walls
 * and closed doors, painted and traced, stop it, and nothing else does. That
 * is geometry. Sightlines need the rest of the question a runner asks at the
 * table: "which of those can I actually make out?" This module adds the two
 * things geometry does not know about, and pools the answer over the party:
 *
 * - DARKNESS, strict SR5 (the GM, 2026-09-27, decision 3). A square is seen
 *   when a ray reaches it AND it is not in total darkness for the viewer's
 *   eyes: `compensatedLight(lightRowAt(map, col, row), modes) < 3`. So a
 *   lamp's pool is seen from across a dark warehouse, and the black corner
 *   beside it is not. Low-light vision counts partial and dim light as full,
 *   but total darkness still applies, so it reveals no more squares than
 *   normal eyes do (it helps the dice, not the map). Thermographic vision
 *   shifts every row one up, so total darkness becomes dim and it sees every
 *   square a ray reaches. Ultrasound ignores light but perceives only within
 *   `ULTRASOUND_RANGE_M` (50 m), which `compensatedLight` leaves to its
 *   caller; this is that caller. Astral perception changes nothing here.
 *
 * - WALL FACES. Rays run centre to centre, so along a long painted wall the
 *   squares OF the wall go unseen at grazing angles: the ray to each one
 *   passes through its neighbour in the wall first and stops there. A probe
 *   saw 5 of 21 squares of a straight wall whose every floor square in front
 *   of it was seen. On a player's screen that is a wall that is only there
 *   near the runner, and in the party's memory (`FogState.sight` explored) a
 *   room remembered without most of its walls. So a square that blocks sight
 *   counts as seen when a seen OPEN square touches it, along a side or at a
 *   corner: whoever sees the floor in front of a wall sees the wall's face.
 *   Corners count too, or a room's corner square (touched only diagonally by
 *   the room's floor, both of its side neighbours being wall) would be a
 *   notch missing from every remembered room. It never chains: only an open
 *   square lends its sight to a wall, so a wall seen end-on does not light up
 *   the whole wall run, and nothing open behind a wall is ever added; nor is
 *   a painted block with a traced wall or closed door between it and the
 *   floor in front of it. The face is taken to be lit as the floor in front
 *   of it is; its own light row is not asked, because the light map is built
 *   by the same centre rays and has the same grazing gap on wall squares.
 *
 *   The face is also the ONLY way a square that blocks sight is seen: no ray
 *   is cast to one on its own light row. A wall square has one light row
 *   for both of its faces, and a lamp in the room behind it lights that row
 *   as well as one in front of it would. Asked on its own, a wall between a
 *   pitch-black corridor and a lit office read as lit, and a runner standing
 *   in the dark saw the office wall's squares glowing from the far side:
 *   the far side of a wall, told to the table. Through its face, the wall is
 *   seen exactly when the floor in front of it is, on the viewer's side.
 *
 * ## How far a runner sees
 *
 * `visibleFrom`'s default radius (`DEFAULT_SIGHT_RANGE`, 24) was chosen to
 * bound the cost of a phone's own-sight shroud, and it counts SQUARES
 * whatever a square measures: 24 m on a 1 m grid, 48 m on a 2 m one. SR5
 * puts no range on sight itself. What stops an eye is a wall, darkness (the
 * light rows) and weather, and weather costs dice (the Env tab's visibility)
 * rather than hiding anything. A cap would hide exactly what dynamic lighting
 * is for: a lit room at the far end of a dark hall, a street lamp across a
 * plaza. So normal eyes have NO range here: they reach across the whole grid,
 * and the light does the limiting. In a dark building only the lamps' pools
 * are candidates at all; in daylight what stops a look is the walls.
 *
 * The cost stays in hand for the same reason: the darkness test is cheap (a
 * map lookup) and runs BEFORE a ray is cast (`visibleFrom`'s `where`), so a
 * square the viewer could not make out in any case costs no ray. A lit map
 * costs a ray per square in the grid, a few milliseconds on a 60x40 map
 * (measured: 1.5 ms per eye at range 24), on the server, once per committed
 * change and never per frame. A caller that wants a cap after all (smoke, a
 * GM's call) passes `rangeM`, in metres, turned into squares by the grid's
 * `unitM` so it means the same distance on every grid.
 *
 * ## The party
 *
 * `partySight` is the whole table's view (decision 1: sight is pooled): every
 * runner's sight on a floor, unioned, one set of squares per floor that has a
 * runner on it. That set is what the server writes as the fog's `live`
 * bitsets (`FogState.sight`); every phone and the TV show the same one.
 * Which tokens count as the party's eyes, and which lights shine, is the
 * caller's policy: every token passed in is an eye.
 *
 * `lineOfSightBetween` is the two-token question on the same terms: read on
 * the floor the two tokens stand on, never the ground floor by default.
 *
 * Pure, like the rest of this folder: no I/O, and it knows nothing about who
 * is watching. Multi-floor caveat, inherited from `sightModelFor`: traced
 * walls and doors have no floor and block sight on every storey.
 */
import { cellBitsSet, emptyCellBits, type CellBits } from './fogState.js';
import {
  compensatedLight,
  lightMapFor,
  lightRowAt,
  type LightMap,
  type LightRow,
  type LightSceneInput,
  type LightTokenLike,
} from './light.js';
import { lineOfSight, type LosResult, type SightModel } from './los.js';
import { sightModelFor, type SightSceneInput } from './model.js';
import type { VisionMode } from './modes.js';
import { visibleFrom, visibleKey } from './visible.js';

/**
 * How far ultrasound perceives, in metres (docs/VISION.md §3: light is
 * ignored, within 50 m). Past it, an ultrasound runner is down to whatever
 * other eyes they have.
 */
export const ULTRASOUND_RANGE_M = 50;

/** The light row at which a square is not seen at all: total darkness. */
const TOTAL_DARKNESS: LightRow = 3;

/**
 * The darkness rule for one set of eyes, built once: whether a square lit
 * at `row`, `distanceM` metres from the viewer (centre to centre), is made
 * out. Ultrasound is taken out of the modes before the light is compensated,
 * because `compensatedLight` counts it as full light at any distance and the
 * 50 m is ours to enforce.
 */
function lightRule(modes: readonly VisionMode[]): (row: LightRow, distanceM: number) => boolean {
  const eyes = modes.filter((m) => m !== 'ultrasound');
  const hears = modes.includes('ultrasound');
  return (row, distanceM) => {
    if (compensatedLight(row, eyes) < TOTAL_DARKNESS) return true;
    // A hair of slack, so a square exactly 50 m off is not lost to rounding.
    return hears && distanceM <= ULTRASOUND_RANGE_M + 1e-9;
  };
}

/**
 * Whether eyes with `modes` make out a square lit at `row` (0 full light to
 * 3 total darkness), `distanceM` metres away: strict SR5 (see the top of this
 * file). The one-question version of the rule `sightFor` applies to every
 * square, for a caller (a lens, a roll's provenance) that asks about one.
 */
export function seesInLight(row: LightRow, distanceM: number, modes: readonly VisionMode[]): boolean {
  return lightRule(modes)(row, distanceM);
}

export interface SightOptions {
  /** The grid, in squares. Sight never leaves it. */
  cols: number;
  rows: number;
  /**
   * Metres a square (`Grid.unitM`); absent or unusable is 1. Every range
   * here is in metres, so the same eyes reach the same distance on a 1 m
   * grid and a 2 m one.
   */
  unitM?: number | undefined;
  /**
   * A cap on how far the viewer sees, in metres. Absent, which is the rule:
   * no cap, and the light decides (see "How far a runner sees" above).
   */
  rangeM?: number | undefined;
}

/** One square a runner sees. */
export interface SeenCell {
  col: number;
  row: number;
}

/** A grid size as a whole, non-negative number of squares. */
function gridSide(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Metres a square, made safe: a missing or broken `unitM` is 1 m. */
function metresPerSquare(unitM: number | undefined): number {
  return unitM !== undefined && Number.isFinite(unitM) && unitM > 0 ? unitM : 1;
}

/** Every neighbour of a square, sides and corners: where a wall's face can be. */
const AROUND: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * The squares one runner standing in square `viewer` sees on its floor:
 * every open square a ray reaches through `model`'s walls and closed doors
 * (`visibleFrom`) that is not in total darkness for its `modes` under
 * `lightMap` (strict SR5; ultrasound within 50 m in any light), plus the face
 * of every wall touching an open square it sees, which is the only way a
 * wall is seen (see the top of this file).
 *
 * The viewer's own square is always seen, lit or not: a runner knows where
 * they are standing. It lends its sight to the walls around it only when it
 * is lit enough to see, so a runner in a pitch-black corridor does not map
 * the corridor's walls by standing in it.
 *
 * Pass `lightMap` null to leave light out (every square lit), which is a
 * daylit scene's answer anyway and saves building a map for it.
 *
 * Keyed `"col,row"` (`visibleKey`), so the keys are a shroud's `visible` set
 * as they stand. Only squares on the grid are returned.
 */
export function sightFor(
  viewer: { col: number; row: number },
  model: SightModel,
  lightMap: LightMap | null,
  modes: readonly VisionMode[],
  opts: SightOptions,
): Map<string, SeenCell> {
  const cols = gridSide(opts.cols);
  const rows = gridSide(opts.rows);
  const unitM = metresPerSquare(opts.unitM);
  const onGrid = (col: number, row: number) => col >= 0 && row >= 0 && col < cols && row < rows;

  // No cap unless asked for: the diagonal of the grid reaches every square
  // of it from anywhere on it.
  const capM = opts.rangeM;
  const range =
    capM !== undefined && Number.isFinite(capM) && capM >= 0 ? capM / unitM : Math.hypot(cols, rows);

  const rule = lightRule(modes);
  const lit = (col: number, row: number): boolean => {
    if (lightMap === null) return true;
    const distanceM = Math.hypot(col - viewer.col, row - viewer.row) * unitM;
    return rule(lightRowAt(lightMap, col, row), distanceM);
  };

  const blocks = (col: number, row: number) => model.cells.get(visibleKey(col, row))?.blocksSight === true;

  // Rays only to OPEN squares the viewer could make out if nothing stood in
  // the way; `visibleFrom` adds the viewer's own square whatever this says.
  // A square that blocks sight gets no ray of its own: its light row cannot
  // say which of its faces is lit, so it is seen by its face alone, below
  // (see "WALL FACES" at the top of this file).
  const reached = visibleFrom(viewer, model, {
    range,
    cols,
    rows,
    where: (col, row) => !blocks(col, row) && lit(col, row),
  });

  const out = new Map<string, SeenCell>();
  for (const [key, cell] of reached) {
    if (onGrid(cell.col, cell.row)) out.set(key, { col: cell.col, row: cell.row });
  }

  // A traced wall or closed door on the grid line between a seen square and
  // a painted block beside it still stands between them: that block's face
  // is behind it and is not seen (a painted rack on the far side of a traced
  // partition stays hidden). Asked of the traced geometry alone, because the
  // painted squares are exactly what this rule looks past: the diagonal step
  // into a room's corner runs through the two wall squares either side of it.
  const traced: SightModel | null = model.segments.some((s) => s.blocksSight)
    ? { cells: new Map(), segments: model.segments }
    : null;
  for (const cell of reached.values()) {
    // Only an open square lends its sight to the walls around it, so this
    // never chains along a wall run.
    if (blocks(cell.col, cell.row)) continue;
    const own = cell.col === viewer.col && cell.row === viewer.row;
    if (own && !lit(cell.col, cell.row)) continue;
    for (const [dc, dr] of AROUND) {
      const col = cell.col + dc;
      const row = cell.row + dr;
      if (!onGrid(col, row) || !blocks(col, row)) continue;
      const key = visibleKey(col, row);
      if (out.has(key)) continue;
      if (traced !== null && !lineOfSight(cell, { col, row }, traced).clear) continue;
      out.set(key, { col, row });
    }
  }
  return out;
}

/** What `partySight` needs of a scene: what sight and light need, and the grid. */
export interface PartySightScene extends LightSceneInput {
  grid: { cols: number; rows: number; unitM?: number | undefined };
}

/**
 * A runner whose eyes count: where it stands and on which floor. A token of
 * any shape fits. The light fields are read only when it is also one of the
 * tokens whose carried light shines (`PartySightOptions.lightTokens`, which
 * defaults to the party itself).
 */
export type PartyEye = LightTokenLike;

/** Vision modes per token id: a Map, or a plain record (as it comes off the wire). */
export type ModesByToken =
  | ReadonlyMap<string, readonly VisionMode[]>
  | Readonly<Record<string, readonly VisionMode[]>>;

export interface PartySightOptions {
  /**
   * The tokens whose CARRIED lights shine (`Token.light`), on every floor:
   * a guard's flashlight lights the corridor for the party as much as their
   * own does. Absent: only the party's own lights. The caller decides which
   * tokens that is; a light is not secret, but a GM-hidden token's is the
   * server's call.
   */
  lightTokens?: readonly LightTokenLike[] | undefined;
  /** A cap on every runner's sight, in metres (`SightOptions.rangeM`). Absent: none. */
  rangeM?: number | undefined;
}

/** The pooled sight of the party, per floor. */
export interface PartySight {
  /** The grid the bitsets are written for (`FogSight.cols`, `.rows`). */
  cols: number;
  rows: number;
  /**
   * Floor index (`Token.level`) → every square some runner on that floor
   * sees right now: the fog's `live` for that floor, before encoding
   * (`encodeCellBits`). Only floors with a runner on them are here; a floor
   * nobody stands on is seen by nobody.
   */
  levels: Map<number, CellBits>;
}

/** The modes a token sees with; a token nobody gave any sees normally. */
function modesOf(modesByToken: ModesByToken, id: string): readonly VisionMode[] {
  const found =
    modesByToken instanceof Map
      ? (modesByToken as ReadonlyMap<string, readonly VisionMode[]>).get(id)
      : (modesByToken as Readonly<Record<string, readonly VisionMode[]>>)[id];
  return found !== undefined && found.length > 0 ? found : ['normal'];
}

/**
 * The party's pooled sight (decision 1): for every floor with a runner on
 * it, the union of what each runner there sees (`sightFor`).
 *
 * Each floor's sight model (`sightModelFor`) and light map (`lightMapFor`,
 * with its glowing tiles, the GM's lights on it and the carried lights of
 * `opts.lightTokens`) is built ONCE and shared by every runner on it, which
 * is most of the work saved by pooling.
 *
 * A runner stands in the square its centre is in (`floor(x)`, `floor(y)`),
 * as the shroud has always placed it. A token whose `level` is not a floor
 * index (not a whole number, or below the ground) cannot be keyed in the
 * fog's `sight` record and is left out rather than guessed at.
 */
export function partySight(
  scene: PartySightScene,
  partyTokens: readonly PartyEye[],
  modesByToken: ModesByToken,
  opts: PartySightOptions = {},
): PartySight {
  const cols = gridSide(scene.grid.cols);
  const rows = gridSide(scene.grid.rows);
  const unitM = metresPerSquare(scene.grid.unitM);
  const lightTokens = opts.lightTokens ?? partyTokens;

  const byFloor = new Map<number, PartyEye[]>();
  for (const eye of partyTokens) {
    const level = eye.level ?? 0;
    if (!Number.isInteger(level) || level < 0) continue;
    if (!Number.isFinite(eye.x) || !Number.isFinite(eye.y)) continue;
    const list = byFloor.get(level);
    if (list === undefined) byFloor.set(level, [eye]);
    else list.push(eye);
  }

  const levels = new Map<number, CellBits>();
  for (const [level, eyes] of byFloor) {
    const model = sightModelFor(scene, level);
    const lightMap = lightMapFor(scene, level, { model, tokens: lightTokens, cols, rows });
    const bits = emptyCellBits(cols, rows);
    for (const eye of eyes) {
      const seen = sightFor(
        { col: Math.floor(eye.x), row: Math.floor(eye.y) },
        model,
        lightMap,
        modesOf(modesByToken, eye.id),
        { cols, rows, unitM, rangeM: opts.rangeM },
      );
      for (const cell of seen.values()) cellBitsSet(bits, cell.col, cell.row);
    }
    levels.set(level, bits);
  }
  return { cols, rows, levels };
}

/** A token as a sightline between two of them cares: where it stands, and on which floor. */
export interface StandingToken {
  x: number;
  y: number;
  /** `Token.level`; absent is the ground. */
  level?: number | undefined;
}

/**
 * The sightline between two tokens on a scene, read against THEIR floor's
 * sight model, or null when they stand on different floors.
 *
 * The GM's cover reading (the LOS tab, the token inspector) used to build
 * the model for the ground floor whoever was upstairs, because
 * `sightModelFor`'s floor defaults to 0: two runners on a catwalk were ruled
 * behind the warehouse's ground-floor walls beneath them. Two tokens on
 * different floors have no sightline this can draw (it reads one floor at a
 * time, and nothing here looks up or down a stairwell), so the answer is
 * null and the call is the GM's, rather than a ruling off the wrong floor.
 *
 * Each token stands in the square its centre is in, as everywhere else.
 * Pass `model` when that floor's model is already built.
 */
export function lineOfSightBetween(
  scene: SightSceneInput,
  from: StandingToken,
  to: StandingToken,
  model?: SightModel,
): LosResult | null {
  const level = from.level ?? 0;
  if ((to.level ?? 0) !== level) return null;
  return lineOfSight(
    { col: Math.floor(from.x), row: Math.floor(from.y) },
    { col: Math.floor(to.x), row: Math.floor(to.y) },
    model ?? sightModelFor(scene, level),
  );
}
