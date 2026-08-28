import { describe, expect, it } from 'vitest';
import { applyDamage, computeWoundModifier, damageCombatant, healDamage } from '../src/index.js';
import { combatant, monitors } from './combat-helpers.js';

describe('computeWoundModifier (§10.2)', () => {
  it('is -1 per 3 filled boxes, cumulative across monitors', () => {
    expect(computeWoundModifier(monitors())).toBe(0);
    expect(computeWoundModifier(monitors({ physical: { filled: 2 } }))).toBe(0);
    expect(computeWoundModifier(monitors({ physical: { filled: 3 } }))).toBe(-1);
    expect(computeWoundModifier(monitors({ physical: { filled: 9 } }))).toBe(-3);
    expect(computeWoundModifier(monitors({ physical: { filled: 4 }, stun: { filled: 6 } }))).toBe(-3);
  });

  it('pain tolerance ignores boxes per monitor', () => {
    expect(computeWoundModifier(monitors({ physical: { filled: 4 } }), 3)).toBe(0);
    expect(computeWoundModifier(monitors({ physical: { filled: 6 }, stun: { filled: 3 } }), 3)).toBe(-1);
  });
});

describe('applyDamage (FR4.5)', () => {
  it('fills the target monitor and reports the wound delta', () => {
    const r = applyDamage(monitors(), 4, 'stun');
    expect(r.monitors.stun.filled).toBe(4);
    expect(r.applied).toEqual({ physical: 0, stun: 4, overflow: 0 });
    expect(r.woundModifier).toEqual({ before: 0, after: -1, delta: -1 });
    expect(r.unconscious).toBe(false);
    expect(r.dead).toBe(false);
  });

  it('propagates worsening wounds across applications', () => {
    const first = applyDamage(monitors(), 5, 'physical');
    expect(first.woundModifier.after).toBe(-1);
    const second = applyDamage(first.monitors, 4, 'physical');
    expect(second.monitors.physical.filled).toBe(9);
    expect(second.woundModifier).toEqual({ before: -1, after: -3, delta: -2 });
  });

  it('does not mutate the input state', () => {
    const m = monitors();
    applyDamage(m, 6, 'physical');
    expect(m.physical.filled).toBe(0);
  });

  it('spills excess stun into physical at 2:1 (§10.2)', () => {
    const r = applyDamage(monitors({ stun: { filled: 8 } }), 6, 'stun');
    expect(r.monitors.stun.filled).toBe(10);
    expect(r.stunSpill).toBe(2);
    expect(r.monitors.physical.filled).toBe(2);
    expect(r.lost).toBe(0);
    expect(r.unconscious).toBe(true);
  });

  it('an odd leftover excess stun box is lost, not spilled', () => {
    const r = applyDamage(monitors({ stun: { filled: 8 } }), 7, 'stun');
    expect(r.stunSpill).toBe(2);
    expect(r.monitors.physical.filled).toBe(2);
    expect(r.lost).toBe(1);
  });

  it('stun spill can cascade through physical into overflow', () => {
    const state = monitors({ stun: { filled: 10 }, physical: { filled: 9 } });
    const r = applyDamage(state, 6, 'stun'); // 3 spill: 1 fills physical, 2 overflow
    expect(r.monitors.physical.filled).toBe(10);
    expect(r.monitors.overflow.filled).toBe(2);
    expect(r.down).toBe(true);
    expect(r.dead).toBe(false);
  });

  it('physical overflow fills up to BOD, then death', () => {
    const nearlyDown = applyDamage(monitors({ physical: { filled: 9 } }), 4, 'physical');
    expect(nearlyDown.monitors.physical.filled).toBe(10);
    expect(nearlyDown.monitors.overflow.filled).toBe(3);
    expect(nearlyDown.down).toBe(true);
    expect(nearlyDown.dead).toBe(false);

    const fatal = applyDamage(nearlyDown.monitors, 2, 'physical');
    expect(fatal.monitors.overflow.filled).toBe(4); // overflow max = BOD 4
    expect(fatal.lost).toBe(1);
    expect(fatal.dead).toBe(true);
  });
});

describe('damageCombatant', () => {
  it('propagates the wound delta into the initiative score (FR4.5)', () => {
    const c = combatant({ initScore: 14 });
    const { combatant: after, result } = damageCombatant(c, 6, 'physical');
    expect(result.woundModifier.delta).toBe(-2);
    expect(after.initScore).toBe(12);
    expect(after.monitors.physical.filled).toBe(6);
    expect(c.monitors.physical.filled).toBe(0); // pure
  });
});

describe('healDamage', () => {
  it('empties overflow before the physical track and reports the delta', () => {
    const state = monitors({ physical: { filled: 10 }, overflow: { filled: 2 } });
    const { monitors: healed, woundModifier } = healDamage(state, 4, 'physical');
    expect(healed.overflow.filled).toBe(0);
    expect(healed.physical.filled).toBe(8);
    expect(woundModifier.delta).toBe(1); // -3 -> -2
  });
});
