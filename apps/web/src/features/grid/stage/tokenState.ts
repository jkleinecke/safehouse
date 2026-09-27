/**
 * What a token's plate and figure say, read from the token and its bars —
 * pure, no three, no DOM.
 *
 * The map's plates (`stage3d/badges.ts`), its top-down portraits
 * (`stage3d/portraits.ts`) and its figure pool (`stage3d/figures.ts`) each
 * draw these answers their own way. Keeping the rules here is what keeps them
 * from disagreeing about when a runner is down, what colour a bar turns, or
 * how many pips a badge carries. (Until P5 the 2D map's `TokenView` read them
 * too.)
 */
import type { Token } from '@safehouse/contracts';
import type { TokenBars } from '../types.js';
import { C } from './colors.js';
import type { FigurePose } from '../plan/figure.js';

/** The badge colour behind a token's initial, by where the token came from. */
export const SOURCE_COLORS: Record<Token['source'], number> = {
  character: 0x1c4d5e,
  combatant: 0x5e1c39,
  npc_template: 0x4d3a1c,
  prop: 0x2a3242,
};

/** A condition bar's colour at `frac` full: green, amber from half, red from 85%. */
export function barColor(frac: number): number {
  if (frac >= 0.85) return C.danger;
  if (frac >= 0.5) return C.warn;
  return C.ok;
}

/** How full a condition monitor is, 0..1. The caller skips a monitor with no boxes. */
export function monitorFill(mon: { filled: number; max: number }): number {
  return Math.min(1, mon.filled / mon.max);
}

/** A full monitor puts the figure on the floor; physical damage bleeds. */
export function downedBy(bars: TokenBars | null): 'physical' | 'stun' | null {
  if (bars?.physical && bars.physical.max > 0 && bars.physical.filled >= bars.physical.max) return 'physical';
  if (bars?.stun && bars.stun.max > 0 && bars.stun.filled >= bars.stun.max) return 'stun';
  return null;
}

/** The pose a figure is drawn in: down when a monitor is full, else the token's own. */
export function tokenPose(token: Pick<Token, 'pose'>, down: 'physical' | 'stun' | null): FigurePose {
  return down ? 'down' : (token.pose ?? 'stand');
}

/** The letter on a badge with no portrait. */
export function tokenInitial(name: string): string {
  return (name[0] ?? '?').toUpperCase();
}

/** The most status-effect pips a badge shows; more effects than this still show six. */
export const MAX_PIPS = 6;

/** How many status-effect pips the badge carries (FR4.7 sync). */
export function pipCount(bars: TokenBars | null): number {
  return Math.min(MAX_PIPS, bars?.effectCount ?? 0);
}

/** The bars as a redraw-key fragment: any box filled or cleared, or an effect gained, redraws. */
export function barsKey(bars: TokenBars | null): string {
  return bars ? `${bars.physical?.filled}/${bars.physical?.max}:${bars.stun?.filled}/${bars.stun?.max}:${bars.effectCount}` : '';
}

/** Grid units a figure covers in one walking step — a full cycle is two. */
export const STEP_BODY = 0.5;
/** A remote token walks at least this many squares a second, faster over a long move. */
export const WALK_SQUARES_PER_S = 1.8;
