/**
 * TokenView — one pooled pixi display object per token (FR9.4/9.6).
 *
 * In plan view: a circle (or art sprite in a circular mask) + name label +
 * condition bars + status pips + aura ring + selection ring + acting glow.
 *
 * On the isometric map the token is a figure standing in the scene
 * (`figure.ts`): it walks while it moves, faces the way it went, crouches,
 * lies prone, and goes down when a condition monitor fills. It is split in
 * two containers:
 *
 *   root     on the floor — the aura, the selection ring, the figure. Sorted
 *            with the other figures by depth, and hidden behind the walls
 *            and furniture in front of it (the stage's occluder masks).
 *   overlay  over everything — the portrait badge above the head, the bars,
 *            the name, and a faint copy of the figure where a wall hides it,
 *            so a runner behind a pillar is never lost.
 *
 * Redraws only when its visual key changes, or while the figure is walking;
 * per-frame work otherwise is the lerp and the pulse in `tick`.
 */
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Token } from '@safehouse/contracts';
import type { TokenBars } from '../types.js';
import {
  figureHeightPx,
  gridFromWorld,
  groundRadius,
  ISO_HALF_H,
  ISO_HALF_W,
  tokenRadiusPx,
  type SceneMetrics,
} from '../geometry.js';
import { C, parseColor } from './colors.js';
import { drawFigure, lookFor, poseTop, type FigureLook, type FigurePose } from './figure.js';

const SOURCE_COLORS: Record<Token['source'], number> = {
  character: 0x1c4d5e,
  combatant: 0x5e1c39,
  npc_template: 0x4d3a1c,
  prop: 0x2a3242,
};

export interface TokenVisual {
  selected: boolean;
  acting: boolean;
  draggable: boolean;
  bars: TokenBars | null;
  /** GM view of a hidden token (players never receive them — FR9.7). */
  ghosted: boolean;
  /**
   * The whole metrics, not a copy of two fields out of it. Carrying only
   * `cell` and `unitM` is exactly how the aura came to be drawn without the
   * projection: the one number that would have said "this map is isometric"
   * was the one that never made it down here.
   */
  metrics: SceneMetrics;
}

function barColor(frac: number): number {
  if (frac >= 0.85) return C.danger;
  if (frac >= 0.5) return C.warn;
  return C.ok;
}

/** A full monitor puts the figure on the floor; physical damage bleeds. */
function downedBy(bars: TokenBars | null): 'physical' | 'stun' | null {
  if (bars?.physical && bars.physical.max > 0 && bars.physical.filled >= bars.physical.max) return 'physical';
  if (bars?.stun && bars.stun.max > 0 && bars.stun.filled >= bars.stun.max) return 'stun';
  return null;
}

/** Grid units a figure covers in one walking step — a full cycle is two. */
const STEP_BODY = 0.5;
/** A remote token walks at least this many squares a second, faster over a long move. */
const WALK_SQUARES_PER_S = 1.8;

export class TokenView {
  /** On the floor: sorted by depth with the scene, masked by what stands in front. */
  readonly root = new Container();
  /** Over everything: badge, bars, name, and the see-through copy of the figure. */
  readonly overlay = new Container();
  /** The figure seen through whatever hides it — masked to exactly that, by the stage. */
  readonly ghost: Graphics;
  private readonly aura = new Graphics();
  private readonly glow = new Graphics();
  private readonly figure = new Graphics();
  private readonly badge = new Container();
  private readonly body = new Graphics();
  private readonly artMask = new Graphics();
  private readonly ring = new Graphics();
  private readonly badgeRing = new Graphics();
  private readonly bars = new Graphics();
  private readonly pips = new Graphics();
  private readonly initial: Text;
  private readonly label: Text;
  private art: Sprite | null = null;

  /** Lerp target in world px (remote motion smoothing, §11 ephemeral). */
  targetX = 0;
  targetY = 0;
  /** While the local user drags, position is pointer-driven — skip lerps. */
  localDrag = false;
  /** Squares across, for the stage's occluder window. */
  size = 1;

