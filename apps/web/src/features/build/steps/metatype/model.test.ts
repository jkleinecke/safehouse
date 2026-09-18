/**
 * The Metatype & attributes screen's words and gates, as functions
 * (docs/CHARGEN.md §4.4 Step 3). Builds are made the way the app makes them —
 * a concept card applied, then the engine's own updaters — and analysed by
 * the engine, so every refusal asserted here is the validator's sentence for
 * a real record, not a fixture's guess. Invented runners only.
 *
 * What is pinned: racial traits and lifestyle multipliers in our words; the
 * cards offered per campaign setting, grouped by family, with the special
 * points at the build's row and a metatype off its row refused in the
 * validator's words; every row's figures, including the book's `4 (6)` from
 * the derived preview; the second attribute reaching its maximum refused with
 * the engine's sentence and page (and where a quality would allow it, the way
 * to step 5); a pool overspend not refused; Magic and Resonance shut until a
 * type uses them; and each finding placed beside the control it concerns.
 */
import { describe, expect, it } from 'vitest';
import {
  CharacterBuildSchema,
  ChargenSettingsSchema,
  type CharacterBuild,
  type ChargenSettings,
  type DerivedCharacter,
  type Issue,
} from '@safehouse/contracts';
import {
  BUILD_ATTRIBUTE_NAMES,
  METATYPE_BY_ID,
  applyConcept,
  conceptPreset,
  ratings as engineRatings,
  setAttributePoints,
  setMagicKind,
  setMetatype,
  setPriority,
  setSpecialPoints,
} from '@safehouse/rules';
import { analyseBuild } from '../../analysis.js';
import { SETTINGS, analysisOf, blankBuild, conceptBuild } from '../../testing.js';
import {
  SAID_BY_POOL_LINE,
  attributeLine,
  attributeRows,
  issuesBesideCards,
  issuesElsewhere,
  karmaCostWords,
  karmaWords,
  lifestyleWords,
  maxWords,
  metatypeAside,
  metatypeCard,
  metatypeGroups,
  metatypeNotes,
  metatypeSection,
  placeIssues,
  previewBasesWords,
  probeKey,
  qualityWouldLift,
  rangesOf,
  ratingSpoken,
  ratingText,
  specialByRow,
  stepNav,
  traitsOf,
  worsenedErrors,
} from './model.js';

const ALLOW: ChargenSettings = ChargenSettingsSchema.parse({ allowMetavariants: true });

/** The rows for a build, analysed the way the shell analyses it. */
function rowsOf(build: CharacterBuild, settings: ChargenSettings = SETTINGS) {
  const a = analyseBuild(build, settings);
  return {
    analysis: a,
    rows: attributeRows({ build, table: settings.table, ratings: a.ratings, derived: a.preview.derived, probe: a.probe, allIssues: a.issues, readOnly: false }),
  };
}

const row = (rows: ReturnType<typeof rowsOf>['rows'], id: string) =>
  [...rows.eight, ...rows.special].find((r) => r.line.id === id)!;

/** The invented troll muscle: B/C/E/D/A, Body 10 of 10, Strength 8 of 10, every attribute point spent. */
const muscle = (): CharacterBuild => conceptBuild('muscle');

/** A human with every priority set and nothing spent, for Edge and the special pool. */
function human(): CharacterBuild {
  let b = blankBuild();
  b = setPriority(b, 'metatype', 'A');
  b = setPriority(b, 'attributes', 'B');
  b = setPriority(b, 'magic', 'C');
  b = setPriority(b, 'skills', 'D');
  b = setPriority(b, 'resources', 'E');
  return setMetatype(b, 'human');
}

