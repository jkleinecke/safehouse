/**
 * The Skills screen's logic, tested as functions (FR3.9, docs/CHARGEN.md §4.4
 * Step 6).
 *
 * Under `renderToStaticMarkup` no handler runs, so what a tap does is pinned
 * here: the edits as pure field sets over the record, the readings of the
 * skill list with a build laid over it, and — the part a screen most easily
 * gets wrong — which of a probe's errors shut which control. Every build is
 * made the way the app makes one, a concept card applied to an invented
 * runner (`../../testing.ts`), and every number asserted is the engine's
 * answer for it, never one typed into a fixture.
 */
import { describe, expect, it } from 'vitest';
import type { BuildQuality, CharacterBuild } from '@safehouse/contracts';
import { analyseBuild, type BuildAnalysis } from '../../analysis.js';
import { SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import {
  GROUP_RAISE_CODES,
  KNOWLEDGE_RAISE_CODES,
  NATIVE_CODES,
  SKILL_RAISE_CODES,
  SPEC_FLOOR_CODES,
  activeSpecPrice,
  addKnowledge,
  addLanguage,
  addSpecificEntry,
  capRefusal,
  countLines,
  diceLabel,
  diceWords,
  fenceRefusal,
  mayPassMax,
  filterCountLine,
  filterGroups,
  filterSections,
  groupLines,
  holdersLine,
  knowledgeQuote,
  knowledgeRatingWords,
  listWords,
  mainCost,
  matchesQuery,
  membersWithOwnPoints,
  nativeLine,
  patchKnowledge,
  patchLanguage,
  placeIssues,
  poolCosts,
  priorityLineFor,
  removeActiveEntry,
  removeKnowledge,
  removeLanguage,
  returnActivePoints,
  setActivePoints,
  setActiveSpec,
  setActiveTarget,
  setGroupPoints,
  skillDice,
  skillSections,
  specValue,
  tradeLine,
  tradePrices,
  withUnshownInRest,
} from './model.js';

const quality = (name: string, over: Partial<BuildQuality> = {}): BuildQuality => ({
  name,
  type: 'positive',
  karma: 14,
  rating: null,
  mods: [],
  ...over,
});

const withQualities = (b: CharacterBuild, ...qualities: BuildQuality[]): CharacterBuild => ({ ...b, qualities: [...b.qualities, ...qualities] });

const entryOf = (b: CharacterBuild, id: string) => b.skills.active.find((e) => e.id === id);
const indexOf = (b: CharacterBuild, id: string): number => b.skills.active.findIndex((e) => e.id === id);

function lineOf(a: BuildAnalysis, b: CharacterBuild, id: string) {
  for (const s of skillSections(b, a.ratings, a.eligibility)) {
    const line = s.lines.find((l) => l.row.id === id);
    if (line) return line;
  }
  throw new Error(`no line ${id}`);
}

describe('edits are pure field sets over skills', () => {
  it('a stepper on an unbought skill creates its entry, updates it, and drops it at zero', () => {
    const start = blankBuild();
    const one = setActivePoints(start, { id: 'sneaking', index: null }, 1);
    expect(start.skills.active).toEqual([]);
    expect(one.skills.active).toEqual([{ id: 'sneaking', points: 1, spec: null }]);
    const three = setActivePoints(one, { id: 'sneaking', index: 0 }, 3);
    expect(entryOf(three, 'sneaking')?.points).toBe(3);
    expect(setActivePoints(three, { id: 'sneaking', index: 0 }, 0).skills.active).toEqual([]);
    // Nothing to write, nothing written.
    expect(setActivePoints(start, { id: 'sneaking', index: null }, 0)).toBe(start);
  });

  it('keeps a skill at zero points while it still holds a specialisation', () => {
    const b = setActiveSpec(setActivePoints(blankBuild(), { id: 'pistols', index: null }, 2), { id: 'pistols', index: 0 }, 'Revolvers');
    const dropped = setActivePoints(b, { id: 'pistols', index: 0 }, 0);
    expect(dropped.skills.active).toEqual([{ id: 'pistols', points: 0, spec: 'Revolvers' }]);
    expect(returnActivePoints(b, 0).skills.active).toEqual([]);
  });

  it('keeps a specialisation as typed, and a blank one as none', () => {
    expect(specValue('Heavy ')).toBe('Heavy ');
    expect(specValue('   ')).toBeNull();
    const b = setActiveSpec(setActivePoints(blankBuild(), { id: 'blades', index: null }, 2), { id: 'blades', index: 0 }, '  ');
    expect(entryOf(b, 'blades')?.spec).toBeNull();
  });

  it('keeps one entry per weapon or vehicle for a specific skill, removed only on purpose', () => {
    const named = setActiveTarget(blankBuild(), { id: 'exotic-ranged', index: null }, 'Dart thrower');
    expect(named.skills.active).toEqual([{ id: 'exotic-ranged', points: 0, spec: null, target: 'Dart thrower' }]);
    const zero = setActivePoints(setActivePoints(named, { id: 'exotic-ranged', index: 0 }, 2), { id: 'exotic-ranged', index: 0 }, 0);
    expect(zero.skills.active).toHaveLength(1);
    const two = addSpecificEntry(zero, 'exotic-ranged');
    expect(two.skills.active[1]).toEqual({ id: 'exotic-ranged', points: 0, spec: null, target: '' });
    expect(removeActiveEntry(two, 0).skills.active).toEqual([{ id: 'exotic-ranged', points: 0, spec: null, target: '' }]);
    expect(removeActiveEntry(two, 9)).toBe(two);
  });

  it('buys, changes and drops a group by id', () => {
    const b = setGroupPoints(blankBuild(), 'Close Combat', 2);
    expect(b.skills.groups).toEqual([{ id: 'close-combat', points: 2 }]);
    expect(setGroupPoints(b, 'close-combat', 3).skills.groups).toEqual([{ id: 'close-combat', points: 3 }]);
    expect(setGroupPoints(b, 'close-combat', 0).skills.groups).toEqual([]);
  });

  it('adds, edits and removes knowledge skills and languages', () => {
    let b = addKnowledge(blankBuild(), 'street');
    b = patchKnowledge(b, 0, { name: 'Dock gangs', points: 2, spec: '' });
    expect(b.skills.knowledge).toEqual([{ name: 'Dock gangs', category: 'street', points: 2, skillPoints: 0, spec: null }]);
    b = patchKnowledge(b, 0, { category: 'interests', skillPoints: 1 });
    expect(b.skills.knowledge[0]).toMatchObject({ category: 'interests', points: 2, skillPoints: 1 });
    expect(removeKnowledge(b, 0).skills.knowledge).toEqual([]);
    let l = addLanguage(blankBuild(), true);
    l = patchLanguage(l, 0, { name: 'Sperethiel-ish' });
    expect(l.skills.languages).toEqual([{ name: 'Sperethiel-ish', native: true, points: 0, skillPoints: 0, spec: null }]);
    expect(patchLanguage(l, 3, { name: 'x' })).toBe(l);
    expect(removeLanguage(l, 0).skills.languages).toEqual([]);
  });
});

describe('the list with a build laid over it', () => {
  it('puts all seventy-five skills under the p. 90 headings, in order', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const sections = skillSections(b, a.ratings, a.eligibility);
    expect(sections.map((s) => s.title)).toEqual([
      'Agility',
      'Body',
      'Reaction',
      'Strength',
      'Charisma',
      'Intuition',
      'Logic',
      'Willpower',
      'Magic',
      'Resonance',
    ]);
    expect(countLines(sections)).toBe(75);
    expect(groupLines(b, a.ratings, a.eligibility)).toHaveLength(15);
  });

  it('reads a bought skill, its dice and the skill with nothing on it', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const automatics = lineOf(a, b, 'automatics');
    expect(automatics.mine).toBe(true);
    expect(automatics.entries).toHaveLength(1);
    expect(automatics.entries[0]).toMatchObject({ index: indexOf(b, 'automatics'), points: 5, own: 5, total: 5, max: 6 });
    const dice = skillDice(a.preview.derived, 'automatics');
    expect(dice?.total).toBe(a.ratings.attributes.agi.rating + 5);
    expect(dice && diceWords(dice)).toMatch(/^\d+ dice \[Physical \d+\]$/);
    expect(dice && diceLabel(dice)).toMatch(/^dice pool \d+, Physical limit \d+$/);
    expect(skillDice(a.preview.derived, 'archery')).toBeNull();
    const archery = lineOf(a, b, 'archery');
    expect(archery.mine).toBe(false);
    expect(archery.entries[0]).toMatchObject({ index: null, points: 0, own: 0 });
  });

  it('rates a bought group’s members through it', () => {
    const b = conceptBuild('face');
    const a = analyseBuild(b, SETTINGS);
    const etiquette = lineOf(a, b, 'etiquette');
    expect(etiquette.group).toEqual({ id: 'influence', name: 'Influence', rating: 6 });
    expect(etiquette.mine).toBe(true);
    const influence = groupLines(b, a.ratings, a.eligibility).find((g) => g.row.id === 'influence');
    expect(influence).toMatchObject({ own: 6, grant: 0, mine: true });
    expect(influence?.memberNames).toEqual(['Etiquette', 'Leadership', 'Negotiation']);
  });

  it('shows a Magic column grant as the floor of the skill’s own rating', () => {
    const b = conceptBuild('street-mage');
    const a = analyseBuild(b, SETTINGS);
    const spellcasting = lineOf(a, b, 'spellcasting');
    expect(spellcasting.entries[0]).toMatchObject({ grant: 5, points: 1, own: 6, total: 6 });
  });

  it('closes what the engine closes: Magic skills for a mundane, magical groups for an adept', () => {
    const muscle = conceptBuild('muscle');
    const ma = analyseBuild(muscle, SETTINGS);
    expect(lineOf(ma, muscle, 'spellcasting').eligibility).toMatchObject({ allowed: false, code: 'skill-restricted-magic' });
    expect(lineOf(ma, muscle, 'compiling').eligibility).toMatchObject({ allowed: false, code: 'skill-restricted-resonance' });
    expect(lineOf(ma, muscle, 'arcana').eligibility.allowed).toBe(true);
    const adept = conceptBuild('adept');
    const aa = analyseBuild(adept, SETTINGS);
    const sorcery = groupLines(adept, aa.ratings, aa.eligibility).find((g) => g.row.id === 'sorcery');
    expect(sorcery?.eligibility).toMatchObject({ allowed: false, code: 'skill-adept-fence' });
  });

  it('says which members already hold ranks, in a list a person would write', () => {
    expect(listWords(['Sneaking'])).toBe('Sneaking');
    expect(listWords(['A', 'B', 'C'])).toBe('A, B and C');
    expect(holdersLine(['Sneaking'])).toBe('Sneaking already has ranks of its own; a group cannot be bought over them.');
    expect(holdersLine(['Automatics', 'Pistols'])).toBe(
      'Automatics and Pistols already have ranks of their own; a group cannot be bought over them.',
    );
  });

  it('names the members that would have to give points back to a group', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const sections = skillSections(b, a.ratings, a.eligibility);
    const firearms = groupLines(b, a.ratings, a.eligibility).find((g) => g.row.id === 'firearms')!;
    expect(membersWithOwnPoints(firearms.row, sections)).toEqual(['Automatics', 'Pistols']);
  });
});

