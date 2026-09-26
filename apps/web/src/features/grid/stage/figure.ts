/**
 * A token on the isometric map, drawn as someone standing in the scene.
 *
 * In plan view a token is a disc with a face on it, and that is right: the
 * map is a diagram. The isometric map is a place — walls with height, sofas
 * with backs — and a disc lying on its floor reads as a sticker on the glass.
 * So there a token is a figure, built the way the furniture is: boxes and
 * rods in three dimensions, projected by the same 2:1 transform and lit by
 * the same key light (`colors.ts`), so it stands in the room with the rest.
 *
 * And it is a Sixth World figure, not a mannequin (2026-09-25): an archetype
 * — street samurai, decker, mage, rigger, face, adept, ganger, corp security,
 * wage slave — and a metatype, dressed dark with neon at the seams. Chrome
 * arms, mirrorshades and visors, mohawks, dusters, a rifle slung across the
 * back, a deck at the hip, a focus glowing in a mage's hand. A troll is big
 * and horned, a dwarf short and bearded, an ork tusked, an elf tall and
 * slight. Which is which comes from the token's name when it says ("Troll
 * Samurai", "Lone Star Officer") and otherwise from the token itself, fixed,
 * so a runner looks the same every session.
 *
 * The neon on a figure is its side's colour — cyan for runners, red for
 * opposition, amber for everyone else — so a crowd sorts itself at a glance.
 *
 * The portrait does not go away. It rides above the head as a badge
 * (`TokenView`), which is how a player finds their runner in a crowd.
 *
 * Everything here is in BODY units: a standing human is 1 tall with its feet
 * at the origin. A point is `[forward, side, up]` — forward the way the
 * figure faces, side its right hand. A metatype's build scales the lot.
 */
import type { Graphics } from 'pixi.js';
import type { Token, TokenLook, TokenPose } from '@safehouse/contracts';
import { ISO_HALF_H, ISO_HALF_W } from '../geometry.js';
import { shade } from './colors.js';

/** What the figure is doing. `down` is the condition monitor's call, never stored. */
export type FigurePose = TokenPose | 'down';

export type Metatype = 'human' | 'elf' | 'dwarf' | 'ork' | 'troll';
export type Archetype =
  | 'samurai'
  | 'decker'
  | 'mage'
  | 'rigger'
  | 'face'
  | 'adept'
  | 'ganger'
  | 'security'
  | 'civilian';

type Outfit = 'jacket' | 'duster' | 'hoodie' | 'armor' | 'suit' | 'vest';
type HeadStyle = 'mohawk' | 'crop' | 'long' | 'shaved' | 'hood' | 'helmet' | 'topknot';
type Eyes = 'shades' | 'visor' | 'cybereye' | 'goggles' | 'none';
type Gear = 'rifle' | 'katana' | 'pistol' | 'deck' | 'focus' | 'remote' | 'none';

export interface FigureLook {
  archetype: Archetype;
  metatype: Metatype;
  /** Across and up, against a human's 1. */
  build: { w: number; h: number };
  outfit: Outfit;
  headStyle: HeadStyle;
  eyes: Eyes;
  gear: Gear;
  /** Which arm is chrome: -1 left, 1 right, 0 neither. */
  cyberarm: -1 | 0 | 1;
  /** Plates on the shoulders. */
  pads: boolean;
  skin: number;
  hair: number;
  coat: number;
  under: number;
  legs: number;
  boots: number;
  /** The side's colour, on the seams, the visor, the gear. */
  neon: number;
  chrome: number;
  /** A prop token — a crate, a barricade, a van — is a box, not a person. */
  crate: boolean;
}

export interface FigureFrame {
  pose: FigurePose;
  /** Radians in grid space: 0 faces +x (east), π/2 faces +y (south). */
  facing: number;
  /** The walk cycle, radians. */
  phase: number;
  /** How much stride is in the legs: 0 standing still, 1 walking. */
  stride: number;
  /** Down from physical damage rather than stun: there is blood. */
  bleeding: boolean;
}

type V3 = readonly [number, number, number];

const OUTLINE = 0x07080b;
const BONE = 0xd9cfb4;
const GUNMETAL = 0x2a2e35;

/** Toward the key light, in grid space (x, y, up) — see `FACE_SHADE` in colors.ts. */
const LIGHT = (() => {
  const n = Math.hypot(0.5, 0.75, 1);
  return [0.5 / n, 0.75 / n, 1 / n] as const;
})();