  private acting = false;
  private radius = 0;
  private key = '';
  private pulse = 0;
  private iso: boolean | null = null;
  private m: SceneMetrics | null = null;

  // The figure (isometric only).
  private look: FigureLook | null = null;
  /** The name the look was read from — "Troll Samurai" says what to draw. */
  private lookKey = '';
  private figureH = 0;
  private pose: FigurePose = 'stand';
  private bleeding = false;
  private facing = Math.PI / 4; // toward the viewer
  private phase = 0;
  private stride = 0;
  private stillFor = 0;
  private breath = Math.random() * Math.PI * 2;
  private lastX = 0;
  private lastY = 0;
  private facingSet = false;

  constructor() {
    this.initial = new Text({
      text: '',
      style: { fill: C.ink, fontSize: 18, fontWeight: '600', fontFamily: 'Inter, sans-serif' },
    });
    this.initial.anchor.set(0.5);
    this.label = new Text({
      text: '',
      style: {
        fill: C.ink,
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
        stroke: { color: C.ground, width: 3 },
      },
    });
    this.label.anchor.set(0.5, 0);
    this.ghost = new Graphics(this.figure.context);
    this.ghost.alpha = 0.38;
    this.ghost.visible = false;
    this.badge.addChild(this.body, this.initial);
    this.root.eventMode = 'none';
    this.overlay.eventMode = 'none';
  }

  /** Put each part in the container it belongs to for this projection. */
  private arrange(iso: boolean): void {
    this.iso = iso;
    this.root.removeChildren();
    this.overlay.removeChildren();
    if (iso) {
      this.root.addChild(this.aura, this.ring, this.figure);
      this.overlay.addChild(this.ghost, this.glow, this.badge, this.badgeRing, this.bars, this.pips, this.label);
    } else {
      this.badge.y = 0;
      this.root.addChild(this.aura, this.glow, this.badge, this.ring, this.bars, this.pips, this.label);
      this.root.zIndex = 0;
      this.overlay.zIndex = 0;
    }
    this.key = '';
  }

  /**
   * Attach loaded token art (async — the controller resolves the texture).
   *
   * REPLACES what is already there. It used to bail out if a sprite existed,
   * which was invisible while art was set once at token creation and wrong the
   * moment a portrait could change: the new texture loaded, arrived here, and
   * was dropped on the floor, so a player who uploaded a picture mid-session
   * watched their token keep the old one. Swapping the texture on the existing
   * sprite also keeps the child order and the mask, which re-adding would
   * disturb.
   */
  setTexture(texture: Texture): void {
    if (this.art) {
      if (this.art.texture !== texture) {
        this.art.texture = texture;
        this.fitArt();
      }
      return;
    }
    this.art = new Sprite(texture);
    this.art.anchor.set(0.5);
    this.art.mask = this.artMask;
    // Above the flat body circle, inside the badge.
    this.badge.addChild(this.artMask, this.art);
    this.initial.visible = false;
    this.fitArt();
  }

  /**
   * Drop the art and go back to the initial-letter circle.
   *
   * Needed because clearing a portrait is a real move — a player who removes
   * their picture, or a GM taking a disguise off a token. Without it the old
   * sprite stayed on screen until a reload, since the loader simply returns
   * early when there is no reference to load.
   */
  clearTexture(): void {
    if (!this.art) return;
    this.badge.removeChild(this.art);
    this.badge.removeChild(this.artMask);
    this.art.destroy();
    this.art = null;
    this.initial.visible = true;
  }

  private fitArt(): void {
    if (!this.art) return;
    const d = this.radius * 2;
    const tex = this.art.texture;
    const scale = d / Math.max(1, Math.min(tex.width, tex.height));
    this.art.scale.set(scale);
    this.artMask.clear();
    this.artMask.circle(0, 0, this.radius).fill(0xffffff);
  }

