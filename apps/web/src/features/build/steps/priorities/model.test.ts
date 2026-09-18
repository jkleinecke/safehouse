/**
 * The Priorities screen's model (docs/CHARGEN.md §4.4 Step 2), tested as
 * functions: what each cell says it buys for the runner in front of it, what
 * a tap would swap, reopen or be refused for, the mundane and concept notes,
 * the method switch and the grid's keys.
 *
 * Builds are made the way the app makes them — `emptyBuild` and the concept
 * cards through `testing.ts` — and every refusal and break is the engine's
 * own probe, so a test here asserts on what the validator really answers.
 * Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { ChargenSettingsSchema, PRIORITY_COLUMNS, type CharacterBuild, type ChargenSettings, type PriorityColumn, type PriorityLevel } from '@safehouse/contracts';
import { METATYPE_BY_ID, PRIORITY_CHARTS, setPriority } from '@safehouse/rules';
import { analyseBuild, type BuildProber } from '../../analysis.js';
import { SETTINGS, analysisOf, blankBuild, conceptBuild } from '../../testing.js';
import {
  applyRows,
  breaksSentence,
  breaksShort,
  cellProbeKey,
  columnTabStop,
  filledSentence,
  gridKeyTarget,
  gridTabStop,
  leanSentence,
  listedIssues,
  magicOffers,
  methodModel,
  methodSwitchPlan,
  methodSwitchSentence,
  mundaneSentence,
  offerSentence,
  pickRow,
  prioritiesModel,
  swapSentence,
  switchMethod,
  type PrioritiesModel,
} from './model.js';

const SUM_TO_TEN_SETTINGS: ChargenSettings = ChargenSettingsSchema.parse({ allowSumToTen: true });

function cell(model: PrioritiesModel, column: PriorityColumn, level: PriorityLevel) {
  const found = model.columns.find((c) => c.column === column)?.cells.find((c) => c.level === level);
  if (!found) throw new Error(`no cell ${column} ${level}`);
  return found;
}

function modelOf(build: CharacterBuild, settings: ChargenSettings = SETTINGS, withProbe = true): PrioritiesModel {
  const a = analyseBuild(build, settings);
  return prioritiesModel({ build, settings, probe: withProbe ? a.probe : undefined, allIssues: a.issues });
}

function withRows(build: CharacterBuild, rows: Partial<Record<PriorityColumn, PriorityLevel | null>>): CharacterBuild {
  return { ...build, priorities: { ...build.priorities, ...rows } };
}

const sumToTen = (rows: Record<PriorityColumn, PriorityLevel | null>): CharacterBuild => ({
  ...blankBuild(),
  method: 'sumToTen',
  priorities: rows,
});

describe('what each cell buys', () => {
  it('a blank build: every metatype on the row, and which ones the row shuts out', () => {
    const m = modelOf(blankBuild());
    expect(m.lean).toBeNull();
    expect(m.filled).toBe(0);
    expect(cell(m, 'metatype', 'A').figure).toBe('Human 9 · Elf 8 · Dwarf 7 · Ork 7 · Troll 5');
    expect(cell(m, 'metatype', 'A').notes).toEqual([]);
    expect(cell(m, 'metatype', 'C').notes).toEqual(['not on this row: Troll']);
    expect(cell(m, 'metatype', 'E').figure).toBe('Human 1');
    expect(cell(m, 'metatype', 'E').detail).toEqual(['Not on this row: Elf, Dwarf, Ork and Troll.']);
    expect(m.columns[0]!.note).toBe('special points for each metatype');
  });

  it('attributes, skills and resources read the campaign’s chart and level', () => {
    const m = modelOf(blankBuild());
    const chart = PRIORITY_CHARTS[SETTINGS.table];
    expect(cell(m, 'attributes', 'B').figure).toBe(`${chart.B.attributes} attribute points`);
    expect(cell(m, 'skills', 'C').figure).toBe(`${chart.C.skills.points} skill points`);
    expect(cell(m, 'skills', 'C').notes).toEqual([`${chart.C.skills.groupPoints} group points`]);
    expect(cell(m, 'resources', 'A').figure).toBe('450,000¥');
    expect(m.columns.find((c) => c.column === 'resources')!.note).toBe('nuyen at the experienced level');

    const street = ChargenSettingsSchema.parse({ level: 'street' });
    const s = prioritiesModel({ build: blankBuild(), settings: street });
    expect(s.levelWord).toBe('street');
    expect(cell(s, 'resources', 'A').figure).toBe('75,000¥');
    expect(s.columns.find((c) => c.column === 'resources')!.note).toBe('nuyen at the street level');
  });

  it('magic: the kinds a row offers and their grants, the shared caster cell folded once', () => {
    const m = modelOf(blankBuild());
    const a = cell(m, 'magic', 'A');
    expect(a.figure).toBe('Magic 6 or Resonance 6');
    expect(a.notes).toEqual(['magician, mystic adept, technomancer']);
    expect(a.detail[0]).toBe('Magician or mystic adept: Magic 6, 2 magical skills at rating 5, 10 spells, rituals or preparations.');
    expect(a.detail).toHaveLength(2);
    expect(cell(m, 'magic', 'B').figure).toBe('Magic 4–6 or Resonance 4');
    expect(cell(m, 'magic', 'D').detail).toEqual(['Adept or aspected magician: Magic 2.']);
    expect(cell(m, 'magic', 'E')).toMatchObject({ figure: 'No Magic or Resonance', notes: [], detail: [] });
    expect(magicOffers(PRIORITY_CHARTS.sr5.C).map(offerSentence)).toContain('Adept: Magic 4, 1 active skill at rating 2');
    expect(m.columns.find((c) => c.column === 'magic')!.note).toBe('every kind the row offers');
  });

  it('magic: a chosen kind reads its own grant, and a row without it says so', () => {
    const m = modelOf(conceptBuild('adept'));
    expect(cell(m, 'magic', 'B')).toMatchObject({ figure: 'Adept: Magic 6', notes: ['1 active skill at rating 4'] });
    expect(cell(m, 'magic', 'A').figure).toBe('No adept on this row');
    expect(m.columns.find((c) => c.column === 'magic')!.note).toBe('for an adept');
  });

  it('metatype cells speak for the chosen metatype, or the card’s suggestion when none is chosen', () => {
    const face = conceptBuild('face');
    const m = modelOf(face);
    expect(m.lean).toMatchObject({ source: 'chosen', row: { id: 'elf' } });
    expect(cell(m, 'metatype', 'C').figure).toBe('Elf: 3 special points');
    expect(cell(m, 'metatype', 'C').notes).toEqual(['not on this row: Troll']);
    expect(cell(m, 'metatype', 'E').figure).toBe('No Elf on this row');
    expect(cell(m, 'metatype', 'E').detail[0]).toBe('Special points here: Human 1.');
    expect(leanSentence(m.lean, m.concept)).toBe('Metatype cells show special points for Elf, the metatype chosen in step 3.');

    const leaning = prioritiesModel({ build: { ...face, metatype: null }, settings: SETTINGS });
    expect(leaning.lean).toMatchObject({ source: 'concept', row: { id: 'elf' } });
    expect(leanSentence(leaning.lean, leaning.concept)).toContain('the Back-room face card');
    expect(leanSentence(null, null)).toContain('all five');
  });

  it('a metavariant’s cell carries the Karma it costs, read off its own chart', () => {
    const m = prioritiesModel({ build: { ...blankBuild(), metatype: 'wakyambi' }, settings: SETTINGS });
    const a = cell(m, 'metatype', 'A');
    const own = METATYPE_BY_ID.wakyambi.priority.A!;
    expect(own.karma).toBeGreaterThan(0);
    expect(a.figure).toBe(`Wakyambi: ${own.special} special points, costs ${own.karma} Karma`);
  });
});

describe('what a tap would do', () => {
  it('under the priority table a taken row swaps with the column holding it', () => {
    const face = conceptBuild('face'); // C/B/E/A/D
    const m = modelOf(face);
    expect(cell(m, 'metatype', 'C').swap).toBeNull(); // chosen
    const b = cell(m, 'metatype', 'B');
    expect(b.swap).toEqual({ column: 'attributes', takes: 'C' });
    expect(swapSentence(b.swap!)).toBe('swaps with Attributes, which takes C');
    expect(swapSentence({ column: 'skills', takes: null })).toBe('takes it from Skills, which is left empty');
    expect(b.cost).toBeNull();
    // The tap is the same updater.
    const next = pickRow('metatype', 'B')(face);
    expect(next.priorities).toMatchObject({ metatype: 'B', attributes: 'C' });
  });

  it('a swap that breaks a spend already made on a later step says which step, before the tap', () => {
    const m = modelOf(conceptBuild('face'));
    const skillsC = cell(m, 'skills', 'C');
    expect(skillsC.refusal).toBeNull();
    expect(skillsC.breaks?.steps).toContain(6);
    expect(breaksShort(skillsC.breaks!)).toMatch(/^reopens steps? /);
    expect(breaksSentence(skillsC.breaks!)).toMatch(/^Reopens steps? [\d, and]+: .+/);
    expect(skillsC.breaks!.first.step).toBeGreaterThan(2);
  });

  it('says before the tap that a mundane would pay for a Magic row it gets nothing from', () => {
    const m = modelOf(conceptBuild('face')); // mundane, Magic at E
    const magicC = cell(m, 'magic', 'C');
    expect(magicC.unused?.code).toBe('magic-priority-unused');
    expect(magicC.unused?.message).toContain('Magic priority C');
    expect(magicC.refusal).toBeNull();
    // Under the table, a take that swaps Magic off E says it on the other column's cell too.
    const skillsE = cell(m, 'skills', 'E');
    expect(skillsE.swap?.column).toBe('magic');
    expect(skillsE.unused?.code).toBe('magic-priority-unused');
    // Keeping Magic at E says nothing; nor does a runner who uses magic.
    expect(cell(m, 'metatype', 'B').unused).toBeNull();
    for (const column of modelOf(conceptBuild('street-mage')).columns) for (const c of column.cells) expect(c.unused, `${c.column} ${c.level}`).toBeNull();
  });

  it('a swap on a build with nothing spent later reopens nothing', () => {
    const rows = applyRows({ metatype: 'C', attributes: 'B', magic: 'E', skills: 'A', resources: 'D' })(blankBuild());
    const m = modelOf(rows);
    for (const column of m.columns) for (const c of column.cells) expect(c.breaks, `${c.column} ${c.level}`).toBeNull();
  });

  it('probes each unchosen cell once, under a stable key', () => {
    const face = conceptBuild('face');
    const a = analysisOf(face);
    const keys: string[] = [];
    const counting: BuildProber = (fn, key) => {
      keys.push(key ?? '(none)');
      return a.probe(fn, key);
    };
    prioritiesModel({ build: face, settings: SETTINGS, probe: counting, allIssues: a.issues });
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect(keys).toContain(cellProbeKey('skills', 'C'));
    expect(keys).not.toContain(cellProbeKey('skills', 'A')); // the chosen row
  });

  it('without a prober (read-only) nothing is refused or marked', () => {
    const m = modelOf(conceptBuild('face'), SETTINGS, false);
    for (const column of m.columns) for (const c of column.cells) expect([c.refusal, c.breaks]).toEqual([null, null]);
  });
});

describe('Sum to Ten', () => {
  it('rows may repeat, each costs points, and a raise past ten is refused with the validator’s sentence', () => {
    const build = sumToTen({ metatype: 'A', attributes: 'B', magic: 'C', skills: 'D', resources: 'E' }); // 10
    const m = modelOf(build, SUM_TO_TEN_SETTINGS);
    expect(m.costs).toEqual({ A: 4, B: 3, C: 2, D: 1, E: 0 });
    const raise = cell(m, 'resources', 'D');
    expect(raise.cost).toBe(1);
    expect(raise.swap).toBeNull();
    expect(raise.refusal?.reason).toBe('The priorities cost 11 points; Sum to Ten allows 10.');
    expect(raise.refusal?.ref).toEqual({ book: 'RF', page: 62 });
    // Lowering is never refused, and a repeat is allowed.
    expect(cell(m, 'metatype', 'B').refusal).toBeNull();
    expect(cell(m, 'metatype', 'E').refusal).toBeNull();
    const repeated = pickRow('metatype', 'E')(build);
    expect(repeated.priorities).toMatchObject({ metatype: 'E', resources: 'E' });
  });

  it('a record already over refuses every raise, and still lets a row come down', () => {
    const build = sumToTen({ metatype: 'A', attributes: 'A', magic: 'A', skills: 'B', resources: 'E' }); // 15
    const m = modelOf(build, SUM_TO_TEN_SETTINGS);
    expect(cell(m, 'resources', 'D').refusal?.reason).toMatch(/Sum to Ten allows 10/);
    expect(cell(m, 'skills', 'A').refusal).not.toBeNull();
    expect(cell(m, 'skills', 'C').refusal).toBeNull();
    expect(cell(m, 'metatype', 'B').refusal).toBeNull();
  });

  it('an unset column may take a free row when the points are spent', () => {
    const build = sumToTen({ metatype: 'A', attributes: 'A', magic: 'B', skills: null, resources: null }); // 11
    const m = modelOf(build, SUM_TO_TEN_SETTINGS);
    expect(cell(m, 'skills', 'E').refusal).toBeNull();
    expect(cell(m, 'skills', 'D').refusal).not.toBeNull();
  });
});

describe('the notes around the table', () => {
  it('a mundane card with Magic at E says why it sits there', () => {
    const m = modelOf(conceptBuild('face'));
    expect(m.mundane).toEqual({ kind: 'concept', title: 'Back-room face', sumToTen: false });
    expect(mundaneSentence(m.mundane!)).toMatch(/^Back-room face is mundane, so Magic or Resonance sits at E/);
    expect(mundaneSentence({ kind: 'concept', title: 'Back-room face', sumToTen: true })).toContain('costs no points');
  });

  it('a mundane build paying for a Magic row hears the engine’s warning, and what to do', () => {
    const build = setPriority(conceptBuild('face'), 'magic', 'B');
    const m = modelOf(build);
    expect(m.mundane?.kind).toBe('unused');
    const sentence = mundaneSentence(m.mundane!);
    expect(sentence).toContain('Magic priority B is spent on a mundane.');
    expect(sentence).toContain('step 4');
  });

  it('an Awakened card has no mundane note', () => {
    expect(modelOf(conceptBuild('adept')).mundane).toBeNull();
  });

  it('a card’s rows: matched, shuffled, and put back through the same swap', () => {
    const face = conceptBuild('face');
    expect(modelOf(face).concept).toMatchObject({ title: 'Back-room face', line: 'C/B/E/A/D', matches: true });
    const shuffled = pickRow('skills', 'E')(pickRow('metatype', 'A')(face));
    const m = modelOf(shuffled);
    expect(m.concept?.matches).toBe(false);
    const restored = applyRows(m.concept!.rows)(shuffled);
    expect(restored.priorities).toEqual(face.priorities);
    expect(modelOf(blankBuild()).concept).toBeNull();
  });

  it('counts the columns that have a row', () => {
    const partly = withRows(conceptBuild('face'), { skills: null, resources: null });
    expect(modelOf(partly).filled).toBe(3);
    expect(filledSentence(3)).toBe('3 of 5 columns have a row; each needs one before the next step.');
    expect(filledSentence(5)).toBe('All five columns have a row.');
  });

  it('lists this step’s issues but not the ones the screen already shows', () => {
    const over = sumToTen({ metatype: 'A', attributes: 'A', magic: 'A', skills: null, resources: null });
    const issues = analyseBuild(over, SETTINGS).issues.filter((i) => i.step === 2);
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['priority-unset', 'method-not-allowed', 'sum-to-ten-over']));
    expect(listedIssues(issues).map((i) => i.code)).toEqual(['sum-to-ten-over']);
  });
});

describe('the method', () => {
  it('is offered only where the campaign allows Sum to Ten, or the build already uses it', () => {
    const face = conceptBuild('face');
    expect(methodModel(face, SETTINGS, []).shown).toBe(false);
    const allowed = methodModel(face, SUM_TO_TEN_SETTINGS, []);
    expect(allowed).toMatchObject({ shown: true, current: 'priority', target: 'sumToTen', canSwitch: true, notAllowed: null });
    expect(methodSwitchSentence(allowed.plan)).toContain('The rows you have now stay where they are.');

    const stuck = sumToTen({ metatype: 'A', attributes: 'B', magic: 'C', skills: 'D', resources: 'E' });
    const off = methodModel(stuck, SETTINGS, analyseBuild(stuck, SETTINGS).issues);
    expect(off).toMatchObject({ shown: true, current: 'sumToTen', target: 'priority', canSwitch: true });
    expect(off.notAllowed?.message).toBe('This campaign does not use Sum to Ten.');
  });

  it('switching back to the table names the columns a repeat empties', () => {
    const repeats = sumToTen({ metatype: 'B', attributes: 'B', magic: 'E', skills: 'B', resources: 'E' });
    const plan = methodSwitchPlan(repeats, 'priority');
    expect(plan.emptied).toEqual(['attributes', 'skills', 'resources']);
    expect(methodSwitchSentence(plan)).toBe(
      'The priority table uses each row once, so Attributes, Skills and Resources repeat a row and are left empty to choose again.',
    );
    const back = switchMethod('priority')(repeats);
    expect(back.method).toBe('priority');
    expect(PRIORITY_COLUMNS.filter((c) => back.priorities[c] === null)).toEqual(plan.emptied);
    const one = methodSwitchPlan(sumToTen({ metatype: 'A', attributes: 'A', magic: 'C', skills: 'D', resources: 'E' }), 'priority');
    expect(methodSwitchSentence(one)).toContain('Attributes repeats a row and is left empty');
  });
});

describe('keys', () => {
  it('arrows move a cell at a time without wrapping; Home and End go to the row’s ends, with Ctrl to the corners', () => {
    expect(gridKeyTarget(5, 5, { row: 0, col: 0 }, 'ArrowRight')).toEqual({ row: 0, col: 1 });
    expect(gridKeyTarget(5, 5, { row: 0, col: 4 }, 'ArrowRight')).toEqual({ row: 0, col: 4 });
    expect(gridKeyTarget(5, 5, { row: 4, col: 2 }, 'ArrowDown')).toEqual({ row: 4, col: 2 });
    expect(gridKeyTarget(5, 5, { row: 2, col: 2 }, 'ArrowUp')).toEqual({ row: 1, col: 2 });
    expect(gridKeyTarget(5, 5, { row: 2, col: 2 }, 'Home')).toEqual({ row: 2, col: 0 });
    expect(gridKeyTarget(5, 5, { row: 2, col: 2 }, 'End', true)).toEqual({ row: 4, col: 4 });
    expect(gridKeyTarget(5, 5, { row: 2, col: 2 }, 'Enter')).toBeNull();
  });

  it('one tab stop: the first chosen row, else the top-left cell; a column’s own row, else A', () => {
    const face = modelOf(conceptBuild('face'), SETTINGS, false);
    expect(gridTabStop(face.columns)).toEqual({ row: 2, col: 0 }); // metatype C
    expect(gridTabStop(modelOf(blankBuild(), SETTINGS, false).columns)).toEqual({ row: 0, col: 0 });
    expect(gridTabStop([{ level: null }, { level: 'D' }])).toEqual({ row: 3, col: 1 });
    expect(columnTabStop({ level: 'E' })).toBe(4);
    expect(columnTabStop({ level: null })).toBe(0);
  });
});
