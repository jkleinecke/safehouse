/**
 * The creation validator (`chargen/validate.ts`, FR3.9, docs/CHARGEN.md §4.2,
 * §8.4, the p. 101 checklist) — one test per rule.
 *
 * Each test is named for the rule's code and the page it enforces, changes
 * one thing on a build that is otherwise legal to the last point (the clean
 * baselines in `chargen-fixtures.ts`), and checks both sides: the change
 * raises the issue, and the legal build — or the legal neighbour of the
 * change — does not.
 *
 * Both halves are held mechanically, test by test and in any order or subset
 * (`vitest -t`): `find` and `has` record whether they saw their code raised or
 * absent, and after a test named `<code>: …` both must have happened for that
 * code. The last test reads the file's own test list — collected whether or
 * not a test ran — and wants one such test for every code in `ISSUE_RULES`,
 * so a rule added without its own test fails there, however many other
 * tests happen to trip it. A test with no body to run counts for nothing: the
 * list leaves todos out, and the file's source may switch no test off.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, type RunnerTask } from 'vitest';
import { IssueSchema, type CharacterBuild, type ChargenSettings, type Issue } from '@safehouse/contracts';
import { ISSUE_RULES, budgets, compileBuild, issueRule, validate } from '../src/index.js';
import {
  EXPERIENCED,
  EXPERIENCED_RF,
  augment,
  cleanAdept,
  cleanBuild,
  cleanMage,
  cleanTechnomancer,
  gear,
  goldenMysticAdept,
  goldenSamurai,
  goldenTechnomancer,
  mod,
  settings,
  vary,
} from './chargen-fixtures.js';

/** The registry entry a code belongs to: per-item approval codes carry a suffix. */
const registryKey = (code: string): string =>
  code.startsWith('approval-gear-') ? 'approval-gear' : code.startsWith('approval-quality-') ? 'approval-quality' : code;

/** What this test's `find`/`has` calls saw, by registry code: raised, and absent. */
const seen = { raised: new Set<string>(), clear: new Set<string>() };
beforeEach(() => {
  seen.raised.clear();
  seen.clear.clear();
});
afterEach(({ task }) => {
  const code = /^([a-z0-9-]+): /.exec(task.name)?.[1];
  if (!code || !(code in ISSUE_RULES) || task.result?.state === 'fail') return;
  expect(seen.raised.has(code), `${code}: no case in its test raises it`).toBe(true);
  expect(seen.clear.has(code), `${code}: no legal case in its test clears it`).toBe(true);
});

const check = (build: CharacterBuild, s: ChargenSettings = EXPERIENCED): Issue[] => validate(build, s);

/** The first issue `match` picks, recorded against `key` as raised or clear. */
function findWhere(key: string, match: (issue: Issue) => boolean, build: CharacterBuild, s?: ChargenSettings): Issue | undefined {
  const issue = check(build, s).find(match);
  (issue ? seen.raised : seen.clear).add(key);
  return issue;
}
const find = (code: string, build: CharacterBuild, s?: ChargenSettings): Issue | undefined =>
  findWhere(registryKey(code), (i) => i.code === code, build, s);
const has = (code: string, build: CharacterBuild, s?: ChargenSettings): boolean => find(code, build, s) !== undefined;
/** The approval issue on one purchase line, whatever its fingerprint. */
const gearApproval = (index: number, build: CharacterBuild, s?: ChargenSettings): Issue | undefined =>
  findWhere('approval-gear', (i) => i.code.startsWith('approval-gear-') && i.path === `purchases.${index}`, build, s);

const clean = cleanBuild();
const mage = cleanMage();
const adept = cleanAdept();
const techno = cleanTechnomancer();
const quality = (name: string, type: 'positive' | 'negative', karma: number, extra: object = {}) => ({
  name,
  type,
  karma,
  rating: null,
  mods: [],
  ...extra,
});
const swapSkill = (b: CharacterBuild, from: string, to: string, extra: object = {}): void => {
  b.skills.active = b.skills.active.map((s) => (s.id === from ? { ...s, id: to, ...extra } : s));
};

describe('validate: the baselines', () => {
  it('finds nothing at all on the clean builds', () => {
    expect(check(clean)).toEqual([]);
    expect(check(mage)).toEqual([]);
    expect(check(adept)).toEqual([]);
    expect(check(techno)).toEqual([]);
  });

  it('finds on the worked characters only what the book map says it should (§8.7)', () => {
    // A gear approval's fingerprint is left off here; the approval-gear tests pin what it covers.
    const codes = (issues: readonly Issue[]) => issues.map((i) => i.code.replace(/^(approval-gear-.+)-[0-9a-z]{6}(?:-\d+)?$/, '$1'));
    // The technomancer's list-price gear leaves 75,245¥, past the 5,000¥ carry-over (§8.7).
    expect(codes(check(goldenTechnomancer(), EXPERIENCED_RF))).toEqual(['nuyen-carry-lost', 'approval-gear-fake-sin']);
    expect(codes(check(goldenSamurai()))).toEqual([
      'approval-quality-exceptional-attribute-str',
      'approval-gear-twitch-weave',
      'approval-gear-polymer-frame',
      'approval-gear-fake-sin',
    ]);
    // Assensing without Astral Perception: the example's slip, which the rules do not allow.
    expect(check(goldenMysticAdept()).map((i) => `${i.severity}:${codes([i])[0]}`)).toEqual([
      'error:assensing-needs-astral',
      'approval:approval-gear-fake-sin',
    ]);
  });

  it('orders issues by step, gives each a page, and conforms to IssueSchema', () => {
    const messy = vary(clean, (b) => {
      b.identity.alias = '';
      b.lifestyles = [];
      b.priorities.skills = 'A';
    });
    const issues = check(messy);
    expect(issues.map((i) => i.step)).toEqual([...issues.map((i) => i.step)].sort((a, b) => a - b));
    for (const issue of issues) {
      expect(IssueSchema.parse(issue)).toEqual(issue);
      expect(issueRule(issue.code)).not.toBeNull();
    }
  });
});

describe('validate: Step 1 — concept', () => {
  it('alias-missing: a runner needs an alias to finish Step 1 (SR5 p.62, §4.4)', () => {
    const issue = find('alias-missing', vary(clean, (b) => void (b.identity.alias = ' ')));
    expect(issue).toMatchObject({ severity: 'error', step: 1, path: 'identity.alias', ref: { book: 'SR5', page: 62 } });
    expect(has('alias-missing', clean)).toBe(false);
  });

  it('level-mismatch: the campaign sets the creation level, not the draft (SR5 p.64)', () => {
    expect(find('level-mismatch', vary(clean, (b) => void (b.level = 'street')))?.severity).toBe('warning');
    expect(has('level-mismatch', vary(clean, (b) => void (b.level = 'street')), settings({ level: 'street' }))).toBe(false);
  });

  it('table-mismatch: the campaign picks the priority table printing (RF p.63)', () => {
    expect(has('table-mismatch', vary(clean, (b) => void (b.table = 'rf')))).toBe(true);
    expect(has('table-mismatch', vary(clean, (b) => void (b.table = 'rf')), EXPERIENCED_RF)).toBe(false);
  });
});

describe('validate: Step 2 — priorities', () => {
  const sumToTen = settings({ allowSumToTen: true });

  it('method-not-allowed: Sum to Ten only where the campaign allows it (RF p.62)', () => {
    const b = vary(clean, (x) => void (x.method = 'sumToTen'));
    expect(has('method-not-allowed', b)).toBe(true);
    expect(has('method-not-allowed', b, sumToTen)).toBe(false);
  });

  it('priority-unset: every column needs a row (SR5 p.65)', () => {
    expect(find('priority-unset', vary(clean, (b) => void (b.priorities.skills = null)))?.path).toBe('priorities.skills');
    expect(has('priority-unset', clean)).toBe(false);
  });

  it('priority-duplicate: under Priority each row is used exactly once (SR5 p.65)', () => {
    expect(has('priority-duplicate', vary(clean, (b) => void (b.priorities.skills = 'A')))).toBe(true);
    expect(has('priority-duplicate', vary(clean, (b) => void (b.priorities.skills = 'A')), sumToTen)).toBe(true);
    const repeated = vary(clean, (b) => {
      b.method = 'sumToTen';
      b.priorities = { metatype: 'A', attributes: 'B', magic: 'E', skills: 'B', resources: 'E' };
    });
    expect(has('priority-duplicate', repeated, sumToTen)).toBe(false);
  });

  it('sum-to-ten-over: Sum to Ten rows cost A4 B3 C2 D1 E0 out of 10 (RF p.62)', () => {
    const over = vary(clean, (b) => {
      b.method = 'sumToTen';
      b.priorities = { metatype: 'A', attributes: 'A', magic: 'E', skills: 'B', resources: 'E' };
    });
    expect(has('sum-to-ten-over', over, sumToTen)).toBe(true);
    const ten = vary(over, (b) => void (b.priorities.attributes = 'B'));
    expect(has('sum-to-ten-over', ten, sumToTen)).toBe(false);
  });

  it('sum-to-ten-under: unspent Sum to Ten points are a warning (RF p.62)', () => {
    const under = vary(clean, (b) => {
      b.method = 'sumToTen';
      b.priorities = { metatype: 'B', attributes: 'B', magic: 'E', skills: 'C', resources: 'E' };
    });
    expect(find('sum-to-ten-under', under, sumToTen)?.severity).toBe('warning');
    expect(has('sum-to-ten-under', vary(under, (b) => void (b.priorities.skills = 'A')), sumToTen)).toBe(false);
  });
});

