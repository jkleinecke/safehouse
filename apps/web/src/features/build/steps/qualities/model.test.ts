/**
 * The Qualities screen's words and edits (`model.ts`), on invented runners
 * and invented catalogue rows (DESIGN.md §14). Builds are made the way the
 * app makes them — a blank draft or a concept card — and every refusal is
 * the validator's own, read through the same `probe` the screen uses.
 *
 * Pinned: a whitelisted quality's effect said in our words with the rule's
 * numbers; the two lists with each line's target, "needs the GM" and the
 * GM's decision even after the validator drops a decided issue; the list's
 * own checks kept apart; the exclusions (Lucky beside Exceptional Attribute,
 * Distinctive Style beside Blandness), a Magic or metatype fence and the cap
 * refused before the fact — a cap already passed refused again when made
 * worse; a rating stepper refusing where the next rating would pass the
 * cap, a band's Karma passing through amounts the add button refuses; what
 * adding would break elsewhere said, not refused; born qualities and their
 * buy-off; stale taps doing nothing; hand-written qualities and modifiers.
 */
import { describe, expect, it } from 'vitest';
import type { BuildQuality, CharacterBuild } from '@safehouse/contracts';
import { qualityEffects, QUALITY_RULE_BY_ID } from '@safehouse/rules';
import { hitToQuality } from '../../kit/mappers.js';
import { SETTINGS, analysisOf, blankBuild, catalogueHit, conceptBuild } from '../../testing.js';
import {
  EMPTY_MOD_DRAFT,
  MOD_TARGET_GROUPS,
  addQuality,
  addQualityMod,
  attributeTargetOptions,
  bornQualityModels,
  buyOffDraft,
  candidateVerdict,
  customQualityHit,
  customQualityProblem,
  effectLines,
  metatypeKarmaNote,
  modDraftProblem,
  modFromDraft,
  modLine,
  pendingKey,
  pendingNeeds,
  qualityIndexOf,
  qualityLists,
  quickAdd,
  readPending,
  removeQuality,
  removeQualityMod,
  setQualityTarget,
  skillTargetOptions,
  startPending,
  takenCatalogueIds,
  undecidedIssues,
} from './model.js';

const q = (over: Partial<BuildQuality> & Pick<BuildQuality, 'name' | 'type' | 'karma'>): BuildQuality => ({
  rating: null,
  mods: [],
  ...over,
});

const withQualities = (build: CharacterBuild, qualities: BuildQuality[]): CharacterBuild => ({ ...build, qualities });

function listsOf(build: CharacterBuild) {
  const a = analysisOf(build);
  return qualityLists({
    build,
    allIssues: a.issues,
    undecided: undecidedIssues(build, SETTINGS, a.issues),
    stepIssues: a.issues.filter((i) => i.step === 5),
    effects: qualityEffects(build),
  });
}

function pendingOn(build: CharacterBuild, ...args: Parameters<typeof startPending>) {
  const a = analysisOf(build);
  return readPending(startPending(...args), a.probe, a.issues);
}

