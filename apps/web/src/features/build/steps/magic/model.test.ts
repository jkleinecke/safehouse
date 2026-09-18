/**
 * Step 4's plain functions (`./model.ts`) against the real engine, over
 * invented runners made the app's way (`emptyBuild`, a concept card, the
 * engine's updaters). No book names, no book text (§14).
 *
 * Pinned: where the screen starts (no priority, a mundane with nothing to do,
 * the full screen); that a kind the Magic row does not offer is refused with
 * the validator's own sentence and page, and the others carry their grants in
 * numbers; that a grant is settled only when filled or explicitly waived, and
 * a waiver can be taken back without leaving an empty list on the record;
 * that a skill grant offers only what the engine's fences leave open, with
 * the closed ones named and paged; that an aspect re-points the group grant;
 * that a spell learned as a preparation counts as one; that the mystic
 * adept's shortcut is one Karma spend in place, refused past Magic in the
 * engine's words; that a kind change keeps the picks it cannot use and the
 * grant still shows them; and that the validator's findings land in the
 * section that fixes them.
 */
import { describe, expect, it } from 'vitest';
import { BuildQualitySchema, type CharacterBuild, type Issue } from '@safehouse/contracts';
import {
  KARMA_COSTS,
  budgets,
  eligibilityMessage,
  formulaGroup,
  magicPriorityOption,
  powerPointsBought,
  setMagicKind,
  setPowerPointsBought,
  setPriority,
  validate,
} from '@safehouse/rules';
import { analysisOf, blankBuild, conceptBuild, SETTINGS } from '../../testing.js';
import {
  addFormula,
  addGrantSkill,
  chooseAspect,
  chooseKind,
  drainPair,
  formulaPickRefusal,
  grantCountWords,
  grantSkillCandidates,
  grantStates,
  grantsLine,
  issuesBySection,
  kindChoices,
  learnAs,
  magicLeftovers,
  magicStage,
  refusalOf,
  removeGrantSkill,
  rerateGrants,
  sectionOf,
  setMentor,
  setWaived,
  splitByIndex,
  takenIds,
  typedPowerPoints,
} from './model.js';

const step4 = (b: CharacterBuild): Issue[] => validate(b, SETTINGS).filter((i) => i.step === 4);
const codes = (b: CharacterBuild): string[] => step4(b).map((i) => i.code);
const optionOf = (b: CharacterBuild) => magicPriorityOption(SETTINGS.table, b.priorities.magic!, b.magic.kind);

/** The adept card moved to Magic priority D (the resources column takes B). */
function adeptAtD(): CharacterBuild {
  return setPriority(conceptBuild('adept'), 'magic', 'D');
}

function mysticAdept(): CharacterBuild {
  return setMagicKind(conceptBuild('street-mage'), 'mysticAdept');
}

describe('where the screen starts', () => {
  it('a build with no Magic priority is sent to step 2; a mundane on row E has nothing to do; otherwise the full screen', () => {
    expect(magicStage(blankBuild(), SETTINGS.table)).toBe('no-priority');
    expect(magicStage(conceptBuild('muscle'), SETTINGS.table)).toBe('mundane');
    expect(magicStage(conceptBuild('street-mage'), SETTINGS.table)).toBe('choose');
    // A mundane on a row that offers kinds still gets the picker (the priority is spent on nothing).
    expect(magicStage(setMagicKind(conceptBuild('street-mage'), 'mundane'), SETTINGS.table)).toBe('choose');
  });

  it('a mundane on row E with picks, powers or bought points left, or an error still filed, is not a step with nothing to do', () => {
    const leftGrants = setPriority(setMagicKind(conceptBuild('street-mage'), 'mundane'), 'magic', 'E');
    expect(magicStage(leftGrants, SETTINGS.table, step4(leftGrants))).toBe('mundane-leftovers');
    expect(magicLeftovers(leftGrants)).toBe(true);
    const bought = setPowerPointsBought(conceptBuild('muscle'), 1);
    expect(magicStage(bought, SETTINGS.table, step4(bought))).toBe('mundane-leftovers');
    const muscle = conceptBuild('muscle');
    expect(magicLeftovers(muscle)).toBe(false);
    const stray: Issue = { code: 'grant-skills-over', severity: 'error', step: 4, message: 'x', ref: { book: 'SR5', page: 65 } };
    expect(magicStage(muscle, SETTINGS.table, [stray])).toBe('mundane-leftovers');
    // A warning is not something to fix.
    expect(magicStage(muscle, SETTINGS.table, [{ ...stray, severity: 'warning' }])).toBe('mundane');
  });
});

