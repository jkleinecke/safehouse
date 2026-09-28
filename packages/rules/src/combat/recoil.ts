/**
 * Recoil (SR5 p.175-176) and the rounds a fire mode spends (p.180): the one
 * copy of these rules the sheet's weapon card, the GM's quick-roll rack and
 * the resolved attack chain all read.
 *
 * They used to live twice. The sheet had the book's sum — one free point,
 * Strength ÷ 3 rounded up, the gun's own compensation — while the copilot
 * kept a shorter one of its own that left Strength out and fired two rounds
 * in semi-auto. Semi-auto is one round a trigger pull; three is the
 * Semi-Auto Burst, a Complex Action of its own (p.179-180). Both now come
 * from here, and the rounds come from the action catalogue's Firing Mode
 * Table entries rather than a table of their own.
 *
 * Pure functions: no dice, no sheet reads. The caller says how many rounds
 * this character has already put downrange this turn, when it knows
 * (progressive recoil, p.175); the rack and the chain do not track that yet,
 * so they pass nothing and the GM edits the line when a second burst follows
 * the first.
 */
import type { ProvenanceEntry } from '@safehouse/contracts';
import { lineRef } from '../refs.js';
import { FIRE_MODE_ACTIONS, combatAction, fireModesOf, type FireModeCode } from './actions.js';

/**
 * Recoil compensation as the book totals it (p.175): one free point whenever
 * the shooter starts firing, Strength ÷ 3 rounded up, and the recoil
 * compensation of the gun in hand. Recoil belongs to the shooter, not the
 * gun (p.176), which is why Strength is part of the sum.
 */
export function recoilCompensation(recoilComp: number, strength: number): number {
  return 1 + Math.ceil(Math.max(0, strength) / 3) + Math.max(0, recoilComp);
}

/**
 * The recoil penalty (0 or less) for firing `bullets` more rounds after
 * `firedSoFar` this turn: compensation minus every round fired, when that
 * comes out below zero (p.175). Rounds add up across Action Phases until the
 * shooter takes a Simple or Complex Action that is not a shot (progressive
 * recoil, p.175).
 */
export function recoilPenalty(firedSoFar: number, bullets: number, recoilComp: number, strength = 0): number {
  const total = Math.max(0, firedSoFar) + Math.max(0, bullets);
  const uncompensated = Math.max(0, total - recoilCompensation(recoilComp, strength));
  return uncompensated === 0 ? 0 : -uncompensated; // never -0
}

/** The first fire mode a hand-typed mode string names ('SA', 'sa/bf', 'BF FA'), or null. */
function modeCode(mode: string | null | undefined): FireModeCode | null {
  if (!mode) return null;
  return fireModesOf([mode])[0] ?? null;
}

/**
 * Rounds one trigger pull in this mode spends, read off the Firing Mode Table
 * (p.180) through the action catalogue: the mode's Simple Action. Single
 * shot and semi-auto are one round, a burst three, short full-auto six. The
 * Complex versions — the Semi-Auto Burst's three, the Long Burst's six, the
 * long full-auto burst's ten — are separate actions with their own `rounds`;
 * a caller that knows which action was taken passes those instead. An
 * unknown mode is one round.
 */
export function bulletsForMode(mode: string | null | undefined): number {
  const code = modeCode(mode);
  if (!code) return 1;
  const first = FIRE_MODE_ACTIONS[code][0];
  return (first ? combatAction(first)?.rounds : undefined) ?? 1;
}

export interface RecoilLineOptions {
  /** The fire mode the rounds go out in. Single shot never recoils (p.176, and "No Recoil" on the p.180 table). */
  mode?: string | null;
  /** Rounds this attack fires. */
  bullets: number;
  /** Rounds already fired this turn without a break (progressive recoil, p.175). */
  firedSoFar?: number;
  /** The gun's own recoil compensation. */
  recoilComp?: number;
  /** The shooter's Strength. */
  strength?: number;
}

/**
 * The recoil line for an attack's receipt, with its page, or null when the
 * shooter's compensation covers every round (or the gun fires single shot).
 * The label says what was weighed: `recoil (3 rounds vs RC 2)`.
 */
export function recoilLine(opts: RecoilLineOptions): ProvenanceEntry | null {
  if (modeCode(opts.mode) === 'SS') return null;
  const firedSoFar = Math.max(0, opts.firedSoFar ?? 0);
  const recoilComp = opts.recoilComp ?? 0;
  const strength = opts.strength ?? 0;
  const value = recoilPenalty(firedSoFar, opts.bullets, recoilComp, strength);
  if (value === 0) return null;
  const rounds = firedSoFar + Math.max(0, opts.bullets);
  return {
    label: `recoil (${rounds} rounds vs RC ${recoilCompensation(recoilComp, strength)})`,
    value,
    source: 'situational',
    ref: lineRef('recoil'),
  };
}
