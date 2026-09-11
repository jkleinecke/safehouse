/**
 * One click, the right tile (FR9.2).
 *
 * The palette this replaces asked the GM to pick from forty named tiles every
 * time they wanted a tree. That is fine for the tenth tree and terrible for
 * the first, and it is the reason building a street took longer than running
 * the scene on it.
 *
 * So each tool answers a different question, and the tile itself carries
 * enough about where it belongs that the answer can be computed:
 *
 *  - **Ground** does not guess. "Sidewalk or grass" is a decision, not a
 *    deduction, and a tool that guessed would be wrong half the time.
 *  - **Building** cycles. An empty cell becomes a wall; clicking that wall
 *    again turns it into a window, then a door, then back. Windows and doors
 *    are holes in a building, so they can only ever appear where a wall
 *    already is — which is exactly what a GM means by clicking twice on the
 *    bit of the shell that should be a door.
 *  - **Interior** reads the walls. A desk, a bench or a terminal wants
 *    something at its back; a table or a fountain wants room around it.
 *  - **Decoration** reads the GROUND. A tree wants soil, a hydrant wants
 *    pavement, an oil stain wants road. Click grass and get a tree; click the
 *    street and get a drain.
 *
 * ## Variety without instability
 *
 * Where several candidates tie, the winner is chosen by hashing the cell's
 * coordinates — never at random. A field of grass gets a mix of trees and
 * shrubs, and the cell at 4,7 yields the same one every time it is drawn,
 * queried, or re-opened next week. A decoration that reshuffled on redraw
 * would make the map feel broken in a way that is very hard to describe and
 * impossible to ignore.
 *
 * ## The same click twice asks for something else
 *
 * Running a tool over a square it already answered is not a request for the
 * same answer. Building always worked this way (wall → window → door); now
 * every tool does: Ground advances to the next floor in the set, Interior and
 * Decoration to the next thing that FITS the square — the ranking is the
 * same one the first pick came from, read on from the current tile, so a
 * second pass over a wall-side desk offers the terminal, not the fountain.
 * Within one stroke the square is read once, so a wobbling drag does not
 * cycle a cell it merely crossed twice.
 *
 * ## This is a suggestion, not a cage
 *
 * Picking a specific tile in the palette always wins. The scorer answers "what
 * did you probably mean", and the GM overrules it whenever they want.
 */
import type { Tile, TileCategory, Tileset } from './types.js';
import { categoryOf, layerOf } from './types.js';

/** What is already in the cell, per layer. */
export interface CellContents {
  ground?: string | undefined;
  structure?: string | undefined;
  object?: string | undefined;
}

export interface PlacementContext {
  tileset: Tileset;
  /** What this cell already holds. */
  here: CellContents;
  /** Does any of the four orthogonal neighbours hold a structure tile? */
  wallAdjacent: boolean;
  /** The cell itself — the deterministic variety seed. */
  col: number;
  row: number;
  /** Which floor is being painted, 0 being the ground (FR9.22). */
  level?: number;
  /** How many floors the scene has, so stairs know where they can lead. */
  levelCount?: number;
}

export interface PlacementResult {
  tileId: string;
  layer: 'ground' | 'structure' | 'object';
  /** One line for the UI, so the GM can see WHY before they commit. */
  why: string;
}

