/**
 * The GM review's decisions as plain functions (docs/CHARGEN.md §4.4 Step 9,
 * §8.5): the items to decide — listed whatever the GM already decided, with
 * the decision — what a decision button writes, Approve's gate as the server
 * refuses, Return's gate, the step a note is pinned to by default, and the
 * choices summarised step by step from the engine's numbers.
 *
 * Invented runners (`../finish/fixtures.ts`) with the validator's real codes.
 */
import { describe, expect, it } from 'vitest';
import { BuildApprovalsSchema, type Issue } from '@safehouse/contracts';
import { SETTINGS, analysisOf, conceptBuild } from '../../testing.js';
import { readyBuild, restrictedCode, withRestricted } from '../finish/fixtures.js';
import {
  approvalItems,
  approveGate,
  decisionCounts,
  decisionWrite,
  defaultReturnStep,
  returnGate,
  returnStepOptions,
  spentLine,
  stepFromOption,
  stepSummaries,
} from './review.js';

const issue = (over: Partial<Issue>): Issue => ({
  code: 'x',
  severity: 'error',
  step: 3,
  message: 'Something is off.',
  ref: { book: 'SR5', page: 66 },
  ...over,
});

describe('approvalItems', () => {
  it('lists every item the rules leave to the GM, open until decided', () => {
    const build = withRestricted();
    const code = restrictedCode(build);
    const items = approvalItems(build, SETTINGS);
    expect(items).toEqual([{ issue: expect.objectContaining({ code, severity: 'approval', step: 7 }), decision: null }]);
    expect(approvalItems(readyBuild(), SETTINGS)).toEqual([]);
  });

  it('keeps a decided item listed with its decision, though the build’s own issues drop or harden it', () => {
    const build = withRestricted();
    const code = restrictedCode(build);
    const approved = { ...build, approvals: { [code]: 'approved' as const } };
    expect(analysisOf(approved).issues.some((i) => i.code === code)).toBe(false);
    expect(approvalItems(approved, SETTINGS)).toEqual([{ issue: expect.objectContaining({ code }), decision: 'approved' }]);

    const denied = { ...build, approvals: { [code]: 'denied' as const } };
    expect(analysisOf(denied).issues.find((i) => i.code === code)?.severity).toBe('error');
    const [item] = approvalItems(denied, SETTINGS);
    expect(item).toMatchObject({ decision: 'denied', issue: { severity: 'approval' } });
    // Its message is the rule's, not the hardened "The GM said no." form.
    expect(item!.issue.message).not.toContain('The GM said no.');
  });

  it('writes a decision, takes the standing one back when it is pressed again, and counts them', () => {
    const [open] = approvalItems(withRestricted(), SETTINGS);
    expect(decisionWrite(open!, 'approved')).toEqual({ [open!.issue.code]: 'approved' });
    // Pressed again: null, which the approvals route reads as undecided.
    expect(decisionWrite({ ...open!, decision: 'approved' }, 'approved')).toEqual({ [open!.issue.code]: null });
    expect(BuildApprovalsSchema.safeParse({ approvals: decisionWrite({ ...open!, decision: 'denied' }, 'denied') }).success).toBe(true);
    expect(decisionWrite({ ...open!, decision: 'approved' }, 'denied')).toEqual({ [open!.issue.code]: 'denied' });
    expect(decisionCounts([open!, { ...open!, decision: 'approved' }, { ...open!, decision: 'denied' }])).toEqual({ approved: 1, denied: 1, open: 1 });
  });
});

describe('approveGate', () => {
  const build = withRestricted();
  const code = restrictedCode(build);

  it('is shut while an item is undecided', () => {
    const a = analysisOf(build);
    const gate = approveGate({ allIssues: a.issues, items: approvalItems(build, SETTINGS), busy: null });
    expect(gate).toMatchObject({ open: false, errors: 0, undecided: 1, reason: '1 item still to decide above before this build can be approved.' });
  });

  it('opens once everything is decided and nothing is wrong', () => {
    const approved = { ...build, approvals: { [code]: 'approved' as const } };
    const gate = approveGate({ allIssues: analysisOf(approved).issues, items: approvalItems(approved, SETTINGS), busy: null });
    expect(gate).toMatchObject({ open: true, reason: null });
    expect(approveGate({ allIssues: [], items: [], busy: 'approve' }).reason).toBe('Approving and creating the character.');
    expect(approveGate({ allIssues: [], items: [], busy: 'return' }).reason).toBe('Another action is still running.');
  });

  it('counts a denied item as something to fix, and says to return the build', () => {
    const denied = { ...build, approvals: { [code]: 'denied' as const } };
    const gate = approveGate({ allIssues: analysisOf(denied).issues, items: approvalItems(denied, SETTINGS), busy: null });
    expect(gate).toMatchObject({ open: false, errors: 1, denied: 1 });
    expect(gate.reason).toBe(
      'This build still has 1 item you denied, so it cannot be approved as it stands. Return it with a note so the player can change it.',
    );
    const both = approveGate({ allIssues: [issue({}), ...analysisOf(denied).issues], items: approvalItems(denied, SETTINGS), busy: null });
    expect(both.reason).toContain('1 thing to fix and 1 item you denied');
    expect(approveGate({ allIssues: [issue({}), issue({})], items: [], busy: null }).reason).toContain('2 things to fix,');
  });
});

