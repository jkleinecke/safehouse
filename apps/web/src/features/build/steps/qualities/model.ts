/**
 * What the Qualities screen says and does, as plain functions (FR3.9,
 * docs/CHARGEN.md §4.4 Step 5, §8.1 and §8.4 "the validator whitelist") — no
 * JSX, no React, so every sentence, every refusal and every edit on the
 * screen is tested as a function under node.
 *
 * A quality on a build is a name, a Karma figure and hand-entered modifiers
 * with the page open beside them. The engine knows a short list of them
 * (`qualityRules.ts`) because they change creation itself — a raised
 * attribute maximum, a seventh skill rank, a second native language, a closed
 * skill group — and everything the screen says about those comes from that
 * list: the effect lines below are our own words for each rule *kind*, filled
 * with the rule's own numbers, so no quality's text is ever copied (DESIGN.md
 * §14) and no rule is restated here. The rest of the engine's answers are
 * used as they are:
 *
 * - **Pools** are `budgets().pools.positiveQualities / negativeQualities /
 *   karma`; the caps are their `available`.
 * - **What is wrong with a line** is every issue whose `path` points at it
 *   (`qualities.3`, `qualities.3.target`), whatever step the validator filed
 *   it under; what is wrong with the list as a whole stays a list of its own.
 * - **"Needs the GM"** is the validator's `approval-quality-…` issue for the
 *   line. Once the GM decides one the validator drops it (approved) or turns
 *   it into an error (denied), so the screen reads the undecided issues from
 *   a run with the decisions cleared and shows the decision beside each.
 * - **A refusal before the fact** is `probe(addQuality(q))`: of the errors
 *   the candidate would bring or make worse, the ones that belong to the
 *   quality itself — the exclusions (Lucky with Exceptional Attribute,
 *   Distinctive Style with Blandness), taken twice, a cap passed, a Magic or
 *   metatype fence, a rating or Karma the quality does not come in, a target
 *   not named — refuse with the validator's own sentence and page. Anything
 *   else it would flag elsewhere (a group Incompetent closes that step 6
 *   already bought) is said as a consequence, not a refusal.
 * - **Born with** is `bornQualities` / `isQualityBuyOff`: a metatype that is
 *   born with a whitelisted negative quality holds it for no Karma, and a
 *   positive line of that name buys it off.
 *
 * Edits are pure `CharacterBuild → CharacterBuild` updaters that check the
 * line they touch is still the line the screen showed (by index and name),
 * so a tap that lands after another device reordered the list does nothing
 * rather than removing the wrong quality.
 */
