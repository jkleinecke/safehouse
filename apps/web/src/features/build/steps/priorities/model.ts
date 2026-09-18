/**
 * What every cell of the priority table buys *this* runner (FR3.9,
 * docs/CHARGEN.md §4.4 Step 2) — the pure half of the Priorities screen.
 *
 * The printed table answers "what does row B of the Skills column give?"
 * for everyone at once, and a first-timer then has to work out which of the
 * five metatype numbers is theirs, which of the magic cells applies to an
 * adept, and what the Resources column pays at the campaign's level. §4.4
 * asks the screen to do that sum for them: each slot says what it buys for
 * the metatype the player is leaning toward ("B — Human 7 special points"),
 * the kind of magic they chose, the level the GM set. So the screen never
 * shows the raw table; it shows this model of it.
 *
 * Every number is the engine's. The rows come from `effectiveTables` — the
 * campaign's printing and creation level, not the build's stale copy — and
 * the metatype cells from the metatype table itself, so a metavariant a GM
 * allows is priced the way the validator prices it. What a change would do
 * is `setPriority` and `setMethod`, the same updaters the tap applies; what
 * it would break is the walkthrough's `probe`, so a Sum to Ten row that runs
 * past ten points is refused with the validator's own sentence, and a swap
 * that reopens a spend already made on a later step says which step and why
 * before the tap rather than after it.
 *
 * The words are ours (DESIGN.md §14): labels, grant descriptions and the
 * notes around them. No JSX — both layouts of the screen (the grid on a
 * laptop, a picker per column on a phone) read one model, and a node test
 * reads it too.
 */
import {
  PRIORITY_COLUMNS,
  PRIORITY_LEVELS,
  type BuildMethod,
  type BuildStep,
  type CharacterBuild,
  type ChargenSettings,
  type CreationLevel,
  type Issue,
  type MagicKind,
  type PriorityColumn,
  type PriorityLevel,
  type Ref,
} from '@safehouse/contracts';
import {
  CORE_METATYPE_IDS,
  METATYPE_BY_ID,
  SKILL_GROUP_BY_ID,
  SUM_TO_TEN,
  conceptPreset,
  effectiveTables,
  metatypeRow,
  setMethod,
  setPriority,
  type GroupGrant,
  type MagicPriorityOption,
  type MetatypeRow,
  type PriorityRow,
  type SkillGrant,
} from '@safehouse/rules';
import type { BuildProber } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { formatNuyen, priorityLine, stepHasContent } from '../../lib.js';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The five columns as the screen and the validator both name them. */
export const COLUMN_LABEL: Readonly<Record<PriorityColumn, string>> = {
  metatype: 'Metatype',
  attributes: 'Attributes',
  magic: 'Magic or Resonance',
  skills: 'Skills',
  resources: 'Resources',
};

type AwakenedKind = Exclude<MagicKind, 'mundane'>;

const KIND_WORD: Readonly<Record<AwakenedKind, string>> = {
  magician: 'magician',
  mysticAdept: 'mystic adept',
  technomancer: 'technomancer',
  adept: 'adept',
  aspected: 'aspected magician',
};

const LEVEL_WORD: Readonly<Record<CreationLevel, string>> = {
  street: 'street',
  experienced: 'experienced',
  prime: 'prime runner',
};

const METHOD_WORD: Readonly<Record<BuildMethod, string>> = {
  priority: 'the priority table',
  sumToTen: 'Sum to Ten',
};

export function methodWord(method: BuildMethod): string {
  return METHOD_WORD[method];
}

const capital = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "an adept", "a technomancer". */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

/** "a", "a or b", "a, b or c". */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** "a", "a and b", "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function skillGrantWords(g: SkillGrant): string {
  const noun = g.count === 1 ? 'skill' : 'skills';
  switch (g.pool.kind) {
    case 'category': {
      const category = g.pool.category === 'resonance' ? 'Resonance' : g.pool.category;
      return `${g.count} ${category} ${noun} at rating ${g.rating}`;
    }
    case 'groups':
      return `${g.count} ${noun} from the ${orList(g.pool.groups.map((id) => SKILL_GROUP_BY_ID[id].name))} groups at rating ${g.rating}`;
    case 'any':
      return `${g.count} active ${noun} at rating ${g.rating}`;
  }
}

