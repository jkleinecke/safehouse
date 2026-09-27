/**
 * The vision modes' colours (docs/VISION.md §4.4–4.5) as data: for each pair
 * of eyes, one colour matrix for the floor and one for the bodies standing on
 * it. The 3D map hands them to the cover patch, which applies them to the
 * final colour of the covered materials that take them (`stage3d/cover.ts`
 * `setVision`), and the bodies' to its DOM plates as an SVG filter
 * (`stage3d/badges.ts` `setLook`). Until P5 they were the 2D map's two
 * ColorMatrixFilters; the numbers are still Pixi's, so each mode looks as it
 * did there.
 *
 * ## The matrices
 *
 * Each is 20 numbers, row-major 4 × 5, the layout Pixi's
 * `ColorMatrixFilter.matrix` takes: one row per output channel (r, g, b, a),
 * each [× r, × g, × b, × a, + offset], on straight (not premultiplied) colour
 * in 0 … 1. In 2D that was the canvas's colour; in 3D it is the fragment's
 * after tone mapping and the output colour space — the same encoding, so the
 * same numbers give the same look.
 *
 * Normal and astral eyes see the map as it is: no matrix at all (`null`).
 *
 * ## Pixi's arithmetic, done here
 *
 * Thermal was always written out. Low-light and ultrasound were Pixi helper
 * calls on the filter (`brightness`, `saturate`, `tint`, `desaturate`,
 * `contrast`); they are built here by the same arithmetic: each helper's
 * matrix exactly as Pixi 8 writes it, and chained exactly as its `_multiply`
 * chains them — the same terms, summed in the same order — so the numbers the
 * 2D filters got were the ones the helper calls made, to the last bit.
 * Two things in that arithmetic are easy to get wrong:
 *   - a chained call (`multiply` true) makes the filter `current × new`, so
 *     the NEW matrix acts on the colour FIRST: `brightness(1.3);
 *     saturate(-0.65, true); tint(c, true)` tints, then drains, then lifts;
 *   - `tint` reads its colour through Pixi's `Color`, which keeps channels in
 *     a Float32Array, so 0xcf arrives as fround(207 / 255), not 207 / 255.
 *
 * Worked example — the low-light floor's red row, B(1.3) × S(−0.65) × T:
 *   - S(−0.65): x = −0.65 × 2 / 3 + 1 = 0.566667, y = (x − 1) × −0.5 = 0.216667,
 *     rows [x y y 0 0], [y x y 0 0], [y y x 0 0], [0 0 0 1 0];
 *   - T(0xcfe8d5): the diagonal fround(207/255, 232/255, 213/255)
 *     = 0.811765, 0.909804, 0.835294;
 *   - B(1.3) × S: red row [1.3x 1.3y 1.3y 0 0] = [0.736667 0.281667 0.281667 0 0];
 *   - (B × S) × T: red row [0.736667 × 0.811765, 0.281667 × 0.909804,
 *     0.281667 × 0.835294, 0, 0] = [0.598000 0.256261 0.235275 0 0].
 * On the colour (0.5, 0.4, 0.3) Pixi's own chain goes: tint → (0.405882,
 * 0.363922, 0.250588); drain → red 0.566667 × 0.405882 + 0.216667 ×
 * (0.363922 + 0.250588) = 0.363144; lift → 0.472087. The row above gives
 * 0.598000 × 0.5 + 0.256261 × 0.4 + 0.235275 × 0.3 = 0.472087. Checked
 * against Pixi 8.20's own `ColorMatrixFilter` helpers when this was written:
 * all 20 numbers of every mode's two matrices equal (===).
 */
import type { VisionMode } from '@safehouse/rules';

/** 20 numbers, row-major 4 × 5, as Pixi's `ColorMatrixFilter.matrix` takes them (see the module note). */
export type ColorMatrix = readonly number[];

/** One pair of eyes' look: a colour matrix for the floor and one for the bodies. */
export interface ViewModeLook {
  /**
   * The ground and what is built on it: the map images, the painted world
   * and the floors below, with the tokens seen down on them. Not the
   * overlays and markers laid over it (grid, doors, zones, pins …), which
   * keep their own colours, as they did on the 2D map.
   */
  readonly floor: ColorMatrix;
  /** The tokens on the floor in view and everything drawn with them: their rings, auras, shadows and badges. */
  readonly bodies: ColorMatrix;
}

// ---------------------------------------------------------------------------
// Pixi 8's ColorMatrixFilter helpers, as pure functions
// ---------------------------------------------------------------------------

