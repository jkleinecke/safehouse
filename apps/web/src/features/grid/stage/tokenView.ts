/**
 * TokenView — one pooled pixi display object per token (FR9.4/9.6).
 * Circle (or art sprite in a circular mask) + name label + condition bars +
 * status pips + aura ring + selection ring + acting-combatant glow.
 * Redraws only when its visual key changes; per-frame work is limited to the
 * lerp/pulse in `tick` (no allocations).
 */
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Token } from '@safehouse/contracts';
import type { TokenBars } from '../types.js';
import { groundRadius, tokenRadiusPx, type SceneMetrics } from '../geometry.js';
import { C, parseColor } from './colors.js';

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

export class TokenView {
  readonly root = new Container();
  private readonly aura = new Graphics();
  private readonly glow = new Graphics();
  private readonly body = new Graphics();
  private readonly artMask = new Graphics();
  private readonly ring = new Graphics();
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

  private acting = false;
  private radius = 0;
  private key = '';
  private pulse = 0;

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
    this.root.addChild(this.aura, this.glow, this.body, this.initial, this.ring, this.bars, this.pips, this.label);
    this.root.eventMode = 'none';
  }

  /** Attach loaded token art (async — controller resolves the texture). */
  setTexture(texture: Texture): void {
    if (this.art) return;
    this.art = new Sprite(texture);
    this.art.anchor.set(0.5);
    this.art.mask = this.artMask;
    // Behind the ring/bars, above the flat body circle.
    const bodyIndex = this.root.getChildIndex(this.body);
    this.root.addChildAt(this.artMask, bodyIndex + 1);
    this.root.addChildAt(this.art, bodyIndex + 1);
    this.initial.visible = false;
    this.fitArt();
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
    // The SAME number the hit test uses (geometry.ts), because a disc drawn
    // one size and clicked at another is a token that ignores the GM.
    const radius = tokenRadiusPx(v.metrics, token.size);
    const bars = v.bars;
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
      bars ? `${bars.physical?.filled}/${bars.physical?.max}:${bars.stun?.filled}/${bars.stun?.max}:${bars.effectCount}` : '',
    ].join('|');
    this.acting = v.acting;
    if (key === this.key) return;
    this.key = key;
    this.radius = radius;

    // Body circle (silhouette fallback when there is no art).
    this.body.clear();
    this.body
      .circle(0, 0, radius)
      .fill({ color: SOURCE_COLORS[token.source] ?? C.raised, alpha: 1 })
      .stroke({ width: 2, color: v.ghosted ? C.magenta : C.edgeBright, alpha: 0.9 });
    this.fitArt();

    this.initial.text = (token.name[0] ?? '?').toUpperCase();
    this.initial.style.fontSize = Math.max(12, radius * 0.9);

    // Selection ring.
    this.ring.clear();
    if (v.selected) {
      this.ring.circle(0, 0, radius + 4).stroke({ width: 2, color: C.cyan, alpha: 0.9 });
    }

    // Acting glow ring — pulsed in tick (FR9.10).
    this.glow.clear();
    if (v.acting) {
      this.glow.circle(0, 0, radius + 7).stroke({ width: 3, color: C.warn, alpha: 0.9 });
    }
    this.glow.visible = v.acting;

    // Aura ring (FR9.6): radius in meters → world px.
    this.aura.clear();
    if (token.aura) {
      // An aura is a radius on the FLOOR — a ring around the runner's feet, not
      // a halo facing the camera — so it projects like the floor does. Drawn as
      // a screen circle it reached 1.4x too far across and 2.8x too far into
      // the scene, which for a 6 m aura is several cells of lie.
      const { rx, ry } = groundRadius(v.metrics, token.aura.radiusM / Math.max(0.01, v.metrics.unitM));
      const color = parseColor(token.aura.color, C.magenta);
      this.aura
        .ellipse(0, 0, rx, ry)
        .fill({ color, alpha: 0.07 })
        .stroke({ width: 1.5, color, alpha: 0.55 });
    }

    // Condition bars: physical on top, stun beneath (FR9.6).
    this.bars.clear();
    if (bars && (bars.physical || bars.stun)) {
      const w = radius * 2;
      let y = -radius - 10;
      for (const mon of [bars.physical, bars.stun] as const) {
        if (!mon || mon.max <= 0) continue;
        const frac = Math.min(1, mon.filled / mon.max);
        this.bars.rect(-radius, y, w, 4).fill({ color: C.panel, alpha: 0.9 });
        if (frac > 0) this.bars.rect(-radius, y, w * frac, 4).fill({ color: barColor(frac), alpha: 1 });
        this.bars.rect(-radius, y, w, 4).stroke({ width: 1, color: C.edge, alpha: 1 });
        y += 6;
      }
    }

    // Status-effect pips along the top-right arc (FR4.7 sync).
    this.pips.clear();
    const pipCount = Math.min(6, bars?.effectCount ?? 0);
    for (let i = 0; i < pipCount; i += 1) {
      this.pips
        .circle(radius - 4 - i * 8, -radius - 2, 3)
        .fill({ color: C.magenta, alpha: 1 })
        .stroke({ width: 1, color: C.ground, alpha: 1 });
    }

    this.label.text = token.name;
    this.label.y = radius + 5;

    this.root.alpha = v.ghosted ? 0.45 : 1;
  }

  /** Per-frame: motion smoothing toward target + acting pulse. */
  tick(deltaMS: number): void {
    if (!this.localDrag) {
      const k = Math.min(1, deltaMS * 0.015);
      this.root.x += (this.targetX - this.root.x) * k;
      this.root.y += (this.targetY - this.root.y) * k;
    }
    if (this.acting) {
      this.pulse += deltaMS * 0.005;
      this.glow.alpha = 0.55 + 0.45 * Math.sin(this.pulse);
    }
  }

  /** Jump straight to a world position (creation, local drop). */
  place(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.root.x = x;
    this.root.y = y;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
