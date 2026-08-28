import type { Combatant, CombatantMonitors } from '@safehouse/contracts';

/** Which condition monitor a damage application targets. */
export type DamageTrack = 'physical' | 'stun';

export interface DamageOptions {
  /**
   * Boxes ignored per monitor when computing the wound modifier
   * (e.g. a pain-tolerance quality). GM-editable, defaults to 0.
   */
  painTolerance?: number;
}

/** Everything one damage application changed — the FR4.5 receipt. */
export interface DamageResult {
  /** New monitor state (input state is never mutated). */
  monitors: CombatantMonitors;
  /** Boxes that actually landed on each monitor. */
  applied: { physical: number; stun: number; overflow: number };
  /** Stun boxes past the full track that rolled into physical (2 excess : 1 box). */
  stunSpill: number;
  /** Boxes lost entirely (an odd leftover stun box, or damage past overflow). */
  lost: number;
  /** Wound modifier (negative) before/after, and the delta for pools + init score. */
  woundModifier: { before: number; after: number; delta: number };
  /** Stun track full. */
  unconscious: boolean;
  /** Physical track full (into overflow / dying). */
  down: boolean;
  /** Damage exceeded the overflow monitor. */
  dead: boolean;
}

/**
 * Wound modifier per §10.2: −1 per 3 filled boxes per monitor, cumulative
 * across the physical and stun tracks. Overflow never adds wound modifiers.
 */
export function computeWoundModifier(monitors: CombatantMonitors, painTolerance = 0): number {
  const pt = Math.max(0, painTolerance);
  const physical = Math.max(0, monitors.physical.filled - pt);
  const stun = Math.max(0, monitors.stun.filled - pt);
  // `|| 0` normalizes -0 when no boxes are filled.
  return -(Math.floor(physical / 3) + Math.floor(stun / 3)) || 0;
}

/**
 * Apply `boxes` of damage to `track` per FR4.5 / §10.2:
 * stun past a full stun track spills into physical at 2:1; physical past a
 * full physical track fills overflow up to its max (BOD); past that is death.
 * Returns the new monitors plus the wound-modifier delta to apply to the
 * combatant's pools and Initiative Score. Pure — `state` is not mutated.
 */
export function applyDamage(
  state: CombatantMonitors,
  boxes: number,
  track: DamageTrack,
  opts: DamageOptions = {},
): DamageResult {
  const before = computeWoundModifier(state, opts.painTolerance);
  const monitors: CombatantMonitors = {
    physical: { ...state.physical },
    stun: { ...state.stun },
    overflow: { ...state.overflow },
  };
  const applied = { physical: 0, stun: 0, overflow: 0 };
  let stunSpill = 0;
  let lost = 0;
  let dead = false;
  let remaining = Math.max(0, Math.floor(boxes));

  if (track === 'stun') {
    const room = Math.max(0, monitors.stun.max - monitors.stun.filled);
    applied.stun = Math.min(remaining, room);
    monitors.stun.filled += applied.stun;
    const excess = remaining - applied.stun;
    stunSpill = Math.floor(excess / 2);
    lost += excess % 2; // spilling takes two full excess boxes per physical box
    remaining = stunSpill;
  }

  if (track === 'physical' || stunSpill > 0) {
    const room = Math.max(0, monitors.physical.max - monitors.physical.filled);
    applied.physical = Math.min(remaining, room);
    monitors.physical.filled += applied.physical;
    const excess = remaining - applied.physical;
    if (excess > 0) {
      const overflowRoom = Math.max(0, monitors.overflow.max - monitors.overflow.filled);
      applied.overflow = Math.min(excess, overflowRoom);
      monitors.overflow.filled += applied.overflow;
      const pastOverflow = excess - applied.overflow;
      if (pastOverflow > 0) {
        lost += pastOverflow;
        dead = true;
      }
    }
  }

  const after = computeWoundModifier(monitors, opts.painTolerance);
  return {
    monitors,
    applied,
    stunSpill,
    lost,
    woundModifier: { before, after, delta: after - before },
    unconscious: monitors.stun.max > 0 && monitors.stun.filled >= monitors.stun.max,
    down: monitors.physical.max > 0 && monitors.physical.filled >= monitors.physical.max,
    dead,
  };
}

/**
 * Convenience wrapper: apply damage to a combatant row, returning the updated
 * combatant (monitors replaced, Initiative Score shifted by the wound delta —
 * FR4.5 "wound modifiers recompute and propagate") plus the full receipt.
 */
export function damageCombatant(
  combatant: Combatant,
  boxes: number,
  track: DamageTrack,
  opts: DamageOptions = {},
): { combatant: Combatant; result: DamageResult } {
  const result = applyDamage(combatant.monitors, boxes, track, opts);
  return {
    combatant: {
      ...combatant,
      monitors: result.monitors,
      initScore: combatant.initScore + result.woundModifier.delta,
    },
    result,
  };
}

/**
 * Remove healed boxes from a track (overflow empties before physical).
 * Returns new monitors and the wound-modifier delta (positive when improving).
 */
export function healDamage(
  state: CombatantMonitors,
  boxes: number,
  track: DamageTrack,
  opts: DamageOptions = {},
): { monitors: CombatantMonitors; woundModifier: { before: number; after: number; delta: number } } {
  const before = computeWoundModifier(state, opts.painTolerance);
  const monitors: CombatantMonitors = {
    physical: { ...state.physical },
    stun: { ...state.stun },
    overflow: { ...state.overflow },
  };
  let remaining = Math.max(0, Math.floor(boxes));
  if (track === 'physical') {
    const fromOverflow = Math.min(remaining, monitors.overflow.filled);
    monitors.overflow.filled -= fromOverflow;
    remaining -= fromOverflow;
    monitors.physical.filled = Math.max(0, monitors.physical.filled - remaining);
  } else {
    monitors.stun.filled = Math.max(0, monitors.stun.filled - remaining);
  }
  const after = computeWoundModifier(monitors, opts.painTolerance);
  return { monitors, woundModifier: { before, after, delta: after - before } };
}
