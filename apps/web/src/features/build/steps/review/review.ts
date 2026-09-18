/**
 * What the GM's review decides before it draws anything (FR3.9,
 * docs/CHARGEN.md §4.4 Step 9 "the GM opens the same page in review mode: the
 * sheet, the build's choices step by step, the issues list including the
 * needs-GM items with approve/deny per item, and two buttons — Approve … and
 * Return with notes"; §8.5 the approvals and approve routes).
 *
 * - **The items to decide.** The validator applies the GM's decisions as it
 *   runs — an approved item's issue is gone, a denied one comes back as an
 *   error (`validate.ts`) — so the build's own issues cannot list what was
 *   already decided. The review asks the engine the other question: the same
 *   record with no decisions on it, validated, gives every `approval` item
 *   the build raises; the record's `approvals` then says which are approved,
 *   denied or still open. A decision on a code the build no longer raises
 *   (the player changed the item before resubmitting) is simply not listed.
 * - **Approve's gate.** Shut while any error remains — a denied item is one,
 *   and the sentence says so and points at returning the build — or while
 *   any item is undecided, exactly as the server refuses (§8.5).
 * - **Return's gate.** A note is required (it is what the player reads), and
 *   is kept inside the contract's length.
 * - **The choices, step by step.** A few numbers per step, every one read
 *   off the record, the engine's `budgets()` and the compile's opening —
 *   spent against available, never recomputed.
 *
 * Plain functions over plain inputs, so a node test calls them directly. No
 * JSX, no network, no book text (DESIGN.md §14).
 */
import type {
  ApprovalDecision,
  BudgetPool,
  Budgets,
  BuildStep,
  CharacterBuild,
  ChargenSettings,
  Issue,
  PriorityColumn,
} from '@safehouse/contracts';
import { conceptPreset, metatypeRow, validate, type CompiledOpening, type StepStatus } from '@safehouse/rules';
import { POOL_META, formatNuyen, formatPoolValue, type RailPoolKey } from '../../lib.js';
import { POOL_NOUNS } from '../../kit/words.js';
import { checklistLines, firstErrorStep, plural, type CheckMark } from '../finish/checklist.js';
import { MAGIC_KIND_WORDS } from '../finish/preview.js';
import { STEP_META } from '../meta.js';
import type { BuildActions } from '../types.js';

// ---------------------------------------------------------------------------
// The items to decide
// ---------------------------------------------------------------------------

export interface ApprovalItem {
  issue: Issue;
  decision: ApprovalDecision | null;
}

/**
 * Every `approval` item the build raises, whatever the GM has decided so far,
 * each with its decision (null while open). Runs the validator once more over
 * the record without decisions; callers memoise on the build.
 */
export function approvalItems(build: CharacterBuild, settings: ChargenSettings): ApprovalItem[] {
  const undecided = validate({ ...build, approvals: {} }, settings);
  return undecided.filter((i) => i.severity === 'approval').map((issue) => ({ issue, decision: build.approvals[issue.code] ?? null }));
}

/**
 * The write a decision button sends. The buttons are toggles: pressing the
 * decision that already stands takes it back (`null`, which the approvals
 * route reads as "undecided again"), so a slip of the thumb is undone where
 * it happened.
 */
export function decisionWrite(item: ApprovalItem, choice: ApprovalDecision): Record<string, ApprovalDecision | null> {
  return { [item.issue.code]: item.decision === choice ? null : choice };
}

