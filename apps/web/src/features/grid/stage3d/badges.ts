/**
 * The token plates of the 3D map: a small DOM plate hanging over each
 * figure's head (P1 of the move to 3D).
 *
 * What a plate says is what the 2D badge says (`tokenView.ts`), read through
 * the same rules (`tokenState.ts`), so the two renderers never disagree:
 *   - the portrait (`token.artRef`), round, or the name's initial on the
 *     colour of where the token came from (`SOURCE_COLORS`);
 *   - the name, under it;
 *   - the physical and stun bars over it, physical on top, each in
 *     `barColor` of how full it is; none when the view gets no bars;
 *   - a pip per status effect along the disc's top edge (`pipCount`);
 *   - a cyan ring when selected, an amber glow breathing while acting;
 *   - see-through, with a magenta rim, for the GM's view of a hidden token.
 *
 * Plates are DOM, not meshes: text stays sharp at every zoom, a portrait is
 * just an image, and none of it costs the 3D scene a draw call. The acting
 * glow breathes by a Web Animation, on the compositor, so it asks the 3D
 * runtime for no frames of its own.
 *
 * Work is split the way the frame loop wants it. `sync` (on each stage
 * update) touches a plate's DOM only when what it says changed; `layout`
 * (after each drawn frame in which the camera or a figure moved) only moves
 * plates, writing a transform where the position really changed. Plates
 * ignore the pointer: every press goes through to the map beneath, whose
 * stage asks `pick` whether it landed on a portrait.
 */
import { Vector3 } from 'three';
import type { TokenBars } from '../types.js';
import { C } from '../stage/colors.js';
import { barColor, barsKey, monitorFill, pipCount, SOURCE_COLORS, tokenInitial } from '../stage/tokenState.js';
import type { FigureState } from './figures.js';

/** What a plate is drawn from: a figure's state without its floor (a plate follows its figure's). */
export type BadgeState = Pick<FigureState, 'token' | 'bars' | 'selected' | 'acting' | 'ghosted'>;

/** The disc's diameter at full size, in px: the 2D iso badge's largest. */
const DISC_PX = 28;
/**
 * Plates are drawn at full size when a square is this many px across, and
 * scaled with the zoom from there, within `MIN_SCALE`..`MAX_SCALE` — small
 * enough not to bury a zoomed-out map in labels, never too small to read.
 */
const FULL_SIZE_SQUARE_PX = 56;
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.25;
/** A ghosted plate's opacity: the 2D ghost's. */
const GHOST_ALPHA = 0.45;
/** Room round a portrait disc in which a press still takes its token, screen px. */
const PICK_SLOP_PX = 3;
/** Half a breath of the acting glow, ms: the 2D glow's sine at 0.005 rad/ms. */
const BREATH_HALF_MS = 628;
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
/** Scratch for `scaleAt`'s probes, so a layout allocates no vector. */
const PROBE = new Vector3();

/** A palette number as a CSS colour. */
function css(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** A styled element. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  return e;
}

/** One token's plate and the parts of it that change. */
interface Plate {
  /** Positioned by `layout`: its bottom centre sits on the figure's head point. */
  readonly el: HTMLDivElement;
  readonly bars: HTMLDivElement;
  readonly disc: HTMLDivElement;
  readonly initial: HTMLSpanElement;
  img: HTMLImageElement | null;
  /** The portrait URL shown or loading, and one that failed to load (not tried again). */
  src: string | null;
  failed: string | null;
  readonly ring: HTMLDivElement;
  readonly glow: HTMLDivElement;
  breath: Animation | null;
  readonly pips: HTMLDivElement;
  readonly name: HTMLDivElement;
  /** What the plate was last drawn saying. */
  key: string;
  shown: boolean;
  /** Where `layout` last put it: screen px, scale, stacking. */
  x: number;
  y: number;
  k: number;
  z: number;
}

/**
 * The DOM plates over the figures' heads, one per token on show. The overlay
 * is a positioned element laid over the 3D canvas, the size of the view; the
 * plates go in a layer of their own inside it.
 */
export class TokenBadges {
  private readonly layer: HTMLDivElement;
  private readonly plates = new Map<string, Plate>();
  private disposed = false;

  constructor(
    overlay: HTMLElement,
    private readonly urlFor: (attachmentId: string) => string,
  ) {
    this.layer = make('div', {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      userSelect: 'none',
      // The plates' stacking stays inside the layer, whatever z-index they take.
      isolation: 'isolate',
    });
    this.layer.dataset.layer = 'token-plates';
    overlay.appendChild(this.layer);
  }

