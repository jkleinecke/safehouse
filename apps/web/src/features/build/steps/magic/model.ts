/**
 * Step 4 — Magic or Resonance, as plain functions (FR3.9, docs/CHARGEN.md
 * §4.4 Step 4, §8.3 `magic` / `grants` / `powers`).
 *
 * The screen asks the same few questions on every render: which kinds the
 * Magic row offers and why the rest are shut, what the chosen kind hands
 * over and how much of each grant is still open, which skills a grant may
 * be, where each of the validator's findings belongs on the page, and what
 * a tap would write. None of those is a Shadowrun rule of its own — the rules
 * are the engine's (`magicPriorityOption`, `MAGIC_KIND_TABLE`, `TRADITIONS`,
 * `skillEligibilityIn`, `validate` through `probe`) — but they are enough
 * logic that they belong in a module a node test can call, because under
 * `renderToStaticMarkup` no click ever runs.
 *
 * Which skills a grant's pool includes, why a skill is fenced off, and how
 * many power points were bought are the engine's answers too
 * (`grantPoolIncludes`, `eligibilityMessage`, `powerPointsBought` /
 * `setPowerPointsBought`): the validator, the Skills step and the Karma step
 * read the same functions, so a closed skill here says its "no" in the words
 * step 6 uses, and the power-point stepper here and on step 8 write one spend.
 *
 * The updaters are pure `CharacterBuild → CharacterBuild` functions for
 * `update(fn)`. A kind change goes through the engine's `setMagicKind`, which
 * keeps every pick — "nothing is lost by going back" — so picks the new kind
 * cannot hold stay on the record, the validator names them, and the screen
 * lists them with a remove button rather than hiding them.
 *
 * Numbers, ids and our own words; no book text (DESIGN.md §14).
 */
import type {
  AttributeCode,
  BuildGrantRating,
  BuildPick,
  BuildPowerPick,
  CharacterBuild,
  Issue,
  MagicAspect,
  MagicKind,
  MagicTradition,
  PriorityLevel,
  PriorityTable,
  Ref,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_TABLE,
  ELIGIBILITY_REFS,
  MAGIC_KIND_TABLE,
  PRIORITY_CHARTS,
  TRADITIONS,
  eligibilityMessage,
  formulaGroup,
  grantPoolIncludes,
  knowsFormulaGroup,
  magicPriorityOption,
  powerPointsBought,
  setMagicKind,
  skillEligibilityIn,
  skillGroupRow,
  type ActiveSkillRow,
  type EligibilityCode,
  type EligibilityContext,
  type GrantPool,
  type MagicPriorityOption,
} from '@safehouse/rules';
import type { BuildProbe, BuildProber } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The kinds in the order the priority table prints them, mundane last. */
export const MAGIC_KIND_ORDER = ['magician', 'mysticAdept', 'technomancer', 'adept', 'aspected', 'mundane'] as const satisfies readonly MagicKind[];

export const KIND_TITLE: Readonly<Record<MagicKind, string>> = {
  magician: 'Magician',
  mysticAdept: 'Mystic adept',
  technomancer: 'Technomancer',
  adept: 'Adept',
  aspected: 'Aspected magician',
  mundane: 'Mundane',
};

/** One line on what each kind is for — ours. */
export const KIND_DETAIL: Readonly<Record<MagicKind, string>> = {
  magician: 'Casts spells, calls spirits and can leave the body to travel the astral.',
  mysticAdept: 'Casts and calls like a magician, and buys adept powers with Karma instead of projecting.',
  technomancer: 'Works the Matrix with the mind alone: complex forms, sprites and a living persona.',
  adept: 'Turns magic inward into powers of the body, and casts nothing.',
  aspected: 'Masters one of sorcery, conjuring or enchanting, and never the other two.',
  mundane: 'No magic and no Resonance: the Magic priority buys nothing.',
};

export const ASPECT_ORDER = ['sorcery', 'conjuring', 'enchanting'] as const satisfies readonly MagicAspect[];

export const ASPECT_TITLE: Readonly<Record<MagicAspect, string>> = {
  sorcery: 'Sorcery',
  conjuring: 'Conjuring',
  enchanting: 'Enchanting',
};

