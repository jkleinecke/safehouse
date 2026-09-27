/**
 * The 3D map's figures: the same Sixth World people the isometric map draws
 * (`grid/stage/figure.ts`), built as real geometry instead of painted.
 *
 * Nothing about who a token is gets decided here. Its archetype, metatype,
 * kit and colours come from `lookFor(token)`, and where its joints are from
 * `skeleton(frame)` — the very bones the 2D figure is drawn over — so a
 * runner in 3D is the runner in 2D: the same mohawk, the same chrome arm,
 * the same neon at the seams.
 *
 * What changes is the drawing. The 2D figure fakes depth — it sorts its parts
 * back to front, shades each face by a fixed key light, inks an outline — and
 * 3D has a depth buffer, real lights and real shadows for all of that. So
 * limbs are square beams through the joints, the torso an oriented frustum,
 * the head a low-poly sphere with the hair a larger one pulled back over it,
 * and every lit seam, visor and LED goes to the glow mesh, where the bloom
 * pass finds it. There is no painted shadow under the feet: the lamps cast one.
 *
 * Proportions are true: a human is 1.8 m tall, and a metatype's build scales
 * that up and across exactly as it does on the map. (The map draws its
 * figures larger than life so they read at a square's size; a camera that can
 * come close does not need to.)
 *
 * Each figure is its own handful of small meshes, not merged into the world:
 * figures move, and the world is built once.
 */
import { Group, type Mesh, type Object3D } from 'three';
import type { Token } from '@safehouse/contracts';
import { shade } from '../grid/stage/colors.js';
import { lookFor, skeleton, type FigureLook, type FigurePose, type Skeleton } from '../grid/stage/figure.js';
import { MeshBuilder, type LabMaterials, type V3 } from './geometry3d.js';

export interface FigureCtx {
  /** Metres per square. */
  unitM: number;
  /** Squares per storey: floor `L` stands at y = L × storey. */
  storey: number;
  /**
   * Draw this pose instead of the token's own — the condition monitor's
   * `down`, which a token never stores. Absent: the token's pose.
   */
  pose?: FigurePose;
}

/** How tall a standing human is, in metres. */
const HUMAN_M = 1.8;

const BONE = 0xd9cfb4;
const GUNMETAL = 0x2a2e35;
const BELT = 0x121317;
const LENS = 0x050608;
const PUPIL = 0x1a1410;
const FOCUS = 0xb46cff;
const GOGGLES = 0x9fe8ff;

// ------------------------------------------------------------ vector bits

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function unit(a: V3): V3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

// ------------------------------------------------------------ the rig

/**
 * Body space to the figure's own world space, and the few shapes a figure is
 * made of. A body point is `[forward, side, up]` with a human 1 tall (as in
 * `figure.ts`); the figure's world space has its feet at the origin, facing
 * +x, its right hand toward +z, in squares. `across` scales forward and side,
 * `up` scales up — a troll is broader than it is tall, against a human.
 */
class Body {
  constructor(
    private readonly b: MeshBuilder,
    private readonly across: number,
    private readonly up: number,
    /** Down: everything solid is drawn dimmer, as the map does. */
    private readonly down: boolean,
  ) {}

  /** A body point in the figure's world space. */
  at(p: V3): V3 {
    return [p[0] * this.across, p[2] * this.up, p[1] * this.across];
  }

  /** A thickness in body units, in world units: by the metatype's bulk. */
  len(bodyUnits: number): number {
    return bodyUnits * this.across;
  }

  paint(color: number): number {
    return this.down ? shade(color, 0.72) : color;
  }

  /** A limb or a length of kit: a beam through body points; `joints` rounds the bends. */
  rod(pts: readonly V3[], half: number, color: number, joints = false): void {
    this.wrod(
      pts.map((p) => this.at(p)),
      this.len(half),
      color,
      joints,
    );
  }

  /** A beam through world points. */
  wrod(pts: readonly V3[], r: number, color: number, joints = false): void {
    const c = this.paint(color);
    this.b.beam(pts, r, c);
    if (!joints) return;
    // A square beam bent at a joint leaves a notch on the outside of the bend.
    for (let i = 1; i + 1 < pts.length; i += 1) {
      const j = pts[i]!;
      this.b.sphere(j[0], j[1], j[2], r * 1.15, c, 'solid', 6);
    }
  }