/** A face's colour under the key light: half ambient, half Lambert. */
function lit(color: number, n: readonly [number, number, number]): number {
  const lambert = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
  return shade(color, 0.502 + 0.502 * Math.max(0, lambert));
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function unit(a: V3): V3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Body space to the screen, for one figure facing one way. */
class Rig {
  private readonly c: number;
  private readonly s: number;
  /** Signed screen area of a face known to be turned to the viewer (see `box`). */
  readonly front: number;

  constructor(
    private readonly H: number,
    private readonly cell: number,
    facing: number,
    /** Grid units per body unit across the floor. */
    private readonly g: number,
    /** The metatype: across (forward and side) and up. */
    private readonly bw = 1,
    private readonly bh = 1,
  ) {
    this.c = Math.cos(facing);
    this.s = Math.sin(facing);
    this.front = 1;
    const top = boxFaces([0, 0, 0], [0, 0, 1], 0.5, 0.5)[0]!;
    this.front = Math.sign(area(top.pts.map((p) => this.at(p)))) || 1;
  }

  grid(p: V3): [number, number] {
    const f = p[0] * this.bw;
    const sd = p[1] * this.bw;
    return [(f * this.c - sd * this.s) * this.g, (f * this.s + sd * this.c) * this.g];
  }

  at(p: V3): { x: number; y: number } {
    const [gx, gy] = this.grid(p);
    return { x: (gx - gy) * this.cell * ISO_HALF_W, y: (gx + gy) * this.cell * ISO_HALF_H - p[2] * this.H * this.bh };
  }

  /** Nearer the viewer is larger; height breaks a tie, so a head sits on its shoulders. */
  depth(p: V3): number {
    const [gx, gy] = this.grid(p);
    return gx + gy + p[2] * 0.01;
  }

  /** A body-space direction in grid space, for lighting. */
  dir(v: V3): [number, number, number] {
    return [v[0] * this.c - v[1] * this.s, v[0] * this.s + v[1] * this.c, v[2]];
  }

  /** Body units to px, as thicknesses: by the metatype's bulk. */
  px(bodyUnits: number): number {
    return bodyUnits * this.H * this.bw;
  }

  /** 1 facing the viewer, -1 facing away. */
  toward(): number {
    return (this.c + this.s) / Math.SQRT2;
  }
}

function area(pts: ReadonlyArray<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

type FaceName = 'top' | 'bottom' | 'right' | 'left' | 'back' | 'front';

/**
 * The six faces of a box from `B` to `T` (its long axis), `wS` either side
 * and `wD` before and behind — or a frustum, when the top end is given its
 * own widths — each wound the same way round its outward normal, so one sign
 * of projected area means "turned to the viewer" for all of them. The side
 * axis is the body's own: the poses only ever tilt a box forward, in the
 * plane it faces along. For an upright box `front` faces forward; for one
 * lying along the body, `back` faces up.
 */
function boxFaces(B: V3, T: V3, wS: number, wD: number, tS = wS, tD = wD): Array<{ name: FaceName; n: V3; pts: V3[] }> {
  const a = unit(sub(T, B));
  const u: V3 = [0, 1, 0];
  const w = cross(a, u);
  const P = (i: number, j: number, k: number): V3 => {
    const o = k ? T : B;
    const s = k ? tS : wS;
    const d = k ? tD : wD;
    return [o[0] + u[0] * i * s + w[0] * j * d, o[1] + u[1] * i * s + w[1] * j * d, o[2] + u[2] * i * s + w[2] * j * d];
  };
  return [
    { name: 'top', n: a, pts: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)] },
    { name: 'bottom', n: neg(a), pts: [P(-1, -1, 0), P(-1, 1, 0), P(1, 1, 0), P(1, -1, 0)] },
    { name: 'right', n: u, pts: [P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)] },
    { name: 'left', n: neg(u), pts: [P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, 0)] },
    { name: 'back', n: w, pts: [P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1), P(1, 1, 0)] },
    { name: 'front', n: neg(w), pts: [P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)] },
  ];
}

/** Draw a box (or frustum); returns the faces that were turned to the viewer. */
function box(g: Graphics, rig: Rig, B: V3, T: V3, wS: number, wD: number, color: number, tS = wS, tD = wD): Set<FaceName> {
  const shown = new Set<FaceName>();
  for (const face of boxFaces(B, T, wS, wD, tS, tD)) {
    const pts = face.pts.map((p) => rig.at(p));
    const a = area(pts);
    if (Math.sign(a) !== rig.front || Math.abs(a) < 0.01) continue;
    shown.add(face.name);
    g.poly(pts)
      .fill({ color: lit(color, rig.dir(face.n)) })
      .stroke({ width: 0.75, color: OUTLINE, alpha: 0.45, join: 'round' });
  }
  return shown;
}

function trace(g: Graphics, p: ReadonlyArray<{ x: number; y: number }>): void {
  g.moveTo(p[0]!.x, p[0]!.y);
  for (let i = 1; i < p.length; i += 1) g.lineTo(p[i]!.x, p[i]!.y);
}

/** A limb or a length of kit: a rod through its joints, inked round the edge like the props are. */
function rod(g: Graphics, rig: Rig, pts: readonly V3[], width: number, color: number): void {
  const p = pts.map((q) => rig.at(q));
  const w = Math.max(1.3, rig.px(width));
  trace(g, p);
  g.stroke({ width: w + 1.4, color: OUTLINE, alpha: 0.55, cap: 'round', join: 'round' });
  trace(g, p);
  g.stroke({ width: w, color, cap: 'round', join: 'round' });
}

/** A lit line: a soft halo and a hot core, the colour of the side. */
function neon(g: Graphics, rig: Rig, pts: readonly V3[], color: number, width = 0.018): void {
  const p = pts.map((q) => rig.at(q));
  const w = Math.max(0.9, rig.px(width));
  trace(g, p);
  g.stroke({ width: w * 3.2, color, alpha: 0.22, cap: 'round', join: 'round' });
  trace(g, p);
  g.stroke({ width: w, color: shade(color, 1.35), alpha: 1, cap: 'round', join: 'round' });
}

/** A lit point: an LED, a cybereye, a focus. */
function glow(g: Graphics, rig: Rig, at: V3, r: number, color: number): void {
  const p = rig.at(at);
  const px = Math.max(0.8, rig.px(r));
  g.circle(p.x, p.y, px * 2.6).fill({ color, alpha: 0.18 });
  g.circle(p.x, p.y, px).fill({ color: shade(color, 1.4) });
}

/** A flat ellipse on the floor, centred `f` forward and `sd` to the side. */
function floorOval(g: Graphics, rig: Rig, f: number, sd: number, long: number, wide: number, color: number, alpha: number): void {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 18; i += 1) {
    const t = (i / 18) * Math.PI * 2;
    pts.push(rig.at([f + Math.cos(t) * long, sd + Math.sin(t) * wide, 0]));
  }
  g.poly(pts).fill({ color, alpha });
}

interface Skeleton {
  hip: V3;
  neck: V3;
  head: V3;
  headR: number;
  /** Legs hip → knee → foot, then arms shoulder → elbow → hand; left (−side) first. */
  legs: [V3[], V3[]];
  arms: [V3[], V3[]];
  /** A long coat's hem, below the hip; its skirt runs from the hip to here. */
  hem: V3;
  /** Where the shadow sits and how far it reaches along the body. */
  shadow: { f: number; long: number; wide: number };
  /** Lying along the floor: boots point back, the back of the torso is up. */
  lying: boolean;
  /** Hands on a weapon, held forward. */
  aiming: boolean;
}

