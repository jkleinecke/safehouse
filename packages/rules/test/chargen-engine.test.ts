/**
 * The character-creation engine's arithmetic (`chargen/ratings.ts`,
 * `budget.ts`, `build.ts`, `steps.ts`; FR3.9, docs/CHARGEN.md §4.2, §4.4,
 * §5 P1, §8.4).
 *
 * The worked characters come first: their decisions, re-entered in
 * `chargen-fixtures.ts`, must reproduce the chapter's point totals — 16/24/20
 * attribute points, Resonance 6, 10 Karma for 2 power points, 16/12/14
 * knowledge points, 9/9/18 contact Karma, and the Karma each carries (with
 * the book's own slips corrected as §8.7 records). Their gear is the book's
 * list-price total, lumped; the nuyen they carry is worked out here from
 * Resources, conversion, lifestyles and that total, never read back off the
 * engine, and the itemised prices are `chargen-goldens.test.ts`'s. Then each
 * pool on its own: special points, skill and group points with knowledge
 * ranks bought from skill points, Sum to Ten's ten points, implant grades,
 * Dependents and the metatype lifestyle multiplier, Karma to nuyen, contact
 * Karma at prime, power points, the spell/form/foci caps, and the doubling
 * Uncouth and Uneducated bring. Last, the walkthrough's step gating and the
 * small updaters the UI edits a draft with.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import {
  BudgetsSchema,
  BuildPurchaseSchema,
  CharacterBuildSchema,
  ChargenSettingsSchema,
  type CharacterBuild,
} from '@safehouse/contracts';
import {
  BUILD_ATTRIBUTE_NAMES,
  ELIGIBILITY_REFS,
  ISSUE_RULES,
  activeSkillRow,
  eligibilityMessage,
  freeKnowledgePoints,
  grantPoolIncludes,
  powerPointsBought,
  setPowerPointsBought,
  budgets,
  buildPricing,
  doublesGroup,
  doublesKnowledge,
  doublesSkill,
  doublesSpecialization,
  groupEligibility,
  karmaCostOf,
  skillEligibility,
  tallyBuild,
  effectiveTables,
  emptyBuild,
  isBioware,
  isDevice,
  parseAvailability,
  purchaseAvailability,
  purchaseCost,
  purchaseDeviceRating,
  purchaseEssence,
  compileBuild,
  qualityEffects,
  ratings,
  setAttributePoints,
  setMagicKind,
  setMetatype,
  setMethod,
  setPriority,
  setSpecialPoints,
  stepStatus,
  validate,
} from '../src/index.js';
import {
  EXPERIENCED,
  EXPERIENCED_RF,
  augment,
  build,
  cleanAdept,
  cleanBuild,
  cleanMage,
  cleanTechnomancer,
  goldenMysticAdept,
  goldenSamurai,
  goldenTechnomancer,
  settings,
  vary,
} from './chargen-fixtures.js';

const clean = cleanBuild();

describe('budgets: the three worked characters (§5 P1, §8.7)', () => {
  const tech = budgets(goldenTechnomancer(), EXPERIENCED_RF);
  const sam = budgets(goldenSamurai(), EXPERIENCED);
  const mystic = budgets(goldenMysticAdept(), EXPERIENCED);

  it('spends 16 / 24 / 20 attribute points, every one', () => {
    expect([tech, sam, mystic].map((b) => b.pools.attributes)).toEqual([
      { available: 16, spent: 16, remaining: 0 },
      { available: 24, spent: 24, remaining: 0 },
      { available: 20, spent: 20, remaining: 0 },
    ]);
  });

  it('gives the human 3 special points on D and the troll and elf none (SR5 p.65)', () => {
    expect(tech.pools.special).toEqual({ available: 3, spent: 3, remaining: 0 });
    expect(sam.pools.special.available).toBe(0);
    expect(mystic.pools.special.available).toBe(0);
  });

  it('reaches Resonance 6 on the technomancer (B gives 4, special points 2) and Magic 6 on the mystic adept', () => {
    expect(tech.preview?.resonance).toBe(6);
    expect(mystic.preview?.magic).toBe(6);
    expect(ratings(goldenTechnomancer(), EXPERIENCED_RF).attributes.res).toMatchObject({ base: 4, points: 2, rating: 6 });
  });

  it('gives 16 / 12 / 14 free knowledge points, (INT + LOG) × 2, all spent (SR5 p.89)', () => {
    expect([tech, sam, mystic].map((b) => [b.pools.knowledge.available, b.pools.knowledge.remaining])).toEqual([
      [16, 0],
      [12, 0],
      [14, 0],
    ]);
  });

  it('gives 9 / 9 / 18 contact Karma, Charisma × 3, all spent (SR5 p.98)', () => {
    expect([tech, sam, mystic].map((b) => b.pools.contactKarma)).toEqual([
      { available: 9, spent: 9, remaining: 0 },
      { available: 9, spent: 9, remaining: 0 },
      { available: 18, spent: 18, remaining: 0 },
    ]);
  });

  it('leaves 0 / 1 / 2 Karma — the samurai has 15 after converting, not 16 (§8.7)', () => {
    expect([tech, sam, mystic].map((b) => b.pools.karma.remaining)).toEqual([0, 1, 2]);
    expect([tech, sam, mystic].map((b) => b.preview?.karmaCarried)).toEqual([0, 1, 2]);
    // Before Step 8: 26 / 15 / 16.
    expect(budgets(vary(goldenSamurai(), (b) => void (b.karma.spends = [])), EXPERIENCED).pools.karma.remaining).toBe(15);
    expect(budgets(vary(goldenTechnomancer(), (b) => void (b.karma.spends = [])), EXPERIENCED_RF).pools.karma.remaining).toBe(26);
    const mysticBefore = vary(goldenMysticAdept(), (b) => void (b.karma.spends = b.karma.spends.filter((s) => s.kind === 'powerPoint')));
    expect(budgets(mysticBefore, EXPERIENCED).pools.karma.remaining).toBe(16);
  });

  it('buys the mystic adept 2 power points for 10 Karma, and her powers fit in them (SR5 p.69)', () => {
    expect(mystic.pools.powerPoints).toEqual({ available: 2, spent: 1.75, remaining: 0.25 });
    expect(mystic.pools.spells).toEqual({ available: 12, spent: 10, remaining: 2 });
  });

  it('carries what Resources, conversion, list-price gear and lifestyles leave, capped at 5,000¥, and names the rolled lifestyle\'s dice (SR5 p.94–95, p.66, p.80)', () => {
    const gearTotal = (b: CharacterBuild) => b.purchases.reduce((sum, p) => sum + p.cost * p.qty, 0);
    // The book's gear at list price (itemised in chargen-goldens.test.ts), lumped in the fixtures.
    expect([gearTotal(goldenTechnomancer()), gearTotal(goldenSamurai()), gearTotal(goldenMysticAdept())]).toEqual([295_555, 55_190, 20_360]);
    const left = [
      // A: 450,000; Middle 5,000 and Low 2,000 a month, +20% for Dependents 2, for 12 and 3 months.
      450_000 - 5_000 * 1.2 * 12 - 2_000 * 1.2 * 3 - 295_555,
      // D: 50,000 + 10 Karma at 2,000; Low at a troll's double for 3 months.
      50_000 + 10 * 2_000 - 2_000 * 2 * 3 - 55_190,
      // E: 6,000 + 10 Karma at 2,000; Low for 2 months.
      6_000 + 10 * 2_000 - 2_000 * 2 - 20_360,
    ];
    expect([tech, sam, mystic].map((b) => b.pools.nuyen.remaining)).toEqual(left);
    expect([tech, sam, mystic].map((b) => b.preview?.nuyenCarried)).toEqual(left.map((n) => Math.min(n, 5_000)));
    expect([tech, sam, mystic].map((b) => b.preview?.nuyenLost)).toEqual(left.map((n) => Math.max(0, n - 5_000)));
    expect(tech.preview?.startingNuyen).toEqual({ dice: 4, multiplier: 100 });
    expect(sam.preview?.startingNuyen).toEqual({ dice: 3, multiplier: 60 });
  });

  it('conforms to BudgetsSchema, Sum to Ten\'s priority points included', () => {
    for (const b of [tech, sam, mystic]) expect(BudgetsSchema.parse(b)).toEqual(b);
    const s2t = budgets(
      vary(clean, (b) => {
        b.method = 'sumToTen';
        b.priorities = { metatype: 'A', attributes: 'B', magic: 'E', skills: 'B', resources: 'E' };
      }),
      settings({ allowSumToTen: true }),
    );
    expect(s2t.pools.priorityPoints).toBeDefined();
    expect(BudgetsSchema.parse(s2t)).toEqual(s2t);
  });
});

describe('effectiveTables: level, printing and rows (SR5 p.64–65, RF p.63)', () => {
  it('takes the level and printing from the campaign, not the draft', () => {
    const draft = vary(clean, (b) => {
      b.level = 'prime';
      b.table = 'rf';
    });
    const t = effectiveTables(draft, EXPERIENCED);
    expect([t.level, t.table]).toEqual(['experienced', 'sr5']);
    expect(t.rows.skills?.skills).toEqual({ points: 36, groupPoints: 5 });
    expect(t.metatypeCell?.special).toBe(5);
  });

  it('applies the campaign\'s caps over the level preset, and picks the quality cap by the toggle', () => {
    const street = effectiveTables(clean, settings({ level: 'street', maxAvailability: 11 }));
    expect(street.preset).toMatchObject({ karma: 13, qualityCap: 26, maxAvailability: 11, maxDeviceRating: 4, karmaToNuyenMax: 5 });
    expect(effectiveTables(clean, settings({ level: 'prime', levelQualityCaps: false })).preset.qualityCap).toBe(25);
  });

  it('finds the magic option the kind has on its row, in the campaign\'s printing', () => {
    const tech = cleanTechnomancer();
    expect(effectiveTables(tech, EXPERIENCED).magicOption?.forms).toBe(3);
    expect(effectiveTables(tech, EXPERIENCED_RF).magicOption?.forms).toBe(1);
    expect(effectiveTables(cleanMage(), EXPERIENCED).magicOption?.formulae).toBe(5);
    expect(effectiveTables(clean, EXPERIENCED).magicOption).toBeNull();
  });
});

describe('ratings: what the points add up to', () => {
  it('rates attributes as base + points + Karma with the natural maximum', () => {
    const r = ratings(vary(clean, (b) => void b.karma.spends.push({ kind: 'attribute', id: 'log', from: 2, to: 3 })));
    expect(r.attributes.bod).toMatchObject({ base: 1, points: 5, creation: 6, karma: 0, rating: 6, max: 6, tableMax: 6 });
    expect(r.attributes.log).toMatchObject({ creation: 2, karma: 1, rating: 3 });
    expect(r.attributes.edg).toMatchObject({ base: 2, points: 5, rating: 7, max: 7 });
  });

  it('lifts one attribute\'s maximum with Exceptional Attribute and Edge\'s with Lucky (SR5 p.66)', () => {
    const sam = ratings(goldenSamurai());
    expect(sam.attributes.str).toMatchObject({ base: 5, points: 6, rating: 11, max: 11, tableMax: 10 });
    const lucky = ratings(vary(clean, (b) => void b.qualities.push({ name: 'Lucky', type: 'positive', karma: 12, rating: null, mods: [] })));
    expect(lucky.attributes.edg.max).toBe(8);
    const magicEa = ratings(
      vary(cleanMage(), (b) => void b.qualities.push({ name: 'Exceptional Attribute', type: 'positive', karma: 14, rating: null, mods: [], target: 'Magic' })),
    );
    expect(magicEa.attributes.mag.max).toBe(7);
  });

  it('starts Magic at the priority\'s rating, replacing a metasapient\'s natural 1 (RF p.102)', () => {
    expect(ratings(cleanMage()).attributes.mag).toMatchObject({ base: 3, rating: 3 });
    expect(ratings(cleanAdept()).attributes.mag.rating).toBe(4);
    const pixie = vary(cleanMage(), (b) => void (b.metatype = 'pixie'));
    expect(ratings(pixie).attributes.mag.base).toBe(3);
    expect(ratings(vary(clean, (b) => void (b.metatype = 'pixie'))).attributes.mag.base).toBe(1);
    expect(ratings(vary(cleanTechnomancer(), (b) => void (b.metatype = 'pixie'))).attributes.res.max).toBe(0);
  });

  it('rates skills from groups, grants, points and Karma, and each knows its source', () => {
    const r = ratings(clean);
    expect(r.skills.find((s) => s.id === 'pistols')).toMatchObject({ group: 'firearms', groupRating: 3, points: 0, rating: 3 });
    expect(r.skills.find((s) => s.id === 'blades')).toMatchObject({ points: 4, creation: 4, karma: 1, rating: 5, specs: ['Knives'], max: 6 });
    const adept = ratings(cleanAdept());
    expect(adept.skills.find((s) => s.id === 'throwing-weapons')).toMatchObject({ grant: 2, rating: 2, index: null });
    const raisedGroup = ratings(vary(clean, (b) => void b.karma.spends.push({ kind: 'group', id: 'firearms', from: 3, to: 4 })));
    expect(raisedGroup.skills.find((s) => s.id === 'longarms')?.rating).toBe(4);
    expect(raisedGroup.groups.find((g) => g.id === 'firearms')).toMatchObject({ creation: 3, karma: 1, rating: 4 });
  });

  it('rates knowledge and languages from free points, skill points and Karma, and learns new ones by name', () => {
    const r = ratings(
      vary(clean, (b) => {
        b.skills.knowledge[0]!.skillPoints = 1;
        b.karma.spends.push({ kind: 'knowledge', name: 'corp law', category: 'academic', from: 0, to: 2 });
      }),
    );
    expect(r.knowledge.find((k) => k.name === 'Safehouses')).toMatchObject({ points: 3, skillPoints: 1, rating: 4 });
    expect(r.knowledge.find((k) => k.name === 'corp law')).toMatchObject({ category: 'academic', rating: 2, index: null });
    expect(r.languages.find((l) => l.name === 'English')).toMatchObject({ native: true, rating: 0 });
  });

  it('opens one skill to 7 with Aptitude, and reads the whitelist\'s other facts', () => {
    const b = vary(clean, (x) => {
      x.qualities.push({ name: 'Aptitude', type: 'positive', karma: 14, rating: null, mods: [], target: 'Blades' });
      x.qualities.push({ name: 'Bilingual', type: 'positive', karma: 5, rating: null, mods: [] });
      x.qualities.push({ name: 'Dependent(s)', type: 'negative', karma: 9, rating: null, mods: [] });
      x.qualities.push({ name: 'Incompetent [Acting]', type: 'negative', karma: 5, rating: null, mods: [] });
    });
    expect(ratings(b).skills.find((s) => s.id === 'blades')?.max).toBe(7);
    const fx = qualityEffects(b);
    expect(fx).toMatchObject({ aptitudeSkill: 'blades', nativeLanguages: 2, dependentsMultiplier: 1.3, barredGroups: ['acting'] });
  });

  it('reads a rated quality\'s rating off its Karma when none is recorded: 9 Karma of Will to Live is three boxes (SR5 p.77)', () => {
    const willToLive = (karma: number, rating: number | null) =>
      qualityEffects(vary(clean, (x) => void x.qualities.push({ name: 'Will to Live', type: 'positive', karma, rating, mods: [] }))).willToLive;
    expect([willToLive(9, null), willToLive(6, null), willToLive(3, null), willToLive(9, 2)]).toEqual([3, 2, 1, 2]);
  });
});

describe('budgets: each pool', () => {
  it('special points: the metatype on its row, 0 when it is not on that row (SR5 p.65)', () => {
    expect(budgets(vary(clean, (b) => void (b.metatype = 'troll')), EXPERIENCED).pools.special).toEqual({
      available: 0,
      spent: 5,
      remaining: -5,
    });
  });

  it('skill points pay for knowledge ranks and specialisations; knowledge shows the diverted points (SR5 p.88–89)', () => {
    const b = vary(clean, (x) => {
      x.skills.active[1]!.points = 2;
      x.skills.knowledge[0]!.points = 1;
      x.skills.knowledge[0]!.skillPoints = 2;
    });
    const pools = budgets(b, EXPERIENCED).pools;
    expect(pools.skills).toEqual({ available: 36, spent: 36, remaining: 0 });
    expect(pools.knowledge).toEqual({ available: 12, spent: 10, remaining: 2 });
  });

  it('Sum to Ten: ten points, A4 B3 C2 D1 E0, rows may repeat (RF p.62)', () => {
    const s2t = vary(clean, (b) => {
      b.method = 'sumToTen';
      b.priorities = { metatype: 'A', attributes: 'B', magic: 'E', skills: 'B', resources: 'E' };
    });
    const pools = budgets(s2t, settings({ allowSumToTen: true })).pools;
    expect(pools.priorityPoints).toEqual({ available: 10, spent: 10, remaining: 0 });
    expect(pools.attributes.available).toBe(20);
    expect(pools.skills.available).toBe(36);
    expect(pools.nuyen.available).toBe(6_000 + 10_000);
    expect(budgets(clean, EXPERIENCED).pools.priorityPoints).toBeUndefined();
  });

  it('Karma: starting Karma + negatives − positives − metavariant Karma − spends − conversion (SR5 p.62, RF p.102)', () => {
    const b = vary(clean, (x) => {
      x.metatype = 'nartaki';
      x.qualities.push({ name: 'Old Debt', type: 'negative', karma: 10, rating: null, mods: [] });
      x.qualities.push({ name: 'Keen Eye', type: 'positive', karma: 4, rating: null, mods: [] });
    });
    const pools = budgets(b, settings({ allowMetavariants: true })).pools;
    // 25 + 10 − 4 − 0 (nartaki costs nothing extra) − 20 − 5
    expect(pools.karma).toEqual({ available: 35, spent: 29, remaining: 6 });
    const wakyambi = vary(clean, (x) => {
      x.metatype = 'wakyambi';
      x.priorities.metatype = 'B';
      x.priorities.skills = 'C';
    });
    expect(budgets(wakyambi, settings({ allowMetavariants: true })).pools.karma.spent).toBe(25 + 12);
    expect(budgets(wakyambi, settings({ allowMetavariants: true })).pools.positiveQualities?.spent).toBe(0);
  });

  it('Karma to nuyen: 2,000¥ a point off the Karma pool (SR5 p.94)', () => {
    const more = budgets(vary(clean, (b) => void (b.karma.toNuyen = 10)), EXPERIENCED).pools;
    expect(more.nuyen.available).toBe(50_000 + 20_000);
    expect(more.karma.remaining).toBe(-5);
  });

  it('grades: alphaware costs ×1.2 for ×0.8 Essence and +2 Availability; used ×0.75 for ×1.25 and −4 (SR5 p.451)', () => {
    const alpha = BuildPurchaseSchema.parse(augment('Wired Eye', 5_000, 0.5, { grade: 'alphaware', qty: 2, avail: '8' }));
    expect([purchaseCost(alpha), purchaseEssence(alpha), purchaseAvailability(alpha).value]).toEqual([12_000, 0.8, 10]);
    const used = BuildPurchaseSchema.parse(augment('Wired Eye', 5_000, 0.5, { grade: 'used', avail: '8R' }));
    expect([purchaseCost(used), purchaseEssence(used), purchaseAvailability(used)]).toEqual([3_750, 0.625, { value: 4, legality: 'R', status: 'ok' }]);
    const b = vary(clean, (x) => {
      x.purchases.find((p) => p.name === 'Kit')!.cost = 30_000;
      x.purchases.push(alpha, used);
    });
    const t = budgets(b, EXPERIENCED);
    expect(t.pools.nuyen.spent).toBe(57_000 - 15_500 + 15_750);
    expect(t.preview?.essence).toBe(6 - 1.425);
  });

  it('Sensitive System doubles cyberware Essence, not bioware\'s (SR5 p.83)', () => {
    const b = vary(clean, (x) => {
      x.qualities.push({ name: 'Sensitive System', type: 'negative', karma: 12, rating: null, mods: [] });
      x.purchases.push(augment('Datajack', 1_000, 0.1) as never, augment('Toner', 1_000, 0.2, { kind: 'bioware' }) as never);
    });
    expect(budgets(b, EXPERIENCED).preview?.essence).toBe(6 - 0.2 - 0.2);
  });

  it('tells bioware from cyberware the way the catalogue delivers them: the table heading, else the core bioware pages (SR5 pp.459–461)', () => {
    // The catalogue's kind is "augmentation" for both; toSheet leaves the heading out of the note.
    const shaped = (extra: object) => BuildPurchaseSchema.parse(augment('Muscle Toner', 32_000, 0.2, extra));
    expect(isBioware(shaped({ category: 'BASIC BIOWARE' }))).toBe(true);
    expect(isBioware(shaped({ category: 'CULTURED BIOWARE', ref: { book: 'SR5', page: 461 } }))).toBe(true);
    expect(isBioware(shaped({ item: { name: 'Muscle Toner', essence: 0.2, mods: [], ref: { book: 'SR5', page: 460 } } }))).toBe(true);
    expect(isBioware(shaped({ category: 'HEADWARE', ref: { book: 'SR5', page: 460 } }))).toBe(false);
    expect(isBioware(shaped({ ref: { book: 'SR5', page: 452 } }))).toBe(false);
    expect(isBioware(shaped({}))).toBe(false);
    // A heading that names neither leaves it to the page: Chrome Flesh prints its orthoskin upgrades
    // under their own heading among its bioware tables (CF pp.109–121).
    expect(isBioware(shaped({ category: 'ORTHOSKIN UPGRADES' }))).toBe(true);
    expect(isBioware(shaped({ category: 'UPGRADES', ref: { book: 'CF', page: 117 } }))).toBe(true);
    expect(isBioware(shaped({ category: 'UPGRADES', ref: { book: 'SR5', page: 452 } }))).toBe(false);
    expect(isBioware(shaped({ category: 'CYBERLIMBS', ref: { book: 'CF', page: 117 } }))).toBe(false);
    const sensitive = vary(clean, (x) => {
      x.qualities.push({ name: 'Sensitive System', type: 'negative', karma: 12, rating: null, mods: [] });
      x.purchases.push(augment('Muscle Toner', 0, 0.2, { item: { name: 'Muscle Toner', essence: 0.2, mods: [], ref: { book: 'SR5', page: 460 } } }) as never);
    });
    expect(budgets(sensitive, EXPERIENCED).preview?.essence).toBe(5.8);
  });

  it('a device\'s rating for the cap: its Device Rating, its Rating, or the catalogue note\'s "device rating N" (SR5 p.94)', () => {
    const line = (extra: object) =>
      BuildPurchaseSchema.parse({ list: 'gear', kind: 'electronics', name: 'Pocket Deck', cost: 5_000, item: { name: 'Pocket Deck' }, ...extra });
    expect(purchaseDeviceRating(line({ deviceRating: 6, rating: 2 }))).toBe(6);
    expect(purchaseDeviceRating(line({ rating: 3 }))).toBe(3);
    expect(purchaseDeviceRating(line({ item: { name: 'Pocket Deck', note: 'commlinks · device rating 5 · avail 6 · 5,000¥' } }))).toBe(5);
    expect(purchaseDeviceRating(line({}))).toBeNull();
    expect(isDevice(line({ kind: 'gear', category: 'CYBERDECKS' }))).toBe(true);
  });

  it('shows Magic after Essence loss: any fraction costs a point (SR5 p.95)', () => {
    const b = vary(cleanMage(), (x) => void x.purchases.push(augment('Datajack', 1_000, 0.1) as never));
    const t = budgets(b, EXPERIENCED);
    expect(t.preview?.magic).toBe(2);
    expect(t.pools.spells.available).toBe(4);
    expect(t.pools.foci.available).toBe(4);
  });

  it('lifestyles: the metatype multiplier and Dependents\' surcharge add on the listed price (SR5 p.66, p.80)', () => {
    const middle = (metatype: string, dependents: number | null) =>
      vary(clean, (b) => {
        b.metatype = metatype;
        b.priorities.metatype = 'B';
        b.priorities.skills = 'C';
        b.lifestyles = [{ tier: 'middle', name: 'Middle', months: 1 }];
        if (dependents !== null) b.qualities.push({ name: 'Dependents', type: 'negative', karma: dependents * 3, rating: dependents, mods: [] });
      });
    const lifestyleSpend = (b: ReturnType<typeof middle>) => budgets(b, EXPERIENCED).pools.nuyen.spent - 55_000;
    expect(lifestyleSpend(middle('human', null))).toBe(5_000);
    expect(lifestyleSpend(middle('dwarf', null))).toBe(6_000);
    expect(lifestyleSpend(middle('troll', null))).toBe(10_000);
    expect(lifestyleSpend(middle('human', 1))).toBe(5_500);
    expect(lifestyleSpend(middle('human', 3))).toBe(6_500);
    expect(lifestyleSpend(middle('troll', 2))).toBe(11_000);
    expect(budgets(middle('troll', 2), EXPERIENCED).preview?.lifestyleMultiplier).toBe(2);
  });

  it('carry-over: at most 5,000¥ and 7 Karma, with what the cap loses (SR5 p.94, p.98)', () => {
    const rich = vary(clean, (b) => {
      b.purchases.find((p) => p.name === 'Kit')!.cost = 40_000;
      b.karma.spends = [];
    });
    expect(budgets(rich, EXPERIENCED).preview).toMatchObject({ nuyenCarried: 5_000, nuyenLost: 3_500, karmaCarried: 7, karmaLost: 13 });
  });

  it('contact Karma: Charisma × 3, × 6 at prime; natural Charisma only (SR5 p.98, p.64, p.95)', () => {
    expect(budgets(clean, EXPERIENCED).pools.contactKarma.available).toBe(9);
    expect(budgets(vary(clean, (b) => void (b.level = 'prime')), settings({ level: 'prime' })).pools.contactKarma.available).toBe(18);
    const charming = vary(clean, (b) => void b.purchases.push(augment('Tailored Pheromones', 1_000, 0.2, { item: { name: 'Tailored Pheromones', essence: 0.2, mods: [{ id: 'x', source: { kind: 'cyberware' }, target: 'attr.cha', op: 'add', value: 2, active: true }] } }) as never));
    expect(budgets(charming, EXPERIENCED).pools.contactKarma.available).toBe(9);
    const overflow = vary(clean, (b) => void (b.karma.contacts[0]!.connection = 5));
    expect(budgets(overflow, EXPERIENCED).pools.karma.spent).toBe(25 + 2);
  });

  it('power points: Magic for an adept, bought for a mystic adept, none for anyone else (SR5 p.279, p.69)', () => {
    expect(budgets(cleanAdept(), EXPERIENCED).pools.powerPoints).toEqual({ available: 4, spent: 4, remaining: 0 });
    const mystic = vary(cleanMage(), (b) => {
      b.magic.kind = 'mysticAdept';
      b.karma.spends.push({ kind: 'powerPoint', count: 3 });
    });
    expect(budgets(mystic, EXPERIENCED).pools.powerPoints.available).toBe(3);
    expect(budgets(mystic, EXPERIENCED).pools.karma.spent).toBe(25 + 15);
    expect(budgets(cleanMage(), EXPERIENCED).pools.powerPoints.available).toBe(0);
  });

  it('power points: a mystic adept\'s bought points stop at Magic after Essence loss (SR5 p.69, p.279)', () => {
    const mystic = vary(cleanMage(), (b) => {
      b.magic.kind = 'mysticAdept';
      b.karma.spends.push({ kind: 'powerPoint', count: 3 });
      b.purchases.push(augment('Datajack', 1_000, 0.1) as never);
    });
    // Magic 3 − 1 for the Datajack: 2 of the 3 bought points survive.
    expect(budgets(mystic, EXPERIENCED).pools.powerPoints.available).toBe(2);
  });

  it('spells: Magic × 2 only for a character who may know spells — none for an adept or an aspected conjurer (SR5 p.69, p.98)', () => {
    expect(budgets(cleanMage(), EXPERIENCED).pools.spells.available).toBe(6);
    expect(budgets(cleanAdept(), EXPERIENCED).pools.spells).toEqual({ available: 0, spent: 0, remaining: 0 });
    const aspected = (aspect: 'sorcery' | 'conjuring' | 'enchanting') =>
      vary(cleanMage(), (b) => void (b.magic = { kind: 'aspected', aspect, tradition: 'hermetic' }));
    expect(budgets(aspected('conjuring'), EXPERIENCED).pools.spells.available).toBe(0);
    expect(budgets(aspected('enchanting'), EXPERIENCED).pools.spells.available).toBe(0);
    expect(budgets(aspected('sorcery'), EXPERIENCED).pools.spells.available).toBe(6);
  });

  it('Magic and Resonance count only where the build can use them: a mundane\'s Karma-bought Magic opens no foci cap (SR5 p.68)', () => {
    const bought = vary(clean, (b) => void b.karma.spends.push({ kind: 'attribute', id: 'mag', from: 0, to: 1 }, { kind: 'attribute', id: 'res', from: 0, to: 1 }));
    const pools = budgets(bought, EXPERIENCED);
    expect([pools.pools.foci.available, pools.pools.spells.available, pools.pools.forms.available]).toEqual([0, 0, 0]);
    // A sasquatch's natural Magic 1 is its own (RF p.102).
    const sasquatch = vary(clean, (b) => {
      b.metatype = 'sasquatch';
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
    });
    expect(budgets(sasquatch, settings({ allowMetavariants: true })).pools.foci.available).toBe(2);
  });

  it('forms and foci: Resonance × 2 forms and Magic × 2 bonded Force at creation (SR5 p.98)', () => {
    const t = vary(cleanTechnomancer(), (b) => void b.karma.spends.push({ kind: 'form', name: 'Echo' }));
    expect(budgets(t, EXPERIENCED).pools.forms).toEqual({ available: 6, spent: 4, remaining: 2 });
    const focused = vary(cleanMage(), (b) => void b.karma.spends.push({ kind: 'focus', name: 'Ring', focusType: 'spell', force: 2, bondKarma: 4 }));
    expect(budgets(focused, EXPERIENCED).pools.foci).toEqual({ available: 6, spent: 2, remaining: 4 });
  });

  it('Uncouth and Uneducated double Karma at creation, and points too under the house rule (SR5 p.85, p.87, §8.4)', () => {
    const uncouth = vary(clean, (b) => void b.qualities.push({ name: 'Uncouth', type: 'negative', karma: 14, rating: null, mods: [] }));
    const raise = vary(uncouth, (b) => void b.karma.spends.push({ kind: 'skill', id: 'etiquette', from: 3, to: 4 }));
    expect(budgets(raise, EXPERIENCED).pools.karma.spent - budgets(uncouth, EXPERIENCED).pools.karma.spent).toBe(16);
    expect(budgets(uncouth, EXPERIENCED).pools.skills.spent).toBe(36);
    // Etiquette 3 and Intimidation 3 are the clean build's social skills.
    expect(budgets(uncouth, settings({ uncouthDoublesPriorityPoints: true })).pools.skills.spent).toBe(36 + 3 + 3);
    const uneducated = vary(clean, (b) => void b.qualities.push({ name: 'Uneducated', type: 'negative', karma: 8, rating: null, mods: [] }));
    const doubled = budgets(uneducated, settings({ uncouthDoublesPriorityPoints: true })).pools;
    // First Aid 3, Computer 2 and Locksmith 2 are technical; Corp Security 3 is professional knowledge.
    expect(doubled.skills.spent).toBe(36 + 3 + 2 + 2);
    expect(doubled.knowledge.spent).toBe(10 + 3);
  });

  it('racial Uneducated doubles the same costs, and a buy-off line lifts it (SR5 p.87, RF pp.102–105)', () => {
    const MV = settings({ allowMetavariants: true });
    const raise = { kind: 'skill' as const, id: 'computer', from: 2, to: 3 };
    const born = (metatype: string, extra?: (b: CharacterBuild) => void) =>
      vary(clean, (b) => {
        b.metatype = metatype;
        b.priorities.metatype = 'B';
        b.priorities.skills = 'C';
        b.karma.spends = [raise];
        extra?.(b);
      });
    const cost = (b: CharacterBuild) => tallyBuild(b, MV).spendCosts[0];
    expect(cost(born('sasquatch'))).toBe(12);
    expect(qualityEffects(born('sasquatch'))).toMatchObject({ uneducated: true, racial: ['uneducated'] });
    expect(cost(born('ork'))).toBe(6);
    const boughtOff = born('sasquatch', (b) => void b.qualities.push({ name: 'Uneducated', type: 'positive', karma: 16, rating: null, mods: [] }));
    expect(cost(boughtOff)).toBe(6);
    expect(qualityEffects(boughtOff)).toMatchObject({ uneducated: false, racial: [] });
    // Only a quality the metatype is born with is bought off: an ork's positive Uneducated still doubles.
    const slip = born('ork', (b) => void b.qualities.push({ name: 'Uneducated', type: 'positive', karma: 8, rating: null, mods: [] }));
    expect(cost(slip)).toBe(12);
    expect(qualityEffects(slip)).toMatchObject({ uneducated: true, racial: [] });
    expect(karmaCostOf(raise, { qualities: [{ name: 'Uneducated', type: 'positive' }], identity: { metatype: 'human' } })).toBe(12);
    expect(karmaCostOf(raise, { qualities: [{ name: 'Uneducated', type: 'positive' }], identity: { metatype: 'sasquatch' } })).toBe(6);
    // In play the sheet's metatype says the same (karmaCostOf reads identity.metatype).
    expect(karmaCostOf(raise, { qualities: [], identity: { metatype: 'sasquatch' } })).toBe(12);
    expect(budgets(born('sasquatch'), settings({ allowMetavariants: true, uncouthDoublesPriorityPoints: true })).pools.skills.spent).toBe(
      budgets(born('ork'), EXPERIENCED).pools.skills.spent + 3 + 2 + 2,
    );
  });
});

describe('eligibility: the skill and group fences Step 6 greys by (SR5 p.69, p.81, p.85, p.89, p.142)', () => {
  const withQuality = (b: CharacterBuild, name: string, karma: number, target?: string) =>
    vary(b, (x) => void x.qualities.push({ name, type: 'negative', karma, rating: null, mods: [], ...(target ? { target } : {}) }));

  it('says which rule closes a skill or a group, with the validator\'s code and page, and opens the rest', () => {
    expect(skillEligibility(clean, EXPERIENCED, 'spellcasting')).toEqual({
      allowed: false,
      code: 'skill-restricted-magic',
      ref: { book: 'SR5', page: 89 },
      reasons: [{ code: 'skill-restricted-magic', ref: { book: 'SR5', page: 89 } }],
    });
    expect(skillEligibility(cleanMage(), EXPERIENCED, 'Spellcasting')).toEqual({ allowed: true, reasons: [] });
    expect(skillEligibility(cleanAdept(), EXPERIENCED, 'assensing').code).toBe('assensing-needs-astral');
    expect(skillEligibility(cleanAdept(), EXPERIENCED, 'counterspelling').reasons.map((r) => r.code)).toEqual(['skill-adept-fence']);
    expect(groupEligibility(cleanTechnomancer(), EXPERIENCED, 'tasking').allowed).toBe(true);
    expect(groupEligibility(clean, EXPERIENCED, 'tasking').code).toBe('skill-restricted-resonance');
    const stealthless = withQuality(clean, 'Incompetent', 5, 'stealth');
    expect(skillEligibility(stealthless, EXPERIENCED, 'sneaking').code).toBe('incompetent-skill-owned');
    expect(groupEligibility(stealthless, EXPERIENCED, 'stealth').code).toBe('incompetent-group-owned');
    // Uncouth closes the social groups as groups; their skills are still bought one by one.
    const uncouth = withQuality(clean, 'Uncouth', 14);
    expect(groupEligibility(uncouth, EXPERIENCED, 'influence').code).toBe('uncouth-social-group');
    expect(skillEligibility(uncouth, EXPERIENCED, 'etiquette').allowed).toBe(true);
    expect(skillEligibility(clean, EXPERIENCED, 'basket-weaving').code).toBe('skill-unknown');
    expect(groupEligibility(clean, EXPERIENCED, 'juggling').code).toBe('group-unknown');
  });

  it('cites the page the validator cites for every fence', () => {
    for (const [code, ref] of Object.entries(ELIGIBILITY_REFS)) {
      expect(ISSUE_RULES[code as keyof typeof ISSUE_RULES].ref, code).toEqual(ref);
    }
  });

  it('exports the pricing Step 6 and Step 8 show a doubled point with: buildPricing and the doubles* helpers (SR5 p.87)', () => {
    const { doubling } = buildPricing(withQuality(clean, 'Uneducated', 8));
    expect([doublesSkill(doubling, 'computer'), doublesSkill(doubling, 'blades')]).toEqual([true, false]);
    expect(doublesGroup(doubling, 'electronics')).toBe(true);
    expect([doublesKnowledge(doubling, 'professional'), doublesKnowledge(doubling, 'street')]).toEqual([true, false]);
    expect(doublesSpecialization(doubling, { list: 'active', id: 'computer' })).toBe(true);
    expect(doublesSkill(buildPricing(clean).doubling, 'computer')).toBe(false);
  });
});

describe('parseAvailability: Availability as printed', () => {
  it('reads plain, restricted, forbidden and rating-scaled codes', () => {
    expect(parseAvailability('12')).toEqual({ value: 12, legality: null, status: 'ok' });
    expect(parseAvailability('4R')).toEqual({ value: 4, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating x 3)F', 4)).toEqual({ value: 12, legality: 'F', status: 'ok' });
    expect(parseAvailability('Rating × 2', null)).toEqual({ value: null, legality: null, status: 'needsRating' });
    expect(parseAvailability('—')).toEqual({ value: null, legality: null, status: 'none' });
    expect(parseAvailability(null)).toEqual({ value: null, legality: null, status: 'none' });
  });

  it('reads every shape the catalogue parser accepts: N + Rating, (Rating), (Rating + N), (Rating × N + M), a trailing +', () => {
    expect(parseAvailability('10 + Rating', 6)).toEqual({ value: 16, legality: null, status: 'ok' });
    expect(parseAvailability('16+')).toEqual({ value: 16, legality: null, status: 'ok' });
    expect(parseAvailability('12R+')).toEqual({ value: 12, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating)R', 6)).toEqual({ value: 6, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating + 8)F', 6)).toEqual({ value: 14, legality: 'F', status: 'ok' });
    expect(parseAvailability('(Rating × 3 + 2)R', 4)).toEqual({ value: 14, legality: 'R', status: 'ok' });
    expect(parseAvailability('Rating x 6R', 3)).toEqual({ value: 18, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Force x 4)R', 3)).toEqual({ value: 12, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating x 3)F')).toEqual({ value: null, legality: 'F', status: 'needsRating' });
    expect(parseAvailability('+4')).toEqual({ value: null, legality: null, status: 'relative' });
    expect(parseAvailability('Varies')).toEqual({ value: null, legality: null, status: 'unreadable' });
    expect(parseAvailability('(Rating x 2)R/(Rating x 3)F', 2)).toEqual({ value: null, legality: 'F', status: 'unreadable' });
  });

  it('drops footnote marks after a code, and keeps the legality of a code it still cannot read', () => {
    expect(parseAvailability('16F†')).toEqual({ value: 16, legality: 'F', status: 'ok' });
    expect(parseAvailability('8R*')).toEqual({ value: 8, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating x 3)F¹', 2)).toEqual({ value: 6, legality: 'F', status: 'ok' });
    expect(parseAvailability('12F (see text)')).toEqual({ value: null, legality: 'F', status: 'unreadable' });
    expect(parseAvailability('Varies R')).toEqual({ value: null, legality: 'R', status: 'unreadable' });
    expect(parseAvailability('10R or 14F')).toEqual({ value: null, legality: 'F', status: 'unreadable' });
    // A word that starts with R or F is not a legality letter.
    expect(parseAvailability('Varies (see Rules)')).toEqual({ value: null, legality: null, status: 'unreadable' });
    expect(parseAvailability('*')).toEqual({ value: null, legality: null, status: 'unreadable' });
  });
});

describe('stepStatus: the walkthrough\'s "complete when" (§4.4)', () => {
  const byName = (b: Parameters<typeof stepStatus>[0], s = EXPERIENCED) =>
    Object.fromEntries(stepStatus(b, s).map((st) => [st.name, st]));

  it('marks every step of the clean build complete, and a mundane\'s Magic step skipped', () => {
    const steps = stepStatus(clean, EXPERIENCED);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(steps.every((s) => s.complete)).toBe(true);
    expect(byName(clean).magic?.skipped).toBe(true);
    expect(byName(cleanMage()).magic?.skipped).toBe(false);
  });

  it("does not skip a mundane's Magic step while it still holds something to fix", () => {
    // A spell an earlier kind left on the record: Next and the strip must lead back to it, not over it.
    const leftover = vary(clean, (b) => void b.grants.spells.push({ name: 'Invented Bolt', category: 'combat' }));
    const magic = byName(leftover).magic!;
    expect(magic.blocking.length).toBeGreaterThan(0);
    expect(magic.skipped).toBe(false);
    expect(magic.complete).toBe(false);
  });

  it('names attributes in full in the validator’s sentences, as every step’s rows do', () => {
    const two = vary(clean, (b) => {
      b.attributes.agi = 5;
      b.attributes.rea = 3;
    });
    const atMax = validate(two, EXPERIENCED).find((i) => i.code === 'attribute-max-more-than-one');
    expect(atMax?.message).toMatch(/natural maximum: [A-Z][a-z]+(, [A-Z][a-z]+)+ are\./);
    expect(atMax?.message).toContain('Agility');
    expect(atMax?.message).not.toMatch(/\b(BOD|AGI|REA|STR|WIL|LOG|INT|CHA)\b/);
  });

  it('opens nothing on an empty draft past what an alias and priorities would', () => {
    const steps = byName(emptyBuild(EXPERIENCED));
    expect(steps.concept?.blocking.map((i) => i.code)).toEqual(['alias-missing']);
    expect(steps.priorities?.complete).toBe(false);
    expect(steps.finish?.complete).toBe(false);
    expect(byName(emptyBuild(EXPERIENCED, { alias: 'Nib' })).concept?.complete).toBe(true);
  });

  it('warns on unspent special points without blocking Step 3', () => {
    const steps = byName(vary(clean, (b) => void (b.special.edg = 4)));
    expect(steps.metatype?.complete).toBe(true);
    expect(steps.metatype?.warnings.map((i) => i.code)).toEqual(['special-points-unspent']);
  });

  it('needs a lifestyle to finish Step 7, though no lifestyle is only a warning elsewhere', () => {
    const b = vary(clean, (x) => void (x.lifestyles = []));
    const steps = byName(b);
    expect(steps.gear?.complete).toBe(false);
    expect(steps.gear?.blocking.map((i) => i.code)).toContain('lifestyle-missing');
    expect(validate(b, EXPERIENCED).find((i) => i.code === 'lifestyle-missing')?.severity).toBe('warning');
  });

  it('re-opens a later step when an earlier change breaks it, and Finish carries every error', () => {
    const b = setPriority(clean, 'skills', 'C');
    const steps = byName(b);
    expect(steps.priorities?.complete).toBe(true);
    expect(steps.skills?.complete).toBe(false);
    expect(steps.finish?.blocking.map((i) => i.code)).toEqual(expect.arrayContaining(['skill-points-over', 'group-points-over']));
  });

  it('lists approvals as warnings: they are the GM\'s, not the player\'s, to clear', () => {
    const steps = byName(goldenSamurai());
    expect(steps.finish?.complete).toBe(true);
    expect(steps.qualities?.warnings.map((i) => i.severity)).toEqual(['approval']);
  });
});

describe('build updaters', () => {
  it('emptyBuild: a fresh draft at the campaign\'s level and printing', () => {
    const b = emptyBuild(settings({ level: 'street', table: 'rf' }), { alias: 'Nib' });
    expect(b).toMatchObject({ v: 1, level: 'street', table: 'rf', state: 'draft', step: 1, identity: { alias: 'Nib' } });
    expect(b.priorities).toEqual({ metatype: null, attributes: null, magic: null, skills: null, resources: null });
  });

  it('setPriority swaps a level out of the column that held it under Priority, and lets it repeat under Sum to Ten', () => {
    const swapped = setPriority(clean, 'skills', 'A');
    expect(swapped.priorities).toMatchObject({ skills: 'A', attributes: 'B' });
    expect(clean.priorities.skills).toBe('B');
    const fresh = setPriority(emptyBuild(EXPERIENCED), 'magic', 'A');
    expect(setPriority(fresh, 'skills', 'A').priorities).toMatchObject({ magic: null, skills: 'A' });
    const s2t = setPriority(setMethod(clean, 'sumToTen'), 'skills', 'A');
    expect(s2t.priorities).toMatchObject({ skills: 'A', attributes: 'A' });
    expect(setMethod(s2t, 'priority').priorities).toMatchObject({ attributes: 'A', skills: null });
  });

  it('setMetatype and setMagicKind change the choice and nothing downstream', () => {
    const troll = setMetatype(clean, 'troll');
    expect(troll.metatype).toBe('troll');
    expect(troll.special).toEqual(clean.special);
    const aspected = setMagicKind({ ...cleanMage(), magic: { kind: 'aspected', aspect: 'sorcery' } }, 'magician');
    expect(aspected.magic).toEqual({ kind: 'magician' });
    expect(setMagicKind({ ...cleanMage(), magic: { kind: 'magician', tradition: 'hermetic' } }, 'aspected').magic).toEqual({
      kind: 'aspected',
      tradition: 'hermetic',
    });
  });

  it('setAttributePoints and setSpecialPoints never go below zero', () => {
    expect(setAttributePoints(clean, 'str', -2).attributes.str).toBe(0);
    expect(setSpecialPoints(clean, 'edg', 3.7).special.edg).toBe(3);
  });

  it('keeps a build parseable through every updater', () => {
    const b = build({ identity: { alias: 'Nib' } });
    const out = setSpecialPoints(setAttributePoints(setMagicKind(setMetatype(setPriority(b, 'magic', 'B'), 'elf'), 'adept'), 'agi', 3), 'mag', 1);
    expect(CharacterBuildSchema.parse(out)).toEqual(out);
  });
});

describe('shared answers the builder steps read instead of keeping their own copy', () => {
  it('freeKnowledgePoints is the budget\'s (INT + LOG) × 2 (SR5 p.89)', () => {
    expect(freeKnowledgePoints(3, 4)).toBe(14);
    const b = goldenSamurai();
    const r = ratings(b, settings());
    expect(budgets(b, settings()).pools.knowledge.available).toBeGreaterThanOrEqual(freeKnowledgePoints(r.attributes.int.rating, r.attributes.log.rating));
  });

  it('grantPoolIncludes reads a grant pool the way the validator does', () => {
    const arcana = activeSkillRow('arcana')!;
    const pistols = activeSkillRow('pistols')!;
    const hacking = activeSkillRow('hacking')!;
    expect(grantPoolIncludes(arcana, { kind: 'category', category: 'magical' })).toBe(true);
    expect(grantPoolIncludes(pistols, { kind: 'category', category: 'magical' })).toBe(false);
    expect(grantPoolIncludes(pistols, { kind: 'any' })).toBe(true);
    expect(grantPoolIncludes(hacking, { kind: 'groups', groups: ['cracking'] })).toBe(true);
    expect(grantPoolIncludes(pistols, { kind: 'groups', groups: ['cracking'] })).toBe(false);
  });

  it('eligibilityMessage is the validator\'s sentence for a fence', () => {
    const mundane = build({ identity: { alias: 'Nib' } });
    expect(eligibilityMessage('skill-restricted-magic', 'Spellcasting', mundane)).toBe('Spellcasting needs a Magic rating and a magic-using type.');
    const withSpell = vary(mundane, (b) => void b.skills.active.push({ id: 'spellcasting', points: 1, spec: null }));
    const issue = validate(withSpell, settings()).find((i) => i.code === 'skill-restricted-magic');
    expect(issue?.message).toBe(eligibilityMessage('skill-restricted-magic', 'Spellcasting', withSpell));
  });

  it('setPowerPointsBought keeps one spend where the first sat, and zero removes it', () => {
    const b = vary(build({ identity: { alias: 'Nib' } }), (x) => {
      x.karma.spends = [
        { kind: 'attribute', id: 'agi', from: 3, to: 4 },
        { kind: 'powerPoint', count: 1 },
        { kind: 'attribute', id: 'bod', from: 3, to: 4 },
        { kind: 'powerPoint', count: 2 },
      ] as never;
    });
    expect(powerPointsBought(b)).toBe(3);
    const four = setPowerPointsBought(b, 4);
    expect(four.karma.spends.map((s) => s.kind)).toEqual(['attribute', 'powerPoint', 'attribute']);
    expect(powerPointsBought(four)).toBe(4);
    expect(setPowerPointsBought(four, 4)).toBe(four);
    expect(setPowerPointsBought(four, 0).karma.spends.map((s) => s.kind)).toEqual(['attribute', 'attribute']);
    expect(powerPointsBought(setPowerPointsBought(build({ identity: { alias: 'Nib' } }), 2))).toBe(2);
  });

  it('BUILD_ATTRIBUTE_NAMES names every build attribute once', () => {
    expect(Object.keys(BUILD_ATTRIBUTE_NAMES)).toHaveLength(11);
    expect(BUILD_ATTRIBUTE_NAMES.agi).toEqual({ name: 'Agility', short: 'AGI' });
    expect(BUILD_ATTRIBUTE_NAMES.res.name).toBe('Resonance');
  });
});

// ---------------------------------------------------------------------------
// Cost, not just correctness
// ---------------------------------------------------------------------------

/**
 * `budgets`, `validate` and `compileBuild` used to walk the whole spend list
 * again for every attribute, skill, knowledge skill and language they were
 * building, and grew the knowledge and language lists with a linear `find` per
 * entry: quadratic in the record's own lists. The lists were unbounded, so a
 * record one PATCH could store took the server seconds per pass, in front of
 * the table's single database connection.
 *
 * Both halves are pinned here. The lists are bounded now
 * (`BUILD_LIST_MAX`, the contract's own test), and the passes at that bound
 * are milliseconds; the shape test is the tripwire for a reintroduced
 * quadratic, which no absolute number would catch on a faster machine.
 */
