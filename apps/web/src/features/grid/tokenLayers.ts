/**
 * Token layers (FR9.26) — pure.
 *
 * A layer is a named set of token ids with one switch. Hidden, every token on
 * it is off the players' table (the server filters; this is the GM's editing
 * model and the canvas's ghosting). A token is on at most one layer, so
 * assigning it to another is moving it, and a layer that is deleted lets its
 * tokens go rather than taking them with it.
 *
 * The scene write is the whole list (`PATCH /api/scenes/:id { tokenLayers }`),
 * so every gesture here is "old list in, new list out", like `geometryEdit`.
 */
import type { Scene, SceneLayer } from '@safehouse/contracts';

export type TokenLayers = readonly SceneLayer[];

export function layersOf(scene: Pick<Scene, 'tokenLayers'>): TokenLayers {
  return scene.tokenLayers ?? [];
}

/** Every token id on a HIDDEN layer. */
export function hiddenLayerTokenIds(layers: TokenLayers): Set<string> {
  const out = new Set<string>();
  for (const l of layers) if (l.hidden) for (const id of l.tokenIds) out.add(id);
  return out;
}

/** The layer a token is on, or null. */
export function layerOfToken(layers: TokenLayers, tokenId: string): SceneLayer | null {
  return layers.find((l) => l.tokenIds.includes(tokenId)) ?? null;
}

/** Deterministic ids, like every other piece of GM authoring: one past the highest. */
export function nextLayerId(layers: TokenLayers): string {
  let max = 0;
  for (const l of layers) {
    const m = /^layer_(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `layer_${max + 1}`;
}

/** A new, shown, empty layer; a blank name becomes "Layer N". */
export function addLayer(layers: TokenLayers, name: string, tokenIds: readonly string[] = []): SceneLayer[] {
  const id = nextLayerId(layers);
  const trimmed = name.trim().slice(0, 60);
  const layer: SceneLayer = {
    id,
    name: trimmed || `Layer ${layers.length + 1}`,
    hidden: false,
    tokenIds: [...new Set(tokenIds)],
  };
  // A token is on one layer: joining this one leaves the others.
  return [...layers.map((l) => without(l, tokenIds)), layer];
}

export function renameLayer(layers: TokenLayers, id: string, name: string): SceneLayer[] {
  const trimmed = name.trim().slice(0, 60);
  return layers.map((l) => (l.id === id && trimmed ? { ...l, name: trimmed } : l));
}

export function setLayerHidden(layers: TokenLayers, id: string, hidden: boolean): SceneLayer[] {
  return layers.map((l) => (l.id === id ? { ...l, hidden } : l));
}

export function removeLayer(layers: TokenLayers, id: string): SceneLayer[] {
  return layers.filter((l) => l.id !== id);
}

/**
 * Put a token on `layerId`, or on no layer when null. Moving, not copying:
 * it leaves whichever layer it was on.
 */
export function assignToken(layers: TokenLayers, tokenId: string, layerId: string | null): SceneLayer[] {
  return layers.map((l) => {
    const stripped = without(l, [tokenId]);
    if (l.id !== layerId) return stripped;
    return { ...stripped, tokenIds: [...stripped.tokenIds, tokenId] };
  });
}

/** Drop ids the scene no longer has — a deleted token is not a member of anything. */
export function pruneLayers(layers: TokenLayers, liveTokenIds: ReadonlySet<string>): SceneLayer[] {
  return layers.map((l) => ({ ...l, tokenIds: l.tokenIds.filter((id) => liveTokenIds.has(id)) }));
}

function without(layer: SceneLayer, ids: readonly string[]): SceneLayer {
  if (!ids.some((id) => layer.tokenIds.includes(id))) return layer;
  return { ...layer, tokenIds: layer.tokenIds.filter((id) => !ids.includes(id)) };
}
