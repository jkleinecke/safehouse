/**
 * What the GM's cameras cover (FR9.23): the cone of every active camera on
 * the floor being drawn, cut by that floor's own walls.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { cameraConesFor } from './useCameraCones.js';

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: {
      walls: [],
      doors: [],
      zones: [],
      pins: [],
      cameras: [
        { id: 'cam_1', at: { x: 1.5, y: 4.5 }, facing: 0, fov: 60, range: 6, level: 0, active: true },
        { id: 'cam_2', at: { x: 10.5, y: 4.5 }, facing: 180, fov: 60, range: 6, level: 0, active: false },
        { id: 'cam_3', at: { x: 6.5, y: 1.5 }, facing: 90, fov: 60, range: 6, level: 1, active: true },
      ],
    },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
    ...over,
  } as unknown as Scene;
}

describe('cameraConesFor', () => {
  it('gives every switched-on camera on this floor a cone, and nothing to the rest', () => {
    const cones = cameraConesFor(scene(), 0);
    expect(cones.map((c) => c.id)).toEqual(['cam_1']);
    const cam1 = cones[0]!;
    expect(cam1.cells.has('5,4')).toBe(true); // ahead
    expect(cam1.cells.has('1,4')).toBe(false); // its own mount
    expect(cam1.cells.has('1,1')).toBe(false); // off to the side
    // The key names the content, so a changed cone is a changed key.
    expect(cam1.key.startsWith('cam_1:')).toBe(true);
    expect(cameraConesFor(scene(), 1).map((c) => c.id)).toEqual(['cam_3']);
  });

  it('is cut by a traced wall', () => {
    const open = cameraConesFor(scene(), 0)[0]!;
    const walled = cameraConesFor(
      scene({
        geometry: {
          walls: [{ id: 'w1', a: { x: 4, y: 2 }, b: { x: 4, y: 7 } }],
          doors: [],
          zones: [],
          pins: [],
          cameras: scene().geometry.cameras,
        },
      } as Partial<Scene>),
      0,
    )[0]!;
    expect(open.cells.has('6,4')).toBe(true);
    expect(walled.cells.has('6,4')).toBe(false);
    expect(walled.cells.has('3,4')).toBe(true);
    expect(walled.key).not.toBe(open.key);
  });

  it('is empty, not absent, for a floor with no cameras', () => {
    expect(cameraConesFor(scene(), 3)).toEqual([]);
  });
});
