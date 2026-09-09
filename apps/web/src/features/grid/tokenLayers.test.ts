import { describe, expect, it } from 'vitest';
import { SceneLayerSchema } from '@safehouse/contracts';
import {
  addLayer,
  assignToken,
  hiddenLayerTokenIds,
  layerOfToken,
  layersOf,
  nextLayerId,
  pruneLayers,
  removeLayer,
  renameLayer,
  setLayerHidden,
} from './tokenLayers.js';

describe('token layers (FR9.26)', () => {
  it('a new layer is shown, named, and numbered like the rest of the authoring', () => {
    const one = addLayer([], 'Ambush', ['t1', 't2']);
    expect(one).toEqual([{ id: 'layer_1', name: 'Ambush', hidden: false, tokenIds: ['t1', 't2'] }]);
    expect(addLayer(one, '   ')[1]).toMatchObject({ id: 'layer_2', name: 'Layer 2' });
    for (const l of addLayer(one, 'x')) expect(SceneLayerSchema.safeParse(l).success).toBe(true);
    expect(nextLayerId([{ id: 'layer_2', name: 'a', hidden: false, tokenIds: [] }])).toBe('layer_3');
  });

  it('an old scene has no layers and hides nothing by them', () => {
    expect(layersOf({})).toEqual([]);
    expect(hiddenLayerTokenIds([])).toEqual(new Set());
  });

  it('a hidden layer names its tokens; a shown one hides none', () => {
    let layers = addLayer([], 'Ambush', ['t1', 't2']);
    layers = addLayer(layers, 'Guards', ['t3']);
    layers = setLayerHidden(layers, 'layer_1', true);
    expect(hiddenLayerTokenIds(layers)).toEqual(new Set(['t1', 't2']));
    expect(hiddenLayerTokenIds(setLayerHidden(layers, 'layer_1', false))).toEqual(new Set());
  });

  it('a token is on one layer: assigning moves it, and null takes it off', () => {
    let layers = addLayer([], 'A', ['t1']);
    layers = addLayer(layers, 'B');
    layers = assignToken(layers, 't1', 'layer_2');
    expect(layerOfToken(layers, 't1')?.id).toBe('layer_2');
    expect(layers[0]?.tokenIds).toEqual([]);
    layers = assignToken(layers, 't1', null);
    expect(layerOfToken(layers, 't1')).toBeNull();
    // Creating a layer WITH a token also takes it from where it was.
    layers = assignToken(layers, 't1', 'layer_1');
    layers = addLayer(layers, 'C', ['t1']);
    expect(layerOfToken(layers, 't1')?.id).toBe('layer_3');
  });

  it('renames, keeps a blank name as it was, and forgets a deleted layer without its tokens', () => {
    let layers = addLayer([], 'A', ['t1']);
    expect(renameLayer(layers, 'layer_1', ' Rooftop ')[0]?.name).toBe('Rooftop');
    expect(renameLayer(layers, 'layer_1', '')[0]?.name).toBe('A');
    layers = removeLayer(layers, 'layer_1');
    expect(layers).toEqual([]);
  });

  it('prunes tokens the scene no longer has', () => {
    const layers = addLayer([], 'A', ['t1', 't2']);
    expect(pruneLayers(layers, new Set(['t2']))[0]?.tokenIds).toEqual(['t2']);
  });
});
