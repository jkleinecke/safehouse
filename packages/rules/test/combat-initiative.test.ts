import { describe, expect, it } from 'vitest';
import {
  advancePass,
  anyActiveScores,
  applyInterrupt,
  beginTurn,
  canInterrupt,
  DEFAULT_INTERRUPTS,
  markActed,
  nextActor,
  rollInitiative,
  turnOrder,
} from '../src/index.js';
import { combatant, monitors, mulberry32 } from './combat-helpers.js';

describe('rollInitiative (FR4.2)', () => {
  it('scores base + Nd6 with the roll receipt', () => {
    const c = combatant({ initBase: 9, initDice: 3 });
    const detail = rollInitiative(c, undefined, mulberry32(1));
    expect(detail.rolls).toHaveLength(3);
    for (const r of detail.rolls) expect(r).toBeGreaterThanOrEqual(1);
    for (const r of detail.rolls) expect(r).toBeLessThanOrEqual(6);
    const sum = detail.rolls.reduce((a, b) => a + b, 0);
    expect(detail.score).toBe(9 + sum);
    expect(detail.combatant.initScore).toBe(detail.score);
    expect(detail.combatant.actedThisPass).toBe(false);
  });

  it('is deterministic for a fixed seed', () => {
    const c = combatant({ initBase: 7, initDice: 2 });
    const a = rollInitiative(c, undefined, mulberry32(42));
    const b = rollInitiative(c, undefined, mulberry32(42));
    expect(a.rolls).toEqual(b.rolls);
    expect(a.score).toBe(b.score);
  });

  it('caps initiative dice at 5', () => {
    const c = combatant({ initBase: 10, initDice: 2 });
    const detail = rollInitiative(c, undefined, mulberry32(3), { dice: 9 });
    expect(detail.dice).toBe(5);
    expect(detail.rolls).toHaveLength(5);
  });

  it('applies the wound modifier to the score (§10.2)', () => {
    const c = combatant({
      initBase: 8,
      initDice: 1,
      monitors: monitors({ physical: { filled: 4 }, stun: { filled: 3 } }),
    });
    const detail = rollInitiative(c, undefined, mulberry32(5));
    expect(detail.woundModifier).toBe(-2); // -1 per 3 boxes per track
    const sum = detail.rolls.reduce((a, b) => a + b, 0);
    expect(detail.score).toBe(8 + sum - 2);
  });

  it('honors kind + line overrides for variant initiative', () => {
    const c = combatant({ initBase: 8, initDice: 1, initKind: 'physical' });
    const detail = rollInitiative(c, 'astral', mulberry32(7), { base: 10, dice: 2 });
    expect(detail.kind).toBe('astral');
    expect(detail.rolls).toHaveLength(2);
    expect(detail.combatant.initKind).toBe('astral');
  });
});

describe('the FR4.3 turn loop', () => {
  it('scores 23/15/8 act 3/2/1 times over 3 passes, then the turn ends', () => {
    let roster = [
      combatant({ id: 'a', name: 'A', initScore: 23 }),
      combatant({ id: 'b', name: 'B', initScore: 15 }),
      combatant({ id: 'c', name: 'C', initScore: 8 }),
    ];
    const acts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let passes = 0;

    while (anyActiveScores(roster)) {
      passes += 1;
      for (let actor = nextActor(roster); actor; actor = nextActor(roster)) {
        acts[actor.id] = (acts[actor.id] ?? 0) + 1;
        const marked = markActed(actor);
        roster = roster.map((c) => (c.id === marked.id ? marked : c));
      }
      roster = advancePass(roster);
    }

    expect(acts).toEqual({ a: 3, b: 2, c: 1 });
    expect(passes).toBe(3);
    expect(anyActiveScores(roster)).toBe(false);
  });

  it('acts in descending score order within a pass', () => {
    const roster = [
      combatant({ id: 'slow', initScore: 8 }),
      combatant({ id: 'fast', initScore: 23 }),
      combatant({ id: 'mid', initScore: 15 }),
      combatant({ id: 'out', initScore: 0 }),
    ];
    expect(turnOrder(roster).map((c) => c.id)).toEqual(['fast', 'mid', 'slow']);
  });

  it('advancePass subtracts 10, floors at 0, and resets actedThisPass', () => {
    const roster = advancePass([
      combatant({ initScore: 23, actedThisPass: true }),
      combatant({ initScore: 8, actedThisPass: true }),
    ]);
    expect(roster.map((c) => c.initScore)).toEqual([13, 0]);
    expect(roster.every((c) => !c.actedThisPass)).toBe(true);
  });

  it('a new turn re-rolls everyone (FR4.3)', () => {
    const roster = [
      combatant({ initBase: 9, initDice: 2, initScore: 0, actedThisPass: true }),
      combatant({ initBase: 6, initDice: 1, initScore: 0, actedThisPass: true }),
    ];
    const { combatants, rolls } = beginTurn(roster, mulberry32(11));
    expect(rolls).toHaveLength(2);
    for (const c of combatants) {
      expect(c.initScore).toBeGreaterThan(0);
      expect(c.actedThisPass).toBe(false);
    }
  });
});

describe('interrupt actions (FR4.4)', () => {
  it('ships the default cost table', () => {
    const costs = Object.fromEntries(DEFAULT_INTERRUPTS.map((a) => [a.id, a.cost]));
    expect(costs).toEqual({
      full_defense: 10,
      dodge: 5,
      block: 5,
      parry: 5,
      intercept: 5,
      hit_the_dirt: 5,
    });
  });

  it('deducts immediately from the current score', () => {
    const c = combatant({ initScore: 15 });
    const fullDefense = DEFAULT_INTERRUPTS.find((a) => a.id === 'full_defense')!;
    const after = applyInterrupt(c, fullDefense);
    expect(after.initScore).toBe(5);
    expect(c.initScore).toBe(15); // pure
  });

  it('interrupt mid-pass drops the actor out of later passes', () => {
    let roster = [combatant({ id: 'a', initScore: 23 }), combatant({ id: 'b', initScore: 15 })];
    // Pass 1: A acts; B goes on Full Defense before acting, then acts.
    roster = roster.map((c) => (c.id === 'a' ? markActed(c) : c));
    roster = roster.map((c) => (c.id === 'b' ? markActed(applyInterrupt(c, 10)) : c));
    expect(roster.find((c) => c.id === 'b')!.initScore).toBe(5);

    roster = advancePass(roster);
    expect(roster.map((c) => c.initScore)).toEqual([13, 0]);
    // Pass 2: only A is still in.
    expect(turnOrder(roster).map((c) => c.id)).toEqual(['a']);
  });

  it('canInterrupt is the soft affordability check; applyInterrupt still allows going below 0', () => {
    const c = combatant({ initScore: 4 });
    expect(canInterrupt(c, 5)).toBe(false);
    expect(canInterrupt(c, 4)).toBe(true);
    expect(applyInterrupt(c, 5).initScore).toBe(-1);
  });
});