describe('validate: Step 3 — metatype and attributes', () => {
  it('metatype-missing: a metatype must be chosen (SR5 p.65)', () => {
    expect(has('metatype-missing', vary(clean, (b) => void (b.metatype = null)))).toBe(true);
    expect(has('metatype-missing', clean)).toBe(false);
  });

  it('metatype-unknown: the metatype must be one the tables know (SR5 p.66)', () => {
    expect(has('metatype-unknown', vary(clean, (b) => void (b.metatype = 'gargoyle')))).toBe(true);
    expect(has('metatype-unknown', vary(clean, (b) => void (b.metatype = 'Human')))).toBe(false);
  });

  it('metatype-not-allowed: metavariants need the campaign to allow them (RF p.102)', () => {
    const variant = vary(clean, (b) => void (b.metatype = 'nartaki'));
    expect(has('metatype-not-allowed', variant)).toBe(true);
    expect(has('metatype-not-allowed', variant, settings({ allowMetavariants: true }))).toBe(false);
  });

  it('metatype-not-on-row: a metatype is only on the rows that list it — no troll at C (SR5 p.65)', () => {
    expect(has('metatype-not-on-row', vary(clean, (b) => void (b.metatype = 'troll')))).toBe(true);
    expect(has('metatype-not-on-row', vary(clean, (b) => void (b.metatype = 'dwarf')))).toBe(false);
  });

  it('special-points-over: no more special points than the metatype row gives (SR5 p.66)', () => {
    expect(has('special-points-over', vary(clean, (b) => void (b.special.edg = 6)))).toBe(true);
    expect(has('special-points-over', clean)).toBe(false);
  });

  it('special-points-unspent: unspent special points vanish — warn while there is room to spend them (SR5 p.66)', () => {
    expect(find('special-points-unspent', vary(clean, (b) => void (b.special.edg = 4)))?.severity).toBe('warning');
    // A human on B has 7 special points, but Edge stops at 7: with Edge full there is nowhere to put the rest.
    const full = vary(clean, (b) => {
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
    });
    expect(has('special-points-unspent', full)).toBe(false);
    // A mundane shapeshifter's natural Magic takes special points too (RF p.102): Edge full, Magic 1 of 6 is room.
    const metavariants = settings({ allowMetavariants: true });
    const bovine = vary(clean, (b) => {
      b.metatype = 'shapeshifter-bovine';
      b.priorities = { metatype: 'A', attributes: 'C', magic: 'E', skills: 'B', resources: 'D' };
      b.attributes = { bod: 2, agi: 2, rea: 2, str: 2, wil: 2, log: 2, int: 2, cha: 2 };
      b.special = { edg: 4, mag: 0, res: 0 };
    });
    expect(find('special-points-unspent', bovine, metavariants)?.severity).toBe('warning');
    expect(has('special-points-unspent', vary(bovine, (b) => void (b.special.mag = 4)), metavariants)).toBe(false);
  });

  it('special-points-no-magic: special points buy Magic only for a magic user (SR5 p.66)', () => {
    expect(has('special-points-no-magic', vary(clean, (b) => void (b.special = { edg: 4, mag: 1, res: 0 })))).toBe(true);
    expect(has('special-points-no-magic', vary(mage, (b) => void (b.special = { edg: 0, mag: 1, res: 0 })))).toBe(false);
    // A metasapient's natural Magic 1 takes special points at Magic priority E (RF p.102).
    const sasquatch = vary(clean, (b) => {
      b.metatype = 'sasquatch';
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
      b.special = { edg: 0, mag: 1, res: 0 };
    });
    const metavariants = settings({ allowMetavariants: true });
    expect(has('special-points-no-magic', sasquatch, metavariants)).toBe(false);
    expect(has('special-points-no-magic', vary(sasquatch, (b) => void (b.metatype = 'troll')), metavariants)).toBe(true);
  });

  it('special-points-no-resonance: special points buy Resonance only for a technomancer (SR5 p.66)', () => {
    expect(has('special-points-no-resonance', vary(clean, (b) => void (b.special = { edg: 4, mag: 0, res: 1 })))).toBe(true);
    expect(has('special-points-no-resonance', vary(techno, (b) => void (b.special = { edg: 0, mag: 0, res: 1 })))).toBe(false);
  });

  it('attribute-points-over: no more attribute points than the row gives (SR5 p.66)', () => {
    expect(has('attribute-points-over', vary(clean, (b) => void (b.attributes.str = 4)))).toBe(true);
    expect(has('attribute-points-over', clean)).toBe(false);
  });

  it('attribute-points-unspent: all attribute points must be spent (SR5 p.66)', () => {
    expect(has('attribute-points-unspent', vary(clean, (b) => void (b.attributes.str = 2)))).toBe(true);
    expect(has('attribute-points-unspent', clean)).toBe(false);
  });

  it('attribute-over-max: no attribute past its natural maximum, one higher with Exceptional Attribute (SR5 p.66)', () => {
    // Two over: no quality lifts that far, so it is Step 3's.
    const eight = vary(clean, (b) => {
      b.attributes.bod = 7;
      b.attributes.agi = 2;
    });
    expect(find('attribute-over-max', eight)).toMatchObject({ step: 3, path: 'attributes.bod' });
    const seven = vary(clean, (b) => {
      b.attributes.bod = 6;
      b.attributes.agi = 3;
    });
    const exceptional = vary(seven, (b) => void b.qualities.push(quality('Exceptional Attribute', 'positive', 14, { target: 'Body' })));
    expect(has('attribute-over-max', exceptional)).toBe(false);
    const edge = vary(clean, (b) => void b.karma.spends.push({ kind: 'attribute', id: 'edg', from: 7, to: 8 }));
    expect(find('attribute-over-max', edge)?.step).toBe(8);
    const lucky = vary(edge, (b) => void b.qualities.push(quality('Lucky', 'positive', 12)));
    expect(has('attribute-over-max', lucky)).toBe(false);
  });

  it("attribute-over-max: one over, which a quality not yet taken would allow, is Step 5's to settle so Step 3's Next stays open (SR5 p.66, p.72, p.76)", () => {
    const seven = vary(clean, (b) => {
      b.attributes.bod = 6;
      b.attributes.agi = 3;
    });
    expect(find('attribute-over-max', seven)).toMatchObject({ step: 5, path: 'qualities', ref: { book: 'SR5', page: 72 } });
    expect(has('attribute-over-max', vary(seven, (b) => void b.qualities.push(quality('Exceptional Attribute', 'positive', 14, { target: 'bod' }))))).toBe(false);
    // Edge one over waits on Lucky.
    const edge = vary(clean, (b) => void (b.special.edg = 6));
    expect(find('attribute-over-max', edge)).toMatchObject({ step: 5, path: 'qualities', ref: { page: 76 } });
    // Exceptional Attribute already on another attribute, or Lucky held, leaves nothing to lift it: Step 3.
    const elsewhere = vary(seven, (b) => void b.qualities.push(quality('Exceptional Attribute', 'positive', 14, { target: 'agi' })));
    expect(find('attribute-over-max', elsewhere)).toMatchObject({ step: 3, path: 'attributes.bod' });
    expect(find('attribute-over-max', vary(seven, (b) => void b.qualities.push(quality('Lucky', 'positive', 12))))?.step).toBe(3);
    // Two attributes one over wait on a quality that lifts only one: Step 3 for both.
    const two = vary(seven, (b) => void (b.attributes.str = 6));
    expect(check(two).filter((i) => i.code === 'attribute-over-max').map((i) => [i.path, i.step])).toEqual([
      ['attributes.bod', 3],
      ['attributes.str', 3],
    ]);
  });

  it('attribute-max-more-than-one: only one mental or physical attribute at its natural maximum (SR5 p.66, p.101)', () => {
    const two = vary(clean, (b) => {
      b.attributes.agi = 5;
      b.attributes.rea = 3;
    });
    // Nothing lifts a maximum once Exceptional Attribute is spent elsewhere or Lucky rules it out: Step 3's.
    const withQuality = (b: CharacterBuild, q: object) => vary(b, (x) => void x.qualities.push(q as never));
    expect(find('attribute-max-more-than-one', withQuality(two, quality('Lucky', 'positive', 12)))).toMatchObject({ step: 3, path: 'attributes' });
    const elsewhere = withQuality(two, quality('Exceptional Attribute', 'positive', 14, { target: 'cha' }));
    expect(find('attribute-max-more-than-one', elsewhere)?.step).toBe(3);
    // Three at the maximum: the quality lifts one, two stay.
    const three = vary(two, (b) => {
      b.attributes.rea = 1;
      b.attributes.str = 5;
    });
    expect(find('attribute-max-more-than-one', three)?.step).toBe(3);
    const byKarma = vary(clean, (b) => void b.karma.spends.push({ kind: 'attribute', id: 'agi', from: 5, to: 6 }));
    expect(find('attribute-max-more-than-one', byKarma)?.step).toBe(8);
    // Edge at its maximum is exempt: the clean build has Edge 7 of 7 and Body 6 of 6.
    expect(has('attribute-max-more-than-one', clean)).toBe(false);
    // Each attribute against its own maximum: the samurai with a point moved from Strength to Body has
    // Body 10 of 10 and Strength 10 of Exceptional Attribute's 11 — one at its maximum, not two.
    const moved = vary(goldenSamurai(), (b) => {
      b.attributes.str = 5;
      b.attributes.bod = 5;
    });
    expect(has('attribute-max-more-than-one', moved)).toBe(false);
    expect(has('attribute-max-more-than-one', vary(moved, (b) => void (b.attributes.str = 6)))).toBe(true);
  });

  it("attribute-max-more-than-one: two at the maximum that Exceptional Attribute on one of them would settle are Step 5's, so Step 3's Next stays open (SR5 p.66, p.72)", () => {
    // The samurai with a point moved from Strength to Body, before Step 5 takes the quality: Body 10, Strength 10.
    const moved = vary(goldenSamurai(), (b) => {
      b.attributes.str = 5;
      b.attributes.bod = 5;
      b.qualities = b.qualities.filter((q) => q.name !== 'Exceptional Attribute');
    });
    expect(find('attribute-max-more-than-one', moved)).toMatchObject({ severity: 'error', step: 5, path: 'qualities', ref: { page: 72 } });
    expect(has('attribute-max-more-than-one', vary(moved, (b) => void b.qualities.push(quality('Exceptional Attribute', 'positive', 14, { target: 'bod' }))))).toBe(false);
    // Strength 11 and Body 10: the quality on Strength leaves both at their maximum, on Body leaves Strength over it.
    const over = vary(moved, (b) => {
      b.attributes.str = 6;
      b.attributes.agi = 2;
    });
    expect(find('attribute-max-more-than-one', over)).toMatchObject({ step: 3, path: 'attributes' });
  });

  it('lucky-and-exceptional: Lucky or Exceptional Attribute, never both (SR5 p.66)', () => {
    const both = vary(clean, (b) => {
      b.qualities.push(quality('Exceptional Attribute', 'positive', 14, { target: 'agi' }));
      b.qualities.push(quality('Lucky', 'positive', 12));
    });
    expect(find('lucky-and-exceptional', both)?.step).toBe(5);
    expect(has('lucky-and-exceptional', vary(clean, (b) => void b.qualities.push(quality('Lucky', 'positive', 12))))).toBe(false);
  });
});

