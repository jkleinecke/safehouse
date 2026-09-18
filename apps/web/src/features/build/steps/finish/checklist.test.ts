/**
 * The Finish step's decisions as plain functions (docs/CHARGEN.md §4.4 Step
 * 9, §8.6): which face the screen shows, the checklist's ticks and crosses
 * over the engine's real step statuses, where a cross sends the player,
 * Submit's gate and its sentence, the background updater, and where the
 * server's check and this page's disagree.
 *
 * Builds are invented runners made the way the app makes them (`fixtures.ts`),
 * so the ticks are what the engine really answers.
 */
import { describe, expect, it } from 'vitest';
import type { Issue } from '@safehouse/contracts';
import { analysisOf, blankBuild, conceptBuild } from '../../testing.js';
import { inertActions } from '../types.js';
import {
  BACKGROUND_MAX,
  backgroundOf,
  checkFace,
  checklistCount,
  checklistLines,
  compareIssues,
  crossNote,
  finishPhase,
  firstErrorStep,
  sheetHref,
  submitGate,
  withBackground,
} from './checklist.js';
import { readyBuild, withRestricted } from './fixtures.js';

const issue = (over: Partial<Issue>): Issue => ({
  code: 'x',
  severity: 'error',
  step: 3,
  message: 'Something is off.',
  ref: { book: 'SR5', page: 66 },
  ...over,
});

describe('finishPhase', () => {
  it('shows edit for a draft or a returned build, submitted, approved, and review for the GM', () => {
    expect(finishPhase('draft', false)).toBe('edit');
    expect(finishPhase('returned', false)).toBe('edit');
    expect(finishPhase('submitted', false)).toBe('submitted');
    expect(finishPhase('approved', false)).toBe('approved');
    expect(finishPhase('submitted', true)).toBe('review');
  });
});

describe('checklistLines', () => {
  it('ticks every line of a finished runner, skipping a mundane’s magic step', () => {
    const build = readyBuild();
    const a = analysisOf(build);
    const lines = checklistLines(build, a.steps, a.issues);
    expect(lines.map((l) => l.mark)).toEqual(['done', 'done', 'done', 'skipped', 'done', 'done', 'done', 'done', 'done']);
    expect(lines.every((l) => l.fixAt === null)).toBe(true);
    expect(checklistCount(lines)).toEqual({ done: 9, total: 9 });
  });

  it("crosses a line with the engine's own findings and sends the cross to its step", () => {
    const build = conceptBuild('muscle');
    const a = analysisOf(build);
    const lines = checklistLines(build, a.steps, a.issues);
    const karma = lines[7]!;
    expect(karma.mark).toBe('todo');
    expect(karma.blocking.map((i) => i.code)).toEqual(['karma-carry-over']);
    expect(karma.fixAt).toBe(8);
    // The last line is the whole build, and sends the player to the first error.
    const last = lines[8]!;
    expect(last.mark).toBe('todo');
    expect(last.errorCount).toBe(1);
    expect(last.fixAt).toBe(8);
    expect(crossNote(last)).toBe('1 thing still to fix, listed on the lines above.');
    expect(checklistCount(lines).done).toBe(7);
  });

  it('does not tick a step whose priority row is not chosen, and sends it to the priorities', () => {
    const build = blankBuild();
    const a = analysisOf(build);
    const lines = checklistLines(build, a.steps, a.issues);
    const magic = lines[3]!;
    expect(magic.mark).toBe('todo');
    expect(magic.blocking).toEqual([]);
    expect(magic.fixAt).toBe(2);
    expect(crossNote(magic)).toBe('Waits on the priority rows, chosen in step 2.');
  });

  it('counts approvals and warnings on their line but never crosses it for them', () => {
    const build = withRestricted();
    const a = analysisOf(build);
    const gear = checklistLines(build, a.steps, a.issues)[6]!;
    expect(gear.mark).toBe('done');
    expect(gear.approvals).toHaveLength(1);
    expect(gear.warnings.length).toBeGreaterThan(0);
    expect(crossNote(gear)).toBeNull();
  });
});

describe('firstErrorStep', () => {
  it('names the earliest step with an error, ignoring warnings', () => {
    expect(firstErrorStep([issue({ step: 6 }), issue({ step: 2, severity: 'warning' }), issue({ step: 4 })])).toBe(4);
    expect(firstErrorStep([issue({ severity: 'approval' })])).toBeNull();
  });
});

