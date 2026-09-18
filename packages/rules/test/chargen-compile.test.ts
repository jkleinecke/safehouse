/**
 * Build → sheet (`chargen/compile.ts`, FR3.9, docs/CHARGEN.md §4.1, §5 P1,
 * §8.2, §8.7).
 *
 * The compiled sheet must be a `SheetV1` the server would store and
 * `deriveCharacter` would read like any other: the three worked characters
 * come out with the chapter's final numbers — initiative 6 / 6 (8) / 7,
 * limits 5-4-5 / 5-12-5 / 5-4-8 (9), monitors 10-10-3 / 13-10-10 / 10-10-3 —
 * where §8.7 corrects the book (the samurai's Social limit is 5; his
 * overflow is 10 with Will to Live). The sheet agrees with `ratings` on every
 * attribute and skill, Karma spends land through the advancement path, and
 * what lives beside the sheet — contacts, bound spirits, registered sprites,
 * foci, the opening balances and the starting-nuyen roll — comes back in the
 * shapes the server writes.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import { DerivedCharacterSchema, SheetV1Schema, type CharacterBuild, type ChargenSettings } from '@safehouse/contracts';
import { compileBuild, deriveCharacter, emptyBuild, environment, ratings, validate } from '../src/index.js';
import {
  EXPERIENCED,
  EXPERIENCED_RF,
  augment,
  cleanAdept,
  cleanBuild,
  cleanMage,
  goldenMysticAdept,
  goldenSamurai,
  goldenTechnomancer,
  mod,
  vary,
} from './chargen-fixtures.js';

const goldens: readonly [string, () => CharacterBuild, ChargenSettings][] = [
  ['technomancer', goldenTechnomancer, EXPERIENCED_RF],
  ['samurai', goldenSamurai, EXPERIENCED],
  ['mystic adept', goldenMysticAdept, EXPERIENCED],
];

describe('compileBuild: the worked characters derive to the chapter\'s numbers (SR5 p.100–102)', () => {
  it('compiles each to a sheet SheetV1Schema accepts unchanged, and a derivation DerivedCharacterSchema accepts', () => {
    for (const [, make, s] of goldens) {
      const { sheet } = compileBuild(make(), s);
      expect(SheetV1Schema.parse(sheet)).toEqual(sheet);
      const derived = deriveCharacter(sheet);
      expect(DerivedCharacterSchema.parse(derived)).toEqual(derived);
    }
  });

  it('technomancer: initiative 6 + 1D6, limits 5-4-5, monitors 10-10-3', () => {
    const d = deriveCharacter(compileBuild(goldenTechnomancer(), EXPERIENCED_RF).sheet);
    expect([d.initiative.physical.base.value, d.initiative.physical.dice.value]).toEqual([6, 1]);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 4, 5]);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([10, 10, 3]);
  });

  it('samurai: initiative 6 (8), limits 5-12-5 at Essence 4.9, monitors 13-10-10 with Will to Live (§8.7)', () => {
    const { sheet } = compileBuild(goldenSamurai(), EXPERIENCED);
    const d = deriveCharacter(sheet);
    expect(sheet.attributes.rea + sheet.attributes.int).toBe(6);
    expect(d.initiative.physical.base.value).toBe(8);
    expect(d.attributes['ess']?.value).toBeCloseTo(4.9, 10);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 12, 5]);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([13, 10, 10]);
    // Racial dermal armor comes from derive reading the metatype, once: 12 worn + 1.
    expect(d.pools['armor']?.total).toBe(13);
  });

  it('mystic adept: initiative 7, limits 5-4-8 and 9 with her social power, monitors 10-10-3', () => {
    const d = deriveCharacter(compileBuild(goldenMysticAdept(), EXPERIENCED).sheet);
    expect(d.initiative.physical.base.value).toBe(7);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 4, 9]);
    expect(d.limits.social.breakdown[0]?.value).toBe(8);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([10, 10, 3]);
    expect(d.pools['skill.pistols']?.total).toBe(6 + 3 + 1);
  });

  it('opens with 0 / 1 / 2 Karma, the capped carry-over, and totals the starting roll (SR5 p.95)', () => {
    const tech = compileBuild(goldenTechnomancer(), EXPERIENCED_RF, { startingNuyenRoll: 22 }).opening;
    const sam = compileBuild(goldenSamurai(), EXPERIENCED, { startingNuyenRoll: 12 }).opening;
    // The example's 2,225¥ would need 9.75 on 3D6; 10 gives 2,240 by the same formula (§8.7).
    const mystic = compileBuild(goldenMysticAdept(), EXPERIENCED, { startingNuyenRoll: 10 }).opening;
    // Roll × multiplier + the carry-over the list-price gear leaves (worked out in chargen-engine.test.ts):
    // 22 × 100 + 5,000, 12 × 60 + 2,810, 10 × 60 + 1,640 — §8.7's 7,200 and 3,530.
    expect(tech).toEqual({ karma: 0, nuyenCarry: 5_000, startingNuyen: { dice: 4, multiplier: 100, total: 7_200 } });
    expect(sam).toEqual({ karma: 1, nuyenCarry: 2_810, startingNuyen: { dice: 3, multiplier: 60, total: 3_530 } });
    expect(mystic).toEqual({ karma: 2, nuyenCarry: 1_640, startingNuyen: { dice: 3, multiplier: 60, total: 2_240 } });
    expect(compileBuild(goldenSamurai(), EXPERIENCED).opening.startingNuyen).toEqual({ dice: 3, multiplier: 60 });
  });
});

describe('compileBuild: what lands on the sheet', () => {
  it('agrees with ratings() on every attribute and skill, Karma raises included', () => {
    for (const [, make, s] of goldens) {
      const b = make();
      const { sheet } = compileBuild(b, s);
      const r = ratings(b, s);
      for (const code of ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const) {
        expect(sheet.attributes[code], code).toBe(r.attributes[code].rating);
      }
      expect(sheet.attributes.edg).toEqual({ max: r.attributes.edg.rating, current: r.attributes.edg.rating });
      expect([sheet.attributes.mag, sheet.attributes.res]).toEqual([r.attributes.mag.rating, r.attributes.res.rating]);
      const rated = Object.fromEntries(r.skills.filter((k) => k.rating > 0).map((k) => [k.id, k.rating]));
      expect(Object.fromEntries(sheet.skills.map((k) => [k.id, k.rating]))).toEqual(rated);
    }
  });

  it('applies Karma spends through the advancement path: raises, forms, power points', () => {
    const tech = compileBuild(goldenTechnomancer(), EXPERIENCED_RF).sheet;
    expect(tech.skills.filter((k) => ['cybercombat', 'software', 'electronic-warfare'].includes(k.id)).map((k) => k.rating)).toEqual([2, 2, 2]);
    expect(tech.skills.find((k) => k.id === 'software')?.attr).toBe('log');
    expect(tech.complexForms.map((f) => f.name)).toEqual(['Quiet Hands', 'Patch Note', 'Static Spike']);
    const mystic = compileBuild(goldenMysticAdept(), EXPERIENCED).sheet;
    expect(mystic.skills.find((k) => k.id === 'etiquette')?.rating).toBe(3);
    expect(mystic.awakening.powerPoints).toBe(2);
    expect(mystic.spells).toHaveLength(10);
  });

  it('writes group members with the group\'s name and point-bought specialisations', () => {
    const sam = compileBuild(goldenSamurai(), EXPERIENCED).sheet;
    expect(sam.skills.filter((k) => k.group === 'Athletics').map((k) => [k.id, k.rating])).toEqual([
      ['gymnastics', 2],
      ['running', 2],
      ['swimming', 2],
    ]);
    const clean = compileBuild(cleanBuild(), EXPERIENCED).sheet;
    expect(clean.skills.find((k) => k.id === 'blades')).toMatchObject({ rating: 5, spec: 'Knives' });
    expect(clean.skills.find((k) => k.id === 'pistols')).toMatchObject({ rating: 3, group: 'Firearms' });
  });

  it('puts knowledge and languages on their own lists, the native one unrated (§8.3)', () => {
    const sam = compileBuild(goldenSamurai(), EXPERIENCED).sheet;
    expect(sam.knowledge).toHaveLength(6);
    expect(sam.knowledge[1]).toEqual({ name: 'Military Regulations', category: 'professional', rating: 3 });
    expect(sam.languages).toEqual([
      { name: 'English', native: true, rating: 0 },
      { name: 'Dakota', native: false, rating: 1 },
    ]);
  });

  it('keeps qualities\' type, Karma, rating and modifiers, and writes Will to Live\'s overflow box once', () => {
    const sam = compileBuild(goldenSamurai(), EXPERIENCED).sheet;
    expect(sam.qualities.find((q) => q.name === 'Exceptional Attribute')).toMatchObject({ type: 'positive', karma: 14, note: 'str' });
    const wtl = sam.qualities.find((q) => q.name === 'Will to Live');
    expect(wtl).toMatchObject({ rating: 1, karma: 3 });
    expect(wtl?.mods.map((m) => [m.target, m.value])).toEqual([['monitor.overflow', 1]]);
    // Racial traits are derive's to read from the metatype — no extra line on the sheet.
    expect(sam.qualities).toHaveLength(6);
    const handEntered = vary(goldenSamurai(), (b) => void (b.qualities[3]!.mods = [mod('monitor.overflow', 1, 'quality')]));
    expect(compileBuild(handEntered, EXPERIENCED).sheet.qualities[3]?.mods).toHaveLength(1);
    // A second line of it (the validator's quality-once) never adds a second box.
    const twice = vary(goldenSamurai(), (b) => void b.qualities.push({ ...b.qualities[3]!, karma: 9, rating: 3 }));
    const boxes = compileBuild(twice, EXPERIENCED).sheet.qualities.flatMap((q) => q.mods.filter((m) => m.target === 'monitor.overflow'));
    expect(boxes.map((m) => m.value)).toEqual([1]);
  });

  it('writes each implant with its grade-applied Essence, grade and rating, and its item\'s modifiers', () => {
    const b = vary(cleanBuild(), (x) => {
      x.purchases.find((p) => p.name === 'Kit')!.cost = 30_000;
      x.purchases.push(augment('Wired Eye', 5_000, 0.5, { grade: 'alphaware', rating: 2 }) as never);
      x.purchases.push(augment('Dermal Plates', 2_000, 0.5, { grade: 'used', item: { name: 'Dermal Plates', essence: 0.5, mods: [mod('armor', 1)] } }) as never);
    });
    const { sheet } = compileBuild(b, EXPERIENCED);
    expect(sheet.augments).toEqual([
      { name: 'Wired Eye', essence: 0.4, mods: [], grade: 'alphaware', rating: 2 },
      { name: 'Dermal Plates', essence: 0.625, mods: [expect.objectContaining({ target: 'armor', value: 1 })], grade: 'used' },
    ]);
    expect(deriveCharacter(sheet).attributes['ess']?.value).toBeCloseTo(6 - 1.025, 10);
  });

  it('prices lifestyles by the month with the metatype and Dependents applied', () => {
    expect(compileBuild(goldenSamurai(), EXPERIENCED).sheet.lifestyles).toEqual([{ name: 'Low', costPerMonth: 4_000 }]);
    expect(compileBuild(goldenTechnomancer(), EXPERIENCED_RF).sheet.lifestyles).toEqual([
      { name: 'Middle', costPerMonth: 6_000 },
      { name: 'Low (safehouse)', costPerMonth: 2_400 },
    ]);
  });

  it('copies gear, weapons and armor items with the purchase\'s quantity and rating', () => {
    const sam = compileBuild(goldenSamurai(), EXPERIENCED).sheet;
    expect(sam.weapons).toEqual([{ name: 'Heavy Pistol', skillId: 'pistols', acc: 5, dv: '8P', ap: -1, modes: [] }]);
    expect(sam.armor).toEqual([{ name: 'Armor Jacket', rating: 12, worn: true }]);
    expect(sam.gear.find((g) => g.name === 'Commlink')).toEqual({ name: 'Commlink', qty: 1, rating: 3 });
    const two = vary(cleanBuild(), (b) => void (b.purchases.find((p) => p.name === 'Armor Jacket')!.qty = 2));
    expect(compileBuild(two, EXPERIENCED).sheet.armor.map((a) => a.worn)).toEqual([true, false]);
  });

  it('wears the best armor the builder bought, so the Armor pool counts it — the catalogue maps armor as stowed', () => {
    // A line the way the Gear step adds it: the sheet mapping says `worn: false`.
    const stowed = vary(goldenSamurai(), (b) => {
      const jacket = b.purchases.find((p) => p.list === 'armor')!;
      jacket.item = { name: 'Armor Jacket', rating: 12, worn: false };
      b.purchases.push({ list: 'armor', kind: 'armor', name: 'Crate Coat', cost: 900, qty: 1, rating: null, grade: null, avail: '2', item: { name: 'Crate Coat', rating: 9, worn: false } } as never);
    });
    const { sheet } = compileBuild(stowed, EXPERIENCED);
    expect(sheet.armor.map((a) => [a.name, a.worn])).toEqual([
      ['Armor Jacket', true],
      ['Crate Coat', false],
    ]);
    // 12 worn + the troll's dermal 1, as the golden reads with the jacket on.
    expect(deriveCharacter(sheet).pools['armor']?.total).toBe(13);
    // Only a lesser piece bought first: the better one still goes on, whatever the order.
    const order = vary(stowed, (b) => void b.purchases.reverse());
    expect(compileBuild(order, EXPERIENCED).sheet.armor.filter((a) => a.worn).map((a) => a.name)).toEqual(['Armor Jacket']);
  });

  it('derives the same pools the builder previews; a dim active scene is what takes one die off each on the sheet in play', () => {
    // The walk saw every skill pool one lower on the approved sheet than in the
    // builder. The builder's preview is compile → derive with no context; the
    // sheet in play adds the active scene's environment (a dim-light scene is
    // `pool.all −1`). Nothing in compile or derive is off by one.
    const { sheet } = compileBuild(goldenSamurai(), EXPERIENCED);
    const preview = deriveCharacter(sheet);
    const again = deriveCharacter(SheetV1Schema.parse(JSON.parse(JSON.stringify(sheet))));
    const dim = deriveCharacter(sheet, { situational: environment({ light: 1, visibility: 0, glare: 0, wind: 0 }) });
    const skills = Object.keys(preview.pools).filter((k) => k.startsWith('skill.'));
    expect(skills.length).toBeGreaterThan(0);
    for (const key of skills) {
      expect(again.pools[key]?.total, key).toBe(preview.pools[key]?.total);
      expect(dim.pools[key]?.total, key).toBe((preview.pools[key]?.total ?? 0) - 1);
    }
    // Damage resistance is exempt from the scene, as the pipeline says.
    expect(dim.pools['armor']?.total).toBe(preview.pools['armor']?.total);
    expect(dim.pools['soak']?.total).toBe(preview.pools['soak']?.total);
  });

  it("keeps a picked spell's drain code and note, and a form's fading and target, granted or bought (FR8.1)", () => {
    const b = vary(cleanMage(), (x) => {
      x.grants.spells = [{ name: 'Static Lash', category: 'combat', drain: 'F-3', note: 'type P · range LOS · damage S · duration I', ref: { book: 'SR5', page: 400 } }];
      x.karma.spends.push({ kind: 'spell', name: 'Quiet Glow', category: 'manipulation', drain: 'F-2' });
    });
    const { sheet } = compileBuild(b, EXPERIENCED);
    expect(sheet.spells.find((s) => s.name === 'Static Lash')).toEqual({
      name: 'Static Lash',
      category: 'combat',
      drain: 'F-3',
      ref: { book: 'SR5', page: 400 },
      note: 'type P · range LOS · damage S · duration I',
    });
    expect(sheet.spells.find((s) => s.name === 'Quiet Glow')).toEqual({ name: 'Quiet Glow', category: 'manipulation', drain: 'F-2' });
    const tech = vary(goldenTechnomancer(), (x) => void (x.grants.forms[0] = { ...x.grants.forms[0]!, fading: 'L+1', target: 'Device' }));
    expect(compileBuild(tech, EXPERIENCED_RF).sheet.complexForms[0]).toMatchObject({ fading: 'L+1', target: 'Device' });
  });

  it('writes the awakening block: kind, tradition, drain pair, mentor, power points, grade', () => {
    expect(compileBuild(goldenMysticAdept(), EXPERIENCED).awakening).toEqual({
      kind: 'mysticAdept',
      aspect: null,
      tradition: 'shamanic',
      drain: ['cha', 'wil'],
      mentor: 'The Tide',
      powerPoints: 2,
      // Nobody at an experienced table initiates at creation (SR5 p.64), so
      // the grade is 0 rather than absent — the sheet always carries a number.
      grade: 0,
    });
    expect(compileBuild(goldenTechnomancer(), EXPERIENCED_RF).awakening).toMatchObject({ kind: 'technomancer', drain: ['wil', 'res'] });
    expect(compileBuild(cleanAdept(), EXPERIENCED).awakening).toMatchObject({ kind: 'adept', drain: null, powerPoints: 4 });
    expect(compileBuild(cleanMage(), EXPERIENCED).awakening).toMatchObject({ drain: ['log', 'wil'] });
    expect(compileBuild(cleanBuild(), EXPERIENCED).awakening.kind).toBe('mundane');
  });

  it('carries identity through: alias, metatype, real name, age, and the background as notes', () => {
    const b = vary(goldenSamurai(), (x) => void Object.assign(x.identity, { realName: 'Dale Orrin', age: 31, sex: 'm' }));
    expect(compileBuild(b, EXPERIENCED).sheet.identity).toMatchObject({
      alias: 'Breakwater',
      metatype: 'troll',
      realName: 'Dale Orrin',
      age: 31,
      sex: 'm',
      notes: expect.stringContaining('Discharged'),
    });
  });
});

describe('compileBuild: what lands beside the sheet (§8.2)', () => {
  it('turns contacts into rows for the contacts table, role as archetype', () => {
    expect(compileBuild(goldenSamurai(), EXPERIENCED).contacts).toEqual([
      { name: 'Stitch', archetype: 'Street doc', connection: 3, loyalty: 2, notes: null },
      { name: 'Ledger', archetype: 'Fixer', connection: 2, loyalty: 2, notes: null },
    ]);
    const unnamed = vary(cleanBuild(), (b) => void (b.karma.contacts[0]!.name = ''));
    expect(compileBuild(unnamed, EXPERIENCED).contacts[0]?.name).toBe('Unnamed contact');
  });

  it('bound spirits at Force = Magic, sprites at Level = Resonance, foci as bonded (SR5 p.98)', () => {
    expect(compileBuild(goldenMysticAdept(), EXPERIENCED).spirits).toEqual([
      { spiritType: 'water', force: 6, services: 4, bound: true },
      { spiritType: 'beasts', force: 6, services: 4, bound: true },
    ]);
    expect(compileBuild(goldenTechnomancer(), EXPERIENCED_RF).sprites).toEqual([
      { spriteType: 'crack', level: 6, tasks: 3, registered: true },
      { spriteType: 'fault', level: 6, tasks: 3, registered: true },
    ]);
    const focused = vary(cleanMage(), (b) => void b.karma.spends.push({ kind: 'focus', name: 'Silver Ring', focusType: 'spell', force: 2, bondKarma: 4 }));
    expect(compileBuild(focused, EXPERIENCED).foci).toEqual([
      { name: 'Silver Ring', kind: 'spell', force: 2, bonded: true, bondKarma: 4, purchaseIndex: null, sourceKind: 'power', targets: [], mods: [] },
    ]);
  });

  it('gives each focus the Focus Table type it bonds as and the gear line it was bought as (SR5 p.318)', () => {
    const bought = vary(cleanMage(), (b) => {
      b.purchases.push({ list: 'gear', kind: 'gear', name: 'Sustaining Focus', cost: 8_000, rating: 2, avail: '(Rating x 3)R', item: { name: 'Sustaining Focus' } } as never);
      b.karma.spends.push({ kind: 'focus', name: 'Sustaining Focus', force: 2, bondKarma: 4 });
    });
    expect(compileBuild(bought, EXPERIENCED).foci).toEqual([
      { name: 'Sustaining Focus', kind: 'spell', force: 2, bonded: true, bondKarma: 4, purchaseIndex: 4, sourceKind: 'power', targets: [], mods: [] },
    ]);
  });

  it('carries what a focus feeds in play, as the player entered it, so a focus bonded at creation is not inert (FR8.4)', () => {
    const feeding = vary(cleanMage(), (b) => {
      b.purchases.push({ list: 'gear', kind: 'gear', name: 'Power Focus', cost: 18_000, rating: 1, avail: '(Rating x 4)R', item: { name: 'Power Focus' } } as never);
      b.karma.spends.push({
        kind: 'focus',
        name: 'Power Focus',
        force: 1,
        bondKarma: 6,
        sourceKind: 'power',
        targets: ['attr.mag'],
        mods: [mod('pool.skill.spellcasting', 1, 'power')],
      });
    });
    const [focus] = compileBuild(feeding, EXPERIENCED).foci;
    expect(focus).toMatchObject({ kind: 'power', force: 1, bondKarma: 6, purchaseIndex: 4, sourceKind: 'power', targets: ['attr.mag'] });
    expect(focus?.mods.map((m) => [m.target, m.value])).toEqual([['pool.skill.spellcasting', 1]]);
  });

  it('returns each lifestyle with its tier and months beside the sheet line, for the ledger\'s paid-through date', () => {
    const { sheet, lifestyles } = compileBuild(goldenTechnomancer(), EXPERIENCED_RF);
    expect(lifestyles).toEqual([
      { name: 'Middle', tier: 'middle', months: 12, costPerMonth: 6_000 },
      { name: 'Low (safehouse)', tier: 'low', months: 3, costPerMonth: 2_400 },
    ]);
    expect(lifestyles.map((l) => [l.name, l.costPerMonth])).toEqual(sheet.lifestyles.map((l) => [l.name, l.costPerMonth]));
  });

  it('returns the validator\'s issues with the compiled build', () => {
    const b = goldenMysticAdept();
    expect(compileBuild(b, EXPERIENCED).issues).toEqual(validate(b, EXPERIENCED));
  });

  it('compiles an empty draft too, so the rail can preview from the first tap', () => {
    const { sheet, opening, issues } = compileBuild(emptyBuild(EXPERIENCED), EXPERIENCED);
    expect(sheet.identity).toMatchObject({ alias: 'Unnamed runner', metatype: 'human' });
    expect(SheetV1Schema.parse(sheet)).toEqual(sheet);
    expect(deriveCharacter(sheet).monitors.physical.value).toBe(9);
    expect(opening).toEqual({ karma: 7, nuyenCarry: 0, startingNuyen: { dice: 1, multiplier: 20 } });
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
