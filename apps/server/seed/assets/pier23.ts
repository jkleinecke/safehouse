/**
 * "Pier 23 Warehouse" — the demo campaign's one scene.
 *
 * Original fiction and original geometry (G6/§14). 30 × 20 m on a 1 m grid,
 * which is the whole point of the demo: metres are the unit SR5 measures in,
 * so range bands and movement rates read straight off the grid.
 *
 * The floor plan PNG and the wall/door/zone geometry are generated from the
 * SAME constants below, so the picture and the collision data can never drift.
 * The map is stretched over the calibrated scene rect by the Grid's map layer,
 * so the raster is authored at exactly `cols × rows × PX_PER_M`.
 */
import type { Door, FogRegion, Grid, Pin, SceneEnvironment, Wall, Zone } from '@safehouse/contracts';
import { Raster } from './png.js';

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const PIER23_GRID: Grid = { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const };

/** Sodium spill through the roof lights only: dim light, one tier (−1). */
export const PIER23_ENVIRONMENT: SceneEnvironment = {
  light: 1,
  visibility: 0,
  glare: 0,
  wind: 0,
  note: 'Half the roof lamps are dead and nobody has filed the ticket. Dim light: −1 to anything that needs eyes.',
};

export const PIER23_NOTES = [
  'Pier 23, a leased transhipment shed the Rusted Halo took over when the lease-holder stopped paying anyone.',
  '',
  '- **Loading Dock** (west, 8 m deep): the roller door onto the pier is chained from the outside; the freight door into the main floor is jammed half open and will not close quietly.',
  '- **Main Floor**: crate rows and pallet stacks make an L around the office. Crate 9 — mislabelled *hydroponics, fragile* — is the drone.',
  '- **Office** (south-east): a plywood box with a maglock nobody has changed in two years. The gang counts money in here.',
  '- **Catwalk** (north, 3 m up): runs the length of the shed. The stair at the east end is rusted through at the third tread and the gang knows it.',
  '',
  'Fog opens on the Loading Dock only. Reveal Main Floor when the freight door moves; Catwalk when someone looks up.',
].join('\n');

const PX_PER_M = 24;
const W_PX = PIER23_GRID.cols * PX_PER_M;
const H_PX = PIER23_GRID.rows * PX_PER_M;

/** [x, y, w, h] in metres. */
type Box = readonly [number, number, number, number];

const DOCK: Box = [0, 0, 8, 20];
const CATWALK: Box = [8, 0, 22, 3];
const OFFICE: Box = [24, 12, 6, 8];

/** Crates, drums, the oil slick, the stair — cover and hazards, in metres. */
const PROPS: ReadonlyArray<{ id: string; name: string; box: Box; note: string; color: string }> = [
  { id: 'z.crates.west', name: 'Crate rows (cover)', box: [11, 5, 4, 3], note: 'Shipping crates, chest high. Good cover, terrible footing.', color: '#4a5a49' },
  { id: 'z.crates.nine', name: 'Crate 9 stack (cover)', box: [17, 7, 3, 3], note: 'The mislabelled crate is second from the bottom. Moving it takes two people or a lifter.', color: '#5a6a49' },
  { id: 'z.pallets', name: 'Pallet rows (cover)', box: [16, 13, 5, 4], note: 'Shrink-wrapped pallets. Full cover prone, partial standing.', color: '#4a5a49' },
  { id: 'z.drums', name: 'Drum stacks (flammable)', box: [10, 14, 3, 3], note: 'Solvent drums. Anything with a fire effect here is a GM decision, loudly.', color: '#6a4a3a' },
  { id: 'z.oil', name: 'Transformer oil slick', box: [14, 9, 3, 2], note: 'Slick footing: running through it is an AGI test or you go down.', color: '#1b1f26' },
  { id: 'z.stair', name: 'Catwalk stair', box: [27, 3, 2, 4], note: 'Steel stair to the catwalk. The third tread is rust and paint.', color: '#46505c' },
];

// ---------------------------------------------------------------------------
// Geometry (metres, scene coordinates)
// ---------------------------------------------------------------------------

const wall = (id: string, ax: number, ay: number, bx: number, by: number, note: string): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  note,
});