describe('returning with notes', () => {
  it('needs a note inside the contract’s length', () => {
    expect(returnGate({ notes: '   ', busy: null })).toEqual({ open: false, reason: 'Write a note first: it is what the player reads when the build reopens.' });
    expect(returnGate({ notes: 'x'.repeat(20_001), busy: null }).open).toBe(false);
    expect(returnGate({ notes: 'Quieter gun, please.', busy: null })).toEqual({ open: true, reason: null });
    expect(returnGate({ notes: 'Quieter gun, please.', busy: 'return' }).reason).toBe('Sending the build back.');
  });

  it('pins the note to the first step with an error by default, or to none', () => {
    expect(defaultReturnStep([issue({ step: 7 }), issue({ step: 5 }), issue({ step: 2, severity: 'approval' })])).toBe(5);
    expect(defaultReturnStep([])).toBeNull();
  });

  it('offers no step or any of the nine, and reads the choice back', () => {
    const options = returnStepOptions();
    expect(options).toHaveLength(10);
    expect(options[0]).toEqual({ value: '', label: 'no particular step' });
    expect(options[7]).toEqual({ value: '7', label: 'Step 7 · Gear' });
    expect(stepFromOption('7')).toBe(7);
    expect(stepFromOption('')).toBeNull();
    expect(stepFromOption('12')).toBeNull();
  });
});

describe('stepSummaries', () => {
  it('reads each step’s key numbers off the record, the budgets and the opening', () => {
    const build = readyBuild();
    const a = analysisOf(build);
    const s = stepSummaries({ build, budgets: a.budgets, steps: a.steps, allIssues: a.issues, opening: a.preview.compiled!.opening });
    expect(s.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(s[0]!.lines).toContain('Alias Kestrel Vane');
    expect(s[1]!.lines[0]).toMatch(/^Metatype [A-E] · Attributes [A-E] · Magic E · Skills [A-E] · Resources [A-E]$/);
    expect(s[2]!.lines).toContain(`${a.budgets.pools.attributes.spent} of ${a.budgets.pools.attributes.available} attribute points spent`);
    expect(s[3]).toMatchObject({ mark: 'skipped', lines: ['Mundane: nothing to choose'] });
    expect(s[4]!.lines[0]).toBe('1 positive quality, 4 of 25 Karma');
    expect(s[6]!.lines).toContain('5,000¥ carries into play');
    expect(s[6]!.lines).toContain('10 Karma converted to nuyen');
    expect(s[7]!.lines).toContain('0 Karma carries into play');
    expect(s[7]!.lines).toContain('2 contacts');
    expect(s[8]!.lines).toEqual(['Background written']);
    expect(s.every((x) => x.mark !== 'todo')).toBe(true);
  });

  it('marks and counts what still blocks a step', () => {
    const build = conceptBuild('muscle');
    const a = analysisOf(build);
    const s = stepSummaries({ build, budgets: a.budgets, steps: a.steps, allIssues: a.issues, opening: null });
    expect(s[7]).toMatchObject({ mark: 'todo', blocking: 1 });
    expect(s[8]).toMatchObject({ mark: 'todo', lines: ['No background written'] });
  });

  it('writes a pool as spent of available, with an overspend in words', () => {
    expect(spentLine('skills', { available: 28, spent: 31, remaining: -3 })).toBe('31 of 28 skill points spent, 3 over');
    expect(spentLine('nuyen', { available: 50_000, spent: 4_000, remaining: 46_000 })).toBe('4,000¥ of 50,000¥ spent');
    expect(spentLine('powerPoints', { available: 0, spent: 0, remaining: 0 })).toBeNull();
    expect(spentLine('groups', undefined)).toBeNull();
  });
});
