/**
 * The five questions a GM asks of a square — "what is it made of", "where do
 * the walls go", "what furniture is in here", "what's lying about", "how do
 * you get upstairs" — and which one a tile answers.
 *
 * The toolbar's subjects (`hud/subjects.ts`) are these categories, with
 * `building` split into Wall and Door, and they carry their own names — so
 * what lives here is only the grouping itself: the order, and which category
 * a tile belongs to.
 */
export const CATEGORY_ORDER = ['ground', 'building', 'stairs', 'interior', 'decoration'] as const;

export type ToolCategory = (typeof CATEGORY_ORDER)[number];

/** Fallback for a set that predates categories; mirrors `categoryOf` in rules. */
export function kindCategory(kind: string): ToolCategory {
  if (kind === 'floor') return 'ground';
  if (kind === 'wall' || kind === 'door') return 'building';
  return 'decoration';
}

/** Which category a tile belongs to: what it says, or what its kind implies. */
export function categoryOf(tile: { kind: string; category?: string }): ToolCategory {
  return (tile.category as ToolCategory | undefined) ?? kindCategory(tile.kind);
}