describe('validate: Step 4 — magic or resonance', () => {
  it('magic-kind-not-offered: the Magic row decides who may be Awakened — no magician at D (SR5 p.65)', () => {
    const atD = (b: CharacterBuild) =>
      vary(b, (x) => {
        x.priorities.magic = 'D';
        x.priorities.resources = 'C';
      });
    expect(has('magic-kind-not-offered', atD(mage))).toBe(true);
    expect(has('magic-kind-not-offered', atD(adept))).toBe(false);
  });

  it('magic-priority-unused: a Magic priority spent on a mundane is a warning (SR5 p.65)', () => {
    const wasted = vary(clean, (b) => {
      b.priorities.metatype = 'E';
      b.priorities.magic = 'C';
      b.special.edg = 1;
    });
    expect(find('magic-priority-unused', wasted)?.severity).toBe('warning');
    expect(has('magic-priority-unused', clean)).toBe(false);
  });

  it('resonance-not-allowed: metasapients cannot have Resonance (RF p.102)', () => {
    const allow = settings({ allowMetavariants: true });
    expect(has('resonance-not-allowed', vary(techno, (b) => void (b.metatype = 'centaur')), allow)).toBe(true);
    expect(has('resonance-not-allowed', techno, allow)).toBe(false);
  });

  it('aspect-missing: an aspected magician picks Sorcery, Conjuring or Enchanting (SR5 p.69)', () => {
    const aspected = vary(mage, (b) => void (b.magic = { kind: 'aspected', tradition: 'hermetic' }));
    expect(has('aspect-missing', aspected)).toBe(true);
    expect(has('aspect-missing', vary(aspected, (b) => void (b.magic.aspect = 'sorcery')))).toBe(false);
  });

  it('tradition-missing: a magician without a tradition has no drain attributes (SR5 p.279)', () => {
    expect(find('tradition-missing', vary(mage, (b) => void (b.magic = { kind: 'magician' })))?.severity).toBe('warning');
    expect(has('tradition-missing', mage)).toBe(false);
    expect(has('tradition-missing', adept)).toBe(false);
  });

  it('mentor-spirit-unnamed: Mentor Spirit names its mentor (SR5 p.76)', () => {
    const unnamed = vary(mage, (b) => void b.qualities.push(quality('Mentor Spirit', 'positive', 5)));
    expect(has('mentor-spirit-unnamed', unnamed)).toBe(true);
    expect(has('mentor-spirit-unnamed', vary(unnamed, (b) => void (b.magic.mentor = 'The Owl')))).toBe(false);
  });

  it('grant-skills-unfilled: the column\'s free skills are filled or waived (SR5 p.65, §4.4)', () => {
    const none = vary(adept, (b) => void (b.grants.skills = []));
    expect(has('grant-skills-unfilled', none)).toBe(true);
    expect(has('grant-skills-unfilled', vary(none, (b) => void (b.magic.waived = ['skills'])))).toBe(false);
  });

  it('grant-skills-over: no more free skills than the row grants — C casters get none (SR5 p.65)', () => {
    expect(has('grant-skills-over', vary(mage, (b) => void (b.grants.skills = [{ id: 'spellcasting', rating: 5 }])))).toBe(true);
    expect(has('grant-skills-over', mage)).toBe(false);
  });

  it('grant-skill-invalid: a free skill comes at the row\'s rating from the row\'s pool (SR5 p.65)', () => {
    expect(has('grant-skill-invalid', vary(adept, (b) => void (b.grants.skills = [{ id: 'throwing-weapons', rating: 3 }])))).toBe(true);
    expect(has('grant-skill-invalid', vary(techno, (b) => void (b.grants.skills[0] = { id: 'pistols', rating: 2 })))).toBe(true);
    expect(has('grant-skill-invalid', vary(techno, (b) => void (b.grants.skills[0] = { id: 'hacking', rating: 2 })))).toBe(false);
  });

  const aspected = vary(mage, (b) => {
    b.magic = { kind: 'aspected', aspect: 'sorcery', tradition: 'hermetic' };
    b.grants.spells = [];
  });

  it('grant-groups-unfilled: an aspected magician at C takes one rating-2 group (SR5 p.65)', () => {
    expect(has('grant-groups-unfilled', aspected)).toBe(true);
    expect(has('grant-groups-unfilled', vary(aspected, (b) => void (b.grants.groups = [{ id: 'sorcery', rating: 2 }])))).toBe(false);
  });

  it('grant-groups-over: no more free groups than the row grants (SR5 p.65)', () => {
    const two = vary(aspected, (b) => {
      b.grants.groups = [
        { id: 'sorcery', rating: 2 },
        { id: 'enchanting', rating: 2 },
      ];
    });
    expect(has('grant-groups-over', two)).toBe(true);
    expect(has('grant-groups-over', vary(aspected, (b) => void (b.grants.groups = [{ id: 'sorcery', rating: 2 }])))).toBe(false);
  });

  it('grant-group-invalid: the aspected magician\'s free group is their aspect\'s (SR5 p.69)', () => {
    expect(has('grant-group-invalid', vary(aspected, (b) => void (b.grants.groups = [{ id: 'conjuring', rating: 2 }])))).toBe(true);
    expect(has('grant-group-invalid', vary(aspected, (b) => void (b.grants.groups = [{ id: 'sorcery', rating: 2 }])))).toBe(false);
  });

  it('grant-spells-unfilled: the row\'s free spells are picked or waived (SR5 p.65)', () => {
    const four = vary(mage, (b) => void b.grants.spells.pop());
    expect(has('grant-spells-unfilled', four)).toBe(true);
    expect(has('grant-spells-unfilled', vary(four, (b) => void (b.magic.waived = ['spells'])))).toBe(false);
  });

  it('grant-spells-over: no more free spells than the row grants (SR5 p.65)', () => {
    expect(has('grant-spells-over', vary(mage, (b) => void b.grants.spells.push({ name: 'Extra', category: 'combat' })))).toBe(true);
    expect(has('grant-spells-over', mage)).toBe(false);
  });

  it('grant-forms-unfilled: the row\'s free complex forms are picked or waived (SR5 p.65)', () => {
    const two = vary(techno, (b) => void b.grants.forms.pop());
    expect(has('grant-forms-unfilled', two)).toBe(true);
    expect(has('grant-forms-unfilled', vary(two, (b) => void (b.magic.waived = ['forms'])))).toBe(false);
  });

  it('grant-forms-over: no more free forms than the row grants (SR5 p.65)', () => {
    expect(has('grant-forms-over', vary(techno, (b) => void b.grants.forms.push({ name: 'Extra' })))).toBe(true);
    expect(has('grant-forms-over', techno)).toBe(false);
  });

  it('formulae-not-caster: adepts, technomancers and mundanes learn no spells (SR5 p.69)', () => {
    expect(has('formulae-not-caster', vary(adept, (b) => void b.karma.spends.push({ kind: 'spell', name: 'Flash' })))).toBe(true);
    expect(has('formulae-not-caster', mage)).toBe(false);
  });

  it("formulae-not-caster: an aspected magician learns only its aspect's formulae — spells and rituals with Sorcery, preparations with Enchanting (SR5 p.69)", () => {
    const aspectedWith = (aspect: 'sorcery' | 'conjuring' | 'enchanting', category: string) =>
      vary(mage, (b) => {
        b.magic = { kind: 'aspected', aspect, tradition: 'hermetic' };
        b.grants.spells = [];
        b.karma.spends = [{ kind: 'spell', name: 'Formula', category }];
      });
    expect(find('formulae-not-caster', aspectedWith('conjuring', 'combat'))).toMatchObject({ step: 8, path: 'karma.spends' });
    expect(has('formulae-not-caster', aspectedWith('conjuring', 'ritual'))).toBe(true);
    expect(has('formulae-not-caster', aspectedWith('sorcery', 'preparation'))).toBe(true);
    expect(has('formulae-not-caster', aspectedWith('enchanting', 'combat'))).toBe(true);
    expect(has('formulae-not-caster', aspectedWith('sorcery', 'combat'))).toBe(false);
    expect(has('formulae-not-caster', aspectedWith('sorcery', 'ritual'))).toBe(false);
    expect(has('formulae-not-caster', aspectedWith('enchanting', 'alchemical preparation'))).toBe(false);
  });

  it("karma-magic-no-type: Magic comes with a magic-using type, never from Karma alone — a metasapient's natural Magic aside (SR5 p.68, RF p.102)", () => {
    const raise = (from: number, to: number) => ({ kind: 'attribute' as const, id: 'mag' as const, from, to });
    const bought = vary(clean, (b) => void b.karma.spends.push(raise(0, 1)));
    expect(find('karma-magic-no-type', bought)).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends' });
    expect(has('karma-magic-no-type', vary(techno, (b) => void b.karma.spends.push(raise(0, 1))))).toBe(true);
    // The bought point opens nothing that keys on Magic: no Awakened-only quality.
    const mentor = vary(bought, (b) => {
      b.qualities.push(quality('Mentor Spirit', 'positive', 5));
      b.magic.mentor = 'The Owl';
    });
    expect(has('quality-requires-magic', mentor)).toBe(true);
    expect(has('karma-magic-no-type', vary(mage, (b) => void (b.karma.spends = [raise(3, 4)])))).toBe(false);
    const sasquatch = vary(clean, (b) => {
      b.metatype = 'sasquatch';
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
      b.karma.spends = [raise(1, 2)];
    });
    expect(has('karma-magic-no-type', sasquatch, settings({ allowMetavariants: true }))).toBe(false);
  });

  it('karma-resonance-no-type: only a technomancer raises Resonance with Karma (SR5 p.68)', () => {
    const raise = (from: number, to: number) => ({ kind: 'attribute' as const, id: 'res' as const, from, to });
    expect(find('karma-resonance-no-type', vary(clean, (b) => void b.karma.spends.push(raise(0, 1))))).toMatchObject({ step: 8 });
    expect(has('karma-resonance-no-type', vary(mage, (b) => void b.karma.spends.push(raise(0, 1))))).toBe(true);
    expect(has('karma-resonance-no-type', vary(techno, (b) => void (b.karma.spends = [raise(3, 4)])))).toBe(false);
  });

  it('formulae-over-cap: at most Magic × 2 spells, rituals or preparations per group at creation (SR5 p.98)', () => {
    const spell = { kind: 'spell' as const, name: 'More', category: 'combat' };
    expect(find('formulae-over-cap', vary(mage, (b) => void b.karma.spends.push(spell, spell)))?.step).toBe(8);
    expect(has('formulae-over-cap', vary(mage, (b) => void b.karma.spends.push(spell)))).toBe(false);
    const rituals = Array.from({ length: 6 }, (_, i) => ({ kind: 'spell' as const, name: `Rite ${i}`, category: 'ritual' }));
    expect(has('formulae-over-cap', vary(mage, (b) => void b.karma.spends.push(...rituals)))).toBe(false);
  });

  it('forms-not-technomancer: only technomancers learn complex forms (SR5 p.98)', () => {
    expect(has('forms-not-technomancer', vary(mage, (b) => void b.karma.spends.push({ kind: 'form', name: 'Loop' })))).toBe(true);
    expect(has('forms-not-technomancer', techno)).toBe(false);
  });

  it('forms-over-cap: at most Resonance × 2 complex forms at creation (SR5 p.98)', () => {
    const form = { kind: 'form' as const, name: 'More' };
    expect(has('forms-over-cap', vary(techno, (b) => void b.karma.spends.push(form, form, form, form)))).toBe(true);
    expect(has('forms-over-cap', vary(techno, (b) => void b.karma.spends.push(form, form, form)))).toBe(false);
  });

  it('powers-not-adept: adept powers are for adepts and mystic adepts (SR5 p.308)', () => {
    expect(has('powers-not-adept', vary(clean, (b) => void (b.powers = [{ name: 'Quick Step', cost: 1, levels: 1, mods: [] }])))).toBe(true);
    expect(has('powers-not-adept', adept)).toBe(false);
  });

  it('power-points-over: an adept\'s powers cost no more than Magic in power points (SR5 p.308)', () => {
    expect(has('power-points-over', vary(adept, (b) => void (b.powers[0]!.cost = 2.25)))).toBe(true);
    expect(has('power-points-over', adept)).toBe(false);
  });

  it('power-levels-over-magic: no power above Magic in levels (SR5 p.308)', () => {
    expect(has('power-levels-over-magic', vary(adept, (b) => void (b.powers[0]!.levels = 5)))).toBe(true);
    expect(has('power-levels-over-magic', vary(adept, (b) => void (b.powers[0]!.levels = 4)))).toBe(false);
  });

  it('power-point-purchase-not-mystic: only mystic adepts buy power points with Karma (SR5 p.69)', () => {
    expect(has('power-point-purchase-not-mystic', vary(adept, (b) => void b.karma.spends.push({ kind: 'powerPoint', count: 1 })))).toBe(true);
    const mystic = vary(mage, (b) => {
      b.magic.kind = 'mysticAdept';
      b.karma.spends.push({ kind: 'powerPoint', count: 1 });
    });
    expect(has('power-point-purchase-not-mystic', mystic)).toBe(false);
  });

  it('power-point-purchase-over-magic: a mystic adept buys at most Magic power points (SR5 p.69)', () => {
    const mystic = (n: number) =>
      vary(mage, (b) => {
        b.magic.kind = 'mysticAdept';
        b.karma.spends.push({ kind: 'powerPoint', count: n });
      });
    expect(has('power-point-purchase-over-magic', mystic(4))).toBe(true);
    expect(has('power-point-purchase-over-magic', mystic(3))).toBe(false);
    // Magic after Essence loss, which takes a power point with each point of Magic (p.279).
    const chromed = (n: number) => vary(mystic(n), (b) => void b.purchases.push(augment('Datajack', 1_000, 0.1) as never));
    expect(find('power-point-purchase-over-magic', chromed(3))?.message).toContain('Magic 2');
    expect(has('power-point-purchase-over-magic', chromed(2))).toBe(false);
  });
});