function groupGrantWords(g: GroupGrant): string {
  const names = g.groups.map((id) => SKILL_GROUP_BY_ID[id].name);
  return `${plural(g.count, 'skill group')} from ${orList(names)} at rating ${g.rating}`;
}

/** What one Magic/Resonance option hands over, in order: the rating, then the free picks. */
export function optionGrants(o: MagicPriorityOption): string[] {
  const parts = [`${o.attribute === 'mag' ? 'Magic' : 'Resonance'} ${o.rating}`];
  if (o.skills) parts.push(skillGrantWords(o.skills));
  if (o.groups) parts.push(groupGrantWords(o.groups));
  if (o.formulae > 0) parts.push(plural(o.formulae, 'spell, ritual or preparation', 'spells, rituals or preparations'));
  if (o.forms > 0) parts.push(plural(o.forms, 'complex form'));
  return parts;
}

export interface MagicOffer {
  kinds: AwakenedKind[];
  grants: string[];
}

/**
 * A row's options with identical grants folded together — the magician and
 * the mystic adept share every cell — in the order the row lists them.
 */
export function magicOffers(row: Pick<PriorityRow, 'magic'>): MagicOffer[] {
  const out: MagicOffer[] = [];
  const byKey = new Map<string, MagicOffer>();
  for (const option of row.magic) {
    const grants = optionGrants(option);
    const key = grants.join('|');
    const seen = byKey.get(key);
    if (seen) {
      seen.kinds.push(option.kind);
      continue;
    }
    const offer: MagicOffer = { kinds: [option.kind], grants };
    byKey.set(key, offer);
    out.push(offer);
  }
  return out;
}

