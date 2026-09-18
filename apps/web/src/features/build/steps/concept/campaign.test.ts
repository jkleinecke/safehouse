/**
 * The campaign's level and table as Step 1 shows them (docs/CHARGEN.md §4.4
 * Step 1 "shown, not chosen").
 *
 * Pins that the numbers on the screen are the ones the engine holds the build
 * to — each level's starting Karma, caps, money and carry-over, a GM's own
 * caps and quality-cap reading laid over them — that the table's line is the
 * technomancer row of the printing the campaign uses, and that the one edit
 * this part of the step offers clears the validator's level and table
 * warnings and touches nothing else. Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { chargenSettingsForLevel } from '@safehouse/contracts';
import { validate } from '@safehouse/rules';
import { SETTINGS, conceptBuild } from '../../testing.js';
import { levelFacts, matchCampaign, mismatchIssues, tableFacts } from './campaign.js';

const factMap = (facts: readonly { key: string; value: string }[]) => Object.fromEntries(facts.map((f) => [f.key, f.value]));

describe('levelFacts', () => {
  it('experienced: the standard start, in numbers', () => {
    const facts = levelFacts(conceptBuild('face'), SETTINGS);
    expect(facts.name).toBe('Experienced');
    expect(facts.ref).toEqual({ book: 'SR5', page: 62 });
    expect(factMap(facts.facts)).toEqual({
      karma: '25',
      availability: '12',
      device: '6',
      resources: '6,000¥ at E to 450,000¥ at A',
      qualities: 'up to 25 positive and 25 negative',
      toNuyen: 'up to 10, at 2,000¥ each',
      carry: '7 Karma and 5,000¥',
      contacts: 'Charisma × 3',
      initiation: 'not at this level',
    });
    // Starting Karma and the Availability cap lead: the two numbers a first spend meets.
    expect(facts.facts.slice(0, 2).map((f) => f.key)).toEqual(['karma', 'availability']);
  });

  it('street and prime move every number the level owns', () => {
    const street = factMap(levelFacts(conceptBuild('face'), chargenSettingsForLevel('street')).facts);
    expect(street).toMatchObject({ karma: '13', availability: '10', device: '4', resources: '6,000¥ at E to 75,000¥ at A' });
    expect(street.qualities).toBe('up to 26 positive and 26 negative');
    expect(street.toNuyen).toBe('up to 5, at 2,000¥ each');

    const prime = levelFacts(conceptBuild('face'), chargenSettingsForLevel('prime'));
    expect(prime.name).toBe('Prime runner');
    expect(prime.ref).toEqual({ book: 'SR5', page: 64 });
    expect(factMap(prime.facts)).toMatchObject({
      karma: '35',
      availability: '15',
      resources: '100,000¥ at E to 500,000¥ at A',
      qualities: 'up to 70 positive and 70 negative',
      contacts: 'Charisma × 6',
      initiation: 'allowed',
    });
  });

  it('shows the GM’s own caps and quality-cap reading, not the preset’s', () => {
    const house = chargenSettingsForLevel('prime', { maxAvailability: 11, nuyenCarry: 2000, levelQualityCaps: false });
    expect(factMap(levelFacts(conceptBuild('face'), house).facts)).toMatchObject({
      availability: '11',
      carry: '7 Karma and 2,000¥',
      qualities: 'up to 25 positive and 25 negative',
    });
  });

  it('reads the campaign’s level, not the one the build was started at', () => {
    const started = { ...conceptBuild('face'), level: 'prime' as const };
    expect(levelFacts(started, SETTINGS).level).toBe('experienced');
  });
});

describe('tableFacts', () => {
  it('the core table: the technomancer row as printed there', () => {
    const t = tableFacts({ table: 'sr5' });
    expect(t.name).toBe('Core priority table');
    expect(t.ref).toEqual({ book: 'SR5', page: 65 });
    expect(t.rows).toEqual([
      { key: 'A', label: 'Priority A', value: '3 skills at 5, 7 complex forms' },
      { key: 'B', label: 'Priority B', value: '3 skills at 4, 4 complex forms' },
      { key: 'C', label: 'Priority C', value: '3 skills at 2, 3 complex forms' },
    ]);
  });

  it('the revised table: fewer forms, and no free skills at C', () => {
    const t = tableFacts({ table: 'rf' });
    expect(t.name).toBe('Revised priority table');
    expect(t.ref).toEqual({ book: 'RF', page: 63 });
    expect(t.rows.map((r) => r.value)).toEqual(['2 skills at 5, 5 complex forms', '2 skills at 4, 2 complex forms', 'no free skills, 1 complex form']);
  });
});

describe('a build started under other rules', () => {
  it('the validator’s level and table warnings are picked out, and matching the campaign clears them', () => {
    const street = chargenSettingsForLevel('street', { table: 'rf' });
    const build = conceptBuild('decker');
    const issues = validate(build, street);
    expect(mismatchIssues(issues).map((i) => i.code)).toEqual(['level-mismatch', 'table-mismatch']);
    expect(mismatchIssues(issues)[0]!.message).toBe('The campaign builds street runners; this build was started as experienced.');

    const matched = matchCampaign(build, street);
    expect([matched.level, matched.table]).toEqual(['street', 'rf']);
    expect({ ...matched, level: build.level, table: build.table }).toEqual(build);
    expect(mismatchIssues(validate(matched, street))).toEqual([]);
  });

  it('a build already in line is returned as it is', () => {
    const build = conceptBuild('decker');
    expect(matchCampaign(build, SETTINGS)).toBe(build);
    expect(mismatchIssues(validate(build, SETTINGS))).toEqual([]);
  });
});