describe('submitGate', () => {
  const base = { state: 'draft' as const, readOnly: false, reviewMode: false, isOwner: true, busy: null };

  it('is shut while errors remain, with the count as the sentence', () => {
    const gate = submitGate({ ...base, allIssues: [issue({}), issue({ step: 6 }), issue({ severity: 'approval' })] });
    expect(gate).toMatchObject({ show: true, open: false, errors: 2, approvals: 1, reason: '2 things to fix before this can go to the GM.' });
    expect(submitGate({ ...base, allIssues: [issue({})] }).reason).toBe('1 thing to fix before this can go to the GM.');
  });

  it('opens with only warnings and approvals left', () => {
    const gate = submitGate({ ...base, allIssues: [issue({ severity: 'warning' }), issue({ severity: 'approval' })] });
    expect(gate).toMatchObject({ show: true, open: true, reason: null, label: 'submit for approval' });
  });

  it('says it is sending while the submit runs, and waits for any other action', () => {
    expect(submitGate({ ...base, allIssues: [], busy: 'submit' })).toMatchObject({ open: false, reason: 'Sending the build to the GM.', label: 'submitting…' });
    expect(submitGate({ ...base, allIssues: [], busy: 'delete' }).reason).toBe('Another action is still running.');
  });

  it('is offered only where the build can still change and this device writes it', () => {
    expect(submitGate({ ...base, allIssues: [], readOnly: true }).show).toBe(false);
    expect(submitGate({ ...base, allIssues: [], state: 'submitted' }).show).toBe(false);
    expect(submitGate({ ...base, allIssues: [], reviewMode: true }).show).toBe(false);
    expect(submitGate({ ...base, allIssues: [], state: 'returned' }).label).toBe('submit again');
    // Submit is the owner's on the server: a GM editing a player's draft is offered none.
    expect(submitGate({ ...base, allIssues: [], isOwner: false })).toMatchObject({ show: false, open: false });
  });
});

describe('the background', () => {
  it('is written through a pure updater and read back as the box shows it', () => {
    const build = blankBuild();
    const next = withBackground(build, 'Raised by a salvage crew.');
    expect(next).not.toBe(build);
    expect(build.identity.background).toBeUndefined();
    expect(backgroundOf(next)).toBe('Raised by a salvage crew.');
    expect(next.identity.alias).toBe(build.identity.alias);
    expect(backgroundOf(build)).toBe('');
    expect(BACKGROUND_MAX).toBe(20_000);
  });
});

describe("the server's check beside this page's", () => {
  it('matches findings by severity, code, step and field, not by wording, one for one', () => {
    const local = [issue({ code: 'a' }), issue({ code: 'a' }), issue({ code: 'b', path: 'skills.active.0' })];
    const server = [issue({ code: 'a', message: 'Worded differently.' }), issue({ code: 'b', path: 'skills.active.1' }), issue({ code: 'c' })];
    const diff = compareIssues(local, server);
    expect(diff.same).toBe(false);
    expect(diff.onlyServer.map((i) => `${i.code}|${i.path ?? ''}`)).toEqual(['b|skills.active.1', 'c|']);
    expect(diff.onlyLocal.map((i) => `${i.code}|${i.path ?? ''}`)).toEqual(['a|', 'b|skills.active.0']);
    expect(compareIssues(local, local).same).toBe(true);
  });

  it('shows idle, loading, error, agrees and differs — and keeps an answer on screen while refetching', () => {
    const a = analysisOf(readyBuild());
    const idle = inertActions().check;
    expect(checkFace(idle, a.issues).face).toBe('idle');
    expect(checkFace({ ...idle, loading: true }, a.issues).face).toBe('loading');
    expect(checkFace({ ...idle, error: 'host unreachable' }, a.issues).face).toBe('error');
    const data = { budgets: a.budgets, issues: a.issues, sheet: a.preview.compiled!.sheet };
    expect(checkFace({ ...idle, data }, a.issues).face).toBe('agrees');
    expect(checkFace({ ...idle, data, loading: true }, a.issues).face).toBe('agrees');
    const differs = checkFace({ ...idle, data: { ...data, issues: [...a.issues, issue({ code: 'server-only' })] } }, a.issues);
    expect(differs.face).toBe('differs');
    expect(differs.diff?.onlyServer.map((i) => i.code)).toEqual(['server-only']);
  });
});

describe('sheetHref', () => {
  it("is the sheet route's shape", () => {
    expect(sheetHref('c1', 'char-9')).toBe('/c/c1/sheet/char-9');
  });
});
