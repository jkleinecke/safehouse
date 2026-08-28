import { describe, expect, it } from 'vitest';
import {
  activeGruntMembers,
  checkMorale,
  createGruntGroup,
  gruntCasualties,
  gruntMoraleTriggers,
  moraleReport,
  spendGroupEdge,
  tickGruntDamage,
} from '../src/index.js';

describe('checkMorale (FR10.9)', () => {
  it('suggests fight_on with no triggers fired', () => {
    expect(checkMorale(0, {})).toBe('fight_on');
    expect(checkMorale(6, {})).toBe('fight_on');
  });

  it('professionals shrug off a first casualty; green gangs waver', () => {
    expect(checkMorale(4, { firstCasualty: true })).toBe('fight_on');
    expect(checkMorale(0, { firstCasualty: true })).toBe('fall_back');
  });

  it('stacked triggers push low-PR groups to run', () => {
    expect(checkMorale(1, { firstCasualty: true, halfStrength: true })).toBe('cut_and_run');
    expect(checkMorale(2, { firstCasualty: true, leaderDown: true })).toBe('fall_back');
    expect(checkMorale(6, { firstCasualty: true, leaderDown: true, halfStrength: true })).toBe(
      'fight_on',
    );
  });

  it('moraleReport carries the receipt for the log', () => {
    const report = moraleReport(2, { firstCasualty: true, leaderDown: true });
    expect(report).toMatchObject({ suggestion: 'fall_back', pressure: 3, threshold: 2 });
    expect(report.reasons).toEqual(['first casualty', 'leader down']);
  });

  it('honors custom weights (GM-editable table)', () => {
    const weights = { firstCasualty: 5, leaderDown: 2, halfStrength: 3 };
    expect(checkMorale(1, { firstCasualty: true }, weights)).toBe('cut_and_run');
  });
});

describe('grunt groups (FR4.6)', () => {
  it('creates a labeled squad from one shared template', () => {
    const grunt = createGruntGroup({
      size: 4,
      professionalRating: 2,
      groupEdge: 2,
      labelPrefix: 'Razor',
    });
    expect(grunt.size).toBe(4);
    expect(grunt.members.map((m) => m.label)).toEqual(['Razor 1', 'Razor 2', 'Razor 3', 'Razor 4']);
    expect(grunt.members.every((m) => m.filled === 0 && !m.down)).toBe(true);
    expect(grunt.groupEdge).toBe(2);
  });

  it('ticks per-member condition and marks members down at the shared max', () => {
    const grunt = createGruntGroup({ size: 3, professionalRating: 1 });
    const first = tickGruntDamage(grunt, 1, 4, 10);
    expect(first.member).toMatchObject({ filled: 4, down: false });
    const second = tickGruntDamage(first.grunt, 1, 9, 10);
    expect(second.member).toMatchObject({ filled: 10, down: true });
    expect(gruntCasualties(second.grunt)).toBe(1);
    expect(activeGruntMembers(second.grunt)).toBe(2);
    expect(grunt.members[1]!.filled).toBe(0); // pure
    expect(() => tickGruntDamage(grunt, 9, 1, 10)).toThrow(RangeError);
  });

  it('spends from the shared group edge pool until empty', () => {
    const grunt = createGruntGroup({ size: 2, professionalRating: 3, groupEdge: 1 });
    const spent = spendGroupEdge(grunt);
    expect(spent.ok).toBe(true);
    expect(spent.grunt.groupEdge).toBe(0);
    const empty = spendGroupEdge(spent.grunt);
    expect(empty.ok).toBe(false);
    expect(empty.grunt.groupEdge).toBe(0);
  });

  it('derives morale triggers from squad state', () => {
    let grunt = createGruntGroup({ size: 4, professionalRating: 2 });
    expect(gruntMoraleTriggers(grunt)).toEqual({
      firstCasualty: false,
      leaderDown: false,
      halfStrength: false,
    });
    grunt = tickGruntDamage(grunt, 0, 10, 10).grunt;
    expect(gruntMoraleTriggers(grunt)).toMatchObject({ firstCasualty: true, halfStrength: false });
    grunt = tickGruntDamage(grunt, 1, 10, 10).grunt;
    expect(gruntMoraleTriggers(grunt, { leaderDown: true })).toEqual({
      firstCasualty: true,
      leaderDown: true,
      halfStrength: true,
    });
  });
});
