/**
 * What the Skills screen says and does, as plain functions (FR3.9,
 * docs/CHARGEN.md §4.4 Step 6) — no JSX, no React, so every edit, every
 * reading and every refusal on the screen is tested as a function under node.
 *
 * The screen is the p. 90 skill list with the build laid over it. The list
 * itself is the engine's (`SKILL_GROUP_TABLE`, `ACTIVE_SKILL_TABLE`,
 * `KNOWLEDGE_CATEGORY_TABLE`); what each row holds is the engine's
 * `ratings` (points, the group a skill is rated through, a Magic column
 * grant, Karma raises, the creation maximum — 7 for the Aptitude skill); who
 * may take a row is `skillEligibilityIn` / `groupEligibilityIn`; the pools
 * are `budgets`; the dice are `preview.derived`. This module adds three
 * things the engine deliberately does not carry:
 *
 * - **The edits**, as pure `CharacterBuild → CharacterBuild` field sets. A
 *   build stores points, never ratings (§4.1), so a stepper showing
 *   "Pistols 4" writes `points: 4 − grant`, a skill that drops back to
 *   nothing leaves the list rather than lingering at zero, and the "specific"
 *   skills (Exotic Melee and Ranged Weapon, Pilot Exotic Vehicle) keep one
 *   entry per weapon or vehicle, removed only on purpose.
 * - **Which of a probe's errors shut which control.** A probe sees the whole
 *   build, so raising a skill "introduces" an overspend on the pool as surely
 *   as it introduces rating 7. Overspending is not refused here — with a
 *   stepper on every one of seventy-five skills the refusal would print the
 *   same sentence under each, and the pool line, the rail and Next say it
 *   once — while a cap always is: the creation maximum, a fence on the row,
 *   a second native language without Bilingual, a specialisation left with no
 *   rating under it. An error the change makes *worse* counts as well as a
 *   new one, so the comparison is by message, not only by code and path.
 * - **Where the step's issues sit on the screen**, by the validator's own
 *   `path`: an issue about one skill under that skill, a pool's under its
 *   pool line, the rest in a list at the end so nothing is dropped.
 *
 * The only arithmetic here is presentation of the engine's own numbers: the
 * knowledge pool quoted as "(INT 3 + LOG 4) × 2 = 14" from `ratings` and the
 * engine's per-point constant, and what a change would cost read as the
 * difference between `budgets` before and after it — never a price table of
 * our own, so Uncouth's or Uneducated's doubling shows up in the quote the
 * moment the engine applies it.
 *
 * Every word here is ours; numbers, ids and pages are the engine's (DESIGN.md
 * §14).
 */
import {
  KNOWLEDGE_CATEGORIES,
  type BudgetPool,
  type Budgets,
  type BuildActiveSkill,
  type BuildKnowledgeSkill,
  type BuildLanguage,
  type CharacterBuild,
  type ChargenSettings,
  type DerivedCharacter,
  type Issue,
  type KnowledgeCategory,
  type LimitKind,
  type SkillAttr,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_TABLE,
  CREATION_SKILL_RULES,
  KNOWLEDGE_CATEGORY_TABLE,
  SKILL_GROUP_BY_ID,
  SKILL_GROUP_TABLE,
  activeSkillRow,
  budgets as engineBudgets,
  eligibilityMessage,
  freeKnowledgePoints,
  groupEligibilityIn,
  skillEligibilityIn,
  skillGroupRow,
  type ActiveSkillRow,
  type BuildRatings,
  type Eligibility,
  type EligibilityContext,
  type GroupRating,
  type KnowledgeRating,
  type LanguageRating,
  type SkillGroupRow,
  type SkillRating,
} from '@safehouse/rules';
import type { BuildProbe } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The p. 90 headings, in the table's order. */
export const ATTRIBUTE_HEADINGS: ReadonlyArray<{ attr: SkillAttr; title: string; short: string }> = [
  { attr: 'agi', title: 'Agility', short: 'AGI' },
  { attr: 'bod', title: 'Body', short: 'BOD' },
  { attr: 'rea', title: 'Reaction', short: 'REA' },
  { attr: 'str', title: 'Strength', short: 'STR' },
  { attr: 'cha', title: 'Charisma', short: 'CHA' },
  { attr: 'int', title: 'Intuition', short: 'INT' },
  { attr: 'log', title: 'Logic', short: 'LOG' },
  { attr: 'wil', title: 'Willpower', short: 'WIL' },
  { attr: 'mag', title: 'Magic', short: 'MAG' },
  { attr: 'res', title: 'Resonance', short: 'RES' },
];