describe('search and show only mine', () => {
  const b = conceptBuild('muscle');
  const a = analyseBuild(b, SETTINGS);
  const sections = skillSections(b, a.ratings, a.eligibility);
  const groups = groupLines(b, a.ratings, a.eligibility);

  it('matches every word, ignoring case', () => {
    expect(matchesQuery(['Pilot Ground Craft'], 'ground PILOT')).toBe(true);
    expect(matchesQuery(['Pilot Ground Craft'], 'air')).toBe(false);
    expect(matchesQuery(['anything'], '   ')).toBe(true);
  });

  it('finds a skill by name or by its group, and a group by a member', () => {
    const pist = filterSections(sections, { query: 'pist', onlyMine: false });
    expect(pist.flatMap((s) => s.lines.map((l) => l.row.id))).toEqual(['pistols']);
    const firearms = filterSections(sections, { query: 'firearms', onlyMine: false });
    expect(firearms.flatMap((s) => s.lines.map((l) => l.row.id))).toEqual(['automatics', 'longarms', 'pistols']);
    expect(filterGroups(groups, { query: 'pist', onlyMine: false }).map((g) => g.row.id)).toEqual(['firearms']);
  });

  it('keeps only the runner’s own skills, dropping empty headings', () => {
    const mine = filterSections(sections, { query: '', onlyMine: true });
    expect(mine.flatMap((s) => s.lines.map((l) => l.row.id)).sort()).toEqual(
      ['automatics', 'blades', 'intimidation', 'perception', 'pistols', 'unarmed-combat'].sort(),
    );
    expect(mine.map((s) => s.attr)).toEqual(['agi', 'cha', 'int']);
    expect(filterGroups(groups, { query: '', onlyMine: true })).toEqual([]);
  });

  it('says how much of the list is showing', () => {
    expect(filterCountLine({ skills: 75, groups: 15 }, { skills: 75, groups: 15 })).toBe('All 75 skills and 15 groups');
    expect(filterCountLine({ skills: 6, groups: 0 }, { skills: 75, groups: 15 })).toBe('Showing 6 of 75 skills and 0 of 15 groups');
  });
});

