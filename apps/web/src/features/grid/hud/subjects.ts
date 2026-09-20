/**
 * What the GM is placing — the first of the toolbar's three questions.
 *
 * Building a floor is three decisions in a fixed order, and the toolbar used
 * to answer them in no order at all: the shape tools sat on the canvas, the
 * category row and the tile palette sat two clicks away in the panel, and a
 * GM pressed Room without ever being shown what Room was about to lay. The
 * row now reads left to right the way the sentence does —
 *
 *   *what* (this file) · *which tile* (`TilePicker`) · *how* (the shape tools)
 *
 * — so pressing Wall, picking chain-link and dragging a rectangle is three
 * moves along one row instead of a round trip through the panel.
 *
 * A subject is a narrowing of the tileset, not a new kind of state: Ground,
 * Stairs, Interior and Decor are the set's own categories, and Wall and Door
 * split the `building` category by tile kind, because "wall" and "door" is
 * how a GM says it and "building" is not.
 *
 * Select is not one of them. It is the answer "nothing, I'm picking things
 * up", and it stands on its own at the head of the row — reaching for it is
 * putting the tools down, not choosing among them. `subjectOf` still returns
 * it, as the way to say nothing is being placed.
 */
import type { ToolCategory } from '../tileCategories.js';
import type { GridTool } from '../types.js';

export type PlacingSubject = 'select' | ToolCategory | 'wall' | 'door';

export interface SubjectDef {
  id: PlacingSubject;
  label: string;
  glyph: string;
  /** The category this narrows to. */
  category: ToolCategory;
  /** Tile kinds within that category, when the category holds more than one thing. */
  kinds?: readonly string[];
}

export const SUBJECTS: readonly SubjectDef[] = [
  {
    id: 'ground',
    label: 'Ground',
    glyph: '▦',
    category: 'ground',
  },
  {
    id: 'wall',
    label: 'Wall',
    glyph: '▬',
    category: 'building',
    kinds: ['wall'],
  },
  {
    id: 'door',
    label: 'Door',
    glyph: '🚪',
    category: 'building',
    kinds: ['door'],
  },
  {
    id: 'stairs',
    label: 'Stairs',
    glyph: '⛊',
    category: 'stairs',
  },
  {
    id: 'interior',
    label: 'Interior',
    glyph: '▤',
    category: 'interior',
  },
  {
    id: 'decoration',
    label: 'Decor',
    glyph: '✽',
    category: 'decoration',
  },
];

/** The subject with this id, or undefined for `select`, which lays nothing. */
export function subjectDef(id: PlacingSubject): SubjectDef | undefined {
  return SUBJECTS.find((s) => s.id === id);
}

/** Whether a tile answers this subject's question. */
export function tileIsSubject(
  subject: SubjectDef | undefined,
  tile: { kind: string; category?: string },
  categoryOfTile: (t: { kind: string; category?: string }) => ToolCategory,
): boolean {
  if (!subject) return false;
  if (categoryOfTile(tile) !== subject.category) return false;
  return subject.kinds ? subject.kinds.includes(tile.kind) : true;
}

/**
 * Which subject the row should show as chosen, read back out of the state the
 * store already keeps — the tool, the category and the armed tile.
 *
 * Derived rather than stored so the panel's own category row and this row can
 * never disagree. `building` is the only category that needs the tile to tell
 * them apart, and with nothing pinned it reads as Wall: a GM who chose
 * "building" and no tile meant the walls, which is all a room needs.
 */
export function subjectOf(
  tool: GridTool,
  category: ToolCategory,
  armedKind: string | undefined,
): PlacingSubject {
  if (tool === 'select') return 'select';
  if (category !== 'building') return category;
  return armedKind === 'door' ? 'door' : 'wall';
}