describe('validate: Step 5 — qualities', () => {
  const withQuality = (b: CharacterBuild, ...qs: object[]) => vary(b, (x) => void x.qualities.push(...(qs as never[])));

  it('positive-quality-cap: at most 25 Karma of positive qualities — 26 at street when the level caps apply (SR5 p.71, p.64)', () => {
    const at26 = withQuality(clean, quality('Keen Eye', 'positive', 26));
    expect(has('positive-quality-cap', at26)).toBe(true);
    expect(has('positive-quality-cap', withQuality(clean, quality('Keen Eye', 'positive', 25)))).toBe(false);
    const street = (b: CharacterBuild) => vary(b, (x) => void (x.level = 'street'));
    expect(has('positive-quality-cap', street(at26), settings({ level: 'street' }))).toBe(false);
    expect(has('positive-quality-cap', street(at26), settings({ level: 'street', levelQualityCaps: false }))).toBe(true);
  });

  it('negative-quality-cap: at most 25 Karma of negative qualities (SR5 p.71)', () => {
    expect(has('negative-quality-cap', withQuality(clean, quality('Old Debt', 'negative', 26)))).toBe(true);
    expect(has('negative-quality-cap', withQuality(clean, quality('Old Debt', 'negative', 25)))).toBe(false);
  });

  it('quality-once: a quality the book limits to once is taken once (SR5 p.80)', () => {
    const style = quality('Distinctive Style', 'negative', 5);
    expect(has('quality-once', withQuality(clean, style, style))).toBe(true);
    expect(has('quality-once', withQuality(clean, style))).toBe(false);
    // A rated quality is held once, at its rating: three lines of Dependents 1 are not Dependents 3
    // (nor 9 Karma for a 10% surcharge), and two of Will to Live 3 are not six boxes (SR5 p.77, p.80).
    const dependents = quality('Dependents', 'negative', 3, { rating: 1 });
    expect(find('quality-once', withQuality(clean, dependents, dependents, dependents))?.path).toBe('qualities.1');
    expect(has('quality-once', withQuality(clean, quality('Dependents', 'negative', 9, { rating: 3 })))).toBe(false);
    const willToLive = quality('Will to Live', 'positive', 9, { rating: 3 });
    expect(has('quality-once', withQuality(clean, willToLive, quality('Will to Live', 'positive', 3, { rating: 1 })))).toBe(true);
    expect(has('quality-once', withQuality(clean, willToLive))).toBe(false);
  });

  it('quality-exclusive: Distinctive Style and Blandness exclude each other (SR5 p.80)', () => {
    expect(has('quality-exclusive', withQuality(clean, quality('Distinctive Style', 'negative', 5), quality('Blandness', 'positive', 8)))).toBe(true);
    expect(has('quality-exclusive', withQuality(clean, quality('Blandness', 'positive', 8)))).toBe(false);
  });

  it('quality-requires-magic: Spirit Affinity and its kin need a Magic rating (SR5 p.77)', () => {
    const affinity = quality('Spirit Affinity (Air)', 'positive', 7);
    expect(has('quality-requires-magic', withQuality(clean, affinity))).toBe(true);
    expect(has('quality-requires-magic', withQuality(mage, affinity))).toBe(false);
  });

  it('quality-requires-caster: Focused Concentration is for spellcasters and technomancers (SR5 p.74)', () => {
    const focused = quality('Focused Concentration', 'positive', 4, { rating: 1 });
    expect(has('quality-requires-caster', withQuality(adept, focused))).toBe(true);
    expect(has('quality-requires-caster', withQuality(mage, focused))).toBe(false);
    expect(has('quality-requires-caster', withQuality(techno, focused))).toBe(false);
  });

  it('quality-forbidden-with-magic: Magic Resistance is never taken with a Magic rating (SR5 p.76)', () => {
    const resistance = quality('Magical Resistance', 'positive', 6, { rating: 1 });
    expect(has('quality-forbidden-with-magic', withQuality(mage, resistance))).toBe(true);
    expect(has('quality-forbidden-with-magic', withQuality(clean, resistance))).toBe(false);
  });

  it('quality-metatype-gate: Human-Looking is for elves, dwarfs and orks; Elf Poser for humans (SR5 p.75, p.81)', () => {
    expect(has('quality-metatype-gate', withQuality(clean, quality('Human-Looking', 'positive', 6)))).toBe(true);
    expect(has('quality-metatype-gate', withQuality(clean, quality('Elf Poser', 'negative', 6)))).toBe(false);
    const elf = vary(clean, (b) => void (b.metatype = 'elf'));
    expect(has('quality-metatype-gate', withQuality(elf, quality('Human-Looking', 'positive', 6)))).toBe(false);
  });

  it('quality-rating-range: Will to Live goes to 3, Dependents to 3 (SR5 p.77, p.80)', () => {
    expect(has('quality-rating-range', withQuality(clean, quality('Will to Live', 'positive', 12, { rating: 4 })))).toBe(true);
    expect(has('quality-rating-range', withQuality(clean, quality('Dependent(s)', 'negative', 12, { rating: 4 })))).toBe(true);
    expect(has('quality-rating-range', withQuality(clean, quality('Will to Live', 'positive', 9, { rating: 3 })))).toBe(false);
  });

  it("quality-karma-mismatch: a rated quality's Karma is its rating's — Will to Live 3 a rating, Dependents 3/6/9 (SR5 p.77, p.80)", () => {
    expect(find('quality-karma-mismatch', withQuality(clean, quality('Will to Live', 'positive', 3, { rating: 3 })))).toMatchObject({
      severity: 'error',
      step: 5,
      path: 'qualities.0.karma',
    });
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Will to Live', 'positive', 9, { rating: 3 })))).toBe(false);
    // With no rating the Karma says which one: 9 is Will to Live 3, 4 is none of them.
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Will to Live', 'positive', 9)))).toBe(false);
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Will to Live', 'positive', 4)))).toBe(true);
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Dependents', 'negative', 9, { rating: 1 })))).toBe(true);
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Dependents', 'negative', 6, { rating: 2 })))).toBe(false);
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Dependent(s)', 'negative', 7)))).toBe(true);
    expect(has('quality-karma-mismatch', withQuality(clean, quality('Dependent(s)', 'negative', 9)))).toBe(false);
  });

  it("quality-type-mismatch: a whitelisted quality keeps the book's type — a negative one recorded as positive is a buy-off only for a metatype born with it (SR5 p.71, RF p.102)", () => {
    const metavariants = settings({ allowMetavariants: true });
    // A human's positive Uncouth is a slip: it is still held, doubling and barring as ever.
    const uncouth = withQuality(clean, quality('Uncouth', 'positive', 14));
    expect(find('quality-type-mismatch', uncouth)).toMatchObject({ severity: 'error', step: 5, path: 'qualities.0.type' });
    expect(check(vary(uncouth, (b) => void (b.skills.groups[1]!.id = 'influence'))).map((i) => i.code)).toContain('uncouth-social-group');
    expect(has('quality-type-mismatch', withQuality(clean, quality('Uncouth', 'negative', 14)))).toBe(false);
    // A positive quality recorded as negative would pay Karma out.
    expect(has('quality-type-mismatch', withQuality(clean, quality('Lucky', 'negative', 12)))).toBe(true);
    // The sasquatch's positive Uneducated is its buy-off, not a slip.
    const sasquatch = vary(clean, (b) => {
      b.metatype = 'sasquatch';
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
    });
    expect(has('quality-type-mismatch', withQuality(sasquatch, quality('Uneducated', 'positive', 8)), metavariants)).toBe(false);
    expect(has('quality-type-mismatch', withQuality(clean, quality('Uneducated', 'positive', 8)))).toBe(true);
  });

  it('quality-racial-held: a metatype born with a negative quality cannot take it again for its Karma (RF p.102)', () => {
    const metavariants = settings({ allowMetavariants: true });
    const sasquatch = vary(clean, (b) => {
      b.metatype = 'sasquatch';
      b.priorities.metatype = 'B';
      b.priorities.skills = 'C';
    });
    expect(find('quality-racial-held', withQuality(sasquatch, quality('Uneducated', 'negative', 8)), metavariants)).toMatchObject({
      severity: 'error',
      step: 5,
      path: 'qualities.0',
      ref: { book: 'RF', page: 102 },
    });
    expect(has('quality-racial-held', withQuality(sasquatch, quality('Uneducated', 'positive', 8)), metavariants)).toBe(false);
    expect(has('quality-racial-held', withQuality(clean, quality('Uneducated', 'negative', 8)))).toBe(false);
  });

  it('exceptional-attribute-target: Exceptional Attribute names a mental, physical or special attribute, not Edge (SR5 p.72)', () => {
    expect(has('exceptional-attribute-target', withQuality(clean, quality('Exceptional Attribute', 'positive', 14)))).toBe(true);
    expect(has('exceptional-attribute-target', withQuality(clean, quality('Exceptional Attribute', 'positive', 14, { target: 'Edge' })))).toBe(true);
    expect(has('exceptional-attribute-target', withQuality(clean, quality('Exceptional Attribute (Strength)', 'positive', 14)))).toBe(false);
  });

  it('aptitude-target: Aptitude names the active skill it lifts (SR5 p.72)', () => {
    expect(has('aptitude-target', withQuality(clean, quality('Aptitude', 'positive', 14)))).toBe(true);
    expect(has('aptitude-target', withQuality(clean, quality('Aptitude', 'positive', 14, { target: 'blades' })))).toBe(false);
  });

  it('incompetent-target: Incompetent names the skill group it bars (SR5 p.81)', () => {
    expect(has('incompetent-target', withQuality(clean, quality('Incompetent', 'negative', 5)))).toBe(true);
    expect(has('incompetent-target', withQuality(clean, quality('Incompetent (Acting)', 'negative', 5)))).toBe(false);
  });

  it('approval-quality: Exceptional Attribute and Lucky need the GM — approved clears it, denied makes it an error (SR5 p.66)', () => {
    const ea = withQuality(clean, quality('Exceptional Attribute', 'positive', 14, { target: 'agi' }));
    expect(find('approval-quality-exceptional-attribute-agi', ea)).toMatchObject({ severity: 'approval', step: 5, ref: { page: 72 } });
    expect(has('approval-quality-lucky', withQuality(clean, quality('Lucky', 'positive', 12)))).toBe(true);
    const approved = vary(ea, (b) => void (b.approvals['approval-quality-exceptional-attribute-agi'] = 'approved'));
    expect(has('approval-quality-exceptional-attribute-agi', approved)).toBe(false);
    const denied = vary(ea, (b) => void (b.approvals['approval-quality-exceptional-attribute-agi'] = 'denied'));
    expect(find('approval-quality-exceptional-attribute-agi', denied)?.severity).toBe('error');
    // A quality off the whitelist picked from the books is a name and a cost: nothing for the GM to decide.
    const ordinary = check(withQuality(clean, quality('Keen Eye', 'positive', 5, { catalogueId: 'q-keen-eye' })));
    expect(ordinary.filter((i) => i.severity === 'approval')).toEqual([]);
  });

  it('approval-quality-custom: a quality written in by hand — not from the books, not whitelisted — waits on the GM, and a re-priced one asks again', () => {
    const written = withQuality(clean, quality('Neon Hunch', 'positive', 7));
    const asks = check(written).filter((i) => i.severity === 'approval');
    expect(asks).toHaveLength(1);
    const code = asks[0]!.code;
    expect(code).toMatch(/^approval-quality-custom-neon-hunch-[0-9a-z]+$/);
    expect(asks[0]).toMatchObject({ step: 5, path: 'qualities.0', ref: { book: 'SR5', page: 71 } });
    expect(asks[0]!.message).toContain('Neon Hunch');
    // A negative one the player wrote for themselves is the same decision, with the page they cite.
    const negative = check(withQuality(clean, quality('Loud Past', 'negative', 25, { ref: { book: 'SR5', page: 81 } })));
    expect(negative.find((i) => i.code.startsWith('approval-quality-custom-loud-past-'))?.ref).toEqual({ book: 'SR5', page: 81 });
    // Approved, it is gone; denied, it blocks.
    expect(has(code, vary(written, (b) => void (b.approvals[code] = 'approved')))).toBe(false);
    expect(find(code, vary(written, (b) => void (b.approvals[code] = 'denied')))?.severity).toBe('error');
    // Approved at 7 and re-priced to 14 is a new decision.
    const repriced = vary(written, (b) => {
      b.approvals[code] = 'approved';
      b.qualities[0]!.karma = 14;
    });
    const again = check(repriced).filter((i) => i.severity === 'approval');
    expect(again).toHaveLength(1);
    expect(again[0]!.code).not.toBe(code);
    // Two identical lines are two decisions.
    const twice = check(withQuality(clean, quality('Neon Hunch', 'positive', 7), quality('Neon Hunch', 'positive', 7)));
    expect(new Set(twice.filter((i) => i.severity === 'approval').map((i) => i.code)).size).toBe(2);
    // The whitelist's own qualities keep their own decision (or none).
    expect(check(withQuality(clean, quality('Bilingual', 'positive', 5))).some((i) => i.code.includes('custom'))).toBe(false);
  });

  it('approval-quality: the decision names what the quality lifts — approving it on Agility does not approve it on Strength (SR5 p.72)', () => {
    // "Agility" and "agi" are one decision.
    const approved = vary(
      withQuality(clean, quality('Exceptional Attribute', 'positive', 14, { target: 'Agility' })),
      (b) => void (b.approvals['approval-quality-exceptional-attribute-agi'] = 'approved'),
    );
    expect(has('approval-quality-exceptional-attribute-agi', approved)).toBe(false);
    // Returned and moved to Strength, it asks the GM again.
    const moved = vary(approved, (b) => void (b.qualities[0]!.target = 'str'));
    expect(find('approval-quality-exceptional-attribute-str', moved)?.severity).toBe('approval');
  });
});

