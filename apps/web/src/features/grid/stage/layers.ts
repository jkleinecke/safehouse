/**
 * Static scene layers: 1m grid overlay, fog of war, GM geometry (walls,
 * zones, doors). Redrawn only when the scene object changes — never per frame.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { Point, Scene } from '@safehouse/contracts';
import { polygonCenter, sceneWorldSize, worldFromGrid, type SceneMetrics } from '../geometry.js';
import { C, parseColor } from './colors.js';

/** Grid overlay per the scene grid config (FR9.1). */
export function drawGrid(g: Graphics, m: SceneMetrics): void {
  g.clear();
  const { width, height } = sceneWorldSize(m);
  const alpha = m.opacity;
  if (alpha <= 0) {
    g.rect(0, 0, width, height).stroke({ width: 1.5, color: C.edgeBright, alpha: 0.7 });
    return;
  }
  for (let col = 0; col <= m.cols; col += 1) {
    g.moveTo(col * m.cell, 0).lineTo(col * m.cell, height);
  }
  for (let row = 0; row <= m.rows; row += 1) {
    g.moveTo(0, row * m.cell).lineTo(width, row * m.cell);
  }
  g.stroke({ width: 1, color: C.edgeBright, alpha, pixelLine: true });
  g.rect(0, 0, width, height).stroke({ width: 1.5, color: C.edgeBright, alpha: 0.7 });
}

function flatPoly(m: SceneMetrics, poly: readonly Point[]): number[] {
  const out: number[] = [];
  for (const p of poly) {
    const w = worldFromGrid(m, p);
    out.push(w.x, w.y);
  }
  return out;
}

/**
 * Fog of war (FR9.13/9.14). Players get an OPAQUE cover with revealed areas
 * cut out — the payload is already server-filtered, we render what we get.
 * The GM gets the same shape as a 40% tint plus named-region outlines+labels.
 */
export function drawFog(
  g: Graphics,
  labelLayer: Container,
  labelPool: Map<string, Text>,
  scene: Scene,
  m: SceneMetrics,
  isGm: boolean,
): void {
  g.clear();
  const fog = scene.fog;
  const { width, height } = sceneWorldSize(m);
  const pad = m.cell * 2; // cover a margin so pan never peeks past the edge
  g.rect(-pad, -pad, width + pad * 2, height + pad * 2).fill({
    color: C.ground,
    alpha: isGm ? 0.4 : 1,
  });

  const revealed = new Set(fog.revealed);
  for (const region of fog.regions) {
    if (!revealed.has(region.id)) continue;
    g.poly(flatPoly(m, region.polygon)).cut();
  }
  for (const shape of fog.revealedShapes) {
    if (shape.length >= 3) g.poly(flatPoly(m, shape)).cut();
  }

  // GM extras: outlines + name labels for every named region (FR9.14).
  const seen = new Set<string>();
  if (isGm) {
    for (const region of fog.regions) {
      const isOpen = revealed.has(region.id);
      g.poly(flatPoly(m, region.polygon)).stroke({
        width: 1.5,
        color: isOpen ? C.ok : C.cyan,
        alpha: isOpen ? 0.5 : 0.8,
      });
      seen.add(region.id);
      let label = labelPool.get(region.id);
      if (!label) {
        label = new Text({
          text: '',
          style: {
            fill: C.cyan,
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
            stroke: { color: C.ground, width: 3 },
          },
        });
        label.anchor.set(0.5);
        labelPool.set(region.id, label);
        labelLayer.addChild(label);
      }
      label.text = region.name;
      label.style.fill = isOpen ? C.ok : C.cyan;
      const at = worldFromGrid(m, polygonCenter(region.polygon));
      label.x = at.x;
      label.y = at.y;
    }
  }
  for (const [id, label] of labelPool) {
    if (!seen.has(id)) {
      label.destroy();
      labelPool.delete(id);
    }
  }
}

/**
 * GM-layer geometry (FR9.2): walls + zones GM-only; doors render for everyone
 * (they are part of the map) with an open/closed state (toggle is GM-only).
 */
export function drawGeometry(g: Graphics, scene: Scene, m: SceneMetrics, isGm: boolean): void {
  g.clear();
  const geo = scene.geometry;

  if (isGm) {
    for (const wall of geo.walls) {
      const a = worldFromGrid(m, wall.a);
      const b = worldFromGrid(m, wall.b);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: 3, color: C.faint, alpha: 0.8 });

    for (const zone of geo.zones) {
      const color = parseColor(zone.color, C.cyanDim);
      g.poly(flatPoly(m, zone.polygon)).fill({ color, alpha: 0.06 }).stroke({
        width: 1,
        color,
        alpha: 0.4,
      });
    }
  }

  for (const door of geo.doors) {
    const a = worldFromGrid(m, door.a);
    const b = worldFromGrid(m, door.b);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (door.open) {
      // Open: two stubs with a gap at the middle.
      const t = 0.32;
      g.moveTo(a.x, a.y)
        .lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        .moveTo(b.x, b.y)
        .lineTo(b.x + (a.x - b.x) * t, b.y + (a.y - b.y) * t)
        .stroke({ width: 4, color: C.ok, alpha: 0.9 });
    } else {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color: C.danger, alpha: 0.9 });
    }
    // Handle knob at the midpoint — the GM's click target.
    g.circle(midX, midY, 5)
      .fill({ color: door.open ? C.ok : C.danger, alpha: 1 })
      .stroke({ width: 1.5, color: C.ground, alpha: 1 });
  }
}
