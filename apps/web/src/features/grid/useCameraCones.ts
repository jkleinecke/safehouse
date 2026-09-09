/**
 * What the GM's cameras cover (FR9.23).
 *
 * Each active camera on the floor being drawn gets its cone: the same
 * sightline a token would have from its mount, trimmed to its facing and
 * field of view, cut by the walls and tiles of ITS floor. Computed here in
 * React land, once per change to anything that can move a sightline, and
 * handed to the stage as a finished set — the stage draws, it does not think.
 *
 * GM only, and not merely because players are not shown cones: a player's
 * scene carries no cameras at all (`sceneForViewer`), so there is nothing to
 * compute. The hook returns null for them rather than an empty list, which
 * is what lets the stage tell "no cones" from "no cameras on this floor".
 */
import { useMemo } from 'react';
import type { Scene } from '@safehouse/contracts';
import { coneCells, sightModelFor } from '@safehouse/rules';
import type { CameraCone } from './types.js';

/** Pure: the cones of every active camera on `level`. */
export function cameraConesFor(scene: Scene, level: number): CameraCone[] {
  const cameras = (scene.geometry.cameras ?? []).filter((c) => c.active && (c.level ?? 0) === level);
  if (cameras.length === 0) return [];
  // One model per floor, shared by every camera on it.
  const model = sightModelFor(scene, level);
  const bounds = { cols: scene.grid.cols, rows: scene.grid.rows };
  return cameras.map((cam) => {
    const cells = new Set(coneCells(cam, model, bounds).keys());
    // The key names the cone's content, not its size: a wall painted across
    // the middle of a cone can leave the count identical and the shape not.
    return { id: cam.id, cells, key: `${cam.id}:${[...cells].sort().join(';')}` };
  });
}

export function useCameraCones(
  scene: Scene | null | undefined,
  isGm: boolean,
  level: number,
): CameraCone[] | null {
  return useMemo(() => {
    if (!scene || !isGm) return null;
    return cameraConesFor(scene, level);
    // The things that move a sightline, plus the cameras themselves.
    // Stringified because these are fresh objects on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene?.id,
    isGm,
    level,
    JSON.stringify(scene?.geometry.cameras ?? []),
    JSON.stringify(scene?.tiles ?? null),
    JSON.stringify(scene?.levels ?? []),
    JSON.stringify(scene?.geometry.walls ?? []),
    JSON.stringify(scene?.geometry.doors ?? []),
    scene?.grid.cols,
    scene?.grid.rows,
  ]);
}