  /** A lit line through body points; `width` is the 2D figure's neon width. */
  neon(pts: readonly V3[], width: number, color: number): void {
    this.wneon(
      pts.map((p) => this.at(p)),
      this.len(Math.max(0.005, width * 0.6)),
      color,
    );
  }

  /** A lit line through world points. */
  wneon(pts: readonly V3[], r: number, color: number): void {
    this.b.beam(pts, r, color, 'glow');
  }

  /** A lit point at a body point: an LED, a cybereye, a focus. */
  glow(at: V3, r: number, color: number): void {
    this.wglow(this.at(at), this.len(r), color);
  }

  wglow(at: V3, r: number, color: number): void {
    this.b.sphere(at[0], at[1], at[2], r, color, 'glow', 6);
  }

  /** A solid ball at a body point: a hand. */
  ball(at: V3, r: number, color: number, segments = 6): void {
    this.wball(this.at(at), this.len(r), color, segments);
  }

  wball(at: V3, r: number, color: number, segments = 8): void {
    this.b.sphere(at[0], at[1], at[2], r, this.paint(color), 'solid', segments);
  }

  /**
   * A box from `B` to `T` (its long axis, body points), `wS` either side and
   * `wD` before and behind — or a frustum, when the `T` end has its own
   * widths. The side axis is the body's own, as on the map: the poses only
   * ever tilt a box in the plane it faces along. An upright box's depth runs
   * forward and back; one lying along the body, up and down.
   */
  box(B: V3, T: V3, wS: number, wD: number, color: number, tS = wS, tD = wD): void {
    const a = unit(sub(T, B));
    const side: V3 = Math.abs(a[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const w = unit(cross(a, side));
    const u = unit(cross(w, a));
    const P = (i: number, j: number, k: number): V3 => {
      const o = k ? T : B;
      const s = k ? tS : wS;
      const d = k ? tD : wD;
      return this.at([o[0] + u[0] * i * s + w[0] * j * d, o[1] + u[1] * i * s + w[1] * j * d, o[2] + u[2] * i * s + w[2] * j * d]);
    };
    const c = this.paint(color);
    const faces: V3[][] = [
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      [P(-1, -1, 0), P(-1, 1, 0), P(1, 1, 0), P(1, -1, 0)],
      [P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)],
      [P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, 0)],
      [P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1), P(1, 1, 0)],
      [P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)],
    ];
    for (const f of faces) this.b.polygon(f, c);
  }
}

// ------------------------------------------------------------ the person

