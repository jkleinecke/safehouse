/**
 * A ~200-line PNG writer + rect/text raster, used by the demo seed to draw the
 * Pier 23 floor plan at seed time.
 *
 * Why hand-rolled: the attachment route's mime allow-list is raster-only
 * (`image/png|jpeg|webp|gif`), so an SVG map cannot be uploaded, and `pngjs`
 * /`sharp` are outside the dependency budget (BUILD_CONVENTIONS). Everything
 * here is stdlib: `node:zlib` supplies the deflate stream PNG's IDAT wants, so
 * the output is an ordinary compressed truecolour PNG, not a stored-block hack.
 *
 * Colours are 0xRRGGBB. Coordinates are pixels, floats accepted (floored).
 */
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG container
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffff_ffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffff_ffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8-bit truecolour (colour type 2), no interlace, filter 0 on every row. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---------------------------------------------------------------------------
// A 5×7 uppercase bitmap font
// ---------------------------------------------------------------------------

/**
 * Seven rows per glyph, each row a 5-bit mask (bit 4 = leftmost pixel) written
 * as one base-32 digit — so a whole glyph is a 7-character string.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  A: 'ehhvhhh', B: 'uhhuhhu', C: 'fgggggf', D: 'uhhhhhu', E: 'vgguggv', F: 'vgguggg',
  G: 'ehgnhhe', H: 'hhhvhhh', I: 'v44444v', J: '72222ic', K: 'hikokih', L: 'ggggggv',
  M: 'hrlhhhh', N: 'hpljhhh', O: 'ehhhhhe', P: 'uhhuggg', Q: 'ehhhlid', R: 'uhhukih',
  S: 'fgge11u', T: 'v444444', U: 'hhhhhhe', V: 'hhhhha4', W: 'hhhhlrh', X: 'hha4ahh',
  Y: 'hha4444', Z: 'v1248gv',
  '0': 'ehjlphe', '1': '4c4444e', '2': 'eh1248v', '3': 'v2421he', '4': '26aiv22',
  '5': 'vgu11he', '6': '68guhhe', '7': 'v124888', '8': 'ehhehhe', '9': 'ehhf12c',
  ' ': '0000000', '-': '000e000', '.': '0000004', "'": '4400000',
};

const GLYPH_W = 5;
const GLYPH_H = 7;

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

export interface StrokeOpts {
  /** Line thickness in pixels (default 1). */
  width?: number;
  /** 0..1 blend against what is already there (default 1 = opaque). */
  alpha?: number;
}

/** A flat RGB canvas with the handful of primitives a floor plan needs. */
export class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background = 0x000000,
  ) {
    this.data = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  private blend(x: number, y: number, color: number, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    const src = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
    for (let c = 0; c < 3; c += 1) {
      const dst = this.data[i + c] ?? 0;
      this.data[i + c] = Math.round(dst + (src[c]! - dst) * alpha);
    }
  }

  /** Axis-aligned filled rectangle. */
  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    if (alpha <= 0 || w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) this.blend(px, py, color, alpha);
    }
  }

  /** Rectangle outline, drawn inward from the given bounds. */
  outline(x: number, y: number, w: number, h: number, color: number, opts: StrokeOpts = {}): void {
    const t = opts.width ?? 1;
    const a = opts.alpha ?? 1;
    this.rect(x, y, w, t, color, a);
    this.rect(x, y + h - t, w, t, color, a);
    this.rect(x, y, t, h, color, a);
    this.rect(x + w - t, y, t, h, color, a);
  }

  /**
   * Horizontal or vertical segment centred on the line (diagonals are not
   * needed for a rectilinear floor plan and are not supported).
   */
  segment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    opts: StrokeOpts = {},
  ): void {
    const t = opts.width ?? 1;
    const a = opts.alpha ?? 1;
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    if (Math.abs(y1 - y0) <= Math.abs(x1 - x0)) {
      this.rect(ax, ay - t / 2, bx - ax, t, color, a);
    } else {
      this.rect(ax - t / 2, ay, t, by - ay, color, a);
    }
  }

  /** Uppercase-only text; unknown characters render as blanks. */
  text(x: number, y: number, str: string, color: number, scale = 1, alpha = 1): void {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const glyph = GLYPHS[ch];
      if (glyph !== undefined) {
        for (let row = 0; row < GLYPH_H; row += 1) {
          const bits = Number.parseInt(glyph[row] ?? '0', 32);
          for (let col = 0; col < GLYPH_W; col += 1) {
            if ((bits & (1 << (GLYPH_W - 1 - col))) === 0) continue;
            this.rect(cx + col * scale, y + row * scale, scale, scale, color, alpha);
          }
        }
      }
      cx += (GLYPH_W + 1) * scale;
    }
  }

  /** Rendered width of `text` at `scale`, for centring. */
  static textWidth(str: string, scale = 1): number {
    return Math.max(0, str.length * (GLYPH_W + 1) * scale - scale);
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}
