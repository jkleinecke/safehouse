/**
 * Accessible names for the sheet. These were all missing when the app was
 * driven with a screen reader: the skill rows read as unlabelled buttons, the
 * monitors as a wall of anonymous boxes, and the limits as "P limit".
 */
import { describe, expect, it } from 'vitest';
import {
  breakdownLabel,
  contactLabel,
  edgeTrackLabel,
  initiativeLabel,
  isActivationKey,
  isDismissKey,
  limitCellLabel,
  limitPhrase,
  monitorBoxLabel,
  monitorLabel,
  movementLabel,
  poolPhrase,
  rollRowLabel,
  skillRowLabel,
  spellRowLabel,
} from './a11y.js';

describe('keyboard predicates', () => {
  it('activates on Enter and Space, including the legacy Spacebar key', () => {
    expect(isActivationKey('Enter')).toBe(true);
    expect(isActivationKey(' ')).toBe(true);
    expect(isActivationKey('Spacebar')).toBe(true);
    expect(isActivationKey('Tab')).toBe(false);
    expect(isActivationKey('x')).toBe(false);
  });

  it('dismisses on Escape (and the old Esc)', () => {
    expect(isDismissKey('Escape')).toBe(true);
    expect(isDismissKey('Esc')).toBe(true);
    expect(isDismissKey('Enter')).toBe(false);
  });
});

describe('pool and row names', () => {
  it('names a pool with its limit', () => {
    expect(poolPhrase('perception', 5, { kind: 'mental', value: 5 })).toBe(
      'perception, pool 5, mental limit 5',
    );
    expect(poolPhrase('soak', 11)).toBe('soak, pool 11');
    expect(limitPhrase(undefined)).toBe('');
    expect(limitPhrase({ kind: 'accuracy', value: 6 })).toBe(', accuracy limit 6');
  });

  it('says what activating the row does', () => {
    expect(rollRowLabel('Defense', 8)).toBe('Roll Defense, pool 8');
  });

  it('puts identity before detail on a skill row', () => {
    const label = skillRowLabel(
      { id: 'pistols', attr: 'agi', rating: 5, spec: 'semi-autos' },
      11,
      { kind: 'physical', value: 6 },
    );
    expect(label).toBe(
      'Roll pistols, pool 11, physical limit 6. AGI, rating 5, specialization semi-autos',
    );
  });

  it('tolerates a skill with no specialization', () => {
    expect(skillRowLabel({ id: 'sneaking', attr: 'agi', rating: 3, spec: null }, 7)).toBe(
      'Roll sneaking, pool 7. AGI, rating 3',
    );
  });

  it('names a spell row by what it will do', () => {
    expect(spellRowLabel('Stunbolt', 9, 'F-3')).toBe('Cast Stunbolt, pool 9, drain F-3');
    expect(spellRowLabel('Levitate', undefined)).toBe('Cast Levitate');
  });
});

describe('numbers a reader has to announce', () => {
  it('flags an override in the provenance button name', () => {
    expect(breakdownLabel('perception pool', 5, false)).toBe(
      'perception pool: 5. Show breakdown',
    );
    expect(breakdownLabel('perception pool', 9, true)).toBe(
      'perception pool: 9, overridden. Show breakdown',
    );
  });

  it('describes a monitor and each of its boxes by consequence', () => {
    expect(monitorLabel('Physical', 3, 10)).toBe(
      'Physical condition monitor, 3 of 10 boxes filled',
    );
    // Tapping the last filled box heals; anything else damages down to it.
    expect(monitorBoxLabel('Physical', 2, 3, 10)).toBe(
      'Physical box 3 of 10, filled. Activate to heal one box',
    );
    expect(monitorBoxLabel('Physical', 5, 3, 10)).toBe(
      'Physical box 6 of 10, empty. Activate to damage to 6',
    );
  });

  it('speaks burned Edge, which the pips cannot show', () => {
    expect(edgeTrackLabel(2, 4, 0)).toBe('Edge 2 of 4');
    expect(edgeTrackLabel(1, 3, 1)).toBe('Edge 1 of 3, 1 burned permanently');
  });

  it('expands the cramped vitals chips', () => {
    expect(limitCellLabel('Physical limit', 6)).toBe('Physical limit, 6');
    expect(initiativeLabel('Cold-sim VR', 12, 3)).toBe('Cold-sim VR initiative, 12 plus 3 d6');
    expect(movementLabel('Run', 16)).toBe('Run, 16 meters per combat turn');
  });

  it('names a contact by reach and reliability', () => {
    expect(
      contactLabel({ name: 'Dozer', archetype: 'fixer', connection: 4, loyalty: 3 }),
    ).toBe('Dozer, fixer, connection 4, loyalty 3');
    expect(contactLabel({ name: 'Wisp', connection: 2, loyalty: 1 })).toBe(
      'Wisp, connection 2, loyalty 1',
    );
  });
});
