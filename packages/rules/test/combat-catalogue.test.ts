/**
 * The action and situational-modifier catalogues (`combat/actions.ts`,
 * `combat/situational.ts`): every entry says what kind of thing it is and
 * which page explains it, the fire modes carry the Firing Mode Table's
 * numbers (p.180), and the sheet's hand-typed mode strings find their
 * actions.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES,
  COMBAT_ACTIONS,
  COVER_DEFENCE_BONUS,
  DEFAULT_INTERRUPTS,
  FIRE_MODE_ACTIONS,
  SITUATIONAL_MODIFIERS,
  attackActionsFor,
  combatAction,
  defenseModifierFor,
  defenseOptions,
  situationalModifier,
} from '../src/index.js';

describe('the catalogues', () => {
  it('every action has a type and a page, and offers only modifiers that exist', () => {
    for (const a of COMBAT_ACTIONS) {
      expect(ACTION_TYPES, a.id).toContain(a.type);
      expect(a.ref.book, a.id).toBe('SR5');
      expect(a.ref.page, a.id).toBeGreaterThan(0);
      for (const id of a.offers) expect(situationalModifier(id), `${a.id} offers ${id}`).toBeDefined();
    }
    expect(new Set(COMBAT_ACTIONS.map((a) => a.id)).size).toBe(COMBAT_ACTIONS.length);
  });

  it('every modifier applies somewhere and has a page', () => {
    for (const m of SITUATIONAL_MODIFIERS) {
      expect(m.applies.length, m.id).toBeGreaterThan(0);
      expect(m.ref.page, m.id).toBeGreaterThan(0);
    }
    expect(new Set(SITUATIONAL_MODIFIERS.map((m) => m.id)).size).toBe(SITUATIONAL_MODIFIERS.length);
    // One cover table: the catalogue reads the map's (p.190: +2 partial, +4 good).
    expect(situationalModifier('cover_partial')?.value).toBe(COVER_DEFENCE_BONUS.partial);
    expect(situationalModifier('cover_good')?.value).toBe(COVER_DEFENCE_BONUS.good);
    expect(COVER_DEFENCE_BONUS.good).toBe(4);
  });
});

describe('fire modes (p.180)', () => {
  it('carry the rounds and the defense modifier of the Firing Mode Table', () => {
    const table = Object.fromEntries(
      Object.values(FIRE_MODE_ACTIONS)
        .flat()
        .map((id) => [id, [combatAction(id)?.rounds, combatAction(id)?.defenseModifier]]),
    );
    expect(table).toEqual({
      fire_ss: [1, 0],
      fire_sa: [1, 0],
      fire_sb: [3, -2],
      fire_bf: [3, -2],
      fire_lb: [6, -5],
      fire_fa_simple: [6, -5],
      fire_fa_complex: [10, -9],
      suppressive: [20, undefined],
    });
  });

  it('take one off the defense modifier per round short, never past 0', () => {
    expect(defenseModifierFor(combatAction('fire_fa_complex')!, 7)).toBe(-6);
    expect(defenseModifierFor(combatAction('fire_lb')!, 5)).toBe(-4);
    expect(defenseModifierFor(combatAction('fire_bf')!, 0)).toBe(0);
    expect(defenseModifierFor(combatAction('fire_bf')!)).toBe(-2);
  });

  it("read the sheet's mode strings however they were typed", () => {
    const ids = (modes: string[], skillId = 'automatics') => attackActionsFor({ skillId, modes }).map((a) => a.id);
    expect(ids(['SA', 'BF'])).toEqual(['fire_sa', 'fire_bf', 'fire_sb', 'fire_lb']);
    expect(ids(['sa/bf/fa'])).toEqual(ids(['SA', 'BF', 'FA']));
    expect(ids(['SS'], 'longarms')).toEqual(['fire_ss']);
    expect(ids([], 'blades')).toEqual(['melee_attack']);
    expect(ids(['SS'], 'throwing-weapons')).toEqual(['throw_weapon']);
  });
});

describe('defending (the GM, 2026-09-28)', () => {
  it('offers the free test first; Dodge against shots too; Block and Parry in melee only', () => {
    expect(defenseOptions('ranged').map((a) => a.id)).toEqual(['defense', 'full_defense', 'dodge']);
    expect(defenseOptions('melee').map((a) => a.id)).toEqual(['defense', 'full_defense', 'dodge', 'block', 'parry']);
  });

  it('prices the interrupt menu from the catalogue', () => {
    expect(DEFAULT_INTERRUPTS.map((a) => [a.id, a.cost, a.ref?.page])).toEqual([
      ['full_defense', 10, 168],
      ['dodge', 5, 168],
      ['block', 5, 168],
      ['parry', 5, 168],
      ['intercept', 5, 168],
      ['hit_the_dirt', 5, 168],
    ]);
  });
});