function buildPerson(b: MeshBuilder, look: FigureLook, pose: FigurePose, base: number): void {
  const down = pose === 'down';
  const body = new Body(b, base * look.build.w, base * look.build.h, down);
  const sk = skeleton({ pose, facing: 0, phase: 0, stride: 0, bleeding: false });
  const gear = look.gear;
  const bulk = look.outfit === 'armor' ? 1.12 : look.outfit === 'duster' ? 1.05 : 1;

  // Legs, and boots: a shaft up the shin and a foot flat on the floor.
  for (const leg of sk.legs) {
    const knee = leg[1]!;
    const foot = leg[leg.length - 1]!;
    body.rod(leg, 0.0425, look.legs, true);
    body.rod([lerp3(knee, foot, 0.55), foot], 0.046, look.boots);
    // Lying, the boots point back; kneeling, the kneeling leg's foot does too.
    const back = sk.lying || knee[2] < 0.1 ? -1 : 1;
    const sole = Math.max(foot[2], 0.035);
    body.box([foot[0] - back * 0.03, foot[1], sole], [foot[0] + back * 0.1, foot[1], sole], 0.045, 0.035, look.boots);
  }

  // A long coat's skirt, hip to hem, round the legs; armour's short tassets.
  const long = look.outfit === 'duster';
  if (long || look.outfit === 'armor') {
    const hem: V3 = long ? sk.hem : lerp3(sk.hip, sk.hem, 0.35);
    const top: V3 = sk.lying ? sk.hip : [sk.hip[0], 0, sk.hip[2] + 0.02];
    body.box(hem, top, long ? 0.17 : 0.15, sk.lying ? 0.05 : long ? 0.12 : 0.1, long ? look.coat : shade(look.coat, 0.9), 0.14, sk.lying ? 0.05 : 0.085);
  }

  // Slung across the back: a rifle or a katana, over the shoulder.
  if (!sk.aiming && !sk.lying && (gear === 'rifle' || gear === 'katana')) {
    const back = -(0.08 * bulk + 0.03);
    const a: V3 = [back, -0.14, gear === 'katana' ? 1.0 : 0.9];
    const z: V3 = [back, 0.13, 0.42];
    const out = (p: V3, k: number): V3 => [p[0] - k, p[1], p[2]];
    if (gear === 'katana') {
      body.rod([lerp3(a, z, 0.22), z], 0.0125, look.chrome);
      body.rod([a, lerp3(a, z, 0.22)], 0.0175, 0x1a1a1f);
      body.neon([out(lerp3(a, z, 0.24), 0.01), out(lerp3(a, z, 0.95), 0.01)], 0.008, look.neon);
    } else {
      body.rod([a, z], 0.0225, GUNMETAL);
      body.rod([lerp3(a, z, 0.5), lerp3(a, z, 0.6)], 0.036, GUNMETAL);
      body.glow(out(lerp3(a, z, 0.3), 0.024), 0.012, look.neon);
    }
  }

  // The torso: jacket, coat, hoodie, suit or armour, with its seams lit.
  const B: V3 = sk.lying ? sk.hip : [sk.hip[0], sk.hip[1], sk.hip[2] - 0.03];
  body.box(B, sk.neck, 0.12 * bulk, 0.075 * bulk, look.coat, 0.14 * bulk, 0.08 * bulk);
  torsoDetail(body, sk, B, look, down, bulk);

  // Arms: sleeves (bare under a vest), or chrome; shoulder plates; hands, and what they hold.
  sk.arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    const hand = arm[arm.length - 1]!;
    if (look.cyberarm === side) {
      body.rod(arm, 0.03, look.chrome, true);
      body.ball(hand, 0.032, look.chrome);
      body.glow(arm[1]!, 0.014, look.neon);
    } else {
      body.rod(arm, 0.0325, look.outfit === 'vest' ? look.skin : shade(look.coat, 0.92), true);
      body.ball(hand, 0.034, look.skin);
    }
    if (look.pads && !sk.lying) {
      const s = arm[0]!;
      body.box([s[0], s[1] + side * 0.01, s[2] - 0.06], [s[0], s[1] + side * 0.01, s[2] + 0.035], 0.055, 0.075, shade(look.coat, 1.25));
    }
    if (!down) handGear(body, sk, look, side, hand);
  });

  // At the hip: a holster, a deck, a rigger's remote.
  if (!sk.lying && (gear === 'pistol' || gear === 'deck' || gear === 'remote')) {
    const side = gear === 'pistol' ? 1 : -1;
    const at: V3 = [0.01, side * (0.12 * bulk + 0.03), sk.hip[2] - 0.06];
    if (gear === 'pistol') {
      body.rod([at, [at[0] + 0.02, at[1], at[2] - 0.1]], 0.0225, 0x15171b);
    } else {
      body.box(at, [at[0], at[1], at[2] + 0.1], 0.02, 0.07, gear === 'deck' ? 0x1c1f28 : GUNMETAL);
      body.neon([[at[0] + 0.07, at[1], at[2] + 0.03], [at[0] + 0.07, at[1], at[2] + 0.08]], 0.01, look.neon);
    }
  }

  head(body, sk, look, down, base);
}