describe('validate: Step 6 — skills', () => {
  it('skill-unknown: a skill must be one the skill list has (SR5 p.90)', () => {
    expect(has('skill-unknown', vary(clean, (b) => swapSkill(b, 'locksmith', 'basket-weaving')))).toBe(true);
    expect(has('skill-unknown', vary(clean, (b) => swapSkill(b, 'locksmith', 'Escape Artist')))).toBe(false);
  });

  it('group-unknown: a group must be one of the fifteen (SR5 p.90)', () => {
    expect(has('group-unknown', vary(clean, (b) => void (b.skills.groups[1]!.id = 'juggling')))).toBe(true);
    expect(has('group-unknown', clean)).toBe(false);
  });

  it('skill-duplicate: a skill is listed once (SR5 p.88)', () => {
    expect(has('skill-duplicate', vary(clean, (b) => void b.skills.active.push({ id: 'blades', points: 0, spec: null })))).toBe(true);
    const twoExotics = vary(clean, (b) => {
      swapSkill(b, 'locksmith', 'exotic-ranged', { target: 'Net gun', points: 1 });
      b.skills.active.push({ id: 'exotic-ranged', target: 'Dart rifle', points: 1, spec: null });
    });
    expect(has('skill-duplicate', twoExotics)).toBe(false);
  });

  it('skill-points-over: no more skill points than the row gives, knowledge ranks and specialisations included (SR5 p.88)', () => {
    expect(has('skill-points-over', vary(clean, (b) => void (b.skills.active[1]!.points = 5)))).toBe(true);
    const diverted = vary(clean, (b) => {
      b.skills.active[1]!.points = 3;
      b.skills.knowledge[0]!.skillPoints = 1;
      b.skills.knowledge[0]!.points = 2;
    });
    expect(has('skill-points-over', diverted)).toBe(false);
  });

  it('skill-points-unspent: all skill points must be spent (SR5 p.88)', () => {
    expect(has('skill-points-unspent', vary(clean, (b) => void (b.skills.active[1]!.points = 3)))).toBe(true);
    expect(has('skill-points-unspent', clean)).toBe(false);
  });

  it('group-points-over: no more group points than the row gives (SR5 p.88)', () => {
    expect(has('group-points-over', vary(clean, (b) => void (b.skills.groups[0]!.points = 4)))).toBe(true);
    expect(has('group-points-over', clean)).toBe(false);
  });

  it('group-points-unspent: all group points must be spent (SR5 p.88)', () => {
    expect(has('group-points-unspent', vary(clean, (b) => void (b.skills.groups[0]!.points = 2)))).toBe(true);
    expect(has('group-points-unspent', clean)).toBe(false);
  });

  it('knowledge-points-over: free knowledge points are (INT + LOG) × 2 (SR5 p.89)', () => {
    expect(has('knowledge-points-over', vary(clean, (b) => void (b.skills.knowledge[0]!.points = 4)))).toBe(true);
    expect(has('knowledge-points-over', clean)).toBe(false);
  });

  it('knowledge-points-unspent: free knowledge points cannot be saved (SR5 p.88)', () => {
    expect(has('knowledge-points-unspent', vary(clean, (b) => void (b.skills.knowledge[0]!.points = 2)))).toBe(true);
    expect(has('knowledge-points-unspent', clean)).toBe(false);
  });

  it('skill-rating-over: skills stop at 6 at creation, 7 for the Aptitude skill (SR5 p.88)', () => {
    const karma7 = vary(clean, (b) => void b.karma.spends.push({ kind: 'skill', id: 'blades', from: 5, to: 7 }));
    expect(find('skill-rating-over', karma7)?.step).toBe(8);
    expect(find('skill-rating-over', vary(clean, (b) => void (b.skills.active[0]!.points = 7)))?.step).toBe(6);
    const apt = vary(karma7, (b) => void b.qualities.push(quality('Aptitude', 'positive', 14, { target: 'blades' })));
    expect(has('skill-rating-over', apt)).toBe(false);
  });

  it('group-rating-over: groups stop at 6 — Aptitude does not reach them (SR5 p.88)', () => {
    expect(has('group-rating-over', vary(clean, (b) => void (b.skills.groups[0]!.points = 7)))).toBe(true);
    expect(has('group-rating-over', vary(clean, (b) => void b.karma.spends.push({ kind: 'group', id: 'firearms', from: 3, to: 6 })))).toBe(false);
  });

  it('knowledge-rating-over: knowledge and language skills stop at 6 at creation (SR5 p.91)', () => {
    expect(has('knowledge-rating-over', vary(clean, (b) => void (b.skills.knowledge[0]!.points = 7)))).toBe(true);
    expect(has('knowledge-rating-over', vary(clean, (b) => void b.karma.spends.push({ kind: 'language', name: 'Spanish', from: 2, to: 7 })))).toBe(true);
    expect(has('knowledge-rating-over', vary(clean, (b) => void (b.skills.knowledge[0]!.points = 6)))).toBe(false);
  });

  it('skill-in-bought-group: a group skill takes no individual points — groups cannot be broken in Step 5 (SR5 p.88)', () => {
    expect(has('skill-in-bought-group', vary(clean, (b) => void b.skills.active.push({ id: 'pistols', points: 1, spec: null })))).toBe(true);
    expect(has('skill-in-bought-group', vary(clean, (b) => void b.karma.spends.push({ kind: 'skill', id: 'pistols', from: 3, to: 4 })))).toBe(false);
  });

  it('spec-on-group-skill: a skill bought through its group is not specialised with points (SR5 p.89)', () => {
    expect(has('spec-on-group-skill', vary(clean, (b) => void b.skills.active.push({ id: 'pistols', points: 0, spec: 'Revolvers' })))).toBe(true);
    const byKarma = vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }));
    expect(has('spec-on-group-skill', byKarma)).toBe(false);
  });

  it('spec-on-group: a skill group takes no specialisation at all (SR5 p.89)', () => {
    expect(has('spec-on-group', vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'firearms', spec: 'Rifles' })))).toBe(true);
    expect(has('spec-on-group', vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'longarms', spec: 'Rifles' })))).toBe(false);
  });

  it('spec-more-than-one: one specialisation per skill at creation (SR5 p.89)', () => {
    const second = vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'blades', spec: 'Swords' }));
    expect(find('spec-more-than-one', second)?.step).toBe(8);
    expect(has('spec-more-than-one', vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'perception', spec: 'Sight' })))).toBe(false);
  });

  it('spec-without-skill: a specialisation needs a skill to sit on (SR5 p.89)', () => {
    expect(find('spec-without-skill', vary(clean, (b) => void b.skills.active.push({ id: 'archery', points: 0, spec: 'Bows' })))?.step).toBe(6);
    expect(find('spec-without-skill', vary(clean, (b) => void b.karma.spends.push({ kind: 'specialization', list: 'active', id: 'archery', spec: 'Bows' })))?.step).toBe(8);
    expect(has('spec-without-skill', clean)).toBe(false);
  });

  it('skill-restricted-magic: Magic skills and groups need a Magic rating — Arcana is not one of them (SR5 p.89)', () => {
    expect(has('skill-restricted-magic', vary(clean, (b) => swapSkill(b, 'heavy-weapons', 'spellcasting')))).toBe(true);
    expect(has('skill-restricted-magic', vary(clean, (b) => void (b.skills.groups[1]!.id = 'sorcery')))).toBe(true);
    expect(has('skill-restricted-magic', mage)).toBe(false);
    expect(has('skill-restricted-magic', vary(clean, (b) => swapSkill(b, 'heavy-weapons', 'arcana')))).toBe(false);
  });

  it('skill-restricted-resonance: Resonance skills are for technomancers only (SR5 p.89)', () => {
    expect(has('skill-restricted-resonance', vary(mage, (b) => swapSkill(b, 'locksmith', 'compiling')))).toBe(true);
    expect(has('skill-restricted-resonance', techno)).toBe(false);
  });

  it('skill-aspect-fence: an aspected magician uses only their aspect\'s skills (SR5 p.69)', () => {
    const sorcerer = vary(mage, (b) => void (b.magic = { kind: 'aspected', aspect: 'sorcery', tradition: 'hermetic' }));
    expect(has('skill-aspect-fence', vary(sorcerer, (b) => swapSkill(b, 'locksmith', 'summoning')))).toBe(true);
    expect(has('skill-aspect-fence', sorcerer)).toBe(false);
  });

  it('skill-adept-fence: adepts take no Sorcery, Conjuring or Enchanting skills (SR5 p.69)', () => {
    expect(has('skill-adept-fence', vary(adept, (b) => swapSkill(b, 'locksmith', 'counterspelling')))).toBe(true);
    expect(has('skill-adept-fence', vary(mage, (b) => swapSkill(b, 'locksmith', 'counterspelling')))).toBe(false);
  });

  it('assensing-needs-astral: Assensing is only for those who can perceive astrally (SR5 p.142, p.69)', () => {
    const assense = (b: CharacterBuild) => vary(b, (x) => swapSkill(x, 'locksmith', 'assensing'));
    expect(has('assensing-needs-astral', assense(clean))).toBe(true);
    expect(has('assensing-needs-astral', assense(adept))).toBe(true);
    expect(has('assensing-needs-astral', assense(mage))).toBe(false);
    const perceiving = vary(assense(adept), (b) => void (b.powers[1] = { name: 'Astral Perception', cost: 2, levels: 1, mods: [] }));
    expect(has('assensing-needs-astral', perceiving)).toBe(false);
  });

  it('incompetent-group-owned: the group Incompetent names cannot be owned (SR5 p.81)', () => {
    expect(has('incompetent-group-owned', vary(clean, (b) => void b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'firearms' }))))).toBe(true);
    expect(has('incompetent-group-owned', vary(clean, (b) => void b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'acting' }))))).toBe(false);
    // Bought with Karma alone, the group is Step 8's to take back — and its members say nothing of their own.
    const stealthless = vary(clean, (b) => {
      b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'stealth' }));
      swapSkill(b, 'sneaking', 'gymnastics');
      b.karma.spends.push({ kind: 'group', id: 'stealth', from: 0, to: 1 });
    });
    const issues = check(stealthless).filter((i) => i.code.startsWith('incompetent-'));
    expect(find('incompetent-group-owned', stealthless)).toMatchObject({ step: 8, path: 'karma.spends' });
    expect(issues.map((i) => i.code)).toEqual(['incompetent-group-owned']);
  });

  it("incompetent-skill-owned: Incompetent closes its group's skills one by one too, not just the group (SR5 p.81)", () => {
    const stealthless = vary(clean, (b) => void b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'stealth' })));
    const sneaking = clean.skills.active.findIndex((sk) => sk.id === 'sneaking');
    expect(find('incompetent-skill-owned', stealthless)).toMatchObject({ severity: 'error', step: 6, path: `skills.active.${sneaking}.points` });
    // Learned with Karma alone, it is Step 8's to take back.
    const learned = vary(stealthless, (b) => {
      b.skills.active = b.skills.active.filter((sk) => sk.id !== 'sneaking');
      b.karma.spends.push({ kind: 'skill', id: 'palming', from: 0, to: 1 });
    });
    expect(find('incompetent-skill-owned', learned)).toMatchObject({ step: 8, path: 'karma.spends' });
    expect(has('incompetent-skill-owned', vary(clean, (b) => void b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'acting' }))))).toBe(false);
    // A skill rated only through the barred group is the group's issue, not a second one.
    const firearms = vary(clean, (b) => void b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'firearms' })));
    expect(has('incompetent-skill-owned', firearms)).toBe(false);
    // Granted by the Magic column alone, it is Step 4's grant to change.
    const granted = vary(adept, (b) => {
      b.qualities.push(quality('Incompetent', 'negative', 5, { target: 'stealth' }));
      swapSkill(b, 'sneaking', 'gymnastics');
      b.grants.skills = [{ id: 'sneaking', rating: 2 }];
    });
    expect(find('incompetent-skill-owned', granted)).toMatchObject({ step: 4, path: 'grants.skills.0' });
    // Raised with Karma past the group it came with, its own rating is Step 8's.
    const raised = vary(firearms, (b) => void b.karma.spends.push({ kind: 'skill', id: 'automatics', from: 3, to: 4 }));
    expect(find('incompetent-skill-owned', raised)).toMatchObject({ step: 8, path: 'karma.spends' });
  });

  it('uncouth-social-group: Uncouth bars the social skill groups (SR5 p.85)', () => {
    const uncouth = vary(clean, (b) => void b.qualities.push(quality('Uncouth', 'negative', 14)));
    expect(has('uncouth-social-group', vary(uncouth, (b) => void (b.skills.groups[1]!.id = 'influence')))).toBe(true);
    expect(has('uncouth-social-group', uncouth)).toBe(false);
  });

  it('native-language-count: one native language free, two with Bilingual (SR5 p.89, p.91)', () => {
    const two = vary(clean, (b) => void (b.skills.languages[1] = { name: 'Spanish', native: true, points: 0, skillPoints: 0, spec: null }));
    expect(has('native-language-count', two)).toBe(true);
    expect(has('native-language-count', vary(two, (b) => void b.qualities.push(quality('Bilingual', 'positive', 5))))).toBe(false);
  });

  it('native-language-missing: every runner has a native language (SR5 p.89)', () => {
    expect(find('native-language-missing', vary(clean, (b) => void (b.skills.languages[0]!.native = false)))?.severity).toBe('warning');
    expect(has('native-language-missing', clean)).toBe(false);
  });

  it('native-language-rated: points on a native language buy nothing (SR5 p.89)', () => {
    expect(has('native-language-rated', vary(clean, (b) => void (b.skills.languages[0]!.points = 1)))).toBe(true);
    expect(has('native-language-rated', clean)).toBe(false);
  });

  it('knowledge-unnamed: points go into a named knowledge skill (SR5 p.89)', () => {
    expect(has('knowledge-unnamed', vary(clean, (b) => void (b.skills.knowledge[0]!.name = '')))).toBe(true);
    expect(has('knowledge-unnamed', clean)).toBe(false);
  });

  it('specific-skill-target: Exotic Weapon and Pilot Exotic Vehicle name what they are for (SR5 p.131, p.147)', () => {
    expect(find('specific-skill-target', vary(clean, (b) => swapSkill(b, 'locksmith', 'exotic-ranged')))?.severity).toBe('warning');
    expect(has('specific-skill-target', vary(clean, (b) => swapSkill(b, 'locksmith', 'exotic-ranged', { target: 'Net gun' })))).toBe(false);
  });
});