  update(token: Token, v: TokenVisual): void {
    const m = v.metrics;
    this.m = m;
    this.size = token.size;
    const iso = m.projection === 'iso';
    if (iso !== this.iso) this.arrange(iso);
    if (!this.facingSet) {
      this.facingSet = true;
      if (token.rotation) this.facing = (token.rotation * Math.PI) / 180;
    }
    const bars = v.bars;
    const down = downedBy(bars);
    const pose: FigurePose = down ? 'down' : (token.pose ?? 'stand');
    const H = iso ? figureHeightPx(m, token.size) : 0;
    // The SAME number the hit test uses (geometry.ts), because a disc drawn
    // one size and clicked at another is a token that ignores the GM. On the
    // isometric map the disc is the portrait badge over the figure's head.
    const radius = iso ? Math.max(7, Math.min(15, H * 0.3)) : tokenRadiusPx(m, token.size);
    const key = [
      token.name,
      token.size,
      token.source,
      token.hidden,
      token.aura ? `${token.aura.radiusM}:${token.aura.color ?? ''}` : '',
      v.selected,
      v.acting,
      v.ghosted,
      radius,
      pose,
      down,
      H,
      JSON.stringify(token.look ?? null),
      bars ? `${bars.physical?.filled}/${bars.physical?.max}:${bars.stun?.filled}/${bars.stun?.max}:${bars.effectCount}` : '',
    ].join('|');
    this.acting = v.acting;
    if (key === this.key) return;
    this.key = key;
    this.radius = radius;

    // The badge: the portrait, or the initial on the source colour.
    this.body.clear();
    this.body
      .circle(0, 0, radius)
      .fill({ color: SOURCE_COLORS[token.source] ?? C.raised, alpha: 1 })
      .stroke({ width: iso ? 1.5 : 2, color: v.ghosted ? C.magenta : C.edgeBright, alpha: 0.9 });
    this.fitArt();
    this.initial.text = (token.name[0] ?? '?').toUpperCase();
    this.initial.style.fontSize = Math.max(iso ? 8 : 12, radius * 0.9);

    // Aura ring (FR9.6): radius in meters → world px. An aura is a radius on
    // the FLOOR — a ring around the runner's feet, not a halo facing the
    // camera — so it projects like the floor does.
    this.aura.clear();
    if (token.aura) {
      const { rx, ry } = groundRadius(m, token.aura.radiusM / Math.max(0.01, m.unitM));
      const color = parseColor(token.aura.color, C.magenta);
      this.aura
        .ellipse(0, 0, rx, ry)
        .fill({ color, alpha: 0.07 })
        .stroke({ width: 1.5, color, alpha: 0.55 });
    }

    this.ring.clear();
    this.badgeRing.clear();
    this.glow.clear();
    let top: number; // the badge's centre, from the feet (iso) or the disc's centre (plan)
    if (iso) {
      const lookKey = `${token.id}|${token.source}|${token.name}|${JSON.stringify(token.look ?? null)}`;
      if (lookKey !== this.lookKey) {
        this.lookKey = lookKey;
        this.look = lookFor(token);
      }
      this.figureH = H;
      this.pose = pose;
      this.bleeding = down === 'physical';
      this.redrawFigure();
      top = -poseTop(pose, this.look!) * H - radius - 4;
      this.badge.y = top;
      // Selected: a ring on the floor round the feet, and round the badge.
      if (v.selected) {
        const { rx, ry } = groundRadius(m, 0.42 * Math.sqrt(token.size));
        this.ring.ellipse(0, 0, rx, ry).stroke({ width: 2, color: C.cyan, alpha: 0.9 });
        this.badgeRing.circle(0, top, radius + 2.5).stroke({ width: 1.5, color: C.cyan, alpha: 0.9 });
      }
      if (v.acting) this.glow.circle(0, top, radius + 5).stroke({ width: 2.5, color: C.warn, alpha: 0.9 });
    } else {
      top = 0;
      if (v.selected) this.ring.circle(0, 0, radius + 4).stroke({ width: 2, color: C.cyan, alpha: 0.9 });
      // Acting glow ring — pulsed in tick (FR9.10).
      if (v.acting) this.glow.circle(0, 0, radius + 7).stroke({ width: 3, color: C.warn, alpha: 0.9 });
    }
    this.glow.visible = v.acting;

    // Condition bars over the badge: physical on top, stun beneath (FR9.6).
    this.bars.clear();
    if (bars && (bars.physical || bars.stun)) {
      const half = iso ? Math.max(radius, 12) : radius;
      const w = half * 2;
      const h = iso ? 3 : 4;
      let y = top - radius - (iso ? 6 : 10) - (bars.physical && bars.stun ? h + 2 : 0);
      for (const mon of [bars.physical, bars.stun] as const) {
        if (!mon || mon.max <= 0) continue;
        const frac = Math.min(1, mon.filled / mon.max);
        this.bars.rect(-half, y, w, h).fill({ color: C.panel, alpha: 0.9 });
        if (frac > 0) this.bars.rect(-half, y, w * frac, h).fill({ color: barColor(frac), alpha: 1 });
        this.bars.rect(-half, y, w, h).stroke({ width: 1, color: C.edge, alpha: 1 });
        y += h + 2;
      }
    }

    // Status-effect pips along the top of the badge (FR4.7 sync).
    this.pips.clear();
    const pipCount = Math.min(6, bars?.effectCount ?? 0);
    const pipGap = iso ? 6 : 8;
    for (let i = 0; i < pipCount; i += 1) {
      this.pips
        .circle(radius - 4 - i * pipGap, top - radius - 2, iso ? 2.5 : 3)
        .fill({ color: C.magenta, alpha: 1 })
        .stroke({ width: 1, color: C.ground, alpha: 1 });
    }

    this.label.text = token.name;
    if (iso) {
      // Under the feet, clear of the floor ring.
      this.label.y = groundRadius(m, 0.42 * Math.sqrt(token.size)).ry + 2;
      this.label.style.fontSize = 10;
    } else {
      this.label.y = radius + 5;
      this.label.style.fontSize = 11;
    }

    this.root.alpha = v.ghosted ? 0.45 : 1;
    this.overlay.alpha = v.ghosted ? 0.45 : 1;
  }