describe('refusals are the engine’s sentence, on the caps that belong to a control', () => {
  it('refuses a seventh rank with the validator’s words and page', () => {
    const b = setActivePoints(conceptBuild('muscle'), { id: 'automatics', index: null }, 6);
    const a = analyseBuild(b, SETTINGS);
    const at = { id: 'automatics', index: indexOf(b, 'automatics') };
    const refusal = capRefusal(a.probe((x) => setActivePoints(x, at, 7)), SKILL_RAISE_CODES, a.issues);
    expect(refusal?.reason).toBe('Automatics 7 is over the creation maximum of 6.');
    expect(refusal?.ref).toEqual({ book: 'SR5', page: 88 });
  });

  it('does not refuse spending past the pool — the pool line says that once', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const probe = a.probe((x) => setActivePoints(x, { id: 'perception', index: indexOf(b, 'perception') }, 4));
    expect(probe.introduced.map((i) => i.code)).toContain('skill-points-over');
    expect(capRefusal(probe, SKILL_RAISE_CODES, a.issues)).toBeNull();
  });

  it('lets the Aptitude skill reach 7 and refuses 8', () => {
    const b = withQualities(setActivePoints(conceptBuild('muscle'), { id: 'automatics', index: null }, 7), quality('Aptitude', { target: 'automatics' }));
    const a = analyseBuild(b, SETTINGS);
    const line = lineOf(a, b, 'automatics');
    expect(line.entries[0]?.max).toBe(7);
    const at = { id: 'automatics', index: indexOf(b, 'automatics') };
    expect(capRefusal(a.probe((x) => setActivePoints(x, at, 7)), SKILL_RAISE_CODES, a.issues)).toBeNull();
    expect(capRefusal(a.probe((x) => setActivePoints(x, at, 8)), SKILL_RAISE_CODES, a.issues)?.reason).toBe(
      'Automatics 8 is over the creation maximum of 7.',
    );
  });

  it('counts an error made worse, not only a new one', () => {
    // Already at 7 without Aptitude (a stale record): 8 changes the sentence, not the code or path.
    const b = setActivePoints(conceptBuild('muscle'), { id: 'automatics', index: null }, 7);
    const a = analyseBuild(b, SETTINGS);
    const at = { id: 'automatics', index: indexOf(b, 'automatics') };
    const probe = a.probe((x) => setActivePoints(x, at, 8));
    expect(probe.introduced).toEqual([]);
    expect(capRefusal(probe, SKILL_RAISE_CODES, a.issues)?.reason).toBe('Automatics 8 is over the creation maximum of 6.');
  });

  it('refuses a seventh group rank', () => {
    const b = setGroupPoints(conceptBuild('face'), 'influence', 6);
    const a = analyseBuild(b, SETTINGS);
    expect(capRefusal(a.probe((x) => setGroupPoints(x, 'influence', 7)), GROUP_RAISE_CODES, a.issues)?.reason).toBe(
      'Influence 7 is over the creation maximum of 6.',
    );
  });

  it('says why a closed skill or group is closed, in the validator’s words', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const line = lineOf(a, b, 'spellcasting');
    const fence = fenceRefusal(line.eligibility, 'Spellcasting', b);
    expect(fence).toEqual({ reason: 'Spellcasting needs a Magic rating and a magic-using type.', ref: { book: 'SR5', page: 89 }, hint: 'closed' });
    // The same sentence the validator files when the rank is actually taken.
    const taken = a.probe((x) => setActivePoints(x, { id: 'spellcasting', index: null }, 1));
    expect(taken.introduced.find((i) => i.code === 'skill-restricted-magic')?.message).toBe(fence?.reason);
    const open = lineOf(a, b, 'archery');
    expect(fenceRefusal(open.eligibility, 'Archery', b)).toBeNull();
    const adept = conceptBuild('adept');
    const aa = analyseBuild(adept, SETTINGS);
    const sorcery = groupLines(adept, aa.ratings, aa.eligibility).find((g) => g.row.id === 'sorcery')!;
    expect(fenceRefusal(sorcery.eligibility, 'Sorcery', adept)?.reason).toBe('Adepts cannot take Sorcery.');
  });

  it('asks the engine for a cap only one rank from the maximum', () => {
    expect(mayPassMax(5, 6)).toBe(false);
    expect(mayPassMax(6, 6)).toBe(true);
    expect(mayPassMax(6, 7)).toBe(false);
  });

  it('refuses taking the last rank out from under a specialisation', () => {
    const base = setActivePoints(conceptBuild('muscle'), { id: 'automatics', index: null }, 1);
    const b = setActiveSpec(base, { id: 'automatics', index: indexOf(base, 'automatics') }, 'Assault rifles');
    const a = analyseBuild(b, SETTINGS);
    const at = { id: 'automatics', index: indexOf(b, 'automatics') };
    expect(capRefusal(a.probe((x) => setActivePoints(x, at, 0)), SPEC_FLOOR_CODES, a.issues)?.reason).toBe(
      'Automatics needs a rating before it can be specialised.',
    );
  });

  it('refuses a seventh knowledge rank', () => {
    const b = patchKnowledge(conceptBuild('muscle'), 0, { points: 6 });
    const a = analyseBuild(b, SETTINGS);
    const name = b.skills.knowledge[0]!.name;
    expect(capRefusal(a.probe((x) => patchKnowledge(x, 0, { skillPoints: 1 })), KNOWLEDGE_RAISE_CODES, a.issues)?.reason).toBe(
      `${name} 7 is over the creation maximum of 6.`,
    );
  });

  it('refuses a second native language without Bilingual, and allows it with', () => {
    const two = patchLanguage(addLanguage(addLanguage(conceptBuild('muscle'), true), false), 0, { name: 'Tongue A' });
    const named = patchLanguage(two, 1, { name: 'Tongue B' });
    const a = analyseBuild(named, SETTINGS);
    expect(capRefusal(a.probe((x) => patchLanguage(x, 1, { native: true })), NATIVE_CODES, a.issues)?.reason).toBe(
      '2 native languages; one is free.',
    );
    const bilingual = withQualities(named, quality('Bilingual', { karma: 5 }));
    const ab = analyseBuild(bilingual, SETTINGS);
    expect(capRefusal(ab.probe((x) => patchLanguage(x, 1, { native: true })), NATIVE_CODES, ab.issues)).toBeNull();
  });
});