describe('words for the metatype table', () => {
  it('says racial traits in our words, with the numbers the table carries', () => {
    expect(traitsOf(METATYPE_BY_ID.troll)).toEqual(['thermographic vision', '+1 Reach', '+1 armor from tough skin']);
    expect(traitsOf(METATYPE_BY_ID.dwarf)).toEqual(['thermographic vision', '+2 dice against toxins and disease']);
    expect(traitsOf(METATYPE_BY_ID.human)).toEqual([]);
    expect(traitsOf(METATYPE_BY_ID['shapeshifter-lupine'])).toContain('shifts between forms');
  });

  it('names a lifestyle multiplier only where there is one', () => {
    expect(lifestyleWords(1)).toBeNull();
    expect(lifestyleWords(METATYPE_BY_ID.dwarf.lifestyleMultiplier)).toBe('lifestyles cost ×1.2');
    expect(lifestyleWords(METATYPE_BY_ID.troll.lifestyleMultiplier)).toBe('lifestyles cost ×2');
  });

  it('gives base/max for the nine table attributes and notes what is not a trait', () => {
    const troll = rangesOf(METATYPE_BY_ID.troll);
    expect(troll.map((r) => r.short)).toEqual(['BOD', 'AGI', 'REA', 'STR', 'WIL', 'LOG', 'INT', 'CHA', 'EDG']);
    expect(troll[0]).toMatchObject({ id: 'bod', name: 'Body', base: 5, max: 10 });
    expect(metatypeNotes(METATYPE_BY_ID.gnome)).toEqual(['Dwarf variant']);
    expect(metatypeNotes(METATYPE_BY_ID.centaur)).toEqual(['born with Magic 1', 'can never have Resonance']);
    expect(metatypeNotes(METATYPE_BY_ID.elf)).toEqual([]);
  });

  it("puts the build's row's special points beside the title, and the extra Karma in the body", () => {
    expect(metatypeAside(METATYPE_BY_ID.human, 'A')).toBe('9 special points');
    expect(metatypeAside(METATYPE_BY_ID.troll, 'B')).toBe('no special points');
    expect(metatypeAside(METATYPE_BY_ID.troll, 'C')).toBe('not on row C');
    expect(metatypeAside(METATYPE_BY_ID.wakyambi, 'A')).toBe('8 special points');
    expect(metatypeAside(METATYPE_BY_ID.human, null)).toBeNull();
    expect(karmaCostWords(METATYPE_BY_ID.wakyambi)).toBe('costs 12 Karma');
    expect(karmaCostWords(METATYPE_BY_ID.troll)).toBeNull();
    expect(metatypeCard(METATYPE_BY_ID.wakyambi, 'A')).toMatchObject({ karma: 12, karmaWords: 'costs 12 Karma' });
    expect(specialByRow(METATYPE_BY_ID.elf)).toBe('A 8 · B 6 · C 3 · D 0 · E –');
    // Without a row, the card lists every row instead.
    expect(metatypeCard(METATYPE_BY_ID.elf, null).byRow).toBe('A 8 · B 6 · C 3 · D 0 · E –');
    expect(metatypeCard(METATYPE_BY_ID.elf, 'B').byRow).toBeNull();
  });
});