  private redrawFigure(): void {
    if (!this.m || !this.look || this.figureH <= 0) return;
    drawFigure(
      this.figure,
      this.figureH,
      this.m.cell,
      { pose: this.pose, facing: this.facing, phase: this.phase, stride: this.stride, bleeding: this.bleeding },
      this.look,
      this.size,
    );
  }

  /** Where the figure stands now, in grid units — for the stage's occluders. */
  gridAt(): { x: number; y: number } | null {
    if (!this.m || !this.iso) return null;
    return gridFromWorld(this.m, { x: this.root.x, y: this.root.y });
  }

  /** Show the see-through copy: the stage found something standing in front. */
  setXray(on: boolean): void {
    this.ghost.visible = on && this.iso === true;
  }

  /** Per-frame: motion toward target, the walk, the breath, the acting pulse. */
  tick(deltaMS: number): void {
    const m = this.m;
    // A dragged figure still walks — to where the pointer has put it.
    if (!this.localDrag || this.iso) {
      if (this.iso && m) {
        // A figure walks there rather than sliding: a steady pace, quicker
        // over a long move so a dash across the map does not lag behind.
        const dx = this.targetX - this.root.x;
        const dy = this.targetY - this.root.y;
        const rem = Math.hypot(dx, dy);
        if (rem < 0.5) {
          this.root.x = this.targetX;
          this.root.y = this.targetY;
        } else {
          const axis = m.cell * Math.hypot(ISO_HALF_W, ISO_HALF_H);
          const pace = Math.max(axis * WALK_SQUARES_PER_S, rem * 2.2);
          const step = Math.min(rem, (pace * deltaMS) / 1000);
          this.root.x += (dx / rem) * step;
          this.root.y += (dy / rem) * step;
        }
      } else {
        const k = Math.min(1, deltaMS * 0.015);
        this.root.x += (this.targetX - this.root.x) * k;
        this.root.y += (this.targetY - this.root.y) * k;
      }
    }
    if (this.iso && m) this.animate(deltaMS, m);
    this.overlay.x = this.root.x;
    this.overlay.y = this.root.y;
    if (this.acting) {
      this.pulse += deltaMS * 0.005;
      this.glow.alpha = 0.55 + 0.45 * Math.sin(this.pulse);
    }
  }