describe('prices are read from budgets before and after', () => {
  it('a specialisation costs one skill point', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const costs = activeSpecPrice(b, SETTINGS, a.budgets, { id: 'automatics', index: indexOf(b, 'automatics') });
    expect(costs).toEqual({ skills: 1, groups: 0, knowledge: 0 });
    expect(mainCost(costs)).toEqual({ pool: 'skills', amount: 1 });
    expect(mainCost({ skills: 0, groups: 0, knowledge: 0 })).toBeNull();
  });

  it('reads a group point and a knowledge point off the pool they come from', () => {
    const b = conceptBuild('face');
    const a = analyseBuild(b, SETTINGS);
    expect(poolCosts(a.budgets, analyseBuild(setGroupPoints(b, 'acting', 5), SETTINGS).budgets)).toEqual({ skills: 0, groups: 1, knowledge: 0 });
    expect(poolCosts(a.budgets, analyseBuild(patchKnowledge(b, 0, { points: 5 }), SETTINGS).budgets)).toEqual({
      skills: 0,
      groups: 0,
      knowledge: 1,
    });
  });

  it('states the trade of skill points for knowledge ranks with the engine’s price', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const prices = tradePrices(b, SETTINGS, a.budgets);
    expect(prices).toEqual({ academic: 1, interests: 1, professional: 1, street: 1, language: 1 });
    expect(tradeLine(prices, a.budgets.pools.skills)).toBe(
      'Short of knowledge points? Any rank below can be paid from the active skill points instead, at 1 skill point a rank; 0 skill points are left there.',
    );
    expect(tradeLine({ ...prices, academic: 2 }, { available: 22, spent: 25, remaining: -3 })).toBe(
      'Short of knowledge points? Any rank below can be paid from the active skill points instead, at 1 skill point a rank (2 points for academic knowledge); those are already 3 points over.',
    );
  });
});

