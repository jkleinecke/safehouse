/**
 * Pure helpers for the character builder's shell (FR3.9, docs/CHARGEN.md
 * §4.4, §8.6) — no JSX, no React, no network.
 *
 * The walkthrough's chrome asks the same handful of questions on every
 * render: which pools to put on the rail and whether one is overspent, how
 * the validator's findings group, what stops Next on this step, which steps
 * the progress strip may jump to, which builds a GM is waiting on. Those are
 * rules about *presentation*, not about Shadowrun — the Shadowrun lives in
 * `@safehouse/rules` (`budgets`, `validate`, `stepStatus`) and nothing here
 * re-derives it. They sit in one plain module so they can be tested as
 * functions, because under `renderToStaticMarkup` nothing interactive runs.
 *
 * The entry-point cards on the player home and the GM console import this
 * file from outside the lazy builder chunk, so it must stay light: contracts
 * types and small functions only.
 */
import type {
  BudgetPool,
  BudgetPoolKey,
  Budgets,
  BuildMode,
  BuildState,
  BuildStep,
  BuildWritable,
  CharacterBuild,
  Issue,
  IssueSeverity,
  Role,
} from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Who may build, and when a build can still change
// ---------------------------------------------------------------------------

/** Players and the GM build runners; an observer or the table TV never does (§8.5 roles). */
export function canBuild(role: Role | null | undefined): boolean {
  return role === 'gm' || role === 'player';
}

/** Only a draft or a returned build is editable (§4.3); a submitted one waits on the GM. */
export function isEditableState(state: BuildState): boolean {
  return state === 'draft' || state === 'returned';
}

/**
 * The player-writable part of a record: `GM_BUILD_FIELDS` removed. What an
 * autosave sends — the server keeps its own row's approvals, notes, returned
 * step and state whatever a device says.
 */
export function writableBuild(build: CharacterBuild): BuildWritable {
  const { approvals: _a, notes: _n, returnedStep: _r, state: _s, ...writable } = build;
  return writable;
}

/** The chip a build's state shows, in words a player reads at a glance. */
export const BUILD_STATE_LABEL: Readonly<Record<BuildState, string>> = {
  draft: 'draft',
  submitted: 'waiting for the GM',
  returned: 'returned with a note',
  approved: 'approved',
};

/** Chip tone per state: to-do warn, waiting cyan, returned magenta, done ok. */
export const BUILD_STATE_TONE: Readonly<Record<BuildState, string>> = {
  draft: 'border-edge-bright text-dim',
  submitted: 'border-cyan-dim/60 text-cyan',
  returned: 'border-magenta/50 text-magenta',
  approved: 'border-ok/40 text-ok',
};

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function formatNuyen(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')}¥`;
}

/** Power points come in quarters (p. 309); every other pool is whole. */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------
// The rail's pools
// ---------------------------------------------------------------------------

/** Every pool key the rail can show: the contract's twelve plus the optional three. */
export type RailPoolKey = BudgetPoolKey | 'positiveQualities' | 'negativeQualities' | 'priorityPoints';

export interface PoolMeta {
  /** A few letters for the phone bar's one line ("Skill 8"). */
  short: string;
  label: string;
  /** How a value of this pool is written. */
  unit: 'points' | 'karma' | 'nuyen' | 'pp' | 'force' | 'picks';
  /**
   * Always on the rail (§4.4 names these), even at 0 / 0 — a first-timer
   * needs to see that skill points exist before choosing the row that grants
   * them. The rest appear only once they apply to this build.
   */
  core: boolean;
}