describe('the kind picker', () => {
  it('refuses the kinds row D does not offer, in the validator’s words, and leaves adept and aspected open', () => {
    const b = adeptAtD();
    const choices = kindChoices(b, SETTINGS.table, analysisOf(b).probe);
    const by = Object.fromEntries(choices.map((c) => [c.value, c]));
    expect(by.magician!.refusal?.reason).toBe('Magician is not offered at Magic priority D.');
    expect(by.magician!.refusal?.ref).toEqual({ book: 'SR5', page: 65 });
    expect(by.mysticAdept!.refusal).not.toBeNull();
    expect(by.technomancer!.refusal).not.toBeNull();
    expect(by.adept!.refusal).toBeNull();
    expect(by.aspected!.refusal).toBeNull();
    expect(by.mundane!.refusal).toBeNull();
    expect(by.adept!.aside).toBe('Magic 2');
    expect(choices.map((c) => c.value)).toEqual(['magician', 'mysticAdept', 'technomancer', 'adept', 'aspected', 'mundane']);
  });

  it('says what each offered kind gets in numbers', () => {
    const b = conceptBuild('street-mage');
    const by = Object.fromEntries(kindChoices(b, SETTINGS.table, analysisOf(b).probe).map((c) => [c.value, c]));
    expect(by.magician!.aside).toBe('Magic 6');
    expect(by.magician!.detail).toContain('2 magical skills at rating 5, 10 spells, rituals or preparations');
    expect(by.technomancer!.aside).toBe('Resonance 6');
    expect(by.technomancer!.detail).toContain('3 skills from the Tasking, Electronics or Cracking groups at rating 5, 7 complex forms');
    expect(by.mysticAdept!.detail).toContain('power points bought with Karma');
    expect(grantsLine(magicPriorityOption('sr5', 'B', 'adept')!)).toBe('1 active skill at rating 4, power points equal to Magic');
  });

  it('a kind change keeps the picks it cannot use, and the grant still shows them', () => {
    const b = addFormula(conceptBuild('street-mage'), { name: 'Invented Bolt', category: 'combat spells' });
    const adept = chooseKind(b, 'adept');
    expect(adept.grants.spells).toHaveLength(1);
    const state = grantStates(adept, optionOf(adept)).spells;
    expect(state).toMatchObject({ want: 0, picked: 1, over: true, shown: true, settled: false });
    expect(grantCountWords(state)).toBe('1 on the record; this kind gets none here');
    expect(chooseKind(b, 'magician')).toBe(b);
  });
});