describe('knowledge, languages and the numbers from step 2', () => {
  it('quotes the free pool with the ratings that make it', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    const quote = knowledgeQuote(a.ratings, a.budgets.pools.knowledge);
    const { int, log } = { int: a.ratings.attributes.int.rating, log: a.ratings.attributes.log.rating };
    expect(quote).toMatchObject({ int, log, per: 2, free: (int + log) * 2, diverted: 0 });
    expect(quote.free).toBe(a.budgets.pools.knowledge.available);
    expect(quote.text).toBe(`(INT ${int} + LOG ${log}) × 2 = ${quote.free} free knowledge points`);
    const traded = analyseBuild(patchKnowledge(b, 0, { skillPoints: 2 }), SETTINGS);
    expect(knowledgeQuote(traded.ratings, traded.budgets.pools.knowledge).text).toMatch(/, plus 2 ranks paid with skill points$/);
  });

  it('words a rating and the native pick', () => {
    expect(knowledgeRatingWords(3, 0, 0, 3)).toBe('rating 3 — 3 knowledge points');
    expect(knowledgeRatingWords(3, 1, 1, 5)).toBe('rating 5 — 3 knowledge points, 1 from skill points, +1 Karma');
    expect(nativeLine(1, 0)).toBe('Choose a native language: one is free.');
    expect(nativeLine(2, 1)).toBe('1 of 2 free native languages chosen');
  });

  it('names the priority row’s points, or that there is none', () => {
    const b = conceptBuild('muscle');
    const a = analyseBuild(b, SETTINGS);
    expect(priorityLineFor(b.priorities.skills, a.budgets.pools.skills, a.budgets.pools.groups)).toBe(
      'Priority D gives 22 skill points and 0 group points.',
    );
    expect(priorityLineFor(null, a.budgets.pools.skills, a.budgets.pools.groups)).toMatch(/^No priority is set for skills/);
  });
});