/** "Magician or mystic adept: Magic 6, 2 magical skills at rating 5, 10 spells, rituals or preparations". */
export function offerSentence(offer: MagicOffer): string {
  return `${capital(orList(offer.kinds.map((k) => KIND_WORD[k])))}: ${offer.grants.join(', ')}`;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** Under the Priority method: the column that holds this row now, and what it takes in exchange. */
export interface CellSwap {
  column: PriorityColumn;
  /** The row the other column is left with; null when this column had none. */
  takes: PriorityLevel | null;
}

/** Errors a change would bring to later steps that already hold choices. */
export interface CellBreaks {
  steps: BuildStep[];
  first: Issue;
  count: number;
}

export interface PriorityCell {
  column: PriorityColumn;
  level: PriorityLevel;
  chosen: boolean;
  /** The headline figure: "Elf: 8 special points", "24 attribute points", "450,000¥". */
  figure: string;
  /** Short lines under the figure, for the grid's narrow cells. */
  notes: string[];
  /** Everything else the cell buys, one sentence a line — the picker's detail and the grid's summary. */
  detail: string[];
  swap: CellSwap | null;
  /** Sum to Ten: what this row costs in priority points. */
  cost: number | null;
  /** Why the row cannot be taken (Sum to Ten past its points), in the validator's words. */
  refusal: Refusal | null;
  breaks: CellBreaks | null;
  /**
   * The Magic row this take would leave a mundane paying for — the
   * validator's `magic-priority-unused` warning, said before the tap rather
   * than in the note after it. Not a refusal: a player may mean it.
   */
  unused: Issue | null;
}

export interface PriorityColumnModel {
  column: PriorityColumn;
  label: string;
  level: PriorityLevel | null;
  /** Who the column's cells are written for: "for Elf", "at the experienced level". */
  note: string | null;
  /** A to E. */
  cells: PriorityCell[];
}

/** The metatype the metatype cells are written for, and where the lean comes from. */
export interface MetatypeLean {
  row: MetatypeRow;
  source: 'chosen' | 'concept';
}

/** What a concept card suggested for the rows, when the build started from one. */
export interface ConceptRows {
  title: string;
  line: string;
  rows: Readonly<Record<PriorityColumn, PriorityLevel>>;
  /** The build still holds exactly the card's rows. */
  matches: boolean;
}

export type MundaneNote =
  /** A mundane card with Magic at E: why it sits there. */
  | { kind: 'concept'; title: string; sumToTen: boolean }
  /** A mundane build paying for a Magic row it cannot use (the engine's warning). */
  | { kind: 'unused'; issue: Issue };

export interface PrioritiesModel {
  method: BuildMethod;
  level: CreationLevel;
  levelWord: string;
  lean: MetatypeLean | null;
  columns: PriorityColumnModel[];
  /** Sum to Ten's price per row, null under the Priority method. */
  costs: Readonly<Record<PriorityLevel, number>> | null;
  concept: ConceptRows | null;
  mundane: MundaneNote | null;
  /** How many of the five columns have a row. */
  filled: number;
}

export interface PrioritiesInput {
  build: CharacterBuild;
  settings: ChargenSettings;
  /** The walkthrough's prober; without it no cell is refused or marked (a read-only render). */
  probe?: BuildProber | undefined;
  /** Every issue in the build, for the notes that read a later step's warning. */
  allIssues?: readonly Issue[];
}

/** The metatype the cells speak for: the one chosen, else the concept card's suggestion. */
export function metatypeLean(build: Pick<CharacterBuild, 'metatype' | 'identity'>): MetatypeLean | null {
  const chosen = build.metatype ? metatypeRow(build.metatype) : null;
  if (chosen) return { row: chosen, source: 'chosen' };
  const suggested = conceptPreset(build.identity.concept)?.metatype;
  return suggested ? { row: METATYPE_BY_ID[suggested], source: 'concept' } : null;
}

interface CellFigures {
  figure: string;
  notes: string[];
  detail: string[];
}

function metatypeFigures(row: PriorityRow, level: PriorityLevel, lean: MetatypeLean | null): CellFigures {
  const on = CORE_METATYPE_IDS.filter((id) => row.metatype[id] !== undefined);
  const off = CORE_METATYPE_IDS.filter((id) => row.metatype[id] === undefined).map((id) => METATYPE_BY_ID[id].name);
  const table = on.map((id) => `${METATYPE_BY_ID[id].name} ${row.metatype[id]}`);
  const offLine = off.length > 0 ? `not on this row: ${andList(off)}` : null;
  const offDetail = offLine ? [`${capital(offLine)}.`] : [];

  if (!lean) {
    return { figure: table.join(' · '), notes: offLine ? [offLine] : [], detail: offDetail };
  }
  const cell = lean.row.priority[level];
  if (!cell) {
    return {
      figure: `No ${lean.row.name} on this row`,
      notes: [table.join(' · ')],
      detail: [`Special points here: ${table.join(', ')}.`, ...offDetail],
    };
  }
  const karma = cell.karma > 0 ? `, costs ${cell.karma} Karma` : '';
  return {
    figure: `${lean.row.name}: ${plural(cell.special, 'special point')}${karma}`,
    notes: offLine ? [offLine] : [],
    detail: offDetail,
  };
}

function magicFigures(row: PriorityRow, kind: MagicKind): CellFigures {
  const offers = magicOffers(row);
  if (offers.length === 0) return { figure: 'No Magic or Resonance', notes: [], detail: [] };
  const detail = offers.map((o) => `${offerSentence(o)}.`);
  const kinds = row.magic.map((o) => KIND_WORD[o.kind]);
  if (kind !== 'mundane') {
    const own = row.magic.find((o) => o.kind === kind);
    if (!own) return { figure: `No ${KIND_WORD[kind]} on this row`, notes: [kinds.join(', ')], detail };
    const [rating, ...picks] = optionGrants(own);
    return { figure: `${capital(KIND_WORD[kind])}: ${rating}`, notes: picks, detail };
  }
  const range = (attribute: 'mag' | 'res', name: string): string | null => {
    const ratings = row.magic.filter((o) => o.attribute === attribute).map((o) => o.rating);
    if (ratings.length === 0) return null;
    const lo = Math.min(...ratings);
    const hi = Math.max(...ratings);
    return lo === hi ? `${name} ${lo}` : `${name} ${lo}–${hi}`;
  };
  const figure = [range('mag', 'Magic'), range('res', 'Resonance')].filter((s): s is string => s !== null).join(' or ');
  return { figure, notes: [kinds.join(', ')], detail };
}

function figuresFor(column: PriorityColumn, row: PriorityRow, build: CharacterBuild, lean: MetatypeLean | null, level: CreationLevel): CellFigures {
  switch (column) {
    case 'metatype':
      return metatypeFigures(row, row.level, lean);
    case 'attributes':
      return { figure: plural(row.attributes, 'attribute point'), notes: [], detail: [] };
    case 'magic':
      return magicFigures(row, build.magic.kind);
    case 'skills': {
      const groups = plural(row.skills.groupPoints, 'group point');
      return { figure: plural(row.skills.points, 'skill point'), notes: [groups], detail: [`${capital(groups)}.`] };
    }
    case 'resources':
      return { figure: formatNuyen(row.resources[level]), notes: [], detail: [] };
  }
}

function columnNote(column: PriorityColumn, build: CharacterBuild, lean: MetatypeLean | null, levelWord: string): string | null {
  switch (column) {
    case 'metatype':
      return lean ? `special points for ${lean.row.name}` : 'special points for each metatype';
    case 'magic':
      return build.magic.kind === 'mundane' ? 'every kind the row offers' : `for ${withArticle(KIND_WORD[build.magic.kind])}`;
    case 'resources':
      return `nuyen at the ${levelWord} level`;
    default:
      return null;
  }
}

const SUM_TO_TEN_OVER = 'sum-to-ten-over';

/** The probe key for putting `level` on `column` — stable per candidate, so a draft validates each once. */
export function cellProbeKey(column: PriorityColumn, level: PriorityLevel): string {
  return `priorities:${column}:${level}`;
}

/** The cell's refusal and later-step breaks, from the walkthrough's probe. */
function probeCell(
  build: CharacterBuild,
  column: PriorityColumn,
  level: PriorityLevel,
  probe: BuildProber,
): Pick<PriorityCell, 'refusal' | 'breaks' | 'unused'> {
  const answer = probe((b) => setPriority(b, column, level), cellProbeKey(column, level));
  const unused = answer.warned.find((i) => i.code === 'magic-priority-unused') ?? null;
  let refusal: Refusal | null = null;
  if (build.method === 'sumToTen') {
    const current = build.priorities[column];
    const raises = SUM_TO_TEN.cost[level] > (current ? SUM_TO_TEN.cost[current] : 0);
    // A new overspend refuses; so does raising a row on a record that is
    // already over (the validator's issue is not "introduced" then, but the
    // tap would only take it further past its points).
    const over =
      answer.introduced.find((i) => i.code === SUM_TO_TEN_OVER) ??
      (raises ? answer.blocking.find((i) => i.code === SUM_TO_TEN_OVER) : undefined);
    if (over) refusal = { reason: over.message, ref: over.ref };
  }
  if (refusal) return { refusal, breaks: null, unused: null };
  const later = answer.introduced.filter((i) => i.step > 2 && stepHasContent(build, i.step));
  const first = later[0];
  const breaks = first
    ? { steps: [...new Set(later.map((i) => i.step))].sort((a, b) => a - b), first, count: later.length }
    : null;
  return { refusal: null, breaks, unused };
}

function swapFor(build: CharacterBuild, column: PriorityColumn, level: PriorityLevel): CellSwap | null {
  if (build.method !== 'priority') return null;
  const holder = PRIORITY_COLUMNS.find((c) => c !== column && build.priorities[c] === level);
  return holder ? { column: holder, takes: build.priorities[column] } : null;
}

function mundaneNote(build: CharacterBuild, allIssues: readonly Issue[]): MundaneNote | null {
  if (build.magic.kind !== 'mundane') return null;
  const unused = allIssues.find((i) => i.code === 'magic-priority-unused');
  if (unused) return { kind: 'unused', issue: unused };
  const preset = conceptPreset(build.identity.concept);
  if (preset && preset.magic.kind === 'mundane' && preset.priorities && build.priorities.magic === 'E') {
    return { kind: 'concept', title: preset.title, sumToTen: build.method === 'sumToTen' };
  }
  return null;
}

function conceptRows(build: CharacterBuild): ConceptRows | null {
  const preset = conceptPreset(build.identity.concept);
  const rows = preset?.priorities;
  if (!preset || !rows) return null;
  return {
    title: preset.title,
    line: priorityLine({ priorities: rows }),
    rows,
    matches: PRIORITY_COLUMNS.every((c) => build.priorities[c] === rows[c]),
  };
}

/** The whole screen's model: five columns of five cells, and the notes around them. */
export function prioritiesModel({ build, settings, probe, allIssues = [] }: PrioritiesInput): PrioritiesModel {
  const tables = effectiveTables(build, settings);
  const lean = metatypeLean(build);
  const sumToTen = build.method === 'sumToTen';
  const levelWord = LEVEL_WORD[tables.level];
  const columns = PRIORITY_COLUMNS.map((column): PriorityColumnModel => {
    const current = build.priorities[column];
    const cells = PRIORITY_LEVELS.map((level): PriorityCell => {
      const chosen = current === level;
      const probed = !chosen && probe ? probeCell(build, column, level, probe) : { refusal: null, breaks: null, unused: null };
      return {
        column,
        level,
        chosen,
        ...figuresFor(column, tables.chart[level], build, lean, tables.level),
        swap: chosen ? null : swapFor(build, column, level),
        cost: sumToTen ? SUM_TO_TEN.cost[level] : null,
        ...probed,
      };
    });
    return { column, label: COLUMN_LABEL[column], level: current, note: columnNote(column, build, lean, levelWord), cells };
  });
  return {
    method: build.method,
    level: tables.level,
    levelWord,
    lean,
    columns,
    costs: sumToTen ? SUM_TO_TEN.cost : null,
    concept: conceptRows(build),
    mundane: mundaneNote(build, allIssues),
    filled: PRIORITY_COLUMNS.filter((c) => build.priorities[c] !== null).length,
  };
}

/** The cell on a column at a row. */
export function cellAt(model: Pick<PrioritiesModel, 'columns'>, column: number, row: number): PriorityCell | null {
  return model.columns[column]?.cells[row] ?? null;
}

// ---------------------------------------------------------------------------
// The method
// ---------------------------------------------------------------------------

export interface MethodModel {
  /** Whether the screen offers the method at all: the campaign allows Sum to Ten, or the build already uses it. */
  shown: boolean;
  current: BuildMethod;
  /** The method the switch offers. */
  target: BuildMethod;
  /** The build uses a method the campaign does not (the validator's error), or null. */
  notAllowed: Issue | null;
  /** Switching is offered: back to the table always, to Sum to Ten only where the campaign allows it. */
  canSwitch: boolean;
  /** What the switch would do, for the confirm. */
  plan: MethodSwitchPlan;
  ref: Ref;
}

export interface MethodSwitchPlan {
  target: BuildMethod;
  /** The columns `setMethod` would empty. */
  emptied: PriorityColumn[];
}

/** What switching the method would do to the rows: the columns `setMethod` would empty. */
export function methodSwitchPlan(build: CharacterBuild, target: BuildMethod): MethodSwitchPlan {
  const next = setMethod(build, target);
  return { target, emptied: PRIORITY_COLUMNS.filter((c) => build.priorities[c] !== null && next.priorities[c] === null) };
}

/** The method section's model, from the campaign's toggle and the build's own issues. */
export function methodModel(build: CharacterBuild, settings: Pick<ChargenSettings, 'allowSumToTen'>, allIssues: readonly Issue[]): MethodModel {
  const current = build.method;
  const target: BuildMethod = current === 'priority' ? 'sumToTen' : 'priority';
  return {
    shown: settings.allowSumToTen || current === 'sumToTen',
    current,
    target,
    notAllowed: allIssues.find((i) => i.code === 'method-not-allowed') ?? null,
    canSwitch: target === 'priority' || settings.allowSumToTen,
    plan: methodSwitchPlan(build, target),
    ref: SUM_TO_TEN.ref,
  };
}

// ---------------------------------------------------------------------------
// Taps, as pure updaters
// ---------------------------------------------------------------------------

/** Put a row on a column (swapping under the Priority method). */
export function pickRow(column: PriorityColumn, level: PriorityLevel) {
  return (build: CharacterBuild): CharacterBuild => setPriority(build, column, level);
}

/** Put a concept card's rows back, column by column, through the same swap. */
export function applyRows(rows: Readonly<Record<PriorityColumn, PriorityLevel>>) {
  return (build: CharacterBuild): CharacterBuild =>
    PRIORITY_COLUMNS.reduce((next, column) => setPriority(next, column, rows[column]), build);
}

/** Switch the method. */
export function switchMethod(method: BuildMethod) {
  return (build: CharacterBuild): CharacterBuild => setMethod(build, method);
}

// ---------------------------------------------------------------------------
// Sentences the views share
// ---------------------------------------------------------------------------

/** "swaps with Skills, which takes C" / "takes it from Skills, which is left empty". */
export function swapSentence(swap: CellSwap): string {
  const other = COLUMN_LABEL[swap.column];
  return swap.takes ? `swaps with ${other}, which takes ${swap.takes}` : `takes it from ${other}, which is left empty`;
}

/** "swaps with Skills" — the grid's narrow form. */
export function swapShort(swap: CellSwap): string {
  return `swaps with ${COLUMN_LABEL[swap.column]}`;
}

/** "reopens step 3" / "reopens steps 3 and 6". */
export function breaksShort(breaks: CellBreaks): string {
  return breaks.steps.length === 1 ? `reopens step ${breaks.steps[0]}` : `reopens steps ${andList(breaks.steps.map(String))}`;
}

/** The grid's and the picker's short form of `PriorityCell.unused`. */
export const UNUSED_SHORT = 'Magic unused';

/** "Reopens step 6: 46 skill points spent; the priority gives 28. (and 1 more)" */
export function breaksSentence(breaks: CellBreaks): string {
  const more = breaks.count > 1 ? ` (and ${breaks.count - 1} more)` : '';
  return `${capital(breaksShort(breaks))}: ${breaks.first.message}${more}`;
}

/** "Metatype at B" — a cell's spoken place. */
export function cellPlace(cell: Pick<PriorityCell, 'column' | 'level'>): string {
  return `${COLUMN_LABEL[cell.column]} at ${cell.level}`;
}

/** Why a mundane runner's Magic row sits where it does, or what it is costing them. */
export function mundaneSentence(note: MundaneNote): string {
  if (note.kind === 'unused') {
    return `${note.issue.message} A mundane runner gets nothing from it: choose a kind of magic in step 4, or put Magic or Resonance at E and spend the row on another column.`;
  }
  return note.sumToTen
    ? `${note.title} is mundane, so Magic or Resonance sits at E: that row costs no points and gives no magic, which leaves all ten for the other four columns.`
    : `${note.title} is mundane, so Magic or Resonance sits at E: that row gives no magic, and every row above it buys more on the other four columns.`;
}

/** Who the metatype cells speak for, in a sentence. */
export function leanSentence(lean: MetatypeLean | null, concept: Pick<ConceptRows, 'title'> | null): string {
  if (!lean) return 'No metatype is chosen yet, so each Metatype cell lists the special points for all five.';
  if (lean.source === 'concept') {
    return `Metatype cells show special points for ${lean.row.name}, the ${concept?.title ?? 'concept'} card's suggestion; step 3 is where it is chosen.`;
  }
  return `Metatype cells show special points for ${lean.row.name}, the metatype chosen in step 3.`;
}

/** "3 of 5 columns have a row." */
export function filledSentence(filled: number): string {
  return filled === PRIORITY_COLUMNS.length
    ? 'All five columns have a row.'
    : `${filled} of ${PRIORITY_COLUMNS.length} columns have a row; each needs one before the next step.`;
}

/** How each method pays for the rows, in one line. */
export function methodLead(method: BuildMethod): string {
  return method === 'priority'
    ? 'The priority table: each column takes a different row, so choosing a row another column holds swaps the two.'
    : `Sum to Ten: rows may repeat, and each costs priority points — A ${SUM_TO_TEN.cost.A}, B ${SUM_TO_TEN.cost.B}, C ${SUM_TO_TEN.cost.C}, D ${SUM_TO_TEN.cost.D}, E ${SUM_TO_TEN.cost.E} — out of ${SUM_TO_TEN.points}.`;
}

/** The sentence a method switch asks the player to confirm. */
export function methodSwitchSentence(plan: MethodSwitchPlan): string {
  if (plan.target === 'sumToTen') {
    return `Under Sum to Ten, rows may repeat and each costs points — A ${SUM_TO_TEN.cost.A}, B ${SUM_TO_TEN.cost.B}, C ${SUM_TO_TEN.cost.C}, D ${SUM_TO_TEN.cost.D}, E ${SUM_TO_TEN.cost.E} — out of ${SUM_TO_TEN.points}. The rows you have now stay where they are.`;
  }
  const emptied = plan.emptied.map((c) => COLUMN_LABEL[c]);
  return emptied.length === 0
    ? 'The priority table uses each row once. Your rows already differ, so every column keeps its row.'
    : `The priority table uses each row once, so ${andList(emptied)} ${emptied.length === 1 ? 'repeats a row and is' : 'repeat a row and are'} left empty to choose again.`;
}

/** The switch button's words. */
export function methodSwitchLabel(target: BuildMethod): string {
  return target === 'sumToTen' ? 'use Sum to Ten' : 'use the priority table';
}

/**
 * This step's issues the screen lists below the table. An unset column is
 * already said by its own empty slot, and a method the campaign does not
 * allow by the method section, so neither is repeated.
 */
export function listedIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.code !== 'priority-unset' && i.code !== 'method-not-allowed');
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export interface GridPoint {
  row: number;
  col: number;
}

