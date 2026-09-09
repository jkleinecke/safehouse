/**
 * Static scene layers: 1m grid overlay, fog of war, GM geometry (walls,
 * zones, doors). Redrawn only when the scene object changes — never per frame.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { Point, Scene } from '@safehouse/contracts';
import type { CameraCone } from '../types.js';
import { TILE_HEIGHTS } from '@safehouse/rules';
import {
  cellCorners,
  gridOverlay,
  heightRise,
  polygonCenter,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import { C, parseColor } from './colors.js';
import { NOTE_FONT_PX, NOTE_LINE_PX, NOTE_PAD_PX, noteFrame } from './notes.js';

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

  // NO REGIONS MEANS NO FOG. A scene the GM has not fogged is a scene the
  // table can see, the same way an uploaded map always could be. The cover
  // used to go down regardless and be cut only where a region was revealed —
  // so a freshly built scene, pushed live with nothing defined yet, arrived on
  // every phone and the TV as a solid black screen, while the GM saw a 40%
  // tint they could easily read straight through. Fog is something a GM adds
  // to a map, not something a map starts under.
  if (fog.regions.length === 0 && fog.revealedShapes.length === 0) {
    for (const [id, label] of labelPool) {
      label.destroy();
      labelPool.delete(id);
    }
    return;
  }

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
    // Handle knob at the midpoint — the click target, for the GM and for a
    // player with their hand on the handle (FR9.24).
    g.circle(midX, midY, 5)
      .fill({ color: door.open ? C.ok : C.danger, alpha: 1 })
      .stroke({ width: 1.5, color: C.ground, alpha: 1 });
    // The lock, GM only: a player's payload never says, and a player learns
    // it the way a runner does, by trying the door.
    if (isGm && door.locked) {
      const lx = midX + 10;
      const ly = midY - 10;
      g.rect(lx - 4, ly - 1, 8, 6).fill({ color: C.warn, alpha: 1 });
      g.moveTo(lx - 2.5, ly - 1)
        .lineTo(lx - 2.5, ly - 4)
        .lineTo(lx + 2.5, ly - 4)
        .lineTo(lx + 2.5, ly - 1)
        .stroke({ width: 1.5, color: C.warn, alpha: 1 });
    }
  }
}

/** The paper a note is written on, and its ink, unless the GM picked a colour. */
const NOTE_PAPER = 0xf1d76a;
const NOTE_EDGE = 0x8a6d1f;

/** Pooled note text — wrapped inside the box, dark on the paper. */
function ensureNoteText(layer: Container, pool: Map<string, Text>, key: string): Text {
  const existing = pool.get(key);
  if (existing) return existing;
  const text = new Text({
    text: '',
    style: {
      fill: C.ground,
      fontSize: NOTE_FONT_PX,
      lineHeight: NOTE_LINE_PX,
      fontFamily: 'Inter, sans-serif',
      wordWrap: true,
      wordWrapWidth: 120,
      breakWords: true,
    },
  });
  text.anchor.set(0, 0);
  pool.set(key, text);
  layer.addChild(text);
  return text;
}

/**
 * GM notes (FR9.25): a sticky note pinned to a point on the map, for the GM
 * alone. "How to run this room", "the guard is asleep until someone
 * shoots" — the things a GM used to keep on paper beside the screen.
 *
 * Only the GM's payload carries notes (`sceneForViewer` strips them), and
 * for anyone else this draws nothing at all, even if a note somehow reached
 * their state. The box is `noteFrame`, the same frame the hit-test uses.
 */
