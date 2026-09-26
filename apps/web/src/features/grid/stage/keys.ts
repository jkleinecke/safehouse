/**
 * The stage's redraw keys — pure, no pixi.
 *
 * A layer is redrawn when its key changes and at no other time: that is what
 * lets a pan, a zoom or a token move leave the grid, the fog and the GM's
 * markers alone. Each key is a string of exactly what its layer draws from,
 * so an edit that changes the drawing changes the key, and nothing else does.
 *
 * Both renderers decide their redraws with these same functions, so an edit
 * the 2D map redraws for is an edit the 3D one rebuilds for too.
 */
import type { TileLayer } from '@safehouse/contracts';
import { metricsKey, type SceneMetrics } from '../geometry.js';
import type { GeometrySelection, StageSceneState } from '../types.js';
import { tileLayerKey } from './tileLayer.js';

export { shroudKey } from './shroudLayer.js';
export { tileLayerKey } from './tileLayer.js';

/** The selected id when the selection is one of `kinds`, else null. */
export function selectedOf(state: StageSceneState, ...kinds: GeometrySelection['kind'][]): string | null {
  const sel = state.selection;
  return sel && kinds.includes(sel.kind) ? sel.id : null;
}

/** The selection as a redraw-key fragment, for the layer that draws those kinds (§3.2). */
export function selectionKey(state: StageSceneState, ...kinds: GeometrySelection['kind'][]): string {
  const id = selectedOf(state, ...kinds);
  return id === null ? '' : `${state.selection?.kind}:${id}`;
}

/** One floor's painted tiles: redrawn on any stroke that changed a cell (see `tileLayerKey`). */
export function tilesKey(sceneId: string, level: number, tiles: TileLayer | null | undefined): string {
  return `L${level}|${tileLayerKey(sceneId, tiles)}`;
}

/**
 * The painted object selected in Build, or a multi-cell selection: the cells
 * it rings, on its floor, in its metrics. Empty when nothing is selected.
 * `multi` wins over `single`, as it does in the drawing.
 */
export function paintedSelectionKey(
  level: number,
  multi: readonly string[] | null,
  single: readonly string[] | null,
  m: SceneMetrics,
): string {
  if (multi) return `M|${level}|${multi.join(';')}|${metricsKey(m)}`;
  if (single) return `${level}|${single.join(';')}|${metricsKey(m)}`;
  return '';
}

/** The map images: redrawn when the attachment list changes. */
export function mapImagesKey(state: StageSceneState): string {
  return state.scene.mapAttachmentIds.join(',');
}

/** One fog's polygons, hashed (`polygonsHash`), by the fog object they were read from. */
const fogShapeHashes = new WeakMap<object, string>();

/**
 * Every point of every polygon in `polygons`, in order, folded into one
 * FNV-1a hash: a region redrawn with the same number of corners, or a
 * revealed shape swapped for another once a list is at its cap, changes it.
 */
function polygonsHash(polygons: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): string {
  let h = 0x811c9dc5;
  const fold = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const poly of polygons) {
    fold(poly.length);
    for (const p of poly) {
      // Thousandths of a square: finer than any fog edge is drawn.
      fold(Math.round(p.x * 1000));
      fold(Math.round(p.y * 1000));
    }
  }
  return (h >>> 0).toString(16);
}

/**
 * The fog: its regions (where each lies, to the point), what is revealed,
 * whether a player's copy says it is fogged at all (`FogState.active`), and
 * whether it is drawn for the GM.
 */
export function fogKey(state: StageSceneState): string {
  const fog = state.scene.fog;
  let shapes = fogShapeHashes.get(fog);
  if (shapes === undefined) {
    // Once per fog object: a token move hands the same fog over again.
    shapes = `${polygonsHash(fog.regions.map((r) => r.polygon))}:${polygonsHash(fog.revealedShapes)}`;
    fogShapeHashes.set(fog, shapes);
  }
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    fog.regions.map((r) => `${r.id}:${r.name}:${r.polygon.length}`).join(','),
    fog.revealed.join(','),
    fog.revealedShapes.length,
    fog.active === true ? 'on' : '',
    shapes,
  ].join('|');
}

/** Walls, zones and doors: any edit to one, and a selection among them. */
export function geometryKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'wall', 'door', 'zone'),
    // Endpoints, not just counts: editing a wall in place must redraw it.
    geo.walls.map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(','),
    geo.zones.map((z) => `${z.id}:${z.name}:${z.color ?? ''}:${z.polygon.length}`).join(','),
    geo.doors
      .map((d) => `${d.id}:${d.open ? 1 : 0}:${d.locked ? 1 : 0}:${d.a.x},${d.a.y},${d.b.x},${d.b.y}`)
      .join(','),
  ].join('|');
}

/** Notes redraw on any edit of any note, and on selection (FR9.25). */
export function noteKey(state: StageSceneState): string {
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'note'),
    (state.scene.geometry.gmNotes ?? [])
      .map((n) => `${n.id}:${n.at.x},${n.at.y}:${n.width}:${n.color ?? ''}:${n.text}`)
      .join('\u0001'),
  ].join('|');
}

/** The GM's security cameras redraw on any edit of one, on selection, on a floor change, and when a cone changes. */
export function cameraKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    state.level ?? 0,
    selectionKey(state, 'camera'),
    (geo.cameras ?? [])
      .map((c) => `${c.id}:${c.at.x},${c.at.y}:${c.facing}:${c.fov}:${c.range}:${c.level}:${c.active ? 1 : 0}:${c.label ?? ''}`)
      .join(','),
    // The cones carry their own content signature (`useCameraCones`).
    (state.cameraCones ?? []).map((c) => c.key).join('|'),
  ].join('|');
}

/** The GM's light markers redraw on any edit of a light on this floor, and on selection. */
export function lightKey(state: StageSceneState): string {
  const level = state.level ?? 0;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    level,
    selectionKey(state, 'light'),
    // Metres a square: the selected light's reach is drawn in squares.
    state.scene.grid.unitM,
    (state.scene.geometry.lights ?? [])
      .filter((l) => (l.level ?? 0) === level)
      .map((l) => `${l.id}:${l.at.x},${l.at.y}:${l.radiusM}:${l.color}:${l.on ? 1 : 0}:${l.facing ?? ''}:${l.fov ?? ''}:${l.label ?? ''}`)
      .join(','),
  ].join('|');
}

/** Pins redraw on any label/position/visibility edit, and on selection. */
export function pinKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'pin'),
    geo.pins.map((p) => `${p.id}:${p.at.x},${p.at.y}:${p.visibility}:${p.label ?? ''}`).join(','),
    // Zone names render into the same label layer for the GM.
    geo.zones.map((z) => `${z.id}:${z.name}`).join(','),
  ].join('|');
}

/** The AoE template and where its scatter landed (FR9.12). Empty when there is none. */
export function aoeKey(state: StageSceneState): string {
  return state.aoe
    ? `${state.aoe.center.x},${state.aoe.center.y},${state.aoe.radiusM}|${state.scatter?.to.x ?? ''},${state.scatter?.to.y ?? ''}`
    : '';
}

/** The GM's fog-region draft, vertex by vertex (FR9.14). Empty when there is none. */
export function fogDraftKey(state: StageSceneState): string {
  return (state.fogDraft?.points ?? []).map((p) => `${p.x},${p.y}`).join(';');
}
