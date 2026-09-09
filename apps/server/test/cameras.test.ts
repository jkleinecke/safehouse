/**
 * Security cameras never reach a player (FR9.23, Principle 4).
 *
 * The GM's cameras ride inside `geometry`, which players receive filtered.
 * This pins the filter at the function that does it, because the failure —
 * a camera list on a player socket — is invisible from the GM's own screen
 * and is exactly the kind of leak a table finds out about the wrong way.
 */
import { describe, expect, it } from 'vitest';
import { SceneSchema, type Scene } from '@safehouse/contracts';
import { sceneForViewer } from '../src/services/scenes.js';

const scene: Scene = SceneSchema.parse({
  id: 's1',
  campaignId: 'c1',
  name: 'Loading bay',
  state: 'active',
  grid: { cols: 20, rows: 12 },
  geometry: {
    walls: [{ id: 'w1', a: { x: 0, y: 4 }, b: { x: 8, y: 4 } }],
    pins: [
      { id: 'p1', at: { x: 1, y: 1 }, visibility: 'public', label: 'Gate' },
      { id: 'p2', at: { x: 2, y: 2 }, visibility: 'gm', label: 'Guard post' },
    ],
    cameras: [
      { id: 'cam_1', at: { x: 8, y: 4 }, facing: 90, fov: 90, range: 12 },
      { id: 'cam_2', at: { x: 2, y: 2 }, facing: 0, fov: 120, range: 8, active: false },
    ],
  },
});

describe('sceneForViewer and cameras', () => {
  it('hands the GM every camera', () => {
    expect(sceneForViewer(scene, true).geometry.cameras?.map((c) => c.id)).toEqual(['cam_1', 'cam_2']);
  });

  it('sends a player no cameras at all — not even an empty list', () => {
    const seen = sceneForViewer(scene, false);
    expect(seen.geometry.cameras).toBeUndefined();
    expect('cameras' in seen.geometry).toBe(false);
    // The blunt version: the ids are nowhere in what goes on the wire.
    const wire = JSON.stringify(seen);
    expect(wire).not.toContain('cam_1');
    expect(wire).not.toContain('cam_2');
    // …and the rest of the filter is unchanged by the new field: the wall
    // itself reaches the player (it cuts their sightline), the private pin does not.
    expect(seen.geometry.walls.map((w) => w.id)).toEqual(['w1']);
    expect(seen.geometry.pins.map((p) => p.id)).toEqual(['p1']);
  });
});