describe('issues sit on the rows their paths name', () => {
  it('sorts pool totals, rows, the language list and the rest', () => {
    let b = conceptBuild('muscle');
    b = setActivePoints(b, { id: 'automatics', index: indexOf(b, 'automatics') }, 7); // rating over + skill points over
    b = setActiveTarget(b, { id: 'exotic-melee', index: null }, ''); // an empty specific entry
    b = setActivePoints(b, { id: 'exotic-melee', index: b.skills.active.length - 1 }, 1); // no target: a warning on its row
    const a = analyseBuild(b, SETTINGS);
    const placed = placeIssues(a.issues.filter((i) => i.step === 6));
    expect(placed.pools.skills.map((i) => i.code)).toEqual(['skill-points-over']);
    expect(placed.active.get(indexOf(b, 'automatics'))?.map((i) => i.code)).toEqual(['skill-rating-over']);
    expect(placed.active.get(indexOf(b, 'exotic-melee'))?.map((i) => i.code)).toEqual(['specific-skill-target']);
    expect(placed.languageList.map((i) => i.code)).toEqual(['native-language-missing']);
    expect(placed.rest).toEqual([]);
  });

  it('keeps an issue with no row of its own', () => {
    const odd = { code: 'skill-duplicate', severity: 'error', step: 6, message: 'x', ref: { book: 'SR5', page: 88 } } as const;
    expect(placeIssues([odd]).rest).toEqual([odd]);
    expect(placeIssues([{ ...odd, path: 'karma.spends' }]).rest).toHaveLength(1);
    expect(placeIssues([{ ...odd, path: 'skills.knowledge.2.name' }]).knowledge.get(2)).toHaveLength(1);
    expect(placeIssues([{ ...odd, path: 'skills.groups.1.points' }]).groups.get(1)).toHaveLength(1);
  });

  it('moves an entry the list has no line for — an unknown skill or group — into the rest', () => {
    const base = conceptBuild('muscle');
    const b: CharacterBuild = {
      ...base,
      skills: { ...base.skills, active: [...base.skills.active, { id: 'basket-weaving', points: 1, spec: null }], groups: [{ id: 'juggling', points: 1 }] },
    };
    const a = analyseBuild(b, SETTINGS);
    const sections = skillSections(b, a.ratings, a.eligibility);
    const groups = groupLines(b, a.ratings, a.eligibility);
    const placed = withUnshownInRest(placeIssues(a.issues.filter((i) => i.step === 6)), sections, groups);
    expect(placed.rest.map((i) => i.code).sort()).toEqual(['group-unknown', 'skill-unknown']);
    expect([...placed.active.keys()]).not.toContain(b.skills.active.length - 1);
  });
});
