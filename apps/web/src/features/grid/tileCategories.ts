/**
 * The five questions a GM asks of a square — "what is it made of", "where do
 * the walls go", "what furniture is in here", "what's lying about", "how do
 * you get upstairs" — and which one a tile answers.
 *
 * Shared because the palette in the GM panel and the tile dropdowns on the
 * toolbar must group tiles the same way; they were one copy each until the
 * dropdowns arrived, and two copies of a category list is how a tile ends up
 * under Decor in one place and Interior in the other.
 */
export const CATEGORY_ORDER = ['ground', 'building', 'stairs', 'interior', 'decoration'] as const;

export type ToolCategory = (typeof CATEGORY_ORDER)[number];

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  ground: 'Ground',
  building: 'Building',
  interior: 'Interior',
  decoration: 'Decor',
  stairs: 'Stairs',
};

/** What each category does on a single click, in the GM's terms — the tooltip. */
export const CATEGORY_HINT: Record<ToolCategory, string> = {
  ground: 'What the square is made of — pick a surface and drag. Drag again for the next surface in the set.',
  building: 'Click empty ground for a wall; click a wall again for a window, then a door.',
  interior: 'Furniture. Against a wall it picks something with a back to it; drag again for the next thing that fits.',
  decoration: 'Props. It reads the ground — trees on grass, drains on the road; drag again for another that fits.',
  stairs:
    'Stairs. Which way they lead follows from the floors this scene has — up if there is one above.',
};

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
