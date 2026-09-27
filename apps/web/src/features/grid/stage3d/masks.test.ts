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
import { describe, expect, it } from 'vitest';
import type { Role, Scene } from '@safehouse/contracts';
import { FOG_WIRE_UNREVEALED } from '../../../../../../packages/contracts/test/fog-fixtures.js';
import { metricsFor } from '../geometry.js';
import type { StageSceneState } from '../types.js';
import { CoverMasks } from './masks.js';

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

/** The stage's state for `role` looking at a scene with `fog`: nothing else on it. */
function state(role: Role, fog: Scene['fog']): StageSceneState {
  return {
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
});