import {
  ATTRIBUTE_CODES,
  type ApprovalDecision,
  type BuildAttributeId,
  type BuildQuality,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
  type Modifier,
  type ModifierOp,
  type QualityType,
  type Ref,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_TABLE,
  CREATION_ATTRIBUTE_RULES,
  QUALITY_RULE_BY_ID,
  SKILL_GROUP_BY_ID,
  SKILL_GROUP_TABLE,
  activeSkillRow,
  bornQualities,
  catalogueQualityPrice,
  isQualityBuyOff,
  issueRule,
  metatypeRow,
  qualityRatingRange,
  qualityRuleFor,
  skillGroupRow,
  usesMagic,
  usesResonance,
  validate,
  type BuildRatings,
  type QualityEffects,
  type QualityRule,
  type QualityRuleEntry,
  type QualityRuleId,
} from '@safehouse/rules';
import { customHit, type CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import { qualityKarmaText } from '../../../sheet/rows.js';
import type { BuildProbe, BuildProber } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { hitRatingRange, type RatingRange } from '../../kit/catalogue.js';
import { hitQualityType, hitToQuality } from '../../kit/mappers.js';

export const QUALITY_SIDES: readonly QualityType[] = ['positive', 'negative'];

export const SIDE_TITLE: Readonly<Record<QualityType, string>> = {
  positive: 'Positive qualities',
  negative: 'Negative qualities',
};

/** The page the quality caps are printed on, as the validator cites it. */
export function qualityCapRef(type: QualityType): Ref | null {
  return issueRule(type === 'positive' ? 'positive-quality-cap' : 'negative-quality-cap')?.ref ?? null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The attributes Exceptional Attribute may name, in the metatype table's order. */
export const ATTRIBUTE_LABELS: Readonly<Record<Exclude<BuildAttributeId, 'edg'>, string>> = {
  bod: 'Body',
  agi: 'Agility',
  rea: 'Reaction',
  str: 'Strength',
  wil: 'Willpower',
  log: 'Logic',
  int: 'Intuition',
  cha: 'Charisma',
  mag: 'Magic',
  res: 'Resonance',
};

const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  combat: 'combat',
  physical: 'physical',
  social: 'social',
  magical: 'magical',
  resonance: 'resonance',
  technical: 'technical',
  vehicle: 'vehicle',
};

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[], joiner = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// What a whitelisted quality does, in our words
// ---------------------------------------------------------------------------

function doubledScope(rule: Extract<QualityRule, { kind: 'doublesCosts' }>): string {
  const skills = rule.scope.skillCategories.map((c) => CATEGORY_WORDS[c] ?? c);
  const parts: string[] = [];
  if (skills.length > 0) {
    const extras = [rule.scope.groups ? 'their groups' : null, rule.scope.specializations ? 'specialisations' : null].filter(
      (x): x is string => x !== null,
    );
    parts.push(`${listWords(skills)} skills${extras.length > 0 ? ` (with ${listWords(extras)})` : ''}`);
  }
  if (rule.scope.knowledgeCategories.length > 0) parts.push(`${listWords([...rule.scope.knowledgeCategories])} knowledge skills`);
  return listWords(parts);
}

/** One rule of a whitelisted quality as a sentence of ours, with the rule's numbers. */
export function ruleLine(rule: QualityRule): string {
  switch (rule.kind) {
    case 'attributeMaxPlusOne':
      return `One attribute you name may go ${CREATION_ATTRIBUTE_RULES.qualityMaxBonus} past its natural maximum (never Edge).`;
    case 'edgeMaxPlusOne':
      return `Edge may go ${CREATION_ATTRIBUTE_RULES.qualityMaxBonus} past its natural maximum; the points are still bought.`;
    case 'skillCapPlusOne':
      return 'One active skill you name may go one rating past the creation cap.';
    case 'extraNativeLanguage':
      return rule.count === 1
        ? 'A second native language, chosen on the Skills step.'
        : `${rule.count} more native languages, chosen on the Skills step.`;
    case 'overflowPerRating':
      return `One extra overflow box per rating, up to rating ${rule.max}, at ${rule.karmaPerRating} Karma a rating.`;
    case 'requiresAwakened':
      return rule.who === 'magicRating' ? 'Only for a runner with a Magic rating.' : 'Only for spellcasters and technomancers.';
    case 'forbiddenWithMagic':
      return 'Not for a runner with a Magic rating.';
    case 'metatypeGate':
      return `Only open to: ${rule.metatypes.map((id) => metatypeRow(id)?.name ?? id).join(', ')}.`;
    case 'barsGroup':
      return rule.groups === 'chosen'
        ? 'One skill group you name is closed to this runner.'
        : `Closed skill groups: ${rule.groups.map((id) => SKILL_GROUP_BY_ID[id]?.name ?? id).join(', ')}.`;
    case 'doublesCosts':
      return `Karma costs double for ${doubledScope(rule)}.`;
    case 'lifestyleMultiplierByRating':
      return `Lifestyle costs rise ${listWords(
        rule.levels.map((l) => `${Math.round((l.multiplier - 1) * 100)}%`),
        'or',
      )} by level, for ${listWords(
        rule.levels.map((l) => String(l.karma)),
        'or',
      )} Karma.`;
    case 'trainingTimeMultiplier':
      return `Training takes ${rule.factor}× as long.`;
    case 'cyberEssenceTimes2':
      return 'Cyberware costs twice the Essence.';
    case 'noBioware':
      return 'No bioware at all.';
    case 'exclusive':
      return `Cannot be held with ${listWords(
        rule.with.map((id) => QUALITY_RULE_BY_ID[id].name),
        'or',
      )}.`;
  }
}

/** Every rule of a whitelisted quality, in our words. */
export function effectLines(entry: QualityRuleEntry | null): string[] {
  return entry ? entry.rules.map(ruleLine) : [];
}

// ---------------------------------------------------------------------------
// Targets: which attribute, skill or group a quality names
// ---------------------------------------------------------------------------

export type TargetKind = 'attribute' | 'skill' | 'group';

/** What a whitelisted quality asks the player to name, if anything. */
export function targetKindOf(entry: QualityRuleEntry | null): TargetKind | null {
  for (const rule of entry?.rules ?? []) {
    if (rule.kind === 'attributeMaxPlusOne') return 'attribute';
    if (rule.kind === 'skillCapPlusOne') return 'skill';
    if (rule.kind === 'barsGroup' && rule.groups === 'chosen') return 'group';
  }
  return null;
}

export const TARGET_QUESTION: Readonly<Record<TargetKind, string>> = {
  attribute: 'Which attribute?',
  skill: 'Which active skill?',
  group: 'Which skill group?',
};

export interface TargetOption {
  value: string;
  label: string;
}

export interface TargetOptionGroup {
  label: string;
  options: readonly TargetOption[];
}

/**
 * The attributes Exceptional Attribute may lift, each with the maximum it
 * would open: the eight, and Magic or Resonance only where this runner uses
 * one — "Strength (natural maximum 10, 11 with this)".
 */
export function attributeTargetOptions(
  build: Pick<CharacterBuild, 'magic' | 'metatype'>,
  ratings: Pick<BuildRatings, 'attributes'>,
): TargetOption[] {
  const codes: Exclude<BuildAttributeId, 'edg'>[] = [...ATTRIBUTE_CODES];
  if (usesMagic(build)) codes.push('mag');
  if (usesResonance(build)) codes.push('res');
  return codes.map((code) => {
    const a = ratings.attributes[code];
    const lifted = a.tableMax + CREATION_ATTRIBUTE_RULES.qualityMaxBonus;
    return { value: code, label: `${ATTRIBUTE_LABELS[code]} (natural maximum ${a.tableMax}, ${lifted} with this)` };
  });
}

/** Active skills: the ones this runner has first, then every skill by name. */
export function skillTargetOptions(ratings: Pick<BuildRatings, 'skills'>): TargetOptionGroup[] {
  const held = new Set(ratings.skills.filter((s) => s.rating > 0 && s.row).map((s) => s.row!.id));
  const byName = [...ACTIVE_SKILL_TABLE].sort((a, b) => a.name.localeCompare(b.name));
  const groups: TargetOptionGroup[] = [];
  const mine = byName.filter((r) => held.has(r.id)).map((r) => ({ value: r.id, label: r.name }));
  if (mine.length > 0) groups.push({ label: 'Skills this runner has', options: mine });
  groups.push({ label: mine.length > 0 ? 'Every other skill' : 'Every skill', options: byName.filter((r) => !held.has(r.id)).map((r) => ({ value: r.id, label: r.name })) });
  return groups;
}

/** Skill groups by name. */
export function groupTargetOptions(): TargetOption[] {
  return [...SKILL_GROUP_TABLE].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: g.id, label: g.name }));
}