describe('grants: filled or waived', () => {
  it('a grant is settled when every pick is made, or when the rest is waived', () => {
    const b = conceptBuild('street-mage');
    const states = grantStates(b, optionOf(b));
    expect(states.skills).toMatchObject({ want: 2, picked: 2, settled: true });
    expect(states.spells).toMatchObject({ want: 10, picked: 0, open: 10, settled: false, shown: true });
    expect(states.forms.shown).toBe(false);
    expect(grantCountWords(states.spells)).toBe('0 of 10 picked, 10 to go');
    expect(codes(b)).toContain('grant-spells-unfilled');

    const waived = setWaived(b, 'spells', true);
    expect(waived.magic.waived).toEqual(['spells']);
    expect(grantStates(waived, optionOf(waived)).spells.settled).toBe(true);
    expect(grantCountWords(grantStates(waived, optionOf(waived)).spells)).toBe('0 of 10 picked, the other 10 waived');
    expect(codes(waived)).not.toContain('grant-spells-unfilled');

    const back = setWaived(waived, 'spells', false);
    expect(back.magic).not.toHaveProperty('waived');
    expect(setWaived(back, 'spells', false)).toBe(back);
  });

  it('a granted skill can be removed and taken again, and the validator agrees at each step', () => {
    const b = conceptBuild('adept');
    expect(codes(b)).not.toContain('grant-skills-unfilled');
    const removed = removeGrantSkill(b, 0);
    expect(codes(removed)).toContain('grant-skills-unfilled');
    const taken = addGrantSkill(removed, 'blades', 4);
    expect(taken.grants.skills).toEqual([{ id: 'blades', rating: 4 }]);
    expect(codes(taken)).toEqual([]);
    expect(addGrantSkill(taken, 'blades', 4)).toBe(taken);
  });

  it('a grant left at an old rating can be re-rated to the row’s', () => {
    const b = setPriority(conceptBuild('adept'), 'magic', 'C');
    expect(step4(b).find((i) => i.code === 'grant-skill-invalid')?.message).toContain('granted at 2, not 4');
    expect(codes(rerateGrants(b, 'skills', 2))).not.toContain('grant-skill-invalid');
  });

  it('a skill grant offers only what the fences leave open, naming the closed ones with their page', () => {
    const adept = conceptBuild('adept');
    const option = optionOf(adept)!;
    const { open, closed } = grantSkillCandidates(option.skills!.pool, analysisOf(adept).eligibility, adept.grants.skills);
    const openIds = open.map((r) => r.id);
    expect(openIds).toContain('blades');
    expect(openIds).not.toContain('unarmed-combat'); // already granted
    expect(openIds).not.toContain('exotic-melee'); // needs a target a grant cannot hold
    expect(openIds).not.toContain('spellcasting');
    const spellcasting = closed.find((c) => c.row.id === 'spellcasting');
    // The engine's sentence for the fence, the one the validator files and step 6 greys a skill with.
    expect(spellcasting?.refusal).toEqual({ reason: `Adepts cannot take ${spellcasting!.row.name}.`, ref: { book: 'SR5', page: 69 } });
    expect(spellcasting?.refusal.reason).toBe(eligibilityMessage('skill-adept-fence', spellcasting!.row.name, adept));
    expect(open.map((r) => r.name)).toEqual([...open.map((r) => r.name)].sort((a, c) => a.localeCompare(c)));

    const mage = conceptBuild('street-mage');
    const magical = grantSkillCandidates(optionOf(mage)!.skills!.pool, analysisOf(mage).eligibility, mage.grants.skills);
    expect(magical.open.map((r) => r.id)).toEqual(expect.arrayContaining(['arcana', 'summoning', 'assensing']));
    expect(magical.open.map((r) => r.id)).not.toContain('spellcasting');
    expect(magical.open.every((r) => r.category === 'magical')).toBe(true);
  });
});

describe('the aspected magician', () => {
  it('the group grant follows the aspect: re-pointed when held, filled when empty, left alone when waived', () => {
    const b = conceptBuild('conjurer');
    expect(b.grants.groups).toEqual([{ id: 'conjuring', rating: 4 }]);
    const option = optionOf(b);
    const sorcery = chooseAspect(b, 'sorcery', option);
    expect(sorcery.magic.aspect).toBe('sorcery');
    expect(sorcery.grants.groups).toEqual([{ id: 'sorcery', rating: 4 }]);
    expect(codes(sorcery)).not.toContain('grant-group-invalid');

    const empty = { ...b, grants: { ...b.grants, groups: [] } };
    expect(chooseAspect(empty, 'enchanting', option).grants.groups).toEqual([{ id: 'enchanting', rating: 4 }]);
    const waived = setWaived(empty, 'groups', true);
    expect(chooseAspect(waived, 'enchanting', option).grants.groups).toEqual([]);
  });
});