  /**
   * The walk: read from how far the figure moved this frame, whoever moved
   * it — a remote token walking to its new square, the GM's own drag, a
   * player's. It faces the way it is going and keeps facing that way when
   * it stops.
   */
  private animate(deltaMS: number, m: SceneMetrics): void {
    const dx = this.root.x - this.lastX;
    const dy = this.root.y - this.lastY;
    this.lastX = this.root.x;
    this.lastY = this.root.y;
    const hw = m.cell * ISO_HALF_W;
    const hh = m.cell * ISO_HALF_H;
    const gx = (dx / hw + dy / hh) / 2;
    const gy = (dy / hh - dx / hw) / 2;
    const moved = Math.hypot(gx, gy);
    let dirty = false;
    if (moved > 1e-4 && this.pose !== 'down') {
      const want = Math.atan2(gy, gx);
      let turn = want - this.facing;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const maxTurn = deltaMS * 0.014;
      this.facing += Math.max(-maxTurn, Math.min(maxTurn, turn));
      const bodyGrid = (0.9 * this.figureH) / (m.cell * Math.hypot(ISO_HALF_W, ISO_HALF_H));
      this.phase += (moved / Math.max(0.05, STEP_BODY * bodyGrid)) * Math.PI;
      this.stride = Math.min(1, this.stride + deltaMS * 0.008);
      this.stillFor = 0;
      dirty = true;
      const at = gridFromWorld(m, { x: this.root.x, y: this.root.y });
      this.root.zIndex = at.x + at.y;
      this.overlay.zIndex = this.root.zIndex;
    } else if (this.stride > 0) {
      // A drag's pointer events come slower than frames: a frame without
      // motion is not yet a figure that has stopped.
      this.stillFor += deltaMS;
      if (this.stillFor > 90) {
        this.stride = Math.max(0, this.stride - deltaMS * 0.006);
        if (this.stride === 0) this.phase = 0;
        dirty = true;
      }
    }
    if (dirty) this.redrawFigure();
    // Breathing: a standing figure is never quite a statue.
    this.breath += deltaMS * 0.0025;
    const sway = this.pose === 'stand' && this.stride === 0 ? 1 + 0.012 * Math.sin(this.breath) : 1;
    this.figure.scale.y = sway;
    this.ghost.scale.y = sway;
  }

  /**
   * Go straight to a world position. A jump (creation, a drop, a floor below
   * redrawn) arrives standing still; `walk` — the pointer dragging it — is
   * motion the figure walks with, like any other.
   */
  place(x: number, y: number, walk = false): void {
    if (walk && this.iso) {
      // A snapped drag moves a square at a time; the figure walks after it.
      this.targetX = x;
      this.targetY = y;
      return;
    }
    this.targetX = x;
    this.targetY = y;
    this.root.x = x;
    this.root.y = y;
    this.overlay.x = x;
    this.overlay.y = y;
    if (!walk) {
      this.lastX = x;
      this.lastY = y;
    }
    if (this.m && this.iso) {
      const at = gridFromWorld(this.m, { x, y });
      this.root.zIndex = at.x + at.y;
      this.overlay.zIndex = this.root.zIndex;
    }
  }

  destroy(): void {
    // The overlay first: its see-through copy borrows the figure's drawing,
    // which goes with the figure.
    this.overlay.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}