/**
 * Where a key moves focus in the grid (rows are A–E, columns the five
 * priorities): arrows one cell without wrapping, Home and End to the ends of
 * the row, Ctrl+Home and Ctrl+End to the corners; null for any other key.
 * Moving focus never picks — Enter or Space does — so arrowing across a
 * column does not swap rows on the way.
 */
export function gridKeyTarget(rows: number, cols: number, at: GridPoint, key: string, ctrl = false): GridPoint | null {
  if (rows <= 0 || cols <= 0) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max - 1);
  switch (key) {
    case 'ArrowRight':
      return { row: at.row, col: clamp(at.col + 1, cols) };
    case 'ArrowLeft':
      return { row: at.row, col: clamp(at.col - 1, cols) };
    case 'ArrowDown':
      return { row: clamp(at.row + 1, rows), col: at.col };
    case 'ArrowUp':
      return { row: clamp(at.row - 1, rows), col: at.col };
    case 'Home':
      return ctrl ? { row: 0, col: 0 } : { row: at.row, col: 0 };
    case 'End':
      return ctrl ? { row: rows - 1, col: cols - 1 } : { row: at.row, col: cols - 1 };
    default:
      return null;
  }
}

/** The grid's one tab stop: the first column's chosen row, else the top-left cell. */
export function gridTabStop(columns: readonly Pick<PriorityColumnModel, 'level'>[]): GridPoint {
  for (let col = 0; col < columns.length; col++) {
    const level = columns[col]!.level;
    if (level) return { row: PRIORITY_LEVELS.indexOf(level), col };
  }
  return { row: 0, col: 0 };
}

/** A column picker's one tab stop: its chosen row, else A. */
export function columnTabStop(column: Pick<PriorityColumnModel, 'level'>): number {
  return column.level ? PRIORITY_LEVELS.indexOf(column.level) : 0;
}