describe('spells, rituals and preparations', () => {
  it('a spell learned as a preparation counts as one; a ritual stays a ritual', () => {
    const spell = { name: 'Invented Bolt', category: 'combat spells' };
    expect(formulaGroup(learnAs(spell, 'preparations'))).toBe('preparations');
    expect(learnAs(spell, 'spells')).toBe(spell);
    const ritual = { name: 'Invented Ward', category: 'rituals' };
    expect(formulaGroup(learnAs(ritual, 'preparations'))).toBe('rituals');
    expect(formulaGroup(learnAs({ name: 'Bare' }, 'preparations'))).toBe('preparations');
  });

  it('asks of each row, before the tap, whether that formula may be taken: a ritual past its cap is shut while spells stay open', () => {
    let b = conceptBuild('street-mage');
    const cap = budgets(b, SETTINGS).pools.spells.available;
    b = { ...b, grants: { ...b.grants, spells: [] } };
    for (let i = 0; i < cap; i++) b = addFormula(b, { name: `Invented Ward ${i}`, category: 'rituals' });
    const probe = analysisOf(b).probe;
    const ritual = formulaPickRefusal(probe, { name: 'Invented Seal', category: 'rituals', catalogueId: 'r-9' }, 'spells');
    expect(ritual?.reason).toMatch(/ritual/i);
    expect(ritual?.ref?.book).toBe('SR5');
    expect(formulaPickRefusal(probe, { name: 'Invented Bolt', category: 'combat', catalogueId: 's-9' }, 'spells')).toBeNull();
  });

  it('each pick moves the grant’s count, and taken catalogue ids are listed as taken', () => {
    let b = conceptBuild('street-mage');
    b = addFormula(b, { name: 'Invented Bolt', category: 'combat spells', catalogueId: 'sp-1' });
    b = addFormula(b, { name: 'Invented Ward', category: 'rituals' });
    expect(grantStates(b, optionOf(b)).spells).toMatchObject({ picked: 2, open: 8 });
    expect(step4(b).find((i) => i.code === 'grant-spells-unfilled')?.message).toBe('Pick 8 more free spells.');
    expect([...takenIds(b.grants.spells)]).toEqual(['sp-1']);
  });
});

describe('the mystic adept’s power points', () => {
  it('buying here is one Karma spend at 5 each, kept in place, and zero removes it', () => {
    const b = mysticAdept();
    const withOther = { ...b, karma: { ...b.karma, spends: [{ kind: 'spell' as const, name: 'Invented Bolt' }] } };
    const bought = setPowerPointsBought(withOther, 2);
    expect(bought.karma.spends).toEqual([{ kind: 'spell', name: 'Invented Bolt' }, { kind: 'powerPoint', count: 2 }]);
    expect(powerPointsBought(bought)).toBe(2);
    expect(budgets(bought, SETTINGS).pools.powerPoints.available).toBe(2);
    expect(budgets(withOther, SETTINGS).pools.karma.remaining - budgets(bought, SETTINGS).pools.karma.remaining).toBe(2 * KARMA_COSTS.powerPoint);

    const first = { ...withOther, karma: { ...withOther.karma, spends: [{ kind: 'powerPoint' as const, count: 1 }, ...withOther.karma.spends] } };
    expect(setPowerPointsBought(first, 3).karma.spends[0]).toEqual({ kind: 'powerPoint', count: 3 });
    expect(setPowerPointsBought(bought, 0).karma.spends).toEqual([{ kind: 'spell', name: 'Invented Bolt' }]);
    expect(setPowerPointsBought(withOther, 0)).toBe(withOther);
  });

  it('one past Magic is refused with the engine’s sentence; a Karma overspend can be let through', () => {
    const b = setPowerPointsBought(mysticAdept(), 6);
    const probe = analysisOf(b).probe;
    const past = refusalOf(probe((x) => setPowerPointsBought(x, 7)));
    expect(past?.reason).toBe('7 power points bought; Magic 6 allows 6.');
    expect(past?.ref).toEqual({ book: 'SR5', page: 69 });
    expect(refusalOf(probe((x) => setPowerPointsBought(x, 7)), { only: new Set(['karma-overspent']) })).toBeNull();
    expect(refusalOf(probe((x) => x))).toBeNull();
  });
});