/** Seams, a belt, a collar: the lit edges that make a dark coat read in a dark room. */
function torsoDetail(body: Body, sk: Skeleton, B: V3, look: FigureLook, down: boolean, bulk: number): void {
  const c = look.neon;
  const up = unit(sub(sk.neck, B));
  // w = up × side points behind an upright torso and above one lying along
  // the floor; the chest is the other way — except on a body lying on its
  // back, where the chest is what faces up.
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

  // A belt, and its buckle.
  if (look.outfit !== 'armor') {
    body.box(at(0.12), at(0.22), 0.125 * bulk + 0.006, 0.078 * bulk + 0.006, BELT);
    if (!down) body.glow(onFace(at(0.17), 0.084 * bulk + 0.008), 0.012, c);
  }
  // A lit stripe across the shoulders, behind, on some kit.
  if (look.outfit === 'jacket' || look.outfit === 'armor') {
    body.neon([onFace(at(0.82, -0.1), -off), onFace(at(0.82, 0.1), -off)], 0.012, c);
  }
  switch (look.outfit) {
    case 'duster':
    case 'suit':
      // Lapels down to the belt, a shirt between them.
      body.rod([onFace(at(0.95, -0.03)), onFace(at(0.45, 0)), onFace(at(0.95, 0.03))], 0.015, look.under);
      body.neon([onFace(at(1, -0.07)), onFace(at(0.35, -0.02))], 0.01, c);
      body.neon([onFace(at(1, 0.07)), onFace(at(0.35, 0.02))], 0.01, c);
      break;
    case 'hoodie':
      // The zip, and the drawstrings.
      body.neon([onFace(at(0.2)), onFace(at(0.98))], 0.012, c);
      body.rod([onFace(at(0.95, -0.035)), onFace(at(0.7, -0.035))], 0.006, 0xd8d8d8);
      body.rod([onFace(at(0.95, 0.035)), onFace(at(0.7, 0.035))], 0.006, 0xd8d8d8);
      break;
    case 'armor':
      // A chest plate with a lit band.
      body.box(onFace(at(0.5), off - 0.01), onFace(at(0.92), off - 0.01), 0.11, 0.02, shade(look.coat, 1.25));
      body.neon([onFace(at(0.72, -0.1), off + 0.015), onFace(at(0.72, 0.1), off + 0.015)], 0.014, c);
      break;
    case 'vest':
      // The vest's edges, lit.
      body.neon([onFace(at(0.25, -0.05)), onFace(at(0.98, -0.07))], 0.01, c);
      body.neon([onFace(at(0.25, 0.05)), onFace(at(0.98, 0.07))], 0.01, c);
      break;
    default:
      // A jacket: an off-centre zip and a lit collar.
      body.neon([onFace(at(0.25, 0.03)), onFace(at(0.96, -0.02))], 0.012, c);
      body.neon([onFace(at(1, -0.1)), onFace(at(1.02, 0)), onFace(at(1, 0.1))], 0.01, c);
  }
}

/** What a hand holds: a weapon held forward when aiming, a mage's focus. */
function handGear(body: Body, sk: Skeleton, look: FigureLook, side: number, hand: V3): void {
  const g = look.gear;
  if (sk.aiming && side === 1 && (g === 'rifle' || g === 'pistol' || g === 'katana' || g === 'remote')) {
    if (g === 'katana') {
      body.rod([hand, [hand[0] + 0.38, hand[1] - 0.04, hand[2] + (sk.lying ? 0 : 0.18)]], 0.011, look.chrome);
      return;
    }
    const len = g === 'rifle' ? 0.36 : 0.16;
    const tip: V3 = [hand[0] + len, hand[1] - 0.02, hand[2] + 0.01];
    const butt: V3 = [hand[0] - (g === 'rifle' ? 0.12 : 0.02), hand[1], hand[2] - 0.01];
    const r = g === 'rifle' ? 0.0225 : 0.02;
    body.rod([butt, tip], r, GUNMETAL);
    const mid = lerp3(hand, tip, 0.5);
    body.glow([mid[0], mid[1], mid[2] + r + 0.004], 0.01, look.neon);
    return;
  }
  if (g === 'focus' && side === -1) {
    // A mage's hand: power held in it.
    body.glow([hand[0] + 0.02, hand[1], hand[2] + 0.03], 0.03, FOCUS);
  }
}

/** Which way a head's face, right ear and crown point, in the figure's world space. */
interface HeadFrame {
  fwd: V3;
  side: V3;
  up: V3;
}
const UPRIGHT: HeadFrame = { fwd: [1, 0, 0], side: [0, 0, 1], up: [0, 1, 0] };
/** On its back: the face to the ceiling, the crown along the body. */
const SUPINE: HeadFrame = { fwd: [0, 1, 0], side: [0, 0, 1], up: [1, 0, 0] };

/**
 * A head: a skin sphere seated on the neck, hair pulled over it from behind
 * (or a hood, or a helmet), the eyes — mirrorshades, a visor, a cybereye —
 * and the metatype's ears, tusks, horns or beard.
 */
