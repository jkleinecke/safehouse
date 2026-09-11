import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import { gridFromWorld, metricsFor, pinHeadRise, worldFromGrid } from '../geometry.js';
import { hitDoor, hitNote, hitPin, hitTileDoor, hitToken, hitWall, isDoubleTap, worldTolerance } from './hit.js';
import { noteFrame } from './notes.js';

/**
 * Plan view unless a test says otherwise. Everything here used to work in grid
 * units, which is the same as screen distance ONLY in this projection — see
 * the isometric block at the bottom for what that cost.
 */
const m = metricsFor({
  unitM: 1,
  cols: 20,
  rows: 20,
  offset: { x: 0, y: 0 },
  projection: 'topdown' as const,
});
const iso = metricsFor({
  unitM: 1,
  cols: 20,
  rows: 20,
  offset: { x: 0, y: 0 },
  projection: 'iso' as const,
});

function token(id: string, x: number, y: number, size = 1): Token {
  return {
    id,
    sceneId: 'sc1',
    source: 'character',
    sourceId: null,
    name: id,
    x,
    y,
    size,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'owner',
  };
}

describe('hitToken', () => {
  const tokens = [token('a', 2.5, 2.5), token('b', 10.5, 4.5, 3)];

  it('hits inside the token circle and misses outside', () => {
    expect(hitToken(m, tokens, { x: 2.6, y: 2.4 })?.id).toBe('a');
    expect(hitToken(m, tokens, { x: 5, y: 5 })).toBeNull();
  });

  it('scales the hit radius with token size', () => {
    expect(hitToken(m, tokens, { x: 11.8, y: 4.5 })?.id).toBe('b');
    expect(hitToken(m, tokens, { x: 12.6, y: 4.5 })).toBeNull();
  });

  it('respects an id allow-list', () => {
    expect(hitToken(m, tokens, { x: 2.5, y: 2.5 }, { onlyIds: new Set(['b']) })).toBeNull();
    expect(hitToken(m, tokens, { x: 2.5, y: 2.5 }, { onlyIds: new Set(['a']) })?.id).toBe('a');
  });

  it('prefers the last token when circles overlap', () => {
    const stacked = [token('under', 3, 3), token('over', 3, 3)];
    expect(hitToken(m, stacked, { x: 3, y: 3 })?.id).toBe('over');
  });
});

describe('hitNote (FR9.25)', () => {
  const scene = {
    geometry: {
      walls: [],
      zones: [],
      pins: [],
      doors: [],
      gmNotes: [
        { id: 'n1', at: { x: 2, y: 2 }, text: 'The guard is asleep.', width: 4 },
        { id: 'n2', at: { x: 3, y: 3 }, text: 'Overlapping', width: 2 },
      ],
    },
  } as unknown as Scene;

  it('hits inside the box the note is drawn in, and misses outside it', () => {
    expect(hitNote(m, scene, { x: 2.5, y: 2.2 })).toBe('n1');
    expect(hitNote(m, scene, { x: 1.9, y: 2.2 })).toBeNull();
    expect(hitNote(m, scene, { x: 12, y: 12 })).toBeNull();
    // The bottom edge is where the frame says it is — the same measurement the drawing uses.
    const f = noteFrame(m, scene.geometry.gmNotes![0]!);
    const under = gridFromWorld(m, { x: f.x + 4, y: f.y + f.h + 2 });
    expect(hitNote(m, scene, under)).toBeNull();
  });

  it('gives an overlap to the later note, which draws on top', () => {
    expect(hitNote(m, scene, { x: 3.2, y: 3.1 })).toBe('n2');
  });

  it('reads a scene with no notes as nothing to hit', () => {
    expect(hitNote(m, { geometry: { walls: [], zones: [], pins: [], doors: [] } } as unknown as Scene, { x: 1, y: 1 })).toBeNull();
  });
});