export const PIER23_WALLS: Wall[] = [
  wall('w.north', 0, 0, 30, 0, 'North wall — corrugated, dented, no openings at ground level.'),
  wall('w.south', 0, 20, 30, 20, 'South wall — backs onto the water.'),
  wall('w.east', 30, 0, 30, 20, 'East wall.'),
  wall('w.west.upper', 0, 0, 0, 6, 'West wall, north of the roller door.'),
  wall('w.west.lower', 0, 10, 0, 20, 'West wall, south of the roller door.'),
  wall('w.dock.upper', 8, 0, 8, 8, 'Dock partition, north run.'),
  wall('w.dock.lower', 8, 11, 8, 20, 'Dock partition, south run.'),
  wall('w.catwalk.rail', 8, 3, 27, 3, 'Catwalk railing — cover from above, not from below.'),
  wall('w.catwalk.rail.east', 29, 3, 30, 3, 'Catwalk railing, east of the stair head.'),
  wall('w.office.north', 24, 12, 30, 12, 'Office wall — plywood over steel studs. It will not stop a burst.'),
  wall('w.office.west.upper', 24, 12, 24, 15, 'Office wall, north of the door.'),
  wall('w.office.west.lower', 24, 16, 24, 20, 'Office wall, south of the door.'),
];

export const PIER23_DOORS: Door[] = [
  {
    id: 'd.roller',
    a: { x: 0, y: 6 },
    b: { x: 0, y: 10 },
    open: false,
    // Locked (FR9.24): a runner's hand on it from inside gets "that door is locked".
    locked: true,
    note: 'Cargo roller door onto the pier. Chained on the outside — the chain is the lock.',
  },
  {
    id: 'd.freight',
    a: { x: 8, y: 8 },
    b: { x: 8, y: 11 },
    open: true,
    // Jammed, not locked: the players can shut it and open it again themselves.
    locked: false,
    note: 'Sliding freight door between dock and main floor, jammed half open. It screams if forced further.',
  },
  {
    id: 'd.office',
    a: { x: 24, y: 15 },
    b: { x: 24, y: 16 },
    open: false,
    // The maglock is engaged until the GM unlocks it (Ratchet's keycard, a decker, a breaching charge).
    locked: true,
    note: 'Office door, cheap maglock. Ratchet has the only working keycard.',
  },
];

export const PIER23_ZONES: Zone[] = PROPS.map((p) => ({
  id: p.id,
  name: p.name,
  polygon: boxPolygon(p.box),
  color: p.color,
  note: p.note,
}));

export const PIER23_PINS: Pin[] = [
  { id: 'p.rollerdoor', at: { x: 1, y: 8 }, label: 'Roller door — the way in', visibility: 'public' },
  { id: 'p.stair', at: { x: 28, y: 5 }, label: 'Stair to the catwalk', visibility: 'public' },
  { id: 'p.crate9', at: { x: 18.5, y: 8.5 }, label: 'Crate 9 — the prototype', visibility: 'gm' },
  { id: 'p.strongbox', at: { x: 28.5, y: 18.5 }, label: 'Office strongbox (gang cash)', visibility: 'gm' },
];

// ---------------------------------------------------------------------------
// Fog regions (FR9.14) — four named reveals
// ---------------------------------------------------------------------------

export const FOG_LOADING_DOCK = 'fog.loading-dock';

export const PIER23_FOG_REGIONS: FogRegion[] = [
  { id: FOG_LOADING_DOCK, name: 'Loading Dock', polygon: boxPolygon(DOCK) },
  {
    id: 'fog.main-floor',
    name: 'Main Floor',
    // L-shaped: the open bay wraps north and west of the office.
    polygon: [
      { x: 8, y: 3 },
      { x: 30, y: 3 },
      { x: 30, y: 12 },
      { x: 24, y: 12 },
      { x: 24, y: 20 },
      { x: 8, y: 20 },
    ],
  },
  { id: 'fog.office', name: 'Office', polygon: boxPolygon(OFFICE) },
  { id: 'fog.catwalk', name: 'Catwalk', polygon: boxPolygon(CATWALK) },
];