function skeleton(frame: FigureFrame): Skeleton {
  switch (frame.pose) {
    case 'crouch':
      // Down on the right knee, left foot planted, both hands forward on a weapon.
      return {
        hip: [-0.04, 0, 0.3],
        neck: [0.07, 0, 0.6],
        head: [0.1, 0, 0.71],
        headR: 0.105,
        legs: [
          [[-0.04, -0.065, 0.3], [0.17, -0.075, 0.31], [0.15, -0.08, 0.01]],
          [[-0.04, 0.065, 0.3], [0.07, 0.075, 0.03], [-0.2, 0.075, 0.02]],
        ],
        arms: [
          [[0.07, -0.14, 0.56], [0.14, -0.15, 0.43], [0.26, -0.04, 0.48]],
          [[0.07, 0.14, 0.56], [0.12, 0.16, 0.42], [0.2, 0.04, 0.45]],
        ],
        hem: [-0.14, 0, 0.06],
        shadow: { f: 0, long: 0.26, wide: 0.2 },
        lying: false,
        aiming: true,
      };
    case 'prone':
      // Flat on the floor, face down, elbows out, sighting along the way it faces.
      return {
        hip: [-0.18, 0, 0.08],
        neck: [0.2, 0, 0.09],
        head: [0.32, 0, 0.12],
        headR: 0.105,
        legs: [
          [[-0.18, -0.06, 0.07], [-0.42, -0.09, 0.05], [-0.66, -0.11, 0.03]],
          [[-0.18, 0.06, 0.07], [-0.42, 0.09, 0.05], [-0.66, 0.11, 0.03]],
        ],
        arms: [
          [[0.16, -0.14, 0.1], [0.26, -0.21, 0.03], [0.4, -0.05, 0.07]],
          [[0.16, 0.14, 0.1], [0.24, 0.2, 0.03], [0.34, 0.05, 0.07]],
        ],
        hem: [-0.5, 0, 0.06],
        shadow: { f: -0.12, long: 0.6, wide: 0.24 },
        lying: true,
        aiming: true,
      };
    case 'down':
      // On the back, limbs where they fell.
      return {
        hip: [-0.15, 0, 0.06],
        neck: [0.2, 0, 0.07],
        head: [0.33, 0.03, 0.08],
        headR: 0.105,
        legs: [
          [[-0.15, -0.06, 0.06], [-0.38, -0.14, 0.04], [-0.6, -0.2, 0.03]],
          [[-0.15, 0.06, 0.06], [-0.4, 0.1, 0.04], [-0.62, 0.14, 0.03]],
        ],
        arms: [
          [[0.16, -0.14, 0.07], [0.12, -0.32, 0.04], [0.02, -0.45, 0.03]],
          [[0.16, 0.14, 0.07], [0.24, 0.3, 0.04], [0.36, 0.42, 0.03]],
        ],
        hem: [-0.46, 0, 0.05],
        shadow: { f: -0.1, long: 0.6, wide: 0.3 },
        lying: true,
        aiming: false,
      };
    default: {
      // Standing; walking is standing with the stride put in.
      const s = frame.stride;
      const ph = frame.phase;
      const sw = Math.sin(ph) * 0.17 * s; // how far the left foot is ahead
      const liftL = Math.max(0, Math.cos(ph)) * 0.06 * s;
      const liftR = Math.max(0, -Math.cos(ph)) * 0.06 * s;
      const bob = Math.abs(Math.cos(ph)) * 0.015 * s;
      const hipZ = 0.47 + bob;
      const lean = 0.03 * s;
      return {
        hip: [0, 0, hipZ],
        neck: [lean, 0, 0.78 + bob],
        head: [lean * 1.3, 0, 0.885 + bob],
        headR: 0.105,
        legs: [
          [[0, -0.065, hipZ], [sw * 0.5 + 0.03 + liftL, -0.07, 0.25 + liftL], [sw, -0.07, 0.01 + liftL]],
          [[0, 0.065, hipZ], [-sw * 0.5 + 0.03 + liftR, 0.07, 0.25 + liftR], [-sw, 0.07, 0.01 + liftR]],
        ],
        arms: [
          [[lean, -0.15, 0.74 + bob], [-sw * 0.4, -0.18, 0.58 + bob], [-sw * 0.8 + 0.02, -0.18, 0.44 + bob]],
          [[lean, 0.15, 0.74 + bob], [sw * 0.4, 0.18, 0.58 + bob], [sw * 0.8 + 0.02, 0.18, 0.44 + bob]],
        ],
        // A coat's hem swings back when its wearer walks.
        hem: [-0.03 - 0.05 * s, 0, 0.17 + bob],
        shadow: { f: 0, long: 0.2, wide: 0.2 },
        lying: false,
        aiming: false,
      };
    }
  }
}

/** How high the top of the figure is, in human body units — where the badge goes. */
export function poseTop(pose: FigurePose, look: FigureLook | boolean): number {
  const crate = typeof look === 'boolean' ? look : look.crate;
  if (crate) return 0.5;
  const tall = typeof look === 'boolean' ? 1 : look.build.h;
  const crown = typeof look === 'boolean' ? 0 : look.headStyle === 'mohawk' || look.metatype === 'troll' ? 0.1 : 0;
  if (pose === 'crouch') return (0.82 + crown) * tall;
  if (pose === 'prone' || pose === 'down') return 0.3 * tall;
  return (1 + crown) * tall;
}