describe('hitTileDoor (FR9.24)', () => {
  const scene = {
    geometry: { walls: [], zones: [], pins: [], doors: [] },
    // A square painted before slots existed holds an id; one painted since
    // holds a slot (rules/tilesets/slots.ts). Both must read as a door.
    tiles: { tilesetId: 'docklands', structure: { '4,4': 'door', '4,3': 'wall', '5,5': 'building/door' } },
    levels: [{ id: 'l2', name: 'Up', tiles: { tilesetId: 'corp', structure: { '6,6': 'building/door' } } }],
  } as unknown as Scene;

  it('names the cell when it holds a door tile on that floor, and nothing otherwise', () => {
    expect(hitTileDoor(scene, { x: 4.5, y: 4.5 }, 0)).toBe('4,4');
    expect(hitTileDoor(scene, { x: 4.5, y: 3.5 }, 0)).toBeNull(); // a wall
    expect(hitTileDoor(scene, { x: 5.5, y: 5.5 }, 0)).toBe('5,5'); // stored as a slot
    expect(hitTileDoor(scene, { x: 6.5, y: 6.5 }, 0)).toBeNull(); // upstairs door, ground clicked
    expect(hitTileDoor(scene, { x: 6.5, y: 6.5 }, 1)).toBe('6,6');
    expect(hitTileDoor(scene, { x: 4.5, y: 4.5 }, 1)).toBeNull();
    expect(hitTileDoor({ geometry: scene.geometry } as unknown as Scene, { x: 4.5, y: 4.5 }, 0)).toBeNull();
  });
});