  /**
   * A plate per token: new ones made (hidden until the next `layout` places
   * them), gone ones removed, and a plate's DOM redrawn only when what it
   * says — name, portrait, source, bars, pips, selected, acting, ghosted —
   * changed.
   */
  sync(states: ReadonlyArray<BadgeState>): void {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const s of states) {
      const id = s.token.id;
      seen.add(id);
      let p = this.plates.get(id);
      if (!p) {
        p = this.create();
        this.plates.set(id, p);
        this.layer.appendChild(p.el);
      }
      const t = s.token;
      const key = [t.name, t.source, t.artRef ?? '', s.selected, s.acting, s.ghosted, barsKey(s.bars)].join('|');
      if (key === p.key) continue;
      p.key = key;
      this.draw(p, s);
    }
    for (const [id, p] of this.plates) {
      if (seen.has(id)) continue;
      this.drop(p);
      this.plates.delete(id);
    }
  }

  /**
   * Put every plate over its figure's head: `positionOf` says where that is
   * in world units (null: the figure is not on show, and neither is its
   * plate), `project` where a world point lands in the overlay's px. Call
   * after each drawn frame in which the camera or a figure moved.
   */
  layout(project: (world: Vector3) => { x: number; y: number }, positionOf: (tokenId: string) => Vector3 | null): void {
    if (this.disposed) return;
    let k = -1;
    for (const [id, p] of this.plates) {
      const at = positionOf(id);
      if (!at) {
        this.hide(p);
        continue;
      }
      // One scale for all: the camera is orthographic, so a square is the same size everywhere on screen.
      if (k < 0) k = scaleAt(project, at);
      const s = project(at);
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        this.hide(p);
        continue;
      }
      const x = Math.round(s.x * 2) / 2;
      const y = Math.round(s.y * 2) / 2;
      if (!p.shown) {
        p.el.style.display = 'flex';
        p.shown = true;
      }
      if (x !== p.x || y !== p.y || k !== p.k) {
        p.x = x;
        p.y = y;
        p.k = k;
        // The plate's bottom centre (its transform origin) lands on the point.
        p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${k})`;
      }
      // Lower on screen is nearer the camera, in iso and in top view alike: in front.
      const z = Math.round(y);
      if (z !== p.z) {
        p.z = z;
        p.el.style.zIndex = String(z);
      }
    }
  }

  /**
   * The token whose plate's portrait disc is under `screen` (overlay px, the
   * host px the pointer measures in), the nearest plate where two overlap;
   * null for none. The portrait is what the eye takes for the token, and in
   * the top view it hangs a square north of the figure it names — over
   * whoever stands there — so a press on it has to mean its own token.
   * Reads the plates' laid-out boxes: call it on a press, not per move.
   */
  pick(screen: { x: number; y: number }): string | null {
    if (this.disposed) return null;
    let best: string | null = null;
    let bestZ = -Infinity;
    let origin: DOMRect | null = null;
    for (const [id, p] of this.plates) {
      if (!p.shown) continue;
      origin ??= this.layer.getBoundingClientRect();
      const r = p.disc.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      const cx = (r.left + r.right) / 2 - origin.left;
      const cy = (r.top + r.bottom) / 2 - origin.top;
      if (Math.hypot(screen.x - cx, screen.y - cy) > r.width / 2 + PICK_SLOP_PX) continue;
      // Lower on screen is nearer, and drawn on top (`layout`'s zIndex).
      if (p.z >= bestZ) {
        bestZ = p.z;
        best = id;
      }
    }
    return best;
  }

  /** Remove every plate and the layer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.plates.values()) this.drop(p);
    this.plates.clear();
    this.layer.remove();
  }

  // --- one plate -----------------------------------------------------------

  private create(): Plate {
    const el = make('div', {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      paddingBottom: '4px',
      transformOrigin: '50% 100%',
      fontFamily: FONT,
    });
    const bars = make('div', {
      display: 'none',
      flexDirection: 'column',
      gap: '2px',
      width: `${DISC_PX}px`,
      marginBottom: '3px',
    });
    const holder = make('div', { position: 'relative', width: `${DISC_PX}px`, height: `${DISC_PX}px`, flex: 'none' });
    const glow = make('div', {
      position: 'absolute',
      inset: '-7px',
      borderRadius: '50%',
      border: `2.5px solid ${css(C.warn, 0.9)}`,
      boxShadow: `0 0 8px ${css(C.warn, 0.45)}`,
      display: 'none',
    });
    const disc = make('div', {
      position: 'absolute',
      inset: '0',
      borderRadius: '50%',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
    });
    const initial = make('span', {
      color: css(C.ink),
      fontSize: `${Math.round(DISC_PX * 0.45)}px`,
      fontWeight: '600',
      lineHeight: '1',
    });
    disc.appendChild(initial);
    const ring = make('div', {
      position: 'absolute',
      inset: '-4px',
      borderRadius: '50%',
      border: `1.5px solid ${css(C.cyan, 0.9)}`,
      display: 'none',
    });
    const pips = make('div', {
      position: 'absolute',
      top: '-3px',
      right: '-2px',
      display: 'flex',
      flexDirection: 'row-reverse',
      gap: '1px',
    });
    holder.append(glow, disc, ring, pips);
    const name = make('div', {
      marginTop: '2px',
      maxWidth: '120px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: '10px',
      lineHeight: '12px',
      color: css(C.ink),
      textShadow: `0 0 2px ${css(C.ground)}, 0 0 2px ${css(C.ground)}, 0 0 3px ${css(C.ground)}`,
    });
    el.append(bars, holder, name);
    return {
      el,
      bars,
      disc,
      initial,
      img: null,
      src: null,
      failed: null,
      ring,
      glow,
      breath: null,
      pips,
      name,
      key: '',
      shown: false,
      x: Number.NaN,
      y: Number.NaN,
      k: Number.NaN,
      z: Number.NaN,
    };
  }

  /** Redraw what a plate says. */
  private draw(p: Plate, s: BadgeState): void {
    const t = s.token;
    p.name.textContent = t.name;
    p.initial.textContent = tokenInitial(t.name);
    p.disc.style.background = css(SOURCE_COLORS[t.source] ?? C.raised);
    p.disc.style.border = `1.5px solid ${css(s.ghosted ? C.magenta : C.edgeBright, 0.9)}`;
    p.el.style.opacity = s.ghosted ? String(GHOST_ALPHA) : '1';
    this.portrait(p, t.artRef ?? null);

    p.ring.style.display = s.selected ? 'block' : 'none';
    p.glow.style.display = s.acting ? 'block' : 'none';
    if (s.acting && !p.breath && typeof p.glow.animate === 'function') {
      p.breath = p.glow.animate([{ opacity: 0.1 }, { opacity: 1 }], {
        duration: BREATH_HALF_MS,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out',
      });
    } else if (!s.acting && p.breath) {
      p.breath.cancel();
      p.breath = null;
    }

    drawBars(p.bars, s.bars);

    const count = pipCount(s.bars);
    p.pips.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      p.pips.appendChild(
        make('span', {
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: css(C.magenta),
          border: `1px solid ${css(C.ground)}`,
        }),
      );
    }
  }

  /**
   * The portrait, or the initial while there is none, while it loads, or when
   * it will not load. A new `artRef` swaps the image; a removed one goes back
   * to the initial (the 2D badge learned both the hard way — `tokenView.ts`).
   */
  private portrait(p: Plate, artRef: string | null): void {
    const url = artRef ? this.urlFor(artRef) : null;
    if (!url || url === p.failed) {
      p.img?.remove();
      p.img = null;
      p.src = null;
      p.initial.style.display = '';
      return;
    }
    if (url === p.src) return;
    p.src = url;
    let img = p.img;
    if (!img) {
      img = make('img', { width: '100%', height: '100%', objectFit: 'cover', display: 'none' });
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      p.disc.appendChild(img);
      p.img = img;
    }
    const shown = img;
    shown.style.display = 'none';
    p.initial.style.display = '';
    shown.onload = () => {
      if (p.src !== url) return;
      shown.style.display = 'block';
      p.initial.style.display = 'none';
    };
    shown.onerror = () => {
      // Missing art falls back to the initial — never fatal, never retried.
      if (p.src !== url) return;
      p.failed = url;
      shown.style.display = 'none';
      p.initial.style.display = '';
    };
    shown.src = url;
  }

  private hide(p: Plate): void {
    if (!p.shown) return;
    p.el.style.display = 'none';
    p.shown = false;
  }

  private drop(p: Plate): void {
    p.breath?.cancel();
    p.breath = null;
    if (p.img) {
      p.img.onload = null;
      p.img.onerror = null;
    }
    p.el.remove();
  }
}

/** The condition bars: physical over stun, each filled in its colour; none when there are none. */
function drawBars(host: HTMLDivElement, bars: TokenBars | null): void {
  host.replaceChildren();
  let any = false;
  for (const mon of bars ? [bars.physical, bars.stun] : []) {
    if (!mon || mon.max <= 0) continue;
    any = true;
    const frac = monitorFill(mon);
    const track = make('div', {
      position: 'relative',
      height: '3px',
      overflow: 'hidden',
      background: css(C.panel, 0.9),
      outline: `1px solid ${css(C.edge)}`,
    });
    if (frac > 0) {
      track.appendChild(
        make('div', {
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: `${frac * 100}%`,
          background: css(barColor(frac)),
        }),
      );
    }
    host.appendChild(track);
  }
  host.style.display = any ? 'flex' : 'none';
}

/**
 * The plates' scale for the zoom: how many px a square spans on screen at
 * `at`, measured along whichever floor axis shows longer (in iso both lie
 * foreshortened; in top view both show whole), against `FULL_SIZE_SQUARE_PX`.
 */
function scaleAt(project: (world: Vector3) => { x: number; y: number }, at: Vector3): number {
  const o = project(at);
  const ox = o.x;
  const oy = o.y;
  const probe = PROBE.copy(at);
  probe.x += 1;
  const a = project(probe);
  const alongX = Math.hypot(a.x - ox, a.y - oy);
  probe.x -= 1;
  probe.z += 1;
  const b = project(probe);
  const alongZ = Math.hypot(b.x - ox, b.y - oy);
  const px = Math.max(alongX, alongZ);
  if (!Number.isFinite(px) || px <= 0) return 1;
  const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, px / FULL_SIZE_SQUARE_PX));
  return Math.round(k * 100) / 100;
}
