/**
 * Career-mode advancement on a sheet in play (FR3.7, docs/CHARGEN.md §8.5):
 * what a spend is called, what it costs and trains, and every rule that
 * stops it — `chargen/advance.ts`'s play-time half, which the advance route
 * runs when a spend is asked for and again when the GM approves it.
 *
 * The goldens are the core book's downtime examples (SR5 p. 106) played on
 * the worked characters as `chargen-fixtures.ts` re-enters them, compiled
 * into the sheets they walk into play with: the troll samurai (here
 * Breakwater) spends his Karma on two skills from 2 to 3, 6 Karma and three
 * days each, and the elf mystic adept (Tidewater) takes Spellcasting from 5
 * to 6 for 12 Karma and six weeks — four and a half with an instructor, as
 * the example prints it — and Locksmith from 2 to 3 for 6 Karma and three
 * days. Both have Logic 3, so a skills-only downtime trains two skills.
 * The book says the samurai's Karma is spent after his two raises; 21 less
 * 12 leaves 9, and that is what is asserted (§8.7: the rules, not the
 * misprints).
 *
 * Then one test per play-time rule, on small sheets with invented names.
 *
 * Numbers only; invented names (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import { AdvanceMutationSchema, SheetV1Schema, type KarmaSpend, type SheetV1 } from '@safehouse/contracts';
import {
  ADVANCE_LABEL_MAX,
  DOWNTIME_LIMITS,
  MAX_TRAINING_STEPS,
  advanceCurrentRating,
  advanceKey,
  advanceLabel,
  advanceRefusals,
  applySpend,
  attributeMaxInPlay,
  compileBuild,
  groupStanding,
  playFacts,
  playMagicKind,
  quoteAdvance,
  trainingPhrase,
  trainingTimeOf,
} from '../src/index.js';
import { EXPERIENCED, goldenMysticAdept, goldenSamurai } from './chargen-fixtures.js';

type SheetInput = Parameters<typeof SheetV1Schema.parse>[0];

function sheet(over: Partial<SheetInput> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Gutterlight', metatype: 'human' },
    attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 3 }, mag: 0, res: 0 },
    skills: [
      { id: 'pistols', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'longarms', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'automatics', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'con', rating: 2, attr: 'cha' },
    ],
    knowledge: [{ name: 'Safehouses', category: 'street', rating: 2 }],
    languages: [
      { name: 'English', native: true },
      { name: 'Cantonese', rating: 1 },
    ],
    ...over,
  } as SheetInput);
}

const codes = (s: SheetV1, spend: KarmaSpend, pending?: KarmaSpend[]) =>
  advanceRefusals(s, spend, pending ? { pending } : {}).map((r) => r.code);

describe('the downtime examples (SR5 p.106) on the worked characters in play', () => {
  it('the samurai trains Throwing Weapons and Pistols 2 → 3: 6 Karma and 3 days each, 9 of 21 Karma left', () => {
    const played = compileBuild(goldenSamurai(), EXPERIENCED).sheet;
    expect(Math.ceil(played.attributes.log / DOWNTIME_LIMITS.skillsOnlyLogicDivisor)).toBe(2);
    const raises: KarmaSpend[] = [
      { kind: 'skill', id: 'throwing-weapons', from: 2, to: 3 },
      { kind: 'skill', id: 'pistols', from: 2, to: 3 },
    ];
    let karma = 21;
    let s = played;
    for (const spend of raises) {
      expect(advanceCurrentRating(s, spend)).toBe(2);
      const quote = quoteAdvance(s, spend);
      expect(quote.refusals).toEqual([]);
      expect(quote.cost).toBe(6);
      expect(trainingPhrase(quote.training)).toBe('3 days');
      karma -= quote.cost;
      s = applySpend(s, spend);
    }
    expect(karma).toBe(9);
    expect(s.skills.find((k) => k.id === 'throwing-weapons')?.rating).toBe(3);
    expect(s.skills.find((k) => k.id === 'pistols')?.rating).toBe(3);
    // Applied, the raise is spent: asking for it again is stale.
    expect(codes(s, raises[1]!)).toEqual(['advance-stale']);
  });

  it('the mystic adept takes Spellcasting 5 → 6 for 12 Karma, 6 weeks or 4.5 with an instructor, and Locksmith 2 → 3 for 6', () => {
    const played = compileBuild(goldenMysticAdept(), EXPERIENCED).sheet;
    expect(played.attributes.log).toBe(3);
    expect(playMagicKind(played)).toBe('mysticAdept');
    const spellcasting: KarmaSpend = { kind: 'skill', id: 'spellcasting', from: 5, to: 6 };
    const quote = quoteAdvance(played, spellcasting);
    expect(quote).toMatchObject({ label: 'Raise Spellcasting 5 → 6', cost: 12, refusals: [] });
    expect(quote.reason).toBe('Raise Spellcasting 5 → 6 · 12 Karma');
    expect(trainingPhrase(quote.training)).toBe('6 weeks');
    expect(trainingPhrase(quoteAdvance(played, spellcasting, { instructor: true }).training)).toBe('4.5 weeks');
    const locksmith = quoteAdvance(played, { kind: 'skill', id: 'locksmith', from: 2, to: 3 });
    expect(locksmith).toMatchObject({ cost: 6, refusals: [] });
    expect(trainingPhrase(locksmith.training)).toBe('3 days');
  });

  it("keeps the creation fence in play: the mystic adept's Assensing still needs astral perception (p.142)", () => {
    const played = compileBuild(goldenMysticAdept(), EXPERIENCED).sheet;
    const refusals = advanceRefusals(played, { kind: 'skill', id: 'assensing', from: 3, to: 4 });
    expect(refusals.map((r) => r.code)).toEqual(['advance-skill-fenced']);
    expect(refusals[0]?.ref).toEqual({ book: 'SR5', page: 142 });
  });
});

describe('what a spend is called', () => {
  it('names each kind in our words, as the ledger shows them', () => {
    const cases: [KarmaSpend, string][] = [
      [{ kind: 'attribute', id: 'agi', from: 4, to: 5 }, 'Raise Agility 4 → 5'],
      [{ kind: 'skill', id: 'pistols', from: 0, to: 1 }, 'Learn Pistols at 1'],
      [{ kind: 'skill', id: 'exotic-ranged', target: 'Net gun', from: 1, to: 2 }, 'Raise Exotic Ranged Weapon: Net gun 1 → 2'],
      [{ kind: 'group', id: 'firearms', from: 3, to: 4 }, 'Raise Firearms group 3 → 4'],
      [{ kind: 'knowledge', name: 'Corp Law', category: 'academic', from: 0, to: 1 }, 'Learn Corp Law at 1'],
      [{ kind: 'language', name: 'Cantonese', from: 1, to: 2 }, 'Raise Cantonese 1 → 2'],
      [{ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }, 'Specialise Pistols: Revolvers'],
      [{ kind: 'spell', name: 'Flash', category: 'combat' }, 'Learn spell Flash'],
      [{ kind: 'spell', name: 'Ward Circle', category: 'ritual' }, 'Learn ritual Ward Circle'],
      [{ kind: 'form', name: 'Loop' }, 'Learn complex form Loop'],
      [{ kind: 'powerPoint', count: 1 }, 'Buy 1 power point'],
    ];
    for (const [spend, label] of cases) expect(advanceLabel(spend)).toBe(label);
  });

  it('quotes the ledger line with the price (p.107): "Raise Agility 4 → 5 · 25 Karma"', () => {
    expect(quoteAdvance(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 5 }).reason).toBe('Raise Agility 4 → 5 · 25 Karma');
  });

  it('keys what is improved, so two asks for one thing collide and different things do not', () => {
    expect(advanceKey({ kind: 'skill', id: 'Unarmed Combat', from: 1, to: 2 })).toBe(
      advanceKey({ kind: 'skill', id: 'unarmed_combat', from: 2, to: 3 }),
    );
    expect(advanceKey({ kind: 'skill', id: 'exotic-ranged', target: 'Net gun', from: 1, to: 2 })).not.toBe(
      advanceKey({ kind: 'skill', id: 'exotic-ranged', target: 'Sling', from: 1, to: 2 }),
    );
    expect(advanceKey({ kind: 'powerPoint', count: 1 })).toBe(advanceKey({ kind: 'powerPoint', count: 2 }));
  });

  it('says a training time as days, weeks, a mixed run, or none (p.107)', () => {
    expect(trainingPhrase(trainingTimeOf({ kind: 'skill', id: 'pistols', from: 0, to: 1 }))).toBe('1 day');
    expect(trainingPhrase(trainingTimeOf({ kind: 'skill', id: 'pistols', from: 3, to: 5 }))).toBe('4 days, then 5 weeks');
    expect(trainingPhrase(trainingTimeOf({ kind: 'group', id: 'firearms', from: 3, to: 4 }))).toBe('8 weeks');
    expect(trainingPhrase(trainingTimeOf({ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }))).toBe('1 month');
    // An instructor cuts rating training by a quarter (p.105); a specialisation's
    // month is dedicated, undivided training, so it stays a month.
    const specialisation: KarmaSpend = { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' };
    expect(trainingPhrase(trainingTimeOf(specialisation, { instructor: true }))).toBe('1 month');
    expect(trainingPhrase(trainingTimeOf({ kind: 'attribute', id: 'edg', from: 3, to: 4 }))).toBe('no training time');
    expect(trainingPhrase(trainingTimeOf({ kind: 'spell', name: 'Flash' }))).toBe('no training time');
  });

  it('adds Dependents to the quoted training time (p.80)', () => {
    const s = sheet({ qualities: [{ name: 'Dependents', type: 'negative', karma: 3, rating: 1 }] });
    expect(trainingPhrase(quoteAdvance(s, { kind: 'attribute', id: 'log', from: 3, to: 4 }).training)).toBe('6 weeks');
  });
});

describe('ratings: the spend must start where the sheet is and go up', () => {
  it('refuses a raise from a rating the sheet has moved past, and one that raises nothing', () => {
    expect(codes(sheet(), { kind: 'attribute', id: 'agi', from: 3, to: 4 })).toEqual(['advance-stale']);
    expect(codes(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 4 })).toEqual(['advance-no-raise']);
    expect(codes(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 5 })).toEqual([]);
    expect(advanceRefusals(sheet(), { kind: 'attribute', id: 'agi', from: 3, to: 4 })[0]?.message).toBe('Agility is 4 now, not 3.');
  });

  it('refuses asking again for what is already waiting on the GM', () => {
    const pending: KarmaSpend[] = [{ kind: 'attribute', id: 'agi', from: 4, to: 5 }];
    expect(codes(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 5 }, pending)).toEqual(['advance-pending']);
    expect(codes(sheet(), { kind: 'attribute', id: 'log', from: 3, to: 4 }, pending)).toEqual([]);
  });

  it('matches an imported skill id to the table and raises it in place', () => {
    const s = sheet({ skills: [{ id: 'unarmed_combat', rating: 2, attr: 'agi' }] });
    const spend: KarmaSpend = { kind: 'skill', id: 'unarmed-combat', from: 2, to: 3 };
    expect(advanceCurrentRating(s, spend)).toBe(2);
    expect(codes(s, spend)).toEqual([]);
    expect(applySpend(s, spend).skills).toEqual([{ id: 'unarmed_combat', rating: 3, attr: 'agi', group: null }]);
  });
});

describe('attributes in play (pp. 66, 72, 76)', () => {
  it("stops at the metatype's natural maximum, one more for the attribute Exceptional Attribute names", () => {
    const human = sheet({ attributes: { ...sheet().attributes, agi: 6 } });
    expect(attributeMaxInPlay(human, 'agi')).toBe(6);
    expect(codes(human, { kind: 'attribute', id: 'agi', from: 6, to: 7 })).toEqual(['advance-attribute-max']);
    const exceptional = sheet({
      attributes: { ...sheet().attributes, agi: 6 },
      qualities: [{ name: 'Exceptional Attribute (Agility)', type: 'positive', karma: 14 }],
    });
    expect(codes(exceptional, { kind: 'attribute', id: 'agi', from: 6, to: 7 })).toEqual([]);
    expect(codes(exceptional, { kind: 'attribute', id: 'agi', from: 7, to: 8 })).toEqual(['advance-stale', 'advance-attribute-max']);
    // A compiled sheet carries the target as the quality's note.
    const noted = sheet({ identity: { alias: 'Slab', metatype: 'troll' }, qualities: [{ name: 'Exceptional Attribute', note: 'str' }] });
    expect(attributeMaxInPlay(noted, 'str')).toBe(11);
  });

  it('caps Edge by the metatype, one more with Lucky', () => {
    expect(attributeMaxInPlay(sheet(), 'edg')).toBe(7);
    expect(attributeMaxInPlay(sheet({ qualities: [{ name: 'Lucky' }] }), 'edg')).toBe(8);
    expect(codes(sheet(), { kind: 'attribute', id: 'edg', from: 3, to: 4 })).toEqual([]);
  });

  it('leaves the maximum open for a metatype the tables do not know', () => {
    const odd = sheet({ identity: { alias: 'Umbral', metatype: 'something new' }, attributes: { ...sheet().attributes, str: 9 } });
    expect(attributeMaxInPlay(odd, 'str')).toBeNull();
    expect(codes(odd, { kind: 'attribute', id: 'str', from: 9, to: 10 })).toEqual([]);
  });

  it('raises Magic only for the Awakened and Resonance only for technomancers, both to 6', () => {
    expect(codes(sheet(), { kind: 'attribute', id: 'mag', from: 0, to: 1 })).toEqual(['advance-attribute-absent']);
    expect(codes(sheet(), { kind: 'attribute', id: 'res', from: 0, to: 1 })).toEqual(['advance-attribute-absent']);
    const mage = sheet({ attributes: { ...sheet().attributes, mag: 6 }, awakening: { kind: 'magician' } });
    expect(codes(mage, { kind: 'attribute', id: 'mag', from: 6, to: 7 })).toEqual(['advance-attribute-max']);
    const techno = sheet({ attributes: { ...sheet().attributes, res: 5 }, awakening: { kind: 'technomancer' } });
    expect(codes(techno, { kind: 'attribute', id: 'res', from: 5, to: 6 })).toEqual([]);
  });
});

describe('skills and groups in play (pp. 88–89)', () => {
  it('stops a skill at 12, the one Aptitude names at 13', () => {
    const s = sheet({ skills: [{ id: 'pistols', rating: 12, attr: 'agi' }] });
    expect(codes(s, { kind: 'skill', id: 'pistols', from: 12, to: 13 })).toEqual(['advance-skill-max']);
    const apt = sheet({ skills: [{ id: 'pistols', rating: 12, attr: 'agi' }], qualities: [{ name: 'Aptitude (Pistols)' }] });
    expect(codes(apt, { kind: 'skill', id: 'pistols', from: 12, to: 13 })).toEqual([]);
    expect(codes(apt, { kind: 'skill', id: 'pistols', from: 12, to: 14 })).toEqual(['advance-skill-max']);
  });

  it('refuses a skill the tables do not know, and a Magic skill without Magic (p.89)', () => {
    expect(codes(sheet(), { kind: 'skill', id: 'basket-weaving', from: 0, to: 1 })).toEqual(['advance-skill-unknown']);
    const fenced = advanceRefusals(sheet(), { kind: 'skill', id: 'spellcasting', from: 0, to: 1 });
    expect(fenced.map((r) => r.code)).toEqual(['advance-skill-fenced']);
    expect(fenced[0]?.message).toBe('Spellcasting needs a Magic rating and a magic-using type.');
    const conjurer = sheet({ attributes: { ...sheet().attributes, mag: 4 }, awakening: { kind: 'aspected', aspect: 'conjuring' } });
    expect(codes(conjurer, { kind: 'skill', id: 'spellcasting', from: 0, to: 1 })).toEqual(['advance-skill-fenced']);
    expect(codes(conjurer, { kind: 'skill', id: 'summoning', from: 0, to: 1 })).toEqual([]);
  });

  it('keeps the group Incompetent names closed, members and all (p.81)', () => {
    const s = sheet({ qualities: [{ name: 'Incompetent (Firearms)', type: 'negative', karma: 5 }] });
    expect(codes(s, { kind: 'skill', id: 'pistols', from: 3, to: 4 })).toEqual(['advance-skill-fenced']);
  });

  it('raises a group only while its skills sit level and unspecialised, to 12', () => {
    expect(groupStanding(sheet(), 'firearms')?.level).toBe(3);
    expect(codes(sheet(), { kind: 'group', id: 'firearms', from: 3, to: 4 })).toEqual([]);
    const uneven = applySpend(sheet(), { kind: 'skill', id: 'pistols', from: 3, to: 4 });
    const broken = advanceRefusals(uneven, { kind: 'group', id: 'firearms', from: 3, to: 4 });
    expect(broken.map((r) => r.code)).toEqual(['advance-group-broken']);
    expect(broken[0]?.message).toBe('Firearms cannot be raised as a group while its skills differ: Automatics 3, Longarms 3, Pistols 4.');
    // The unlevel rule is p.88; the specialisation that breaks a group for good is p.89.
    expect(broken[0]?.ref).toEqual({ book: 'SR5', page: 88 });
    const specced = applySpend(sheet(), { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' });
    expect(codes(specced, { kind: 'group', id: 'firearms', from: 3, to: 4 })).toEqual(['advance-group-broken']);
    expect(advanceRefusals(specced, { kind: 'group', id: 'firearms', from: 3, to: 4 })[0]?.ref).toEqual({ book: 'SR5', page: 89 });
    expect(advanceCurrentRating(specced, { kind: 'group', id: 'firearms', from: 3, to: 4 })).toBeNull();
    // A group nobody has yet is level at 0.
    expect(codes(sheet(), { kind: 'group', id: 'athletics', from: 0, to: 1 })).toEqual([]);
    const top = sheet({ skills: ['pistols', 'longarms', 'automatics'].map((id) => ({ id, rating: 12, attr: 'agi' as const })) });
    expect(codes(top, { kind: 'group', id: 'firearms', from: 12, to: 13 })).toEqual(['advance-group-max']);
    expect(codes(sheet(), { kind: 'group', id: 'juggling', from: 0, to: 1 })).toEqual(['advance-group-unknown']);
  });
});

describe('knowledge, languages and specialisations in play', () => {
  it('asks a new knowledge skill for its category and stops at 12', () => {
    expect(codes(sheet(), { kind: 'knowledge', name: 'Corp Law', from: 0, to: 1 })).toEqual(['advance-knowledge-category']);
    expect(codes(sheet(), { kind: 'knowledge', name: 'Corp Law', category: 'academic', from: 0, to: 1 })).toEqual([]);
    expect(codes(sheet(), { kind: 'knowledge', name: 'safehouses', from: 2, to: 3 })).toEqual([]);
    const deep = sheet({ knowledge: [{ name: 'Safehouses', category: 'street', rating: 12 }] });
    expect(codes(deep, { kind: 'knowledge', name: 'Safehouses', from: 12, to: 13 })).toEqual(['advance-knowledge-max']);
  });

  it('prices a held knowledge skill by the category the sheet holds, not the one the request claims (pp. 87, 89)', () => {
    // Uneducated doubles academic, professional and technical costs (p.87).
    const uneducated = sheet({
      qualities: [{ name: 'Uneducated', type: 'negative', karma: 8 }],
      knowledge: [{ name: 'Forensics', category: 'academic', rating: 2 }],
    });
    const raise: KarmaSpend = { kind: 'knowledge', name: 'Forensics', from: 2, to: 3 };
    expect(quoteAdvance(uneducated, raise).cost).toBe(6);
    const claimed: KarmaSpend = { ...raise, category: 'street' };
    expect(quoteAdvance(uneducated, claimed).cost).toBe(6);
    const refusals = advanceRefusals(uneducated, claimed);
    expect(refusals.map((r) => r.code)).toEqual(['advance-knowledge-category']);
    expect(refusals[0]?.message).toBe('Forensics is filed as academic, not street.');
    // The category the sheet holds, said again, is no contradiction.
    expect(codes(uneducated, { ...raise, category: 'academic' })).toEqual([]);
  });

  it('has no rating to raise on a native language', () => {
    expect(codes(sheet(), { kind: 'language', name: 'English', from: 0, to: 1 })).toEqual(['advance-language-native']);
    expect(codes(sheet(), { kind: 'language', name: 'Cantonese', from: 1, to: 2 })).toEqual([]);
  });

  it('specialises a skill the character has, never twice the same, never a group (p.89)', () => {
    expect(codes(sheet(), { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' })).toEqual([]);
    expect(codes(sheet(), { kind: 'specialization', list: 'active', id: 'blades', spec: 'Knives' })).toEqual(['advance-spec-without-skill']);
    expect(codes(sheet(), { kind: 'specialization', list: 'active', id: 'firearms', spec: 'Pistols' })).toEqual(['advance-spec-on-group']);
    const specced = applySpend(sheet(), { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' });
    expect(codes(specced, { kind: 'specialization', list: 'active', id: 'pistols', spec: 'revolvers' })).toEqual(['advance-spec-held']);
    expect(codes(sheet(), { kind: 'specialization', list: 'knowledge', id: 'Safehouses', spec: 'Downtown' })).toEqual([]);
    expect(codes(sheet(), { kind: 'specialization', list: 'knowledge', id: 'Corp Law', spec: 'Mergers' })).toEqual([
      'advance-spec-without-skill',
    ]);
    expect(codes(sheet(), { kind: 'specialization', list: 'language', id: 'English', spec: 'Street slang' })).toEqual([]);
  });
});

describe('spells, complex forms and power points in play (pp. 69, 107)', () => {
  it('teaches spells to casters and preparations to enchanters, never the same formula twice', () => {
    expect(codes(sheet(), { kind: 'spell', name: 'Flash', category: 'combat' })).toEqual(['advance-formula-not-caster']);
    const mage = sheet({ attributes: { ...sheet().attributes, mag: 4 }, awakening: { kind: 'magician' }, spells: [{ name: 'Flash' }] });
    expect(codes(mage, { kind: 'spell', name: 'Mend', category: 'health' })).toEqual([]);
    expect(codes(mage, { kind: 'spell', name: 'flash', category: 'combat' })).toEqual(['advance-formula-held']);
    const enchanter = sheet({ attributes: { ...sheet().attributes, mag: 4 }, awakening: { kind: 'aspected', aspect: 'enchanting' } });
    expect(codes(enchanter, { kind: 'spell', name: 'Mend', category: 'health' })).toEqual(['advance-formula-not-caster']);
    expect(codes(enchanter, { kind: 'spell', name: 'Mend Draught', category: 'preparation' })).toEqual([]);
    // An imported sheet with Magic and no Awakened block reads as a magician.
    const imported = sheet({ attributes: { ...sheet().attributes, mag: 3 } });
    expect(playMagicKind(imported)).toBe('magician');
    expect(codes(imported, { kind: 'spell', name: 'Mend', category: 'health' })).toEqual([]);
  });

  it('teaches complex forms to technomancers only', () => {
    expect(codes(sheet(), { kind: 'form', name: 'Loop' })).toEqual(['advance-form-not-technomancer']);
    const techno = sheet({ attributes: { ...sheet().attributes, res: 4 }, complexForms: [{ name: 'Loop' }] });
    expect(playMagicKind(techno)).toBe('technomancer');
    expect(codes(techno, { kind: 'form', name: 'Static Veil' })).toEqual([]);
    expect(codes(techno, { kind: 'form', name: 'loop' })).toEqual(['advance-form-held']);
  });

  it('leaves a mystic adept’s power points to creation: Karma buys none in play (p.69, p.279)', () => {
    const mystic = sheet({
      attributes: { ...sheet().attributes, mag: 5 },
      awakening: { kind: 'mysticAdept', powerPoints: 3 },
      augments: [{ name: 'Datajack', essence: 0.1 }],
    });
    expect(playFacts(mystic).effectiveMagic).toBe(4);
    const refused = advanceRefusals(mystic, { kind: 'powerPoint', count: 1 });
    expect(refused.map((r) => r.code)).toEqual(['advance-not-in-play']);
    expect(refused[0]?.ref).toEqual({ book: 'SR5', page: 279 });
    // Mundane or adept, the answer is the same one.
    expect(codes(sheet(), { kind: 'powerPoint', count: 1 })).toEqual(['advance-not-in-play']);
  });

  it('gives an adept the free power point that comes with a Magic rating, and a mystic adept none (p.279)', () => {
    const adept = sheet({
      attributes: { ...sheet().attributes, mag: 4 },
      awakening: { kind: 'adept', powerPoints: 4 },
      powers: [{ name: 'Sure Step', cost: 0.5 }],
    });
    const raise: KarmaSpend = { kind: 'attribute', id: 'mag', from: 4, to: 5 };
    const quote = quoteAdvance(adept, raise);
    expect(quote.cost).toBe(25);
    expect(quote.label).toBe('Raise Magic 4 → 5 (+1 power point)');
    expect(quote.reason).toBe('Raise Magic 4 → 5 (+1 power point) · 25 Karma');
    const after = applySpend(adept, raise, { inPlay: true });
    expect(after.attributes.mag).toBe(5);
    expect(after.awakening.powerPoints).toBe(5);
    // Two ratings at once bring two points with them.
    expect(applySpend(adept, { kind: 'attribute', id: 'mag', from: 4, to: 6 }, { inPlay: true }).awakening.powerPoints).toBe(6);
    const mystic = sheet({
      attributes: { ...sheet().attributes, mag: 4 },
      awakening: { kind: 'mysticAdept', powerPoints: 2 },
      powers: [{ name: 'Sure Step', cost: 0.5 }],
      spells: [{ name: 'Harbour Fog' }],
    });
    const mysticRaise: KarmaSpend = { kind: 'attribute', id: 'mag', from: 4, to: 5 };
    expect(advanceLabel(mysticRaise, mystic)).toBe('Raise Magic 4 → 5');
    expect(applySpend(mystic, mysticRaise, { inPlay: true }).awakening.powerPoints).toBe(2);
  });

  it('prices Magic and Resonance from the rating left after Essence loss, and caps at the reduced maximum (p.278)', () => {
    // The book's worked example: Magic 4, one implant of 0.2 Essence, so the
    // current rating is 3 and the maximum 5.
    const mage = sheet({
      attributes: { ...sheet().attributes, mag: 4 },
      awakening: { kind: 'magician' },
      augments: [{ name: 'Reflex spur', essence: 0.2 }],
    });
    expect(playFacts(mage).effectiveMagic).toBe(3);
    expect(attributeMaxInPlay(mage, 'mag')).toBe(5);
    expect(advanceCurrentRating(mage, { kind: 'attribute', id: 'mag', from: 3, to: 4 })).toBe(3);
    const first = quoteAdvance(mage, { kind: 'attribute', id: 'mag', from: 3, to: 4 });
    expect(first).toMatchObject({ label: 'Raise Magic 3 → 4', cost: 20, refusals: [] });
    expect(quoteAdvance(mage, { kind: 'attribute', id: 'mag', from: 4, to: 5 }).cost).toBe(25);
    expect(quoteAdvance(mage, { kind: 'attribute', id: 'mag', from: 3, to: 5 }).cost).toBe(45);
    // The stored rating is the natural one: buying the point back raises it by one.
    const bought = applySpend(mage, { kind: 'attribute', id: 'mag', from: 3, to: 4 }, { inPlay: true });
    expect(bought.attributes.mag).toBe(5);
    expect(playFacts(bought).effectiveMagic).toBe(4);
    // Past the reduced maximum the rule says so, and the ladder starts where the sheet is.
    expect(codes(mage, { kind: 'attribute', id: 'mag', from: 5, to: 6 })).toEqual(['advance-stale', 'advance-attribute-max']);
    expect(codes(mage, { kind: 'attribute', id: 'mag', from: 4, to: 5 })).toEqual(['advance-stale']);
    const techno = sheet({
      attributes: { ...sheet().attributes, res: 5 },
      awakening: { kind: 'technomancer' },
      augments: [{ name: 'Datajack', essence: 0.1 }],
    });
    expect(advanceCurrentRating(techno, { kind: 'attribute', id: 'res', from: 4, to: 5 })).toBe(4);
    expect(attributeMaxInPlay(techno, 'res')).toBe(5);
    expect(quoteAdvance(techno, { kind: 'attribute', id: 'res', from: 4, to: 5 }).cost).toBe(25);
  });

  it('leaves bound spirits, registered sprites and bonded foci to creation', () => {
    for (const spend of [
      { kind: 'spirit', type: 'air', services: 2 },
      { kind: 'sprite', type: 'data', tasks: 2 },
      { kind: 'focus', name: 'Ring', force: 1, bondKarma: 2 },
    ] as const) {
      expect(codes(sheet(), spend)).toEqual(['advance-not-in-play']);
    }
  });
});

describe('what the quote says besides the price', () => {
  it('names the downtime ceiling a raise passes, and nothing when it fits (pp. 105–106)', () => {
    const attribute = quoteAdvance(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 6 });
    expect(attribute.notes).toEqual([]);
    const tooFar = quoteAdvance(sheet(), { kind: 'attribute', id: 'agi', from: 4, to: 7 });
    expect(tooFar.notes.map((n) => n.message)).toEqual(['One downtime raises an attribute by 2 ratings; this asks for 3.']);
    expect(tooFar.notes[0]?.ref).toEqual({ book: 'SR5', page: 105 });
    const skill = quoteAdvance(sheet(), { kind: 'skill', id: 'pistols', from: 3, to: 7 });
    expect(skill.notes.map((n) => n.message)).toEqual(['One downtime raises a skill by 3 ratings; this asks for 4.']);
    expect(skill.notes[0]?.ref).toEqual({ book: 'SR5', page: 106 });
    expect(quoteAdvance(sheet(), { kind: 'skill', id: 'pistols', from: 3, to: 6 }).notes).toEqual([]);
    const group = quoteAdvance(sheet(), { kind: 'group', id: 'firearms', from: 3, to: 5 });
    expect(group.notes.map((n) => n.message)).toEqual(['One downtime raises a skill group by 1 rating; this asks for 2.']);
    expect(quoteAdvance(sheet(), { kind: 'group', id: 'firearms', from: 3, to: 4 }).notes).toEqual([]);
    const knowledge = quoteAdvance(sheet(), { kind: 'knowledge', name: 'Safehouses', from: 2, to: 8 });
    expect(knowledge.notes.map((n) => n.message)).toEqual(['One downtime raises a skill by 3 ratings; this asks for 6.']);
  });

  it('keeps a label short enough for the ledger to store it, whatever a player types', () => {
    const long = 'x'.repeat(200);
    const s = sheet({ knowledge: [{ name: long, category: 'street', rating: 2 }] });
    const spend: KarmaSpend = { kind: 'specialization', list: 'knowledge', id: long, spec: long };
    const quote = quoteAdvance(s, spend);
    expect(quote.refusals).toEqual([]);
    expect(quote.label.length).toBeLessThanOrEqual(ADVANCE_LABEL_MAX);
    expect(quote.label.endsWith('…')).toBe(true);
    // What the route writes must read back, or approving it applies nothing.
    const advance = {
      kind: 'advance' as const,
      spend,
      cost: quote.cost,
      trainingTime: { steps: [...quote.training.steps], total: quote.training.total },
      label: quote.label,
    };
    expect(AdvanceMutationSchema.safeParse(advance).success).toBe(true);
  });

  it('never walks more than a handful of rating steps, whatever rating is asked for', () => {
    const started = Date.now();
    const training = trainingTimeOf({ kind: 'skill', id: 'pistols', from: 0, to: 1_000_000_000 });
    expect(training.steps.length).toBeLessThanOrEqual(MAX_TRAINING_STEPS);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
