/**
 * The swatch scene (docs/UX_MAP_BUILDER.md §3.5): what is painted around a
 * tile so its swatch shows it the way the map will. Pure; the render itself
 * needs a GPU and is exercised by the browser walkthrough.
 */
import { describe, expect, it } from 'vitest';
import { TILESETS } from '@safehouse/rules';
import type { TileSetLike } from '../types.js';
import { fallbackSwatch, sheetInput, swatchInput, swatchStyle } from './swatches.js';

const dock = TILESETS.find((s) => s.id === 'docklands') as unknown as TileSetLike;
const tile = (id: string) => dock.tiles.find((t) => t.id === id)!;
const nine = (v: string) => Object.fromEntries([0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [`${c},${r}`, v])));

describe('swatchInput', () => {
  it('fills the whole square with a floor', () => {
    const s = swatchInput(dock, tile('floor'));
    expect(s.ground).toEqual(nine('floor'));
    expect(s.structure).toEqual({});
    expect(s.object).toEqual({});
  });

  it('runs a wall through the middle on the set’s floor', () => {
    const s = swatchInput(dock, tile('wall'));
    expect(s.ground).toEqual(nine('floor'));
    expect(s.structure).toEqual({ '0,1': 'wall', '1,1': 'wall', '2,1': 'wall' });
  });

  it('sets a door between two walls', () => {
    const s = swatchInput(dock, tile('door'));
    expect(s.structure).toEqual({ '0,1': 'wall', '1,1': 'door', '2,1': 'wall' });
  });

  it('stands a prop in the middle on the set’s floor', () => {
    const prop = dock.tiles.find((t) => t.kind === 'feature')!;
    const s = swatchInput(dock, prop);
    expect(s.ground).toEqual(nine('floor'));
    expect(s.structure).toEqual({});
    expect(s.object).toEqual({ '1,1': prop.id });
  });

  it('falls back to the tile’s two colours', () => {
    expect(fallbackSwatch(['#111', '#222']).background).toContain('#111');
  });
});

describe('sheetInput', () => {
  it('lays every tile’s scene out a cell apart, so no wall run leaks into the next', () => {
    const { input, layout } = sheetInput(dock);
    expect(layout.at.size).toBe(dock.tiles.length);
    const first = layout.at.get(dock.tiles[0]!.id)!;
    expect(first).toEqual({ col: 1, row: 1 });
    // Scene k sits at (k % 6) * 4, floor(k / 6) * 4 — a 3×3 with a one-cell gap.
    const seventh = dock.tiles[6];
    if (seventh) expect(layout.at.get(seventh.id)).toEqual({ col: 1, row: 5 });
    // Nothing is painted in the gap columns or rows.
    for (const key of [...Object.keys(input.ground), ...Object.keys(input.structure), ...Object.keys(input.object)]) {
      const [c, r] = key.split(',').map(Number) as [number, number];
      expect(c % 4, key).not.toBe(3);
      expect(r % 4, key).not.toBe(3);
    }
    expect(layout.cols).toBe(Math.min(dock.tiles.length, 6) * 4);
  });

  it('shows one tile’s cell of the sheet at the swatch size', () => {
    const { layout } = sheetInput(dock);
    const style = swatchStyle({ url: 'data:x', layout }, 'wall');
    const wall = layout.at.get('wall')!;
    expect(style?.backgroundPosition).toBe(`-${wall.col * 40}px -${wall.row * 40}px`);
    expect(style?.backgroundSize).toBe(`${layout.cols * 40}px ${layout.rows * 40}px`);
    expect(swatchStyle({ url: 'data:x', layout }, 'no-such-tile')).toBeNull();
  });
});