describe('which metatype cards are offered', () => {
  it('offers the core five unless the campaign allows the rest, grouped by family', () => {
    expect(metatypeGroups(false, null).map((g) => [g.family, g.rows.length])).toEqual([['core', 5]]);
    expect(metatypeGroups(true, null).map((g) => [g.family, g.rows.length])).toEqual([
      ['core', 5],
      ['metavariant', 17],
      ['metasapient', 4],
      ['shapeshifter', 10],
    ]);
  });

  it('keeps a metatype already on the record visible, so its refusal can be read', () => {
    const groups = metatypeGroups(false, 'Nartaki');
    expect(groups.map((g) => [g.family, g.rows.map((r) => r.id), g.holdsChoice])).toEqual([
      ['core', ['human', 'elf', 'dwarf', 'ork', 'troll'], false],
      ['metavariant', ['nartaki'], true],
    ]);
    expect(metatypeGroups(true, 'troll', true).map((g) => g.rows.map((r) => r.id))).toEqual([['troll']]);
  });

  it("refuses a metatype off the build's row in the validator's words, the chosen card included", () => {
    const b = setPriority(muscle(), 'metatype', 'C');
    const a = analysisOf(b);
    const section = metatypeSection({ build: b, settings: SETTINGS, probe: a.probe, readOnly: false });
    const card = (id: string) => section.groups[0]!.choices.find((c) => c.card.id === id)!;
    expect(section.chosen).toBe('troll');
    expect(section.level).toBe('C');
    expect(card('troll').refusal).toEqual({ reason: 'Troll cannot be taken at Metatype priority C.', ref: { book: 'SR5', page: 65 } });
    expect(card('troll').card.aside).toBe('not on row C');
    expect(card('human').refusal).toBeNull();
    expect(card('human').card.aside).toBe('5 special points');
    // Said once, under the card, not again above the cards.
    const metatypeIssues = a.issues.filter((i) => i.code.startsWith('metatype-'));
    expect(metatypeIssues.map((i) => i.code)).toEqual(['metatype-not-on-row']);
    expect(issuesBesideCards(metatypeIssues, section)).toEqual([]);
    expect(issuesBesideCards(metatypeIssues, { ...section, chosen: null })).toEqual(metatypeIssues);
  });

  it('offers metavariants with their Karma when allowed, and refuses them by setting when not', () => {
    const b = muscle();
    const allowed = metatypeSection({ build: b, settings: ALLOW, probe: analyseBuild(b, ALLOW).probe, readOnly: false });
    const wakyambi = allowed.groups[1]!.choices.find((c) => c.card.id === 'wakyambi')!;
    expect(wakyambi.refusal).toBeNull();
    expect(wakyambi.card.karma).toBe(12);
    // A metavariant already on the record in a campaign that does not allow them.
    const onRecord = setMetatype(b, 'ogre');
    const shut = metatypeSection({ build: onRecord, settings: SETTINGS, probe: analysisOf(onRecord).probe, readOnly: false });
    expect(shut.groups[1]!.choices[0]!.refusal?.reason).toBe('Ogre needs the campaign to allow metavariants.');
  });
});

describe('attribute rows', () => {
  it('lays out base, points, Karma, rating and the natural maximum from the engine', () => {
    const { rows } = rowsOf(muscle());
    expect(row(rows, 'bod').line).toMatchObject({
      name: 'Body',
      base: 5,
      points: 5,
      karma: 0,
      rating: 10,
      max: 10,
      atMax: true,
      augmented: null,
    });
    expect(row(rows, 'str').line).toMatchObject({ rating: 8, max: 10, atMax: false });
    expect(rows.eight.map((r) => r.line.id)).toEqual(['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha']);
    expect(rows.special.map((r) => r.line.id)).toEqual(['edg', 'mag', 'res']);
    expect(karmaWords({ karma: 0 })).toBe('none yet, raised in step 8');
    expect(karmaWords({ karma: 2 })).toBe('+2, raised in step 8');
    expect(previewBasesWords(null)).toBe("No metatype yet, so the rows show a human's starting ratings and maximums.");
    expect(previewBasesWords(METATYPE_BY_ID.troll)).toBeNull();
  });

  it("writes 'ware in the book's 4 (6) form, and Magic's Essence loss in words", () => {
    const b = muscle();
    const r = engineRatings(b, SETTINGS);
    const derived = { attributes: { rea: { value: 6 }, mag: { value: 0 } } } as unknown as DerivedCharacter;
    const rea = attributeLine(r.attributes.rea, derived);
    expect(rea.augmented).toBe(6);
    expect(ratingText(rea)).toBe('4 (6)');
    expect(ratingSpoken(rea)).toBe('Reaction 4, augmented 6');
    const loss = { id: 'mag' as const, name: 'Magic', rating: 6, augmented: 5 };
    expect(ratingText(loss)).toBe('6, 5 after Essence loss');
    expect(ratingSpoken(loss)).toBe('Magic 6, 5 after Essence loss');
    // Edge is never augmented; a derived value equal to the rating is not shown twice.
    expect(attributeLine(r.attributes.edg, { attributes: { edg: { value: 9 } } } as unknown as DerivedCharacter).augmented).toBeNull();
    expect(ratingText(attributeLine(r.attributes.bod, { attributes: { bod: { value: 10 } } } as unknown as DerivedCharacter))).toBe('10');
  });

  it("reads the augmented total off the build's own derived preview", () => {
    const b = CharacterBuildSchema.parse({
      ...muscle(),
      purchases: [
        {
          list: 'augments',
          kind: 'augmentation',
          name: 'Reflex Lattice',
          cost: 1_000,
          essence: 0.5,
          item: {
            name: 'Reflex Lattice',
            essence: 0.5,
            mods: [{ id: 'm-lattice', source: { kind: 'cyberware' }, target: 'attr.rea', op: 'add', value: 2, active: true }],
          },
        },
      ],
    });
    const { rows } = rowsOf(b);
    expect(ratingText(row(rows, 'rea').line)).toBe('4 (6)');
  });

  it('marks a maximum a quality lifted', () => {
    expect(maxWords({ max: 11, lifted: true })).toBe('11, lifted by a quality');
    expect(maxWords({ max: 10, lifted: false })).toBe('10');
  });
});