export const CATEGORY_WORDS: Readonly<Record<KnowledgeCategory, { title: string; noun: string }>> = {
  academic: { title: 'Academic', noun: 'academic knowledge' },
  interests: { title: 'Interests', noun: 'interest' },
  professional: { title: 'Professional', noun: 'professional knowledge' },
  street: { title: 'Street', noun: 'street knowledge' },
};

export const CATEGORY_ORDER: readonly KnowledgeCategory[] = KNOWLEDGE_CATEGORIES;

const LIMIT_WORDS: Readonly<Record<LimitKind, string>> = {
  physical: 'Physical',
  mental: 'Mental',
  social: 'Social',
  accuracy: 'Accuracy',
  force: 'Force',
};

export function attributeShort(attr: SkillAttr): string {
  return ATTRIBUTE_HEADINGS.find((h) => h.attr === attr)?.short ?? attr.toUpperCase();
}

/** What a specific skill is for: a weapon or a vehicle. */
export function targetNoun(row: Pick<ActiveSkillRow, 'id'>): 'weapon' | 'vehicle' {
  return row.id === 'pilot-exotic-vehicle' ? 'vehicle' : 'weapon';
}

/** "Exotic Ranged Weapon (dart thrower)", or the plain name. */
export function skillLabel(row: Pick<ActiveSkillRow, 'name'>, target?: string | null): string {
  const t = target?.trim();
  return t ? `${row.name} (${t})` : row.name;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Edits — pure field sets over `skills`
// ---------------------------------------------------------------------------

/** Where a skill edit lands: a build entry by index, or a new entry for `id`. */
export interface EntryRef {
  id: string;
  index: number | null;
}

const canonicalSkill = (id: string): string => activeSkillRow(id)?.id ?? id;
const canonicalGroup = (id: string): string => skillGroupRow(id)?.id ?? id;

/** A typed specialisation as the record keeps it: the text as typed, or null when blank. */
export function specValue(text: string | null | undefined): string | null {
  return text && text.trim() ? text : null;
}

function withSkills(build: CharacterBuild, skills: Partial<CharacterBuild['skills']>): CharacterBuild {
  return { ...build, skills: { ...build.skills, ...skills } };
}

const emptyEntry = (e: BuildActiveSkill): boolean => e.points === 0 && !e.spec?.trim() && !e.target?.trim();

/**
 * Patch one active skill entry. An ordinary skill left with no points and no
 * specialisation leaves the list; a specific skill's entry stays until it is
 * removed, because it names a weapon or vehicle the player is still filling in.
 */
export function patchActive(
  build: CharacterBuild,
  ref: EntryRef,
  patch: Partial<Pick<BuildActiveSkill, 'points' | 'spec' | 'target'>>,
): CharacterBuild {
  const id = canonicalSkill(ref.id);
  const specific = activeSkillRow(id)?.specific ?? false;
  const prune = !specific;
  const list = build.skills.active;
  // An ordinary skill has one entry: a slot that thinks it is new (or points
  // at a row that has moved) still lands on it rather than listing it twice.
  const at =
    ref.index !== null && list[ref.index] && canonicalSkill(list[ref.index]!.id) === id
      ? ref.index
      : specific
        ? -1
        : list.findIndex((e) => canonicalSkill(e.id) === id);
  const current = at >= 0 ? list[at] : undefined;
  if (current) {
    const next: BuildActiveSkill = { ...current, ...patch };
    const active = prune && emptyEntry(next) ? list.filter((_, i) => i !== at) : list.map((e, i) => (i === at ? next : e));
    return withSkills(build, { active });
  }
  const created: BuildActiveSkill = { id, points: 0, spec: null, ...patch };
  if (prune && emptyEntry(created)) return build;
  return withSkills(build, { active: [...list, created] });
}

export function setActivePoints(build: CharacterBuild, ref: EntryRef, points: number): CharacterBuild {
  return patchActive(build, ref, { points: Math.max(0, Math.trunc(points)) });
}

export function setActiveSpec(build: CharacterBuild, ref: EntryRef, spec: string): CharacterBuild {
  return patchActive(build, ref, { spec: specValue(spec) });
}

export function setActiveTarget(build: CharacterBuild, ref: EntryRef, target: string): CharacterBuild {
  return patchActive(build, ref, { target });
}

/** Another weapon or vehicle for a specific skill: a blank entry to name. */
export function addSpecificEntry(build: CharacterBuild, id: string): CharacterBuild {
  return withSkills(build, { active: [...build.skills.active, { id: canonicalSkill(id), points: 0, spec: null, target: '' }] });
}

export function removeActiveEntry(build: CharacterBuild, index: number): CharacterBuild {
  if (!build.skills.active[index]) return build;
  return withSkills(build, { active: build.skills.active.filter((_, i) => i !== index) });
}

/**
 * Give back a skill's own points and specialisation — what a member of a
 * group bought afterwards needs, since a group cannot be broken at creation.
 */
export function returnActivePoints(build: CharacterBuild, index: number): CharacterBuild {
  const entry = build.skills.active[index];
  if (!entry) return build;
  return patchActive(build, { id: entry.id, index }, { points: 0, spec: null });
}

/** A group's points; zero takes the group off the list. */
export function setGroupPoints(build: CharacterBuild, id: string, points: number): CharacterBuild {
  const key = canonicalGroup(id);
  const n = Math.max(0, Math.trunc(points));
  const list = build.skills.groups;
  const index = list.findIndex((g) => canonicalGroup(g.id) === key);
  if (index < 0) return n === 0 ? build : withSkills(build, { groups: [...list, { id: key, points: n }] });
  const groups = n === 0 ? list.filter((_, i) => i !== index) : list.map((g, i) => (i === index ? { ...g, points: n } : g));
  return withSkills(build, { groups });
}

export function addKnowledge(build: CharacterBuild, category: KnowledgeCategory): CharacterBuild {
  const entry: BuildKnowledgeSkill = { name: '', category, points: 0, skillPoints: 0, spec: null };
  return withSkills(build, { knowledge: [...build.skills.knowledge, entry] });
}

export function patchKnowledge(
  build: CharacterBuild,
  index: number,
  patch: Partial<Pick<BuildKnowledgeSkill, 'name' | 'category' | 'points' | 'skillPoints' | 'spec'>>,
): CharacterBuild {
  const list = build.skills.knowledge;
  if (!list[index]) return build;
  const clean = { ...patch, ...('spec' in patch ? { spec: specValue(patch.spec) } : {}) };
  return withSkills(build, { knowledge: list.map((k, i) => (i === index ? { ...k, ...clean } : k)) });
}

export function removeKnowledge(build: CharacterBuild, index: number): CharacterBuild {
  if (!build.skills.knowledge[index]) return build;
  return withSkills(build, { knowledge: build.skills.knowledge.filter((_, i) => i !== index) });
}

export function addLanguage(build: CharacterBuild, native: boolean): CharacterBuild {
  const entry: BuildLanguage = { name: '', native, points: 0, skillPoints: 0, spec: null };
  return withSkills(build, { languages: [...build.skills.languages, entry] });
}

export function patchLanguage(
  build: CharacterBuild,
  index: number,
  patch: Partial<Pick<BuildLanguage, 'name' | 'native' | 'points' | 'skillPoints' | 'spec'>>,
): CharacterBuild {
  const list = build.skills.languages;
  if (!list[index]) return build;
  const clean = { ...patch, ...('spec' in patch ? { spec: specValue(patch.spec) } : {}) };
  return withSkills(build, { languages: list.map((l, i) => (i === index ? { ...l, ...clean } : l)) });
}

export function removeLanguage(build: CharacterBuild, index: number): CharacterBuild {
  if (!build.skills.languages[index]) return build;
  return withSkills(build, { languages: build.skills.languages.filter((_, i) => i !== index) });
}

// ---------------------------------------------------------------------------
// Readings — the list with the build laid over it
// ---------------------------------------------------------------------------

export interface GroupLine {
  row: SkillGroupRow;
  /** Every build entry for this group (more than one only on a record that lists it twice). */
  indices: readonly number[];
  eligibility: Eligibility;
  /** The engine's rating for the group; null when the build has none. */
  rating: GroupRating | null;
  /** Grant + points: what the stepper shows (Karma raises are step 8's). */
  own: number;
  grant: number;
  karma: number;
  memberNames: readonly string[];
  mine: boolean;
}

export function groupLines(build: CharacterBuild, ratings: BuildRatings, ctx: EligibilityContext): GroupLine[] {
  return SKILL_GROUP_TABLE.map((row) => {
    const indices = build.skills.groups.flatMap((g, i) => (canonicalGroup(g.id) === row.id ? [i] : []));
    const rating = ratings.groups.find((g) => g.id === row.id) ?? null;
    const grant = rating?.grant ?? 0;
    const own = grant + (rating?.points ?? 0);
    return {
      row,
      indices,
      eligibility: groupEligibilityIn(ctx, row),
      rating,
      own,
      grant,
      karma: rating?.karma ?? 0,
      memberNames: row.skills.map((id) => activeSkillRow(id)?.name ?? id),
      mine: (rating?.rating ?? 0) > 0 || (rating?.points ?? 0) > 0,
    };
  });
}

/** One entry of a skill: its own row in the build, or the empty slot an unbought skill offers. */
export interface SkillEntryLine {
  /** The build entry's index, or null for a skill with no entry of its own yet. */
  index: number | null;
  target: string;
  spec: string;
  /** The engine's rating, when it has one for this entry. */
  rating: SkillRating | null;
  points: number;
  grant: number;
  /** Grant + points: what the stepper shows. */
  own: number;
  /** Ranks Karma added (step 8). */
  karma: number;
  /** The rating play will see. */
  total: number;
  /** 6, or 7 for the Aptitude skill. */
  max: number;
}

export interface SkillLine {
  row: ActiveSkillRow;
  eligibility: Eligibility;
  /** The owned group this skill is rated through, when there is one. */
  group: { id: string; name: string; rating: number } | null;
  entries: readonly SkillEntryLine[];
  mine: boolean;
}

export interface SkillSection {
  attr: SkillAttr;
  title: string;
  short: string;
  lines: readonly SkillLine[];
}

function entryLine(entry: BuildActiveSkill | null, index: number | null, rating: SkillRating | null): SkillEntryLine {
  const points = entry?.points ?? rating?.points ?? 0;
  const grant = rating?.grant ?? 0;
  return {
    index,
    target: entry?.target ?? rating?.target ?? '',
    spec: entry?.spec ?? '',
    rating,
    points,
    grant,
    own: grant + points,
    karma: rating?.karma ?? 0,
    total: rating?.rating ?? points,
    max: rating?.max ?? CREATION_SKILL_RULES.maxRating,
  };
}

/** Every active skill under its p. 90 heading, with the build's entries, group and grant. */
export function skillSections(build: CharacterBuild, ratings: BuildRatings, ctx: EligibilityContext): SkillSection[] {
  const byId = new Map<string, Array<{ entry: BuildActiveSkill; index: number }>>();
  build.skills.active.forEach((entry, index) => {
    const id = canonicalSkill(entry.id);
    byId.set(id, [...(byId.get(id) ?? []), { entry, index }]);
  });
  const lineFor = (row: ActiveSkillRow): SkillLine => {
    const own = byId.get(row.id) ?? [];
    const entries: SkillEntryLine[] =
      own.length > 0
        ? own.map(({ entry, index }) => entryLine(entry, index, ratings.skills.find((s) => s.index === index) ?? null))
        : [entryLine(null, null, ratings.skills.find((s) => s.id === row.id && s.index === null) ?? null)];
    const owned = row.group ? ratings.groups.find((g) => g.id === row.group && g.rating > 0) : undefined;
    const group = owned && row.group ? { id: row.group, name: SKILL_GROUP_BY_ID[row.group].name, rating: owned.rating } : null;
    return {
      row,
      eligibility: skillEligibilityIn(ctx, row),
      group,
      entries,
      mine: group !== null || entries.some((e) => e.own > 0 || e.total > 0 || e.spec.trim() !== '' || e.target.trim() !== ''),
    };
  };
  return ATTRIBUTE_HEADINGS.map((h) => ({
    ...h,
    lines: ACTIVE_SKILL_TABLE.filter((row) => row.attr === h.attr).map(lineFor),
  })).filter((s) => s.lines.length > 0);
}

/** Members of a group that already hold ranks of their own (points, a grant, a specialisation) — a group cannot be bought over them. */
export function membersWithOwnPoints(group: SkillGroupRow, sections: readonly SkillSection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const line of section.lines) {
      if (line.row.group !== group.id) continue;
      if (line.entries.some((e) => e.points > 0 || e.grant > 0 || e.spec.trim() !== '')) out.push(line.row.name);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search and "show only mine"
// ---------------------------------------------------------------------------

export interface SkillFilter {
  query: string;
  onlyMine: boolean;
}

/** Every word of the query appears somewhere in the texts (case and spacing ignored). */
export function matchesQuery(texts: readonly string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterGroups(lines: readonly GroupLine[], filter: SkillFilter): GroupLine[] {
  return lines.filter((l) => (!filter.onlyMine || l.mine) && matchesQuery([l.row.name, ...l.memberNames], filter.query));
}

export function filterSections(sections: readonly SkillSection[], filter: SkillFilter): SkillSection[] {
  return sections
    .map((s) => ({
      ...s,
      lines: s.lines.filter(
        (l) =>
          (!filter.onlyMine || l.mine) &&
          matchesQuery([l.row.name, l.group?.name ?? '', l.row.group ? SKILL_GROUP_BY_ID[l.row.group].name : '', ...l.entries.map((e) => e.target)], filter.query),
      ),
    }))
    .filter((s) => s.lines.length > 0);
}

export const countLines = (sections: readonly SkillSection[]): number => sections.reduce((n, s) => n + s.lines.length, 0);

/** "Showing 6 of 75 skills and 1 of 15 groups", or "All 75 skills and 15 groups". */
export function filterCountLine(shown: { skills: number; groups: number }, total: { skills: number; groups: number }): string {
  if (shown.skills === total.skills && shown.groups === total.groups) {
    return `All ${total.skills} skills and ${total.groups} groups`;
  }
  return `Showing ${shown.skills} of ${plural(total.skills, 'skill')} and ${shown.groups} of ${plural(total.groups, 'group')}`;
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

export interface SkillDice {
  total: number;
  limit: { kind: LimitKind; value: number } | null;
}

/** The dice pool play will roll for a skill, from the derived preview; null when it has none. */
export function skillDice(derived: DerivedCharacter | null, id: string): SkillDice | null {
  const pool = derived?.pools[`skill.${id}`];
  if (!pool) return null;
  return { total: pool.total, limit: pool.limit ? { kind: pool.limit.kind, value: pool.limit.value } : null };
}

/** "9 dice [Mental 5]" — short, for the chip. */
export function diceWords(dice: SkillDice): string {
  return `${plural(dice.total, 'die', 'dice')}${dice.limit ? ` [${LIMIT_WORDS[dice.limit.kind]} ${dice.limit.value}]` : ''}`;
}

/** "dice pool 9, Mental limit 5" — spoken. */
export function diceLabel(dice: SkillDice): string {
  return `dice pool ${dice.total}${dice.limit ? `, ${LIMIT_WORDS[dice.limit.kind]} limit ${dice.limit.value}` : ''}`;
}

// ---------------------------------------------------------------------------
// Refusals — the engine's sentence, on the caps that belong to a control
// ---------------------------------------------------------------------------

/** The fences `skillEligibilityIn` / `groupEligibilityIn` answer with, as the validator files them. */
export const FENCE_CODES: readonly string[] = [
  'skill-restricted-magic',
  'skill-restricted-resonance',
  'skill-aspect-fence',
  'skill-adept-fence',
  'assensing-needs-astral',
  'incompetent-skill-owned',
  'incompetent-group-owned',
  'uncouth-social-group',
];

/** What shuts raising a skill: its creation maximum and its fences. */
export const SKILL_RAISE_CODES: ReadonlySet<string> = new Set(['skill-rating-over', ...FENCE_CODES]);
/** What shuts raising a group. */
export const GROUP_RAISE_CODES: ReadonlySet<string> = new Set(['group-rating-over', ...FENCE_CODES]);
/** What shuts raising a knowledge skill or language. */
export const KNOWLEDGE_RAISE_CODES: ReadonlySet<string> = new Set(['knowledge-rating-over']);
/** What shuts lowering a rating out from under its specialisation. */
export const SPEC_FLOOR_CODES: ReadonlySet<string> = new Set(['spec-without-skill']);
/** What shuts marking one more language native. */
export const NATIVE_CODES: ReadonlySet<string> = new Set(['native-language-count']);

const issueSignature = (i: Issue): string => `${i.code}|${i.path ?? ''}|${i.message}`;

/**
 * The refusal a candidate change earns: the first error in `codes` that the
 * change brings in or makes worse (a message the build does not already
 * carry), as the engine's sentence and page. Null when the engine has no
 * objection that belongs to this control. `hint` is the few neutral words the
 * stepper shows until the refused button is pressed ("at 6").
 */
export function capRefusal(probe: BuildProbe, codes: ReadonlySet<string>, current: readonly Issue[], hint?: string): Refusal | null {
  const known = new Set(current.map(issueSignature));
  const hit = probe.blocking.find((i) => codes.has(i.code) && !known.has(issueSignature(i)));
  return hit ? { reason: hit.message, ref: hit.ref, ...(hint ? { hint } : {}) } : null;
}

/**
 * Whether one more rank could pass a rating's creation maximum — the
 * engine's maximum (`SkillRating.max`, `CREATION_SKILL_RULES`), read, not
 * restated. Only a row where it could is worth a probe: a skill at 3 of 6
 * cannot earn a cap refusal from +1, so the screen does not validate the
 * whole build to learn that, seventy-five times per keystroke.
 */
export function mayPassMax(rating: number, max: number): boolean {
  return rating + 1 > max;
}

/**
 * Why a greyed row is closed, in the validator's words: the engine's own
 * sentence for the fence `eligibility` names (`eligibilityMessage`, the one
 * the validator files) and its page. It used to be borrowed by probing a
 * rank of every closed row, which re-validated the build once per greyed
 * skill on every render.
 */
export function fenceRefusal(eligibility: Eligibility, name: string, build: Pick<CharacterBuild, 'magic'>): Refusal | null {
  if (eligibility.allowed || !eligibility.code) return null;
  return { reason: eligibilityMessage(eligibility.code, name, build), ...(eligibility.ref ? { ref: eligibility.ref } : {}), hint: 'closed' };
}

// ---------------------------------------------------------------------------
// Prices — the difference between budgets before and after
// ---------------------------------------------------------------------------

export type SkillPoolKey = 'skills' | 'groups' | 'knowledge';
export const SKILL_POOL_KEYS: readonly SkillPoolKey[] = ['skills', 'groups', 'knowledge'];

export type PoolCosts = Readonly<Record<SkillPoolKey, number>>;

/** What a change takes out of each pool: how far each pool's `remaining` falls. */
export function poolCosts(before: Budgets, after: Budgets): PoolCosts {
  return {
    skills: before.pools.skills.remaining - after.pools.skills.remaining,
    groups: before.pools.groups.remaining - after.pools.groups.remaining,
    knowledge: before.pools.knowledge.remaining - after.pools.knowledge.remaining,
  };
}

/** What `fn` would cost, asked of the engine's `budgets`. */
export function priceOf(
  build: CharacterBuild,
  settings: ChargenSettings,
  before: Budgets,
  fn: (b: CharacterBuild) => CharacterBuild,
  run: typeof engineBudgets = engineBudgets,
): PoolCosts {
  return poolCosts(before, run(fn(build), settings));
}

/** The pool a price is mostly paid from, and how much — for a `CostQuote`. */
export function mainCost(costs: PoolCosts): { pool: SkillPoolKey; amount: number } | null {
  let best: { pool: SkillPoolKey; amount: number } | null = null;
  for (const pool of SKILL_POOL_KEYS) {
    const amount = costs[pool];
    if (amount > 0 && (!best || amount > best.amount)) best = { pool, amount };
  }
  return best;
}

/** Where a rank of this skill or group would be written — the path the validator files its findings at. */
export function activePointsPath(build: CharacterBuild, index: number | null): string {
  return `skills.active.${index ?? build.skills.active.length}.points`;
}

export function groupPointsPath(build: CharacterBuild, id: string): string {
  const index = build.skills.groups.findIndex((g) => canonicalGroup(g.id) === canonicalGroup(id));
  return `skills.groups.${index >= 0 ? index : build.skills.groups.length}.points`;
}

/** The cost of a specialisation on an active skill entry with none yet. */
export function activeSpecPrice(build: CharacterBuild, settings: ChargenSettings, before: Budgets, ref: EntryRef): PoolCosts {
  return priceOf(build, settings, before, (b) => setActiveSpec(b, ref, 'x'));
}

/**
 * What one rank bought with skill points costs, per knowledge category and
 * for a language — asked of the engine by adding one such rank to a
 * throwaway row, so a doubling quality moves the quote.
 */
export function tradePrices(
  build: CharacterBuild,
  settings: ChargenSettings,
  before: Budgets,
): Readonly<Record<KnowledgeCategory | 'language', number>> {
  const out = {} as Record<KnowledgeCategory | 'language', number>;
  for (const category of CATEGORY_ORDER) {
    out[category] = priceOf(build, settings, before, (b) =>
      withSkills(b, { knowledge: [...b.skills.knowledge, { name: '', category, points: 0, skillPoints: 1, spec: null }] }),
    ).skills;
  }
  out.language = priceOf(build, settings, before, (b) =>
    withSkills(b, { languages: [...b.skills.languages, { name: '', native: false, points: 0, skillPoints: 1, spec: null }] }),
  ).skills;
  return out;
}

/**
 * The trade stated once: knowledge and language ranks may come out of the
 * active skill points instead, at the engine's price, with what is left there.
 */
export function tradeLine(prices: Readonly<Record<KnowledgeCategory | 'language', number>>, skills: BudgetPool): string {
  const base = prices.language;
  const dearer = CATEGORY_ORDER.filter((c) => prices[c] !== base);
  const each = `${plural(base, 'skill point')} a rank`;
  const exceptions =
    dearer.length > 0
      ? ` (${dearer.map((c) => `${plural(prices[c], 'point')} for ${CATEGORY_WORDS[c].noun}`).join(', ')})`
      : '';
  const left =
    skills.remaining < 0
      ? `those are already ${plural(-skills.remaining, 'point')} over`
      : `${plural(skills.remaining, 'skill point')} ${skills.remaining === 1 ? 'is' : 'are'} left there`;
  return `Short of knowledge points? Any rank below can be paid from the active skill points instead, at ${each}${exceptions}; ${left}.`;
}

// ---------------------------------------------------------------------------
// Knowledge and languages
// ---------------------------------------------------------------------------

export interface KnowledgeQuote {
  int: number;
  log: number;
  per: number;
  free: number;
  /** Ranks paid with skill points, which the pool shows on both sides. */
  diverted: number;
  text: string;
}

/**
 * The free pool quoted with its numbers: "(INT 3 + LOG 4) × 2 = 14 free
 * knowledge points". The ratings are the engine's natural INT and LOG; the
 * multiplier is its constant; `diverted` is what the pool reports beyond the
 * free points — the same reading the validator makes.
 */
export function knowledgeQuote(ratings: BuildRatings, pool: BudgetPool): KnowledgeQuote {
  const int = ratings.attributes.int.rating;
  const log = ratings.attributes.log.rating;
  const per = CREATION_SKILL_RULES.knowledgePointsPerIntLog;
  const free = freeKnowledgePoints(int, log);
  const diverted = Math.max(0, pool.available - free);
  const tail = diverted > 0 ? `, plus ${plural(diverted, 'rank')} paid with skill points` : '';
  return { int, log, per, free, diverted, text: `(INT ${int} + LOG ${log}) × ${per} = ${plural(free, 'free knowledge point')}${tail}` };
}

export interface KnowledgeLine {
  index: number;
  entry: BuildKnowledgeSkill;
  rating: KnowledgeRating | null;
  /** The rating play will see (Karma included). */
  total: number;
}

export function knowledgeLines(build: CharacterBuild, ratings: BuildRatings, category: KnowledgeCategory): KnowledgeLine[] {
  const out: KnowledgeLine[] = [];
  build.skills.knowledge.forEach((entry, index) => {
    if (entry.category !== category) return;
    const rating = ratings.knowledge.find((k) => k.index === index) ?? null;
    out.push({ index, entry, rating, total: rating?.rating ?? entry.points + entry.skillPoints });
  });
  return out;
}

export interface LanguageLine {
  index: number;
  entry: BuildLanguage;
  rating: LanguageRating | null;
  total: number;
}

export function languageLines(build: CharacterBuild, ratings: BuildRatings): LanguageLine[] {
  return build.skills.languages.map((entry, index) => {
    const rating = ratings.languages.find((l) => l.index === index) ?? null;
    return { index, entry, rating, total: rating?.rating ?? entry.points + entry.skillPoints };
  });
}

export const categoryAttribute = (category: KnowledgeCategory): string => attributeShort(KNOWLEDGE_CATEGORY_TABLE[category].attr);

/** "1 of 1 free native language chosen" / "Choose a native language: one is free." */
export function nativeLine(free: number, chosen: number): string {
  if (chosen === 0) return free === 1 ? 'Choose a native language: one is free.' : `Choose your native languages: ${free} are free.`;
  return `${chosen} of ${plural(free, 'free native language')} chosen`;
}

/** "rating 4 — 3 knowledge points, 1 from skill points, +1 Karma" */
export function knowledgeRatingWords(points: number, skillPoints: number, karma: number, total: number): string {
  const parts = [plural(points, 'knowledge point')];
  if (skillPoints > 0) parts.push(`${skillPoints} from skill points`);
  if (karma > 0) parts.push(`+${karma} Karma`);
  return `rating ${total} — ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Where the step's issues sit
// ---------------------------------------------------------------------------

/** Pool totals — the pool line already says these in its own words. */
export const POOL_CODES: Readonly<Record<string, SkillPoolKey>> = {
  'skill-points-over': 'skills',
  'skill-points-unspent': 'skills',
  'group-points-over': 'groups',
  'group-points-unspent': 'groups',
  'knowledge-points-over': 'knowledge',
  'knowledge-points-unspent': 'knowledge',
};

export interface PlacedIssues {
  pools: Record<SkillPoolKey, Issue[]>;
  active: Map<number, Issue[]>;
  groups: Map<number, Issue[]>;
  knowledge: Map<number, Issue[]>;
  languages: Map<number, Issue[]>;
  /** About the language list as a whole (no native language, too many). */
  languageList: Issue[];
  /** Everything with no row of its own on this screen. */
  rest: Issue[];
}

const PATH_RE = /^skills\.(active|groups|knowledge|languages)(?:\.(\d+)(?:\.[a-zA-Z]+)?)?$/;

/** Sort the step's issues onto the rows their `path` names. Nothing is dropped. */
export function placeIssues(issues: readonly Issue[]): PlacedIssues {
  const placed: PlacedIssues = {
    pools: { skills: [], groups: [], knowledge: [] },
    active: new Map(),
    groups: new Map(),
    knowledge: new Map(),
    languages: new Map(),
    languageList: [],
    rest: [],
  };
  const push = (map: Map<number, Issue[]>, index: number, issue: Issue): void => {
    map.set(index, [...(map.get(index) ?? []), issue]);
  };
  for (const issue of issues) {
    const pool = POOL_CODES[issue.code];
    if (pool) {
      placed.pools[pool].push(issue);
      continue;
    }
    const m = issue.path ? PATH_RE.exec(issue.path) : null;
    const list = m?.[1];
    const index = m?.[2] !== undefined ? Number(m[2]) : null;
    if (list === 'languages' && index === null) placed.languageList.push(issue);
    else if (index === null || !list) placed.rest.push(issue);
    else if (list === 'active') push(placed.active, index, issue);
    else if (list === 'groups') push(placed.groups, index, issue);
    else if (list === 'knowledge') push(placed.knowledge, index, issue);
    else push(placed.languages, index, issue);
  }
  return placed;
}

/**
 * Move to `rest` the row issues no row will show — an entry naming a skill or
 * group the tables do not know has no line on the p. 90 list — so every
 * finding filed under the step appears somewhere on it.
 */
export function withUnshownInRest(
  placed: PlacedIssues,
  sections: readonly SkillSection[],
  groups: readonly GroupLine[],
): PlacedIssues {
  const activeShown = new Set(sections.flatMap((s) => s.lines.flatMap((l) => l.entries.flatMap((e) => (e.index === null ? [] : [e.index])))));
  const groupShown = new Set(groups.flatMap((g) => g.indices));
  const rest = [...placed.rest];
  const keep = (map: Map<number, Issue[]>, shown: Set<number>): Map<number, Issue[]> => {
    const out = new Map<number, Issue[]>();
    for (const [index, issues] of map) {
      if (shown.has(index)) out.set(index, issues);
      else rest.push(...issues);
    }
    return out;
  };
  return { ...placed, active: keep(placed.active, activeShown), groups: keep(placed.groups, groupShown), rest };
}

/** "A", "A and B", "A, B and C". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What a group row says when members already hold ranks of their own. */
export function holdersLine(names: readonly string[]): string {
  const one = names.length === 1;
  return `${listWords(names)} already ${one ? 'has' : 'have'} ranks of ${one ? 'its' : 'their'} own; a group cannot be bought over them.`;
}

/** "Priority C gives 28 skill points and 2 group points." — the numbers step 2 chose, where they are spent. */
export function priorityLineFor(level: string | null, skills: BudgetPool, groups: BudgetPool): string {
  if (!level) return 'No priority is set for skills yet, so there are no skill or group points to spend.';
  return `Priority ${level} gives ${plural(skills.available, 'skill point')} and ${plural(groups.available, 'group point')}.`;
}

// ---------------------------------------------------------------------------
// Closed rows, folded away
// ---------------------------------------------------------------------------

/** A row this runner cannot take and the build holds nothing in. */
export const isIdleClosed = (line: { eligibility: Eligibility; mine: boolean }): boolean => !line.eligibility.allowed && !line.mine;

/**
 * The lists split into what this runner can take (or already holds) and what
 * is closed to it and empty. A mundane face used to scroll past three magic
 * and resonance groups and thirteen skills, each with its own red sentence,
 * to reach the knowledge skills; the closed ones now sit in one folded list
 * under one line, each row's own reason still inside.
 */
export function splitClosed(
  groups: readonly GroupLine[],
  sections: readonly SkillSection[],
): { groups: GroupLine[]; sections: SkillSection[]; closedGroups: GroupLine[]; closedSkills: SkillLine[] } {
  return {
    groups: groups.filter((g) => !isIdleClosed(g)),
    sections: sections.map((s) => ({ ...s, lines: s.lines.filter((l) => !isIdleClosed(l)) })).filter((s) => s.lines.length > 0),
    closedGroups: groups.filter(isIdleClosed),
    closedSkills: sections.flatMap((s) => s.lines.filter(isIdleClosed)),
  };
}

/** "13 skills and 3 groups are closed to this runner: …" */
export function closedLine(skills: number, groups: number): string {
  const parts = [...(skills > 0 ? [plural(skills, 'skill')] : []), ...(groups > 0 ? [plural(groups, 'group')] : [])];
  const verb = skills + groups === 1 ? 'is' : 'are';
  return `${parts.join(' and ')} ${verb} closed to this runner: none can take points here, and each says why.`;
}