function boxPolygon([x, y, w, h]: Box): { x: number; y: number }[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

// ---------------------------------------------------------------------------
// The floor plan raster
// ---------------------------------------------------------------------------

const C = {
  void: 0x0d1014,
  concrete: 0x232931,
  dock: 0x2b323a,
  catwalk: 0x333b45,
  office: 0x2e2a34,
  wall: 0x8b959f,
  wallShadow: 0x11151a,
  doorShut: 0xd08040,
  doorOpen: 0x54a07a,
  grid: 0xffffff,
  label: 0x93a5b3,
  pin: 0xe0c04a,
} as const;

const px = (v: number): number => v * PX_PER_M;

function fillBox(r: Raster, box: Box, color: number): void {
  r.rect(px(box[0]), px(box[1]), px(box[2]), px(box[3]), color);
}

/** Two-line centred caption inside a box, in metres. */
function caption(r: Raster, box: Box, lines: string[], scale: number): void {
  const lineH = 9 * scale;
  const top = px(box[1] + box[3] / 2) - (lines.length * lineH) / 2;
  lines.forEach((line, i) => {
    const x = px(box[0] + box[2] / 2) - Raster.textWidth(line, scale) / 2;
    r.text(x, top + i * lineH, line, C.label, scale, 0.85);
  });
}

/** Draw the 30 × 20 m shed as an 8-bit PNG (720 × 480 at 24 px/m). */
export function renderPier23Map(): Buffer {
  const r = new Raster(W_PX, H_PX, C.void);

  // Floors.
  r.rect(0, 0, W_PX, H_PX, C.concrete);
  fillBox(r, DOCK, C.dock);
  fillBox(r, CATWALK, C.catwalk);
  fillBox(r, OFFICE, C.office);

  // Catwalk grating: hatch every half metre so it reads as "up there".
  for (let x = CATWALK[0]; x < CATWALK[0] + CATWALK[2]; x += 0.5) {
    r.segment(px(x), px(CATWALK[1]), px(x), px(CATWALK[1] + CATWALK[3]), 0xffffff, { width: 1, alpha: 0.05 });
  }
  // Dock floor stripes at the roller door mouth.
  for (let i = 0; i < 6; i += 1) {
    r.rect(px(0.4 + i * 1.2), px(6.2), px(0.6), px(3.6), 0xe8c24a, 0.16);
  }

  // Props (cover, hazards, the stair).
  for (const prop of PROPS) {
    const [x, y, w, h] = prop.box;
    const body = Number.parseInt(prop.color.slice(1), 16);
    r.rect(px(x), px(y), px(w), px(h), body, 0.95);
    r.outline(px(x), px(y), px(w), px(h), 0xffffff, { width: 1, alpha: 0.18 });
    if (prop.id === 'z.stair') {
      for (let t = 0.5; t < h; t += 0.5) {
        r.segment(px(x), px(y + t), px(x + w), px(y + t), 0xffffff, { width: 1, alpha: 0.22 });
      }
    }
  }

  // Grid: 1 m faint, 5 m stronger — aligned to the scene rect the app draws.
  for (let x = 1; x < PIER23_GRID.cols; x += 1) {
    const strong = x % 5 === 0;
    r.segment(px(x), 0, px(x), H_PX, C.grid, { width: 1, alpha: strong ? 0.1 : 0.04 });
  }
  for (let y = 1; y < PIER23_GRID.rows; y += 1) {
    const strong = y % 5 === 0;
    r.segment(0, px(y), W_PX, px(y), C.grid, { width: 1, alpha: strong ? 0.1 : 0.04 });
  }

  // Walls, with a drop shadow so they read at TV distance.
  for (const w of PIER23_WALLS) {
    r.segment(px(w.a.x), px(w.a.y) + 2, px(w.b.x), px(w.b.y) + 2, C.wallShadow, { width: 8, alpha: 0.5 });
    r.segment(px(w.a.x), px(w.a.y), px(w.b.x), px(w.b.y), C.wall, { width: 6 });
  }

  // Doors: amber shut, green open.
  for (const d of PIER23_DOORS) {
    r.segment(px(d.a.x), px(d.a.y), px(d.b.x), px(d.b.y), d.open ? C.doorOpen : C.doorShut, {
      width: 7,
    });
  }

  // Pins.
  for (const pin of PIER23_PINS) {
    r.rect(px(pin.at.x) - 4, px(pin.at.y) - 4, 8, 8, C.pin, pin.visibility === 'gm' ? 0.55 : 0.9);
  }

  // Region captions + a title block in the empty south-west corner.
  caption(r, DOCK, ['LOADING', 'DOCK'], 2);
  caption(r, [8, 0, 22, 3], ['CATWALK'], 2);
  caption(r, [8, 3, 16, 4], ['MAIN FLOOR'], 2);
  caption(r, OFFICE, ['OFFICE'], 2);
  r.text(px(8.6), H_PX - 26, 'PIER 23 - 30 X 20 M - 1 M GRID', C.label, 2, 0.5);
  r.text(px(25.6), px(4.4), 'STAIR', C.label, 1, 0.7);

  return r.toPng();
}
