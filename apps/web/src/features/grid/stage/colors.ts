/** Stage palette — numeric mirrors of the CSS theme tokens (index.css). */
export const C = {
  ground: 0x060a12,
  deck: 0x0b0e14,
  panel: 0x10151f,
  raised: 0x161d2b,
  edge: 0x1e2837,
  edgeBright: 0x31415a,
  ink: 0xd7e0ea,
  dim: 0x8494a7,
  faint: 0x55637a,
  cyan: 0x2fe6ff,
  cyanDim: 0x1596ab,
  magenta: 0xff2d95,
  warn: 0xffc857,
  ok: 0x45e08c,
  danger: 0xff4d5e,
} as const;

/** Ruler pace-band colors (FR9.8): walk / run / beyond. */
export const PACE_COLORS = { walk: C.ok, run: C.warn, sprint: C.danger } as const;

/** Parse a CSS-ish hex color string to a pixi number; fallback on failure. */
export function parseColor(s: string | undefined | null, fallback: number): number {
  if (!s) return fallback;
  const hex = s.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return Number.parseInt(full, 16);
}

/**
 * Scale a colour's brightness. `f > 1` lightens, `f < 1` darkens; channels
 * clamp rather than wrap, so an already-bright face does not roll over to
 * black at the top of its range.
 */
export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/**
 * Face shading for the isometric extrusion.
 *
 * These are not taste. They fall out of the key light the Shadowrun level
 * editor ships — direction (-0.50, -1.00, -0.75), 48 degrees above the ground
 * plane, with ambient and directional both neutral and each carrying about
 * half. A face therefore lands at `0.502 + 0.502 x lambert` of its own colour:
 * top 0.875, left 0.782, right 0.688. See `FACE_MULTIPLIER` in
 * `@safehouse/rules` for the derivation and the source.
 *
 * Two things changed when we adopted it. The top face used to be 1.15 — it
 * LIT the tile, inventing brightness the model does not have, which is what
 * made every box read as moulded plastic. And the right face used to be 0.52,
 * a spread far wider than the games use.
 *
 * That flatter range gives up legibility, and `FACE_FOOT` is what buys it
 * back: the games get their form from paint, and the nearest thing a
 * procedural renderer has is a gradient down each standing face so a solid
 * sits INTO the floor and rises INTO the light. The horizontal key split is
 * 0.50 : 0.75 rather than a symmetric 45 degrees, which is why the two visible
 * sides differ from each other at all and a corner stays legible.
 */
export const FACE_SHADE = { top: 0.875, left: 0.782, right: 0.688 } as const;

/**
 * How much darker the FOOT of a standing face is than its crown.
 *
 * Sourced as 20-35% for figures and full-height props. Without it the measured
 * face multipliers are too close together to resolve a box at table zoom; with
 * it, a wall grows out of the floor instead of being pasted onto it.
 */
export const FACE_FOOT = 0.74;
