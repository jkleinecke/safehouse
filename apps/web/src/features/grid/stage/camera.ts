/**
 * Camera math for the scene canvas — pure, no pixi, no DOM (unit-tested).
 *
 * Screen = world * scale + pan. The stage root Container mirrors {x,y,scale}
 * once per frame; nothing else touches transforms, so pan/zoom costs no
 * per-frame allocation and never invalidates the layer geometry.
 */
import type { Point } from '@safehouse/contracts';

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 6;

export interface Viewport {
  width: number;
  height: number;
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  /** Set whenever x/y/scale changed since the last frame flush. */
  dirty = true;

  /** Screen px → world px. */
  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  /** World px → screen px. */
  toScreen(wx: number, wy: number): Point {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.x += dx;
    this.y += dy;
    this.dirty = true;
  }

  /** Zoom keeping the world point under `(sx, sy)` pinned to that screen px. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clampScale(this.scale * factor);
    if (next === this.scale) return;
    const ratio = next / this.scale;
    this.x = sx - (sx - this.x) * ratio;
    this.y = sy - (sy - this.y) * ratio;
    this.scale = next;
    this.dirty = true;
  }

  /** Put a world point at the centre of the viewport (focus here / open). */
  centerOn(wx: number, wy: number, view: Viewport): void {
    this.x = view.width / 2 - wx * this.scale;
    this.y = view.height / 2 - wy * this.scale;
    this.dirty = true;
  }

  /** Fit a world-space rect into the viewport with a small margin. */
  fit(width: number, height: number, view: Viewport, margin = 24): void {
    if (width <= 0 || height <= 0 || view.width <= 0 || view.height <= 0) return;
    const s = clampScale(
      Math.min((view.width - margin * 2) / width, (view.height - margin * 2) / height),
    );
    this.scale = s;
    this.centerOn(width / 2, height / 2, view);
  }

  set(x: number, y: number, scale: number): void {
    this.x = x;
    this.y = y;
    this.scale = clampScale(scale);
    this.dirty = true;
  }
}

/**
 * Wheel delta → zoom factor. Line/page deltaModes are normalised so a trackpad
 * pinch (pixels) and a mouse notch (lines) feel comparable.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-240, Math.min(240, px));
  return Math.exp(-clamped * 0.0016);
}
