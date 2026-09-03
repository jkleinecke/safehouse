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
 * A single flat fill on all three faces reads as a hexagon, not a solid — the
 * eye needs the brightness step to resolve it as a box standing on the floor.
 * The top catches the light, the two sides fall away from it, and the two
 * sides differ from each other so a corner where two walls meet is legible.
 */
export const FACE_SHADE = { top: 1.15, left: 0.72, right: 0.52 } as const;
