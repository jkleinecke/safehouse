/**
 * Chummer import (FR3.1): the forgiving XML walker, the SheetV1 mapping, and
 * the derived pools the table plays with — hand-verified against the fixture
 * (an ORIGINAL street samurai; no book content anywhere, G6).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveCharacter } from '@safehouse/rules';
import type { SheetV1 } from '@safehouse/contracts';
import { diffSheets, importChummer, parseXml, txt, kid } from '../src/services/chummer.js';

const FIXTURE = readFileSync(new URL('./fixtures/chummer-sample.chum5', import.meta.url), 'utf8');

describe('forgiving XML walker', () => {
  it('parses elements, attributes, text and self-closing tags', () => {
    const doc = parseXml('<?xml version="1.0"?><a x="1"><b>hi</b><c/></a>');
    const a = kid(doc, 'a');
    expect(a?.attrs['x']).toBe('1');
    expect(txt(a, 'b')).toBe('hi');
    expect(kid(a, 'c')?.children).toHaveLength(0);
  });

  it('survives unclosed tags, stray text, comments and CDATA', () => {
    const doc = parseXml('<r><!-- note --><a>one<b>two</r trailing');
    expect(txt(kid(doc, 'r'), 'a')).toBe('one');
    const doc2 = parseXml('<r><n><![CDATA[a < b & c]]></n></r>');
    expect(txt(kid(kid(doc2, 'r'), 'n'))).toBe('a < b & c');
  });

  it('decodes entities in text and attributes', () => {
    const doc = parseXml('<r n="a&amp;b"><t>5 &lt; 6 &#65;</t></r>');
    const r = kid(doc, 'r');
    expect(r?.attrs['n']).toBe('a&b');
    expect(txt(r, 't')).toBe('5 < 6 A');
  });

  it('never throws on garbage', () => {
    expect(() => parseXml('<<>>&&& <a b= "c><')).not.toThrow();
    expect(importChummer('not xml at all').sheet.identity.alias).toBe('Unnamed runner');
  });
});

describe('importChummer → SheetV1', () => {
  const imported = importChummer(FIXTURE);
  const sheet = imported.sheet;

  it('maps identity and attributes', () => {
    expect(sheet.v).toBe(1);
    expect(sheet.identity.alias).toBe('Rivet');
    expect(sheet.identity.metatype).toBe('human');
    expect(sheet.attributes).toMatchObject({
      bod: 5, agi: 6, rea: 4, str: 4, wil: 3, log: 3, int: 4, cha: 2, mag: 0, res: 0,
    });
    expect(sheet.attributes.edg).toEqual({ max: 3, current: 3 });
    // Base Essence rebuilt from Chummer's net 3.6 + 2.4 of 'ware.
    expect(sheet.attributes.ess).toBeCloseTo(6, 5);
  });

  it('maps active and knowledge skills with ratings = base + karma', () => {
    const byId = Object.fromEntries(sheet.skills.map((s) => [s.id, s]));
    expect(byId['automatics']).toMatchObject({ rating: 6, attr: 'agi', spec: 'Carbines' });
    expect(byId['pistols']).toMatchObject({ rating: 4, attr: 'agi' });
    expect(byId['perception']).toMatchObject({ rating: 3, attr: 'int' });
    expect(byId['sneaking']?.rating).toBe(3);
    expect(byId['gymnastics']?.rating).toBe(2);
    expect(byId['intimidation']).toMatchObject({ rating: 2, attr: 'cha' });
    expect(byId['corporate-security-procedures']).toMatchObject({ rating: 3, attr: 'log' });
  });

  it('maps weapons with skill inference, ammo, modes and page refs', () => {
    const byName = Object.fromEntries(sheet.weapons.map((w) => [w.name, w]));
    expect(byName['Kestrel A4']).toMatchObject({
      skillId: 'automatics',
      acc: 5,
      dv: '9P',
      ap: -2,
      recoilComp: 2,
      ref: { book: 'SR5', page: 426 },
    });
    expect(byName['Kestrel A4']?.modes).toEqual(['SA', 'BF', 'FA']);
    expect(byName['Kestrel A4']?.ammo).toEqual({ cap: 30, current: 30 });
    expect(byName['Talon HP-9']?.skillId).toBe('pistols');
    // Melee: no ammo, and the sheet has no Blades skill → pool will default.
    expect(byName['Sliver Knife']?.skillId).toBe('blades');
    expect(byName['Sliver Knife']?.ammo).toBeUndefined();
  });

  it('maps armor, augments, gear, qualities and lifestyles', () => {
    expect(sheet.armor).toHaveLength(2);
    expect(sheet.armor[0]).toMatchObject({ name: 'Ranger-Weave Coat', rating: 12, worn: true });
    expect(sheet.armor[1]?.worn).toBe(false);
    expect(sheet.augments).toHaveLength(3);
    expect(sheet.augments.reduce((s, a) => s + a.essence, 0)).toBeCloseTo(2.4, 5);
    expect(sheet.augments[0]?.name).toContain('Nerve-Lace Reflex Rig');
    expect(sheet.gear.map((g) => g.qty)).toContain(4);
    expect(sheet.qualities.map((q) => q.name)).toContain('Wire-Tight Nerves');
    expect(sheet.lifestyles[0]?.costPerMonth).toBe(2000);
    expect(sheet.spells).toHaveLength(0);
  });

  it('keeps karma/nuyen out of the sheet — they seed the ledger (FR3.6)', () => {
    expect(imported.karma).toBe(12);
    expect(imported.nuyen).toBe(4500);
    expect(JSON.stringify(sheet)).not.toContain('4500');
  });

  it('reports unmapped node names for manual entry', () => {
    expect(imported.report.unmapped).toEqual(['contacts', 'expenses', 'improvements']);
    expect(imported.report.unmapped).not.toContain('weapons');
    expect(imported.report.counts['skills']).toBe(7);
    expect(imported.report.counts['weapons']).toBe(3);
    expect(imported.report.notes.join(' ')).toContain('range bands');
  });
});

describe('derived pools from the imported sheet (hand-verified)', () => {
  const sheet: SheetV1 = importChummer(FIXTURE).sheet;
  const derived = deriveCharacter(sheet);

  it('derives attributes and Essence', () => {
    expect(derived.attributes['agi']?.value).toBe(6);
    // 6 base − 2.4 of 'ware.
    expect(derived.attributes['ess']?.value).toBeCloseTo(3.6, 5);
  });

  it('derives limits: ⌈(4×2+5+4)/3⌉=6, ⌈(3×2+4+3)/3⌉=5, ⌈(2×2+3+3.6)/3⌉=4', () => {
    expect(derived.limits.physical.value).toBe(6);
    expect(derived.limits.mental.value).toBe(5);
    expect(derived.limits.social.value).toBe(4);
  });

  it('derives monitors 8+⌈5/2⌉=11 / 8+⌈3/2⌉=10 / overflow 5', () => {
    expect(derived.monitors.physical.value).toBe(11);
    expect(derived.monitors.stun.value).toBe(10);
    expect(derived.monitors.overflow.value).toBe(5);
  });

  it('derives initiative REA+INT=8 +1d6 and movement 12/24 m', () => {
    expect(derived.initiative.physical.base.value).toBe(8);
    expect(derived.initiative.physical.dice.value).toBe(1);
    expect(derived.movement.walk.value).toBe(12);
    expect(derived.movement.run.value).toBe(24);
  });

  it('derives dice pools with provenance', () => {
    // AGI 6 + Automatics 6
    expect(derived.pools['skill.automatics']?.total).toBe(12);
    expect(derived.pools['skill.automatics']?.limit).toEqual({ kind: 'physical', value: 6 });
    // INT 4 + Perception 3
    expect(derived.pools['skill.perception']?.total).toBe(7);
    // The carbine rolls the Automatics pool, limited by Accuracy 5.
    expect(derived.pools['weapon.Kestrel A4']?.total).toBe(12);
    expect(derived.pools['weapon.Kestrel A4']?.limit).toEqual({ kind: 'accuracy', value: 5 });
    // Talon: AGI 6 + Pistols 4
    expect(derived.pools['weapon.Talon HP-9']?.total).toBe(10);
    // No Blades skill → defaulting at AGI − 1
    expect(derived.pools['weapon.Sliver Knife']?.total).toBe(5);
    // BOD 5 + worn armor 12 ; REA 4 + INT 4
    expect(derived.pools['soak']?.total).toBe(17);
    expect(derived.pools['defense']?.total).toBe(8);
    expect(derived.pools['armor']?.total).toBe(12);
    const receipt = derived.pools['skill.automatics']?.breakdown ?? [];
    expect(receipt.map((b) => b.label)).toEqual(['AGI', 'automatics']);
  });

  it('applies wound modifiers from live monitor state (§10.2)', () => {
    const wounded = deriveCharacter(sheet, { wounds: { physical: 6, stun: 3 } });
    // −1 per 3 boxes per monitor: −2 physical, −1 stun.
    expect(wounded.woundModifier?.value).toBe(-3);
    expect(wounded.pools['skill.automatics']?.total).toBe(9);
    // Soak is exempt from pool.all penalties.
    expect(wounded.pools['soak']?.total).toBe(17);
  });
});

describe('diffSheets', () => {
  const before = importChummer(FIXTURE).sheet;

  it('is empty for an identical re-import', () => {
    expect(diffSheets(before, importChummer(FIXTURE).sheet)).toEqual([]);
  });

  it('reports field-level changes, additions and removals', () => {
    const after: SheetV1 = {
      ...before,
      attributes: { ...before.attributes, agi: 7 },
      weapons: before.weapons.slice(0, 2),
      gear: [...before.gear, { name: 'Slap patch', qty: 2 }],
    };
    const diff = diffSheets(before, after);
    expect(diff).toContainEqual({ path: 'attributes.agi', op: 'changed', from: 6, to: 7 });
    expect(diff.some((d) => d.path.includes('Sliver Knife') && d.op === 'removed')).toBe(true);
    expect(diff.some((d) => d.path === 'gear[Slap patch].qty' && d.op === 'added')).toBe(true);
  });
});