/**
 * `ColorMatrixFilter._multiply(out, a, b)`: `a × b`, each read as a 5 × 5
 * matrix with a last row of [0, 0, 0, 0, 1] — so `b` acts on the colour
 * first. Every term as Pixi sums it, in the same order.
 */
function multiply(a: ColorMatrix, b: ColorMatrix): number[] {
  const out: number[] = [];
  for (let r = 0; r < 20; r += 5) {
    for (let c = 0; c < 5; c += 1) {
      const sum = a[r]! * b[c]! + a[r + 1]! * b[c + 5]! + a[r + 2]! * b[c + 10]! + a[r + 3]! * b[c + 15]!;
      out.push(c === 4 ? sum + a[r + 4]! : sum);
    }
  }
  return out;
}

/**
 * What a filter holds after `first` is loaded and each of `then` is applied
 * with `multiply` true, in turn: `((first × then[0]) × then[1]) …`.
 */
function chain(first: ColorMatrix, ...then: ColorMatrix[]): number[] {
  return then.reduce<number[]>((acc, m) => multiply(acc, m), [...first]);
}

/** `brightness(b)`: every colour channel scaled by `b`. */
function brightness(b: number): number[] {
  return [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/** `saturate(amount)`: −1 drains the colour to grey, 0 leaves it, above 0 deepens it. */
function saturate(amount: number): number[] {
  const x = (amount * 2) / 3 + 1;
  const y = (x - 1) * -0.5;
  return [x, y, y, 0, 0, y, x, y, 0, 0, y, y, x, 0, 0, 0, 0, 0, 1, 0];
}

/** `desaturate()`: `saturate(-1)`. */
function desaturate(): number[] {
  return saturate(-1);
}

/** `contrast(amount)`: each channel pushed away from mid grey. */
function contrast(amount: number): number[] {
  const v = (amount || 0) + 1;
  const o = -0.5 * (v - 1);
  return [v, 0, 0, 0, o, 0, v, 0, 0, o, 0, 0, v, 0, o, 0, 0, 0, 1, 0];
}

/** `tint(color)`: each channel scaled by the colour's, read as Pixi's `Color` stores them (float32). */
function tint(color: number): number[] {
  const channel = (shift: number): number => Math.fround(((color >> shift) & 255) / 255);
  const r = channel(16);
  const g = channel(8);
  const b = channel(0);
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

// ---------------------------------------------------------------------------
// The looks
// ---------------------------------------------------------------------------

/**
 * Thermal's heat ramp: luminance scaled per channel, plus a floor (offsets in
 * 0 … 1). A multiply tint on a dark disc only makes a darker disc, and a body
 * has to glow; luminance drives both ramps, the offsets set where they start.
 */
function heatRamp(r: number, g: number, b: number, ro: number, go: number, bo: number): number[] {
  const L = [0.2126, 0.7152, 0.0722];
  return [
    L[0]! * r, L[1]! * r, L[2]! * r, 0, ro,
    L[0]! * g, L[1]! * g, L[2]! * g, 0, go,
    L[0]! * b, L[1]! * b, L[2]! * b, 0, bo,
    0, 0, 0, 1, 0,
  ];
}

type SeeingMode = Exclude<VisionMode, 'normal' | 'astral'>;

const LOOKS: Readonly<Record<SeeingMode, ViewModeLook>> = {
  // Heat, not light: the floor drops to a cold violet with its detail
  // flattened (concrete, crates and water all read about the same to thermal
  // eyes), and every body on it comes up hot amber. Per-tile heat (VISION.md
  // §4.4) will vary the floor later; the split between cold ground and warm
  // bodies is the part that makes thermal useful.
  thermographic: {
    // Cold violet, detail kept.
    floor: heatRamp(0.35, 0.25, 0.6, 0.1, 0.05, 0.25),
    // Hot amber, brighter at the core.
    bodies: heatRamp(0.55, 0.45, 0.15, 0.45, 0.3, 0.05),
  },
  // A lift with the colour drained and a pale green cast; bodies keep a
  // little more of their colour than the ground.
  lowlight: {
    floor: chain(brightness(1.3), saturate(-0.65), tint(0xcfe8d5)),
    bodies: saturate(-0.4),
  },
  // Shape without colour, edges up.
  ultrasound: {
    floor: chain(desaturate(), contrast(0.45)),
    bodies: desaturate(),
  },
};

/** The look for a pair of eyes; null for eyes that see the map as it is (normal, astral). */
export function viewModeLook(mode: VisionMode): ViewModeLook | null {
  return mode === 'normal' || mode === 'astral' ? null : LOOKS[mode];
}
