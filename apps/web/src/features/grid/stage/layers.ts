/**
 * Static scene layers: 1m grid overlay, fog of war, GM geometry (walls,
 * zones, doors), GM notes — and the floor half of two GM markers, a camera's
 * cone and a light's reach. Redrawn only when the scene object changes —
 * never per frame.
 *
 * No renderer: each layer draws into an `Ink` and puts its text through a
 * `LabelSink` (`ink.ts`). The 3D stage hands over floor meshes (`FloorInk`)
 * and DOM labels; until P5 the 2D stage handed over a pixi Graphics and its
 * pooled Text. Pins, cameras and lights themselves stand up off the floor on
 * the 3D map, and are built there (`stage3d/markers.ts`).
 */
import { sceneFogOn, type Camera as SecurityCamera, type Point, type Scene, type SceneLight } from '@safehouse/contracts';
import type { CameraCone, GeometrySelection } from '../types.js';
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
import { SHROUD_ALPHA } from '../plan/shroud.js';
import { C, parseColor } from './colors.js';
import type { Ink, InkLabel, LabelSink } from './ink.js';
import { NOTE_PAD_PX, noteFrame } from './notes.js';

/**
 * Grid overlay per the scene grid config (FR9.1).
 *
 * Both the lines and the border come from `gridOverlay`, which projects them,
 * so an isometric scene gets a diamond lattice matching its tiles rather than
 * the square one this used to draw over the top of them.
 */
