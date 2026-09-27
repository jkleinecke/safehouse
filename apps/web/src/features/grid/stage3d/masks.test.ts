/**
 * The players' cover on the 3D map, asked square by square (FR9.13,
 * Principle 4). The first test in stage3d/.
 *
 * `CoverMasks` is what decides, on a phone, a laptop or the TV, whether a
 * square of the 3D map shows anything at all. Its fog mask is `drawFog`
 * painted onto a canvas, and `coveredAt` reads the same bytes the shader does.
 * When the fog broke, this was where it broke on screen. A player's copy of a
 * fogged scene with nothing revealed carried no regions, `drawFog` drew
 * nothing for it, the mask came out empty, and every square read 0. Nothing
 * tested any of it.
 *
 * These run in node, where there is no `document` and so no canvas to paint
 * the fog on. `CoverMasks` then FAILS CLOSED: a fog it cannot paint covers
 * the whole map rather than none of it (`FogRasteriser.draw`, the `whole()`
 * path). That is the path these tests take. It is also what the browser
 * draws for a fogged scene with no holes in it, so for the wire copy of an
 * unrevealed scene "fully covered" is the right answer in both places. A
 * fog that draws nothing at all (an open scene) never reaches the canvas, so
 * it reads 0 here exactly as it does in the browser.
 *
 * The input is `FOG_WIRE_UNREVEALED`, the fixture the server's tests assert a
 * player's and a display device's payload equals. What the server sends is
 * exactly what is covered here.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Role, Scene } from '@safehouse/contracts';
import { cellBitsFrom, encodeCellBits } from '@safehouse/rules';
import { FOG_WIRE_UNREVEALED } from '../../../../../../packages/contracts/test/fog-fixtures.js';
import { metricsFor } from '../geometry.js';
import { EXPLORED_ALPHA } from '../stage/layers.js';
import type { StageSceneState } from '../types.js';
import { CoverMasks } from './masks.js';

// `drawFog`, counted: how often the regions are painted, so the tests can see
// that the party's sight is stamped without painting them again (P6). It
// still draws exactly what it always drew.
const regionPaints = vi.hoisted(() => ({ count: 0 }));
vi.mock('../stage/layers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stage/layers.js')>();
  return {
    ...actual,
    drawFog: (...args: Parameters<typeof actual.drawFog>): void => {
      regionPaints.count += 1;
      actual.drawFog(...args);
    },
  };
});

const COLS = 12;
const ROWS = 8;

function scene(fog: Scene['fog']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bank basement',
    state: 'active',
    grid: { unitM: 1, cols: COLS, rows: ROWS, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog,
    levels: [],
    mapAttachmentIds: [],
  };
}

/** The stage's state for `role` looking at floor `level` of a scene with `fog`: nothing else on it. */
function state(role: Role, fog: Scene['fog'], level = 0): StageSceneState {
  return {
    level,
    scene: scene(fog),
    tokens: [],
    role,
    draggableIds: new Set(),
    bars: new Map(),
    actingTokenId: null,
    selectedTokenId: null,
    tool: 'select',
    snapEnabled: true,
    aoe: null,
    scatter: null,
    fogDraft: null,
  };
}

/** The top-down metrics every flat overlay, and so the fog mask, is drawn in. */
const m = metricsFor(scene(FOG_WIRE_UNREVEALED).grid);

/** How covered the centre of every square is, by the fog alone. */
function fogOverEverySquare(masks: CoverMasks): number[] {
  const out: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) out.push(masks.coveredAt({ x: col + 0.5, y: row + 0.5 }, 'fog'));
  }
  return out;
}

const everywhere = (k: number): number[] => new Array<number>(COLS * ROWS).fill(k);

/** A fresh `CoverMasks` brought in line with `s`, handed to `use`, and freed after. */
function withMasks(s: StageSceneState, use: (masks: CoverMasks) => void): void {
  const masks = new CoverMasks('low');
  try {
    masks.update(s, m);
    use(masks);
  } finally {
    masks.dispose();
  }
}