function head(body: Body, sk: Skeleton, look: FigureLook, down: boolean, base: number): void {
  // One radius for a sphere: between the build's breadth and its height.
  const R = sk.headR * base * Math.sqrt(look.build.w * look.build.h);
  const neck = body.at(sk.neck);
  const toHead = unit(sub(body.at(sk.head), neck));
  const hc0 = add(neck, scale(toHead, R));
  // Lying, the head rests on the floor rather than in it.
  const hc: V3 = sk.lying ? [hc0[0], Math.max(hc0[1], R * 0.92), hc0[2]] : hc0;
  const fr = down ? SUPINE : UPRIGHT;
  /** A point on or about the head, in head radii: forward, to the right, up. */
  const fp = (f: number, s: number, z: number): V3 => [
    hc[0] + (fr.fwd[0] * f + fr.side[0] * s + fr.up[0] * z) * R,
    hc[1] + (fr.fwd[1] * f + fr.side[1] * s + fr.up[1] * z) * R,
    hc[2] + (fr.fwd[2] * f + fr.side[2] * s + fr.up[2] * z) * R,
  ];
  const style = look.headStyle;

  // Long hair falls behind, over the shoulders.
  if (style === 'long' || style === 'topknot') body.wrod([fp(-0.4, 0, 0.3), fp(-0.9, 0, -1.6)], 0.45 * R, look.hair);

  if (style === 'helmet') {
    // No face: a shell, and its visor lit across the front.
    body.wball(fp(-0.1, 0, 0.05), 1.1 * R, look.coat, 10);
    const visor = [-55, -28, 0, 28, 55].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return fp(-0.1 + Math.cos(a) * 1.13, Math.sin(a) * 1.13, 0.12);
    });
    body.wneon(visor, 0.12 * R, look.neon);
  } else {
    body.wball(hc, R, look.skin, 10);
    if (style === 'hood') body.wball(fp(-0.3, 0, 0.08), 1.2 * R, look.coat, 10);
    else if (style === 'crop' || style === 'long' || style === 'topknot') body.wball(fp(-0.16, 0, 0.12), 1.08 * R, look.hair, 10);
    else if (style === 'shaved') body.wball(fp(-0.14, 0, 0.1), 1.06 * R, shade(look.skin, 0.8), 10);
    if (style === 'topknot') body.wball(fp(-0.4, 0, 1.08), 0.34 * R, look.hair, 6);

    eyes(body, fp, look, R);
    if (look.metatype === 'elf' && style !== 'hood') {
      for (const s of [-1, 1]) body.wrod([fp(-0.1, s * 0.9, 0.1), fp(-0.35, s * 1.45, 0.75)], 0.13 * R, look.skin);
    }
    if (look.metatype === 'dwarf') body.wrod([fp(0.72, 0, -0.35), fp(0.8, 0, -1.05)], 0.34 * R, look.hair);
    if (look.metatype === 'ork' || look.metatype === 'troll') {
      for (const s of [-1, 1]) body.wrod([fp(0.85, s * 0.3, -0.45), fp(0.92, s * 0.34, -0.15)], 0.1 * R, BONE);
    }
  }

  // On top: a mohawk's fin, a troll's horns.
  if (style === 'mohawk') {
    for (let i = 0; i < 5; i += 1) {
      const t = 0.35 + (i / 4) * 1.9; // front of the crown round to the back
      body.wrod([fp(Math.cos(t) * 0.9, 0, Math.sin(t) * 0.9), fp(Math.cos(t) * 1.55, 0, Math.sin(t) * 1.6 + 0.05)], 0.17 * R, look.hair);
    }
    body.wneon([fp(0.6, 0, 1.3), fp(0, 0, 1.62), fp(-0.7, 0, 1.3)], 0.07 * R, look.hair);
  }
  if (look.metatype === 'troll') {
    for (const s of [-1, 1]) {
      body.wrod([fp(0.1, s * 0.75, 0.55), fp(-0.2, s * 1.0, 1.3), fp(-0.65, s * 0.9, 1.55)], 0.2 * R, BONE, true);
    }
  }
}