/**
 * The target a line names, as the value a picker holds: the engine's own
 * reading for Exceptional Attribute and Aptitude (`qualityEffects`, which
 * also reads "Exceptional Attribute (Strength)" off the name), the group
 * table's id for a group. Null when nothing usable is named.
 */
export function targetValueOf(
  kind: TargetKind,
  quality: BuildQuality,
  effects: Pick<QualityEffects, 'exceptionalAttribute' | 'aptitudeSkill'> | null,
): string | null {
  const text = quality.target?.trim() || /[([{]\s*([^)\]}]+?)\s*[)\]}]/.exec(quality.name)?.[1] || '';
  switch (kind) {
    case 'attribute':
      return effects?.exceptionalAttribute ?? null;
    case 'skill':
      return effects?.aptitudeSkill ?? (text ? (activeSkillRow(text)?.id ?? null) : null);
    case 'group':
      return text ? (skillGroupRow(text)?.id ?? null) : null;
  }
}

/** The target in words, for a read-only row. */
export function targetLabel(kind: TargetKind, value: string | null): string | null {
  if (!value) return null;
  switch (kind) {
    case 'attribute':
      return ATTRIBUTE_LABELS[value as Exclude<BuildAttributeId, 'edg'>] ?? value;
    case 'skill':
      return activeSkillRow(value)?.name ?? value;
    case 'group':
      return skillGroupRow(value)?.name ?? value;
  }
}

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

/** The line index an issue's path points at (`qualities.3`, `qualities.3.karma`), or null. */
export function qualityIndexOf(path: string | undefined): number | null {
  const m = /^qualities\.(\d+)(?:\.|$)/.exec(path ?? '');
  return m ? Number(m[1]) : null;
}

/** A GM decision the validator asks for on one line, and what the GM said so far. */
export interface QualityApproval {
  code: string;
  message: string;
  ref: Ref;
  decision: ApprovalDecision | null;
}

/** A step elsewhere a quality sends the player to. */
export interface QualityReminder {
  text: string;
  step: 3 | 4 | 6;
}

export interface QualityRowModel {
  index: number;
  quality: BuildQuality;
  /** The whitelist entry the name matches (a buy-off line's too, for its words). */
  entry: QualityRuleEntry | null;
  /** A positive line buying off a quality the metatype is born with. */
  buyOff: boolean;
  /** "costs 14 Karma", "gives 5 Karma", "costs 10 Karma to buy off". */
  karmaText: string;
  effects: string[];
  target: { kind: TargetKind; value: string | null } | null;
  /** Errors and warnings pointing at this line (not the GM's approval, which is `approval`). */
  problems: Issue[];
  approval: QualityApproval | null;
  reminders: QualityReminder[];
}

export interface QualityLists {
  positive: QualityRowModel[];
  negative: QualityRowModel[];
  /** This step's issues that point at no line (a cap, Lucky with Exceptional Attribute, an attribute waiting on a quality). */
  loose: Issue[];
}

export interface QualityListsInput {
  build: CharacterBuild;
  /** Every issue in the build, decisions applied (`StepProps.allIssues`). */
  allIssues: readonly Issue[];
  /** Every issue with the GM's decisions cleared, so an approval still shows once decided. Defaults to `allIssues`. */
  undecided?: readonly Issue[];
  /** This step's issues (`StepProps.issues`). */
  stepIssues: readonly Issue[];
  effects: Pick<QualityEffects, 'exceptionalAttribute' | 'aptitudeSkill'> | null;
}