/** The rail's order and wording. Our own labels; the numbers come from `budgets()`. */
export const POOL_META: Readonly<Record<RailPoolKey, PoolMeta>> = {
  priorityPoints: { label: 'Priority points', short: 'Priority', unit: 'points', core: false },
  special: { label: 'Special points', short: 'Special', unit: 'points', core: true },
  attributes: { label: 'Attribute points', short: 'Attr', unit: 'points', core: true },
  skills: { label: 'Skill points', short: 'Skill', unit: 'points', core: true },
  groups: { label: 'Group points', short: 'Group', unit: 'points', core: true },
  knowledge: { label: 'Knowledge points', short: 'Knowl', unit: 'points', core: true },
  positiveQualities: { label: 'Positive qualities', short: '+Qual', unit: 'karma', core: false },
  negativeQualities: { label: 'Negative qualities', short: '−Qual', unit: 'karma', core: false },
  karma: { label: 'Karma', short: 'Karma', unit: 'karma', core: true },
  nuyen: { label: 'Nuyen', short: 'Nuyen', unit: 'nuyen', core: true },
  contactKarma: { label: 'Contact Karma', short: 'Contacts', unit: 'karma', core: true },
  powerPoints: { label: 'Power points', short: 'PP', unit: 'pp', core: false },
  spells: { label: 'Spells, rituals, preparations', short: 'Spells', unit: 'picks', core: false },
  forms: { label: 'Complex forms', short: 'Forms', unit: 'picks', core: false },
  foci: { label: 'Bonded foci Force', short: 'Foci', unit: 'force', core: false },
};

export const RAIL_POOL_ORDER = Object.keys(POOL_META) as RailPoolKey[];

export interface PoolRow extends BudgetPool {
  key: RailPoolKey;
  label: string;
  unit: PoolMeta['unit'];
  /** More spent than there is: `remaining` below zero. */
  over: boolean;
  /** Everything spent, nothing over. */
  exact: boolean;
}

/** Write one pool value in its unit. */
export function formatPoolValue(unit: PoolMeta['unit'], n: number): string {
  return unit === 'nuyen' ? formatNuyen(n) : formatNumber(n);
}

/**
 * The pools the rail lists, in order: every core pool, and every other pool
 * that has something available or something spent. A pool whose spend runs
 * past what it holds is `over` — the rail turns it red *and* says "over by".
 */
export function poolRows(budgets: Budgets): PoolRow[] {
  const pools = budgets.pools as Partial<Record<RailPoolKey, BudgetPool>>;
  const out: PoolRow[] = [];
  for (const key of RAIL_POOL_ORDER) {
    const pool = pools[key];
    const meta = POOL_META[key];
    if (!pool) continue;
    if (!meta.core && pool.available === 0 && pool.spent === 0) continue;
    out.push({
      key,
      label: meta.label,
      unit: meta.unit,
      ...pool,
      over: pool.remaining < 0,
      exact: pool.remaining === 0 && pool.available > 0,
    });
  }
  return out;
}

/** "Skill 8" / "Skill −3": the phone bar's one-line form, the full words (`poolBrief`) for a screen reader beside it. */
export function poolTiny(row: PoolRow): string {
  const f = (n: number) => formatPoolValue(row.unit, n);
  return row.over ? `${POOL_META[row.key].short} −${f(-row.remaining)}` : `${POOL_META[row.key].short} ${f(row.remaining)}`;
}

/**
 * Where a sideways strip should scroll to show one item: centred when it
 * can be, never past either end. The progress strip on a phone used to stay
 * where it was while the player pressed Next, leaving the current step's tab
 * off the right edge.
 */
export function stripScrollLeft(item: { left: number; width: number }, strip: { width: number; scrollWidth: number }): number {
  const centred = item.left - (strip.width - item.width) / 2;
  return Math.max(0, Math.min(Math.round(centred), Math.max(0, strip.scrollWidth - strip.width)));
}

/** "Skill points 8 left" / "Skill points over by 3" — the phone bar's short form. */
export function poolBrief(row: PoolRow): string {
  const f = (n: number) => formatPoolValue(row.unit, n);
  return row.over ? `${row.label} over by ${f(-row.remaining)}` : `${row.label} ${f(row.remaining)} left`;
}

/**
 * The pools one step spends (`StepMeta.pools`), in that order, as the rail
 * would list them — so a pool that does not apply to this build (power points
 * for a mundane) is left out here exactly as it is there.
 */
export function stepPoolRows(budgets: Budgets, keys: readonly RailPoolKey[]): PoolRow[] {
  const rows = poolRows(budgets);
  return keys.flatMap((key) => rows.filter((r) => r.key === key));
}