/**
 * Draw the figure into `g`, feet at (0, 0), `H` px tall standing (a human;
 * a metatype scales from there).
 *
 * Its parts are painted back to front by their own depth, so an arm swung
 * behind the body is behind it, a rifle slung across the back shows over the
 * shoulder, and a hand held out toward the viewer is in front — whichever
 * way the figure faces.
 */
export function drawFigure(g: Graphics, H: number, cell: number, frame: FigureFrame, look: FigureLook, size = 1): void {
  g.clear();
  const axis = cell * Math.hypot(ISO_HALF_W, ISO_HALF_H);
  if (look.crate) {
    drawCrate(g, H, cell, look, size);
    return;
  }
  // One body unit across the floor is drawn about as long as one up the
  // screen, so the figure keeps a person's proportions whichever way it faces.
  const rig = new Rig(H, cell, frame.facing, (0.9 * H) / axis, look.build.w, look.build.h);
  const sk = skeleton(frame);
  const down = frame.pose === 'down';
  const dim = (c: number) => (down ? shade(c, 0.72) : c);
  const lit3 = look.neon;

  floorOval(g, rig, sk.shadow.f, 0, sk.shadow.long, sk.shadow.wide, 0x000000, 0.34);
  if (down && frame.bleeding) floorOval(g, rig, 0.02, 0.05, 0.3, 0.2, 0x5a0d12, 0.75);

  const parts: Array<{ depth: number; draw: () => void }> = [];
  const mean = (pts: readonly V3[]) => pts.reduce((a, p) => a + rig.depth(p), 0) / pts.length;

  // Legs, and boots with a lit welt.
  for (const leg of sk.legs) {
    const foot = leg[leg.length - 1]!;
    const toe: V3 = sk.lying ? [foot[0] - 0.06, foot[1], foot[2]] : [foot[0] + 0.08, foot[1], foot[2]];
    parts.push({
      depth: mean(leg),
      draw: () => {
        rod(g, rig, leg, 0.085, dim(look.legs));
        rod(g, rig, [lerp3(leg[1]!, foot, 0.55), foot, toe], 0.09, dim(look.boots));
      },
    });
  }

  // A long coat's skirt, hip to hem, round the legs.
  const long = look.outfit === 'duster';
  if (long || look.outfit === 'armor') {
    const hem: V3 = long ? sk.hem : lerp3(sk.hip, sk.hem, 0.35);
    parts.push({
      depth: rig.depth(lerp3(sk.hip, hem, 0.5)) + 0.0005,
      draw: () => {
        const top: V3 = sk.lying ? sk.hip : [sk.hip[0], 0, sk.hip[2] + 0.02];
        box(g, rig, hem, top, long ? 0.17 : 0.15, sk.lying ? 0.05 : long ? 0.12 : 0.1, dim(long ? look.coat : shade(look.coat, 0.9)), 0.14, sk.lying ? 0.05 : 0.085);
      },
    });
  }

  // Slung across the back: a rifle or a katana, over the shoulder when seen from the front.
  if (!sk.aiming && !sk.lying && (look.gear === 'rifle' || look.gear === 'katana')) {
    const back = -0.1;
    const a: V3 = [back, -0.14, look.gear === 'katana' ? 1.0 : 0.9];
    const b: V3 = [back, 0.13, 0.42];
    parts.push({
      depth: rig.depth(lerp3(a, b, 0.5)),
      draw: () => {
        if (look.gear === 'katana') {
          rod(g, rig, [lerp3(a, b, 0.22), b], 0.025, dim(look.chrome));
          rod(g, rig, [a, lerp3(a, b, 0.22)], 0.035, dim(0x1a1a1f));
          neon(g, rig, [lerp3(a, b, 0.24), lerp3(a, b, 0.95)], lit3, 0.008);
        } else {
          rod(g, rig, [a, b], 0.045, dim(GUNMETAL));
          rod(g, rig, [lerp3(a, b, 0.55), lerp3(a, b, 0.55 + 0.001)], 0.075, dim(GUNMETAL));
          glow(g, rig, lerp3(a, b, 0.3), 0.012, lit3);
        }
      },
    });
  }

  // The torso: jacket, coat, hoodie, suit or armour, with its seams lit.
  const B: V3 = sk.lying ? sk.hip : [sk.hip[0], sk.hip[1], sk.hip[2] - 0.03];
  const bulk = look.outfit === 'armor' ? 1.12 : look.outfit === 'duster' ? 1.05 : 1;
  parts.push({
    depth: rig.depth([(sk.hip[0] + sk.neck[0]) / 2, 0, (sk.hip[2] + sk.neck[2]) / 2]),
    draw: () => {
      const faces = box(g, rig, B, sk.neck, 0.12 * bulk, 0.075 * bulk, dim(look.coat), 0.14 * bulk, 0.08 * bulk);
      torsoDetail(g, rig, sk, B, faces, look, down, bulk);
    },
  });

  // Arms: sleeves, or chrome; shoulder plates; hands, and what they hold.
  sk.arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    const hand = arm[arm.length - 1]!;
    const chrome = look.cyberarm === side;
    parts.push({
      depth: mean(arm),
      draw: () => {
        if (chrome) {
          rod(g, rig, arm, 0.06, dim(look.chrome));
          // A highlight down the plating and a lit joint: it is not a sleeve.
          const hl = arm.map((p): V3 => [p[0], p[1], p[2] + 0.012]);
          const pts = hl.map((q) => rig.at(q));
          trace(g, pts);
          g.stroke({ width: Math.max(0.6, rig.px(0.015)), color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' });
          glow(g, rig, arm[1]!, 0.014, lit3);
        } else {
          rod(g, rig, arm, 0.065, dim(shade(look.coat, 0.92)));
          const h = rig.at(hand);
          g.circle(h.x, h.y, Math.max(0.9, rig.px(0.034))).fill({ color: dim(look.skin) });
        }
        if (look.pads && !sk.lying) {
          const s = arm[0]!;
          box(g, rig, [s[0], s[1] + side * 0.01, s[2] - 0.06], [s[0], s[1] + side * 0.01, s[2] + 0.035], 0.055, 0.075, dim(shade(look.coat, 1.25)));
        }
        handGear(g, rig, sk, look, side, hand, down);
      },
    });
  });

  // At the hip: a holster, a deck, a rigger's remote.
  if (!sk.lying && (look.gear === 'pistol' || look.gear === 'deck' || look.gear === 'remote')) {
    const side = look.gear === 'pistol' ? 1 : -1;
    const at: V3 = [0.01, side * 0.15, sk.hip[2] - 0.06];
    parts.push({
      depth: rig.depth(at),
      draw: () => {
        if (look.gear === 'pistol') {
          rod(g, rig, [at, [at[0] + 0.02, at[1], at[2] - 0.1]], 0.045, dim(0x15171b));
        } else {
          const t: V3 = [at[0], at[1], at[2] + 0.1];
          const faces = box(g, rig, at, t, 0.02, 0.07, dim(look.gear === 'deck' ? 0x1c1f28 : GUNMETAL));
          if (faces.has('right') || faces.has('left') || faces.has('front')) {
            neon(g, rig, [[at[0] + 0.07, at[1], at[2] + 0.03], [at[0] + 0.07, at[1], at[2] + 0.08]], lit3, 0.01);
          }
        }
      },
    });
  }

  parts.push({ depth: rig.depth(sk.head) + 0.001, draw: () => head(g, rig, sk, look, dim) });

  parts.sort((a, b) => a.depth - b.depth);
  for (const p of parts) p.draw();
}

