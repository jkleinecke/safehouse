/**
 * Rule references (`refs.ts`): a roll always explains itself with at least
 * the Success Test page, names the attributes in its pool, and points a
 * skill at its group's page rather than at a page it cannot vouch for.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_REFS,
  RULE_REFS,
  SKILL_GROUP_REFS,
  attributeCode,
  rollRefs,
  skillGroup,
  skillRef,
} from '../src/index.js';
import { DEFAULT_SKILL_ATTRS } from '../src/generator/validity.js';

describe('attributes and skills', () => {
  it('reads an attribute by code, by name, in any case', () => {
    expect(attributeCode('WIL')).toBe('wil');
    expect(attributeCode('Willpower')).toBe('wil');
    expect(attributeCode('agi')).toBe('agi');
    expect(attributeCode('armour')).toBeNull();
    expect(ATTRIBUTE_REFS['edg']?.page).toBe(56);
  });

  it('files every skill the generator knows into a skill group', () => {
    const unfiled = Object.keys(DEFAULT_SKILL_ATTRS).filter((id) => skillGroup(id) === null);
    expect(unfiled).toEqual([]);
  });

  it('points a skill at its group page, and an unknown one at the chapter', () => {
    expect(skillRef('pistols')).toMatchObject({ book: 'SR5', page: 130, topic: 'pistols · Combat Active Skills' });
    expect(skillRef('Unarmed Combat').page).toBe(SKILL_GROUP_REFS.combat.page);
    expect(skillRef('street-rumours')).toMatchObject({ page: RULE_REFS.skills.page });
  });
});

describe('what explains a roll', () => {
  it('a skill roll: the skill, its attribute, the test, the limit', () => {
    const refs = rollRefs({
      poolRef: 'skill.sneaking',
      attributes: ['AGI'],
      limitKind: 'physical',
    });
    expect(refs.map((r) => r.topic)).toEqual([
      'sneaking · Physical Active Skills',
      'Agility',
      'Success Tests',
      'Limits',
    ]);
  });

  it('a weapon roll names the combat section for the weapon it knows about', () => {
    const ranged = rollRefs({ poolRef: 'weapon.Ares Predator', skillId: 'pistols', melee: false, attributes: ['AGI'] });
    expect(ranged.map((r) => r.topic)).toEqual([
      'pistols · Combat Active Skills',
      'Ranged Combat',
      'Agility',
      'Success Tests',
    ]);
    const unsure = rollRefs({ poolRef: 'weapon.Something' });
    expect(unsure.map((r) => r.topic)).toEqual(['Ranged Combat', 'Melee Combat', 'Success Tests']);
  });

  it('a cast and its drain read differently', () => {
    expect(rollRefs({ poolRef: 'spell.Stunbolt', limitKind: 'force', attributes: ['MAG'] }).map((r) => r.topic)).toEqual([
      'Spellcasting',
      'Magic',
      'Success Tests',
      'Limits',
    ]);
    expect(rollRefs({ drain: true, kind: 'threshold', attributes: ['WIL', 'CHA'] }).map((r) => r.topic)).toEqual([
      'Drain',
      'Willpower',
      'Charisma',
      'Success Tests',
    ]);
  });

  it('defence, soak, a bare pool', () => {
    expect(rollRefs({ poolRef: 'defense', attributes: ['REA', 'INT'] })[0]?.topic).toBe('Defending in Combat');
    expect(rollRefs({ poolRef: 'soak', attributes: ['BOD'] })[0]?.topic).toBe('Damage Resistance');
    expect(rollRefs({}).map((r) => r.topic)).toEqual(['Success Tests']);
  });

  it('never repeats a page it already gave', () => {
    const refs = rollRefs({ poolRef: 'skill.perception', attributes: ['INT', 'Intuition', 'int'] });
    expect(refs.filter((r) => r.topic === 'Intuition')).toHaveLength(1);
  });
});
