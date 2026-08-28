import type { Combatant, InitKind } from '@safehouse/contracts';
import { computeWoundModifier } from './damage.js';

/** SR5 hard cap on initiative dice (§10.2, FR4.2). */
export const MAX_INIT_DICE = 5;

/** One initiative roll's receipt (FR4.2), plus the updated combatant row. */
export interface InitiativeRollDetail {
  kind: InitKind;
  base: number;
  dice: number;
  rolls: number[];
  /** Wound modifier applied to the score (negative or 0). */
  woundModifier: number;
  score: number;
  /** Copy of the input combatant with `initScore`/`initKind` set, `actedThisPass` reset. */
  combatant: Combatant;
}

export interface RollInitiativeOptions {
  /** Override the base (e.g. hand-entered or a derived line for another kind). */
  base?: number;
  /** Override the dice count (still capped at 5). */
  dice?: number;
  /** Override the wound modifier instead of deriving it from the monitors. */
  woundModifier?: number;
}

/**
 * Roll a combatant's initiative (FR4.2): `initBase` + `initDice`d6, wound
 * modifier applied to the score. `kind` defaults to the combatant's own
 * `initKind`; when rolling a different kind, pass the matching derived line
 * via `opts.base`/`opts.dice` (the combatant row only stores one line).
 */
export function rollInitiative(
  combatant: Combatant,
  kind?: InitKind,
  rng: () => number = Math.random,
  opts: RollInitiativeOptions = {},
): InitiativeRollDetail {
  const resolvedKind = kind ?? combatant.initKind;
  const base = opts.base ?? combatant.initBase;
  const dice = Math.min(MAX_INIT_DICE, Math.max(0, Math.floor(opts.dice ?? combatant.initDice)));
  const rolls: number[] = [];
  for (let i = 0; i < dice; i += 1) {
    rolls.push(1 + Math.floor(rng() * 6));
  }
  const woundModifier = opts.woundModifier ?? computeWoundModifier(combatant.monitors);
  const score = base + rolls.reduce((sum, r) => sum + r, 0) + woundModifier;
  return {
    kind: resolvedKind,
    base,
    dice,
    rolls,
    woundModifier,
    score,
    combatant: {
      ...combatant,
      initKind: resolvedKind,
      initScore: score,
      actedThisPass: false,
    },
  };
}

/**
 * Acting order for the current pass (FR4.3): everyone with a score above 0,
 * descending. Ties break by higher `initBase` (the closest stand-in for the
 * ERIC chain without full attributes), then by id for stability.
 */
export function turnOrder(combatants: Combatant[]): Combatant[] {
  return combatants
    .filter((c) => c.initScore > 0)
    .sort((a, b) => b.initScore - a.initScore || b.initBase - a.initBase || (a.id < b.id ? -1 : 1));
}

/** The next combatant to act this pass, or null when the pass is spent. */
export function nextActor(combatants: Combatant[]): Combatant | null {
  return turnOrder(combatants).find((c) => !c.actedThisPass) ?? null;
}

/** Mark a combatant as having acted in the current pass. */
export function markActed(combatant: Combatant): Combatant {
  return { ...combatant, actedThisPass: true };
}

/**
 * End of pass (FR4.3): every score drops by 10 (floored at 0) and
 * `actedThisPass` resets. Anyone still above 0 acts again next pass.
 */
export function advancePass(combatants: Combatant[]): Combatant[] {
  return combatants.map((c) => ({
    ...c,
    initScore: Math.max(0, c.initScore - 10),
    actedThisPass: false,
  }));
}

/** True while anyone still has a score above 0 — run another pass, else new turn. */
export function anyActiveScores(combatants: Combatant[]): boolean {
  return combatants.some((c) => c.initScore > 0);
}

/** New combat turn: every combatant re-rolls initiative (FR4.3). */
export function beginTurn(
  combatants: Combatant[],
  rng: () => number = Math.random,
): { combatants: Combatant[]; rolls: InitiativeRollDetail[] } {
  const rolls = combatants.map((c) => rollInitiative(c, undefined, rng));
  return { combatants: rolls.map((r) => r.combatant), rolls };
}

/** An interrupt action and its Initiative Score cost (FR4.4). */
export interface InterruptAction {
  id: string;
  name: string;
  /** Positive number of points deducted from the current score. */
  cost: number;
}

/**
 * Default interrupt cost table (FR4.4) — fully editable per campaign; the UI
 * copies it into campaign settings rather than importing it as law.
 */
export const DEFAULT_INTERRUPTS: readonly InterruptAction[] = [
  { id: 'full_defense', name: 'Full Defense', cost: 10 },
  { id: 'dodge', name: 'Dodge', cost: 5 },
  { id: 'block', name: 'Block', cost: 5 },
  { id: 'parry', name: 'Parry', cost: 5 },
  { id: 'intercept', name: 'Intercept', cost: 5 },
  { id: 'hit_the_dirt', name: 'Hit the Dirt', cost: 5 },
];

/** Soft guard for the UI: does the combatant have the score to pay full price? */
export function canInterrupt(combatant: Combatant, action: number | InterruptAction): boolean {
  const cost = Math.abs(typeof action === 'number' ? action : action.cost);
  return combatant.initScore >= cost;
}

/**
 * Apply an interrupt's cost immediately (FR4.4). The score may drop to or
 * below 0 — the combatant then acts no further this turn (GM's call to allow;
 * `canInterrupt` is the soft check).
 */
export function applyInterrupt(combatant: Combatant, action: number | InterruptAction): Combatant {
  const cost = Math.abs(typeof action === 'number' ? action : action.cost);
  return { ...combatant, initScore: combatant.initScore - cost };
}