/** Seams, a belt, a collar: the lit edges that make a dark coat read in a dark room. */
function torsoDetail(g: Graphics, rig: Rig, sk: Skeleton, B: V3, faces: Set<FaceName>, look: FigureLook, down: boolean, bulk: number): void {
  const c = look.neon;
  const up = unit(sub(sk.neck, B));
  // w = up × side is the box's `back`: behind an upright torso, above one
  // lying along the floor. The chest is the other way — except on a body
  // lying on its back, where the chest is what faces up.
  const w = cross(up, [0, 1, 0]);
  const chestUp = sk.lying && down;
  const off = 0.083 * bulk;
  /** A point on the chest, `f` out from the body's axis (negative: the back). */
  const onFace = (p: V3, f = off): V3 => {
    const k = chestUp ? -f : f;
    return [p[0] - w[0] * k, p[1] - w[1] * k, p[2] - w[2] * k];
  };
  const at = (t: number, side = 0): V3 => {
    const p = lerp3(B, sk.neck, t);
    return [p[0], p[1] + side, p[2]];
  };
  // Prone, the back is what shows; on the back, the chest.
  const visible = sk.lying ? chestUp && faces.has('back') : faces.has('front');
  const backShown = sk.lying ? !chestUp && faces.has('back') : faces.has('back');

  // A belt, and its buckle.
  if (look.outfit !== 'armor') {
    const b0 = at(0.12);
    const b1 = at(0.22);
    box(g, rig, b0, b1, 0.125, 0.078, down ? shade(0x121317, 0.72) : 0x121317);
    if (visible && !down) glow(g, rig, onFace(at(0.17)), 0.012, c);
  }

  if (!visible) {
    // Seen from behind: a lit stripe across the shoulders on some kit.
    if ((look.outfit === 'jacket' || look.outfit === 'armor') && backShown) {
      neon(g, rig, [onFace(at(0.82, -0.1), -off), onFace(at(0.82, 0.1), -off)], c, 0.012);
    }
    return;
  }
  switch (look.outfit) {
    case 'duster':
    case 'suit':
      // Lapels down to the belt, a shirt between them.
      rod(g, rig, [onFace(at(0.95, -0.03)), onFace(at(0.45, 0)), onFace(at(0.95, 0.03))], 0.03, shade(look.under, down ? 0.72 : 1));
      neon(g, rig, [onFace(at(1, -0.07)), onFace(at(0.35, -0.02))], c, 0.01);
      neon(g, rig, [onFace(at(1, 0.07)), onFace(at(0.35, 0.02))], c, 0.01);
      break;
    case 'hoodie':
      // The zip, and the drawstrings.
      neon(g, rig, [onFace(at(0.2)), onFace(at(0.98))], c, 0.012);
      rod(g, rig, [onFace(at(0.95, -0.035)), onFace(at(0.7, -0.035))], 0.012, 0xd8d8d8);
      rod(g, rig, [onFace(at(0.95, 0.035)), onFace(at(0.7, 0.035))], 0.012, 0xd8d8d8);
      break;
    case 'armor':
      // A chest plate with a lit band, and the unit's stencil light.
      box(g, rig, onFace(at(0.5), off - 0.01), onFace(at(0.92), off - 0.01), 0.11, 0.02, shade(look.coat, down ? 0.9 : 1.25));
      neon(g, rig, [onFace(at(0.72, -0.1), off + 0.015), onFace(at(0.72, 0.1), off + 0.015)], c, 0.014);
      break;
    case 'vest':
      // Bare arms under a vest: the vest's edge, lit.
      neon(g, rig, [onFace(at(0.25, -0.05)), onFace(at(0.98, -0.07))], c, 0.01);
      neon(g, rig, [onFace(at(0.25, 0.05)), onFace(at(0.98, 0.07))], c, 0.01);
      break;
    default:
      // A jacket: an off-centre zip and a lit collar.
      neon(g, rig, [onFace(at(0.25, 0.03)), onFace(at(0.96, -0.02))], c, 0.012);
      neon(g, rig, [onFace(at(1, -0.1)), onFace(at(1.02, 0)), onFace(at(1, 0.1))], c, 0.01);
  }
}