describe('validate: Step 7 — gear', () => {
  const kit = (b: CharacterBuild) => b.purchases.find((p) => p.name === 'Kit')!;

  it('nuyen-overspent: purchases and lifestyles cost no more than Resources and conversion (SR5 p.94)', () => {
    expect(has('nuyen-overspent', vary(clean, (b) => void (kit(b).cost = 49_000)))).toBe(true);
    expect(has('nuyen-overspent', clean)).toBe(false);
  });

  it('karma-to-nuyen-over: convert at most 10 Karma — 5 at street (SR5 p.94, p.64)', () => {
    expect(has('karma-to-nuyen-over', vary(clean, (b) => void (b.karma.toNuyen = 11)))).toBe(true);
    const street = (n: number) => vary(clean, (b) => {
      b.level = 'street';
      b.karma.toNuyen = n;
    });
    expect(find('karma-to-nuyen-over', street(6), settings({ level: 'street' }))?.ref.page).toBe(64);
    expect(has('karma-to-nuyen-over', street(5), settings({ level: 'street' }))).toBe(false);
  });

  it('nuyen-carry-lost: more than 5,000¥ left over is lost (SR5 p.94)', () => {
    expect(find('nuyen-carry-lost', vary(clean, (b) => void (kit(b).cost = 40_000)))?.severity).toBe('warning');
    expect(has('nuyen-carry-lost', clean)).toBe(false);
  });

  it('availability-over: Availability 12 at most, grade modifiers included (SR5 p.94, p.451)', () => {
    expect(has('availability-over', vary(clean, (b) => void (kit(b).avail = '13')))).toBe(true);
    expect(has('availability-over', vary(clean, (b) => void (kit(b).avail = '12')))).toBe(false);
    const implant = (grade: 'alphaware' | 'used', avail: string) =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.purchases.push(augment('Nerve Lace', 5_000, 0.2, { grade, avail }) as never);
      });
    expect(has('availability-over', implant('alphaware', '11'))).toBe(true);
    expect(has('availability-over', implant('used', '15'))).toBe(false);
    // Every shape the catalogue emits is read against the rating: "10 + Rating", "(Rating + 8)F", "16+".
    const formula = (avail: string, rating: number | null) =>
      vary(clean, (b) => {
        kit(b).avail = avail;
        kit(b).rating = rating;
      });
    expect(has('availability-over', formula('10 + Rating', 3))).toBe(true);
    expect(has('availability-over', formula('10 + Rating', 2))).toBe(false);
    expect(has('availability-over', formula('(Rating + 8)F', 6))).toBe(true);
    expect(has('availability-over', formula('16+', null))).toBe(true);
    // A footnote mark after the code is not part of it.
    expect(has('availability-over', formula('16F†', null))).toBe(true);
    expect(has('availability-over', formula('(Rating x 3)F¹', 5))).toBe(true);
    expect(has('availability-over', formula('8R*', null))).toBe(false);
  });

  it('availability-over: a focus bought without its Force is as available as the Force it is bonded at (SR5 p.94, p.461)', () => {
    const powerFocus = (force: number, rating: number | null = null) =>
      vary(mage, (b) => {
        b.purchases.push(gear('Power Focus', 18_000, { rating, avail: '(Force x 4)R', catalogueId: 'focus-power' }) as never);
        b.karma.spends.push({ kind: 'focus', name: 'Power Focus', focusType: 'power', force, bondKarma: force * 6 });
      });
    // Force 4 is Availability 16, whether the Force is on the line or only on the bond.
    expect(find('availability-over', powerFocus(4))).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends.2.force' });
    expect(find('availability-over', powerFocus(4, 4))?.path).toBe('purchases.4.avail');
    expect(has('availability-over', powerFocus(3))).toBe(false);
    // The bond's Force answers the rating the line left out: nothing unreadable about it.
    expect(check(powerFocus(3)).map((i) => i.code)).not.toContain('availability-unreadable');
  });

  it('availability-unreadable: an Availability the cap cannot be checked against is flagged, never passed in silence (SR5 p.94)', () => {
    expect(find('availability-unreadable', vary(clean, (b) => void (kit(b).avail = 'Varies')))).toMatchObject({
      severity: 'warning',
      step: 7,
      path: 'purchases.3.avail',
    });
    // A formula in Rating on a line that records no rating: the rating is what is missing.
    const unrated = vary(clean, (b) => void (kit(b).avail = '(Rating x 3)R'));
    expect(find('availability-unreadable', unrated)?.path).toBe('purchases.3.rating');
    expect(has('availability-over', unrated)).toBe(false);
    expect(has('availability-unreadable', vary(unrated, (b) => void (kit(b).rating = 3)))).toBe(false);
    // An accessory's "+2" adds to what it mounts on: nothing to cap, nothing to flag.
    expect(has('availability-unreadable', vary(clean, (b) => void (kit(b).avail = '+2')))).toBe(false);
    expect(has('availability-unreadable', clean)).toBe(false);
  });

  it('device-rating-over: device rating 6 at most (SR5 p.94)', () => {
    const commlink = (b: CharacterBuild) => b.purchases.find((p) => p.name === 'Commlink')!;
    expect(has('device-rating-over', vary(clean, (b) => void (commlink(b).rating = 7)))).toBe(true);
    expect(has('device-rating-over', vary(clean, (b) => void (commlink(b).rating = 6)))).toBe(false);
  });

  it('device-rating-over: a catalogue commlink carries its Device Rating in a column of its own, not as its Rating — street stops at 4 (SR5 p.64, p.94)', () => {
    const street = settings({ level: 'street' });
    const deck = (change: (p: CharacterBuild['purchases'][number]) => void) =>
      vary(clean, (b) => {
        b.level = 'street';
        const line = b.purchases.find((p) => p.name === 'Commlink')!;
        line.rating = null;
        change(line);
      });
    expect(find('device-rating-over', deck((p) => void (p.deviceRating = 6)), street)?.path).toBe('purchases.0.deviceRating');
    expect(has('device-rating-over', deck((p) => void (p.item.note = 'commlinks · device rating 6 · avail 6')), street)).toBe(true);
    expect(has('device-rating-over', deck((p) => void (p.deviceRating = 4)), street)).toBe(false);
  });

  it('grade-not-at-creation: only standard, alphaware and used implants at creation (SR5 p.95)', () => {
    const graded = (grade: 'betaware' | 'alphaware') =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.purchases.push(augment('Nerve Lace', 2_000, 0.2, { grade }) as never);
      });
    // The rule's page (p.95), which the Gear step's grade cards cite too — not
    // the grades table (p.451), so one screen never names two pages for it.
    expect(find('grade-not-at-creation', graded('betaware'))?.ref).toEqual({ book: 'SR5', page: 95 });
    expect(has('grade-not-at-creation', graded('alphaware'))).toBe(false);
  });

  it('augment-bonus-over: no attribute is augmented past +4 from all sources (SR5 p.94)', () => {
    const boosted = (a: number, b2: number) =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.purchases.push(augment('Muscle Graft', 1_000, 0.2, { item: { name: 'Muscle Graft', essence: 0.2, mods: [mod('attr.agi', a)] } }) as never);
        b.powers = [];
        b.qualities.push(quality('Wiry', 'positive', 3, { mods: [mod('attr.agi', 1, 'quality')] }));
        b.purchases.push(augment('Reflex Wire', 1_000, 0.2, { item: { name: 'Reflex Wire', essence: 0.2, mods: [mod('attr.agi', b2)] } }) as never);
      });
    expect(has('augment-bonus-over', boosted(3, 2))).toBe(true);
    // The quality's +1 is innate, not augmentation.
    expect(has('augment-bonus-over', boosted(2, 2))).toBe(false);
  });

  it('essence-depleted: Essence must stay above 0 (SR5 p.53)', () => {
    const drained = (essence: number) =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.purchases.push(augment('Full Chrome', 1_000, essence) as never);
      });
    expect(has('essence-depleted', drained(6))).toBe(true);
    expect(has('essence-depleted', drained(5.9))).toBe(false);
  });

  it('magic-reduced-by-essence: any fraction of Essence lost takes a point of Magic (SR5 p.95)', () => {
    const chromed = vary(mage, (b) => {
      kit(b).cost = 40_000;
      b.purchases.push(augment('Datajack', 1_000, 0.1) as never);
    });
    expect(find('magic-reduced-by-essence', chromed)?.message).toContain('from 3 to 2');
    expect(has('magic-reduced-by-essence', mage)).toBe(false);
  });

  it('magic-burned-out: Essence loss that takes Magic to 0 (SR5 p.95)', () => {
    const burned = (essence: number) =>
      vary(mage, (b) => {
        kit(b).cost = 40_000;
        b.purchases.push(augment('Heavy Chrome', 1_000, essence) as never);
      });
    expect(has('magic-burned-out', burned(2.5))).toBe(true);
    expect(has('magic-burned-out', burned(2))).toBe(false);
  });

  it('sensitive-system-bioware: Sensitive System rules out bioware (SR5 p.83)', () => {
    const sensitive = (kind: string) =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.qualities.push(quality('Sensitive System', 'negative', 12));
        b.purchases.push(augment('Toner', 1_000, 0.1, { kind }) as never);
      });
    expect(has('sensitive-system-bioware', sensitive('bioware'))).toBe(true);
    expect(has('sensitive-system-bioware', sensitive('augmentation'))).toBe(false);
  });

  it("sensitive-system-bioware: bioware as the catalogue delivers it — kind augmentation, told apart by its table heading or its page (SR5 p.83, pp.459–461)", () => {
    const catalogued = (extra: object) =>
      vary(clean, (b) => {
        kit(b).cost = 40_000;
        b.qualities.push(quality('Sensitive System', 'negative', 12));
        b.purchases.push(augment('Muscle Toner', 1_000, 0.2, extra) as never);
      });
    expect(has('sensitive-system-bioware', catalogued({ category: 'BASIC BIOWARE' }))).toBe(true);
    expect(has('sensitive-system-bioware', catalogued({ ref: { book: 'SR5', page: 460 } }))).toBe(true);
    expect(has('sensitive-system-bioware', catalogued({ category: 'CYBERLIMBS', ref: { book: 'SR5', page: 460 } }))).toBe(false);
    // A bioware table whose heading does not say so: Chrome Flesh's orthoskin upgrades (CF p.117).
    expect(has('sensitive-system-bioware', catalogued({ category: 'ORTHOSKIN UPGRADES', ref: { book: 'CF', page: 117 } }))).toBe(true);
    expect(has('sensitive-system-bioware', catalogued({ category: 'UPGRADES', ref: { book: 'CF', page: 117 } }))).toBe(true);
    expect(has('sensitive-system-bioware', catalogued({ category: 'UPGRADES', ref: { book: 'CF', page: 60 } }))).toBe(false);
  });

  it('lifestyle-missing: a runner lives somewhere (SR5 p.94)', () => {
    expect(find('lifestyle-missing', vary(clean, (b) => void (b.lifestyles = [])))?.severity).toBe('warning');
    expect(has('lifestyle-missing', clean)).toBe(false);
  });

  it('commlink-missing: the gear checklist\'s commlink (SR5 p.94)', () => {
    expect(has('commlink-missing', vary(clean, (b) => void (b.purchases = b.purchases.filter((p) => p.name !== 'Commlink'))))).toBe(true);
    expect(has('commlink-missing', clean)).toBe(false);
  });

  it('fake-sin-missing: the gear checklist\'s fake SIN (SR5 p.94)', () => {
    expect(has('fake-sin-missing', vary(clean, (b) => void (b.purchases = b.purchases.filter((p) => p.name !== 'Fake SIN'))))).toBe(true);
    expect(has('fake-sin-missing', clean)).toBe(false);
  });

  it('approval-gear: Restricted and Forbidden gear is the GM\'s call, item by item (SR5 p.94)', () => {
    const restricted = vary(clean, (b) => void (kit(b).avail = '8R'));
    const issue = gearApproval(3, restricted);
    expect(issue).toMatchObject({ severity: 'approval', step: 7, path: 'purchases.3' });
    expect(issue?.code).toMatch(/^approval-gear-kit-[0-9a-z]{6}$/);
    expect(issueRule(issue!.code)).toBe(ISSUE_RULES['approval-gear']);
    const code = issue!.code;
    expect(gearApproval(3, vary(restricted, (b) => void (b.approvals[code] = 'approved')))).toBeUndefined();
    expect(gearApproval(3, vary(restricted, (b) => void (b.approvals[code] = 'denied')))?.severity).toBe('error');
    expect(gearApproval(3, clean)).toBeUndefined();
    // A code with a note or a mark beside it is still Forbidden, readable or not.
    for (const avail of ['12F (see text)', '16F†', '(Rating x 3)F¹', 'Varies F']) {
      expect(gearApproval(3, vary(clean, (b) => void (kit(b).avail = avail))), avail).toBeDefined();
    }
    expect(gearApproval(3, vary(clean, (b) => void (kit(b).avail = 'Varies (see Rules)')))).toBeUndefined();
  });

  it('approval-gear: one decision per line as entered — a same-named line, an identical second line, or an edit asks the GM again (SR5 p.94)', () => {
    const restricted = vary(clean, (b) => void (kit(b).avail = '8R'));
    const code = gearApproval(3, restricted)!.code;
    const approved = vary(restricted, (b) => void (b.approvals[code] = 'approved'));
    expect(gearApproval(3, approved)).toBeUndefined();
    // Another line of the same name, Forbidden, is not the Restricted one the GM approved.
    const forbiddenTwin = vary(approved, (b) => void b.purchases.push(gear('Kit', 0, { avail: '12F' }) as never));
    expect(gearApproval(4, forbiddenTwin)?.code).not.toBe(code);
    // An identical second line is a second decision.
    const identical = vary(approved, (b) => void b.purchases.push(gear('Kit', 0, { avail: '8R' }) as never));
    expect(gearApproval(4, identical)?.code).toBe(`${code}-2`);
    // The approved line edited to Forbidden, to a rating, or to more of it.
    const edits: ((p: CharacterBuild['purchases'][number]) => void)[] = [
      (p) => void (p.avail = '12F'),
      (p) => void (p.rating = 2),
      (p) => void (p.qty = 3),
    ];
    for (const edit of edits) {
      expect(gearApproval(3, vary(approved, (b) => edit(kit(b))))?.severity).toBe('approval');
    }
    // A new price is not a new decision.
    expect(gearApproval(3, vary(approved, (b) => void (kit(b).cost = 40_000)))).toBeUndefined();
  });

  it('approval-gear: the decision covers what the line is — its item, stats, modifiers, kind, heading and Essence — so rewriting an approved line asks again (SR5 p.94)', () => {
    const baton = {
      list: 'weapons',
      kind: 'weapon',
      name: 'Stun Baton',
      cost: 750,
      avail: '6R',
      item: { name: 'Stun Baton', skillId: 'clubs', acc: 4, dv: '9S(e)', ap: -5 },
    } as const;
    const restricted = vary(clean, (b) => {
      kit(b).cost = 40_000;
      b.purchases.push(structuredClone(baton) as never, augment('Muscle Toner', 1_000, 0.2, { rating: 2, avail: '8R', item: { name: 'Muscle Toner', essence: 0.2, mods: [mod('attr.agi', 2)] } }) as never);
    });
    const approved = vary(restricted, (b) => {
      for (const i of check(restricted)) if (i.code.startsWith('approval-gear-')) b.approvals[i.code] = 'approved';
    });
    expect(gearApproval(4, approved)).toBeUndefined();
    expect(gearApproval(5, approved)).toBeUndefined();
    type Line = CharacterBuild['purchases'][number];
    const weaponEdits: ((p: Extract<Line, { list: 'weapons' }>) => void)[] = [
      (p) => {
        p.item.name = 'Ares Alpha';
        p.item.dv = '11P';
        p.item.ap = -2;
      },
      (p) => void (p.item.dv = '20P'),
      (p) => void (p.kind = 'explosive'),
      (p) => void (p.category = 'GRENADES'),
    ];
    for (const edit of weaponEdits) {
      expect(gearApproval(4, vary(approved, (b) => edit(b.purchases[4] as Extract<Line, { list: 'weapons' }>)))?.severity).toBe('approval');
    }
    const augmentEdits: ((p: Extract<Line, { list: 'augments' }>) => void)[] = [
      (p) => void (p.item.mods = [{ ...p.item.mods[0]!, value: 4 }]),
      (p) => void (p.essence = 0.01),
      (p) => void (p.category = 'BASIC BIOWARE'),
    ];
    for (const edit of augmentEdits) {
      expect(gearApproval(5, vary(approved, (b) => edit(b.purchases[5] as Extract<Line, { list: 'augments' }>)))?.severity).toBe('approval');
    }
    // A modifier given a new id does the same thing, and a new price buys the same item: no new decision.
    expect(gearApproval(5, vary(approved, (b) => void ((b.purchases[5] as Extract<Line, { list: 'augments' }>).item.mods[0]!.id = 'renamed')))).toBeUndefined();
    expect(gearApproval(4, vary(approved, (b) => void (b.purchases[4]!.cost = 900)))).toBeUndefined();
  });
});

