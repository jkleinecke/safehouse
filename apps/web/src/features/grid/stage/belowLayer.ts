/**
 * The floors below, seen wherever the floor on screen has nothing (FR9.22).
 *
 * A square an upper floor leaves unpainted has no floor: it is the atrium,
 * the void over a double-height ballroom, the street beside the building.
 * Standing up there, the GM looks down through it — so every floor below is
 * drawn under the one on screen, a storey lower in isometric for each floor
 * down and a little darker, and the floor on screen covers it wherever it
 * has something painted. No marker says "open": empty IS open.
 *
 * Each floor below is its own chunked layer, redrawn only when that floor
 * changes; the ground floor is never drawn under itself.
 */
import { Container, Graphics } from 'pixi.js';
import type { Scene, TileLayer } from '@safehouse/contracts';
import { levelTiles } from '@safehouse/rules';
import { heightRise, metricsKey, rectCorners, type SceneMetrics } from '../geometry.js';
import type { TileDrawDef } from '../types.js';
import { ChunkedTileLayer } from './tileChunks.js';
import { tileDrawInput, tileLayerKey } from './tileLayer.js';

/** How much darker each storey down reads, as an overlay alpha. */
const DEPTH_SHADE = 0.25;

export class BelowFloors {
  readonly root = new Container();
  /** One per floor below, the ground floor first: [layer, the shade over it]. */
  private readonly floors: Array<{ layer: ChunkedTileLayer; shade: Graphics }> = [];
  private lastKey = '';

  constructor() {
    this.root.eventMode = 'none';
  }

  /** Force the next update to redraw — a new palette changes every square. */
  invalidate(): void {
    this.lastKey = '';
    for (const f of this.floors) f.layer.invalidate();
  }

  update(m: SceneMetrics, scene: Scene, level: number, defs: Record<string, TileDrawDef>): void {
    const below = Array.from({ length: Math.max(0, level) }, (_, i) => i);
    const key = [
      scene.id,
      level,
      metricsKey(m),
      ...below.map((l) => tileLayerKey(scene.id, levelTiles(scene, l) as TileLayer | undefined)),
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    while (this.floors.length < below.length) {
      const f = { layer: new ChunkedTileLayer(), shade: new Graphics() };
      this.root.addChild(f.layer.root, f.shade);
      this.floors.push(f);
    }
    below.forEach((l) => {
      const f = this.floors[l]!;
      const tiles = levelTiles(scene, l) as TileLayer | undefined;
      f.layer.root.visible = tiles !== undefined;
      f.shade.visible = true;
      if (tiles) f.layer.update(m, tileDrawInput(tiles, defs), `${scene.id}#below`, l);
      // A storey down per floor between it and the one on screen: in
      // isometric, a full wall's height lower on screen for each.
      const drop = (level - l) * heightRise(m, 1);
      f.layer.root.y = drop;
      // The light falls off with depth: each floor down is shaded once more,
      // over itself and everything under it.
      f.shade.clear();
      f.shade.poly(rectCorners(m, 0, 0, m.cols, m.rows).map((p) => ({ x: p.x, y: p.y + drop }))).fill({
        color: 0x000000,
        alpha: DEPTH_SHADE,
      });
    });
    for (let i = below.length; i < this.floors.length; i += 1) {
      this.floors[i]!.layer.root.visible = false;
      this.floors[i]!.shade.visible = false;
    }
  }

  clear(): void {
    this.lastKey = '';
    for (const f of this.floors) {
      f.layer.root.visible = false;
      f.shade.visible = false;
    }
  }
}