/** What a hand holds: a weapon held forward when aiming, a mage's focus, a rigger's glow. */
function handGear(g: Graphics, rig: Rig, sk: Skeleton, look: FigureLook, side: number, hand: V3, down: boolean): void {
  if (down) return;
  if (sk.aiming && side === 1 && (look.gear === 'rifle' || look.gear === 'pistol' || look.gear === 'katana' || look.gear === 'remote')) {
    if (look.gear === 'katana') {
      rod(g, rig, [hand, [hand[0] + 0.38, hand[1] - 0.04, hand[2] + (sk.lying ? 0 : 0.18)]], 0.022, look.chrome);
      return;
    }
    const len = look.gear === 'rifle' ? 0.36 : 0.16;
    const tip: V3 = [hand[0] + len, hand[1] - 0.02, hand[2] + 0.01];
    rod(g, rig, [[hand[0] - (look.gear === 'rifle' ? 0.12 : 0.02), hand[1], hand[2] - 0.01], tip], look.gear === 'rifle' ? 0.045 : 0.04, GUNMETAL);
    glow(g, rig, lerp3(hand, tip, 0.5), 0.01, look.neon);
    return;
  }
  if (look.gear === 'focus' && side === -1) {
    // A mage's hand: power held in it.
    glow(g, rig, [hand[0] + 0.02, hand[1], hand[2] + 0.03], 0.03, 0xb46cff);
  }
}

/**
 * A head: hair, a hood or a helmet round it, the face on the side it looks
 * toward, and the eyes — mirrorshades, a visor, a cybereye. Turned away from
 * the viewer it is all hair or hood, which is how a figure's back reads at
 * the size a figure is drawn.
 */
function head(g: Graphics, rig: Rig, sk: Skeleton, look: FigureLook, dim: (c: number) => number): void {
  const hc = sk.head;
  const R = sk.headR;
  const c = rig.at(hc);
  const r = Math.max(2, rig.px(R));
  const toward = rig.toward();
  const seesFace = toward > -0.4 || sk.lying;
  const facePt = (f: number, s: number, z: number): V3 => [hc[0] + f * R, hc[1] + s * R, hc[2] + z * R];
  const ahead = rig.at(facePt(1, 0, 0));
  let fx = ahead.x - c.x;
  let fy = ahead.y - c.y;
  const fl = Math.hypot(fx, fy) || 1;
  fx /= fl;
  fy /= fl;

  // Long hair falls behind, over the shoulders.
  if (look.headStyle === 'long' || look.headStyle === 'topknot') {
    rod(g, rig, [facePt(-0.4, 0, 0.3), facePt(-0.9, 0, -1.6)], 0.11, dim(look.hair));
  }
  // Behind the face: hair, hood or helmet.
  const back = look.headStyle === 'hood' ? look.coat : look.headStyle === 'helmet' ? look.coat : look.headStyle === 'shaved' ? shade(look.skin, 0.8) : look.hair;
  const backR = look.headStyle === 'hood' ? r * 1.28 : look.headStyle === 'helmet' ? r * 1.1 : r;
  g.circle(c.x - fx * r * 0.14, c.y - fy * r * 0.14 - r * 0.08, backR)
    .fill({ color: dim(lit(back, [0, 0, 0.6])) })
    .stroke({ width: 1, color: OUTLINE, alpha: 0.5 });
  if (look.metatype === 'elf' && look.headStyle !== 'hood' && look.headStyle !== 'helmet') {
    for (const s of [-1, 1]) rod(g, rig, [facePt(-0.1, s * 0.9, 0.1), facePt(-0.35, s * 1.45, 0.75)], 0.028, dim(look.skin));
  }
  if (seesFace) {
    const k = sk.lying ? 0.8 : Math.min(1, 0.55 + toward * 0.4);
    if (look.headStyle === 'helmet') {
      // No face: the helmet's visor, lit.
      neon(g, rig, [facePt(0.75, -0.7, 0.05), facePt(0.95, 0, 0.1), facePt(0.75, 0.7, 0.05)], look.neon, 0.03);
    } else {
      g.circle(c.x + fx * r * 0.2, c.y + fy * r * 0.2 + r * 0.14, r * 0.76 * k).fill({ color: dim(look.skin) });
      if (look.metatype === 'dwarf') {
        rod(g, rig, [facePt(0.75, 0, -0.35), facePt(0.8, 0, -1.05)], 0.07, dim(look.hair));
      }
      if (look.metatype === 'ork' || look.metatype === 'troll') {
        for (const s of [-1, 1]) rod(g, rig, [facePt(0.85, s * 0.3, -0.45), facePt(0.92, s * 0.34, -0.15)], 0.018, BONE);
      }
      eyes(g, rig, facePt, look);
    }
  }
  // On top: a mohawk's fin, a troll's horns.
  if (look.headStyle === 'mohawk') {
    for (let i = 0; i < 5; i += 1) {
      const t = 0.35 + (i / 4) * 1.9; // front of the crown round to the back
      const base = facePt(Math.cos(t) * 0.9, 0, Math.sin(t) * 0.9);
      const tip = facePt(Math.cos(t) * 1.55, 0, Math.sin(t) * 1.6 + 0.05);
      rod(g, rig, [base, tip], 0.035, dim(look.hair));
    }
    neon(g, rig, [facePt(0.6, 0, 1.3), facePt(0, 0, 1.62), facePt(-0.7, 0, 1.3)], look.hair, 0.01);
  }
  if (look.metatype === 'troll') {
    for (const s of [-1, 1]) {
      rod(g, rig, [facePt(0.1, s * 0.75, 0.55), facePt(-0.2, s * 1.0, 1.3), facePt(-0.65, s * 0.9, 1.55)], 0.04, dim(BONE));
    }
  }
}