describe('validate: Step 8 — Karma', () => {
  it('karma-overspent: spends cost no more Karma than there is (SR5 p.98)', () => {
    expect(has('karma-overspent', vary(clean, (b) => void b.karma.spends.push({ kind: 'skill', id: 'computer', from: 2, to: 3 })))).toBe(true);
    expect(has('karma-overspent', clean)).toBe(false);
  });

  it('karma-carry-over: at most 7 Karma carries into play (SR5 p.98)', () => {
    expect(has('karma-carry-over', vary(clean, (b) => void b.karma.spends.pop()))).toBe(true);
    const seven = vary(clean, (b) => {
      b.karma.spends.pop();
      b.karma.spends.push({ kind: 'knowledge', name: 'Safehouses', from: 3, to: 4 });
      b.karma.spends.push({ kind: 'knowledge', name: 'Bike Racing', from: 2, to: 3 });
    });
    expect(has('karma-carry-over', seven)).toBe(false);
  });

  it('karma-spend-stale: a raise starts from the rating the skill has (SR5 p.107)', () => {
    expect(has('karma-spend-stale', vary(clean, (b) => void (b.karma.spends[0] = { kind: 'skill', id: 'blades', from: 3, to: 5 })))).toBe(true);
    const chained = vary(clean, (b) => void b.karma.spends.push({ kind: 'skill', id: 'blades', from: 5, to: 6 }));
    expect(has('karma-spend-stale', chained)).toBe(false);
  });

  it('karma-spend-no-raise: a raise goes up (SR5 p.107)', () => {
    expect(has('karma-spend-no-raise', vary(clean, (b) => void (b.karma.spends[0] = { kind: 'skill', id: 'blades', from: 4, to: 4 })))).toBe(true);
    expect(has('karma-spend-no-raise', clean)).toBe(false);
  });

  it('group-raise-broken: a group is raised as a group only while its skills share one rating, and never once one is specialised (SR5 p.88, p.89)', () => {
    const athletics = (from: number, to: number) => ({ kind: 'group' as const, id: 'athletics', from, to });
    const skill = (id: string, from: number, to: number) => ({ kind: 'skill' as const, id, from, to });
    expect(has('group-raise-broken', vary(clean, (b) => void (b.karma.spends = [athletics(2, 3)])))).toBe(false);
    const broken = vary(clean, (b) => void (b.karma.spends = [skill('running', 2, 3), athletics(2, 3)]));
    expect(find('group-raise-broken', broken)).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends.1' });
    // Evened back up one by one, the three carry the group to 3, and it goes on from there.
    const evened = vary(clean, (b) => {
      b.karma.spends = [skill('running', 2, 3), skill('gymnastics', 2, 3), skill('swimming', 2, 3), athletics(3, 4)];
    });
    expect(check(evened).filter((i) => ['group-raise-broken', 'karma-spend-stale'].includes(i.code))).toEqual([]);
    expect(has('group-raise-broken', evened)).toBe(false);
    // A specialised member keeps it broken, even at an even rating.
    const specialised = vary(clean, (b) => {
      b.karma.spends = [{ kind: 'specialization', list: 'active', id: 'running', spec: 'Sprinting' }, athletics(2, 3)];
    });
    expect(find('group-raise-broken', specialised)?.message).toContain('specialised');
  });

  it('contact-karma-min: a contact has Connection 1 and Loyalty 1 at least, 2 Karma (SR5 p.98)', () => {
    // The schema already holds both at 1; a record from elsewhere may not.
    const raw = structuredClone(clean);
    raw.karma.contacts[1] = { name: 'Wren', role: 'Street doc', connection: 1, loyalty: 0 };
    expect(has('contact-karma-min', raw)).toBe(true);
    expect(has('contact-karma-min', clean)).toBe(false);
  });

  it('contact-karma-max: no more than 7 Karma on one contact at creation (SR5 p.98)', () => {
    expect(has('contact-karma-max', vary(clean, (b) => void (b.karma.contacts[0] = { name: 'Moss', role: 'Fixer', connection: 5, loyalty: 3 })))).toBe(true);
    expect(has('contact-karma-max', vary(clean, (b) => void (b.karma.contacts[0] = { name: 'Moss', role: 'Fixer', connection: 4, loyalty: 3 })))).toBe(false);
  });

  it('contact-karma-from-karma: contacts past Charisma × 3 draw on the main Karma pool (SR5 p.98)', () => {
    expect(find('contact-karma-from-karma', vary(clean, (b) => void (b.karma.contacts[0]!.connection = 4)))?.severity).toBe('warning');
    expect(has('contact-karma-from-karma', clean)).toBe(false);
  });

  it('contact-karma-unspent: free contact Karma left unspent (SR5 p.98)', () => {
    expect(has('contact-karma-unspent', vary(clean, (b) => void (b.karma.contacts[1]!.loyalty = 1)))).toBe(true);
    expect(has('contact-karma-unspent', clean)).toBe(false);
  });

  it('contact-unnamed: a contact has a name (SR5 p.98)', () => {
    expect(has('contact-unnamed', vary(clean, (b) => void (b.karma.contacts[0]!.name = '')))).toBe(true);
    expect(has('contact-unnamed', clean)).toBe(false);
  });

  const spirit = { kind: 'spirit' as const, type: 'air', services: 1 };

  it('spirits-not-summoner: bound spirits are for those who summon (SR5 p.98)', () => {
    expect(has('spirits-not-summoner', vary(clean, (b) => void b.karma.spends.push(spirit)))).toBe(true);
    expect(has('spirits-not-summoner', vary(mage, (b) => void b.karma.spends.push(spirit)))).toBe(false);
  });

  it('spirits-over-charisma: at most Charisma bound spirits (SR5 p.98)', () => {
    expect(has('spirits-over-charisma', vary(mage, (b) => void b.karma.spends.push(spirit, spirit, spirit, spirit)))).toBe(true);
    expect(has('spirits-over-charisma', vary(mage, (b) => void b.karma.spends.push(spirit, spirit, spirit)))).toBe(false);
  });

  const sprite = { kind: 'sprite' as const, type: 'data', tasks: 1 };

  it('sprites-not-technomancer: registered sprites are for technomancers (SR5 p.98)', () => {
    expect(has('sprites-not-technomancer', vary(mage, (b) => void b.karma.spends.push(sprite)))).toBe(true);
    expect(has('sprites-not-technomancer', vary(techno, (b) => void b.karma.spends.push(sprite)))).toBe(false);
  });

  it('sprites-over-charisma: at most Charisma registered sprites (SR5 p.98)', () => {
    expect(has('sprites-over-charisma', vary(techno, (b) => void b.karma.spends.push(sprite, sprite, sprite, sprite)))).toBe(true);
    expect(has('sprites-over-charisma', vary(techno, (b) => void b.karma.spends.push(sprite, sprite, sprite)))).toBe(false);
  });

  // Initiation and submersion at creation. Step 1 has always told a prime
  // table "Initiation at creation: allowed"; until the spend existed there was
  // no way to take it, and `canInitiate` was read only to print that word.
  const PRIME = settings({ level: 'prime' });
  const initiation = (grade: number) => ({ kind: 'initiation' as const, grade });

  it('initiation-not-at-this-level: only a prime runner initiates or submerges at creation (SR5 p.64)', () => {
    const initiate = vary(mage, (b) => void b.karma.spends.push(initiation(1)));
    expect(has('initiation-not-at-this-level', initiate)).toBe(true);
    expect(has('initiation-not-at-this-level', initiate, PRIME)).toBe(false);
    // And the 13 Karma it costs is really charged, not silently free.
    expect(budgets(initiate, PRIME).pools.karma.spent).toBe(budgets(mage, PRIME).pools.karma.spent + 13);
  });

  it('initiation-not-awakened: a mundane has nothing to initiate or submerge (SR5 p.325)', () => {
    expect(has('initiation-not-awakened', vary(clean, (b) => void b.karma.spends.push(initiation(1))), PRIME)).toBe(true);
    expect(has('initiation-not-awakened', vary(mage, (b) => void b.karma.spends.push(initiation(1))), PRIME)).toBe(false);
    expect(has('initiation-not-awakened', vary(techno, (b) => void b.karma.spends.push(initiation(1))), PRIME)).toBe(false);
  });

  it('initiation-grade-gap: grades are paid for one at a time from 1 up (SR5 p.325)', () => {
    expect(has('initiation-grade-gap', vary(mage, (b) => void b.karma.spends.push(initiation(2))), PRIME)).toBe(true);
    expect(has('initiation-grade-gap', vary(mage, (b) => void b.karma.spends.push(initiation(1), initiation(1))), PRIME)).toBe(true);
    expect(has('initiation-grade-gap', vary(mage, (b) => void b.karma.spends.push(initiation(1), initiation(2))), PRIME)).toBe(false);
  });

  it('carries the grade the build paid for onto the sheet, so nothing in play has to guess', () => {
    const initiate = vary(mage, (b) => void b.karma.spends.push(initiation(1), initiation(2)));
    expect(compileBuild(initiate, PRIME).sheet.awakening.grade).toBe(2);
    // A build that took none reads 0 rather than nothing at all.
    expect(compileBuild(mage, PRIME).sheet.awakening.grade).toBe(0);
  });

  it('foci-force-over: bonded foci total at most Magic × 2 Force at creation (SR5 p.98)', () => {
    const focus = (force: number) => ({ kind: 'focus' as const, name: 'Ring', focusType: 'spell', force, bondKarma: force * 2 });
    expect(has('foci-force-over', vary(mage, (b) => void b.karma.spends.push(focus(7))))).toBe(true);
    expect(has('foci-force-over', vary(mage, (b) => void b.karma.spends.push(focus(6))))).toBe(false);
    expect(has('foci-force-over', vary(clean, (b) => void b.karma.spends.push(focus(1))))).toBe(true);
  });

  it('focus-bond-karma: bonding costs what the Focus Table says for its type and Force (SR5 p.318)', () => {
    const focus = (bondKarma: number, focusType = 'spell') => ({ kind: 'focus' as const, name: 'Ring', focusType, force: 2, bondKarma });
    expect(has('focus-bond-karma', vary(mage, (b) => void b.karma.spends.push(focus(3))))).toBe(true);
    expect(has('focus-bond-karma', vary(mage, (b) => void b.karma.spends.push(focus(4))))).toBe(false);
    expect(has('focus-bond-karma', vary(mage, (b) => void b.karma.spends.push(focus(12, 'power'))))).toBe(false);
  });

  it('focus-type-unknown: a bonded focus says what kind it is, so the Focus Table can price its bond (SR5 p.318)', () => {
    const chain = (extra: object = {}) =>
      vary(mage, (b) => void b.karma.spends.push({ kind: 'focus', name: 'Weighted Chain', force: 1, bondKarma: 0, ...extra } as never));
    expect(find('focus-type-unknown', chain())).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends.2.focusType' });
    expect(has('focus-type-unknown', chain({ focusType: 'Weapon Focus', bondKarma: 3 }))).toBe(false);
    // A name that says its type will do — and then the table prices it, whatever was recorded.
    const power = vary(mage, (b) => void b.karma.spends.push({ kind: 'focus', name: 'Power Focus', force: 6, bondKarma: 0 }));
    expect(has('focus-type-unknown', power)).toBe(false);
    expect(find('focus-bond-karma', power)?.message).toContain('36');
    expect(has('karma-overspent', power)).toBe(true);
  });

  it('focus-type-mismatch: the label, the name and the focus bought say one type — a Power Focus labelled spell is not bonded at a spell focus\'s price (SR5 p.318)', () => {
    const bonded = (spend: object, bought = 'Power Focus') =>
      vary(mage, (b) => {
        b.karma.toNuyen = 0;
        b.purchases.push(gear(bought, 0, { catalogueId: 'focus' }) as never);
        b.karma.spends = [{ kind: 'focus', force: 1, catalogueId: 'focus', ...spend } as never];
      });
    const labelled = bonded({ name: 'Power Focus', focusType: 'spell', bondKarma: 2 });
    expect(find('focus-type-mismatch', labelled)).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends.0.focusType' });
    // Priced at the dearer meanwhile: 6 Karma, not the 2 recorded.
    expect(find('focus-bond-karma', labelled)?.message).toContain('6 Karma');
    expect(has('focus-type-mismatch', bonded({ name: 'Weapon Focus (Katana)', focusType: 'spirit', bondKarma: 3 }, 'Weapon Focus (Katana)'))).toBe(true);
    // The line bought counts too: a "Ring" labelled spell, bought as a power focus.
    expect(has('focus-type-mismatch', bonded({ name: 'Ring', focusType: 'spell', bondKarma: 2 }))).toBe(true);
    expect(has('focus-type-mismatch', bonded({ name: 'Power Focus', focusType: 'power', bondKarma: 6 }))).toBe(false);
    expect(has('focus-type-mismatch', bonded({ name: 'Ring', focusType: 'Sustaining', bondKarma: 2 }, 'Silver Ring'))).toBe(false);
  });

  it('focus-not-purchased: a focus is bought with nuyen before it is bonded with Karma (SR5 p.318, p.94)', () => {
    const bond = { kind: 'focus' as const, name: 'Silver Ring', focusType: 'spell', force: 2, bondKarma: 4 };
    const ring = (extra: object = {}) => gear('Silver Ring', 8_000, { rating: 2, avail: '(Rating x 3)R', ...extra }) as never;
    const unbought = vary(mage, (b) => void b.karma.spends.push(bond));
    expect(find('focus-not-purchased', unbought)).toMatchObject({ severity: 'error', step: 8, path: 'karma.spends.2' });
    expect(has('focus-not-purchased', vary(unbought, (b) => void b.purchases.push(ring())))).toBe(false);
    // At the bond's Force: a Force 3 ring is not the Force 2 one bonded.
    expect(has('focus-not-purchased', vary(unbought, (b) => void b.purchases.push(ring({ rating: 3 }))))).toBe(true);
    // Matched by catalogue id under another name.
    const catalogued = vary(mage, (b) => {
      b.purchases.push(gear('Spell focus', 8_000, { rating: 2, catalogueId: 'item-spell-focus' }) as never);
      b.karma.spends.push({ ...bond, catalogueId: 'item-spell-focus' });
    });
    expect(has('focus-not-purchased', catalogued)).toBe(false);
    // One line answers as many bonds as it holds.
    const twice = vary(unbought, (b) => {
      b.purchases.push(ring());
      b.karma.spends.push(bond);
    });
    expect(find('focus-not-purchased', twice)?.path).toBe('karma.spends.3');
    expect(has('focus-not-purchased', vary(twice, (b) => void (b.purchases[4]!.qty = 2)))).toBe(false);
    // An unrated line and a Force 2 line answer a Force 2 and a Force 3 bond in either order.
    const mixed = (forces: readonly number[]) =>
      vary(mage, (b) => {
        b.purchases.push(ring({ rating: null }), ring());
        for (const force of forces) b.karma.spends.push({ ...bond, force, bondKarma: force * 2 });
      });
    expect(has('focus-not-purchased', mixed([2, 3]))).toBe(false);
    expect(has('focus-not-purchased', mixed([3, 2]))).toBe(false);
    expect(find('focus-not-purchased', mixed([3, 3]))?.path).toBe('karma.spends.3');
  });

  it('knowledge-category-missing: a knowledge skill learned with Karma gets a category (SR5 p.89)', () => {
    const learned = (category?: 'academic') =>
      vary(clean, (b) => void b.karma.spends.push({ kind: 'knowledge', name: 'Corp Law', from: 0, to: 1, ...(category ? { category } : {}) }));
    expect(find('knowledge-category-missing', learned())?.severity).toBe('warning');
    expect(has('knowledge-category-missing', learned('academic'))).toBe(false);
  });
});

