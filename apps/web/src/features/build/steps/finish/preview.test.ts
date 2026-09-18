/**
 * The sheet preview's rows (docs/CHARGEN.md §4.4 Step 9 "the full derived
 * sheet as the player will see it in play (limits, initiative, monitors,
 * pools per skill and weapon)").
 *
 * Every number asserted here is the engine's — the invented runner compiled
 * and derived exactly as the rail does it — so the test pins what the rows
 * pick out and how they name it: the book's "4 (6)" for an augmented
 * attribute, initiative as "N + ND6", a skill by its table name with its
 * pool, a weapon's pool and Accuracy limit, which initiative lines a runner
 * gets, and the opening balances in a sentence.
 */
import { describe, expect, it } from 'vitest';
import { analysisOf, conceptBuild } from '../../testing.js';
import { readyBuild } from './fixtures.js';
import {
  armorLines,
  attributeCells,
  augmentLines,
  contactLines,
  initiativeCells,
  knowledgeLines,
  lifestyleLines,
  limitCells,
  monitorCells,
  openingLine,
  previewIdentity,
  qualityLines,
  ratingText,
  skillLines,
  specialCells,
  weaponLines,
} from './preview.js';

function compiled(build = readyBuild()) {
  const { preview } = analysisOf(build);
  if (!preview.compiled || !preview.derived) throw new Error(preview.error ?? 'no preview');
  return { compiled: preview.compiled, sheet: preview.compiled.sheet, derived: preview.derived };
}

describe('the sheet preview rows', () => {
  it('writes an augmented rating the book’s way', () => {
    expect(ratingText(4, 4)).toBe('4');
    expect(ratingText(4, 5)).toBe('4 (5)');
    expect(ratingText(6, 5.8)).toBe('6 (5.8)');
  });

  it('names the runner, its metatype, and nothing for a mundane’s awakening', () => {
    const { sheet } = compiled();
    expect(previewIdentity(sheet)).toMatchObject({ alias: 'Kestrel Vane', awakening: null });
    expect(previewIdentity(sheet).metatype.length).toBeGreaterThan(0);
    const mage = compiled(conceptBuild('street-mage')).sheet;
    expect(previewIdentity(mage).awakening).toBe('magician · hermetic');
  });

  it('reads attributes natural and augmented, with Essence after implants', () => {
    const { sheet, derived } = compiled();
    const agi = attributeCells(sheet, derived).find((c) => c.key === 'agi')!;
    expect(agi.text).toBe(`${sheet.attributes.agi} (${sheet.attributes.agi + 1})`);
    expect(agi.breakdown.length).toBeGreaterThan(1);
    const special = specialCells(sheet, derived);
    expect(special.map((c) => c.key)).toEqual(['edg', 'ess']);
    expect(special.find((c) => c.key === 'ess')!.text).toBe('5.8');
  });

  it('reads the three limits and the initiative lines this runner uses', () => {
    const { sheet, derived } = compiled();
    expect(limitCells(derived).map((c) => c.label)).toEqual(['P limit', 'M limit', 'S limit']);
    const init = initiativeCells(sheet, derived);
    expect(init.map((c) => c.key)).toEqual(['initiative.physical']);
    expect(init[0]!.text).toBe(`${derived.initiative.physical.base.value} + ${derived.initiative.physical.dice.value}D6`);

    const mage = compiled(conceptBuild('street-mage'));
    expect(initiativeCells(mage.sheet, mage.derived).map((c) => c.key)).toEqual(['initiative.physical', 'initiative.astral']);
    const techno = compiled(conceptBuild('technomancer'));
    expect(initiativeCells(techno.sheet, techno.derived).map((c) => c.key)).toEqual([
      'initiative.physical',
      'initiative.vrCold',
      'initiative.vrHot',
    ]);
  });

  it('reads monitor sizes as box counts', () => {
    const { derived } = compiled();
    const monitors = monitorCells(derived);
    expect(monitors.map((m) => m.tone)).toEqual(['physical', 'stun', 'overflow']);
    expect(monitors[0]!.boxes).toBe(derived.monitors.physical.value);
  });

  it('lists skills by table name with their pools and limits', () => {
    const { sheet, derived } = compiled();
    const skills = skillLines(sheet, derived);
    const names = skills.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const automatics = skills.find((s) => s.name === 'Automatics')!;
    expect(automatics.pool?.total).toBe(derived.pools['skill.automatics']!.total);
    expect(automatics.pool?.limit?.kind).toBe('physical');
    expect(skills.find((s) => s.name === 'Unarmed Combat')).toBeTruthy();
  });

  it('lists a native language as N', () => {
    const { sheet } = compiled();
    expect(knowledgeLines(sheet).find((k) => k.kind === 'language')).toMatchObject({ name: 'Cityspeak', rating: 'N' });
  });

  it('reads weapons with their pool and Accuracy, and the other gear lines', () => {
    const { sheet, derived, compiled: c } = compiled();
    expect(weaponLines(sheet, derived)).toEqual([
      expect.objectContaining({ name: 'Sparrow Carbine', dv: '8P', ap: '-1', acc: '5', modes: 'SA/BF' }),
    ]);
    expect(weaponLines(sheet, derived)[0]!.pool).toMatchObject({ limit: { kind: 'accuracy', value: 5 } });
    expect(armorLines(sheet)[0]).toMatchObject({ name: 'Canvas Longcoat', detail: 'rating 9 · worn' });
    expect(augmentLines(sheet)[0]).toMatchObject({ name: 'Wire Tendons', detail: '0.2 Essence' });
    expect(qualityLines(sheet)[0]).toMatchObject({ name: 'Steady Nerve', detail: 'positive · 4 Karma' });
    expect(contactLines(c)).toEqual([
      { key: 'Old Friend|0', name: 'Old Friend', role: 'fixer', connection: 4, loyalty: 3 },
      { key: 'Dock Boss|1', name: 'Dock Boss', role: 'foreman', connection: 4, loyalty: 3 },
    ]);
    expect(lifestyleLines(c)[0]!.detail).toMatch(/a month · 1 month paid$/);
  });

  it('says what carries into play and the roll approval makes', () => {
    const { compiled: c } = compiled();
    expect(openingLine(c)).toBe(
      `Carries 0 Karma and 5,000¥ into play; starting nuyen is ${c.opening.startingNuyen.dice}D6 × ${c.opening.startingNuyen.multiplier.toLocaleString('en-US')}¥, rolled on the record when the GM approves.`,
    );
  });
});