export function drawGrid(g: Ink, m: SceneMetrics): void {
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
function cutSwept(g: Ink, m: SceneMetrics, poly: readonly Point[]): void {
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
 * How covered ground revealed AS EXPLORED is for the table (P6): the map is
 * drawn there dimmed, as remembered, by the same amount the sightline
 * shroud darkens a square a runner cannot see (`SHROUD_ALPHA`). It is the
 * value the players' fog mask carries there (`stage3d/masks.ts`), and it is
 * short of total, so the cover's shader mixes the map toward the ground
 * colour by this much rather than discarding it (`stage3d/cover.ts`: only a
 * cover at `COVER_TOTAL` discards). The stage reads it back to know what is
 * not live (token plates, carried lights) from what is hidden outright
 * (labels, the ray's pass through the map).
 */
export const EXPLORED_ALPHA = SHROUD_ALPHA;

/** The GM's tint over ground the table cannot see at all. */
export const GM_FOG_ALPHA = 0.4;

/** The GM's lighter tint over ground the table is shown dimmed, as explored. */
export const GM_EXPLORED_ALPHA = 0.2;

/**
 * The GM's outline of a region in each of the fog's states, the same colour
 * as its name: cyan while the table cannot see it, amber while it is shown
 * the ground as remembered (explored), green while it sees it live.
 */
const REGION_OUTLINE = {
  hidden: { color: C.cyan, alpha: 0.8 },
  explored: { color: C.warn, alpha: 0.8 },
  live: { color: C.ok, alpha: 0.5 },
} as const;

/**
 * The opacity of the first of the fog's two fills when it has explored
 * ground to show (`drawFog`): what makes the two, laid one over the other
 * where the ground is hidden, come to exactly `total`. Two paints of
 * opacity a and b together cover 1 − (1 − a)(1 − b), so the first is
 * 1 − (1 − total) / (1 − explored). For the players (total 1) that is 1
 * itself; for the GM it keeps hidden ground at `GM_FOG_ALPHA` whether or
 * not anything is explored.
 */
function coverUnder(total: number, explored: number): number {
  return explored >= 1 ? total : 1 - (1 - total) / (1 - explored);
}

/**
 * Fog of war (FR9.13/9.14), in the three states the table sees the map in
 * (P6): LIVE ground in full, EXPLORED ground dimmed as remembered, and
 * everything else hidden. The payload is already server-filtered; this
 * draws what it gets.
 *
 * - Players (and the TV): an OPAQUE cover with every revealed area cut out,
 *   live or explored. When there is explored ground, a second cover goes
 *   over it at `EXPLORED_ALPHA` with only the LIVE areas cut out: over the
 *   hidden ground it changes nothing (it is already total), over the
 *   explored ground it is the dimming, and the live ground stays clear. The
 *   second cover is the whole map rather than each explored area, so two
 *   explored areas that overlap are dimmed once, not twice (twice would
 *   come close to hiding them), and a live area overlapping an explored one
 *   is live there.
 * - The GM: the same shape as a tint, `GM_FOG_ALPHA` over hidden ground and
 *   the lighter `GM_EXPLORED_ALPHA` over explored ground, with every named
 *   region outlined and named in its state's colour: cyan hidden, amber
 *   explored, green live. Explored shapes are outlined in amber too; live
 *   shapes are simply clear.
 *
 * All of it only while the scene is fogged (`sceneFogOn`: its fog switch or
 * its sightlines), the one answer the server, the TV and this map share.
 * With the fog off the GM still sees the outlines and names of the regions,
 * and nothing else.
 */
export function drawFog(
  g: Ink,
  labels: LabelSink,
  scene: Scene,
  m: SceneMetrics,
  isGm: boolean,
): void {
  g.clear();
  const fog = scene.fog;
  const revealed = new Set(fog.revealed);
  // A region is meant to be in one reveal list or neither; should both ever
  // name it, live wins, as it does on the server (`fogCells`).
  const explored = new Set((fog.exploredRegionIds ?? []).filter((id) => !revealed.has(id)));

  // FOG THAT IS OFF DRAWS NO COVER. A scene the GM has not fogged is a scene
  // the table can see, the same way an uploaded map always could be. The
  // cover used to go down regardless and be cut only where a region was
  // revealed — so a freshly built scene, pushed live with nothing defined yet,
  // arrived on every phone and the TV as a solid black screen, while the GM
  // saw a 40% tint they could easily read straight through. Fog is something
  // a GM adds to a map, not something a map starts under.
  //
  // Whether it is on is `sceneFogOn`'s answer, not a rule of this function's own:
  // - On a player's or the TV's copy it is `active`, which the server sets
  //   from state that copy does not carry. The copy holds only the REVEALED
  //   regions, so a scene fogged with nothing revealed yet (or just reset)
  //   arrives with no regions at all and `active: true`, and the cover goes
  //   down whole. A scene the GM has switched off arrives with `active: false`
  //   even while it still carries revealed regions, and nothing goes down.
  // - On the GM's copy it is the GM's switch (`enabled`), or, on a scene
  //   whose switch was never flipped, the old rule: fogged once a region or a
  //   revealed shape exists; or the scene's sightlines, which fog it whatever
  //   the switch says. So the GM's tint comes and goes with the switch, and
  //   the GM's screen and the table's always agree on whether there is fog
  //   at all.
  const on = sceneFogOn(scene);

  // With the fog off, the GM keeps the outlines and names of the regions
  // (below) and loses only the tint. The switch exists so a GM can lay out
  // the regions of a scene the table is already looking at, and regions that
  // vanished from the GM's own map the moment they were drawn could not be
  // laid out at all. Nobody else has anything to draw.
  if (!on && !(isGm && fog.regions.length > 0)) {
    labels.sweep();
    return;
  }

  // The ground each fashion opens: named regions first, in the order the GM
  // drew them, then the painted shapes.
  const liveAreas: Point[][] = [];
  const exploredAreas: Point[][] = [];
  for (const region of fog.regions) {
    if (revealed.has(region.id)) liveAreas.push(region.polygon);
    else if (explored.has(region.id)) exploredAreas.push(region.polygon);
  }
  for (const shape of fog.revealedShapes) if (shape.length >= 3) liveAreas.push(shape);
  const exploredShapes = (fog.exploredShapes ?? []).filter((shape) => shape.length >= 3);
  exploredAreas.push(...exploredShapes);

  if (on) {
    const { width, height } = sceneWorldSize(m);
    const pad = m.cell * 2; // cover a margin so pan never peeks past the edge
    const cover = (alpha: number): void => {
      g.rect(-pad, -pad, width + pad * 2, height + pad * 2).fill({ color: C.ground, alpha });
    };
    const total = isGm ? GM_FOG_ALPHA : 1;
    const dim = isGm ? GM_EXPLORED_ALPHA : EXPLORED_ALPHA;

    // The cover, with every revealed area cut out of it: live and explored.
    cover(exploredAreas.length > 0 ? coverUnder(total, dim) : total);
    for (const area of liveAreas) cutSwept(g, m, area);
    for (const area of exploredAreas) cutSwept(g, m, area);

    // The explored ground dimmed: a second cover at the explored opacity
    // with only the live areas cut out (see above for why the whole map).
    // Swept like every cut, so a remembered room keeps its walls dimmed and
    // a live room inside it keeps them clear.
    if (exploredAreas.length > 0) {
      cover(dim);
      for (const area of liveAreas) cutSwept(g, m, area);
    }
  }

  // GM extras: outlines + name labels for every named region (FR9.14), in
  // the colour of its state, and an outline round each explored shape (a
  // live one is simply clear, as it always was).
  if (isGm) {
    for (const region of fog.regions) {
      const state = revealed.has(region.id) ? 'live' : explored.has(region.id) ? 'explored' : 'hidden';
      const { color, alpha } = REGION_OUTLINE[state];
      g.poly(flatPoly(m, region.polygon)).stroke({ width: 1.5, color, alpha });
      const at = worldFromGrid(m, polygonCenter(region.polygon));
      labels.put(region.id, tag(region.name, at.x, at.y, 0.5, color));
    }
    for (const shape of exploredShapes) {
      g.poly(flatPoly(m, shape)).stroke({ width: 1, ...REGION_OUTLINE.explored });
    }
  }
  labels.sweep();
}

/** A one-line map label at (x, y), centred vertically there and anchored at `anchorX` across. */
function tag(text: string, x: number, y: number, anchorX: number, color: number): InkLabel {
  return { look: 'tag', text, x, y, anchorX, anchorY: 0.5, color };
}

/**
 * GM-layer geometry (FR9.2): walls + zones GM-only; doors render for everyone
 * (they are part of the map) with an open/closed state (toggle is GM-only).
 */
export function drawGeometry(
  g: Ink,
  scene: Scene,
  m: SceneMetrics,
  isGm: boolean,
  selection: GeometrySelection | null = null,
): void {
  g.clear();
  const geo = scene.geometry;
  // The thing open in the inspector is ringed the way a pin is
  // (docs/UX_MAP_BUILDER.md §3.2) — for the GM, who is the only one with one.
  const picked = (kind: GeometrySelection['kind'], id: string): boolean =>
    isGm && selection !== null && selection.kind === kind && selection.id === id;

  if (isGm) {
    for (const wall of geo.walls) {
      const a = worldFromGrid(m, wall.a);
      const b = worldFromGrid(m, wall.b);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: 3, color: C.faint, alpha: 0.8 });

    const wall = selection?.kind === 'wall' ? geo.walls.find((w) => w.id === selection.id) : undefined;
    if (wall) {
      const a = worldFromGrid(m, wall.a);
      const b = worldFromGrid(m, wall.b);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 7, color: C.magenta, alpha: 0.55 });
    }

    for (const zone of geo.zones) {
      const color = parseColor(zone.color, C.cyanDim);
      const open = picked('zone', zone.id);
      g.poly(flatPoly(m, zone.polygon)).fill({ color, alpha: open ? 0.12 : 0.06 }).stroke({
        width: open ? 2 : 1,
        color: open ? C.magenta : color,
        alpha: open ? 0.95 : 0.4,
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
    if (picked('door', door.id)) {
      g.circle(midX, midY, 11).stroke({ width: 2, color: C.magenta, alpha: 0.95 });
    }
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
  g: Ink,
  labels: LabelSink,
  scene: Scene,
  m: SceneMetrics,
  selectedNoteId: string | null,
  isGm: boolean,
): void {
  g.clear();
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
      // The text, wrapped inside the box, dark on the paper.
      labels.put(`note:${note.id}`, {
        look: 'note',
        text: note.text,
        x: f.x + NOTE_PAD_PX,
        y: f.y + NOTE_PAD_PX,
        anchorX: 0,
        anchorY: 0,
        color: C.ground,
        wrap: f.wrap,
      });
    }
  }
  labels.sweep();
}

/** How strongly a security camera's cone (FR9.23) washes each square it covers. */
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

/**
 * One camera's cone: every cell `cone` covers as a flat wash on the floor —
 * amber while the camera is on — and the two edges of its field of view
 * drawn out from its mount as far as the cone reaches along them. Draws on
 * top of what the `Ink` holds; the caller clears it. The 3D map lays it on
 * its floor under each switched-on eye it hangs at the ceiling
 * (`stage3d/markers.ts`), for the GM alone: a player's scene carries no
 * cameras at all (`sceneForViewer`).
 */
export function drawCameraCone(g: Ink, m: SceneMetrics, cam: SecurityCamera, cone: CameraCone): void {
  const color = cam.active ? C.warn : C.faint;
  for (const key of cone.cells) {
    const [col, row] = key.split(',').map(Number);
    if (col === undefined || row === undefined || Number.isNaN(col) || Number.isNaN(row)) continue;
    g.poly(cellCorners(m, col, row).flatMap((p) => [p.x, p.y])).fill({
      color,
      alpha: CAMERA_CONE_ALPHA,
    });
  }
  // The edges of the field of view, as far as the cone itself reaches
  // along them — a wall that cuts the cone cuts its edge too. A dome has
  // none.
  if (cam.fov < 360) {
    const eye = worldFromGrid(m, cam.at);
    for (const side of [-1, 1]) {
      const bearing = cam.facing + (side * cam.fov) / 2;
      const far = worldFromGrid(m, alongBearing(cam.at, bearing, edgeReach(cone.cells, cam.at, bearing, cam.range)));
      g.moveTo(eye.x, eye.y).lineTo(far.x, far.y).stroke({ width: 1, color, alpha: 0.55 });
    }
  }
}

/**
 * How far one light (docs/VISION.md §4.1) reaches, drawn out round it on the
 * floor — a wedge for a spotlight — in its own colour, `unitM` metres a
 * square, so the GM dialling it in can see how far it goes. Draws on top of
 * what the `Ink` holds; the caller clears it. The 3D map lays it on its
 * floor round the selected light, under the lamp it hangs at its height
 * (`stage3d/markers.ts`).
 */
export function drawLightReach(g: Ink, m: SceneMetrics, light: SceneLight, unitM: number): void {
  const on = light.on !== false;
  const color = parseColor(light.color, C.warn);
  const at = worldFromGrid(m, light.at);
  const spot = light.fov !== undefined && light.fov < 360;
  // In grid space and projected, so it lies on the floor.
  const reach = light.radiusM / Math.max(0.01, unitM);
  const from = spot ? (light.facing ?? 0) - (light.fov ?? 360) / 2 : 0;
  const sweep = spot ? (light.fov ?? 360) : 360;
  const steps = Math.max(8, Math.ceil(sweep / 7.5));
  const outline: number[] = spot ? [at.x, at.y] : [];
  for (let i = 0; i <= steps; i += 1) {
    const p = worldFromGrid(m, alongBearing(light.at, from + (sweep * i) / steps, reach));
    outline.push(p.x, p.y);
  }
  g.poly(outline, true)
    .fill({ color, alpha: on ? 0.06 : 0.02 })
    .stroke({ width: 1, color, alpha: on ? 0.6 : 0.3 });
}