/** FNV-1a over the cell, so "which of the tied candidates" is stable forever. */
function cellSeed(col: number, row: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${col},${row}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tilesFor(set: Tileset, category: TileCategory): Tile[] {
  return set.tiles.filter((t) => categoryOf(t) === category);
}

/**
 * Building: an empty cell becomes a wall; an existing one advances through the
 * things that can be cut INTO a wall, then back to solid.
 *
 * The order is the catalogue's own, so a set decides for itself whether the
 * first click after a wall gives a window or a door.
 */
function pickBuilding(ctx: PlacementContext): PlacementResult | null {
  const all = tilesFor(ctx.tileset, 'building');
  const solid = all.filter((t) => t.placement?.inWall !== true);
  const cut = all.filter((t) => t.placement?.inWall === true);
  const base = solid[0];
  if (base === undefined) return null;

  // The cycle is solid-wall → each thing you can cut into it → back to solid.
  const cycle = [base, ...cut];
  const current = ctx.here.structure;
  const at = current === undefined ? -1 : cycle.findIndex((t) => t.id === current);

  if (at === -1) {
    return { tileId: base.id, layer: 'structure', why: `${base.name} — joins to the walls beside it` };
  }
  const next = cycle[(at + 1) % cycle.length]!;
  return {
    tileId: next.id,
    layer: 'structure',
    why: at + 1 >= cycle.length ? `back to ${next.name}` : `${next.name} — cut into the wall`,
  };
}

/**
 * Stairs: which way they lead follows from the building, not from a menu.
 *
 * On the ground floor of a two-storey scene there is only one direction that
 * means anything, and making the GM say "up" every time is the same busywork
 * the four tools exist to remove. A floor above wins over a floor below —
 * building upward is the common case, and a basement is usually reached by
 * stairs painted on the floor above it anyway.
 *
 * With nowhere to go yet, it still places an up-flight. A GM sketching a
 * stairwell before adding the storey is doing something reasonable, and
 * `stairTarget` already reports "leads nowhere" until the floor exists.
 */
function pickStairs(ctx: PlacementContext): PlacementResult | null {
  const all = tilesFor(ctx.tileset, 'stairs');
  if (all.length === 0) return null;

  const level = ctx.level ?? 0;
  const count = ctx.levelCount ?? 1;
  const wanted: 'up' | 'down' = level + 1 < count ? 'up' : level > 0 ? 'down' : 'up';

  const tile = all.find((t) => t.connects === wanted) ?? all[0]!;
  const leadsSomewhere = wanted === 'up' ? level + 1 < count : level > 0;
  return {
    tileId: tile.id,
    layer: layerOf(tile),
    why: leadsSomewhere
      ? `${tile.name} — to ${wanted === 'up' ? 'the floor above' : 'the floor below'}`
      : `${tile.name} — no floor ${wanted} yet; add one and these will connect`,
  };
}

/** Score a candidate against the cell. Higher wins; negative is disqualified. */
function score(tile: Tile, ctx: PlacementContext): number {
  const p = tile.placement;
  if (p === undefined) return 0;

  // A thing that must be in a wall is not a candidate outside one, ever.
  if (p.inWall === true && ctx.here.structure === undefined) return -1;

  let s = 0;
  if (p.on !== undefined && p.on.length > 0) {
    const ground = ctx.here.ground;
    // Wrong ground disqualifies: a fire hydrant on grass is not a near miss.
    if (ground === undefined || !p.on.includes(ground)) return -1;
    // Right ground beats a tile with no opinion — specific over generic.
    s += 2;
  }
  if (p.againstWall === true) s += ctx.wallAdjacent ? 2 : -0.5;
  else if (ctx.wallAdjacent) s += 0.25; // mild preference for open-floor things away from walls
  return s;
}

/**
 * Every candidate that fits, best first — the stable pick leads (ties broken
 * by the cell), then the rest in score order, catalogue order within a score.
 * Element 0 is what a first click places; each element after it is what the
 * next pass over the same square places.
 */
export function ranked(candidates: readonly Tile[], ctx: PlacementContext): Tile[] {
  const scored = candidates
    .map((tile) => ({ tile, s: score(tile, ctx) }))
    .filter((c) => c.s >= 0);
  if (scored.length === 0) return [];

  const top = Math.max(...scored.map((c) => c.s));
  const tied = scored.filter((c) => c.s === top).map((c) => c.tile);
  const lead = tied[cellSeed(ctx.col, ctx.row) % tied.length]!;
  // A stable sort: equal scores keep the catalogue's order.
  const ordered = [...scored].sort((a, b) => b.s - a.s).map((c) => c.tile);
  const at = ordered.indexOf(lead);
  return [...ordered.slice(at), ...ordered.slice(0, at)];
}

/** The tile after `current` in a cycle, or its head when `current` is not in it. */
function advance(
  cycle: readonly Tile[],
  current: string | undefined,
): { tile: Tile; again: boolean } | null {
  const first = cycle[0];
  if (first === undefined) return null;
  const at = current === undefined ? -1 : cycle.findIndex((t) => t.id === current);
  if (at === -1) return { tile: first, again: false };
  return { tile: cycle[(at + 1) % cycle.length]!, again: true };
}

/**
 * What this tool would place here, or null when it has nothing to offer.
 *
 * `preferred` is the GM's explicit choice from the palette and short-circuits
 * everything: auto-placement is a default, not a constraint.
 */
export function pickTile(
  tool: TileCategory,
  ctx: PlacementContext,
  preferred?: string | undefined,
): PlacementResult | null {
  if (preferred !== undefined) {
    const tile = ctx.tileset.tiles.find((t) => t.id === preferred);
    if (tile !== undefined) {
      return { tileId: tile.id, layer: layerOf(tile), why: tile.name };
    }
  }

  if (tool === 'building') return pickBuilding(ctx);
  if (tool === 'stairs') return pickStairs(ctx);

  if (tool === 'ground') {
    // Deliberately no cleverness on the first pass: the GM said "ground", and
    // which ground is the whole content of that decision, so the set's first
    // floor is the default rather than a guess dressed up as one. A pass over
    // a square already floored advances to the set's next floor.
    const step = advance(tilesFor(ctx.tileset, 'ground'), ctx.here.ground);
    if (step === null) return null;
    return {
      tileId: step.tile.id,
      layer: 'ground',
      why: step.again ? `${step.tile.name} — the next floor in the set` : step.tile.name,
    };
  }

  const step = advance(ranked(tilesFor(ctx.tileset, tool), ctx), ctx.here.object);
  if (step === null) return null;
  const tile = step.tile;

  const p = tile.placement;
  const why = step.again
    ? `${tile.name} — the next thing that fits here`
    : p?.on !== undefined && p.on.length > 0
      ? `${tile.name} — suits this ground`
      : p?.againstWall === true
        ? `${tile.name} — against the wall`
        : tile.name;
  return { tileId: tile.id, layer: layerOf(tile), why };
}
