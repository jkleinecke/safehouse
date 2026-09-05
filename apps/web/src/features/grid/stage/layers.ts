/**
 * Static scene layers: 1m grid overlay, fog of war, GM geometry (walls,
 * zones, doors). Redrawn only when the scene object changes — never per frame.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { Point, Scene } from '@safehouse/contracts';
import { TILE_HEIGHTS } from '@safehouse/rules';
import {
  gridOverlay,
  heightRise,
  polygonCenter,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import { C, parseColor } from './colors.js';

/**
 * Grid overlay per the scene grid config (FR9.1).
 *
 * Both the lines and the border come from `gridOverlay`, which projects them,
 * so an isometric scene gets a diamond lattice matching its tiles rather than
 * the square one this used to draw over the top of them.
 */
export function drawGrid(g: Graphics, m: SceneMetrics): void {
  g.clear();
  const { lines, border } = gridOverlay(m);
  const outline = () => {
    g.poly(border.flatMap((p) => [p.x, p.y]), true).stroke({
      width: 1.5,
      color: C.edgeBright,
      alpha: 0.7,
    });
  };
  const alpha = m.opacity;
  if (alpha <= 0) {
    outline();
    return;
  }
  for (const [a, b] of lines) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  g.stroke({ width: 1, color: C.edgeBright, alpha, pixelLine: true });
  outline();
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
 * Cut a revealed region out of the fog, SWEPT upward by a wall's height.
 *
 * A fog region is a polygon on the FLOOR, and in isometric the things standing
 * on that floor are drawn above it — half a cell of screen height per cell of
 * wall. Cutting the floor polygon alone therefore decapitates the room it
 * reveals: the far walls keep their tops and upper faces under the opaque
 * cover, so a revealed room reads as a room with the roof still on. Worse in
 * the other direction, a wall standing on an UNREVEALED square two rows nearer
 * the viewer extrudes up INTO the hole and shows itself to players who have
 * revealed nothing.
 *
 * So the hole is the region swept vertically: the floor polygon, the same
 * polygon lifted by one wall's rise, and a band joining each edge of one to
 * the matching edge of the other. Cuts accumulate, so those three together are
 * the union — the silhouette of the whole volume above the region.
 *
 * The sweep uses a FULL-height wall rather than what happens to stand there.
 * A hole a little taller than the tallest thing in the room shows a sliver of
 * wall above the boundary; a hole sized to the shortest shows a beheaded one.
 * Only one of those is a bug a GM would report.
 */
function cutSwept(g: Graphics, m: SceneMetrics, poly: readonly Point[]): void {
  const flat = poly.map((p) => worldFromGrid(m, p));
  g.poly(flat.flatMap((p) => [p.x, p.y])).cut();

  const rise = heightRise(m, TILE_HEIGHTS.FULL);
  if (rise <= 0) return; // plan view: the floor polygon IS the whole story

  const lifted = flat.map((p) => ({ x: p.x, y: p.y - rise }));
  g.poly(lifted.flatMap((p) => [p.x, p.y])).cut();
  for (let i = 0; i < flat.length; i += 1) {
    const a = flat[i]!;
    const b = flat[(i + 1) % flat.length]!;
    g.poly([a.x, a.y, b.x, b.y, b.x, b.y - rise, a.x, a.y - rise]).cut();
  }
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
    cutSwept(g, m, region.polygon);
  }
  for (const shape of fog.revealedShapes) {
    if (shape.length >= 3) cutSwept(g, m, shape);
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

/** Pooled label text — one per annotation id, created on first sight. */
function ensureLabel(
  layer: Container,
  pool: Map<string, Text>,
  key: string,
  anchorX: number,
): Text {
  const existing = pool.get(key);
  if (existing) return existing;
  const label = new Text({
    text: '',
    style: {
      fill: C.cyan,
      fontSize: 12,
      fontFamily: 'Inter, sans-serif',
      stroke: { color: C.ground, width: 3 },
    },
  });
  label.anchor.set(anchorX, 0.5);
  pool.set(key, label);
  layer.addChild(label);
  return label;
}

/**
 * Map pins (FR9.3): a teardrop head at the pin point with its label beside it.
 *
 * Principle 4 — GM-only pins never reach a player payload (the scenes service
 * filters `geometry.pins` by visibility), so this draws everything it is given.
 * The GM's own view marks private pins with a hollow head so they can tell at
 * a glance what the table can already see.
 */
export function drawPins(
  g: Graphics,
  labelLayer: Container,
  labelPool: Map<string, Text>,
  scene: Scene,
  m: SceneMetrics,
  selectedPinId: string | null,
  isGm = false,
): void {
  g.clear();
  const seen = new Set<string>();
  const r = Math.max(6, m.cell * 0.16);

  // Zone names double as the GM's map labels (FR9.2 "…, labels").
  if (isGm) {
    for (const zone of scene.geometry.zones) {
      const key = `zone:${zone.id}`;
      seen.add(key);
      const at = worldFromGrid(m, polygonCenter(zone.polygon));
      const label = ensureLabel(labelLayer, labelPool, key, 0.5);
      label.text = zone.name;
      label.style.fill = parseColor(zone.color, C.cyanDim);
      label.x = at.x;
      label.y = at.y;
    }
  }

  for (const pin of scene.geometry.pins) {
    const at = worldFromGrid(m, pin.at);
    const isPublic = pin.visibility === 'public';
    const color = isPublic ? C.warn : C.cyan;

    // Stem down to the exact point, head above it — the point is the anchor.
    g.moveTo(at.x, at.y)
      .lineTo(at.x, at.y - r * 1.9)
      .stroke({ width: 2, color, alpha: 0.9 });
    const head = g.circle(at.x, at.y - r * 2.4, r);
    if (isPublic) head.fill({ color, alpha: 0.95 });
    else head.fill({ color: C.ground, alpha: 0.9 });
    head.stroke({ width: 2, color, alpha: 1 });
    g.circle(at.x, at.y, 2).fill({ color, alpha: 1 });

    if (pin.id === selectedPinId) {
      g.circle(at.x, at.y - r * 2.4, r * 1.9).stroke({ width: 2, color: C.magenta, alpha: 0.95 });
    }

    if (!pin.label) continue;
    seen.add(pin.id);
    const label = ensureLabel(labelLayer, labelPool, pin.id, 0);
    label.text = pin.label;
    label.style.fill = color;
    label.x = at.x + r * 1.6;
    label.y = at.y - r * 2.4;
  }

  for (const [id, label] of labelPool) {
    if (seen.has(id)) continue;
    label.destroy();
    labelPool.delete(id);
  }
}
