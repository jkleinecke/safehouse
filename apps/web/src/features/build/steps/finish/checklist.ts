/**
 * What the Finish screen decides before it draws anything (FR3.9,
 * docs/CHARGEN.md §4.4 Step 9): the creation checklist's lines, whether
 * Submit is open and why not, which of the four faces the screen shows, and
 * where the server's check disagrees with this page's.
 *
 * The book closes creation with a checklist (p. 101), and §4.2 already made
 * that checklist the validator's job list. So a line here is never a second
 * copy of a rule: it is one walkthrough step, ticked when the engine's
 * `stepStatus` has nothing blocking it and crossed with the engine's own
 * sentences when it has. The only words this file adds are our one-line
 * summary of what each step is checked for. The last line is the whole build
 * — nothing left to fix anywhere — because that, not step 9 on its own, is
 * what Submit waits on.
 *
 * Presentation rules only, so they are plain functions a node test calls
 * directly (under `renderToStaticMarkup` nothing interactive runs). No JSX,
 * no network, no book text (DESIGN.md §14).
 */
import type { BuildState, BuildStep, CharacterBuild, Issue } from '@safehouse/contracts';
import type { StepStatus } from '@safehouse/rules';
import { isEditableState, stepReady } from '../../lib.js';
import type { BuildActions } from '../types.js';

// ---------------------------------------------------------------------------
// The four faces of the screen
// ---------------------------------------------------------------------------

/**
 * - `edit` — a draft or a returned build: the checklist, the background box
 *   and Submit (read only for someone who cannot write it).
 * - `submitted` — frozen, waiting on the GM; said plainly, with what happens next.
 * - `review` — the GM on a submitted build (`steps/review/`).
 * - `approved` — history now; the way to the character it became.
 */
export type FinishPhase = 'edit' | 'submitted' | 'review' | 'approved';

export function finishPhase(state: BuildState, reviewMode: boolean): FinishPhase {
  if (reviewMode) return 'review';
  if (state === 'approved') return 'approved';
  if (state === 'submitted') return 'submitted';
  return 'edit';
}

// ---------------------------------------------------------------------------
// The checklist
// ---------------------------------------------------------------------------

/** Our one-line summary of what each step is checked for — not the book's wording. */
export const CHECK_WORDS: Readonly<Record<number, string>> = {
  1: 'An alias for the runner',
  2: 'A row for each of the five columns, each row used once',
  3: 'A metatype, and every attribute point spent',
  4: 'Magic or Resonance chosen, and every grant filled or waived',
  5: 'Positive and negative qualities inside their Karma caps',
  6: 'Every skill, group and knowledge point spent',
  7: 'Nuyen inside the budget, gear inside the caps, a lifestyle kept',
  8: 'Karma spent down to what carries, contacts inside their limits',
  9: 'Nothing left to fix anywhere in the build',
};

export type CheckMark = 'done' | 'todo' | 'skipped';

export interface CheckLine {
  step: BuildStep;
  /** Our summary of what is checked. */
  check: string;
  mark: CheckMark;
  /** The engine's findings that cross this line, in its words. */
  blocking: readonly Issue[];
  /** Worth a look; never crosses a line. */
  warnings: readonly Issue[];
  /** Waiting on the GM's decision; never crosses a line. */
  approvals: readonly Issue[];
  /**
   * Where the cross sends the player: the line's own step, except the last
   * line (the whole build), which sends them to the first step with an error
   * — and a step whose priority row is not chosen yet, which sends them to
   * the priorities. Null on a ticked line.
   */
  fixAt: BuildStep | null;
  /** How many errors the whole build has (the last line's count). */
  errorCount: number;
}

/**
 * The checklist over the engine's step statuses: one line per step. A step
 * with nothing blocking is only ticked once the priority row its pools come
 * from is chosen (`stepReady`) — an empty Magic step on a build with no
 * priorities has nothing wrong with it only because it has nothing in it.
 */
export function checklistLines(
  build: Pick<CharacterBuild, 'priorities'>,
  steps: readonly StepStatus[],
  allIssues: readonly Issue[],
): CheckLine[] {
  const errors = allIssues.filter((i) => i.severity === 'error');
  const firstError = firstErrorStep(allIssues);
  return steps.map((status) => {
    const last = status.step === steps.length;
    const warnings = status.warnings.filter((i) => i.severity === 'warning');
    const approvals = status.warnings.filter((i) => i.severity === 'approval');
    if (last) {
      const done = errors.length === 0;
      return {
        step: status.step,
        check: CHECK_WORDS[status.step] ?? '',
        mark: done ? 'done' : 'todo',
        blocking: [],
        warnings,
        approvals,
        fixAt: done ? null : firstError,
        errorCount: errors.length,
      };
    }
    const ready = stepReady(build, status.step);
    const mark: CheckMark = status.skipped ? 'skipped' : status.complete && ready ? 'done' : 'todo';
    return {
      step: status.step,
      check: CHECK_WORDS[status.step] ?? '',
      mark,
      blocking: mark === 'todo' ? status.blocking : [],
      warnings,
      approvals,
      fixAt: mark !== 'todo' ? null : status.complete && !ready ? 2 : status.step,
      errorCount: errors.length,
    };
  });
}

/** The walkthrough step of the build's first error, or null when there is none. */
export function firstErrorStep(issues: readonly Issue[]): BuildStep | null {
  return issues
    .filter((i) => i.severity === 'error')
    .reduce<BuildStep | null>((min, i) => (min === null || i.step < min ? i.step : min), null);
}

