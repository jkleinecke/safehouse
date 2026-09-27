/**
 * The fog bar's rules (the GM, 2026-09-27): which squares the round brush
 * paints, the keys that size it, and the one sentence the bar says. Pure:
 * the pointer and the map's ring are pinned elsewhere, against these.
 */
import { describe, expect, it } from 'vitest';
import {
  brushAnchor,
  brushCentre,
  brushRadius,
  brushSizeStep,
  brushSquares,
  clampBrushSize,
  FOG_BRUSH_DEFAULT,
  FOG_BRUSH_MAX,
  FOG_BRUSH_MIN,
  FOG_BRUSH_MODES,
  fogBarHint,
  seeAsPlayersLabel,
  type FogBarState,
} from './fogBar.js';

/** The squares a brush paints with the pointer at `x, y`, as `"col,row"`, row by row. */
function painted(x: number, y: number, size: number, bounds?: { cols: number; rows: number }): string[] {
  const centre = brushCentre(brushAnchor({ x, y }, size), size);
  return brushSquares(centre, size, bounds).map((c) => `${c.col},${c.row}`);
}

/** The footprint drawn as rows of `#` and `.`, over the box it fits in: easier to read than a list. */
function picture(x: number, y: number, size: number): string[] {
  const cells = brushSquares(brushCentre(brushAnchor({ x, y }, size), size), size);
  const cols = cells.map((c) => c.col);
  const rows = cells.map((c) => c.row);
  const out: string[] = [];
  for (let row = Math.min(...rows); row <= Math.max(...rows); row += 1) {
    let line = '';
    for (let col = Math.min(...cols); col <= Math.max(...cols); col += 1) {
      line += cells.some((c) => c.col === col && c.row === row) ? '#' : '.';
    }
    out.push(line);
  }
  return out;
}

describe('the round brush', () => {
  it('paints exactly the square under the pointer at size 1, wherever in it the pointer is', () => {
    for (const [x, y] of [
      [5.5, 7.5],
      [5.01, 7.01],
      [5.99, 7.99],
      [5.0, 7.0],
    ] as const) {
      expect(painted(x, y, 1), `${x},${y}`).toEqual(['5,7']);
    }
  });

  it('paints every square whose centre is within half the size of the centre, round from 4 up', () => {
    // Odd sizes centre on the square under the pointer; even ones on the corner nearest it.
    expect(picture(5.5, 5.5, 3)).toEqual(['###', '###', '###']);
    expect(picture(5.2, 5.3, 2)).toEqual(['##', '##']);
    expect(painted(5.2, 5.3, 2)).toEqual(['4,4', '5,4', '4,5', '5,5']);
    expect(picture(5.1, 4.9, 4)).toEqual(['.##.', '####', '####', '.##.']);
    expect(picture(5.5, 5.5, 5)).toEqual(['.###.', '#####', '#####', '#####', '.###.']);
    expect(picture(5.5, 5.5, 7)).toEqual([
      '..###..',
      '.#####.',
      '#######',
      '#######',
      '#######',
      '.#####.',
      '..###..',
    ]);
    // Every square painted is within the radius; every square left out is not.
    for (let size = FOG_BRUSH_MIN; size <= FOG_BRUSH_MAX; size += 1) {
      const centre = brushCentre(brushAnchor({ x: 20.3, y: 20.6 }, size), size);
      const r = brushRadius(size);
      const inside = new Set(brushSquares(centre, size).map((c) => `${c.col},${c.row}`));
      for (let row = 5; row < 36; row += 1) {
        for (let col = 5; col < 36; col += 1) {
          const d = Math.hypot(col + 0.5 - centre.x, row + 0.5 - centre.y);
          expect(inside.has(`${col},${row}`), `size ${size} at ${col},${row}`).toBe(d <= r + 1e-9);
        }
      }
    }
  });

  it('grows with the size, square by square, and never paints the same square twice', () => {
    let before = 0;
    for (let size = FOG_BRUSH_MIN; size <= FOG_BRUSH_MAX; size += 1) {
      const keys = painted(30.5, 30.5, size);
      expect(new Set(keys).size, `size ${size}`).toBe(keys.length);
      expect(keys.length, `size ${size}`).toBeGreaterThan(before);
      before = keys.length;
    }
    // The biggest brush covers a room, not the map: about pi r^2.
    expect(painted(30.5, 30.5, 10).length).toBe(80);
  });

  it('paints only squares on the map, so a circle over the edge is cut, not refused', () => {
    expect(painted(0.2, 0.2, 3, { cols: 10, rows: 10 })).toEqual(['0,0', '1,0', '0,1', '1,1']);
    expect(painted(9.9, 9.9, 1, { cols: 10, rows: 10 })).toEqual(['9,9']);
    expect(painted(-3, 4.5, 3, { cols: 10, rows: 10 })).toEqual([]);
    // The same stroke without bounds keeps the squares off the grid, for a caller that clips itself.
    expect(painted(0.2, 0.2, 3)).toHaveLength(9);
  });

  it('keeps its size between one and ten squares, whole', () => {
    expect(FOG_BRUSH_DEFAULT).toBeGreaterThanOrEqual(FOG_BRUSH_MIN);
    expect(FOG_BRUSH_DEFAULT).toBeLessThanOrEqual(FOG_BRUSH_MAX);
    expect(clampBrushSize(0)).toBe(1);
    expect(clampBrushSize(-4)).toBe(1);
    expect(clampBrushSize(11)).toBe(10);
    expect(clampBrushSize(3.4)).toBe(3);
    expect(clampBrushSize(Number.NaN)).toBe(FOG_BRUSH_DEFAULT);
    expect(brushRadius(6)).toBe(3);
  });

  it('is sized by ] and [, and by no other key', () => {
    expect(brushSizeStep(']')).toBe(1);
    expect(brushSizeStep('[')).toBe(-1);
    for (const key of ['f', 'Escape', '}', '{', '+', '-']) expect(brushSizeStep(key), key).toBe(0);
  });

  it('offers the three marks the server keeps, reveal first', () => {
    expect(FOG_BRUSH_MODES.map((m) => m.paint)).toEqual(['live', 'explored', 'hidden']);
    expect(FOG_BRUSH_MODES.map((m) => m.label)).toEqual(['Reveal', 'Reveal as seen before', 'Fog again']);
  });
});

