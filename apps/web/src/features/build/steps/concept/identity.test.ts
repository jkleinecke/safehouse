/**
 * Step 1's identity edits (docs/CHARGEN.md §4.4 Step 1, §8.3 `identity`).
 *
 * Pins what a field that saves on every keystroke needs: an alias is kept
 * exactly as typed (a trailing space survives until the next letter), yet a
 * name of spaces is still missing to the validator; an optional field emptied
 * leaves the record, so a typed-and-deleted real name saves the same record as
 * one never typed; age takes digits only and never wipes itself on a stray
 * key; an unchanged value hands back the same object, so a no-op keystroke
 * schedules no save; and every result is a record the contract accepts.
 * Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { CharacterBuildSchema } from '@safehouse/contracts';
import { validate } from '@safehouse/rules';
import { SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import { IDENTITY_TEXT_MAX, ageText, aliasIssue, identityLines, parseAge, setIdentityAge, setIdentityText } from './identity.js';

describe('setIdentityText', () => {
  it('keeps the alias as typed, and the validator still reads a name of spaces as missing', () => {
    const typing = setIdentityText(blankBuild(''), 'alias', 'Kestrel ');
    expect(typing.identity.alias).toBe('Kestrel ');
    expect(aliasIssue(validate(typing, SETTINGS))).toBeNull();

    const spaces = setIdentityText(blankBuild(''), 'alias', '   ');
    expect(aliasIssue(validate(spaces, SETTINGS))?.message).toBe('Give the runner an alias.');
    expect(aliasIssue(validate(spaces, SETTINGS))?.ref).toEqual({ book: 'SR5', page: 62 });
  });

  it('removes an optional field emptied, so typed-and-deleted is the record never typed', () => {
    const b = blankBuild();
    const typed = setIdentityText(b, 'realName', 'Mara Quell');
    expect(typed.identity.realName).toBe('Mara Quell');
    const deleted = setIdentityText(typed, 'realName', '');
    expect('realName' in deleted.identity).toBe(false);
    expect(deleted).toEqual(b);
  });

  it('keeps the rest of the record and the rest of the identity', () => {
    const b = { ...conceptBuild('face'), identity: { ...conceptBuild('face').identity, age: 31 } };
    const next = setIdentityText(b, 'sex', 'female');
    expect(next.identity).toEqual({ ...b.identity, sex: 'female' });
    expect({ ...next, identity: b.identity }).toEqual(b);
    expect(CharacterBuildSchema.safeParse(next).success).toBe(true);
  });

  it('cuts at the contract’s length, and an unchanged value is the same object', () => {
    const long = setIdentityText(blankBuild(), 'alias', 'x'.repeat(IDENTITY_TEXT_MAX + 20));
    expect(long.identity.alias).toHaveLength(IDENTITY_TEXT_MAX);
    expect(CharacterBuildSchema.safeParse(long).success).toBe(true);
    const b = blankBuild('Kestrel Vane');
    expect(setIdentityText(b, 'alias', 'Kestrel Vane')).toBe(b);
    expect(setIdentityText(b, 'sex', '')).toBe(b);
  });
});

describe('age', () => {
  it('takes digits only', () => {
    expect(parseAge('27')).toBe(27);
    expect(parseAge('')).toBeNull();
    expect(parseAge('2a7')).toBe(27);
    expect(parseAge('-5')).toBe(5);
    expect(parseAge('12345')).toBe(123);
    expect(parseAge('abc')).toBeNull();
  });

  it('sets a whole number, removes the age when emptied, and shows it back', () => {
    const b = blankBuild();
    const aged = setIdentityAge(b, '27');
    expect(aged.identity.age).toBe(27);
    expect(ageText(aged.identity.age)).toBe('27');
    expect(CharacterBuildSchema.safeParse(aged).success).toBe(true);
    const cleared = setIdentityAge(aged, '');
    expect('age' in cleared.identity).toBe(false);
    expect(ageText(cleared.identity.age)).toBe('');
    expect(ageText(null)).toBe('');
    expect(setIdentityAge(aged, '27')).toBe(aged);
    // A stray key that leaves the same digits changes nothing.
    expect(setIdentityAge(aged, '27x')).toBe(aged);
  });
});

describe('the read-only lines', () => {
  it('say "not given" rather than leave a blank', () => {
    expect(identityLines({ alias: 'Kestrel Vane', age: 0 })).toEqual([
      { field: 'alias', label: 'Alias', value: 'Kestrel Vane' },
      { field: 'realName', label: 'Real name', value: 'not given' },
      { field: 'age', label: 'Age', value: '0' },
      { field: 'sex', label: 'Sex', value: 'not given' },
    ]);
    expect(identityLines({ alias: '  ' })[0]!.value).toBe('not given');
  });
});