const isApprovalCode = (code: string): boolean => code.startsWith('approval-');

function remindersFor(entry: QualityRuleEntry | null, build: CharacterBuild, target: string | null): QualityReminder[] {
  if (!entry) return [];
  const out: QualityReminder[] = [];
  for (const rule of entry.rules) {
    if (rule.kind === 'extraNativeLanguage') out.push({ text: 'Pick the second native language on the Skills step.', step: 6 });
    if (rule.kind === 'attributeMaxPlusOne' && target) {
      out.push({ text: `Spend the extra point of ${targetLabel('attribute', target)} on the attributes step.`, step: 3 });
    }
    if (rule.kind === 'skillCapPlusOne' && target) {
      out.push({ text: `Raise ${targetLabel('skill', target)} past the cap on the Skills step.`, step: 6 });
    }
  }
  if (entry.id === 'mentorSpirit' && !build.magic.mentor?.trim()) {
    out.push({ text: 'Name the mentor spirit on the Magic step.', step: 4 });
  }
  return out;
}

/** The two lists as the screen lays them out, each line with everything said beside it. */
export function qualityLists(input: QualityListsInput): QualityLists {
  const { build, allIssues, stepIssues, effects } = input;
  const undecided = input.undecided ?? allIssues;
  const rows: QualityRowModel[] = build.qualities.map((quality, index) => {
    const entry = qualityRuleFor(quality.name);
    const buyOff = isQualityBuyOff(quality, build.metatype);
    const kind = buyOff ? null : targetKindOf(entry);
    const value = kind ? targetValueOf(kind, quality, effects) : null;
    const approvalIssue = undecided.find(
      (i) => i.severity === 'approval' && i.code.startsWith('approval-quality') && qualityIndexOf(i.path) === index,
    );
    return {
      index,
      quality,
      entry,
      buyOff,
      // One formatter, shared with the sheet's Background tab
      // (`features/sheet/rows.ts`), so a quality reads the same before and
      // after approval. A build always records both, so it never reads null.
      karmaText: qualityKarmaText(quality, { buyOff }) ?? '',
      effects: buyOff ? [] : effectLines(entry),
      target: kind ? { kind, value } : null,
      problems: allIssues.filter((i) => qualityIndexOf(i.path) === index && i.severity !== 'approval' && !isApprovalCode(i.code)),
      approval: approvalIssue
        ? { code: approvalIssue.code, message: approvalIssue.message, ref: approvalIssue.ref, decision: build.approvals[approvalIssue.code] ?? null }
        : null,
      reminders: buyOff ? [] : remindersFor(entry, build, value),
    };
  });
  return {
    positive: rows.filter((r) => r.quality.type === 'positive'),
    negative: rows.filter((r) => r.quality.type === 'negative'),
    loose: stepIssues.filter((i) => qualityIndexOf(i.path) === null && i.severity !== 'approval'),
  };
}

/** The GM's decision in words, beside the "needs the GM" chip. */
export function approvalWords(decision: ApprovalDecision | null): string {
  if (decision === 'approved') return 'the GM approved it';
  if (decision === 'denied') return 'the GM said no';
  return 'waiting on the GM';
}

// ---------------------------------------------------------------------------
// Born with
// ---------------------------------------------------------------------------

export interface BornQualityModel {
  id: QualityRuleId;
  name: string;
  ref: Ref;
  /** The line that buys it off, when there is one. */
  buyOffIndex: number | null;
  effects: string[];
}

/** The whitelisted qualities the metatype is born with, and whether each is bought off. */
export function bornQualityModels(build: Pick<CharacterBuild, 'metatype' | 'qualities'>): BornQualityModel[] {
  return bornQualities(build.metatype).map((id) => {
    const entry = QUALITY_RULE_BY_ID[id];
    const at = build.qualities.findIndex((q) => isQualityBuyOff(q, build.metatype) && qualityRuleFor(q.name)?.id === id);
    return { id, name: entry.name, ref: entry.ref, buyOffIndex: at === -1 ? null : at, effects: effectLines(entry) };
  });
}

/**
 * What the metatype itself costs in Karma at its priority row, which the
 * Karma pool pays and the positive cap does not count — or null for a
 * metatype that costs none.
 */
