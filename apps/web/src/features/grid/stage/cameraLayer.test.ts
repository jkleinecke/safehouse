/**
 * A security camera's cone on the floor (FR9.23): `drawCameraCone`, which
 * the 3D map lays under each switched-on camera (`stage3d/markers.ts`).
 *
 * Every square the cone covers is washed, and the two edges of its field of
 * view are drawn out from the mount — a dome has none. Who sees cameras at
 * all is settled before this is called: the server never sends a player one
 * (`sceneForViewer`), and the markers draw them for the GM alone.
 */
import { describe, expect, it } from 'vitest';
import type { Camera as SecurityCamera } from '@safehouse/contracts';
import { metricsFor } from '../geometry.js';
import type { CameraCone } from '../types.js';
import type { Ink } from './ink.js';
import { drawCameraCone } from './layers.js';

const flat = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });
const iso = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'iso' as const });

function counting(): { g: Ink; ops: string[]; polys: number } {
  const ops: string[] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'poly', 'circle', 'moveTo', 'lineTo', 'fill', 'stroke']) {
    g[op] = () => {
      ops.push(op);
      return g;
    };
  }
  return {
    g: g as unknown as Ink,
    ops,
    get polys() {
      return ops.filter((o) => o === 'poly').length;
    },
  };
}

const CAM: SecurityCamera = { id: 'cam_1', at: { x: 2.5, y: 2.5 }, facing: 0, fov: 90, range: 4, level: 0, active: true };
const cone: CameraCone = { id: 'cam_1', cells: new Set(['3,2', '4,2', '4,3', '5,2']), key: 'k' };

describe('drawCameraCone', () => {
  it('washes every square of the cone and draws its two edges, in both projections', () => {
    for (const m of [flat, iso]) {
      const c = counting();
      drawCameraCone(c.g, m, CAM, cone);
      expect(c.polys).toBe(cone.cells.size);
      expect(c.ops.filter((o) => o === 'lineTo').length).toBe(2);
    }
  });

  it('leaves the ink uncleared, so every camera on a floor shares one', () => {
    const c = counting();
    drawCameraCone(c.g, flat, CAM, cone);
    expect(c.ops).not.toContain('clear');
  });

  it('draws a dome with no edges', () => {
    const c = counting();
    drawCameraCone(c.g, flat, { ...CAM, fov: 360 }, cone);
    expect(c.polys).toBe(cone.cells.size);
    expect(c.ops.filter((o) => o === 'lineTo').length).toBe(0);
  });
});