/** "Skill points: 20 of 28 spent, 8 left" / "…over by 3" — the row's spoken form. */
export function poolLabel(row: PoolRow): string {
  const f = (n: number) => formatPoolValue(row.unit, n);
  const tail = row.over ? `over by ${f(-row.remaining)}` : `${f(row.remaining)} left`;
  return `${row.label}: ${f(row.spent)} of ${f(row.available)} spent, ${tail}`;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/** The issues list's three groups, in the order a player should read them (§4.4). */
export const ISSUE_GROUPS: ReadonlyArray<{ severity: IssueSeverity; title: string; glyph: string; tone: string }> = [
  { severity: 'error', title: 'Must fix', glyph: '✕', tone: 'text-danger' },
  { severity: 'warning', title: 'Worth a look', glyph: '!', tone: 'text-warn' },
  { severity: 'approval', title: 'Needs the GM', glyph: '?', tone: 'text-magenta' },
];

export function groupIssues(issues: readonly Issue[]): Record<IssueSeverity, Issue[]> {
  const out: Record<IssueSeverity, Issue[]> = { error: [], warning: [], approval: [] };
  for (const issue of issues) out[issue.severity].push(issue);
  for (const list of Object.values(out)) list.sort((a, b) => a.step - b.step);
  return out;
}

/** Issues filed under one step, in the validator's order. */
export function issuesForStep(issues: readonly Issue[], step: BuildStep): Issue[] {
  return issues.filter((i) => i.step === step);
}

/**
 * Whether an issue waits on a step the player has not reached: after the step
 * on screen, on a step with nothing chosen on it yet. A fresh build is all
 * such issues — no priorities, no metatype, points unspent on every later
 * pool — and listing them as "must fix" beside step 1's alias field told a
 * first-timer the build was broken before it began. A later step that does
 * hold choices is not "later": a change upstream broke it, which is exactly
 * what the rail must say (§4.4), and `stepMark` marks it broken on the strip
 * by the same rule.
 */
export function issueIsLater(issue: Pick<Issue, 'step'>, current: BuildStep, build: StepContent): boolean {
  return issue.step > current && !stepHasContent(build, issue.step);
}

/**
 * The rail's issues split for the player at `current`: `now` is what to act on
 * (the step on screen, the ones behind it, and any later step a change broke),
 * `later` what waits on steps not reached. Both keep the validator's order.
 * The Finish checklist and the server's check read the whole list; only the
 * rail and the phone bar count `now` apart.
 */
export function splitIssues(issues: readonly Issue[], current: BuildStep, build: StepContent): { now: Issue[]; later: Issue[] } {
  const now: Issue[] = [];
  const later: Issue[] = [];
  for (const issue of issues) (issueIsLater(issue, current, build) ? later : now).push(issue);
  return { now, later };
}

// ---------------------------------------------------------------------------
// Steps: what stops Next, which marks the strip shows, where a jump may land
// ---------------------------------------------------------------------------

/** The slice of the engine's `StepStatus` the chrome reads — structural, so tests need no engine. */
export interface StepGate {
  step: BuildStep;
  complete: boolean;
  skipped: boolean;
  blocking: readonly Issue[];
  warnings: readonly Issue[];
}

/**
 * Why Next is shut on this step, in the validator's words, or null when it is
 * open. One reason is named and the rest counted, so the line stays one line
 * on a phone; the full list is the step's own issues below it.
 */
export function gatingReason(status: StepGate): string | null {
  if (status.complete) return null;
  const [first, ...rest] = status.blocking;
  if (!first) return 'This step is not finished yet.';
  return rest.length === 0 ? first.message : `${first.message} (and ${rest.length} more)`;
}

export type StepMark = 'done' | 'skipped' | 'broken' | 'current' | 'todo';

/** The slice of a record the strip reads to tell a step never started from one started and left broken. */
export type StepContent = Pick<
  CharacterBuild,
  | 'identity'
  | 'priorities'
  | 'metatype'
  | 'attributes'
  | 'special'
  | 'magic'
  | 'grants'
  | 'powers'
  | 'qualities'
  | 'skills'
  | 'purchases'
  | 'lifestyles'
  | 'karma'
>;

const some = (values: Record<string, number>): boolean => Object.values(values).some((n) => n > 0);

/**
 * Whether the record holds choices made on a step — its own fields, read as
 * they are, no rule applied. A step with content that is not complete is one
 * a change broke (or a player left open), wherever it sits relative to the
 * page on screen.
 */
export function stepHasContent(build: StepContent, step: BuildStep): boolean {
  switch (step) {
    case 1:
      return build.identity.alias.trim() !== '';
    case 2:
      return Object.values(build.priorities).some((p) => p !== null);
    case 3:
      return build.metatype !== null || some(build.attributes) || some(build.special);
    case 4:
      return (
        build.magic.kind !== 'mundane' ||
        build.grants.skills.length + build.grants.groups.length + build.grants.spells.length + build.grants.forms.length > 0 ||
        build.powers.length > 0
      );
    case 5:
      return build.qualities.length > 0;
    case 6:
      return build.skills.active.length + build.skills.groups.length + build.skills.knowledge.length + build.skills.languages.length > 0;
    case 7:
      return build.purchases.length + build.lifestyles.length > 0 || build.karma.toNuyen > 0;
    case 8:
      return build.karma.spends.length + build.karma.contacts.length > 0;
    default:
      return false;
  }
}

/** The priority columns whose rows a step's numbers come from. */
const STEP_PRIORITIES: Readonly<Partial<Record<number, ReadonlyArray<keyof CharacterBuild['priorities']>>>> = {
  3: ['metatype', 'attributes'],
  4: ['magic'],
  6: ['skills'],
  7: ['resources'],
};

/**
 * Whether the rows a step's pools come from are chosen. Before they are, a
 * step can have nothing wrong with it only because it has nothing in it —
 * the Magic step of a build with no priorities is not "done".
 */
export function stepReady(build: Pick<CharacterBuild, 'priorities'>, step: BuildStep): boolean {
  return (STEP_PRIORITIES[step] ?? []).every((col) => build.priorities[col] !== null);
}

/**
 * A step's mark on the progress strip (§4.4 "ticks the finished ones, and
 * marks any that a later change broke").
 *
 * - `broken` — not complete, and either behind the step on screen (guided
 *   mode only lets a player past a complete step, so an incomplete one
 *   behind them is exactly "a later change broke it") or holding content of
 *   its own. The second half is what makes the mark work *ahead* of the
 *   player: moving skills to E on step 2 breaks step 6's spend, and step 6
 *   must say so, not read "not done yet" like a step never opened.
 * - `done` — complete, its priorities chosen, and either behind the player
 *   or holding content: a step the player has not reached and that is empty
 *   is not ticked just because nothing in it is wrong yet, nor is the Magic
 *   step of a build with no Magic priority.
 * - `todo` — everything else ahead of the player.
 *
 * Without `build` (a caller that only has statuses) the marks fall back to
 * position alone.
 */
export function stepMark(status: StepGate, current: BuildStep, build?: StepContent): StepMark {
  if (status.step === current) return 'current';
  if (status.skipped) return 'skipped';
  const behind = status.step < current;
  if (!build) return status.complete ? 'done' : behind ? 'broken' : 'todo';
  const content = stepHasContent(build, status.step);
  if (status.complete) return stepReady(build, status.step) && (behind || content) ? 'done' : 'todo';
  return behind || content ? 'broken' : 'todo';
}

/**
 * Whether the strip lets a player land on `step`. Free mode: anywhere.
 * Guided: back to any step, and forward only across complete (or skipped)
 * steps — the first unfinished step is as far as a jump goes, so Next's gate
 * cannot be walked round through the strip.
 */
export function canReach(steps: readonly StepGate[], step: BuildStep, current: BuildStep, mode: BuildMode): boolean {
  if (mode === 'free' || step <= current) return true;
  for (const s of steps) {
    if (s.step >= step) break;
    if (!s.complete && !s.skipped) return false;
  }
  return true;
}

/**
 * Where a jump to `step` lands under the same rule as the strip: the step
 * itself when `canReach` allows it, otherwise the first unfinished step in the
 * way — the gate a guided player has to pass first. The shell hands steps and
 * the issues list a `goTo` that goes through this, so no "fix this in step 6"
 * button walks round Next's gate the strip keeps; Next and Back, whose own
 * gate is the step on screen, and the GM's note, which points where the GM
 * asked, move directly.
 */
export function reachableStep(steps: readonly StepGate[], step: BuildStep, current: BuildStep, mode: BuildMode): BuildStep {
  if (canReach(steps, step, current, mode)) return step;
  for (const s of steps) {
    if (s.step >= step) break;
    if (!s.complete && !s.skipped) return s.step;
  }
  return step;
}

/** The step Next leads to: the following one, stepping over a skipped step. */
export function nextStep(steps: readonly StepGate[], current: BuildStep): BuildStep | null {
  for (const s of steps) if (s.step > current && !s.skipped) return s.step;
  return null;
}

/** The step Back leads to, stepping over a skipped step. */
export function previousStep(steps: readonly StepGate[], current: BuildStep): BuildStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.step < current && !s.skipped) return s.step;
  }
  return null;
}