describe('the fog bar’s sentence', () => {
  const base: FogBarState = { fog: false, sight: false, brush: null, asPlayers: false };

  it('says what the table sees', () => {
    expect(fogBarHint(base)).toBe('The players and the TV see the whole map.');
    expect(fogBarHint({ ...base, fog: true })).toBe('The players and the TV see only what you reveal.');
    expect(fogBarHint({ ...base, fog: true, sight: true })).toBe(
      'The players and the TV see what you reveal and what the runners see; rooms they have left stay dimmed.',
    );
  });

  it('says what a drag will do while the brush is in hand, and warns when the fog is off', () => {
    const on = { ...base, fog: true };
    expect(fogBarHint({ ...on, brush: { paint: 'live', size: 3 } })).toBe(
      'Drag on the map to reveal a 3-square circle; [ and ] change the size.',
    );
    expect(fogBarHint({ ...on, brush: { paint: 'explored', size: 1 } })).toBe(
      'Drag on the map to reveal one square as seen before; [ and ] change the size.',
    );
    expect(fogBarHint({ ...on, brush: { paint: 'hidden', size: 10 } })).toBe(
      'Drag on the map to fog a 10-square circle again; [ and ] change the size.',
    );
    expect(fogBarHint({ ...base, brush: { paint: 'live', size: 3 } })).toBe(
      'The fog is off, so the table sees the whole map whatever you paint.',
    );
  });

  it('says first that the GM is looking through the players’ eyes, and names the button that goes back', () => {
    expect(fogBarHint({ fog: true, sight: true, brush: { paint: 'live', size: 3 }, asPlayers: true })).toBe(
      'You see the map exactly as the players and the TV do; press Back to GM view to return.',
    );
  });

  it('labels the lens button as the mockup did: See as players, then Back to GM view while it is on', () => {
    expect(seeAsPlayersLabel(false)).toBe('See as players');
    expect(seeAsPlayersLabel(true)).toBe('Back to GM view');
  });

  it('is one sentence, whatever the state', () => {
    for (const fog of [false, true]) {
      for (const sight of [false, true]) {
        for (const asPlayers of [false, true]) {
          for (const brush of [null, { paint: 'live' as const, size: 2 }]) {
            const text = fogBarHint({ fog, sight, brush, asPlayers });
            expect(text.endsWith('.'), text).toBe(true);
            expect(text.slice(0, -1).includes('. '), text).toBe(false);
          }
        }
      }
    }
  });
});
