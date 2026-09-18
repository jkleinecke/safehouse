/**
 * The builder shell's presentation rules (docs/CHARGEN.md §4.4) as plain
 * functions: which pools the rail lists and when one is over, how issues
 * group, what Next's gate says, which step marks the strip shows and how far
 * a guided jump may go, and which builds a GM is waiting on.
 *
 * Numbers come from the real engine over invented runners wherever the
 * engine is the source; hand-built gates are used only where the rule under
 * test is the shell's own.
 */
import { describe, expect, it } from 'vitest';
import type { Budgets, Issue } from '@safehouse/contracts';
import {
  buildCounts,
  canBuild,
  canReach,
  filterBuilds,
  gatingReason,
  groupIssues,
  isEditableState,
  nextStep,
  poolLabel,
  poolRows,
  previousStep,
  priorityLine,
  reachableStep,
  poolBrief,
  poolTiny,
  stripScrollLeft,
  sortBuilds,
  stepHasContent,
  stepMark,
  stepPoolRows,
  stepReady,
  toStep,
  writableBuild,
  type StepGate,
} from './lib.js';
import { analysisOf, blankBuild, conceptBuild } from './testing.js';

const issue = (over: Partial<Issue>): Issue => ({
  code: 'x',
  severity: 'error',
  step: 1,
  message: 'Something is wrong.',
  ref: { book: 'SR5', page: 62 },
  ...over,
});

const gate = (step: number, complete: boolean, extra: Partial<StepGate> = {}): StepGate => ({
  step,
  complete,
  skipped: false,
  blocking: complete ? [] : [issue({ step, message: `Step ${step} is unfinished.` })],
  warnings: [],
  ...extra,
});

describe('roles and states', () => {
  it('only a GM or a player builds; observers and the table TV do not', () => {
    expect(canBuild('gm')).toBe(true);
    expect(canBuild('player')).toBe(true);
    expect(canBuild('observer')).toBe(false);
    expect(canBuild('display')).toBe(false);
    expect(canBuild(null)).toBe(false);
  });

  it('only draft and returned builds are editable', () => {
    expect(isEditableState('draft')).toBe(true);
    expect(isEditableState('returned')).toBe(true);
    expect(isEditableState('submitted')).toBe(false);
    expect(isEditableState('approved')).toBe(false);
  });

  it('the writable record carries no GM-owned field', () => {
    const w = writableBuild({ ...blankBuild(), approvals: { a: 'approved' }, notes: 'n', returnedStep: 3 }) as Record<string, unknown>;
    expect(Object.keys(w)).not.toEqual(expect.arrayContaining(['approvals']));
    for (const k of ['approvals', 'notes', 'returnedStep', 'state']) expect(w).not.toHaveProperty(k);
  });
});

describe('the rail pools', () => {
  it('lists every core pool on a blank build, and hides pools that do not apply yet', () => {
    const rows = poolRows(analysisOf(blankBuild()).budgets);
    const keys = rows.map((r) => r.key);
    for (const core of ['special', 'attributes', 'skills', 'groups', 'knowledge', 'karma', 'nuyen', 'contactKarma']) {
      expect(keys).toContain(core);
    }
    expect(keys).not.toContain('powerPoints');
    expect(keys).not.toContain('forms');
  });

  it('marks a pool spent past what it holds as over, and says by how much', () => {
    const budgets: Budgets = {
      pools: {
        ...analysisOf(blankBuild()).budgets.pools,
        skills: { available: 28, spent: 31, remaining: -3 },
      },
    };
    const skills = poolRows(budgets).find((r) => r.key === 'skills')!;
    expect(skills.over).toBe(true);
    expect(poolLabel(skills)).toBe('Skill points: 31 of 28 spent, over by 3');
  });

  it('writes nuyen as nuyen', () => {
    const b = conceptBuild('muscle');
    const nuyen = poolRows(analysisOf(b).budgets).find((r) => r.key === 'nuyen')!;
    expect(poolLabel(nuyen)).toMatch(/^Nuyen: [\d,]+¥ of [\d,]+¥ spent/);
  });

  it("a step's pools, in its order, in the phone bar's short form", () => {
    const budgets = analysisOf(conceptBuild('muscle')).budgets;
    const rows = stepPoolRows(budgets, ['skills', 'groups', 'powerPoints']);
    // Power points do not apply to a mundane, so they are left out as on the rail.
    expect(rows.map((r) => r.key)).toEqual(['skills', 'groups']);
    expect(poolBrief({ ...rows[0]!, remaining: 8, over: false })).toBe('Skill points 8 left');
    expect(poolBrief({ ...rows[0]!, remaining: -3, over: true })).toBe('Skill points over by 3');
    expect(poolTiny({ ...rows[0]!, remaining: 8, over: false })).toBe('Skill 8');
    expect(poolTiny({ ...rows[0]!, remaining: -3, over: true })).toBe('Skill −3');
  });

  it('scrolls a sideways strip to centre the current tab, never past either end', () => {
    expect(stripScrollLeft({ left: 600, width: 100 }, { width: 300, scrollWidth: 1000 })).toBe(500);
    expect(stripScrollLeft({ left: 20, width: 100 }, { width: 300, scrollWidth: 1000 })).toBe(0);
    expect(stripScrollLeft({ left: 950, width: 50 }, { width: 300, scrollWidth: 1000 })).toBe(700);
    expect(stripScrollLeft({ left: 100, width: 50 }, { width: 300, scrollWidth: 300 })).toBe(0);
  });
});