function eyes(body: Body, fp: (f: number, s: number, z: number) => V3, look: FigureLook, R: number): void {
  switch (look.eyes) {
    case 'shades':
      // Mirrorshades: a black bar round the front of the face.
      body.wrod([fp(0.86, -0.55, 0.14), fp(0.99, 0, 0.14), fp(0.86, 0.55, 0.14)], 0.13 * R, LENS);
      break;
    case 'visor':
      body.wneon([fp(0.84, -0.6, 0.12), fp(1.0, 0, 0.14), fp(0.84, 0.6, 0.12)], 0.1 * R, look.neon);
      break;
    case 'goggles':
      for (const s of [-1, 1]) body.wglow(fp(0.92, s * 0.36, 0.14), 0.2 * R, GOGGLES);
      break;
    case 'cybereye':
      body.wglow(fp(0.93, 0.35, 0.12), 0.15 * R, look.neon);
      body.wball(fp(0.93, -0.35, 0.12), 0.09 * R, PUPIL, 4);
      break;
    default:
      for (const s of [-1, 1]) body.wball(fp(0.93, s * 0.35, 0.12), 0.09 * R, PUPIL, 4);
  }
}

// ------------------------------------------------------------ props

/** A prop: a dark steel crate with strapped lid and a lit strip, a square across per square of token. */
function buildCrate(b: MeshBuilder, look: FigureLook, size: number, base: number): void {
  const half = 0.42 * size;
  const h = 0.5 * base;
  b.box(-half, 0, -half, half, h, half, look.coat, { top: shade(look.coat, 1.15) });
  const strap = shade(look.coat, 0.7);
  for (const s of [-0.3, 0.3]) b.beam([[-half, h, s * half], [half, h, s * half]], 0.012 * size, strap);
  b.beam([[half + 0.006, h * 0.72, -half * 0.8], [half + 0.006, h * 0.72, half * 0.8]], 0.009 * size, look.neon, 'glow');
}

// ------------------------------------------------------------ the API

/**
 * A token as a 3D figure: its feet at the origin, facing +x (the figure pool,
 * `grid/stage3d/figures.ts`, stands it on its square and turns it), standing,
 * crouched or prone as `token.pose` says — or a crate, for a prop. Its own
 * small meshes (a solid one that casts and takes shadows, a glow one for its
 * neon), sharing the materials it is given. Free it with `disposeFigure`.
 */
export function buildFigure(token: Token, materials: LabMaterials, ctx: FigureCtx): Group {
  const look = lookFor(token);
  const size = token.size > 0 ? token.size : 1;
  // A human's height in squares, grown with a big token's footprint.
  const base = (HUMAN_M / (ctx.unitM > 0 ? ctx.unitM : 1)) * Math.sqrt(size);
  const b = new MeshBuilder();
  if (look.crate) buildCrate(b, look, size, base);
  else buildPerson(b, look, ctx.pose ?? token.pose ?? 'stand', base);
  const built = b.finish(materials);
  if (built.solid) {
    built.solid.castShadow = true;
    built.solid.receiveShadow = true;
  }
  if (built.glow) built.glow.castShadow = false;
  const group = new Group();
  group.name = `figure:${token.id}`;
  group.userData.tokenId = token.id;
  for (const o of built.all) group.add(o);
  return group;
}

/**
 * Where a figure down from physical damage lies in its blood: the 2D figure's
 * pool (`figure.ts` `drawFigure`, its bleeding oval), in this figure's own
 * world space — feet at the origin, facing +x, squares — flat on its floor:
 * the pool's middle (`x` along the body, `z` to its right hand) and its
 * half-lengths along the body (`rx`) and across it (`rz`). Scaled by the
 * metatype's breadth as the body lying in it is. Null for a prop, which
 * never bleeds.
 */
export function bloodPool(token: Token, ctx: Pick<FigureCtx, 'unitM'>): { x: number; z: number; rx: number; rz: number } | null {
  const look = lookFor(token);
  if (look.crate) return null;
  const size = token.size > 0 ? token.size : 1;
  const across = (HUMAN_M / (ctx.unitM > 0 ? ctx.unitM : 1)) * Math.sqrt(size) * look.build.w;
  // Body units, as the 2D oval has them: centred a little forward and to the
  // right of the hips, 0.3 along the body and 0.2 across.
  return { x: 0.02 * across, z: 0.05 * across, rx: 0.3 * across, rz: 0.2 * across };
}

/** Free a figure's geometry and take it out of the scene (the materials are the owner's). */
export function disposeFigure(group: Group): void {
  group.traverse((o: Object3D) => {
    (o as Mesh).geometry?.dispose();
  });
  group.removeFromParent();
}