export function metatypeKarmaNote(
  build: Pick<CharacterBuild, 'priorities'>,
  ratings: Pick<BuildRatings, 'metatype'>,
): { text: string; karma: number; ref: Ref } | null {
  const row = ratings.metatype;
  const level = build.priorities.metatype;
  if (!row || !level) return null;
  const cell = row.priority[level];
  if (!cell || cell.karma <= 0) return null;
  return {
    karma: cell.karma,
    ref: cell.ref,
    text: `The ${row.name.toLowerCase()} metatype costs ${cell.karma} Karma at priority ${level}. The Karma pool pays it; it does not count toward the positive cap.`,
  };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

type Updater = (build: CharacterBuild) => CharacterBuild;

/** Whether the line at `index` is still the one named — so a stale tap does nothing. */
function sameLine(build: CharacterBuild, index: number, name: string): boolean {
  return build.qualities[index]?.name === name;
}

function mapLine(index: number, name: string, fn: (q: BuildQuality) => BuildQuality): Updater {
  return (build) => {
    if (!sameLine(build, index, name)) return build;
    return { ...build, qualities: build.qualities.map((q, i) => (i === index ? fn(q) : q)) };
  };
}

export function addQuality(quality: BuildQuality): Updater {
  return (build) => ({ ...build, qualities: [...build.qualities, quality] });
}

export function removeQuality(index: number, name: string): Updater {
  return (build) => (sameLine(build, index, name) ? { ...build, qualities: build.qualities.filter((_, i) => i !== index) } : build);
}

export function setQualityTarget(index: number, name: string, target: string | null): Updater {
  return mapLine(index, name, (q) => {
    const { target: _old, ...rest } = q;
    return target && target.trim() ? { ...rest, target: target.trim() } : rest;
  });
}

export function addQualityMod(index: number, name: string, mod: Modifier): Updater {
  return mapLine(index, name, (q) => ({ ...q, mods: [...q.mods, mod] }));
}

export function removeQualityMod(index: number, name: string, modId: string): Updater {
  return mapLine(index, name, (q) => ({ ...q, mods: q.mods.filter((m) => m.id !== modId) }));
}

// ---------------------------------------------------------------------------
// Refusing before the fact
// ---------------------------------------------------------------------------

/**
 * The validator's codes that belong to a quality itself: a candidate that
 * brings one of these (or makes one worse) is refused with its sentence.
 */
export const REFUSING_CODES: ReadonlySet<string> = new Set([
  'lucky-and-exceptional',
  'quality-exclusive',
  'quality-once',
  'positive-quality-cap',
  'negative-quality-cap',
  'quality-requires-magic',
  'quality-requires-caster',
  'quality-forbidden-with-magic',
  'quality-metatype-gate',
  'quality-racial-held',
  'quality-rating-range',
  'quality-karma-mismatch',
  'quality-type-mismatch',
  'exceptional-attribute-target',
  'aptitude-target',
  'incompetent-target',
]);

/** The pool the rail and the quote beside the button already say, so it is not said a third time. */
const SAID_ELSEWHERE: ReadonlySet<string> = new Set(['karma-overspent']);

export interface CandidateVerdict {
  /** Why the candidate cannot be taken: the validator's issues, each with its sentence and page. */
  refusals: Issue[];
  /** Other errors it would bring, on whatever step owns them. */
  breaks: Issue[];
}

const issueKey = (i: Issue): string => `${i.code}|${i.step}|${i.path ?? ''}`;

/**
 * Read a probe of a candidate change. A refusal is an error of the quality's
 * own the changed record would have that the record does not have word for
 * word — new, or the same code made worse ("cost 30 Karma" becoming "cost
 * 35"; adding only ever adds). A consequence is an error elsewhere the change
 * brings in new; one it only rewords (less Karma left to carry) is not news.
 */
export function candidateVerdict(probe: Pick<BuildProbe, 'blocking'>, current: readonly Issue[]): CandidateVerdict {
  const keys = new Set(current.map(issueKey));
  const sentences = new Set(current.map((i) => `${issueKey(i)}|${i.message}`));
  return {
    refusals: probe.blocking.filter((i) => REFUSING_CODES.has(i.code) && !sentences.has(`${issueKey(i)}|${i.message}`)),
    breaks: probe.blocking.filter((i) => !REFUSING_CODES.has(i.code) && !SAID_ELSEWHERE.has(i.code) && !keys.has(issueKey(i))),
  };
}

/** An issue as a refusing control's reason. */
export function toRefusal(issue: Pick<Issue, 'message' | 'ref'>): Refusal {
  return { reason: issue.message, ref: issue.ref };
}

/**
 * Why a stepper may not go one further: a refusal the next value brings that
 * the current value does not. `ignore` leaves out codes the next value passes
 * through on its way somewhere legal — a band of 3, 6 or 9 Karma steps
 * through 4 and 5, which the add button, not the stepper, refuses.
 */
export function increaseRefusal(now: CandidateVerdict, next: CandidateVerdict, ignore: readonly string[] = []): Refusal | null {
  const seen = new Set(now.refusals.map((i) => i.message));
  const hit = next.refusals.find((i) => !ignore.includes(i.code) && !seen.has(i.message));
  return hit ? toRefusal(hit) : null;
}

/**
 * Every issue with the GM's decisions on qualities cleared, so a line the GM
 * already approved (whose issue the validator drops) still shows what was
 * decided. Only re-validates when there is a decision to clear.
 */
export function undecidedIssues(build: CharacterBuild, settings: ChargenSettings, allIssues: readonly Issue[]): readonly Issue[] {
  const decided = Object.keys(build.approvals).filter((code) => code.startsWith('approval-quality'));
  if (decided.length === 0) return allIssues;
  const approvals = { ...build.approvals };
  for (const code of decided) delete approvals[code];
  return validate({ ...build, approvals }, settings);
}

// ---------------------------------------------------------------------------
// Adding: what a picked row still needs to know
// ---------------------------------------------------------------------------

/** A quality being added: the row, and the answers to what it asks. */
export interface PendingQuality {
  hit: CatalogueHit;
  /** For a quality priced per rating. */
  rating: number;
  /** For a quality priced as a band or a list; null takes the lowest. */
  karma: number | null;
  /** For a row that does not say which it is. */
  type: QualityType;
  /** For a quality that names an attribute, skill or group ('' until chosen). */
  target: string;
}

export interface PendingNeeds {
  entry: QualityRuleEntry | null;
  rating: RatingRange | null;
  /** A band ("4 to 20"): any whole Karma between the bounds. */
  band: { min: number; max: number } | null;
  /** A list ("7 or 14"): only these amounts, ascending. */
  choices: readonly number[] | null;
  askType: boolean;
  target: TargetKind | null;
}

/**
 * What a row asks before it can be added. A quality whose rating the engine
 * reads (Will to Live, Dependents — `qualityRatingRange`) asks only for what
 * the validator accepts: a row printed as a band ("3 to 9") becomes the
 * levels' amounts to choose from, not a stepper through 4 and 5 that the add
 * button would refuse, and a rating the row prints no top for stops at the
 * engine's.
 */
export function pendingNeeds(hit: CatalogueHit): PendingNeeds {
  const price = catalogueQualityPrice(hit.stats);
  const entry = qualityRuleFor(hit.name);
  const levels = qualityRatingRange(entry);
  const printed = hitRatingRange(hit);
  let band = price.karma !== null && typeof price.karma === 'object' && !price.choices ? price.karma : null;
  let choices: readonly number[] | null = price.karma !== null && typeof price.karma === 'object' && price.choices ? price.choices : null;
  if (levels && band) {
    const within = levels.levels.map((l) => l.karma).filter((k) => k >= band!.min && k <= band!.max);
    if (within.length > 0) {
      choices = within;
      band = null;
    }
  }
  const rating = printed && levels ? { min: printed.min, max: printed.max === null ? levels.max : Math.min(printed.max, levels.max) } : printed;
  return {
    entry,
    rating,
    band,
    choices,
    askType: price.type === null,
    target: targetKindOf(entry),
  };
}

/** Whether a row can be added with no questions (it may still be refused). */
export function asksNothing(needs: PendingNeeds): boolean {
  return needs.rating === null && needs.band === null && needs.choices === null && !needs.askType && needs.target === null;
}

/** The side a row most likely sits on when it does not say: the kit's one reading (`hitQualityType`), positive when nothing says. */
function likelyType(hit: CatalogueHit): QualityType {
  return hitQualityType(hit) ?? 'positive';
}

export function startPending(hit: CatalogueHit, over: Partial<Omit<PendingQuality, 'hit'>> = {}): PendingQuality {
  return { hit, rating: 1, karma: null, type: likelyType(hit), target: '', ...over };
}

/** The line a pending quality would add. Throws when the row cannot make a legal line (the contract refuses it). */
export function pendingQuality(p: PendingQuality): BuildQuality {
  const needs = pendingNeeds(p.hit);
  const line = hitToQuality(p.hit, {
    ...(needs.rating ? { rating: p.rating } : {}),
    ...(p.karma !== null ? { karma: p.karma } : {}),
    type: p.type,
  });
  return needs.target && p.target.trim() ? { ...line, target: p.target.trim() } : line;
}

/** The probe key for a pending quality, so a render asks the validator once per answer. */
export function pendingKey(p: PendingQuality, over: Partial<Pick<PendingQuality, 'rating' | 'karma'>> = {}): string {
  const rating = over.rating ?? p.rating;
  const karma = over.karma !== undefined ? over.karma : p.karma;
  // A hand-written row's id is always "custom": its name, printed Karma and page are what tell two apart.
  const row = `${p.hit.id}|${p.hit.name}|${JSON.stringify(p.hit.stats)}|${p.hit.bookCode}|${p.hit.printedPage}`;
  return `quality-add|${row}|${rating}|${karma ?? ''}|${p.type}|${p.target}`;
}

/** Everything the add panel shows for a pending quality, read off the engine. */
export interface PendingReading {
  needs: PendingNeeds;
  /** The line it would add; null when the row cannot make one. */
  line: BuildQuality | null;
  /** Why the row cannot make a line, in words. */
  lineError: string | null;
  verdict: CandidateVerdict;
  /** Why the rating may not go one higher. */
  ratingRefusal: Refusal | null;
  /** Why the chosen Karma may not go one higher inside its band. */
  bandRefusal: Refusal | null;
  /** A list price's amounts, each with what taking it at that amount would refuse on. */
  choiceReadings: readonly { karma: number; refusal: Refusal | null }[];
  /** Whether the add button takes it. */
  canAdd: boolean;
}

const NO_VERDICT: CandidateVerdict = { refusals: [], breaks: [] };

function verdictFor(p: PendingQuality, probe: BuildProber, current: readonly Issue[], over: Partial<Pick<PendingQuality, 'rating' | 'karma'>> = {}): CandidateVerdict {
  let line: BuildQuality;
  try {
    line = pendingQuality({ ...p, ...over });
  } catch {
    return NO_VERDICT;
  }
  return candidateVerdict(probe(addQuality(line), pendingKey(p, over)), current);
}

/**
 * Read a pending quality against the build: the line it makes, what adding
 * it would refuse on or break, and whether its rating or Karma may go one
 * higher — each a probe, keyed so a render asks once per answer.
 */
export function readPending(p: PendingQuality, probe: BuildProber, current: readonly Issue[]): PendingReading {
  const needs = pendingNeeds(p.hit);
  let line: BuildQuality | null = null;
  let lineError: string | null = null;
  try {
    line = pendingQuality(p);
  } catch (err) {
    lineError = err instanceof Error && !/^\s*\[/.test(err.message) ? err.message : 'This row cannot be added as a quality.';
  }
  const verdict = line ? verdictFor(p, probe, current) : NO_VERDICT;
  let ratingRefusal: Refusal | null = null;
  if (line && needs.rating && (needs.rating.max === null || p.rating < needs.rating.max)) {
    ratingRefusal = increaseRefusal(verdict, verdictFor(p, probe, current, { rating: p.rating + 1 }));
  }
  let bandRefusal: Refusal | null = null;
  if (line && needs.band) {
    const karma = line.karma;
    if (karma < needs.band.max) {
      bandRefusal = increaseRefusal(verdict, verdictFor(p, probe, current, { karma: karma + 1 }), ['quality-karma-mismatch']);
    }
  }
  const choiceReadings = line && needs.choices
    ? needs.choices.map((karma) => {
        const at = karma === line!.karma ? verdict : verdictFor(p, probe, current, { karma });
        const first = at.refusals[0];
        return { karma, refusal: first ? toRefusal(first) : null };
      })
    : [];
  return { needs, line, lineError, verdict, ratingRefusal, bandRefusal, choiceReadings, canAdd: line !== null && verdict.refusals.length === 0 };
}

/**
 * The line a picked row adds straight away, with no panel: one that asks
 * nothing, refuses on nothing and flags nothing elsewhere. Null when the
 * player should see the panel first.
 */
export function quickAdd(reading: PendingReading): BuildQuality | null {
  return asksNothing(reading.needs) && reading.canAdd && reading.verdict.breaks.length === 0 ? reading.line : null;
}

/** Catalogue rows the build already holds a once-only quality from: listed in the picker as taken. */
export function takenCatalogueIds(build: Pick<CharacterBuild, 'qualities'>): Set<string> {
  const out = new Set<string>();
  for (const q of build.qualities) if (q.catalogueId && qualityRuleFor(q.name)?.once) out.add(q.catalogueId);
  return out;
}

/** What the screen says once a line lands, for the status region. */
export function addedNote(line: Pick<BuildQuality, 'name' | 'type'>): string {
  return `Added ${line.name} to the ${line.type} qualities.`;
}

// ---------------------------------------------------------------------------
// Write your own
// ---------------------------------------------------------------------------

export interface CustomQualityDraft {
  name: string;
  type: QualityType;
  karma: string;
  book: string;
  page: string;
}

export const EMPTY_CUSTOM_QUALITY: CustomQualityDraft = { name: '', type: 'positive', karma: '', book: '', page: '' };

/** What stops a hand-written quality being added, in words; null when it may be. */
export function customQualityProblem(d: CustomQualityDraft): string | null {
  if (!d.name.trim()) return 'Give the quality a name.';
  if (!/^\d{1,3}$/.test(d.karma.trim())) return 'Karma is a whole number, 0 or more.';
  if (d.page.trim() && !/^\d{1,4}$/.test(d.page.trim())) return 'The page is a printed page number.';
  if (d.page.trim() && !d.book.trim()) return 'Say which book the page is in.';
  return null;
}

/** A hand-written quality as a row the kit's mapper takes; null while it has a problem. */
export function customQualityHit(d: CustomQualityDraft): CatalogueHit | null {
  if (customQualityProblem(d)) return null;
  const page = Number(d.page.trim());
  return customHit({
    kind: 'quality',
    name: d.name,
    stats: { KARMA: String(Number(d.karma.trim())), TYPE: d.type },
    ref: d.book.trim() && page >= 1 ? { book: d.book, page } : null,
  });
}

/** A buy-off drafted: the born quality's name on the positive side. */
export function buyOffDraft(born: Pick<BornQualityModel, 'name' | 'ref'>): CustomQualityDraft {
  return { name: born.name, type: 'positive', karma: '', book: born.ref.book, page: String(born.ref.page) };
}

// ---------------------------------------------------------------------------
// Hand-entered modifiers
// ---------------------------------------------------------------------------

export interface ModTargetGroup {
  label: string;
  options: readonly TargetOption[];
}

const ATTR_TARGETS: TargetOption[] = [
  ...ATTRIBUTE_CODES.map((c) => ({ value: `attr.${c}`, label: ATTRIBUTE_LABELS[c] })),
  { value: 'attr.ess', label: 'Essence' },
  { value: 'attr.mag', label: 'Magic' },
  { value: 'attr.res', label: 'Resonance' },
];

/**
 * The numbers a hand-entered modifier can move — the targets the derive
 * pipeline reads (`derive.ts`, `derive-pools.ts`), in our words, grouped.
 */
export const MOD_TARGET_GROUPS: readonly ModTargetGroup[] = [
  { label: 'Attributes', options: ATTR_TARGETS },
  {
    label: 'Limits',
    options: [
      { value: 'limit.physical', label: 'Physical limit' },
      { value: 'limit.mental', label: 'Mental limit' },
      { value: 'limit.social', label: 'Social limit' },
    ],
  },
  {
    label: 'Initiative',
    options: [
      { value: 'initiative.score', label: 'Initiative score' },
      { value: 'initiative.dice', label: 'Initiative dice' },
      { value: 'initiative.astral.score', label: 'Astral initiative score' },
      { value: 'initiative.astral.dice', label: 'Astral initiative dice' },
    ],
  },
  {
    label: 'Condition monitors',
    options: [
      { value: 'monitor.physical', label: 'Physical boxes' },
      { value: 'monitor.stun', label: 'Stun boxes' },
      { value: 'monitor.overflow', label: 'Overflow boxes' },
    ],
  },
  {
    label: 'Dice pools',
    options: [
      { value: 'pool.all', label: 'Every dice pool' },
      { value: 'pool.defense', label: 'Defense pool' },
      { value: 'pool.soak', label: 'Damage resistance pool' },
      ...[...ACTIVE_SKILL_TABLE].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ value: `pool.skill.${r.id}`, label: `${r.name} pool` })),
    ],
  },
  {
    label: 'Other',
    options: [
      { value: 'armor', label: 'Armor' },
      { value: 'movement.walk', label: 'Walking rate' },
      { value: 'movement.run', label: 'Running rate' },
    ],
  },
];