function eyes(g: Graphics, rig: Rig, facePt: (f: number, s: number, z: number) => V3, look: FigureLook): void {
  switch (look.eyes) {
    case 'shades': {
      // Mirrorshades: a black bar and the city in them.
      const a = rig.at(facePt(0.95, -0.55, 0.12));
      const b = rig.at(facePt(0.95, 0.55, 0.12));
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: Math.max(1.4, rig.px(0.035)), color: 0x050608, cap: 'round' });
      const m = rig.at(facePt(0.98, 0.25, 0.16));
      g.circle(m.x, m.y, Math.max(0.5, rig.px(0.01))).fill({ color: 0xffffff, alpha: 0.85 });
      break;
    }
    case 'visor':
      neon(g, rig, [facePt(0.9, -0.62, 0.12), facePt(0.97, 0, 0.14), facePt(0.9, 0.62, 0.12)], look.neon, 0.022);
      break;
    case 'goggles':
      for (const s of [-1, 1]) glow(g, rig, facePt(0.95, s * 0.35, 0.14), 0.02, 0x9fe8ff);
      break;
    case 'cybereye':
      glow(g, rig, facePt(0.95, 0.35, 0.12), 0.016, look.neon);
      break;
    default:
      break;
  }
}

/** A prop: a dark steel crate with a lit strip, a square across per square of token. */
function drawCrate(g: Graphics, H: number, cell: number, look: FigureLook, size: number): void {
  const rig = new Rig(H, cell, 0, 1);
  const half = 0.42 * size;
  floorOval(g, rig, 0.04, 0.04, half * 1.25, half * 1.25, 0x000000, 0.3);
  box(g, rig, [0, 0, 0], [0, 0, 0.5], half, half, look.coat);
  rod(g, rig, [[-half, -half * 0.3, 0.5], [half, -half * 0.3, 0.5]], 0.02, shade(look.coat, 0.7));
  rod(g, rig, [[-half, half * 0.3, 0.5], [half, half * 0.3, 0.5]], 0.02, shade(look.coat, 0.7));
  neon(g, rig, [[half + 0.002, -half * 0.8, 0.36], [half + 0.002, half * 0.8, 0.36]], look.neon, 0.012);
}

// ---------------------------------------------------------------- looks

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A second, independent number from the same token, for each choice made. */
const roll = (h: number, salt: number): number => hash(`${h}:${salt}`);
const pick = <T,>(list: readonly T[], h: number, salt: number): T => list[roll(h, salt) % list.length]!;

/** The side's neon: runners cyan, opposition red, everyone else amber. */
const NEON: Record<Token['source'], number> = {
  character: 0x22d8f0,
  combatant: 0xff2d5a,
  npc_template: 0xffb020,
  prop: 0xffb020,
};
const HAIR_NEON = [0x39ff6a, 0xff2bd6, 0x2bf0ff, 0xffe62b, 0xa05bff, 0xff5a2b];
const HAIR = [0x121317, 0x2e1d12, 0x5a3a1f, 0xa8823e, 0xcfc8bb, 0x8a1f2a];
const SKIN: Record<Metatype, readonly number[]> = {
  human: [0xf0c7a4, 0xd9a47c, 0xb57b52, 0x8a5a3a, 0x5c3a24],
  elf: [0xf3d9c4, 0xe5bf9c, 0xc58f66, 0x7a5236],
  dwarf: [0xecc2a0, 0xcf9a74, 0xa56e4a],
  ork: [0xa9b28a, 0x8f9a70, 0xb89c7a, 0x6f7a55, 0x9a7b5c],
  troll: [0x9aa0a8, 0x8a8f86, 0xa28c78, 0x7d8a8f],
};
const COATS = [0x16181d, 0x2a211c, 0x20252b, 0x28233a, 0x1c2622, 0x341c20, 0x2b2b2f];
const UNDER = [0x7d8794, 0x9a3b4f, 0x3b6f84, 0xc9c4b8];
const LEGS = [0x14161b, 0x1f2229, 0x262a31, 0x221f1a];
const CHROME = [0x9aa7b2, 0xb8a27a, 0x6f7c88];

const BUILDS: Record<Metatype, { w: number; h: number }> = {
  human: { w: 1, h: 1 },
  elf: { w: 0.9, h: 1.06 },
  dwarf: { w: 1.18, h: 0.74 },
  ork: { w: 1.18, h: 1.05 },
  troll: { w: 1.42, h: 1.22 },
};

interface Kit {
  outfit: readonly Outfit[];
  head: readonly HeadStyle[];
  eyes: readonly Eyes[];
  gear: readonly Gear[];
  /** Chance in 4 of a chrome arm. */
  chrome: number;
  pads: boolean;
}

/** What each archetype tends to wear and carry — picked from per token. */
const KITS: Record<Archetype, Kit> = {
  samurai: { outfit: ['jacket', 'armor', 'duster'], head: ['mohawk', 'crop', 'topknot', 'shaved'], eyes: ['shades', 'cybereye', 'visor'], gear: ['rifle', 'katana', 'pistol'], chrome: 3, pads: true },
  decker: { outfit: ['hoodie', 'jacket'], head: ['hood', 'crop', 'mohawk', 'long'], eyes: ['visor', 'goggles', 'cybereye'], gear: ['deck'], chrome: 1, pads: false },
  mage: { outfit: ['duster'], head: ['long', 'topknot', 'shaved', 'hood'], eyes: ['none', 'shades'], gear: ['focus'], chrome: 0, pads: false },
  rigger: { outfit: ['jacket', 'vest'], head: ['crop', 'shaved', 'long'], eyes: ['goggles', 'visor'], gear: ['remote'], chrome: 1, pads: false },
  face: { outfit: ['suit', 'duster'], head: ['crop', 'long', 'topknot'], eyes: ['shades', 'none'], gear: ['pistol', 'none'], chrome: 0, pads: false },
  adept: { outfit: ['vest', 'jacket'], head: ['topknot', 'shaved', 'crop'], eyes: ['none'], gear: ['katana', 'none'], chrome: 0, pads: false },
  ganger: { outfit: ['vest', 'jacket'], head: ['mohawk', 'shaved', 'long'], eyes: ['shades', 'cybereye', 'none'], gear: ['pistol', 'katana'], chrome: 2, pads: true },
  security: { outfit: ['armor'], head: ['helmet', 'helmet', 'crop'], eyes: ['visor'], gear: ['rifle', 'pistol'], chrome: 0, pads: true },
  civilian: { outfit: ['suit', 'jacket', 'hoodie'], head: ['crop', 'long', 'shaved'], eyes: ['none', 'shades'], gear: ['none'], chrome: 0, pads: false },
};