describe('refusing an increase before the fact', () => {
  it("refuses the second attribute reaching its maximum with the engine's sentence and page", () => {
    const b = setAttributePoints(muscle(), 'str', 4); // Strength 9 of 10, Body already at 10
    const { rows, analysis } = rowsOf(b);
    const str = row(rows, 'str');
    expect(str.refusal).toEqual({
      reason: 'Only one attribute may start at its natural maximum: Body, Strength are. Exceptional Attribute on one of them would allow it.',
      ref: { book: 'SR5', page: 72 },
    });
    expect(str.refusingIssue?.code).toBe('attribute-max-more-than-one');
    // Nothing is wrong on the record yet: the refusal is before the fact.
    expect(analysis.issues.some((i) => i.code === 'attribute-max-more-than-one')).toBe(false);
    // The validator files it where a quality would settle it, so the screen offers step 5.
    expect(qualityWouldLift(rows.eight)).toBe(true);
  });

  it('says the plain rule, at its own page, once Exceptional Attribute is spent elsewhere', () => {
    const b = CharacterBuildSchema.parse({
      ...setAttributePoints(muscle(), 'str', 4),
      qualities: [{ name: 'Exceptional Attribute', type: 'positive', karma: 14, target: 'agi' }],
    });
    const { rows } = rowsOf(b);
    expect(row(rows, 'str').refusal).toEqual({
      reason: 'Only one attribute may start at its natural maximum: Body, Strength are.',
      ref: { book: 'SR5', page: 66 },
    });
    expect(qualityWouldLift(rows.eight)).toBe(false);
    // Agility's maximum is lifted, and says so.
    expect(row(rows, 'agi').line).toMatchObject({ max: 6, lifted: true });
  });

  it('refuses an attribute past its own maximum, naming the quality that would allow one over', () => {
    const { rows } = rowsOf(muscle());
    expect(row(rows, 'bod').refusal?.reason).toBe('Body 11 is one over its maximum of 10; Exceptional Attribute would allow it.');
  });

  it('does not refuse spending past the pool — the pool line says that once', () => {
    const { rows, analysis } = rowsOf(muscle());
    expect(analysis.budgets.pools.attributes.remaining).toBe(0);
    // Reaction 4 of 6: one more point is over the pool, under every cap.
    expect(row(rows, 'rea').refusal).toBeNull();
    expect(row(rows, 'wil').refusal).toBeNull();
  });

  it('refuses Edge past its maximum, naming Lucky', () => {
    const b = setSpecialPoints(human(), 'edg', 5); // Edge 7 of 7
    const { rows } = rowsOf(b);
    expect(row(rows, 'edg').line).toMatchObject({ rating: 7, max: 7, atMax: true });
    expect(row(rows, 'edg').refusal?.reason).toBe('Edge 8 is one over its maximum of 7; Lucky would allow it.');
  });

  it('only counts errors a change brings in or makes worse', () => {
    const current: Issue[] = [
      {
        code: 'attribute-over-max',
        severity: 'error',
        step: 3,
        message: 'Body 11 is over its maximum of 10.',
        ref: { book: 'SR5', page: 66 },
        path: 'attributes.bod',
      },
    ];
    const worse: Issue = { ...current[0]!, message: 'Body 12 is over its maximum of 10.' };
    expect(worsenedErrors({ blocking: current }, current)).toEqual([]);
    expect(worsenedErrors({ blocking: [worse] }, current)).toEqual([worse]);
  });

  it('keys each probe by step, attribute and target so no other step shares the answer', () => {
    expect(probeKey.increase('agi', 3)).toBe('s3:points:agi:4');
    expect(probeKey.metatype('elf')).toBe('s3:metatype:elf');
  });

  it('probes nothing when read-only', () => {
    const b = setAttributePoints(muscle(), 'str', 4);
    const a = analysisOf(b);
    let probes = 0;
    const counting: typeof a.probe = (fn, key) => {
      probes++;
      return a.probe(fn, key);
    };
    const input = { build: b, table: SETTINGS.table, ratings: a.ratings, derived: a.preview.derived, allIssues: a.issues, readOnly: true };
    const rows = attributeRows({ ...input, probe: counting });
    expect(probes).toBe(0);
    expect(rows.eight.every((r) => r.refusal === null)).toBe(true);
  });
});