export function drawNotes(
  g: Graphics,
  labelLayer: Container,
  labelPool: Map<string, Text>,
  scene: Scene,
  m: SceneMetrics,
  selectedNoteId: string | null,
  isGm: boolean,
): void {
  g.clear();
  const seen = new Set<string>();
  if (isGm) {
    for (const note of scene.geometry.gmNotes ?? []) {
      const f = noteFrame(m, note);
      const paper = parseColor(note.color, NOTE_PAPER);
      g.rect(f.x + 2, f.y + 3, f.w, f.h).fill({ color: C.ground, alpha: 0.35 });
      g.rect(f.x, f.y, f.w, f.h).fill({ color: paper, alpha: 0.94 }).stroke({ width: 1.5, color: NOTE_EDGE, alpha: 0.9 });
      // A tack at the anchor: the box hangs from the point it was dropped on.
      g.circle(f.x, f.y, 3.5).fill({ color: C.magenta, alpha: 1 }).stroke({ width: 1, color: C.ground, alpha: 1 });
      if (note.id === selectedNoteId) {
        g.rect(f.x - 3, f.y - 3, f.w + 6, f.h + 6).stroke({ width: 2, color: C.magenta, alpha: 0.95 });
      }
      const key = `note:${note.id}`;
      seen.add(key);
      const text = ensureNoteText(labelLayer, labelPool, key);
      text.text = note.text;
      text.style.wordWrapWidth = f.wrap;
      text.x = f.x + NOTE_PAD_PX;
      text.y = f.y + NOTE_PAD_PX;
    }
  }
  for (const [id, text] of labelPool) {
    if (seen.has(id)) continue;
    text.destroy();
    labelPool.delete(id);
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

/**
 * Security cameras (FR9.23): the GM's, and only the GM's.
 *
 * Each camera on the floor being drawn gets its eye — a wedge pointing the
 * way it looks, a dot at the mount — and, while it is switched on, its cone:
 * every cell it covers as a flat amber wash on the floor, with the two edges
 * of its field of view drawn out to its reach. A player's scene carries no
 * cameras at all (`sceneForViewer`), so for anyone else this clears the
 * layer and draws nothing, whatever it was handed.
 */
const CAMERA_CONE_ALPHA = 0.16;

/** A point `dist` cells from `at` along a plan bearing in degrees. */
function alongBearing(at: Point, degrees: number, dist: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: at.x + Math.cos(rad) * dist, y: at.y + Math.sin(rad) * dist };
}

/**
 * How far along `bearing` the cone still has cells, in cells. Walks the ray
 * in half-cell steps and stops one step past the last covered square; the
 * edge of a cone the wall has cut should end at the wall, not the reach.
 */
function edgeReach(cells: ReadonlySet<string>, at: Point, bearing: number, range: number): number {
  let reach = 0;
  for (let t = 0.5; t <= range; t += 0.5) {
    const p = alongBearing(at, bearing, t);
    // The edge ray runs along the cone's boundary, so test the square on
    // its inner side as well: a boundary that grazes a corner is still in.
    const inner = alongBearing(at, bearing + (bearing > 0 ? -1 : 1) * 0.0001, t);
    const keyOf = (q: Point) => `${Math.floor(q.x)},${Math.floor(q.y)}`;
    if (cells.has(keyOf(p)) || cells.has(keyOf(inner))) reach = t;
    else if (t > 1.5 && reach > 0) break;
  }
  return Math.max(reach, Math.min(range, 1));
}

export function drawCameras(
  g: Graphics,
  labelLayer: Container,
  labelPool: Map<string, Text>,
  scene: Scene,
  m: SceneMetrics,
  cones: readonly CameraCone[] | null | undefined,
  selectedCameraId: string | null,
  isGm: boolean,
  level: number,
): void {
  g.clear();
  const seen = new Set<string>();

  if (isGm) {
    for (const cam of scene.geometry.cameras ?? []) {
      // One floor at a time, like everything else on the canvas.
      if ((cam.level ?? 0) !== level) continue;
      const color = cam.active ? C.warn : C.faint;
      const cone = cam.active ? cones?.find((c) => c.id === cam.id) : undefined;

      if (cone) {
        for (const key of cone.cells) {
          const [col, row] = key.split(',').map(Number);
          if (col === undefined || row === undefined || Number.isNaN(col) || Number.isNaN(row)) continue;
          g.poly(cellCorners(m, col, row).flatMap((p) => [p.x, p.y])).fill({
            color,
            alpha: CAMERA_CONE_ALPHA,
          });
        }
        // The edges of the field of view, as far as the cone itself reaches
        // along them — a wall that cuts the cone cuts its edge too. A dome
        // has none.
        if (cam.fov < 360) {
          const eye = worldFromGrid(m, cam.at);
          for (const side of [-1, 1]) {
            const bearing = cam.facing + (side * cam.fov) / 2;
            const far = worldFromGrid(m, alongBearing(cam.at, bearing, edgeReach(cone.cells, cam.at, bearing, cam.range)));
            g.moveTo(eye.x, eye.y).lineTo(far.x, far.y).stroke({ width: 1, color, alpha: 0.55 });
          }
        }
      }

      // The eye: a wedge along the facing, a dot at the mount. Built in grid
      // space and projected, so it foreshortens with the floor in isometric.
      const eye = worldFromGrid(m, cam.at);
      const tip = worldFromGrid(m, alongBearing(cam.at, cam.facing, 0.55));
      const left = worldFromGrid(m, alongBearing(cam.at, cam.facing - 38, 0.3));
      const right = worldFromGrid(m, alongBearing(cam.at, cam.facing + 38, 0.3));
      g.poly([eye.x, eye.y, left.x, left.y, tip.x, tip.y, right.x, right.y])
        .fill({ color, alpha: cam.active ? 0.9 : 0.5 })
        .stroke({ width: 1, color: C.ground, alpha: 0.9 });
      g.circle(eye.x, eye.y, 4).fill({ color: C.ground, alpha: 1 }).stroke({ width: 2, color, alpha: 1 });
      if (!cam.active) {
        // A dead eye: struck through, so "off" reads without a label.
        g.moveTo(eye.x - 7, eye.y - 7).lineTo(eye.x + 7, eye.y + 7).stroke({ width: 2, color: C.danger, alpha: 0.9 });
      }
      if (cam.id === selectedCameraId) {
        g.circle(eye.x, eye.y, 13).stroke({ width: 2, color: C.magenta, alpha: 0.95 });
      }

      const key = `cam:${cam.id}`;
      seen.add(key);
      const label = ensureLabel(labelLayer, labelPool, key, 0);
      label.text = cam.label ?? cam.id;
      label.style.fill = color;
      label.x = eye.x + 10;
      label.y = eye.y - 12;
    }
  }

  for (const [id, label] of labelPool) {
    if (seen.has(id)) continue;
    label.destroy();
    labelPool.delete(id);
  }
}