const MOD_TARGET_LABEL = new Map(MOD_TARGET_GROUPS.flatMap((g) => g.options.map((o) => [o.value, o.label] as const)));

export function modTargetLabel(target: string): string {
  return MOD_TARGET_LABEL.get(target) ?? target;
}

export const MOD_OPS: readonly { value: ModifierOp; label: string }[] = [
  { value: 'add', label: 'add' },
  { value: 'set', label: 'set to' },
  { value: 'cap', label: 'cap at' },
];

/** A modifier in words: "+1 Physical limit", "Initiative dice set to 2", "Armor capped at 10". */
export function modLine(mod: Pick<Modifier, 'target' | 'op' | 'value'>): string {
  const label = modTargetLabel(mod.target);
  if (mod.op === 'set') return `${label} set to ${mod.value}`;
  if (mod.op === 'cap') return `${label} capped at ${mod.value}`;
  return `${mod.value >= 0 ? '+' : '−'}${Math.abs(mod.value)} ${label}`;
}

export interface ModDraft {
  target: string;
  op: ModifierOp;
  value: string;
}

export const EMPTY_MOD_DRAFT: ModDraft = { target: 'pool.all', op: 'add', value: '1' };

/** What stops a modifier draft being added, in words; null when it may be. */
export function modDraftProblem(d: ModDraft): string | null {
  if (!MOD_TARGET_LABEL.has(d.target)) return 'Pick what the modifier changes.';
  const text = d.value.trim().replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 'The value is a number, like 1, -2 or 0.5.';
  if (d.op === 'add' && Number(text) === 0) return 'Adding 0 changes nothing.';
  return null;
}

/** A modifier from a draft, sourced to the quality the way the compile sources its own. */
export function modFromDraft(quality: Pick<BuildQuality, 'name'>, d: ModDraft, id: string): Modifier | null {
  if (modDraftProblem(d)) return null;
  return {
    id,
    source: { kind: 'quality', ref: quality.name },
    target: d.target,
    op: d.op,
    value: Number(d.value.trim().replace('−', '-')),
    active: true,
    note: quality.name,
  };
}

/** A fresh modifier id: random where the platform has it, unique enough otherwise. */
export function newModifierId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return `chargen.quality.${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}