export function decisionCounts(items: readonly ApprovalItem[]): { approved: number; denied: number; open: number } {
  let approved = 0;
  let denied = 0;
  let open = 0;
  for (const i of items) {
    if (i.decision === 'approved') approved++;
    else if (i.decision === 'denied') denied++;
    else open++;
  }
  return { approved, denied, open };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export interface ApproveGate {
  open: boolean;
  errors: number;
  /** Errors that are the GM's own denials. */
  denied: number;
  undecided: number;
  /** Why it is shut, in a sentence; null when open. */
  reason: string | null;
}

/**
 * Approve's gate, as the server's: no errors anywhere (a denied item is an
 * error), no item left undecided, and no other action running.
 */
export function approveGate(input: {
  allIssues: readonly Issue[];
  items: readonly ApprovalItem[];
  busy: BuildActions['busy'];
}): ApproveGate {
  const errors = input.allIssues.filter((i) => i.severity === 'error').length;
  const { denied, open: undecided } = decisionCounts(input.items);
  let reason: string | null = null;
  if (errors > 0) {
    const others = errors - denied;
    const what =
      denied > 0 && others > 0
        ? `${plural(others, 'thing', 'things')} to fix and ${plural(denied, 'item', 'items')} you denied`
        : denied > 0
          ? `${plural(denied, 'item', 'items')} you denied`
          : `${plural(errors, 'thing', 'things')} to fix`;
    reason = `This build still has ${what}, so it cannot be approved as it stands. Return it with a note so the player can change it.`;
  } else if (undecided > 0) {
    reason = `${plural(undecided, 'item', 'items')} still to decide above before this build can be approved.`;
  } else if (input.busy === 'approve') {
    reason = 'Approving and creating the character.';
  } else if (input.busy !== null) {
    reason = 'Another action is still running.';
  }
  return { open: reason === null, errors, denied, undecided, reason };
}

// ---------------------------------------------------------------------------
// Return with notes
// ---------------------------------------------------------------------------

/** The contract's limit on the GM's note (`BuildReturnSchema.notes`). */
export const NOTE_MAX = 20_000;

export interface ReturnGate {
  open: boolean;
  reason: string | null;
}

export function returnGate(input: { notes: string; busy: BuildActions['busy'] }): ReturnGate {
  const text = input.notes.trim();
  const reason =
    text === ''
      ? 'Write a note first: it is what the player reads when the build reopens.'
      : text.length > NOTE_MAX
        ? `The note is too long: at most ${NOTE_MAX.toLocaleString('en-US')} characters.`
        : input.busy === 'return'
          ? 'Sending the build back.'
          : input.busy !== null
            ? 'Another action is still running.'
            : null;
  return { open: reason === null, reason };
}

/**
 * The step a return note is pinned to by default: the first step with an
 * error (a denied item included), or none when nothing is wrong — a GM
 * returning a clean build is asking for a change of taste, not a fix.
 */
export function defaultReturnStep(allIssues: readonly Issue[]): BuildStep | null {
  return firstErrorStep(allIssues);
}

/** The step picker's choices: none, then every step by number and title. */
export function returnStepOptions(): { value: string; label: string }[] {
  return [{ value: '', label: 'no particular step' }, ...STEP_META.map((m) => ({ value: String(m.step), label: `Step ${m.step} · ${m.title}` }))];
}

/** A picker value back to a step (or none). */
export function stepFromOption(value: string): BuildStep | null {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= STEP_META.length ? n : null;
}

// ---------------------------------------------------------------------------
// The choices, step by step
// ---------------------------------------------------------------------------

/** Our names for the five priority columns, in the table's order. */
export const COLUMN_WORDS: Readonly<Record<PriorityColumn, string>> = {
  metatype: 'Metatype',
  attributes: 'Attributes',
  magic: 'Magic',
  skills: 'Skills',
  resources: 'Resources',
};

/** "24 of 24 attribute points spent", "4,000¥ of 450,000¥ spent", "31 of 28 skill points spent, 3 over". Null for a pool the build does not use. */
export function spentLine(key: RailPoolKey, pool: BudgetPool | undefined): string | null {
  if (!pool || (pool.available === 0 && pool.spent === 0)) return null;
  const f = (n: number) => formatPoolValue(POOL_META[key].unit, n);
  const noun = POOL_NOUNS[key][1];
  const base = `${f(pool.spent)} of ${f(pool.available)}${noun ? ` ${noun}` : ''} spent`;
  return pool.remaining < 0 ? `${base}, ${f(-pool.remaining)} over` : base;
}

export interface StepSummary {
  step: BuildStep;
  title: string;
  mark: CheckMark;
  /** What still blocks the step, counted. */
  blocking: number;
  /** The step's key numbers and choices, a few short lines. */
  lines: string[];
}

const pools = (budgets: Budgets) => budgets.pools as Partial<Record<RailPoolKey, BudgetPool>>;
const present = (lines: ReadonlyArray<string | null | false | undefined>): string[] => lines.filter((l): l is string => Boolean(l));

/**
 * One summary per walkthrough step, for the GM reading a build before
 * deciding: the step's mark (as the player's checklist shows it) and its
 * numbers, read off the record, `budgets()` and the compile's opening.
 */
export function stepSummaries(input: {
  build: CharacterBuild;
  budgets: Budgets;
  steps: readonly StepStatus[];
  allIssues: readonly Issue[];
  opening: CompiledOpening | null;
}): StepSummary[] {
  const { build: b, budgets, steps, allIssues, opening } = input;
  const p = pools(budgets);
  const marks = checklistLines(b, steps, allIssues);
  return marks.map((line) => {
    const meta = STEP_META[line.step - 1]!;
    let lines: string[];
    switch (line.step) {
      case 1: {
        const concept = b.identity.concept ? conceptPreset(b.identity.concept) : null;
        lines = present([
          b.identity.alias.trim() ? `Alias ${b.identity.alias.trim()}` : 'No alias yet',
          b.identity.realName && `Real name ${b.identity.realName}`,
          concept && `From the ${concept.title} card`,
          `${b.level} level`,
        ]);
        break;
      }
      case 2:
        lines = present([
          (Object.keys(COLUMN_WORDS) as PriorityColumn[])
            .map((col) => `${COLUMN_WORDS[col]} ${b.priorities[col] ?? '–'}`)
            .join(' · '),
          b.method === 'sumToTen' && 'sum-to-ten method',
        ]);
        break;
      case 3:
        lines = present([
          b.metatype ? (metatypeRow(b.metatype)?.name ?? b.metatype) : 'No metatype yet',
          spentLine('attributes', p.attributes),
          spentLine('special', p.special),
        ]);
        break;
      case 4:
        lines = present([
          line.mark === 'skipped' ? 'Mundane: nothing to choose' : MAGIC_KIND_WORDS[b.magic.kind],
          b.magic.aspect && `aspect ${b.magic.aspect}`,
          b.magic.tradition && `tradition ${b.magic.tradition}`,
          b.magic.mentor && `mentor ${b.magic.mentor}`,
          b.grants.skills.length + b.grants.groups.length > 0 &&
            `${plural(b.grants.skills.length + b.grants.groups.length, 'granted skill or group', 'granted skills and groups')}`,
          spentLine('spells', p.spells),
          spentLine('forms', p.forms),
          spentLine('powerPoints', p.powerPoints),
        ]);
        break;
      case 5: {
        const positive = b.qualities.filter((q) => q.type === 'positive');
        const negative = b.qualities.filter((q) => q.type === 'negative');
        const karmaOf = (pool: BudgetPool | undefined) => (pool ? `, ${formatPoolValue('karma', pool.spent)} of ${formatPoolValue('karma', pool.available)} Karma` : '');
        lines = present([
          `${plural(positive.length, 'positive quality', 'positive qualities')}${karmaOf(p.positiveQualities)}`,
          `${plural(negative.length, 'negative quality', 'negative qualities')}${karmaOf(p.negativeQualities)}`,
        ]);
        break;
      }
      case 6:
        lines = present([
          spentLine('skills', p.skills),
          spentLine('groups', p.groups),
          spentLine('knowledge', p.knowledge),
          `${plural(b.skills.active.length, 'active skill', 'active skills')}, ${plural(b.skills.groups.length, 'group', 'groups')}, ${plural(
            b.skills.knowledge.length + b.skills.languages.length,
            'knowledge skill or language',
            'knowledge skills and languages',
          )}`,
        ]);
        break;
      case 7:
        lines = present([
          spentLine('nuyen', p.nuyen),
          `${plural(b.purchases.length, 'purchase', 'purchases')}`,
          b.lifestyles.length > 0
            ? b.lifestyles.map((l) => `${l.name} × ${l.months} ${l.months === 1 ? 'month' : 'months'}`).join(', ')
            : 'No lifestyle',
          b.karma.toNuyen > 0 && `${b.karma.toNuyen} Karma converted to nuyen`,
          opening && `${formatNuyen(opening.nuyenCarry)} carries into play`,
        ]);
        break;
      case 8:
        lines = present([
          spentLine('karma', p.karma),
          opening && `${opening.karma} Karma carries into play`,
          `${plural(b.karma.spends.length, 'Karma spend', 'Karma spends')}`,
          `${plural(b.karma.contacts.length, 'contact', 'contacts')}`,
          spentLine('contactKarma', p.contactKarma),
        ]);
        break;
      default:
        lines = [b.identity.background?.trim() ? 'Background written' : 'No background written'];
    }
    return { step: line.step, title: meta.title, mark: line.mark, blocking: line.blocking.length, lines };
  });
}
