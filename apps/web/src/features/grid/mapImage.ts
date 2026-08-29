/**
 * Photo-friendly controls for scanned / photographed maps (FR9.2, P2 scope):
 * rotate, crop and contrast/brightness, persisted with the scene.
 *
 * Storage shape: `Scene.mapAttachmentIds` is a plain `string[]` in
 * `@safehouse/contracts` and the scenes service stores it verbatim, so an
 * adjustment rides along as a URL-ish fragment on the id:
 *
 *     "att_123#rot=90&crop=0.05,0.1,0.9,0.8&con=1.2&bri=0.95"
 *
 * A bare id parses to the identity adjustment, so every scene written before
 * this existed keeps working — which is what made the fragment worth choosing
 * over a schema change that would have needed a migration mid-campaign. Should
 * the contract grow a real `mapImages: { id, rotateDeg, crop, contrast,
 * brightness }[]`, delete `parseMapImageRef`/`formatMapImageRef` and read the
 * objects directly; the maths below is already shaped for it.
 */

/** Normalised crop window, 0..1 of the source image. */
export interface MapCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapImageRef {
  /** The bare attachment id — what `/files/:id` wants. */
  id: string;
  /** Quarter turns only: 0 | 90 | 180 | 270. Scans come off the glass sideways. */
  rotateDeg: number;
  /** Null = the whole image. */
  crop: MapCrop | null;
  /** 1 = untouched, like CSS `contrast()`. */
  contrast: number;
  /** 1 = untouched, like CSS `brightness()`. */
  brightness: number;
}

export const FULL_CROP: MapCrop = { x: 0, y: 0, w: 1, h: 1 };

/** Clamp a crop window into the image and keep it non-degenerate. */
export function clampCrop(c: MapCrop): MapCrop {
  const x = clamp01(c.x);
  const y = clamp01(c.y);
  const w = Math.min(Math.max(0.02, c.w), 1 - x);
  const h = Math.min(Math.max(0.02, c.h), 1 - y);
  return { x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Snap to the four legal quarter turns; anything else rounds to the nearest. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const q = Math.round(deg / 90) * 90;
  return ((q % 360) + 360) % 360;
}

function normalizeGain(n: number, fallback = 1): number {
  if (!Number.isFinite(n)) return fallback;
  return round3(Math.min(3, Math.max(0.1, n)));
}

export function defaultMapImageRef(id: string): MapImageRef {
  return { id, rotateDeg: 0, crop: null, contrast: 1, brightness: 1 };
}

function parseCrop(raw: string | null): MapCrop | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number.parseFloat(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  const crop = clampCrop({ x, y, w, h });
  return isFullCrop(crop) ? null : crop;
}

export function isFullCrop(c: MapCrop | null): boolean {
  if (!c) return true;
  return c.x <= 0 && c.y <= 0 && c.w >= 1 && c.h >= 1;
}

/** `"id#rot=90&con=1.2"` → a ref. A bare id → the identity adjustment. */
export function parseMapImageRef(raw: string): MapImageRef {
  const hash = raw.indexOf('#');
  if (hash < 0) return defaultMapImageRef(raw);
  const id = raw.slice(0, hash);
  const params = new URLSearchParams(raw.slice(hash + 1));
  return {
    id,
    rotateDeg: normalizeRotation(Number.parseFloat(params.get('rot') ?? '0')),
    crop: parseCrop(params.get('crop')),
    contrast: normalizeGain(Number.parseFloat(params.get('con') ?? '1')),
    brightness: normalizeGain(Number.parseFloat(params.get('bri') ?? '1')),
  };
}

/** True when nothing has been adjusted — the ref serialises back to a bare id. */
export function isIdentityRef(ref: MapImageRef): boolean {
  return (
    normalizeRotation(ref.rotateDeg) === 0 &&
    isFullCrop(ref.crop) &&
    normalizeGain(ref.contrast) === 1 &&
    normalizeGain(ref.brightness) === 1
  );
}

export function formatMapImageRef(ref: MapImageRef): string {
  if (isIdentityRef(ref)) return ref.id;
  const parts: string[] = [];
  const rot = normalizeRotation(ref.rotateDeg);
  if (rot !== 0) parts.push(`rot=${rot}`);
  const crop = ref.crop ? clampCrop(ref.crop) : null;
  if (crop && !isFullCrop(crop)) parts.push(`crop=${crop.x},${crop.y},${crop.w},${crop.h}`);
  const con = normalizeGain(ref.contrast);
  if (con !== 1) parts.push(`con=${con}`);
  const bri = normalizeGain(ref.brightness);
  if (bri !== 1) parts.push(`bri=${bri}`);
  return `${ref.id}#${parts.join('&')}`;
}

/** Bare attachment id for `/files/:id`, whatever the ref carries. */
export function mapImageId(raw: string): string {
  const hash = raw.indexOf('#');
  return hash < 0 ? raw : raw.slice(0, hash);
}

// ---------------------------------------------------------------------------
// Rendering maths — shared by the pixi map layer and the panel's thumbnail
// ---------------------------------------------------------------------------

/** CSS `filter` value for the DOM preview thumbnail. */
export function cssFilter(ref: MapImageRef): string {
  const parts: string[] = [];
  const con = normalizeGain(ref.contrast);
  const bri = normalizeGain(ref.brightness);
  if (con !== 1) parts.push(`contrast(${con})`);
  if (bri !== 1) parts.push(`brightness(${bri})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/** Source-pixel crop rectangle for a texture of `w`×`h`. */
export function cropPixels(
  crop: MapCrop | null,
  w: number,
  h: number,
): { x: number; y: number; width: number; height: number } {
  if (!crop || isFullCrop(crop) || w <= 0 || h <= 0) {
    return { x: 0, y: 0, width: w, height: h };
  }
  const c = clampCrop(crop);
  const x = Math.round(c.x * w);
  const y = Math.round(c.y * h);
  return {
    x,
    y,
    width: Math.max(1, Math.min(w - x, Math.round(c.w * w))),
    height: Math.max(1, Math.min(h - y, Math.round(c.h * h))),
  };
}

/**
 * A quarter turn swaps the axes, so a rotated sprite stretched over the scene
 * rect needs its LOCAL size transposed (pixi applies scale before rotation).
 */
export function localSizeFor(
  rotateDeg: number,
  rect: { width: number; height: number },
): { width: number; height: number } {
  const rot = normalizeRotation(rotateDeg);
  return rot === 90 || rot === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

export function radians(rotateDeg: number): number {
  return (normalizeRotation(rotateDeg) * Math.PI) / 180;
}

/** One-line summary for the panel row ("90°, cropped, contrast 1.2"). */
export function describeAdjustment(ref: MapImageRef): string {
  if (isIdentityRef(ref)) return 'as uploaded';
  const parts: string[] = [];
  const rot = normalizeRotation(ref.rotateDeg);
  if (rot !== 0) parts.push(`${rot}°`);
  if (!isFullCrop(ref.crop)) parts.push('cropped');
  const con = normalizeGain(ref.contrast);
  if (con !== 1) parts.push(`contrast ${con}`);
  const bri = normalizeGain(ref.brightness);
  if (bri !== 1) parts.push(`brightness ${bri}`);
  return parts.join(', ');
}