describe('a power point cost typed by hand', () => {
  it('reads a positive number, and nothing else', () => {
    expect(typedPowerPoints('0.5')).toBe(0.5);
    expect(typedPowerPoints(' 1.25 ')).toBe(1.25);
    expect(typedPowerPoints('2')).toBe(2);
    for (const text of ['', '  ', 'abc', '0', '-1', '1.5.2', '1,25']) expect(typedPowerPoints(text)).toBeNull();
  });
});

describe('tradition and mentor spirit', () => {
  it('the Drain pair is said in numbers with the tradition’s page', () => {
    const values: Record<string, number> = { log: 5, wil: 4, cha: 2 };
    expect(drainPair('hermetic', (c) => values[c] ?? 0)).toMatchObject({ words: 'Logic 5 + Willpower 4 = 9', ref: { book: 'SR5', page: 279 } });
    expect(drainPair('shamanic', (c) => values[c] ?? 0).words).toBe('Charisma 2 + Willpower 4 = 6');
  });

  it('a mentor spirit is kept as typed, and an empty name removes it', () => {
    const b = conceptBuild('shaman');
    const named = setMentor(b, 'The Old Heron ');
    expect(named.magic.mentor).toBe('The Old Heron ');
    expect(setMentor(named, '   ').magic).not.toHaveProperty('mentor');
    const withQuality = { ...b, qualities: [BuildQualitySchema.parse({ name: 'Mentor Spirit', type: 'positive', karma: 5 })] };
    expect(codes(withQuality)).toContain('mentor-spirit-unnamed');
    expect(codes(setMentor(withQuality, 'The Old Heron'))).not.toContain('mentor-spirit-unnamed');
  });
});

describe('where each finding goes', () => {
  it('reads the section off the issue’s path', () => {
    const at = (path: string, code = 'x'): string => sectionOf({ path, code });
    expect(at('magic.kind')).toBe('kind');
    expect(at('special.mag')).toBe('kind');
    expect(at('magic.aspect')).toBe('aspect');
    expect(at('magic.tradition')).toBe('tradition');
    expect(at('magic.mentor')).toBe('mentor');
    expect(at('grants.skills.1')).toBe('skills');
    expect(at('grants.groups')).toBe('groups');
    expect(at('grants.spells')).toBe('spells');
    expect(at('grants.forms')).toBe('forms');
    expect(at('powers.0.levels')).toBe('powers');
    expect(at('karma.spends', 'power-point-purchase-over-magic')).toBe('powerPoints');
    expect(at('karma.spends', 'something-else')).toBe('other');
  });

  it('groups a real build’s issues and splits a list’s findings by line', () => {
    // A fenced skill as a grant: the Skills rule, filed under the grant line it came from.
    const fenced = issuesBySection(step4(addGrantSkill(removeGrantSkill(conceptBuild('adept'), 0), 'spellcasting', 4)));
    expect(fenced.skills.map((i) => [i.code, i.path])).toEqual([['skill-adept-fence', 'grants.skills.0']]);

    const b = addGrantSkill(removeGrantSkill(conceptBuild('adept'), 0), 'blades', 3);
    const sections = issuesBySection(step4(b));
    expect(sections.skills.map((i) => i.code)).toEqual(['grant-skill-invalid']);
    const { whole, at } = splitByIndex(sections.skills, 'grants.skills');
    expect(whole).toEqual([]);
    expect(at(0).map((i) => i.path)).toEqual(['grants.skills.0']);
    expect(at(1)).toEqual([]);
  });
});