describe('validate: Step 9 — finish', () => {
  it('contacts-missing: the checklist asks for contacts (SR5 p.101)', () => {
    expect(has('contacts-missing', vary(clean, (b) => void (b.karma.contacts = [])))).toBe(true);
    expect(has('contacts-missing', clean)).toBe(false);
  });

  it('background-missing: final touches include a background (SR5 p.103)', () => {
    expect(find('background-missing', vary(clean, (b) => void delete b.identity.background))?.step).toBe(9);
    expect(has('background-missing', clean)).toBe(false);
  });
});

describe('validate: coverage', () => {
  it('every rule in ISSUE_RULES has a test of its own, named for its code and the page it enforces', ({ task }) => {
    // The file's collected tests, whether or not this run executed them — but
    // never a todo, which has no body to assert anything with.
    const names: string[] = [];
    const walk = (tasks: readonly RunnerTask[]): void => {
      for (const t of tasks) {
        if (t.type === 'suite') walk(t.tasks);
        else if (t.mode !== 'todo') names.push(t.name);
      }
    };
    walk(task.file.tasks);
    const cites = /\((?:SR5|RF) pp?\.\s?\d/;
    const missing = Object.keys(ISSUE_RULES).filter((code) => !names.some((n) => n.startsWith(`${code}: `) && cites.test(n)));
    expect(missing).toEqual([]);
    // A test switched off in the source still counts as collected, and a `-t`
    // run marks the tests it filters out the same way, so the source is read
    // instead: nothing in this file is skipped, made a todo, or run on a condition.
    const source = readFileSync(task.file.filepath, 'utf8');
    const switchedOff = source.match(/\b(?:it|test|describe|suite)\s*\.\s*(?:skip|todo|skipIf|runIf|only)\b/g) ?? [];
    expect(switchedOff).toEqual([]);
  });
});