describe('CoverMasks on the copy the server sends', () => {
  // Observers are sent the same copy as players and the TV, and are covered
  // the same way: every role but the GM gets the fog mask.
  for (const role of ['player', 'display', 'observer'] as const) {
    it(`covers every square for ${role} when the scene is fogged with nothing revealed`, () => {
      withMasks(state(role, FOG_WIRE_UNREVEALED), (masks) => {
        expect(fogOverEverySquare(masks)).toEqual(everywhere(1));
      });
    });
  }

  it('gives the GM no fog mask at all: the GM sees the map through a tint, never under a cover', () => {
    withMasks(state('gm', FOG_WIRE_UNREVEALED), (masks) => {
      expect(fogOverEverySquare(masks)).toEqual(everywhere(0));
    });
  });

  it('covers nothing on a scene whose fog is off, whether the copy says so or has nothing to say', () => {
    const open = { ...FOG_WIRE_UNREVEALED, active: false };
    const unsaid = { regions: [], revealed: [], revealedShapes: [] };
    for (const fog of [open, unsaid]) {
      withMasks(state('player', fog), (masks) => {
        expect(fogOverEverySquare(masks), JSON.stringify(fog)).toEqual(everywhere(0));
      });
    }
  });

  it('rebuilds the cover when the copy says the fog went off, and again when it comes back', () => {
    // The GM's switch reaches a player as nothing but `active` flipping. The
    // mask is rebuilt only when its key moves (`fogKey`), so the flip alone
    // must move it, both ways.
    const masks = new CoverMasks('low');
    try {
      expect(masks.update(state('player', FOG_WIRE_UNREVEALED), m).fog).toBe(true);
      expect(fogOverEverySquare(masks)).toEqual(everywhere(1));

      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, active: false }), m).fog).toBe(true);
      expect(fogOverEverySquare(masks)).toEqual(everywhere(0));

      expect(masks.update(state('player', FOG_WIRE_UNREVEALED), m).fog).toBe(true);
      expect(fogOverEverySquare(masks)).toEqual(everywhere(1));
    } finally {
      masks.dispose();
    }
  });

  it('rebuilds the cover when a region changes fashion, live to seen-before and back (P6)', () => {
    // A region dropped from live to remembered keeps its outline and its
    // place in the copy's regions; only which list names it changes. The
    // mask must still be drawn again (`fogKey`), or the room stays open on
    // the phones and the TV with its guards already taken off them.
    const vault = { id: 'r1', name: 'the vault', polygon: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }] };
    const live = { ...FOG_WIRE_UNREVEALED, regions: [vault], revealed: [vault.id] };
    const remembered = { ...FOG_WIRE_UNREVEALED, regions: [vault], exploredRegionIds: [vault.id] };
    const masks = new CoverMasks('low');
    try {
      expect(masks.update(state('player', live), m).fog).toBe(true);
      expect(masks.update(state('player', live), m).fog).toBe(false);
      expect(masks.update(state('player', remembered), m).fog).toBe(true);
      expect(masks.update(state('player', live), m).fog).toBe(true);
      // A painted shape changing fashion moves the key the same way.
      const shape = vault.polygon;
      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, revealedShapes: [shape] }), m).fog).toBe(true);
      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, exploredShapes: [shape] }), m).fog).toBe(true);
    } finally {
      masks.dispose();
    }
  });
});

/**
 * The party's sight on the cover (sightlines, P6).
 *
 * With a scene's sightlines on, the server sends every phone and the TV the
 * party's pooled sight: per floor, the squares a runner sees now (`live`)
 * and the squares the party has seen (`explored`), as bitsets. The cover
 * stamps them square by square over the regions (`stampSight`): live clear,
 * explored at the explored opacity, the rest left as the regions have it,
 * keeping the lower of the two. In node the regions fail closed (the whole
 * map covered, see the top of this file), so what shows through here is the
 * sight alone, which is also exactly what a scene fogged by its sightlines
 * with nothing revealed by the GM looks like in the browser.
 */
