import { describe, expect, it } from 'vitest';
import {
  actNowOrder,
  advancePass,
  anyActiveScores,
  applyInterrupt,
  beginTurn,
  canInterrupt,
  DEFAULT_INTERRUPTS,
  delayedRows,
  markActed,
  moveInOrder,
  nextActor,
  rollInitiative,
  seizeInitiative,
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

describe('ties: ERIC, then the coin (SR5 p.159)', () => {
  it('breaks a tied score on Edge, then Reaction, then Intuition', () => {
    const roster = [
      combatant({ id: 'plain', initScore: 12 }),
      combatant({ id: 'lucky', initScore: 12 }),
      combatant({ id: 'sharp', initScore: 12 }),
      combatant({ id: 'first', initScore: 13 }),
    ];
    const eric = {
      plain: { edg: 2, rea: 5, int: 4 },
      lucky: { edg: 3, rea: 3, int: 3 }, // Edge wins before anything else is read
      sharp: { edg: 2, rea: 5, int: 5 }, // same E and R as plain: Intuition decides
    };
    expect(turnOrder(roster, { eric }).map((c) => c.id)).toEqual(['first', 'lucky', 'sharp', 'plain']);
  });

  it('tosses the same coin for the same seed whatever order the rows arrive in', () => {
    const a = combatant({ id: 'row-a', initScore: 9 });
    const b = combatant({ id: 'row-b', initScore: 9 });
    const one = turnOrder([a, b], { coin: 'fight:1' }).map((c) => c.id);
    const two = turnOrder([b, a], { coin: 'fight:1' }).map((c) => c.id);
    expect(one).toEqual(two);
    // The initiative base is no longer a tie-break: a bigger base with the
    // same ERIC does not decide it, the coin does.
    const based = turnOrder([{ ...a, initBase: 20 }, b], { coin: 'fight:1' }).map((c) => c.id);
    expect(based).toEqual(one);
  });
});

describe('the manual order: place only (the GM, 2026-09-28)', () => {
  const roster = () => [
    combatant({ id: 'a', initScore: 20 }),
    combatant({ id: 'b', initScore: 15 }),
    combatant({ id: 'c', initScore: 10 }),
  ];

  it('plays the GM’s arrangement and never touches a score', () => {
    const list = roster();
    const order = turnOrder(list, { manualOrder: ['c', 'a', 'b'] });
    expect(order.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(order.map((c) => c.initScore)).toEqual([10, 20, 15]);
    expect(nextActor(list, { manualOrder: ['c', 'a', 'b'] })?.id).toBe('c');
    // Scores still decide passes: after one pass only a (10) and b (5) act again.
    expect(turnOrder(advancePass(list), { manualOrder: ['c', 'a', 'b'] }).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('slots a row the list does not name straight after the last row that outranks it', () => {
    const list = [...roster(), combatant({ id: 'late', initScore: 17 })];
    expect(turnOrder(list, { manualOrder: ['c', 'a', 'b'] }).map((c) => c.id)).toEqual(['c', 'a', 'late', 'b']);
  });

  it('drags one row to a new place, and Sort by score is just no manual order', () => {
    const list = roster();
    const moved = moveInOrder(list, 'c', 0);
    expect(moved).toEqual(['c', 'a', 'b']);
    expect(moveInOrder(list, 'a', 99)).toEqual(['b', 'c', 'a']); // clamped to the end
    expect(moveInOrder([...list, combatant({ id: 'spent', initScore: 0 })], 'spent', 0)).toBeNull();
    expect(turnOrder(list, { manualOrder: null }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('a Delayed Action (SR5 p.161)', () => {
  it('keeps its score and place, is stepped over, and the pass waits for it', () => {
    let list = [
      combatant({ id: 'cutter', initScore: 13, delayed: true }),
      combatant({ id: 'painkiller', initScore: 11 }),
      combatant({ id: 'ash', initScore: 6 }),
    ];
    expect(turnOrder(list).map((c) => c.id)).toEqual(['cutter', 'painkiller', 'ash']);
    expect(nextActor(list)?.id).toBe('painkiller');
    expect(delayedRows(list).map((c) => c.id)).toEqual(['cutter']);

    // Everyone else acts: nobody is next, but the pass still waits on Cutter.
    list = list.map((c) => (c.delayed ? c : markActed(c)));
    expect(nextActor(list)).toBeNull();
    expect(delayedRows(list).map((c) => c.id)).toEqual(['cutter']);
  });

  it('"Act now" puts the delayed row in front of whoever was next, score untouched', () => {
    const list = [
      combatant({ id: 'cutter', initScore: 13, delayed: true }),
      combatant({ id: 'painkiller', initScore: 11, actedThisPass: true }),
      combatant({ id: 'ash', initScore: 6 }),
    ];
    const placed = actNowOrder(list, 'cutter');
    expect(placed).toEqual(['painkiller', 'cutter', 'ash']);
    // The caller takes the hold off; Cutter is then the one acting, on 13 still.
    const after = list.map((c) => (c.id === 'cutter' ? { ...c, delayed: false } : c));
    const up = nextActor(after, { manualOrder: placed });
    expect(up?.id).toBe('cutter');
    expect(up?.initScore).toBe(13);
  });

  it('goes last when nobody else is left to call (p.161: after the last one)', () => {
    const list = [
      combatant({ id: 'held', initScore: 20, delayed: true }),
      combatant({ id: 'done', initScore: 9, actedThisPass: true }),
    ];
    expect(actNowOrder(list, 'held')).toEqual(['done', 'held']);
  });
});

describe('Seize the Initiative on the order (SR5 p.160-161)', () => {
  it('seizers go first, in order of their scores, with their scores untouched', () => {
    const list = [
      combatant({ id: 'fast', initScore: 25 }),
      combatant({ id: 'slow-seizer', initScore: 8, seized: true }),
      combatant({ id: 'mid-seizer', initScore: 12, seized: true }),
      combatant({ id: 'mid', initScore: 14 }),
    ];
    const order = turnOrder(list);
    expect(order.map((c) => c.id)).toEqual(['mid-seizer', 'slow-seizer', 'fast', 'mid']);
    expect(order.map((c) => c.initScore)).toEqual([12, 8, 25, 14]);
  });

  it('cuts the seizer out of a manual order so the book puts it on top, and holds through Sort by score', () => {
    const list = [
      combatant({ id: 'a', initScore: 20 }),
      combatant({ id: 'b', initScore: 15 }),
      combatant({ id: 's', initScore: 7 }),
    ];
    const out = seizeInitiative(list, 's', { manualOrder: ['b', 'a', 's'] });
    expect(out.manualOrder).toEqual(['b', 'a']);
    expect(out).toMatchObject({ score: 7, from: 3, to: 1, changed: true });
    const seized = list.map((c) => (c.id === 's' ? { ...c, seized: true } : c));
    expect(turnOrder(seized, { manualOrder: out.manualOrder }).map((c) => c.id)).toEqual(['s', 'b', 'a']);
    expect(turnOrder(seized, { manualOrder: null }).map((c) => c.id)).toEqual(['s', 'a', 'b']);
  });

  it('a new Combat Turn takes the seize and the delay off', () => {
    const { combatants } = beginTurn(
      [combatant({ seized: true, initScore: 3 }), combatant({ delayed: true, initScore: 4 })],
      mulberry32(2),
    );
    for (const c of combatants) {
      expect(c.seized).toBeUndefined();
      expect(c.delayed).toBeUndefined();
    }
  });
});
