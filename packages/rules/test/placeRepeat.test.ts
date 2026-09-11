/**
 * The same click twice asks for something else (`place.ts`): a pass over a
 * square the tool already answered advances to the next thing that fits,
 * and the first pass is exactly what it always was.
 */
import { describe, expect, it } from 'vitest';
import { categoryOf, pickTile, tilesetById, type PlacementContext } from '../src/index.js';

const sprawl = tilesetById('sprawl')!;

function ctx(over: Partial<PlacementContext> = {}): PlacementContext {
  return { tileset: sprawl, here: {}, wallAdjacent: false, col: 3, row: 4, ...over };
}

const grounds = sprawl.tiles.filter((t) => categoryOf(t) === 'ground');
const decor = sprawl.tiles.filter((t) => categoryOf(t) === 'decoration');
const interior = sprawl.tiles.filter((t) => categoryOf(t) === 'interior');

describe('the same click twice asks for something else', () => {
  it('ground: a floored square advances to the next floor in the set, and wraps', () => {
    expect(grounds.length).toBeGreaterThan(1);
    const first = pickTile('ground', ctx())!;
    expect(first.tileId).toBe(grounds[0]!.id);
    const second = pickTile('ground', ctx({ here: { ground: first.tileId } }))!;
    expect(second.tileId).toBe(grounds[1]!.id);
    expect(second.why).toMatch(/next floor/);
    const last = grounds[grounds.length - 1]!;
    expect(pickTile('ground', ctx({ here: { ground: last.id } }))!.tileId).toBe(grounds[0]!.id);
  });

  it('decoration: the next pass offers the next thing that FITS, never one that does not', () => {
    const ground = grounds[0]!.id;
    const fits = (id: string) => {
      const on = decor.find((t) => t.id === id)!.placement?.on;
      return on === undefined || on.length === 0 || on.includes(ground);
    };
    const seen: string[] = [];
    let here: string | undefined;
    for (let i = 0; i < decor.length + 1; i += 1) {
      const r = pickTile('decoration', ctx({ here: { ground, object: here } }));
      if (r === null) break;
      expect(fits(r.tileId), r.tileId).toBe(true);
      if (i > 0) expect(r.why).toMatch(/next thing that fits/);
      seen.push(r.tileId);
      here = r.tileId;
    }
    // Every pass gave a different answer until the fitting ones ran out, then it wrapped.
    const distinct = new Set(seen);
    expect(distinct.size).toBeGreaterThan(1);
    expect(seen.length).toBeGreaterThan(distinct.size);
    expect(seen[distinct.size]).toBe(seen[0]);
  });

  it('the first pass is unchanged: stable, and what the cell hash chose', () => {
    const a = pickTile('decoration', ctx({ here: { ground: grounds[0]!.id } }));
    const b = pickTile('decoration', ctx({ here: { ground: grounds[0]!.id } }));
    expect(a?.tileId).toBe(b?.tileId);
    expect(a?.why).not.toMatch(/next thing/);
  });

  it('a square holding something from another tool is replaced by the first pick, not cycled', () => {
    const first = pickTile('interior', ctx({ wallAdjacent: true }))!;
    expect(interior.map((t) => t.id)).toContain(first.tileId);
    const foreign = decor.find((t) => !interior.some((i) => i.id === t.id))!;
    const over = pickTile('interior', ctx({ wallAdjacent: true, here: { object: foreign.id } }))!;
    expect(over.tileId).toBe(first.tileId);
    expect(over.why).not.toMatch(/next thing/);
  });
});