/** What each aspect's group covers, named by its skills (ids and names are data, not prose). */
export const ASPECT_DETAIL: Readonly<Record<MagicAspect, string>> = {
  sorcery: 'Spellcasting, Counterspelling and Ritual Spellcasting; learns spells and rituals.',
  conjuring: 'Summoning, Binding and Banishing; learns no spells.',
  enchanting: 'Alchemy, Artificing and Disenchanting; learns preparations.',
};

export const TRADITION_ORDER = ['hermetic', 'shamanic'] as const satisfies readonly MagicTradition[];

export const TRADITION_TITLE: Readonly<Record<MagicTradition, string>> = {
  hermetic: 'Hermetic',
  shamanic: 'Shamanic',
};

export const ATTRIBUTE_NAME: Readonly<Record<AttributeCode, string>> = {
  bod: 'Body',
  agi: 'Agility',
  rea: 'Reaction',
  str: 'Strength',
  wil: 'Willpower',
  log: 'Logic',
  int: 'Intuition',
  cha: 'Charisma',
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "sorcery, conjuring or enchanting" — a short list joined the way a sentence reads. */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** What a grant's skills may be, as a noun: "magical skills", "active skill", "skills from the Tasking, … groups". */
export function grantPoolNoun(pool: GrantPool, count: number): string {
  const noun = count === 1 ? 'skill' : 'skills';
  switch (pool.kind) {
    case 'any':
      return `active ${noun}`;
    case 'category':
      return pool.category === 'resonance' ? `Resonance ${noun}` : `${pool.category} ${noun}`;
    case 'groups':
      return `${noun} from the ${orList(pool.groups.map((id) => skillGroupRow(id)?.name ?? id))} groups`;
  }
}

/** "2 magical skills at rating 5" — the heading of a skill grant. */
export function skillGrantTitle(option: Pick<MagicPriorityOption, 'skills'>): string | null {
  const g = option.skills;
  return g ? `${g.count} ${grantPoolNoun(g.pool, g.count)} at rating ${g.rating}` : null;
}

/** A skill grant's heading, or a plain one where the kind has no skill grant (picks left from an earlier kind). */
export function grantSkillTitleOrDefault(option: Pick<MagicPriorityOption, 'skills'> | null): string {
  return (option && skillGrantTitle(option)) ?? 'Granted skills';
}

/**
 * Everything an option hands over, in one line for its card: "2 magical
 * skills at rating 5, 10 spells, rituals or preparations". The attribute
 * rating is the card's figure (`kindAside`), not part of this line.
 */
export function grantsLine(option: MagicPriorityOption): string {
  const parts: string[] = [];
  const skills = skillGrantTitle(option);
  if (skills) parts.push(skills);
  if (option.groups) parts.push(`${plural(option.groups.count, 'magical skill group')} at rating ${option.groups.rating}`);
  if (option.formulae > 0) parts.push(`${option.formulae} spells, rituals or preparations`);
  if (option.forms > 0) parts.push(plural(option.forms, 'complex form'));
  const pp = MAGIC_KIND_TABLE[option.kind].powerPoints;
  if (pp === 'free') parts.push('power points equal to Magic');
  if (pp === 'karma') parts.push('power points bought with Karma');
  return parts.join(', ');
}

/** "Magic 4" / "Resonance 6" — the card's figure. */
export function kindAside(option: Pick<MagicPriorityOption, 'attribute' | 'rating'>): string {
  return `${option.attribute === 'res' ? 'Resonance' : 'Magic'} ${option.rating}`;
}

/**
 * Why a named skill is fenced off from this runner: the engine's sentence for
 * the fence (`eligibilityMessage`, the validator's own words and the ones
 * step 6 greys a skill with) and its page.
 */
export function fenceRefusal(code: EligibilityCode, name: string, eligibility: Pick<EligibilityContext, 'kind' | 'aspect'>): Refusal {
  const magic = { kind: eligibility.kind, ...(eligibility.aspect ? { aspect: eligibility.aspect } : {}) };
  return { reason: eligibilityMessage(code, name, { magic }), ref: ELIGIBILITY_REFS[code] };
}

// ---------------------------------------------------------------------------
// The Magic row and the kind picker
// ---------------------------------------------------------------------------

/**
 * The first error a candidate change would bring in, as a refusal in the
 * validator's words and page — or null when the change breaks nothing new.
 * `only` narrows it to the codes a control refuses on (a level stepper
 * refuses past Magic, not on the power points a level costs); `ignore` lets
 * a control allow an overspend the rail will show in red.
 */
export function refusalOf(
  probe: BuildProbe,
  opts: { only?: ReadonlySet<string>; ignore?: ReadonlySet<string> } = {},
): Refusal | null {
  const issue = probe.introduced.find((i) => (!opts.only || opts.only.has(i.code)) && !opts.ignore?.has(i.code));
  return issue ? { reason: issue.message, ref: issue.ref } : null;
}

/** Where this build stands before any kind is picked. */
export type MagicStage =
  /** The Magic or Resonance priority is not chosen. */
  | 'no-priority'
  /** The row offers nothing and the runner is mundane: nothing to do here. */
  | 'mundane'
  /**
   * The row offers nothing and the runner is mundane, but an earlier kind left
   * picks, powers or bought power points on the record, or the validator still
   * files an error here: the one line, then what is left, removable.
   */
  | 'mundane-leftovers'
  /** The row offers kinds (or the record holds a kind the row does not): the full screen. */
  | 'choose';

/**
 * Whether an earlier kind left anything on the record that this step holds:
 * granted skills, groups, spells or forms, adept powers, or power points
 * bought with Karma. The engine's `setMagicKind` keeps all of them, so a
 * runner who became mundane can still carry them.
 */
export function magicLeftovers(build: Pick<CharacterBuild, 'grants' | 'powers' | 'karma'>): boolean {
  const g = build.grants;
  return g.skills.length + g.groups.length + g.spells.length + g.forms.length + build.powers.length > 0 || powerPointsBought(build) > 0;
}

/**
 * The stage the screen opens at. `issues` are this step's findings: a
 * mundane whose step still has an error to fix is never shown as a step with
 * nothing to do, whatever the frame's skipped line says, because the fix is
 * only reachable here.
 */
export function magicStage(
  build: Pick<CharacterBuild, 'priorities' | 'magic' | 'grants' | 'powers' | 'karma'>,
  table: PriorityTable,
  issues: readonly Pick<Issue, 'severity'>[] = [],
): MagicStage {
  const level = build.priorities.magic;
  if (!level) return 'no-priority';
  if (PRIORITY_CHARTS[table][level].magic.length === 0 && build.magic.kind === 'mundane') {
    return magicLeftovers(build) || issues.some((i) => i.severity === 'error') ? 'mundane-leftovers' : 'mundane';
  }
  return 'choose';
}

/** The kinds a Magic row offers, in print order. */
export function offeredKinds(table: PriorityTable, level: PriorityLevel): MagicKind[] {
  return PRIORITY_CHARTS[table][level].magic.map((o) => o.kind);
}

/** The validator's codes that shut a kind outright — the rest of what a kind change breaks is filling to do. */
const KIND_REFUSALS: ReadonlySet<string> = new Set(['magic-kind-not-offered', 'resonance-not-allowed']);

export interface KindChoice {
  value: MagicKind;
  title: string;
  detail: string;
  aside: string | null;
  /** The engine's sentence when the kind cannot be taken on this build. */
  refusal: Refusal | null;
  option: MagicPriorityOption | null;
}

/**
 * Every kind as a card. A kind the row does not offer, or a metatype that can
 * never have Resonance, is refused with the validator's own sentence: the
 * candidate record (`setMagicKind`) is probed and its blocking errors read for
 * the two codes that shut a kind. Filling a new kind's grants is not a
 * refusal — that is what the rest of the screen is for.
 */
export function kindChoices(build: CharacterBuild, table: PriorityTable, probe: BuildProber): KindChoice[] {
  const level = build.priorities.magic;
  return MAGIC_KIND_ORDER.map((kind) => {
    const option = level && kind !== 'mundane' ? magicPriorityOption(table, level, kind) : null;
    const shut = probe((b) => setMagicKind(b, kind), `magic-kind:${kind}`).blocking.find((i) => KIND_REFUSALS.has(i.code));
    return {
      value: kind,
      title: KIND_TITLE[kind],
      detail: option ? `${KIND_DETAIL[kind]} Gives ${grantsLine(option)}.` : KIND_DETAIL[kind],
      aside: option ? kindAside(option) : null,
      refusal: shut ? { reason: shut.message, ref: shut.ref } : null,
      option,
    };
  });
}

/** Choose a kind: the engine's updater, which keeps every pick (see the file header). */
export function chooseKind(build: CharacterBuild, kind: MagicKind): CharacterBuild {
  return kind === build.magic.kind ? build : setMagicKind(build, kind);
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export const GRANT_KEYS = ['skills', 'groups', 'spells', 'forms'] as const;
/** The grant names the validator reads in `magic.waived`. */
export type GrantKey = (typeof GRANT_KEYS)[number];

export interface GrantState {
  key: GrantKey;
  /** How many the priority hands over for this kind (0 when none). */
  want: number;
  picked: number;
  /** Still to pick: never negative. */
  open: number;
  /** More picked than the priority hands over. */
  over: boolean;
  waived: boolean;
  /** Every pick made, or the rest explicitly waived: nothing here blocks the step. */
  settled: boolean;
  /** Worth a section: the kind gets some, or picks from an earlier choice are still on the record. */
  shown: boolean;
}

export function waivedGrants(build: Pick<CharacterBuild, 'magic'>): ReadonlySet<string> {
  return new Set(build.magic.waived ?? []);
}

/** The four grants for the option the build's kind has on its row. */
export function grantStates(build: CharacterBuild, option: MagicPriorityOption | null): Record<GrantKey, GrantState> {
  const waived = waivedGrants(build);
  const want: Record<GrantKey, number> = {
    skills: option?.skills?.count ?? 0,
    groups: option?.groups?.count ?? 0,
    spells: option?.formulae ?? 0,
    forms: option?.forms ?? 0,
  };
  const out = {} as Record<GrantKey, GrantState>;
  for (const key of GRANT_KEYS) {
    const picked = build.grants[key].length;
    const w = waived.has(key);
    out[key] = {
      key,
      want: want[key],
      picked,
      open: Math.max(0, want[key] - picked),
      over: picked > want[key],
      waived: w,
      settled: picked === want[key] || (picked < want[key] && w),
      shown: want[key] > 0 || picked > 0,
    };
  }
  return out;
}

/** "3 of 7 picked, 4 to go", "all 7 picked", "2 picked; this kind gets none here" — a grant's count in words. */
export function grantCountWords(state: GrantState): string {
  if (state.want === 0) return `${state.picked} on the record; this kind gets none here`;
  if (state.over) return `${state.picked} picked of ${state.want}: ${state.picked - state.want} too many`;
  if (state.open === 0) return `all ${state.want} picked`;
  if (state.waived) return `${state.picked} of ${state.want} picked, the other ${state.open} waived`;
  return `${state.picked} of ${state.want} picked, ${state.open} to go`;
}

/** Waive what is left of a grant, or take the waiver back. */
export function setWaived(build: CharacterBuild, key: GrantKey, waived: boolean): CharacterBuild {
  const current = build.magic.waived ?? [];
  const has = current.includes(key);
  if (has === waived) return build;
  const next = waived ? [...current, key] : current.filter((k) => k !== key);
  const { waived: _drop, ...magic } = build.magic;
  return { ...build, magic: next.length > 0 ? { ...magic, waived: next } : magic };
}

/** Remove every pick of a grant (a kind change left picks the new kind cannot hold). */
export function clearGrant(build: CharacterBuild, key: GrantKey): CharacterBuild {
  return { ...build, grants: { ...build.grants, [key]: [] } };
}

const withoutIndex = <T>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index);

/** Re-rate every granted skill or group to the rating the row now gives (a priority moved under them). */
export function rerateGrants(build: CharacterBuild, key: 'skills' | 'groups', rating: number): CharacterBuild {
  return { ...build, grants: { ...build.grants, [key]: build.grants[key].map((g) => ({ ...g, rating })) } };
}

/** Whether any granted skill or group sits at a rating other than the row's. */
export function grantRatingsDiffer(list: readonly BuildGrantRating[], rating: number | null): boolean {
  return rating !== null && list.some((g) => g.rating !== rating);
}

// --- Granted skills ---

export interface ClosedSkill {
  row: ActiveSkillRow;
  refusal: Refusal;
}

export interface GrantSkillCandidates {
  /** Skills the grant may still be, by name. */
  open: ActiveSkillRow[];
  /** Skills in the pool this runner may not hold, with the first fence that says so. */
  closed: ClosedSkill[];
}

/**
 * The skills a grant may be for this runner: in the pool, not already
 * granted, and open by the engine's fences (`skillEligibilityIn`). Skills
 * that need a named target (Exotic Melee Weapon and its kin) are left out,
 * as the concept cards leave them out: a grant records an id and a rating,
 * with nowhere to put the target.
 */
export function grantSkillCandidates(
  pool: GrantPool,
  eligibility: EligibilityContext,
  granted: readonly BuildGrantRating[],
): GrantSkillCandidates {
  const taken = new Set(granted.map((g) => g.id));
  const open: ActiveSkillRow[] = [];
  const closed: ClosedSkill[] = [];
  for (const row of ACTIVE_SKILL_TABLE) {
    if (row.specific || taken.has(row.id) || !grantPoolIncludes(row, pool)) continue;
    const answer = skillEligibilityIn(eligibility, row);
    if (answer.allowed || !answer.code) open.push(row);
    else closed.push({ row, refusal: fenceRefusal(answer.code, row.name, eligibility) });
  }
  const byName = (a: ActiveSkillRow, b: ActiveSkillRow) => a.name.localeCompare(b.name);
  open.sort(byName);
  closed.sort((a, b) => byName(a.row, b.row));
  return { open, closed };
}

export function addGrantSkill(build: CharacterBuild, id: string, rating: number): CharacterBuild {
  if (build.grants.skills.some((g) => g.id === id)) return build;
  return { ...build, grants: { ...build.grants, skills: [...build.grants.skills, { id, rating }] } };
}

export function removeGrantSkill(build: CharacterBuild, index: number): CharacterBuild {
  return { ...build, grants: { ...build.grants, skills: withoutIndex(build.grants.skills, index) } };
}

// --- The aspected magician's aspect and group ---

/**
 * Choose the aspect. The group grant follows it: a group already granted is
 * re-pointed at the new aspect (it could be no other), and an empty grant is
 * filled with the aspect's group unless the player waived it — the book
 * leaves no choice of group once the aspect is chosen.
 */
export function chooseAspect(build: CharacterBuild, aspect: MagicAspect, option: MagicPriorityOption | null): CharacterBuild {
  const magic = { ...build.magic, aspect };
  const grant = option?.groups ?? null;
  if (!grant || !grant.groups.includes(aspect)) return { ...build, magic };
  const had = build.grants.groups.length > 0;
  const fill = had || !waivedGrants(build).has('groups');
  return {
    ...build,
    magic,
    grants: { ...build.grants, groups: fill ? [{ id: aspect, rating: grant.rating }] : build.grants.groups },
  };
}

export function addGrantGroup(build: CharacterBuild, id: string, rating: number): CharacterBuild {
  if (build.grants.groups.some((g) => g.id === id)) return build;
  return { ...build, grants: { ...build.grants, groups: [...build.grants.groups, { id, rating }] } };
}

export function removeGrantGroup(build: CharacterBuild, index: number): CharacterBuild {
  return { ...build, grants: { ...build.grants, groups: withoutIndex(build.grants.groups, index) } };
}

// --- Spells, rituals, preparations and complex forms ---

export type FormulaGroup = 'spells' | 'rituals' | 'preparations';

export const FORMULA_WORD: Readonly<Record<FormulaGroup, string>> = {
  spells: 'spell',
  rituals: 'ritual',
  preparations: 'preparation',
};

/** How a spell row is learned: as a spell (a ritual row stays a ritual) or as an alchemical preparation. */
export type LearnAs = 'spells' | 'preparations';

/**
 * A picked formula as the group it is learned in. The engine tells the
 * groups apart by category (`formulaGroup`), so a spell learned as a
 * preparation carries that word in front of its own category; a ritual is a
 * ritual however it is learned.
 */
export function learnAs(pick: BuildPick, as: LearnAs): BuildPick {
  if (as !== 'preparations' || formulaGroup(pick) !== 'spells') return pick;
  const category = pick.category?.trim();
  return { ...pick, category: category ? `preparation (${category})` : 'preparation' };
}

/** The kinds of formula this kind may learn, in the book's order. */
export function learnableGroups(magic: Pick<CharacterBuild['magic'], 'kind' | 'aspect'>): FormulaGroup[] {
  return (['spells', 'rituals', 'preparations'] as const).filter((g) => knowsFormulaGroup(magic, g));
}

/** A stand-in formula of a group, for asking the engine what one more would break. */
export function probeFormula(group: FormulaGroup): BuildPick {
  return group === 'spells' ? { name: 'one more spell' } : { name: `one more ${FORMULA_WORD[group]}`, category: FORMULA_WORD[group] };
}

/**
 * Why this exact formula may not be taken as one more free pick, learned as
 * `as` — the validator's first new error for it — or null. The picker asks it
 * of every row before the tap, so a ritual past the rituals cap is shut on its
 * row while spells, still under theirs, stay open; the one-more probe on the
 * group cannot tell those apart.
 */
export function formulaPickRefusal(probe: BuildProber, pick: BuildPick, as: LearnAs): Refusal | null {
  const candidate = learnAs(pick, as);
  const key = `formula-row:${as}:${pick.catalogueId ?? pick.name}:${pick.category ?? ''}`;
  return refusalOf(probe((b) => addFormula(b, candidate), key));
}

export function addFormula(build: CharacterBuild, pick: BuildPick): CharacterBuild {
  return { ...build, grants: { ...build.grants, spells: [...build.grants.spells, pick] } };
}

export function removeFormula(build: CharacterBuild, index: number): CharacterBuild {
  return { ...build, grants: { ...build.grants, spells: withoutIndex(build.grants.spells, index) } };
}

export function addForm(build: CharacterBuild, pick: BuildPick): CharacterBuild {
  return { ...build, grants: { ...build.grants, forms: [...build.grants.forms, pick] } };
}

export function removeForm(build: CharacterBuild, index: number): CharacterBuild {
  return { ...build, grants: { ...build.grants, forms: withoutIndex(build.grants.forms, index) } };
}

/** Catalogue ids already picked in a list, so the picker lists them as taken. */
export function takenIds(picks: readonly { catalogueId?: string | undefined }[]): Set<string> {
  return new Set(picks.flatMap((p) => (p.catalogueId ? [p.catalogueId] : [])));
}

// ---------------------------------------------------------------------------
// Tradition and mentor spirit
// ---------------------------------------------------------------------------

/** Magicians, aspected magicians and mystic adepts choose a tradition (its Drain pair). */
export function takesTradition(kind: MagicKind): boolean {
  return kind === 'magician' || kind === 'aspected' || kind === 'mysticAdept';
}

export function chooseTradition(build: CharacterBuild, tradition: MagicTradition): CharacterBuild {
  return build.magic.tradition === tradition ? build : { ...build, magic: { ...build.magic, tradition } };
}

export interface DrainPair {
  codes: readonly [AttributeCode, AttributeCode];
  /** "Logic 4 + Willpower 5 = 9" */
  words: string;
  ref: Ref;
}

/** A tradition's Drain attributes in numbers, read from the ratings the caller hands over. */
export function drainPair(tradition: MagicTradition, valueOf: (code: AttributeCode) => number): DrainPair {
  const row = TRADITIONS[tradition];
  const [a, b] = row.drain;
  const va = valueOf(a);
  const vb = valueOf(b);
  return { codes: row.drain, words: `${ATTRIBUTE_NAME[a]} ${va} + ${ATTRIBUTE_NAME[b]} ${vb} = ${va + vb}`, ref: row.ref };
}

/** Whether a kind may follow a mentor spirit (the engine's kind table). */
export function takesMentor(kind: MagicKind): boolean {
  return MAGIC_KIND_TABLE[kind].mentorSpirit;
}

/** Name the mentor spirit; an empty name removes it. Kept as typed (spaces and all) up to the record's 200 characters. */
export function setMentor(build: CharacterBuild, text: string): CharacterBuild {
  const { mentor: _drop, ...magic } = build.magic;
  const value = text.slice(0, 200);
  return { ...build, magic: value.trim() ? { ...magic, mentor: value } : magic };
}

// ---------------------------------------------------------------------------
// Power points and adept powers
// ---------------------------------------------------------------------------

// Power points bought with Karma are the engine's `powerPointsBought` /
// `setPowerPointsBought` — one updater, shared with step 8 (the book's own
// example buys them here).

/** Adepts and mystic adepts spend power points on powers. */
export function usesPowers(kind: MagicKind): boolean {
  return MAGIC_KIND_TABLE[kind].powerPoints !== null;
}

export function addPower(build: CharacterBuild, power: BuildPowerPick): CharacterBuild {
  return { ...build, powers: [...build.powers, power] };
}

export function removePower(build: CharacterBuild, index: number): CharacterBuild {
  return { ...build, powers: withoutIndex(build.powers, index) };
}

/**
 * A power point cost typed by hand, for a power whose row prints none the
 * engine can read ("Varies"): a plain positive number ("0.5", "2"), or null
 * for anything else — empty, zero, negative, or not a number.
 */
export function typedPowerPoints(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "0.25 PP", "1.5 PP" — power points as the rail writes them. */
export function ppWords(points: number): string {
  const n = Math.round(points * 100) / 100;
  return `${n} PP`;
}

// ---------------------------------------------------------------------------
// Where the validator's findings go on the page
// ---------------------------------------------------------------------------

export type MagicSection = 'kind' | 'aspect' | 'skills' | 'groups' | 'spells' | 'forms' | 'tradition' | 'mentor' | 'powerPoints' | 'powers' | 'other';

/**
 * The section of the screen an issue of this step is fixed in, read off its
 * path. Special points on Magic or Resonance with no type to use them are the
 * kind's (choosing a type is the fix this step offers); power points bought
 * by the wrong kind, or past Magic, are the power point section's.
 */
export function sectionOf(issue: Pick<Issue, 'path' | 'code'>): MagicSection {
  const path = issue.path ?? '';
  const head = (prefix: string) => path === prefix || path.startsWith(`${prefix}.`);
  if (head('magic.kind') || head('special')) return 'kind';
  if (head('magic.aspect')) return 'aspect';
  if (head('magic.tradition')) return 'tradition';
  if (head('magic.mentor')) return 'mentor';
  if (head('grants.skills')) return 'skills';
  if (head('grants.groups')) return 'groups';
  if (head('grants.spells')) return 'spells';
  if (head('grants.forms')) return 'forms';
  if (head('powers')) return 'powers';
  if (issue.code.startsWith('power-point-')) return 'powerPoints';
  return 'other';
}

/** This step's issues, by the section that fixes them, each list in the validator's order. */
export function issuesBySection(issues: readonly Issue[]): Record<MagicSection, Issue[]> {
  const out: Record<MagicSection, Issue[]> = {
    kind: [],
    aspect: [],
    skills: [],
    groups: [],
    spells: [],
    forms: [],
    tradition: [],
    mentor: [],
    powerPoints: [],
    powers: [],
    other: [],
  };
  for (const issue of issues) out[sectionOf(issue)].push(issue);
  return out;
}

/** The issues about one line of a list (`grants.skills.1`), and the ones about the list as a whole. */
export function splitByIndex(issues: readonly Issue[], prefix: string): { whole: Issue[]; at: (index: number) => Issue[] } {
  const whole = issues.filter((i) => !(i.path ?? '').startsWith(`${prefix}.`));
  return { whole, at: (index) => issues.filter((i) => i.path === `${prefix}.${index}` || (i.path ?? '').startsWith(`${prefix}.${index}.`)) };
}