describe('special attributes', () => {
  it('opens Magic and Resonance before step 4 while the Magic row offers a type that uses them and no kind is chosen yet', () => {
    // Human at Magic C, still mundane: the row offers magicians, adepts and technomancers alike.
    const b = human();
    expect(b.magic.kind).toBe('mundane');
    const { rows } = rowsOf(b);
    expect(row(rows, 'edg').control).toBe('stepper');
    expect(row(rows, 'mag')).toMatchObject({ control: 'stepper', refusal: null, opensInStep: null });
    expect(row(rows, 'res')).toMatchObject({ control: 'stepper', refusal: null, opensInStep: null });
  });

  it('does not refuse a point on Magic for the kind step 4 has still to choose; the validator files that on step 4', () => {
    const b = setSpecialPoints(human(), 'mag', 1);
    const { rows, analysis } = rowsOf(b);
    expect(row(rows, 'mag')).toMatchObject({ control: 'stepper', refusal: null });
    const filed = analysis.issues.filter((i) => i.code === 'special-points-no-magic');
    expect(filed.map((i) => i.step)).toEqual([4]);
    // …and beside the row, with its way to step 4.
    expect(placeIssues(issuesElsewhere(analysis.issues)).rows.mag?.map((i) => i.code)).toEqual(['special-points-no-magic']);
  });

  it('a Magic row that offers neither says so for each, and the way is back to step 2', () => {
    const { rows } = rowsOf(muscle());
    const mag = row(rows, 'mag');
    expect(mag.control).toBe('closed');
    expect(mag.refusal).toEqual({ reason: 'Magic priority E gives no Magic.', ref: { book: 'SR5', page: 65 } });
    expect(mag.opensInStep).toBe(2);
    expect(row(rows, 'res')).toMatchObject({ control: 'closed', opensInStep: 2 });
    expect(row(rows, 'res').refusal?.reason).toBe('Magic priority E gives no Resonance.');
  });

  it('with no Magic priority yet, the way is step 2', () => {
    const { rows } = rowsOf(blankBuild());
    expect(row(rows, 'mag')).toMatchObject({ control: 'closed', opensInStep: 2 });
    expect(row(rows, 'mag').refusal?.reason).toBe('Magic opens once step 2 sets the Magic or Resonance priority.');
  });

  it('opens Resonance for a technomancer and Magic for a magician, and shuts the other with the way to step 4', () => {
    const tech = rowsOf(conceptBuild('technomancer')).rows;
    expect(row(tech, 'res').control).toBe('stepper');
    expect(row(tech, 'mag')).toMatchObject({ control: 'closed', opensInStep: 4 });
    expect(row(tech, 'mag').refusal).toEqual({ reason: 'Magic opens if step 4 gives this runner a type that uses it.', ref: { book: 'SR5', page: 66 } });
    const mage = rowsOf(setMagicKind(human(), 'magician')).rows;
    expect(row(mage, 'mag')).toMatchObject({ control: 'stepper', refusal: null });
    expect(row(mage, 'res')).toMatchObject({ control: 'closed', opensInStep: 4 });
    expect(row(mage, 'res').refusal?.reason).toBe('Resonance opens if step 4 makes this runner a technomancer.');
  });

  it('opens natural Magic for a metasapient and never offers it Resonance', () => {
    const preset = conceptPreset('muscle')!;
    const b = setMetatype(applyConcept(blankBuild(), preset, ALLOW), 'centaur');
    const { rows } = rowsOf(b, ALLOW);
    expect(row(rows, 'mag').control).toBe('stepper');
    const res = row(rows, 'res');
    expect(res).toMatchObject({ control: 'closed', opensInStep: null });
    expect(res.refusal).toEqual({ reason: 'This metatype can never have Resonance.', ref: { book: 'RF', page: 102 } });
  });

  it('leaves points already on a shut row reachable, so they can be taken back', () => {
    const b = setSpecialPoints(muscle(), 'mag', 2);
    const mag = row(rowsOf(b).rows, 'mag');
    expect(mag.control).toBe('stepper');
    expect(mag.line.points).toBe(2);
    expect(mag.refusal?.reason).toBe('Magic priority E gives no Magic.');
  });
});