/** Clamp anything off a URL or an old record into a step number. */
export function toStep(value: unknown, fallback: BuildStep = 1): BuildStep {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 9 ? (n as BuildStep) : fallback;
}

// ---------------------------------------------------------------------------
// The build list
// ---------------------------------------------------------------------------

/** The slice of a build row the list reads. */
export interface BuildListRow {
  id: string;
  ownerUserId: string;
  state: BuildState;
  updatedAt: string;
  build: Pick<CharacterBuild, 'identity' | 'priorities' | 'metatype' | 'step' | 'method'>;
}

export type BuildListFilter = 'all' | 'waiting';

/** The name a build goes by before it has one. */
export function buildAlias(row: Pick<BuildListRow, 'build'>): string {
  return row.build.identity.alias.trim() || 'unnamed runner';
}

/** "B/A/E/C/D" in the table's column order, with a dash for an empty slot. */
export function priorityLine(build: Pick<CharacterBuild, 'priorities'>): string {
  const p = build.priorities;
  return [p.metatype, p.attributes, p.magic, p.skills, p.resources].map((l) => l ?? '–').join('/');
}

/** Builds waiting on the GM first, then newest first. */
export function sortBuilds<T extends BuildListRow>(rows: readonly T[]): T[] {
  const rank = (s: BuildState) => (s === 'submitted' ? 0 : s === 'returned' ? 1 : s === 'draft' ? 2 : 3);
  return [...rows].sort((a, b) => rank(a.state) - rank(b.state) || b.updatedAt.localeCompare(a.updatedAt));
}

export function filterBuilds<T extends BuildListRow>(rows: readonly T[], filter: BuildListFilter): T[] {
  return filter === 'waiting' ? rows.filter((r) => r.state === 'submitted') : [...rows];
}

export function isListFilter(value: unknown): value is BuildListFilter {
  return value === 'all' || value === 'waiting';
}

/** How many builds wait on the GM, and how many are still being made. */
export function buildCounts(rows: readonly Pick<BuildListRow, 'state'>[]): {
  waiting: number;
  inProgress: number;
  approved: number;
} {
  let waiting = 0;
  let inProgress = 0;
  let approved = 0;
  for (const r of rows) {
    if (r.state === 'submitted') waiting++;
    else if (r.state === 'approved') approved++;
    else inProgress++;
  }
  return { waiting, inProgress, approved };
}

/** The campaign-relative href of a build, optionally at a step. */
export function buildHref(campaignId: string, buildId: string, step?: BuildStep): string {
  return `/c/${campaignId}/build/${buildId}${step ? `?step=${step}` : ''}`;
}

export function buildListHref(campaignId: string, filter?: BuildListFilter): string {
  return `/c/${campaignId}/build${filter && filter !== 'all' ? `?filter=${filter}` : ''}`;
}
