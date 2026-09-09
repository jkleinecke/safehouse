/**
 * Cameras draw for the GM and for nobody else (FR9.23).
 *
 * The secrecy lives server-side (`sceneForViewer` never sends a player a
 * camera), so this pins the belt-and-braces half: even handed a scene with
 * cameras in it, a player's stage draws none — and the GM's draws the cone,
 * the eye and the label, and drops the cone the moment the camera is off.
 */
import { describe, expect, it } from 'vitest';
import type { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from '@safehouse/contracts';
import { metricsFor } from '../geometry.js';
import type { CameraCone } from '../types.js';
import { drawCameras } from './layers.js';

const flat = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });
const iso = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'iso' as const });

function counting(): { g: Graphics; ops: string[]; polys: number } {
  const ops: string[] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'poly', 'circle', 'moveTo', 'lineTo', 'fill', 'stroke']) {
    g[op] = () => {
      ops.push(op);
      return g;
    };
  }
  return {
    g: g as unknown as Graphics,
    ops,
    get polys() {
      return ops.filter((o) => o === 'poly').length;
    },
  };
}

/**
 * `ensureLabel` constructs a real pixi Text on a pool miss; this pool never
 * misses, handing back a stand-in and recording which keys were asked for.
 */
class StubPool extends Map<string, Text> {
  readonly made: string[] = [];
  override get(key: string): Text {
    if (!this.has(key)) {
      this.made.push(key);
      this.set(key, { text: '', style: {}, x: 0, y: 0, destroy: () => undefined } as unknown as Text);
    }
    return super.get(key)!;
  }
}

function labels(): { layer: Container; pool: StubPool; made: string[] } {
  const layer = { addChild: () => undefined } as unknown as Container;
  const pool = new StubPool();
  return { layer, pool, made: pool.made };
}

function scene(cameras: Scene['geometry']['cameras']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Cams',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], cameras },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

const CAM = { id: 'cam_1', at: { x: 2.5, y: 2.5 }, facing: 0, fov: 90, range: 4, level: 0, active: true };
const cone: CameraCone = { id: 'cam_1', cells: new Set(['3,2', '4,2', '4,3', '5,2']), key: 'k' };

describe('drawCameras', () => {
  it('draws nothing at all for a player', () => {
    const c = counting();
    const l = labels();
    drawCameras(c.g, l.layer, l.pool, scene([CAM]), flat, [cone], null, false, 0);
    expect(c.ops).toEqual(['clear']);
    expect(l.made).toEqual([]);
  });

  it('draws the GM the cone, the eye and a label, in both projections', () => {
    for (const m of [flat, iso]) {
      const c = counting();
      const l = labels();
      drawCameras(c.g, l.layer, l.pool, scene([CAM]), m, [cone], null, true, 0);
      // Four cone cells, one wedge, and the two field-of-view edges.
      expect(c.polys).toBe(cone.cells.size + 1);
      expect(c.ops.filter((o) => o === 'lineTo').length).toBe(2);
      expect(l.made).toEqual(['cam:cam_1']);
    }
  });

  it('drops the cone and its edges when the camera is switched off', () => {
    const c = counting();
    const l = labels();
    drawCameras(c.g, l.layer, l.pool, scene([{ ...CAM, active: false }]), flat, [cone], null, true, 0);
    expect(c.polys).toBe(1); // the wedge only
    expect(c.ops.filter((o) => o === 'lineTo').length).toBe(1); // the strike-through
  });

  it('draws only the cameras on the floor being shown', () => {
    const c = counting();
    const l = labels();
    drawCameras(c.g, l.layer, l.pool, scene([{ ...CAM, level: 1 }]), flat, [cone], null, true, 0);
    expect(c.ops).toEqual(['clear']);
  });

  it('draws a dome with no edges', () => {
    const c = counting();
    const l = labels();
    drawCameras(c.g, l.layer, l.pool, scene([{ ...CAM, fov: 360 }]), flat, [cone], null, true, 0);
    expect(c.ops.filter((o) => o === 'lineTo').length).toBe(0);
  });
});