describe('the engine reads the record once, not once per entry', () => {
  const settings = ChargenSettingsSchema.parse({});
  const blank = CharacterBuildSchema.parse({ v: 1 });
  /**
   * Built around the schema, not through it: the shape test below needs a
   * record longer than `BUILD_LIST_MAX.karmaSpends` allows, which is exactly
   * the length the contract now refuses — so it is assembled as a value the
   * engine could be handed, never as one a route would accept.
   */
  const withSpends = (n: number): CharacterBuild => ({
    ...blank,
    karma: {
      ...blank.karma,
      spends: Array.from({ length: n }, (_, i) => ({
        kind: 'knowledge' as const,
        name: `Subject ${i}`,
        category: 'street' as const,
        from: 0,
        to: 1,
      })),
    },
  });

  const millis = (fn: () => void): number => {
    const at = performance.now();
    fn();
    return performance.now() - at;
  };

  /** The fastest of a few runs: a scheduler hiccup lengthens a run, never shortens one. */
  const best = (fn: () => void, runs = 3): number => Math.min(...Array.from({ length: runs }, () => millis(fn)));

  it('answers with the same numbers whatever the spend list does to its length', () => {
    // The fold's correctness first: each named subject is its own knowledge
    // skill at rating 1, and the Karma is one per new knowledge skill.
    for (const n of [1, 40, 200]) {
      const build = withSpends(n);
      const r = ratings(build, settings);
      expect(r.knowledge).toHaveLength(n);
      expect(r.knowledge.every((k) => k.rating === 1 && k.karma === 1 && k.index === null)).toBe(true);
      expect(compileBuild(build, settings).sheet.knowledge).toHaveLength(n);
      expect(budgets(build, settings).pools.karma.spent).toBe(n);
    }
  });

  it('costs no more than linearly per spend in budgets and validate', () => {
    // Four times the record must not be sixteen times the work. Measured at
    // two sizes well past the fixed cost of a pass, best of three runs so a
    // scheduler hiccup or a JIT warm-up cannot fail it: linear lands near 4,
    // and the quadratic this replaced measured 13.6 (budgets) and 13.8
    // (validate) on the machine that found it.
    const small = withSpends(1000);
    const large = withSpends(4000);
    for (const [what, pass] of [
      ['budgets', (b: CharacterBuild) => void budgets(b, settings)],
      ['validate', (b: CharacterBuild) => void validate(b, settings)],
    ] as const) {
      // Warm the code path before either measurement.
      pass(small);
      const base = Math.max(best(() => pass(small)), 0.25);
      const grown = best(() => pass(large));
      expect(grown / base, `${what}: ${base.toFixed(1)}ms -> ${grown.toFixed(1)}ms`).toBeLessThan(9);
    }
  });
});
