/**
 * Slots: the one vocabulary every tileset speaks (FR9.2).
 *
 * A painted square stores a SLOT, not a tile: `ground/2`, `building/door`,
 * `interior/4`. Each set maps the same slots onto its own tiles — the
 * docklands' second floor is oil-stained slab, the corporate set's is the
 * lobby — so switching a scene from one set to another is a render
 * decision and nothing else: the layers do not change, the doors keep their
 * open and locked state, the stairs still lead where they led, and
 * switching back restores the map exactly.
 *
 * Slots come from the catalogue's own order within each category, so a
 * set's tiles need no extra field: ground, interior and decoration are
 * numbered in order; building is by role — the first solid wall, the first
 * see-through opening, the first door — then numbered; stairs are up and
 * down. A set that lacks a slot answers with its nearest: a numbered slot
 * wraps onto the set's own numbering (the seventh prop in a set of five is
 * its second), a role falls back to the set's first piece of building. The
 * order is therefore part of the data contract — new tiles go at the END
 * of their category — and `slots.test.ts` pins the current assignment.
 */

export type SlotCategory = 'ground' | 'building' | 'interior' | 'decoration' | 'stairs';

/** The fields a tile needs to be given a slot — the served catalogue has them all. */
export interface SlotTile {
  id: string;
  kind: string;
  category?: string | undefined;
  placement?: { inWall?: boolean | undefined } | undefined;
  blocksSight?: boolean | undefined;
  connects?: 'up' | 'down' | undefined;
}

export interface SlotSet<T extends SlotTile = SlotTile> {
  id: string;
  tiles: readonly T[];
}

/** Mirrors `categoryOf`: a set that predates categories is sorted by kind. */
function catOf(tile: SlotTile): SlotCategory {
  const c = tile.category;
  if (c === 'ground' || c === 'building' || c === 'interior' || c === 'decoration' || c === 'stairs') return c;
  if (tile.kind === 'floor') return 'ground';
  if (tile.kind === 'wall' || tile.kind === 'door') return 'building';
  return 'decoration';
}

const cache = new WeakMap<object, Map<string, string>>();

/** Every tile's slot, by tile id, in one set. Computed once per set object. */
export function slotsOf(set: SlotSet): Map<string, string> {
  const hit = cache.get(set);
  if (hit) return hit;
  const out = new Map<string, string>();
  const counts: Record<SlotCategory, number> = { ground: 0, building: 0, interior: 0, decoration: 0, stairs: 0 };
  const roles = { wall: false, window: false, door: false, up: false, down: false };
  // Roles are claimed by first appearance; everything else numbers on from
  // where the roles would sit, so a set's extra pieces never collide.
  let extraBuilding = 3;
  let extraStairs = 2;
  for (const tile of set.tiles) {
    const cat = catOf(tile);
    let slot: string;
    if (cat === 'building') {
      const inWall = tile.placement?.inWall === true;
      const door = tile.kind === 'door';
      if (door && !roles.door) {
        roles.door = true;
        slot = 'building/door';
      } else if (!door && inWall && tile.blocksSight === false && !roles.window) {
        roles.window = true;
        slot = 'building/window';
      } else if (!door && !inWall && !roles.wall) {
        roles.wall = true;
        slot = 'building/wall';
      } else {
        extraBuilding += 1;
        slot = `building/${extraBuilding}`;
      }
    } else if (cat === 'stairs') {
      if (tile.connects === 'up' && !roles.up) {
        roles.up = true;
        slot = 'stairs/up';
      } else if (tile.connects === 'down' && !roles.down) {
        roles.down = true;
        slot = 'stairs/down';
      } else {
        extraStairs += 1;
        slot = `stairs/${extraStairs}`;
      }
    } else {
      counts[cat] += 1;
      slot = `${cat}/${counts[cat]}`;
    }
    out.set(tile.id, slot);
  }
  cache.set(set, out);
  return out;
}

/** The slot of one tile in its set. */
export function slotOf(set: SlotSet, tileId: string): string | undefined {
  return slotsOf(set).get(tileId);
}

/** Is this a slot (as opposed to a tile id)? Slots always carry a slash. */
export function isSlot(ref: string): boolean {
  return ref.includes('/');
}

function parseSlot(slot: string): { cat: SlotCategory; part: string } | null {
  const i = slot.indexOf('/');
  if (i < 0) return null;
  const cat = slot.slice(0, i);
  if (cat !== 'ground' && cat !== 'building' && cat !== 'interior' && cat !== 'decoration' && cat !== 'stairs') return null;
  return { cat, part: slot.slice(i + 1) };
}

/**
 * The tile a set shows for a slot: its own, or its nearest when it has none.
 * Null only when the set has nothing at all in that category.
 */
export function tileBySlot<T extends SlotTile>(set: SlotSet<T>, slot: string): T | null {
  const slots = slotsOf(set);
  for (const tile of set.tiles) if (slots.get(tile.id) === slot) return tile;
  const parsed = parseSlot(slot);
  if (parsed === null) return null;
  const inCat = set.tiles.filter((t) => catOf(t) === parsed.cat);
  if (inCat.length === 0) return null;
  const n = Number(parsed.part);
  if (Number.isInteger(n) && n > 0) {
    // Numbered: wrap onto the set's own numbering in this category.
    const numbered = inCat.filter((t) => /\/\d+$/.test(slots.get(t.id) ?? ''));
    const pool = numbered.length > 0 ? numbered : inCat;
    return pool[(n - 1) % pool.length] ?? null;
  }
  // A role the set lacks: the first piece of the category.
  return inCat[0] ?? null;
}

/** A tile by id or by slot — what a stored layer value may be either of. */
export function resolveTile<T extends SlotTile>(set: SlotSet<T>, ref: string): T | null {
  return set.tiles.find((t) => t.id === ref) ?? (isSlot(ref) ? tileBySlot(set, ref) : null);
}

/** The slot a stored value means — an id becomes its slot; a slot stays. */
export function toSlot(set: SlotSet, ref: string): string | undefined {
  if (isSlot(ref)) return ref;
  return slotOf(set, ref);
}

/** Every slot any of these sets defines, sorted — what a renderer must answer for. */
export function slotUniverse(sets: readonly SlotSet[]): string[] {
  const all = new Set<string>();
  for (const set of sets) for (const slot of slotsOf(set).values()) all.add(slot);
  return [...all].sort();
}