/** "6 of 9 done" — skipped lines count as done; there was nothing to do. */
export function checklistCount(lines: readonly CheckLine[]): { done: number; total: number } {
  return { done: lines.filter((l) => l.mark !== 'todo').length, total: lines.length };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a crossed line says beside its button when it carries no finding of its own. */
export function crossNote(line: CheckLine): string | null {
  if (line.mark !== 'todo' || line.blocking.length > 0) return null;
  if (line.step === 9) return `${plural(line.errorCount, 'thing', 'things')} still to fix, listed on the lines above.`;
  if (line.fixAt === 2) return 'Waits on the priority rows, chosen in step 2.';
  return 'Not finished yet.';
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitGate {
  /** Whether this device offers Submit at all (an owner on a draft or returned build). */
  show: boolean;
  /** Whether pressing it goes. */
  open: boolean;
  errors: number;
  approvals: number;
  warnings: number;
  /** Why it is shut, in a sentence; null when open. */
  reason: string | null;
  label: string;
}

/**
 * Submit's gate: shown only to the build's owner (the server refuses anyone
 * else, so a GM editing a player's draft is not offered a button that can
 * only fail), where the build can still change and this device may write it;
 * shut while any error remains anywhere (the count is the sentence), or while
 * another action is running. Warnings and approvals are counted for the
 * player but never stop them — the approvals are the GM's.
 */
export function submitGate(input: {
  state: BuildState;
  readOnly: boolean;
  reviewMode: boolean;
  isOwner: boolean;
  allIssues: readonly Issue[];
  busy: BuildActions['busy'];
}): SubmitGate {
  const { state, readOnly, reviewMode, isOwner, allIssues, busy } = input;
  const errors = allIssues.filter((i) => i.severity === 'error').length;
  const approvals = allIssues.filter((i) => i.severity === 'approval').length;
  const warnings = allIssues.filter((i) => i.severity === 'warning').length;
  const show = isOwner && !reviewMode && !readOnly && isEditableState(state);
  const reason =
    errors > 0
      ? `${plural(errors, 'thing', 'things')} to fix before this can go to the GM.`
      : busy === 'submit'
        ? 'Sending the build to the GM.'
        : busy !== null
          ? 'Another action is still running.'
          : null;
  return {
    show,
    open: show && reason === null,
    errors,
    approvals,
    warnings,
    reason,
    label: busy === 'submit' ? 'submitting…' : state === 'returned' ? 'submit again' : 'submit for approval',
  };
}

/** The pure updater the background box sends through `update`. */
export function withBackground(build: CharacterBuild, text: string): CharacterBuild {
  return { ...build, identity: { ...build.identity, background: text } };
}

/** The record's background, as the box shows it. */
export function backgroundOf(build: Pick<CharacterBuild, 'identity'>): string {
  return build.identity.background ?? '';
}

/** The contract's limit on a background (`LongText`). */
export const BACKGROUND_MAX = 20_000;

// ---------------------------------------------------------------------------
// The server's check beside this page's
// ---------------------------------------------------------------------------

const issueKey = (i: Issue): string => `${i.severity}|${i.code}|${i.step}|${i.path ?? ''}`;

/** Every issue in `a` not matched one-for-one in `b`, in `a`'s order. */
function without(a: readonly Issue[], b: readonly Issue[]): Issue[] {
  const counts = new Map<string, number>();
  for (const i of b) counts.set(issueKey(i), (counts.get(issueKey(i)) ?? 0) + 1);
  const out: Issue[] = [];
  for (const i of a) {
    const n = counts.get(issueKey(i)) ?? 0;
    if (n > 0) counts.set(issueKey(i), n - 1);
    else out.push(i);
  }
  return out;
}

export interface IssueDiff {
  /** Findings the server has that this page does not. */
  onlyServer: Issue[];
  /** Findings this page has that the server does not. */
  onlyLocal: Issue[];
  same: boolean;
}

/**
 * Where the server's check and this page's disagree, matched by severity,
 * code, step and field. Messages are not compared: they are words, and the
 * two engines may be a release apart in wording while agreeing on the rule.
 */
export function compareIssues(local: readonly Issue[], server: readonly Issue[]): IssueDiff {
  const onlyServer = without(server, local);
  const onlyLocal = without(local, server);
  return { onlyServer, onlyLocal, same: onlyServer.length === 0 && onlyLocal.length === 0 };
}

export type CheckFace = 'idle' | 'loading' | 'error' | 'agrees' | 'differs';

/** Which face the server-check line shows. A refetch over an answer keeps the answer on screen. */
export function checkFace(check: BuildActions['check'], local: readonly Issue[]): { face: CheckFace; diff: IssueDiff | null } {
  if (check.error) return { face: 'error', diff: null };
  if (!check.data) return { face: check.loading ? 'loading' : 'idle', diff: null };
  const diff = compareIssues(local, check.data.issues);
  return { face: diff.same ? 'agrees' : 'differs', diff };
}

// ---------------------------------------------------------------------------
// Where the runner lives once approved
// ---------------------------------------------------------------------------

/** The character sheet route (`routes.tsx`: `/c/:campaignId/sheet/:characterId`). */
export function sheetHref(campaignId: string, characterId: string): string {
  return `/c/${campaignId}/sheet/${characterId}`;
}

/** A count in words: "1 item", "3 items". */
export { plural };