describe("the party's sight stamped on the cover (P6)", () => {
  type Cells = [number, number][];

  /** A sight record on this grid: each floor's `live` squares, and its `explored` ones (which take in the live, as the server keeps them). */
  function sight(floors: Record<number, { live: Cells; explored: Cells }>): NonNullable<Scene['fog']['sight']> {
    const bits = (cells: Cells): string => encodeCellBits(cellBitsFrom(COLS, ROWS, cells.map(([col, row]) => ({ col, row }))));
    const levels: NonNullable<Scene['fog']['sight']>['levels'] = {};
    for (const [level, f] of Object.entries(floors)) levels[level] = { live: bits(f.live), explored: bits([...f.live, ...f.explored]) };
    return { cols: COLS, rows: ROWS, levels };
  }

  /** How covered one square's centre is, by the fog alone. */
  const at = (masks: CoverMasks, col: number, row: number): number => masks.coveredAt({ x: col + 0.5, y: row + 0.5 }, 'fog');

  /** The explored opacity as the one byte a square carries it in. */
  const DIM = Math.round(EXPLORED_ALPHA * 255) / 255;

  /** The fog over every square as the stamp should leave it: `live` 0, `explored` dimmed, the rest 1. */
  function expected(live: Cells, explored: Cells): number[] {
    const out = everywhere(1);
    for (const [col, row] of explored) out[row * COLS + col] = DIM;
    for (const [col, row] of live) out[row * COLS + col] = 0;
    return out;
  }

  /** Every square's fog, to six places, so the byte's rounding is not the question. */
  function expectCover(masks: CoverMasks, want: number[]): void {
    const got = fogOverEverySquare(masks);
    for (let i = 0; i < want.length; i += 1) {
      expect(got[i], `square ${i % COLS},${Math.floor(i / COLS)}`).toBeCloseTo(want[i]!, 6);
    }
  }

  // The runners stand in a corridor, (1,1) and (2,1), and have seen the room at (5,5) and (6,5).
  const seen = sight({ 0: { live: [[1, 1], [2, 1]], explored: [[5, 5], [6, 5]] } });
  const fogged = { ...FOG_WIRE_UNREVEALED, sight: seen };

  for (const role of ['player', 'display', 'observer'] as const) {
    it(`clears what the party sees, dims what it has seen, and covers the rest for ${role}`, () => {
      withMasks(state(role, fogged), (masks) => {
        expectCover(masks, expected([[1, 1], [2, 1]], [[5, 5], [6, 5]]));
        // The three states, read at the stage's own thresholds: live is
        // nothing, remembered is past "not live" (0.3) and short of
        // "hidden" (0.9), hidden is total.
        expect(at(masks, 1, 1)).toBe(0);
        expect(at(masks, 5, 5)).toBeGreaterThan(0.3);
        expect(at(masks, 5, 5)).toBeLessThan(0.9);
        expect(at(masks, 9, 7)).toBe(1);
      });
    });
  }

  it('gives the GM no mask to stamp: the GM sees the whole map through the tint', () => {
    withMasks(state('gm', fogged), (masks) => {
      expect(fogOverEverySquare(masks)).toEqual(everywhere(0));
    });
  });

  it('stamps nothing on an open scene: with the fog off every square is live, whatever the party remembers', () => {
    withMasks(state('player', { ...fogged, active: false }), (masks) => {
      expect(fogOverEverySquare(masks)).toEqual(everywhere(0));
    });
  });

  it("stamps the floor in view only: the party's sight on the ground floor opens nothing upstairs", () => {
    const floors = { ...FOG_WIRE_UNREVEALED, sight: sight({ 0: { live: [[1, 1]], explored: [] }, 1: { live: [[7, 3]], explored: [[8, 3]] } }) };
    withMasks(state('player', floors, 1), (masks) => {
      expectCover(masks, expected([[7, 3]], [[8, 3]]));
    });
    withMasks(state('player', floors, 0), (masks) => {
      expectCover(masks, expected([[1, 1]], []));
    });
    // A floor the party has never looked at: the whole cover.
    withMasks(state('player', floors, 2), (masks) => {
      expect(fogOverEverySquare(masks)).toEqual(everywhere(1));
    });
  });

  it("stamps a runner's step again without painting the regions again, and paints them when they change", () => {
    const masks = new CoverMasks('low');
    try {
      const before = regionPaints.count;
      expect(masks.update(state('player', fogged), m).fog).toBe(true);
      expect(regionPaints.count).toBe(before + 1);

      // The same sight in a new copy of the fog (the scene read again): the
      // key is the bitsets' content, not the object, so nothing is redone.
      expect(masks.update(state('player', { ...fogged, sight: structuredClone(seen) }), m).fog).toBe(false);

      // A runner steps east: the sight moves, and the corridor square
      // behind her is remembered. Stamped again; the regions are not
      // painted again.
      const stepped = sight({ 0: { live: [[2, 1], [3, 1]], explored: [[1, 1], [5, 5], [6, 5]] } });
      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, sight: stepped }), m).fog).toBe(true);
      expect(regionPaints.count).toBe(before + 1);
      expectCover(masks, expected([[2, 1], [3, 1]], [[1, 1], [5, 5], [6, 5]]));

      // Her runner takes the stairs: another floor's sight (none), and
      // still no repaint.
      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, sight: stepped }, 1), m).fog).toBe(true);
      expect(regionPaints.count).toBe(before + 1);
      expect(fogOverEverySquare(masks)).toEqual(everywhere(1));

      // The GM reveals a region: the regions are painted again, once.
      const vault = { id: 'r1', name: 'the vault', polygon: [{ x: 8, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 3 }, { x: 8, y: 3 }] };
      expect(masks.update(state('player', { ...FOG_WIRE_UNREVEALED, regions: [vault], revealed: [vault.id], sight: stepped }, 1), m).fog).toBe(true);
      expect(regionPaints.count).toBe(before + 2);
    } finally {
      masks.dispose();
    }
  });

  it("opens what the party sees even when the regions cannot be painted: the server's sight needs no canvas", () => {
    // The node path, said out loud: no canvas, so the regions fail closed
    // and cover the whole map; the stamp still opens the corridor.
    withMasks(state('display', fogged), (masks) => {
      expect(at(masks, 2, 1)).toBe(0);
      expect(at(masks, 0, 0)).toBe(1);
    });
  });
});