// Invented rows: our names, our numbers.
const steadyHands = catalogueHit({ id: 'q-steady', kind: 'quality', name: 'Steady Hands', stats: { KARMA: '10', TYPE: 'positive' } });
const ironCalm = catalogueHit({ id: 'q-iron', kind: 'quality', name: 'Iron Calm', stats: { KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' } });
const exceptional = catalogueHit({ id: 'q-ea', kind: 'quality', name: 'Exceptional Attribute', stats: { KARMA: '14', TYPE: 'positive' }, printedPage: 72 });
const lucky = catalogueHit({ id: 'q-lucky', kind: 'quality', name: 'Lucky', stats: { KARMA: '12', TYPE: 'positive' } });
const blandness = catalogueHit({ id: 'q-bland', kind: 'quality', name: 'Blandness', stats: { KARMA: '8', TYPE: 'positive' } });
const dependents = catalogueHit({ id: 'q-dep', kind: 'quality', name: 'Dependents', stats: { KARMA: '3, 6 or 9', TYPE: 'negative' } });
const incompetent = catalogueHit({ id: 'q-inc', kind: 'quality', name: 'Incompetent', stats: { KARMA: '5', TYPE: 'negative' } });
const unsided = catalogueHit({ id: 'q-odd', kind: 'quality', category: 'NEGATIVE QUALITIES', name: 'Odd Habit', stats: { KARMA: '6' } });

describe('what a whitelisted quality does, in our words', () => {
  it('fills each rule kind with the rule’s own numbers', () => {
    expect(effectLines(QUALITY_RULE_BY_ID.exceptionalAttribute)).toEqual([
      'One attribute you name may go 1 past its natural maximum (never Edge).',
      'Cannot be held with Lucky.',
    ]);
    expect(effectLines(QUALITY_RULE_BY_ID.willToLive)).toEqual(['One extra overflow box per rating, up to rating 3, at 3 Karma a rating.']);
    expect(effectLines(QUALITY_RULE_BY_ID.dependents)[0]).toBe('Lifestyle costs rise 10%, 20% or 30% by level, for 3, 6 or 9 Karma.');
    expect(effectLines(QUALITY_RULE_BY_ID.uncouth)).toEqual([
      'Karma costs double for social skills (with specialisations).',
      'Closed skill groups: Acting, Influence.',
    ]);
    expect(effectLines(QUALITY_RULE_BY_ID.humanLooking)).toEqual(['Only open to: Elf, Dwarf, Ork.']);
    expect(effectLines(QUALITY_RULE_BY_ID.bilingual)).toEqual(['A second native language, chosen on the Skills step.']);
    expect(effectLines(null)).toEqual([]);
  });
});

describe('the two lists', () => {
  const build = withQualities(conceptBuild('muscle'), [
    q({ name: 'Exceptional Attribute', type: 'positive', karma: 14, target: 'str' }),
    q({ name: 'Grudge Holder', type: 'negative', karma: 5 }),
    q({ name: 'Bilingual', type: 'positive', karma: 5 }),
  ]);

  it('splits by side, names each target and where else a quality sends the player', () => {
    const lists = listsOf(build);
    expect(lists.positive.map((r) => r.quality.name)).toEqual(['Exceptional Attribute', 'Bilingual']);
    expect(lists.negative.map((r) => r.karmaText)).toEqual(['gives 5 Karma']);
    const ea = lists.positive[0]!;
    expect(ea.karmaText).toBe('costs 14 Karma');
    expect(ea.target).toEqual({ kind: 'attribute', value: 'str' });
    expect(ea.reminders).toEqual([{ text: 'Spend the extra point of Strength on the attributes step.', step: 3 }]);
    expect(lists.positive[1]!.reminders).toEqual([{ text: 'Pick the second native language on the Skills step.', step: 6 }]);
    expect(lists.negative[0]!.entry).toBeNull();
    expect(lists.negative[0]!.effects).toEqual([]);
  });

  it('shows "needs the GM" with what the GM said — still there once the GM approved it', () => {
    const waiting = listsOf(build).positive[0]!.approval;
    expect(waiting?.code.startsWith('approval-quality')).toBe(true);
    expect(waiting?.decision).toBeNull();
    const code = waiting!.code;

    const approved = { ...build, approvals: { [code]: 'approved' as const } };
    expect(analysisOf(approved).issues.some((i) => i.code === code)).toBe(false);
    expect(listsOf(approved).positive[0]!.approval?.decision).toBe('approved');

    const denied = { ...build, approvals: { [code]: 'denied' as const } };
    const row = listsOf(denied).positive[0]!;
    expect(row.approval?.decision).toBe('denied');
    expect(row.problems.some((i) => i.code === code)).toBe(false);
  });

  it('reads a target named in brackets the way the engine does, and says when none is named', () => {
    const named = listsOf(withQualities(conceptBuild('muscle'), [q({ name: 'Exceptional Attribute (Body)', type: 'positive', karma: 14 })]));
    expect(named.positive[0]!.target).toEqual({ kind: 'attribute', value: 'bod' });
    const bare = listsOf(withQualities(conceptBuild('muscle'), [q({ name: 'Exceptional Attribute', type: 'positive', karma: 14 })]));
    expect(bare.positive[0]!.target).toEqual({ kind: 'attribute', value: null });
    expect(bare.positive[0]!.problems.map((i) => i.code)).toContain('exceptional-attribute-target');
  });

  it("keeps the list's own checks apart from any one line's", () => {
    const both = withQualities(conceptBuild('muscle'), [
      q({ name: 'Exceptional Attribute', type: 'positive', karma: 14, target: 'str' }),
      q({ name: 'Lucky', type: 'positive', karma: 12 }),
    ]);
    const lists = listsOf(both);
    expect(lists.loose.map((i) => i.code)).toContain('lucky-and-exceptional');
    expect(lists.loose.map((i) => i.code)).toContain('positive-quality-cap');
    expect(qualityIndexOf('qualities.3.target')).toBe(3);
    expect(qualityIndexOf('qualities')).toBeNull();
  });
});

describe('refusing before the fact', () => {
  it('refuses Exceptional Attribute beside Lucky with the validator’s sentence, and asks for its attribute', () => {
    const build = withQualities(conceptBuild('muscle'), [q({ name: 'Lucky', type: 'positive', karma: 12 })]);
    const reading = pendingOn(build, exceptional, { target: 'str' });
    expect(reading.canAdd).toBe(false);
    expect(reading.verdict.refusals.map((i) => i.message)).toContain('Take Lucky or Exceptional Attribute, not both.');
    expect(reading.verdict.refusals.every((i) => i.ref.page > 0)).toBe(true);

    const unnamed = pendingOn(blankBuild(), exceptional);
    expect(unnamed.needs.target).toBe('attribute');
    expect(unnamed.verdict.refusals.map((i) => i.code)).toEqual(['exceptional-attribute-target']);
    expect(pendingOn(blankBuild(), exceptional, { target: 'agi' }).canAdd).toBe(true);
  });

  it('refuses Blandness beside Distinctive Style', () => {
    const build = withQualities(conceptBuild('muscle'), [q({ name: 'Distinctive Style', type: 'negative', karma: 5 })]);
    const reading = pendingOn(build, blandness);
    expect(reading.verdict.refusals.map((i) => i.code)).toEqual(['quality-exclusive']);
    expect(reading.verdict.refusals[0]!.message).toBe('Distinctive Style and Blandness cannot be held together.');
    expect(quickAdd(reading)).toBeNull();
  });

  it('refuses a fence the runner is on the wrong side of', () => {
    const mentor = catalogueHit({ id: 'q-m', kind: 'quality', name: 'Mentor Spirit', stats: { KARMA: '5', TYPE: 'positive' } });
    expect(pendingOn(conceptBuild('muscle'), mentor).verdict.refusals.map((i) => i.code)).toEqual(['quality-requires-magic']);
    const resist = catalogueHit({ id: 'q-r', kind: 'quality', name: 'Magic Resistance', stats: { KARMA: '6', TYPE: 'positive' } });
    expect(pendingOn(conceptBuild('street-mage'), resist).verdict.refusals.map((i) => i.code)).toEqual(['quality-forbidden-with-magic']);
  });

  it('refuses passing the cap, and refuses again a list already over it', () => {
    const near = withQualities(conceptBuild('muscle'), [q({ name: 'Old Favour', type: 'positive', karma: 20 })]);
    const reading = pendingOn(near, steadyHands);
    expect(reading.verdict.refusals.map((i) => i.message)).toEqual(['Positive qualities cost 30 Karma; the cap is 25.']);

    const over = withQualities(conceptBuild('muscle'), [q({ name: 'Old Favour', type: 'positive', karma: 30 })]);
    expect(pendingOn(over, steadyHands).verdict.refusals.map((i) => i.message)).toEqual(['Positive qualities cost 40 Karma; the cap is 25.']);
    // Nothing new on the record itself: the verdict of no change is empty.
    const a = analysisOf(over);
    expect(candidateVerdict(a.probe((b) => b), a.issues)).toEqual({ refusals: [], breaks: [] });
  });

  it('shuts the rating stepper where the next rating would pass the cap', () => {
    const build = withQualities(conceptBuild('muscle'), [q({ name: 'Old Favour', type: 'positive', karma: 15 })]);
    const atTwo = pendingOn(build, ironCalm, { rating: 2 });
    expect(atTwo.needs.rating).toEqual({ min: 1, max: 3 });
    expect(atTwo.line?.karma).toBe(8);
    expect(atTwo.canAdd).toBe(true);
    expect(atTwo.ratingRefusal?.reason).toBe('Positive qualities cost 27 Karma; the cap is 25.');
    expect(pendingOn(build, ironCalm, { rating: 1 }).ratingRefusal).toBeNull();
    // At the book's maximum the picker's own bound speaks; no probe past it.
    expect(pendingOn(blankBuild(), ironCalm, { rating: 3 }).ratingRefusal).toBeNull();
  });

  it("offers a list price only at the amounts it lists — '3, 6 or 9' is never 4", () => {
    const low = pendingOn(conceptBuild('muscle'), dependents);
    expect(low.needs.band).toBeNull();
    expect(low.needs.choices).toEqual([3, 6, 9]);
    expect(low.line?.karma).toBe(3);
    expect(low.canAdd).toBe(true);
    expect(low.choiceReadings.map((c) => c.karma)).toEqual([3, 6, 9]);
    expect(low.choiceReadings.every((c) => c.refusal === null)).toBe(true);
    // A Karma between the listed amounts snaps to the nearest one, so no line is ever priced off the list.
    expect(pendingOn(conceptBuild('muscle'), dependents, { karma: 4 }).line?.karma).toBe(3);
    expect(pendingOn(conceptBuild('muscle'), dependents, { karma: 6 }).line?.karma).toBe(6);
  });

  it("walks a true band's Karma one at a time, inside its bounds", () => {
    const band = catalogueHit({ id: 'q-band', kind: 'quality', name: 'Old Debt', stats: { KARMA: '4-20', TYPE: 'negative' } });
    const reading = pendingOn(conceptBuild('muscle'), band, { karma: 10 });
    expect(reading.needs).toMatchObject({ band: { min: 4, max: 20 }, choices: null });
    expect(reading.line?.karma).toBe(10);
    expect(reading.choiceReadings).toEqual([]);
  });

  it('says what adding would break on another step without refusing it', () => {
    const reading = pendingOn(conceptBuild('street-mage'), incompetent, { target: 'conjuring' });
    expect(reading.verdict.refusals).toEqual([]);
    expect(reading.verdict.breaks.map((i) => i.code)).toContain('incompetent-group-owned');
    expect(reading.canAdd).toBe(true);
    expect(quickAdd(reading)).toBeNull();
  });

  it('adds a quality straight away only when it asks nothing and nothing stops it', () => {
    const line = quickAdd(pendingOn(conceptBuild('muscle'), steadyHands));
    expect(line).toMatchObject({ name: 'Steady Hands', type: 'positive', karma: 10, catalogueId: 'q-steady' });
    expect(quickAdd(pendingOn(conceptBuild('muscle'), ironCalm))).toBeNull();
    const odd = pendingOn(conceptBuild('muscle'), unsided);
    expect(odd.needs.askType).toBe(true);
    expect(startPending(unsided).type).toBe('negative');
    expect(odd.line?.type).toBe('negative');
    expect(pendingNeeds(steadyHands)).toMatchObject({ rating: null, band: null, askType: false, target: null });
    // A quality whose rating the engine reads moves only through its legal levels (qualityRatingRange).
    const dependentsBand = catalogueHit({ id: 'q-dep-band', kind: 'quality', name: 'Dependents', stats: { KARMA: '3 to 9', TYPE: 'negative' } });
    expect(pendingNeeds(dependentsBand)).toMatchObject({ band: null, choices: [3, 6, 9] });
    const willToLive = catalogueHit({ id: 'q-wtl', kind: 'quality', name: 'Will to Live', stats: { KARMA: '3', PER: 'rating', TYPE: 'positive' } });
    expect(pendingNeeds(willToLive).rating).toEqual({ min: 1, max: 3 });
    // Off the whitelist, a band stays a band and a rating keeps the row's own top.
    const bandOnly = catalogueHit({ id: 'q-band', kind: 'quality', name: 'Odd Debt', stats: { KARMA: '4 to 20', TYPE: 'negative' } });
    expect(pendingNeeds(bandOnly)).toMatchObject({ band: { min: 4, max: 20 }, choices: null });
    expect(pendingNeeds(ironCalm).rating).toEqual({ min: 1, max: 3 });
  });
});

describe('born with', () => {
  const pixie: CharacterBuild = { ...blankBuild(), metatype: 'pixie', priorities: { ...blankBuild().priorities, metatype: 'A' } };

  it('lists the quality a metatype is born with, and a positive line of it as its buy-off', () => {
    expect(bornQualityModels(pixie)).toEqual([expect.objectContaining({ id: 'uneducated', name: 'Uneducated', buyOffIndex: null })]);
    const bought = withQualities(pixie, [q({ name: 'Uneducated', type: 'positive', karma: 10 })]);
    expect(bornQualityModels(bought)[0]!.buyOffIndex).toBe(0);
    const row = listsOf(bought).positive[0]!;
    expect(row.buyOff).toBe(true);
    expect(row.karmaText).toBe('costs 10 Karma to buy off');
    expect(row.effects).toEqual([]);
    expect(buyOffDraft(bornQualityModels(pixie)[0]!)).toMatchObject({ name: 'Uneducated', type: 'positive', karma: '' });
  });

  it('says what the metatype itself costs, and that the cap does not count it', () => {
    const note = metatypeKarmaNote(pixie, analysisOf(pixie).ratings);
    expect(note?.karma).toBeGreaterThan(0);
    expect(note?.text).toMatch(/^The pixie metatype costs \d+ Karma at priority A\. The Karma pool pays it; it does not count toward the positive cap\.$/);
    expect(metatypeKarmaNote(conceptBuild('muscle'), analysisOf(conceptBuild('muscle')).ratings)).toBeNull();
  });
});

describe('edits', () => {
  const build = withQualities(blankBuild(), [
    q({ name: 'Steady Hands', type: 'positive', karma: 10 }),
    q({ name: 'Aptitude', type: 'positive', karma: 14 }),
  ]);

  it('removes the line shown, and does nothing when the list moved underneath the tap', () => {
    expect(removeQuality(0, 'Steady Hands')(build).qualities.map((x) => x.name)).toEqual(['Aptitude']);
    expect(removeQuality(0, 'Aptitude')(build)).toBe(build);
    expect(addQuality(q({ name: 'Night Owl', type: 'positive', karma: 3 }))(build).qualities).toHaveLength(3);
  });

  it('names and clears a target', () => {
    const named = setQualityTarget(1, 'Aptitude', 'automatics')(build);
    expect(named.qualities[1]!.target).toBe('automatics');
    expect(qualityEffects(named).aptitudeSkill).toBe('automatics');
    expect('target' in setQualityTarget(1, 'Aptitude', null)(named).qualities[1]!).toBe(false);
  });

  it('adds and removes a hand-entered modifier sourced to the quality', () => {
    const mod = modFromDraft({ name: 'Steady Hands' }, { target: 'limit.physical', op: 'add', value: '1' }, 'm-1');
    expect(mod).toEqual({ id: 'm-1', source: { kind: 'quality', ref: 'Steady Hands' }, target: 'limit.physical', op: 'add', value: 1, active: true, note: 'Steady Hands' });
    const withMod = addQualityMod(0, 'Steady Hands', mod!)(build);
    expect(withMod.qualities[0]!.mods).toHaveLength(1);
    expect(removeQualityMod(0, 'Steady Hands', 'm-1')(withMod).qualities[0]!.mods).toEqual([]);
    // It reaches play: the compiled sheet's derived limit moves.
    const before = analysisOf(build).preview.derived?.limits.physical.value ?? 0;
    expect(analysisOf(withMod).preview.derived?.limits.physical.value).toBe(before + 1);
  });

  it('lists the once-only catalogue rows already taken', () => {
    const taken = takenCatalogueIds(
      withQualities(blankBuild(), [
        hitToQuality(lucky),
        hitToQuality(steadyHands),
      ]),
    );
    expect([...taken]).toEqual(['q-lucky']);
  });
});

describe('targets offered', () => {
  it('offers the eight attributes to a mundane and Magic to a magician, each with the maximum it opens', () => {
    const muscle = conceptBuild('muscle');
    const options = attributeTargetOptions(muscle, analysisOf(muscle).ratings);
    expect(options.map((o) => o.value)).toEqual(['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha']);
    expect(options.find((o) => o.value === 'str')?.label).toMatch(/^Strength \(natural maximum (\d+), \d+ with this\)$/);
    const mage = conceptBuild('street-mage');
    expect(attributeTargetOptions(mage, analysisOf(mage).ratings).map((o) => o.value)).toContain('mag');
  });

  it('puts the skills a runner has first', () => {
    const muscle = conceptBuild('muscle');
    const groups = skillTargetOptions(analysisOf(muscle).ratings);
    expect(groups[0]!.label).toBe('Skills this runner has');
    expect(groups[0]!.options.map((o) => o.value)).toContain('automatics');
    expect(skillTargetOptions(analysisOf(blankBuild()).ratings).map((g) => g.label)).toEqual(['Every skill']);
  });
});

describe('write your own', () => {
  it('says what is missing, then makes a line with its side, Karma and page', () => {
    const draft = { name: '', type: 'negative' as const, karma: '', book: '', page: '' };
    expect(customQualityProblem(draft)).toBe('Give the quality a name.');
    expect(customQualityProblem({ ...draft, name: 'Old Debt' })).toBe('Karma is a whole number, 0 or more.');
    expect(customQualityProblem({ ...draft, name: 'Old Debt', karma: '6', page: '12' })).toBe('Say which book the page is in.');
    expect(customQualityHit({ ...draft, name: 'Old Debt' })).toBeNull();
    const hit = customQualityHit({ ...draft, name: 'Old Debt', karma: '6', book: 'hh', page: '12' });
    expect(hitToQuality(hit!)).toEqual({ name: 'Old Debt', ref: { book: 'HH', page: 12 }, type: 'negative', karma: 6, rating: null, mods: [] });
    expect(customQualityHit({ ...draft, name: 'Old Debt', karma: '6' })!.id).toBe('custom');
  });

  it('asks the validator afresh when a refused hand-written quality comes back with other Karma', () => {
    const near: CharacterBuild = withQualities(conceptBuild('muscle'), [q({ name: 'Old Favour', type: 'positive', karma: 20 })]);
    const a = analysisOf(near);
    const draft = { name: 'Night Owl', type: 'positive' as const, karma: '9', book: '', page: '' };
    const first = startPending(customQualityHit(draft)!, { type: 'positive' });
    const second = startPending(customQualityHit({ ...draft, karma: '4' })!, { type: 'positive' });
    expect(pendingKey(first)).not.toBe(pendingKey(second));
    expect(readPending(first, a.probe, a.issues).canAdd).toBe(false);
    expect(readPending(second, a.probe, a.issues).canAdd).toBe(true);
  });
});

describe('modifiers in words', () => {
  it('reads targets the derive pipeline knows, and refuses a draft that says nothing', () => {
    const all = MOD_TARGET_GROUPS.flatMap((g) => g.options.map((o) => o.value));
    expect(all).toEqual(expect.arrayContaining(['attr.agi', 'limit.social', 'initiative.dice', 'monitor.overflow', 'pool.all', 'pool.skill.automatics', 'armor']));
    expect(all).not.toContain('attr.edg');
    expect(modLine({ target: 'limit.physical', op: 'add', value: 1 })).toBe('+1 Physical limit');
    expect(modLine({ target: 'pool.skill.automatics', op: 'add', value: -2 })).toBe('−2 Automatics pool');
    expect(modLine({ target: 'initiative.dice', op: 'set', value: 2 })).toBe('Initiative dice set to 2');
    expect(modLine({ target: 'armor', op: 'cap', value: 10 })).toBe('Armor capped at 10');
    expect(modDraftProblem(EMPTY_MOD_DRAFT)).toBeNull();
    expect(modDraftProblem({ ...EMPTY_MOD_DRAFT, value: 'lots' })).toBe('The value is a number, like 1, -2 or 0.5.');
    expect(modDraftProblem({ ...EMPTY_MOD_DRAFT, value: '0' })).toBe('Adding 0 changes nothing.');
    expect(modDraftProblem({ ...EMPTY_MOD_DRAFT, target: 'luck' })).toBe('Pick what the modifier changes.');
  });
});