/** Words in a token's name that say what it is. */
const ARCHETYPE_WORDS: Array<[RegExp, Archetype]> = [
  [/samurai|merc|muscle|soldier|gunner|bodyguard|razor/, 'samurai'],
  [/decker|hacker|netrunner|technomancer/, 'decker'],
  [/mage|shaman|wizard|sorcer|witch|magician|conjurer|spellcaster/, 'mage'],
  [/rigger|driver|pilot|wheelman/, 'rigger'],
  [/face|fixer|johnson|exec|negotiator|broker/, 'face'],
  [/adept|monk|martial/, 'adept'],
  [/ganger|gang|thug|punk|halloweener|ancient|cutter|goon/, 'ganger'],
  [/guard|security|lone star|knight errant|cop|officer|trooper|agent|swat|patrol/, 'security'],
  [/doc|clerk|bartender|civilian|wage|tech|scientist|citizen|bystander/, 'civilian'],
];
const METATYPE_WORDS: Array<[RegExp, Metatype]> = [
  [/troll|minotaur|giant|fomori|cyclops/, 'troll'],
  [/\bork\b|\borc\b|hobgoblin|ogre|oni|satyr/, 'ork'],
  [/dwarf|gnome|koborokuru|menehune/, 'dwarf'],
  [/\belf\b|elven|dryad|night one|wakyambi|nocturna/, 'elf'],
  [/human/, 'human'],
];

/** Who turns up, by source, when the name says nothing. */
const DEFAULT_ARCHETYPES: Record<Token['source'], readonly Archetype[]> = {
  character: ['samurai', 'decker', 'mage', 'rigger', 'face', 'adept'],
  combatant: ['security', 'ganger', 'security', 'samurai', 'ganger'],
  npc_template: ['civilian', 'face', 'ganger', 'security', 'decker', 'civilian'],
  prop: ['civilian'],
};
/** The Sixth World's mix, near enough: most human, then ork, elf, troll, dwarf. */
const METATYPE_MIX: readonly Metatype[] = [
  'human', 'human', 'human', 'human', 'human', 'human', 'human', 'human',
  'ork', 'ork', 'ork', 'elf', 'elf', 'troll', 'troll', 'dwarf',
];

/**
 * A figure's archetype, metatype, kit and colours — fixed per token, so a
 * runner looks the same every session, and read from its name first.
 */
export function lookFor(token: Pick<Token, 'id' | 'source'> & { name?: string; look?: TokenLook | null }): FigureLook {
  const h = hash(token.id);
  const name = (token.name ?? '').toLowerCase();
  const set = token.look ?? {};
  // What the token's own look says wins; then its name; then the dice.
  const archetype =
    set.archetype ?? ARCHETYPE_WORDS.find(([re]) => re.test(name))?.[1] ?? pick(DEFAULT_ARCHETYPES[token.source] ?? DEFAULT_ARCHETYPES.npc_template, h, 1);
  const metatype = set.metatype ?? METATYPE_WORDS.find(([re]) => re.test(name))?.[1] ?? pick(METATYPE_MIX, h, 2);
  const kit = KITS[archetype];
  const headStyle = set.headStyle ?? pick(kit.head, h, 4);
  const cyberarm: -1 | 0 | 1 =
    set.cyberarm !== undefined
      ? set.cyberarm === 'left' ? -1 : set.cyberarm === 'right' ? 1 : 0
      : roll(h, 9) % 4 < kit.chrome ? (roll(h, 10) % 2 === 0 ? 1 : -1) : 0;
  const security = archetype === 'security';
  const base: FigureLook = {
    archetype,
    metatype,
    build: BUILDS[metatype],
    outfit: pick(kit.outfit, h, 3),
    headStyle,
    eyes: pick(kit.eyes, h, 5),
    gear: pick(kit.gear, h, 6),
    cyberarm,
    pads: kit.pads,
    skin: pick(SKIN[metatype], h, 7),
    // A mohawk is dyed; anything else mostly is not.
    hair: headStyle === 'mohawk' || roll(h, 8) % 5 === 0 ? pick(HAIR_NEON, h, 11) : pick(HAIR, h, 12),
    coat: security ? pick([0x1f2733, 0x2a2f36, 0x33291f], h, 13) : pick(COATS, h, 13),
    under: pick(UNDER, h, 14),
    legs: pick(LEGS, h, 15),
    boots: 0x0e0f12,
    neon: NEON[token.source] ?? NEON.npc_template,
    chrome: pick(CHROME, h, 16),
    crate: token.source === 'prop',
  };
  const colour = (hex: string | undefined, fallback: number) => (hex ? parseInt(hex.slice(1), 16) : fallback);
  const c = set.colors ?? {};
  return {
    ...base,
    ...(set.outfit ? { outfit: set.outfit } : {}),
    ...(set.eyes ? { eyes: set.eyes } : {}),
    ...(set.gear ? { gear: set.gear } : {}),
    ...(set.pads !== undefined ? { pads: set.pads } : {}),
    skin: colour(c.skin, base.skin),
    hair: colour(c.hair, base.hair),
    coat: colour(c.coat, base.coat),
    under: colour(c.under, base.under),
    legs: colour(c.legs, base.legs),
    boots: colour(c.boots, base.boots),
    neon: colour(c.neon, base.neon),
    chrome: colour(c.chrome, base.chrome),
  };
}