describe('issues', () => {
  it('groups by severity and orders each group by step', () => {
    const g = groupIssues([
      issue({ severity: 'warning', step: 7, code: 'w7' }),
      issue({ severity: 'error', step: 6, code: 'e6' }),
      issue({ severity: 'approval', step: 5, code: 'a5' }),
      issue({ severity: 'error', step: 2, code: 'e2' }),
    ]);
    expect(g.error.map((i) => i.code)).toEqual(['e2', 'e6']);
    expect(g.warning.map((i) => i.code)).toEqual(['w7']);
    expect(g.approval.map((i) => i.code)).toEqual(['a5']);
  });
});

describe("Next's gate", () => {
  it('says nothing when the step is complete', () => {
    expect(gatingReason(gate(2, true))).toBeNull();
  });

  it('names the first blocking issue and counts the rest', () => {
    const blank = analysisOf(blankBuild());
    const priorities = blank.steps[1]!;
    expect(priorities.complete).toBe(false);
    expect(gatingReason(priorities)).toMatch(/^Choose a priority for Metatype\. \(and 4 more\)$/);
  });
});

describe('the strip', () => {
  const steps = [gate(1, true), gate(2, true), gate(3, false), gate(4, true, { skipped: true }), gate(5, true), gate(6, false)];

  it('ticks done steps, marks an unfinished step behind the current one as broken', () => {
    expect(stepMark(steps[0]!, 5)).toBe('done');
    expect(stepMark(steps[2]!, 5)).toBe('broken');
    expect(stepMark(steps[3]!, 5)).toBe('skipped');
    expect(stepMark(steps[4]!, 5)).toBe('current');
    expect(stepMark(steps[5]!, 5)).toBe('todo');
  });

  it('with the record: a step ahead is broken when it has content, and ticked only when started', () => {
    const concept = conceptBuild('muscle');
    const blank = blankBuild();
    expect(stepHasContent(concept, 6)).toBe(true);
    expect(stepHasContent(blank, 6)).toBe(false);
    expect(stepHasContent(blank, 1)).toBe(true);
    // Incomplete ahead: broken with content, todo without.
    expect(stepMark(gate(6, false), 2, concept)).toBe('broken');
    expect(stepMark(gate(6, false), 2, blank)).toBe('todo');
    // Complete ahead: done only with content and its priorities chosen.
    expect(stepMark(gate(6, true), 2, concept)).toBe('done');
    expect(stepMark(gate(5, true), 2, blank)).toBe('todo');
    expect(stepReady(blank, 4)).toBe(false);
    expect(stepMark(gate(4, true), 6, blank)).toBe('todo');
    // Behind is still behind.
    expect(stepMark(gate(3, false), 5, blank)).toBe('broken');
  });

  it('guided: back anywhere, forward only as far as the first unfinished step', () => {
    expect(canReach(steps, 1, 2, 'guided')).toBe(true);
    expect(canReach(steps, 3, 2, 'guided')).toBe(true);
    expect(canReach(steps, 4, 2, 'guided')).toBe(false);
    expect(canReach(steps, 6, 2, 'guided')).toBe(false);
  });

  it('free: anywhere', () => {
    expect(canReach(steps, 6, 1, 'free')).toBe(true);
  });

  it('a jump a guided player may not make lands on the first unfinished step in the way', () => {
    expect(reachableStep(steps, 3, 2, 'guided')).toBe(3);
    expect(reachableStep(steps, 1, 2, 'guided')).toBe(1);
    // Step 3 is unfinished: a shortcut to step 6 lands there, past the skipped step 4 too.
    expect(reachableStep(steps, 6, 2, 'guided')).toBe(3);
    expect(reachableStep(steps, 5, 4, 'guided')).toBe(3);
    expect(canReach(steps, reachableStep(steps, 6, 2, 'guided'), 2, 'guided')).toBe(true);
    expect(reachableStep(steps, 6, 1, 'free')).toBe(6);
  });

  it('Back and Next step over a skipped step', () => {
    expect(nextStep(steps, 3)).toBe(5);
    expect(previousStep(steps, 5)).toBe(3);
    expect(previousStep(steps, 1)).toBeNull();
    expect(nextStep(steps, 6)).toBeNull();
  });

  it('clamps anything off a URL into a step', () => {
    expect(toStep('6')).toBe(6);
    expect(toStep('12')).toBe(1);
    expect(toStep('nope', 3)).toBe(3);
  });
});

describe('the build list', () => {
  const row = (id: string, state: 'draft' | 'submitted' | 'returned' | 'approved', updatedAt: string) => ({
    id,
    ownerUserId: 'u',
    state,
    updatedAt,
    build: blankBuild(id),
  });
  const rows = [
    row('old-draft', 'draft', '2026-09-01T00:00:00Z'),
    row('waiting', 'submitted', '2026-09-02T00:00:00Z'),
    row('new-draft', 'draft', '2026-09-10T00:00:00Z'),
    row('done', 'approved', '2026-09-11T00:00:00Z'),
  ];

  it('puts builds waiting on the GM first, then the newest', () => {
    expect(sortBuilds(rows).map((r) => r.id)).toEqual(['waiting', 'new-draft', 'old-draft', 'done']);
  });

  it("the 'waiting for review' filter keeps submitted builds only", () => {
    expect(filterBuilds(rows, 'waiting').map((r) => r.id)).toEqual(['waiting']);
    expect(filterBuilds(rows, 'all')).toHaveLength(4);
  });

  it('counts what waits and what is still being made', () => {
    expect(buildCounts(rows)).toEqual({ waiting: 1, inProgress: 2, approved: 1 });
  });

  it('writes the priority order with a dash for an empty slot', () => {
    expect(priorityLine(blankBuild())).toBe('–/–/–/–/–');
    expect(priorityLine(conceptBuild('muscle'))).toMatch(/^[A-E](\/[A-E]){4}$/);
  });
});
