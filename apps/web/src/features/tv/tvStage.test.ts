/**
 * The read-only stage adapter the TV mounts. Only the pure parts are exercised
 * here — `createTvStage` dynamically imports pixi and needs a real canvas.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import {
  coarseBars,
  parserSafeUrlFor,
  readOnlyStageCallbacks,
  tvStageState,
  TEXTURE_PARSER,
  TV_STAGE_ROLE,
  type AssetRegistry,
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
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
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

describe('parserSafeUrlFor', () => {
  function fakeAssets() {
    const keys = new Set<string>();
    const added: Array<{ alias: string; src: string; parser: string }> = [];
    const assets: AssetRegistry = {
      resolver: { hasKey: (k) => keys.has(k) },
      add: (asset) => {
        keys.add(asset.alias);
        added.push(asset);
      },
    };
    return { assets, added };
  }

  it('registers a texture parser for the extension-less file-store URL', () => {
    // `/files/<uuid>?token=…` has no extension, so pixi matches no parser and
    // the map image silently never appears. Naming the parser skips the test.
    const { assets, added } = fakeAssets();
    const urlFor = parserSafeUrlFor((id) => `/files/${id}?token=abc`, assets);
    expect(urlFor('map-1')).toBe('/files/map-1?token=abc');
    expect(added).toEqual([
      { alias: '/files/map-1?token=abc', src: '/files/map-1?token=abc', parser: TEXTURE_PARSER },
    ]);
  });

  it('registers each URL once, however many tokens ask for it', () => {
    const { assets, added } = fakeAssets();
    const urlFor = parserSafeUrlFor((id) => `/files/${id}`, assets);
    urlFor('art-1');
    urlFor('art-1');
    urlFor('art-2');
    expect(added.map((a) => a.alias)).toEqual(['/files/art-1', '/files/art-2']);
  });

  /**
   * The wrap now lives in `createStage`, so the GM's Grid and a player's phone
   * get it too — not just the TV. Applying it twice along a call chain has to
   * be harmless, or moving it would have been a risk.
   */
  it('is idempotent — wrapping an already-wrapped builder registers nothing new', () => {
    const { assets, added } = fakeAssets();
    const once = parserSafeUrlFor((id) => `/files/${id}`, assets);
    const twice = parserSafeUrlFor(once, assets);
    expect(twice('art-1')).toBe('/files/art-1');
    expect(added).toHaveLength(1);
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