describe('hitDoor', () => {
  const scene = {
    geometry: {
      walls: [],
      zones: [],
      pins: [],
      doors: [
        { id: 'd1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, open: false },
        { id: 'd2', a: { x: 0, y: 9 }, b: { x: 4, y: 9 }, open: true },
      ],
    },
  } as unknown as Scene;

  it('finds a door within tolerance', () => {
    expect(hitDoor(m, scene, { x: 2, y: 0.3 })).toBe('d1');
    expect(hitDoor(m, scene, { x: 2, y: 8.8 })).toBe('d2');
  });

  it('misses when nothing is near', () => {
    expect(hitDoor(m, scene, { x: 2, y: 4 })).toBeNull();
  });
});

describe('hitPin / hitWall (FR9.2/9.3 authoring)', () => {
  const scene = {
    geometry: {
      doors: [],
      zones: [],
      walls: [
        { id: 'w1', a: { x: 0, y: 0 }, b: { x: 8, y: 0 } },
        { id: 'w2', a: { x: 8, y: 0 }, b: { x: 8, y: 6 } },
      ],
      pins: [
        { id: 'p1', at: { x: 3, y: 3 }, visibility: 'gm' },
        { id: 'p2', at: { x: 3, y: 3 }, visibility: 'public' },
        { id: 'p3', at: { x: 9, y: 1 }, visibility: 'public' },
      ],
    },
  } as unknown as Scene;

  it('picks the pin under the click, latest on top when they stack', () => {
    expect(hitPin(m, scene, { x: 3.1, y: 3.05 })).toBe('p2');
    expect(hitPin(m, scene, { x: 8.9, y: 1.1 })).toBe('p3');
    expect(hitPin(m, scene, { x: 7, y: 7 })).toBeNull();
  });

  it('finds a wall segment near the click', () => {
    expect(hitWall(m, scene, { x: 4, y: 0.2 })).toBe('w1');
    expect(hitWall(m, scene, { x: 8.1, y: 3 })).toBe('w2');
    expect(hitWall(m, scene, { x: 4, y: 3 })).toBeNull();
  });
});

describe('worldTolerance', () => {
  it('shrinks as the camera zooms in', () => {
    const wide = worldTolerance(0.5, 10);
    const close = worldTolerance(2, 10);
    expect(close).toBeLessThan(wide);
    expect(close).toBeCloseTo(10 / 2, 10);
  });

  it('does not depend on the projection', () => {
    // The point of moving the hit tests into world px: a click has the same
    // physical slop whichever way the map is drawn. The old grid-unit version
    // divided by m.cell and came out 1.4x to 2.8x too tight in isometric,
    // depending on which direction the GM happened to be aiming.
    expect(worldTolerance(1, 14)).toBe(14);
  });
});

describe('isometric hit-testing', () => {
  // A grid-space circle is a 2:1 ellipse on an isometric screen. Every test
  // here fails against the old grid-unit implementation: the GM could see the
  // thing, click it, and be ignored.

  it('hits the top and bottom of a token, not just its waist', () => {
    const one = [token('a', 5.5, 5.5)];
    const centre = worldFromGrid(iso, { x: 5.5, y: 5.5 });
    // 20 px straight up the screen from the centre — well inside the 30 px
    // disc that is drawn, and 1.25 GRID units away, which the old test
    // rejected out of hand.
    const above = gridFromWorld(iso, { x: centre.x, y: centre.y - 20 });
    expect(hitToken(iso, one, above)?.id).toBe('a');
    const below = gridFromWorld(iso, { x: centre.x, y: centre.y + 20 });
    expect(hitToken(iso, one, below)?.id).toBe('a');
  });

  it('misses outside the drawn disc, in every direction equally', () => {
    const one = [token('a', 5.5, 5.5)];
    const centre = worldFromGrid(iso, { x: 5.5, y: 5.5 });
    for (const [dx, dy] of [
      [80, 0],
      [-80, 0],
      [0, 80],
      [0, -80],
    ] as const) {
      const out = gridFromWorld(iso, { x: centre.x + dx, y: centre.y + dy });
      expect(hitToken(iso, one, out)).toBeNull();
    }
  });

  it('makes the same click land the same way in both projections', () => {
    // The invariant the old code broke: a click N screen px from a token's
    // centre either hits in both projections or misses in both.
    const flatT = [token('a', 5.5, 5.5)];
    for (const px of [10, 25, 40, 100]) {
      const hitFlat = (() => {
        const c = worldFromGrid(m, { x: 5.5, y: 5.5 });
        return hitToken(m, flatT, gridFromWorld(m, { x: c.x, y: c.y - px })) !== null;
      })();
      const hitIso = (() => {
        const c = worldFromGrid(iso, { x: 5.5, y: 5.5 });
        return hitToken(iso, flatT, gridFromWorld(iso, { x: c.x, y: c.y - px })) !== null;
      })();
      expect({ px, hitIso }).toEqual({ px, hitIso: hitFlat });
    }
  });

  it('selects a pin by its head, which is what the GM is aiming at', () => {
    const scene = {
      geometry: {
        walls: [],
        doors: [],
        zones: [],
        pins: [{ id: 'p1', at: { x: 4, y: 4 }, visibility: 'gm', label: 'Safe' }],
      },
    } as unknown as Scene;
    const foot = worldFromGrid(iso, { x: 4, y: 4 });
    // The head is drawn a fixed distance up the SCREEN from the anchor. In
    // isometric that inverts to over a grid unit away, so the old grid-space
    // test rejected the only part of the pin that looks clickable.
    const head = gridFromWorld(iso, { x: foot.x, y: foot.y - pinHeadRise(iso) });
    expect(hitPin(iso, scene, head)).toBe('p1');
    // And the anchor still works, because the stem is drawn too.
    expect(hitPin(iso, scene, { x: 4, y: 4 })).toBe('p1');
    expect(hitPin(iso, scene, { x: 9, y: 9 })).toBeNull();
  });
});

describe('isDoubleTap', () => {
  it('needs a previous tap', () => {
    expect(isDoubleTap(null, { x: 0, y: 0, t: 10 })).toBe(false);
  });

  it('accepts a quick nearby second tap', () => {
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 105, y: 98, t: 200 })).toBe(true);
  });

  it('rejects a slow or distant second tap', () => {
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 100, y: 100, t: 900 })).toBe(false);
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 160, y: 100, t: 100 })).toBe(false);
  });
});