describe('links to other steps', () => {
  it('go back always, and forward only where guided mode would let the player land', () => {
    const b = human();
    const a = analysisOf(b);
    expect(a.steps[2]!.complete).toBe(false);
    const guided = stepNav({ goTo: () => undefined, steps: a.steps, meta: { step: 3 }, mode: 'guided' });
    expect(guided.canGo(2)).toBe(true);
    expect(guided.canGo(4)).toBe(false);
    expect(guided.canGo(5)).toBe(false);
    const free = stepNav({ goTo: () => undefined, steps: a.steps, meta: { step: 3 }, mode: 'free' });
    expect(free.canGo(5)).toBe(true);
    const done = analysisOf(muscle());
    expect(stepNav({ goTo: () => undefined, steps: done.steps, meta: { step: 3 }, mode: 'guided' }).canGo(5)).toBe(true);
  });
});

describe('placing findings beside their controls', () => {
  const issue = (code: string, path?: string, step = 3): Issue => ({
    code,
    severity: 'error',
    step: step as Issue['step'],
    message: code,
    ref: { book: 'SR5', page: 66 },
    ...(path ? { path } : {}),
  });

  it('places by path, then by the code family, and leaves pool counts to the pool line', () => {
    const placed = placeIssues([
      issue('metatype-missing', 'metatype'),
      issue('attribute-over-max', 'attributes.agi'),
      issue('attribute-over-max', 'special.edg'),
      issue('attribute-max-more-than-one', 'qualities', 5),
      issue('attribute-over-max', 'karma.spends', 8),
      issue('special-points-no-magic', 'special.mag', 4),
      issue('special-points-unspent', 'special'),
      issue('attribute-points-unspent', 'attributes'),
      issue('special-points-over', 'special'),
      issue('something-else', 'skills'),
    ]);
    expect(placed.metatype.map((i) => i.code)).toEqual(['metatype-missing']);
    expect(Object.keys(placed.rows)).toEqual(['agi', 'edg', 'mag']);
    expect(placed.attributes.map((i) => `${i.code}@${i.step}`)).toEqual(['attribute-max-more-than-one@5', 'attribute-over-max@8']);
    expect(placed.special.map((i) => i.code)).toEqual(['special-points-unspent']);
    expect(placed.other.map((i) => i.code)).toEqual(['something-else']);
    expect(SAID_BY_POOL_LINE.has('attribute-points-unspent')).toBe(true);
  });

  it('brings in the findings about these choices that the validator files on another step', () => {
    // Two attributes at their maximum with Exceptional Attribute still to take: filed on step 5.
    const b = setAttributePoints(muscle(), 'str', 5);
    const a = analysisOf(b);
    const elsewhere = issuesElsewhere(a.issues);
    expect(elsewhere.map((i) => [i.code, i.step])).toEqual([['attribute-max-more-than-one', 5]]);
    expect(a.issues.filter((i) => i.step === 3).some((i) => i.code === 'attribute-max-more-than-one')).toBe(false);
  });

  it('names every attribute the engine rates', () => {
    const r = engineRatings(muscle(), SETTINGS);
    expect(Object.keys(r.attributes).sort()).toEqual(Object.keys(BUILD_ATTRIBUTE_NAMES).sort());
  });
});
