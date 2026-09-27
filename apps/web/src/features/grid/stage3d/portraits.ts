/**
 * The tokens' portraits in the 3D map's top view (P4 of the move to 3D): a
 * round disc lying face up on each figure's head, with the token's portrait
 * on it — or its initial on the colour of where it came from — so a map seen
 * straight down reads as the 2D plan's token discs did.
 *
 * Why a disc on the figure and not the plate alone. Looking straight down a
 * figure is head and shoulders, and the plate (`badges.ts`) hangs over the
 * head as it does in iso: a portrait the size of a label, just north of the
 * figure it names. On the plan a token IS its disc. So in the top view each
 * figure wears one, sized to it as its rings are (`portraitRadius`), and its
 * plate gives up its own portrait and lays its bars and name round this one.
 * In iso there is no disc: the plates stay as they are.
 *
 * Each disc is a small canvas made into a texture: the source colour, the
 * image cropped to fill the circle as the plate's `object-fit: cover` crops
 * it, and a rim — magenta for the GM's view of a hidden token, which is also
 * drawn see-through — or the initial while there is no image, while it
 * loads, or when it will not. Each image is loaded once per URL for every
 * disc that shows it (`PortraitArt`), and a disc is drawn again only when
 * what it says changes. Unlit and not tone-mapped: a portrait is a picture,
 * not a surface in the room, as the plate is. It wears the fog's cover
 * (`cover.ts`) as its figure does, so it never says who stands in the fog.
 */
import { CanvasTexture, CircleGeometry, Mesh, MeshBasicMaterial, SRGBColorSpace, type BufferGeometry } from 'three';
import type { Token } from '@safehouse/contracts';
import { C } from '../stage/colors.js';
import { SOURCE_COLORS, tokenInitial } from '../stage/tokenState.js';
import { applyCover } from './cover.js';

/**
 * A portrait's radius per √size, in squares: just inside the selection ring
 * (`figures.ts`, 0.42 per √size less its half-width), so the cyan and amber
 * rings on the floor still show round the disc from straight above. Grown
 * with √size, as the figure and its rings are.
 */
const PORTRAIT_R = 0.36;
/** The canvas a disc is drawn on, px square: sharp at the size a square takes on the laptop or the TV. */
const TEXTURE_PX = 128;
/** The rim's width, as a share of the canvas: the plate's 1.5 px on its 28. */
const RIM = 0.055;
/** A ghosted disc's opacity: the plate's. */
const GHOST_ALPHA = 0.45;
/** Among the see-through things: over the figures' shadows, auras and rings (1–2), under the GM's fog tint. */
const PORTRAIT_ORDER = 4;
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';

/** The radius of a size-`size` token's portrait disc, in squares. */
export function portraitRadius(size: number): number {
  return PORTRAIT_R * Math.sqrt(size > 0 ? size : 1);
}

/** The shape every disc is drawn on: a circle of radius 1 lying face up, north at the top of its texture. */
export function portraitGeometry(): BufferGeometry {
  return new CircleGeometry(1, 48).rotateX(-Math.PI / 2);
}

/** A palette number as a CSS colour, for the canvas. */
function css(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${alpha})`;
}

/** One portrait image, as every disc that shows it shares it. */
export interface Art {
  readonly img: HTMLImageElement;
  state: 'loading' | 'ready' | 'failed';
}

/**
 * The portrait images, each loaded once, by URL. `onLoad` hears when one
 * arrives, or fails, so the discs that show it are drawn again. A failed
 * image is not tried again: its discs keep the initial, as the plate does.
 */
export class PortraitArt {
  private readonly arts = new Map<string, Art>();
  private disposed = false;

  constructor(private readonly onLoad: (url: string) => void) {}

  /** The image at `url`, loading from the first ask. */
  get(url: string): Art {
    const known = this.arts.get(url);
    if (known) return known;
    const img = new Image();
    img.decoding = 'async';
    // A cross-origin image with no CORS answer then fails to load (the
    // initial stands in) rather than tainting the canvas it is drawn on,
    // which WebGL could no longer upload.
    img.crossOrigin = 'anonymous';
    const art: Art = { img, state: 'loading' };
    img.onload = () => {
      if (this.disposed || this.arts.get(url) !== art) return;
      art.state = img.naturalWidth > 0 && img.naturalHeight > 0 ? 'ready' : 'failed';
      this.onLoad(url);
    };
    img.onerror = () => {
      if (this.disposed || this.arts.get(url) !== art) return;
      art.state = 'failed';
      this.onLoad(url);
    };
    img.src = url;
    this.arts.set(url, art);
    return art;
  }

  /** Let go of every image but the ones at `urls`: a token that left takes its portrait with it. */
  retain(urls: ReadonlySet<string>): void {
    for (const [url, art] of this.arts) {
      if (urls.has(url)) continue;
      art.img.onload = null;
      art.img.onerror = null;
      this.arts.delete(url);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.retain(new Set());
  }
}

/**
 * One token's disc: a mesh lying face up, radius 1 (its owner scales it to
 * the token and stands it on the head), drawn from the token as `draw` is
 * handed it.
 */
export class PortraitDisc {
  readonly mesh: Mesh;
  /** The portrait URL it shows or waits for; null for the initial. */
  url: string | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  /** What it was last drawn saying. */
  private key = '';

  constructor(geometry: BufferGeometry) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TEXTURE_PX;
    this.canvas.height = TEXTURE_PX;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    // Not hidden by what hangs over the figure (a tree's crown, a door's
    // lintel): the 2D plan drew its token discs over every tile.
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.material.name = 'stage-portrait';
    // Over the shroud and under the fog, as the figure it lies on.
    applyCover(this.material, 'fog');
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'portrait';
    this.mesh.renderOrder = PORTRAIT_ORDER;
  }

  /**
   * Show `token`: its portrait from `art` once that has loaded (`url` is
   * where it comes from, null for none), else its initial; see-through with
   * a magenta rim when `ghosted`. Draws the canvas again only when that
   * changed.
   */
  draw(token: Token, ghosted: boolean, url: string | null, art: Art | null): void {
    this.url = url;
    const image = art?.state === 'ready' ? art.img : null;
    const key = `${token.name}|${token.source}|${image ? url : ''}|${ghosted ? 1 : 0}`;
    if (key === this.key) return;
    this.key = key;
    this.material.opacity = ghosted ? GHOST_ALPHA : 1;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const n = TEXTURE_PX;
    const c = n / 2;
    const rim = n * RIM;
    g.clearRect(0, 0, n, n);
    g.save();
    g.beginPath();
    g.arc(c, c, c - rim / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = css(SOURCE_COLORS[token.source] ?? C.raised);
    g.fillRect(0, 0, n, n);
    if (image) {
      // The middle square of the image, filling the circle.
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      const s = Math.min(w, h);
      g.drawImage(image, (w - s) / 2, (h - s) / 2, s, s, 0, 0, n, n);
    } else {
      g.fillStyle = css(C.ink);
      g.font = `600 ${Math.round(n * 0.45)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(tokenInitial(token.name), c, c + n * 0.02);
    }
    g.restore();
    g.lineWidth = rim;
    g.strokeStyle = css(ghosted ? C.magenta : C.edgeBright, 0.9);
    g.beginPath();
    g.arc(c, c, c - rim / 2, 0, Math.PI * 2);
    g.stroke();
    this.texture.needsUpdate = true;
  }

  /** Free the texture and the material (the geometry is its owner's) and take the disc off its figure. */
  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
