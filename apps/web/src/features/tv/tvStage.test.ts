/**
 * The read-only stage adapter the TV mounts. Only the pure parts are exercised
 * here — `createTvStage` dynamically imports the three.js map and needs a real
 * WebGL2 canvas.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import {
  coarseBars,
  readOnlyStageCallbacks,
  tvFloor3d,
  tvStageState,
  TV_STAGE_ROLE,
  type TvConditionBand,
} from '../grid/tvStage.js';

function scene(): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Redmond rooftop',
    state: 'active',
    grid: { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: ['map-1'],
  };
}

const token: Token = {
  id: 't1',
  sceneId: 's1',
  source: 'character',
  name: 'Wisp',
  x: 3,
  y: 4,
  size: 1,
  rotation: 0,
  hidden: false,
  level: 0,
  barsVisibility: 'public',
};

describe('tvStageState', () => {
  it('pins the display role, so the stage never takes its GM branches', () => {
    expect(TV_STAGE_ROLE).toBe('display');
    expect(tvStageState({ scene: scene(), tokens: [token] }).role).toBe('display');
  });

  it('is a kiosk: nothing draggable, nothing selected, no authoring overlays', () => {
    const state = tvStageState({ scene: scene(), tokens: [token] });
    expect(state.draggableIds.size).toBe(0);
    expect(state.selectedTokenId).toBeNull();
    expect(state.tool).toBe('select');
    expect(state.aoe).toBeNull();
    expect(state.scatter).toBeNull();
    expect(state.fogDraft).toBeNull();
  });

  it('carries the scene, its tokens, and the decorations through untouched', () => {
    const bars = new Map([['t1', coarseBars('wounded', 2)]]);
    const state = tvStageState({
      scene: scene(),
      tokens: [token],
      bars,
      actingTokenId: 't1',
    });
    expect(state.scene.mapAttachmentIds).toEqual(['map-1']);
    expect(state.tokens).toEqual([token]);
    expect(state.bars.get('t1')?.effectCount).toBe(2);
    expect(state.actingTokenId).toBe('t1');
  });

  it('defaults the decorations rather than demanding them', () => {
    const state = tvStageState({ scene: scene(), tokens: [] });
    expect(state.bars.size).toBe(0);
    expect(state.actingTokenId).toBeNull();
  });
});

describe('readOnlyStageCallbacks', () => {
  it('raises nothing — a kiosk has no control surface (FR9.19)', () => {
    const cb = readOnlyStageCallbacks();
    expect(cb.onTokenMove('t1', 1, 2)).toBeUndefined();
    expect(cb.onTokenDrag('t1', 1, 2)).toBeUndefined();
    expect(cb.onSelectToken('t1')).toBeUndefined();
    expect(cb.onPing(1, 2)).toBeUndefined();
    expect(cb.onPointer(1, 2)).toBeUndefined();
    expect(cb.onRuler(null)).toBeUndefined();
    expect(cb.onDoorToggle('d1')).toBeUndefined();
    expect(cb.onAoePlace(1, 2)).toBeUndefined();
    expect(cb.onFogVertex(1, 2)).toBeUndefined();
    expect(cb.onFocus(1, 2)).toBeUndefined();
  });
});

describe('coarseBars', () => {
  it('renders the coarse band and nothing finer — a display never gets boxes', () => {
    const fills: Record<TvConditionBand, number> = {
      fresh: 0,
      scratched: 1,
      wounded: 2,
      bloodied: 3,
      down: 4,
    };
    for (const [band, filled] of Object.entries(fills) as [TvConditionBand, number][]) {
      expect(coarseBars(band).physical).toEqual({ filled, max: 4 });
    }
  });

  it('clamps a nonsense status count instead of drawing negative pips', () => {
    expect(coarseBars('fresh', -3).effectCount).toBe(0);
    expect(coarseBars('fresh', 2.7).effectCount).toBe(2);
  });

});

describe('which floor the wall screen shows (FR9.22)', () => {
  it('follows the acting token upstairs', () => {
    const ground = { ...token, id: 'g', level: 0 };
    const up = { ...token, id: 'u', level: 1 };
    expect(tvFloor3d([ground, up], 'u')).toBe(1);
    expect(tvFloor3d([ground, up], 'g')).toBe(0);
  });

  it('feeds that floor to the stage state', () => {
    const up = { ...token, id: 'u', level: 1 };
    expect(tvStageState({ scene: scene(), tokens: [up], actingTokenId: 'u' }).level).toBe(1);
    // An explicit level still wins, for a caller that knows better.
    expect(tvStageState({ scene: scene(), tokens: [up], actingTokenId: 'u', level: 0 }).level).toBe(
      0,
    );
  });
});
