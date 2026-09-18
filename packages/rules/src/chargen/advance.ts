/**
 * Karma spends — what one costs, how long it trains, and what it does to a
 * sheet (FR3.7 advancement and FR3.9 Step 8; docs/CHARGEN.md §4.2, §8.4).
 *
 * Written once for both ends of a runner's life. At creation the builder's
 * leftover Karma buys raises, specialisations, spells and bound spirits; in
 * play a downtime buys the same things at the same prices (SR5 p. 107). The
 * build's `karma.spends` and the advancement route's body are one shape
 * (`KarmaSpend`), so `compileBuild` applies a build's spends through
 * `applySpend` exactly as an approved advancement will, and the budget prices
 * them through the same `spendKarma` — the rail and the ledger cannot
 * disagree about what a raise cost.
 *
 * Two qualities move prices and live here for that reason: Uncouth doubles
 * social skills and their specialisations, Uneducated technical skills,
 * their groups, academic and professional knowledge (pp. 85, 87) — "at
 * creation too", which is why the doubling is read off whatever list of
 * qualities the caller has, a build's or a sheet's. Run Faster's
 * metasapients and shapeshifters are born Uneducated (RF pp. 102–105), so the
 * metatype is read too, and a buy-off line lifts it.
 *
 * A focus is priced by the Focus Table (p. 318) for the type its label or
 * name reads as — the dearer of the two when they disagree, so a label can
 * never bond a power focus at a spell focus's price; only a focus whose type
 * cannot be read falls back to the bonding Karma the spend recorded, and the
 * validator asks for the type.
 *
 * A spend's `from` is the rating the player saw when they tapped. These
 * functions trust it for the price and never lower a rating: applying a
 * spend sets the rating to the higher of what the sheet has and `to` — and
 * for Magic or Resonance in play, where what the player saw is the rating
 * *after* Essence loss (p. 278), adds the ratings bought to the natural one
 * the sheet stores. Whether
 * `from` still matches is asked twice: at creation by the validator (a stale
 * chain after an upstream change is an issue, not a silent re-price), and in
 * play by `advanceRefusals`, which the advance route runs when the spend is
 * asked for and again when the GM approves it, because the sheet may have
 * moved in between.
 *
 * **In play** the ceilings are not creation's. A skill goes to 12, 13 for the
 * one Aptitude names (p. 88); an attribute to its metatype's natural maximum,
 * one more with Exceptional Attribute or, for Edge, Lucky (pp. 66, 72, 76);
 * a group is raised as a group only while its skills sit level and
 * unspecialised (p. 88); a specialisation needs the skill; spells are for
 * the casters that learn them and complex forms for technomancers; the
 * fences that close a skill at creation — Magic skills without Magic, an
 * aspected magician's other groups, Incompetent — close it in play too,
 * through the same eligibility readers. Bound spirits, registered sprites,
 * bonded foci and a mystic adept's power points are creation's Karma
 * purchases only: in play they come from summoning, compiling, the Magic
 * tab, and — for an adept — free with a Magic rating (p. 279). Each refusal
 * is our sentence and its page, for the route's error and the Improve
 * panel's stepper alike.
 *
 * Pure — no I/O. Numbers and page refs only (DESIGN.md §14).
 */
import {
  ATTRIBUTE_CODES,
  type BuildAttributeId,
  type BuildPick,
  type KarmaSpend,
  type KnowledgeCategory,
  type MagicAspect,
  type MagicKind,
  type QualityType,
  type Ref,
  type SheetComplexForm,
  type SheetKnowledge,
  type SheetLanguage,
  type SheetSkill,
  type SheetSpell,
  type SheetV1,
} from '@safehouse/contracts';
import {
  DOWNTIME_LIMITS,
  KARMA_COSTS,
  karmaForActiveSkill,
  karmaForAttribute,
  karmaForInitiation,
  karmaForKnowledgeSkill,
  karmaForSkillGroup,
  TRAINING_MODIFIERS,
  trainingTime,
  type TrainingKind,
  type TrainingTime,
} from './costs.js';
import { focusBondingKarma, focusSpendType } from './foci.js';
import {
  QUALITY_RULE_BY_ID,
  isQualityBuyOff,
  qualityRuleFor,
  racialQualities,
  type DoubledCostScope,
  type QualityRuleEntry,
} from './qualityRules.js';
import {
  eligibilityMessage,
  groupEligibilityIn,
  skillEligibilityIn,
  type Eligibility,
  type EligibilityContext,
} from './eligibility.js';
import { BUILD_ATTRIBUTE_NAMES, CREATION_ATTRIBUTE_RULES, hasRacialTrait, metatypeRow } from './metatypes.js';
import { SR5 } from './pages.js';
import { MAGIC_KIND_TABLE } from './priority.js';
import { CREATION_SKILL_RULES, activeSkillRow, skillGroupRow, type SkillGroupId, type SkillGroupRow } from './skills.js';
import { attributeCode } from '../refs.js';
import { skillAttrFor } from '../generator/validity.js';

// ---------------------------------------------------------------------------
// Cost doubling (Uncouth, Uneducated)
// ---------------------------------------------------------------------------

/** What the held qualities double. Built from names, so a build and a sheet both feed it. */
export interface CostDoubling {
  /** The scopes of every held doubling quality (empty when none is held). */
  scopes: readonly DoubledCostScope[];
}

/** A quality as `costDoubling` reads it: a name, and the type when the list records one. */
export interface DoublingQuality {
  readonly name: string;
  readonly type?: QualityType | undefined;
}

/**
 * The doubling scopes for a list of qualities and, when given, the metatype
 * whose racial Uneducated doubles the same costs (RF pp. 102–105). The racial
 * quality recorded as positive is its buy-off and doubles nothing; any other
 * negative quality recorded as positive still doubles what it doubles.
 */
export function costDoubling(qualities: readonly DoublingQuality[], metatype?: string | null): CostDoubling {
  const scopes: DoubledCostScope[] = [];
  const push = (entry: QualityRuleEntry): void => {
    for (const rule of entry.rules) if (rule.kind === 'doublesCosts') scopes.push(rule.scope);
  };
  for (const q of qualities) {
    const entry = qualityRuleFor(q.name);
    if (entry && !isQualityBuyOff(q, metatype)) push(entry);
  }
  for (const id of racialQualities(metatype, qualities)) push(QUALITY_RULE_BY_ID[id]);
  return { scopes };
}

/** Whether an active skill's Karma (and, by house rule, points) doubles. */
export function doublesSkill(doubling: CostDoubling, skillId: string): boolean {
  const row = activeSkillRow(skillId);
  if (!row) return false;
  return doubling.scopes.some((s) => s.skillCategories.includes(row.category));
}

/** Whether a skill group doubles: the scope covers groups and every member is in it. */
export function doublesGroup(doubling: CostDoubling, groupId: string): boolean {
  const group = skillGroupRow(groupId);
  if (!group) return false;
  return doubling.scopes.some(
    (s) => s.groups && group.skills.every((id) => s.skillCategories.includes(activeSkillRow(id)?.category ?? 'combat')),
  );
}

/** Whether a knowledge skill of this category doubles. */
export function doublesKnowledge(doubling: CostDoubling, category: KnowledgeCategory | null | undefined): boolean {
  if (!category) return false;
  return doubling.scopes.some((s) => s.knowledgeCategories.includes(category));
}

/** Whether a specialisation doubles: on an in-scope active skill, or an in-scope knowledge category. */
export function doublesSpecialization(
  doubling: CostDoubling,
  target: { list: 'active'; id: string } | { list: 'knowledge'; category: KnowledgeCategory | null } | { list: 'language' },
): boolean {
  if (target.list === 'language') return false;
  if (target.list === 'active') {
    const row = activeSkillRow(target.id);
    return !!row && doubling.scopes.some((s) => s.specializations && s.skillCategories.includes(row.category));
  }
  const category = target.category;
  return !!category && doubling.scopes.some((s) => s.specializations && s.knowledgeCategories.includes(category));
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/** What pricing a spend needs to know beyond the spend itself. */
export interface SpendPricing {
  doubling: CostDoubling;
  /** The category of a knowledge skill already held, by name (a spend may omit it). */
  knowledgeCategory: (name: string) => KnowledgeCategory | null;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The Karma a spend costs under the given pricing (SR5 p. 98, p. 107). */
export function spendKarma(spend: KarmaSpend, pricing: SpendPricing): number {
  const x2 = (doubled: boolean): number => (doubled ? 2 : 1);
  switch (spend.kind) {
    case 'attribute':
      return karmaForAttribute(spend.from, spend.to);
    case 'skill':
      return karmaForActiveSkill(spend.from, spend.to) * x2(doublesSkill(pricing.doubling, spend.id));
    case 'group':
      return karmaForSkillGroup(spend.from, spend.to) * x2(doublesGroup(pricing.doubling, spend.id));
    case 'knowledge': {
      // The category the record already holds wins: Uneducated's doubling is
      // read off the skill as it is filed, never off a request that claims
      // otherwise (pp. 87, 89). A spend's own category is for a skill nobody
      // has yet, which is the only time the sheet has nothing to say.
      const category = pricing.knowledgeCategory(spend.name) ?? spend.category;
      return karmaForKnowledgeSkill(spend.from, spend.to) * x2(doublesKnowledge(pricing.doubling, category));
    }
    case 'language':
      return karmaForKnowledgeSkill(spend.from, spend.to);
    case 'specialization': {
      const doubled =
        spend.list === 'active'
          ? doublesSpecialization(pricing.doubling, { list: 'active', id: spend.id })
          : spend.list === 'knowledge'
            ? doublesSpecialization(pricing.doubling, {
                list: 'knowledge',
                category: pricing.knowledgeCategory(spend.id),
              })
            : false;
      return KARMA_COSTS.specialization * x2(doubled);
    }
    case 'spell':
      return KARMA_COSTS.spell;
    case 'form':
      return KARMA_COSTS.complexForm;
    case 'powerPoint':
      return KARMA_COSTS.powerPoint * spend.count;
    case 'initiation':
      // 10 + grade x 3 (p. 325). One spend per grade, so a runner who takes
      // grades 1 and 2 pays for both rather than only for where they ended up.
      return karmaForInitiation(spend.grade);
    case 'spirit':
      return KARMA_COSTS.spiritService * spend.services;
    case 'sprite':
      return KARMA_COSTS.spriteTask * spend.tasks;
    case 'focus': {
      // The Focus Table's price for the dearest type the label and name read
      // as; the recorded figure only when neither reads (the validator then
      // asks for the type).
      const type = focusSpendType(spend);
      return type ? focusBondingKarma(type, spend.force) : spend.bondKarma;
    }
  }
}

/** The lists `karmaCostOf` reads from a sheet — any sheet-like record with qualities will do. */
export interface SpendSheet {
  readonly qualities: readonly DoublingQuality[];
  readonly knowledge?: readonly { readonly name: string; readonly category: KnowledgeCategory }[];
  /** The metatype, for the racial Uneducated of Run Faster's metasapients and shapeshifters. */
  readonly identity?: { readonly metatype?: string };
}

/**
 * The Karma a spend costs a character in play (or a compiled sheet): new
 * rating × 5 for attributes, × 2 active skills, × 5 groups, × 1 knowledge
 * and languages, 7 a specialisation, 5 a spell, 4 a complex form, 5 a power
 * point (p. 107, p. 69), doubled where Uncouth or Uneducated say so.
 */
export function karmaCostOf(spend: KarmaSpend, sheet: SpendSheet): number {
  const knowledge = sheet.knowledge ?? [];
  return spendKarma(spend, {
    doubling: costDoubling(sheet.qualities, sheet.identity?.metatype),
    knowledgeCategory: (name) => knowledge.find((k) => same(k.name, name))?.category ?? null,
  });
}

// ---------------------------------------------------------------------------
// Training time
// ---------------------------------------------------------------------------

/** Training for one spend: one entry per rating step, and their sum when the units agree. */
export interface SpendTraining {
  steps: readonly TrainingTime[];
  /** The steps added up; null when they mix units (a skill crossing rating 4, say). */
  total: TrainingTime | null;
}

export interface TrainingOptions {
  /** An instructor: skill training × 0.75, never attributes (p. 105). Unrounded. */
  instructor?: boolean;
  /** The Dependents quality: all training × 1.5 (p. 80). */
  dependents?: boolean;
}

/**
 * The most rating steps one spend is timed over. Every raise the rules allow
 * is a handful — a skill stops at 12 (13 with Aptitude), an attribute at its
 * metatype's maximum — and `KarmaSpend` bounds a rating well under this
 * (`SPEND_RATING_MAX`). The cap is here because the loop below is the one
 * place a number becomes an allocation: a spend that reaches the engine some
 * other way (a hand-written record, a caller yet to be written) must not be
 * able to turn one request into an unbounded array. Refusals name the real
 * ceilings; this one is never reached by anything the rules permit.
 */
export const MAX_TRAINING_STEPS = 32;

function steps(kind: TrainingKind, from: number, to: number): TrainingTime[] {
  const out: TrainingTime[] = [];
  const first = Math.max(0, from) + 1;
  const last = Math.min(to, first + MAX_TRAINING_STEPS - 1);
  for (let r = first; r <= last; r++) out.push(trainingTime(kind, r));
  return out;
}

/**
 * How long a spend takes to train (SR5 p. 107), shown and never enforced
 * (§8.5). Raising several ratings trains each in turn. Spells, forms, power
 * points, spirits, sprites, foci and an initiation's ordeal are not on the
 * Training Rate Table — what an ordeal takes is the GM's to set (p. 325) — so
 * they have no steps here.
 */
export function trainingTimeOf(spend: KarmaSpend, options: TrainingOptions = {}): SpendTraining {
  let raw: TrainingTime[] = [];
  let instructable = false;
  switch (spend.kind) {
    case 'attribute':
      raw = spend.id === 'edg' ? [trainingTime('edge')] : steps('attribute', spend.from, spend.to);
      break;
    case 'skill':
    case 'knowledge':
    case 'language':
      raw = steps('skill', spend.from, spend.to);
      instructable = true;
      break;
    case 'group':
      raw = steps('skillGroup', spend.from, spend.to);
      instructable = true;
      break;
    case 'specialization':
      // The instructor's quarter off is written for rating training (p. 105);
      // a specialisation is one month of dedicated, undivided training, and
      // three quarters of a month is not a time a table can read.
      raw = [trainingTime('specialization')];
      break;
    default:
      raw = [];
  }
  let factor = 1;
  if (options.instructor && instructable) factor *= TRAINING_MODIFIERS.instructor.factor;
  if (options.dependents) factor *= TRAINING_MODIFIERS.dependents.factor;
  const scaled = raw.map((t) => (t.unit === 'none' ? t : { amount: t.amount * factor, unit: t.unit }));
  const units = new Set(scaled.map((t) => t.unit));
  const first = scaled[0];
  const total =
    first === undefined
      ? null
      : units.size === 1
        ? { amount: scaled.reduce((sum, t) => sum + t.amount, 0), unit: first.unit }
        : null;
  return { steps: scaled, total };
}

// ---------------------------------------------------------------------------
// Applying a spend to a sheet
// ---------------------------------------------------------------------------

/**
 * A sheet skill's id as the skill table spells it. Imported sheets write
 * `unarmed_combat` where the table says `unarmed-combat`; a raise must find
 * the skill the sheet already has rather than add a second one beside it.
 */
function skillIdOf(id: string): string {
  return activeSkillRow(id)?.id ?? id;
}

function raiseSkill(skill: SheetSkill, to: number): SheetSkill {
  if (to <= skill.rating) return skill;
  // Raising one member on its own breaks the group it was bought through (p. 88).
  return { ...skill, rating: to, group: null };
}

function addSpec(existing: string | null | undefined, spec: string): string {
  const specs = (existing ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!specs.some((s) => same(s, spec))) specs.push(spec.trim());
  return specs.join(', ');
}

/**
 * A picked spell as the sheet's spell line: its category, the drain code the
 * sheet rolls (FR8.1), the page and the printed note — whatever the pick
 * carries, nothing invented. A granted spell and one bought with Karma land
 * the same way.
 */
export function sheetSpellOf(pick: BuildPick): SheetSpell {
  return {
    name: pick.name,
    ...(pick.category ? { category: pick.category } : {}),
    ...(pick.drain ? { drain: pick.drain } : {}),
    ...(pick.ref ? { ref: pick.ref } : {}),
    ...(pick.note ? { note: pick.note } : {}),
  };
}

/** A picked complex form as the sheet's line: target, fading, page and note, as the pick carries them. */
export function sheetFormOf(pick: BuildPick): SheetComplexForm {
  return {
    name: pick.name,
    ...(pick.target ? { target: pick.target } : {}),
    ...(pick.fading ? { fading: pick.fading } : {}),
    ...(pick.ref ? { ref: pick.ref } : {}),
    ...(pick.note ? { note: pick.note } : {}),
  };
}

/** How `applySpend` is being used — the two worlds a spend is applied in. */
export interface ApplySpendOptions {
  /**
   * A spend settled in play rather than one of a build's Step-8 spends. Two
   * things read differently there: a Magic or Resonance spend is asked for in
   * the ratings the sheet *shows*, after Essence loss (p. 278), so a bought
   * point is one more on the natural rating the loss is taken off; and an
   * adept's Magic raise brings the free Power Point the book grants with it
   * (p. 279). At creation the compiler writes both numbers once from the
   * build's own totals, so doing either there would count it twice.
   */
  inPlay?: boolean;
}

/**
 * A new sheet with the spend applied (FR3.7). Ratings only go up. Spirits,
 * sprites and foci do not live on the sheet (§8.2) — they come back
 * unchanged, and the caller writes them to the magic store. A specialisation
 * joins any the skill already has ("Pistols: Revolvers, Holdouts"), and on a
 * grouped skill it breaks the group, as the book says it must (p. 89).
 */
export function applySpend(sheet: SheetV1, spend: KarmaSpend, options: ApplySpendOptions = {}): SheetV1 {
  switch (spend.kind) {
    case 'attribute': {
      const a = sheet.attributes;
      if (spend.id === 'edg') {
        const max = Math.max(a.edg.max, spend.to);
        const current = Math.min(max, a.edg.current + (max - a.edg.max));
        return { ...sheet, attributes: { ...a, edg: { max, current } } };
      }
      if (options.inPlay && (spend.id === 'mag' || spend.id === 'res')) {
        const gained = Math.max(0, spend.to - spend.from);
        // The free Power Point an adept's Magic brings — never a mystic
        // adept's, which is the one the book excepts (p. 279).
        const free = spend.id === 'mag' && playMagicKind(sheet) === 'adept' ? gained : 0;
        return {
          ...sheet,
          attributes: { ...a, [spend.id]: a[spend.id] + gained },
          ...(free > 0 ? { awakening: { ...sheet.awakening, powerPoints: sheet.awakening.powerPoints + free } } : {}),
        };
      }
      return { ...sheet, attributes: { ...a, [spend.id]: Math.max(a[spend.id], spend.to) } };
    }
    case 'skill': {
      const id = activeSkillRow(spend.id)?.id ?? spend.id;
      const target = spend.target?.trim();
      const at = sheet.skills.findIndex((s) => skillIdOf(s.id) === id && same(s.target ?? '', target ?? ''));
      if (at >= 0) {
        return { ...sheet, skills: sheet.skills.map((s, i) => (i === at ? raiseSkill(s, spend.to) : s)) };
      }
      const attr = activeSkillRow(id)?.attr ?? skillAttrFor(id);
      const skill: SheetSkill = { id, rating: spend.to, attr, ...(target ? { target } : {}) };
      return { ...sheet, skills: [...sheet.skills, skill] };
    }
    case 'group': {
      const group = skillGroupRow(spend.id);
      if (!group) return sheet;
      const skills = sheet.skills.map((s) =>
        (group.skills as readonly string[]).includes(skillIdOf(s.id)) && s.rating < spend.to ? { ...s, rating: spend.to, group: group.name } : s,
      );
      for (const member of group.skills) {
        if (skills.some((s) => skillIdOf(s.id) === member)) continue;
        skills.push({ id: member, rating: spend.to, attr: activeSkillRow(member)?.attr ?? 'agi', group: group.name });
      }
      return { ...sheet, skills };
    }
    case 'knowledge': {
      const at = sheet.knowledge.findIndex((k) => same(k.name, spend.name));
      if (at >= 0) {
        return {
          ...sheet,
          knowledge: sheet.knowledge.map((k, i) => (i === at ? { ...k, rating: Math.max(k.rating, spend.to) } : k)),
        };
      }
      const added: SheetKnowledge = { name: spend.name.trim(), category: spend.category ?? 'street', rating: spend.to };
      return { ...sheet, knowledge: [...sheet.knowledge, added] };
    }
    case 'language': {
      const at = sheet.languages.findIndex((l) => same(l.name, spend.name));
      if (at >= 0) {
        return {
          ...sheet,
          languages: sheet.languages.map((l, i) => (i === at ? { ...l, rating: Math.max(l.rating, spend.to) } : l)),
        };
      }
      const added: SheetLanguage = { name: spend.name.trim(), rating: spend.to, native: false };
      return { ...sheet, languages: [...sheet.languages, added] };
    }
    case 'specialization': {
      if (spend.list === 'knowledge') {
        return {
          ...sheet,
          knowledge: sheet.knowledge.map((k) => (same(k.name, spend.id) ? { ...k, spec: addSpec(k.spec, spend.spec) } : k)),
        };
      }
      if (spend.list === 'language') {
        return {
          ...sheet,
          languages: sheet.languages.map((l) => (same(l.name, spend.id) ? { ...l, spec: addSpec(l.spec, spend.spec) } : l)),
        };
      }
      const id = activeSkillRow(spend.id)?.id ?? spend.id;
      return {
        ...sheet,
        skills: sheet.skills.map((s) => (skillIdOf(s.id) === id ? { ...s, spec: addSpec(s.spec, spend.spec), group: null } : s)),
      };
    }
    case 'spell':
      return { ...sheet, spells: [...sheet.spells, sheetSpellOf(spend)] };
    case 'form':
      return { ...sheet, complexForms: [...sheet.complexForms, sheetFormOf(spend)] };
    case 'powerPoint':
      return { ...sheet, awakening: { ...sheet.awakening, powerPoints: sheet.awakening.powerPoints + spend.count } };
    case 'initiation':
      // The grade only rises: a spend for a grade the sheet has already
      // passed changes nothing, as a skill raise to a rating already held does.
      return { ...sheet, awakening: { ...sheet.awakening, grade: Math.max(sheet.awakening.grade, spend.grade) } };
    case 'spirit':
    case 'sprite':
    case 'focus':
      return sheet;
  }
}

// ---------------------------------------------------------------------------
// In play: what a spend is called, and whether it still applies (FR3.7)
// ---------------------------------------------------------------------------

/** Why a spend cannot be made on a sheet in play — one code per rule. */
export type AdvanceRefusalCode =
  | 'advance-no-raise'
  | 'advance-stale'
  | 'advance-pending'
  | 'advance-attribute-max'
  | 'advance-attribute-absent'
  | 'advance-skill-unknown'
  | 'advance-skill-fenced'
  | 'advance-skill-max'
  | 'advance-group-unknown'
  | 'advance-group-fenced'
  | 'advance-group-broken'
  | 'advance-group-max'
  | 'advance-knowledge-category'
  | 'advance-knowledge-max'
  | 'advance-language-native'
  | 'advance-spec-on-group'
  | 'advance-spec-without-skill'
  | 'advance-spec-held'
  | 'advance-formula-not-caster'
  | 'advance-formula-held'
  | 'advance-form-not-technomancer'
  | 'advance-form-held'
  | 'advance-not-in-play';

/** The page each play-time rule is printed on; a fence's own page wins where it has one. */
export const ADVANCE_REFS: Readonly<Record<AdvanceRefusalCode, Ref>> = {
  'advance-no-raise': SR5(107),
  'advance-stale': SR5(107),
  'advance-pending': SR5(105),
  'advance-attribute-max': SR5(66),
  'advance-attribute-absent': SR5(68),
  'advance-skill-unknown': SR5(90),
  'advance-skill-fenced': SR5(89),
  'advance-skill-max': SR5(88),
  'advance-group-unknown': SR5(90),
  'advance-group-fenced': SR5(89),
  'advance-group-broken': SR5(88),
  'advance-group-max': SR5(88),
  'advance-knowledge-category': SR5(89),
  'advance-knowledge-max': SR5(88),
  'advance-language-native': SR5(89),
  'advance-spec-on-group': SR5(89),
  'advance-spec-without-skill': SR5(89),
  'advance-spec-held': SR5(89),
  'advance-formula-not-caster': SR5(69),
  'advance-formula-held': SR5(107),
  'advance-form-not-technomancer': SR5(69),
  'advance-form-held': SR5(107),
  'advance-not-in-play': SR5(107),
};

/** One play-time "no": the rule's code, our sentence, and its page. */
export interface AdvanceRefusal {
  code: AdvanceRefusalCode;
  message: string;
  ref: Ref;
}

/** The highest rating a skill, group, knowledge skill or language reaches in play (p. 88). */
export const PLAY_SKILL_RULES = {
  maxRating: CREATION_SKILL_RULES.maxRatingInPlay,
  maxRatingWithAptitude: CREATION_SKILL_RULES.maxRatingInPlayWithAptitude,
  ref: SR5(88),
} as const;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "4", "4.5", "0.75" — an amount without trailing zeros. */
function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Which of the three formula lists a picked spell belongs to, by its category. */
function formulaKind(category: string | undefined): 'spells' | 'rituals' | 'preparations' {
  const c = category ?? '';
  if (/ritual/i.test(c)) return 'rituals';
  if (/prep|alchem/i.test(c)) return 'preparations';
  return 'spells';
}

const FORMULA_NOUN = { spells: 'spell', rituals: 'ritual', preparations: 'preparation' } as const;

function skillLabel(id: string, target?: string): string {
  const name = activeSkillRow(id)?.name ?? id;
  const t = target?.trim();
  return t ? `${name}: ${t}` : name;
}

function raiseWords(name: string, from: number, to: number): string {
  return from <= 0 ? `Learn ${name} at ${to}` : `Raise ${name} ${from} → ${to}`;
}

/**
 * The longest a label grows. `AdvanceMutation.label` is bounded at the same
 * 300 characters, and the ledger's `reason` at 500 — a label built from
 * names a player typed must fit both, or the entry the GM approves cannot be
 * read back and the change it carries is silently lost. Cut by code point,
 * so a name's last character is never halved.
 */
export const ADVANCE_LABEL_MAX = 300;

function cutLabel(text: string): string {
  const points = [...text];
  return points.length <= ADVANCE_LABEL_MAX ? text : `${points.slice(0, ADVANCE_LABEL_MAX - 1).join('').trimEnd()}…`;
}

/** What a spend adds beyond its own rating — today, the power point an adept's Magic brings (p. 279). */
function labelBonus(spend: KarmaSpend, sheet?: LabelSheet): string {
  if (!sheet || spend.kind !== 'attribute' || spend.id !== 'mag') return '';
  if (playMagicKind(sheet) !== 'adept') return '';
  const gained = Math.max(0, spend.to - spend.from);
  return gained > 0 ? ` (+${plural(gained, 'power point')})` : '';
}

/** What `advanceLabel` reads off a sheet to know whose Magic is being raised. */
export type LabelSheet = Pick<SheetV1, 'awakening' | 'attributes' | 'powers' | 'spells'>;

/**
 * A spend in our words, as the ledger and the Improve panel show it: "Raise
 * Agility 4 → 5", "Learn Pistols at 1", "Specialise Pistols: Revolvers",
 * "Learn spell Flash", "Buy 2 power points". Given the sheet it is being
 * asked of, it also records what comes with the spend — an adept's free
 * power point — so the ledger line the GM approves says so.
 */
export function advanceLabel(spend: KarmaSpend, sheet?: LabelSheet): string {
  return cutLabel(`${plainLabel(spend)}${labelBonus(spend, sheet)}`);
}

function plainLabel(spend: KarmaSpend): string {
  switch (spend.kind) {
    case 'attribute':
      return `Raise ${BUILD_ATTRIBUTE_NAMES[spend.id].name} ${spend.from} → ${spend.to}`;
    case 'skill':
      return raiseWords(skillLabel(spend.id, spend.target), spend.from, spend.to);
    case 'group':
      return raiseWords(`${skillGroupRow(spend.id)?.name ?? spend.id} group`, spend.from, spend.to);
    case 'knowledge':
    case 'language':
      return raiseWords(spend.name.trim(), spend.from, spend.to);
    case 'specialization': {
      const name = spend.list === 'active' ? skillLabel(spend.id) : spend.id.trim();
      return `Specialise ${name}: ${spend.spec.trim()}`;
    }
    case 'spell':
      return `Learn ${FORMULA_NOUN[formulaKind(spend.category)]} ${spend.name.trim()}`;
    case 'form':
      return `Learn complex form ${spend.name.trim()}`;
    case 'powerPoint':
      return `Buy ${plural(spend.count, 'power point')}`;
    case 'initiation':
      // One word for both rites: which one it is belongs to the practitioner,
      // and the panel that shows this knows the sheet, so it says "grade".
      return `Take grade ${spend.grade}${spend.metamagic ? ` (${spend.metamagic.trim()})` : ''}`;
    case 'spirit':
      return `Bind a ${spend.type} spirit (${plural(spend.services, 'service')})`;
    case 'sprite':
      return `Register a ${spend.type} sprite (${plural(spend.tasks, 'task')})`;
    case 'focus':
      return `Bond ${spend.name.trim()} (Force ${spend.force})`;
  }
}

/**
 * What a spend improves, as a key: two spends with one key improve the same
 * thing ("attribute|agi", "skill|pistols|", "spell|flash"), so a second
 * request for it while the first waits on the GM is refused.
 */
export function advanceKey(spend: KarmaSpend): string {
  const low = (text: string): string => text.trim().toLowerCase();
  switch (spend.kind) {
    case 'attribute':
      return `attribute|${spend.id}`;
    case 'skill':
      return `skill|${skillIdOf(spend.id)}|${low(spend.target ?? '')}`;
    case 'group':
      return `group|${skillGroupRow(spend.id)?.id ?? low(spend.id)}`;
    case 'knowledge':
      return `knowledge|${low(spend.name)}`;
    case 'language':
      return `language|${low(spend.name)}`;
    case 'specialization':
      return `specialization|${spend.list}|${spend.list === 'active' ? skillIdOf(spend.id) : low(spend.id)}|${low(spend.spec)}`;
    case 'spell':
      return `spell|${low(spend.name)}`;
    case 'form':
      return `form|${low(spend.name)}`;
    case 'powerPoint':
      return 'powerPoint';
    // One key for every grade: a second grade while the first waits on the GM
    // is refused, because the first decides what the second costs.
    case 'initiation':
      return 'initiation';
    case 'spirit':
      return `spirit|${low(spend.type)}`;
    case 'sprite':
      return `sprite|${low(spend.type)}`;
    case 'focus':
      return `focus|${low(spend.name)}`;
  }
}

/**
 * A training time in words: "3 days", "4.5 weeks", "4 days, then 5 weeks",
 * and "no training time" for Edge and for what the table does not time.
 */
export function trainingPhrase(training: SpendTraining): string {
  const say = (t: TrainingTime): string => `${amountText(t.amount)} ${t.unit}${t.amount === 1 ? '' : 's'}`;
  const timed = training.steps.filter((t) => t.unit !== 'none');
  if (timed.length === 0) return 'no training time';
  if (training.total && training.total.unit !== 'none') return say(training.total);
  const runs: TrainingTime[] = [];
  for (const t of timed) {
    const last = runs[runs.length - 1];
    if (last && last.unit === t.unit) last.amount += t.amount;
    else runs.push({ ...t });
  }
  return runs.map(say).join(', then ');
}

// --- What the sheet says -----------------------------------------------------

/** The text a quality names its target by: the bracketed part of its name, else its note. */
function sheetQualityTarget(q: { name: string; note?: string | undefined }): string | null {
  const m = /[([{]\s*([^)\]}]+?)\s*[)\]}]/.exec(q.name);
  if (m?.[1]) return m[1];
  const note = q.note?.trim();
  return note ? note : null;
}

/**
 * What kind of practitioner a sheet in play is. A sheet written before the
 * Awakened block existed (a Chummer import) says `mundane` over a Magic or
 * Resonance rating; its ratings and lists are read instead — Resonance a
 * technomancer, powers and spells a mystic adept, powers alone an adept, any
 * other Magic a magician.
 */
export function playMagicKind(sheet: Pick<SheetV1, 'awakening' | 'attributes' | 'powers' | 'spells'>): MagicKind {
  const kind = sheet.awakening.kind;
  if (kind !== 'mundane') return kind;
  if (sheet.attributes.res > 0) return 'technomancer';
  if (sheet.attributes.mag > 0) {
    if (sheet.powers.length > 0) return sheet.spells.length > 0 ? 'mysticAdept' : 'adept';
    return 'magician';
  }
  return 'mundane';
}

/**
 * The Magic and Resonance a sheet's Essence has cost it: ⌈Essence spent⌉,
 * the rounding `derive` uses (SR5 p. 278 — 0.2 Essence takes a whole point
 * of Magic, and the maximum with it).
 */
export function specialAttributeLoss(sheet: Pick<SheetV1, 'augments'>): number {
  const spent = sheet.augments.reduce((sum, a) => sum + Math.max(0, a.essence), 0);
  return spent > 0 ? Math.ceil(spent - 1e-9) : 0;
}

/**
 * The Magic or Resonance rating a sheet *shows* — what `derive` puts on the
 * screen, and so the rating a raise in play is asked for, priced and capped
 * against. `attributes.mag`/`res` keep the natural rating the loss is taken
 * off, which is why these two are read through here and never straight.
 */
export function effectiveSpecial(sheet: Pick<SheetV1, 'augments' | 'attributes'>, id: 'mag' | 'res'): number {
  const natural = sheet.attributes[id];
  return natural > 0 ? Math.max(0, natural - specialAttributeLoss(sheet)) : 0;
}

/** The facts the play-time rules read off a sheet, gathered once. */
export interface PlayFacts {
  kind: MagicKind;
  aspect: MagicAspect | null;
  /** The attribute Exceptional Attribute names (never Edge), or null. */
  exceptional: Exclude<BuildAttributeId, 'edg'> | null;
  lucky: boolean;
  /** What Aptitude names, lower-cased: a skill id, or a knowledge skill's or language's name. */
  aptitude: string | null;
  dependents: boolean;
  /** Magic after Essence loss (⌈Essence spent⌉ off, as derive takes it). */
  effectiveMagic: number;
  eligibility: EligibilityContext;
}

/** The play-time facts of a sheet: its whitelisted qualities, its kind, its fences. */
export function playFacts(sheet: SheetV1): PlayFacts {
  const metatype = sheet.identity.metatype;
  const meta = metatypeRow(metatype);
  const kind = playMagicKind(sheet);
  const held = sheet.qualities
    .filter((q) => !isQualityBuyOff(q, metatype))
    .map((q) => ({ quality: q, rule: qualityRuleFor(q.name) }));
  const ids = new Set<string>(held.flatMap((h) => (h.rule ? [h.rule.id] : [])));
  for (const id of racialQualities(metatype, sheet.qualities)) ids.add(id);
  const first = (id: string) => held.find((h) => h.rule?.id === id);

  let exceptional: PlayFacts['exceptional'] = null;
  const ea = first('exceptionalAttribute');
  const eaText = ea ? sheetQualityTarget(ea.quality) : null;
  const eaCode = eaText ? attributeCode(eaText) : null;
  if (eaCode && ((ATTRIBUTE_CODES as readonly string[]).includes(eaCode) || eaCode === 'mag' || eaCode === 'res')) {
    exceptional = eaCode as PlayFacts['exceptional'];
  }
  const apt = first('aptitude');
  const aptText = apt ? sheetQualityTarget(apt.quality) : null;
  const aptitude = aptText ? (activeSkillRow(aptText)?.id ?? aptText.trim().toLowerCase()) : null;

  const incompetent = first('incompetent');
  const incompetentText = incompetent ? sheetQualityTarget(incompetent.quality) : null;
  const barred: SkillGroupId[] = [];
  if (ids.has('uncouth')) {
    for (const rule of QUALITY_RULE_BY_ID.uncouth.rules) {
      if (rule.kind === 'barsGroup' && rule.groups !== 'chosen') barred.push(...rule.groups);
    }
  }
  const kindRow = MAGIC_KIND_TABLE[kind];
  const aspect = kind === 'aspected' ? sheet.awakening.aspect : null;
  return {
    kind,
    aspect,
    exceptional,
    lucky: ids.has('lucky'),
    aptitude,
    dependents: ids.has('dependents'),
    effectiveMagic: effectiveSpecial(sheet, 'mag'),
    eligibility: {
      kind,
      aspect,
      magicRating: kindRow.attribute === 'mag' ? sheet.attributes.mag : 0,
      canPerceive:
        kindRow.astralPerception === 'innate' ||
        (kindRow.astralPerception === 'power' && sheet.powers.some((p) => /astral\s+perception/i.test(p.name))) ||
        (!!meta && hasRacialTrait(meta, 'astralPerception')),
      incompetentGroup: incompetentText ? (skillGroupRow(incompetentText)?.id ?? null) : null,
      barredGroups: barred,
    },
  };
}

/** The sheet's skill for an id (and target), matched as the skill table spells ids. */
function sheetSkillFor(sheet: SheetV1, id: string, target?: string): SheetSkill | undefined {
  const want = skillIdOf(id);
  return sheet.skills.find((s) => skillIdOf(s.id) === want && same(s.target ?? '', target ?? ''));
}

function specsOf(spec: string | null | undefined): string[] {
  return (spec ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where a skill group stands on a sheet: the rating its skills share, or why it is broken. */
export interface GroupStanding {
  row: SkillGroupRow;
  /** Every member's rating (0 for one the sheet lacks), in the table's order. */
  members: readonly { id: string; name: string; rating: number }[];
  /** The rating the members share; null when they differ. */
  level: number | null;
  /** A specialised member's name — a group with one cannot be raised as a group (p. 89). */
  specialised: string | null;
}

/** A skill group's standing on a sheet; null for a group the tables do not know. */
export function groupStanding(sheet: SheetV1, id: string): GroupStanding | null {
  const row = skillGroupRow(id);
  if (!row) return null;
  const members = row.skills.map((member) => {
    const skill = sheet.skills.find((s) => skillIdOf(s.id) === member && !s.target);
    return { id: member, name: activeSkillRow(member)?.name ?? member, rating: skill?.rating ?? 0, specs: specsOf(skill?.spec) };
  });
  const level = members[0]?.rating ?? 0;
  return {
    row,
    members: members.map((m) => ({ id: m.id, name: m.name, rating: m.rating })),
    level: members.every((m) => m.rating === level) ? level : null,
    specialised: members.find((m) => m.specs.length > 0)?.name ?? null,
  };
}

/**
 * The rating a rated spend starts from on a sheet — an attribute's (Edge's
 * maximum), a skill's, a level group's, a knowledge skill's or a language's,
 * 0 for one the sheet lacks — or null: a broken group, or a spend with no
 * rating (a specialisation, a spell, power points).
 */
export function advanceCurrentRating(sheet: SheetV1, spend: KarmaSpend): number | null {
  switch (spend.kind) {
    case 'attribute':
      if (spend.id === 'edg') return sheet.attributes.edg.max;
      // Magic and Resonance are the ratings Essence loss has already taken
      // its point out of — the rating the sheet shows (p. 278).
      if (spend.id === 'mag' || spend.id === 'res') return effectiveSpecial(sheet, spend.id);
      return sheet.attributes[spend.id];
    case 'skill':
      return sheetSkillFor(sheet, spend.id, spend.target)?.rating ?? 0;
    case 'group': {
      const standing = groupStanding(sheet, spend.id);
      return standing && !standing.specialised ? standing.level : null;
    }
    case 'knowledge':
      return sheet.knowledge.find((k) => same(k.name, spend.name))?.rating ?? 0;
    case 'language':
      return sheet.languages.find((l) => same(l.name, spend.name))?.rating ?? 0;
    default:
      return null;
  }
}

/**
 * An attribute's natural maximum in play (pp. 66, 72, 76): the metatype's,
 * one more for the attribute Exceptional Attribute names or, for Edge,
 * Lucky. Magic and Resonance top out at 6 (initiation and submersion raise
 * that, and are not offered here), less what Essence has cost them — the
 * book's example loses 0.2 Essence and reads "his maximum Magic rating is
 * now 5" (p. 278), which is the same reduced ladder the raises are priced
 * on. Null for a mental, physical or Edge maximum of a metatype the tables
 * do not know — no ceiling is invented for it — and 0 for Resonance on a
 * metatype that can never have it.
 */
export function attributeMaxInPlay(sheet: SheetV1, id: BuildAttributeId, facts: PlayFacts = playFacts(sheet)): number | null {
  const meta = metatypeRow(sheet.identity.metatype);
  const bonus = CREATION_ATTRIBUTE_RULES.qualityMaxBonus;
  const plus = facts.exceptional === id ? bonus : 0;
  const special = CREATION_ATTRIBUTE_RULES.specialMax;
  const lost = id === 'mag' || id === 'res' ? specialAttributeLoss(sheet) : 0;
  switch (id) {
    case 'edg':
      return meta ? meta.attributes.edg.max + (facts.lucky ? bonus : 0) : null;
    case 'mag':
      return Math.max(0, Math.min(meta?.magic.max ?? special, special) + plus - lost);
    case 'res':
      if (meta && !meta.resonance) return 0;
      return Math.max(0, Math.min(meta?.resonance?.max ?? special, special) + plus - lost);
    default:
      return meta ? meta.attributes[id].max + plus : null;
  }
}

/** The highest rating a skill (by id) or a knowledge skill or language (by name) reaches in play (p. 88). */
export function skillMaxInPlay(facts: Pick<PlayFacts, 'aptitude'>, idOrName: string): number {
  const key = activeSkillRow(idOrName)?.id ?? idOrName.trim().toLowerCase();
  return facts.aptitude !== null && facts.aptitude === key ? PLAY_SKILL_RULES.maxRatingWithAptitude : PLAY_SKILL_RULES.maxRating;
}

/** Whether a kind learns formulae of a list: magicians and mystic adepts all three; an aspected magician its aspect's (p. 69). */
function learnsFormula(kind: MagicKind, aspect: MagicAspect | null, list: 'spells' | 'rituals' | 'preparations'): boolean {
  switch (kind) {
    case 'magician':
    case 'mysticAdept':
      return true;
    case 'aspected':
      if (!aspect) return true;
      return aspect === 'sorcery' ? list !== 'preparations' : aspect === 'enchanting' && list === 'preparations';
    default:
      return false;
  }
}

export interface AdvanceCheckOptions {
  /** Spends already waiting on the GM for this character: asking again for the same thing is refused. */
  pending?: readonly KarmaSpend[];
  /** The sheet's facts, when the caller has gathered them already. */
  facts?: PlayFacts;
}

/**
 * Every rule that stops a spend on a sheet in play, in the order a player
 * would fix them; empty when the spend applies. Run when the spend is asked
 * for and again when the GM approves it (§8.5). The price is not a refusal —
 * whether the Karma is there is the ledger's question.
 */
export function advanceRefusals(sheet: SheetV1, spend: KarmaSpend, options: AdvanceCheckOptions = {}): AdvanceRefusal[] {
  const facts = options.facts ?? playFacts(sheet);
  const out: AdvanceRefusal[] = [];
  const add = (code: AdvanceRefusalCode, message: string, ref: Ref = ADVANCE_REFS[code]): void => {
    out.push({ code, message, ref });
  };
  const key = advanceKey(spend);
  if (options.pending?.some((p) => advanceKey(p) === key)) {
    add('advance-pending', `${advanceLabel(spend)} is already waiting for the GM.`);
  }
  /** A rated spend's two checks: it goes up, and it starts where the sheet is. */
  const rated = (name: string, current: number, from: number, to: number): void => {
    if (to <= from) add('advance-no-raise', `${name}: ${from} → ${to} raises nothing.`);
    else if (from !== current) add('advance-stale', `${name} is ${current} now, not ${from}.`);
  };
  const fence = (code: 'advance-skill-fenced' | 'advance-group-fenced', eligibility: Eligibility, name: string): void => {
    const reason = eligibility.reasons[0];
    if (!reason) return;
    const magic = facts.aspect ? { kind: facts.kind, aspect: facts.aspect } : { kind: facts.kind };
    add(code, eligibilityMessage(reason.code, name, { magic }), reason.ref);
  };

  switch (spend.kind) {
    case 'attribute': {
      const name = BUILD_ATTRIBUTE_NAMES[spend.id].name;
      // Edge by its maximum, Magic and Resonance by the rating the sheet
      // shows after Essence loss, everything else as it stands.
      const current = advanceCurrentRating(sheet, spend) ?? 0;
      rated(name, current, spend.from, spend.to);
      if (spend.id === 'mag' && MAGIC_KIND_TABLE[facts.kind].attribute !== 'mag') {
        add('advance-attribute-absent', 'Only the Awakened have a Magic rating to raise.');
        break;
      }
      if (spend.id === 'res' && MAGIC_KIND_TABLE[facts.kind].attribute !== 'res') {
        add('advance-attribute-absent', 'Only technomancers have a Resonance rating to raise.');
        break;
      }
      const max = attributeMaxInPlay(sheet, spend.id, facts);
      if (max !== null && spend.to > max) {
        add('advance-attribute-max', `${name} stops at its natural maximum of ${max}.`);
      }
      break;
    }
    case 'skill': {
      const row = activeSkillRow(spend.id);
      if (!row) {
        add('advance-skill-unknown', `"${spend.id}" is not a skill the tables know.`);
        break;
      }
      const name = skillLabel(row.id, spend.target);
      rated(name, sheetSkillFor(sheet, row.id, spend.target)?.rating ?? 0, spend.from, spend.to);
      fence('advance-skill-fenced', skillEligibilityIn(facts.eligibility, row), row.name);
      const max = skillMaxInPlay(facts, row.id);
      if (spend.to > max) add('advance-skill-max', `${name} stops at ${max} in play.`);
      break;
    }
    case 'group': {
      const standing = groupStanding(sheet, spend.id);
      if (!standing) {
        add('advance-group-unknown', `"${spend.id}" is not a skill group the tables know.`);
        break;
      }
      const name = `${standing.row.name} group`;
      if (standing.specialised) {
        // The specialisation that breaks a group for good is p.89's rule; the
        // unlevel one below is p.88's.
        add('advance-group-broken', `${standing.row.name} cannot be raised as a group: ${standing.specialised} is specialised.`, SR5(89));
      } else if (standing.level === null) {
        const levels = standing.members.map((m) => `${m.name} ${m.rating}`).join(', ');
        add('advance-group-broken', `${standing.row.name} cannot be raised as a group while its skills differ: ${levels}.`);
      } else {
        rated(name, standing.level, spend.from, spend.to);
      }
      fence('advance-group-fenced', groupEligibilityIn(facts.eligibility, standing.row), standing.row.name);
      if (spend.to > PLAY_SKILL_RULES.maxRating) {
        add('advance-group-max', `${name} stops at ${PLAY_SKILL_RULES.maxRating} in play.`);
      }
      break;
    }
    case 'knowledge': {
      const held = sheet.knowledge.find((k) => same(k.name, spend.name));
      const name = spend.name.trim();
      rated(name, held?.rating ?? 0, spend.from, spend.to);
      if (!held && !spend.category) add('advance-knowledge-category', `Give ${name} a knowledge category.`);
      // A spend that claims a category the sheet contradicts is named rather
      // than priced: the category decides whether Uneducated doubles it (p.87).
      else if (held && spend.category && spend.category !== held.category) {
        add('advance-knowledge-category', `${name} is filed as ${held.category}, not ${spend.category}.`);
      }
      const max = skillMaxInPlay(facts, name);
      if (spend.to > max) add('advance-knowledge-max', `${name} stops at ${max} in play.`);
      break;
    }
    case 'language': {
      const held = sheet.languages.find((l) => same(l.name, spend.name));
      const name = spend.name.trim();
      if (held?.native) {
        add('advance-language-native', `${name} is a native language: it has no rating to raise.`);
        break;
      }
      rated(name, held?.rating ?? 0, spend.from, spend.to);
      const max = skillMaxInPlay(facts, name);
      if (spend.to > max) add('advance-knowledge-max', `${name} stops at ${max} in play.`);
      break;
    }
    case 'specialization': {
      const spec = spend.spec.trim();
      if (spend.list === 'active') {
        const row = activeSkillRow(spend.id);
        if (!row) {
          if (skillGroupRow(spend.id)) add('advance-spec-on-group', 'A skill group takes no specialisation; pick one of its skills.');
          else add('advance-skill-unknown', `"${spend.id}" is not a skill the tables know.`);
          break;
        }
        const skill = sheet.skills.filter((s) => skillIdOf(s.id) === row.id).sort((a, b) => b.rating - a.rating)[0];
        if (!skill || skill.rating <= 0) add('advance-spec-without-skill', `${row.name} needs a rating before it can be specialised.`);
        else if (specsOf(skill.spec).some((s) => same(s, spec))) add('advance-spec-held', `${row.name} is already specialised in ${spec}.`);
        break;
      }
      const name = spend.id.trim();
      const held: { rating: number; native: boolean; spec?: string | null | undefined } | undefined =
        spend.list === 'knowledge'
          ? sheet.knowledge.map((k) => ({ ...k, native: false })).find((k) => same(k.name, spend.id))
          : sheet.languages.find((l) => same(l.name, spend.id));
      if (!held || (held.rating <= 0 && !held.native)) {
        add('advance-spec-without-skill', `${name} needs a rating before it can be specialised.`);
      } else if (specsOf(held.spec).some((s) => same(s, spec))) {
        add('advance-spec-held', `${name} is already specialised in ${spec}.`);
      }
      break;
    }
    case 'spell': {
      const list = formulaKind(spend.category);
      if (!learnsFormula(facts.kind, facts.aspect, list)) {
        add(
          'advance-formula-not-caster',
          list === 'preparations'
            ? 'Only magicians, mystic adepts and enchanters learn preparations.'
            : `Only magicians, mystic adepts and sorcerers learn ${FORMULA_NOUN[list]}s.`,
        );
      }
      if (sheet.spells.some((s) => same(s.name, spend.name))) add('advance-formula-held', `${spend.name.trim()} is already known.`);
      break;
    }
    case 'form':
      if (facts.kind !== 'technomancer') add('advance-form-not-technomancer', 'Only technomancers learn complex forms.');
      if (sheet.complexForms.some((f) => same(f.name, spend.name))) add('advance-form-held', `${spend.name.trim()} is already known.`);
      break;
    case 'powerPoint':
      // A mystic adept buys power points with Karma at creation and only
      // there (p. 69); in play an adept's come with a Magic rating and an
      // initiate's instead of a metamagic, neither of them a Karma price
      // paid here (p. 279).
      add('advance-not-in-play', 'Power points are bought at creation; in play they come with Magic or with initiation.', SR5(279));
      break;
    case 'initiation':
      // A grade at creation is the prime runner's Karma purchase (p. 64,
      // p. 98) and the builder's Step 8 sells it. In play a grade comes with
      // an ordeal and a group the GM runs (p. 325), and nothing here can
      // judge either — so it is refused rather than priced, which also keeps
      // a request from skipping straight to a high grade at one grade's price.
      add('advance-not-in-play', 'A grade at creation is bought with Karma; in play the GM records the ordeal.', SR5(325));
      break;
    case 'spirit':
      add('advance-not-in-play', 'Bound spirits come from summoning in play, not from Karma.');
      break;
    case 'sprite':
      add('advance-not-in-play', 'Registered sprites come from compiling in play, not from Karma.');
      break;
    case 'focus':
      add('advance-not-in-play', 'A focus in play is bonded on the Magic tab, not bought here.');
      break;
  }
  return out;
}

/**
 * Something the table should know about a spend that no rule stops — said,
 * like a training time, and never enforced (§8.5).
 */
export interface AdvanceNote {
  message: string;
  ref: Ref;
}

/**
 * How far one downtime carries a raise (pp. 105–106): two ratings of an
 * attribute, three of a skill, one of a skill group. Nothing here refuses a
 * longer raise — the GM decides how many downtimes the entry covers — but
 * the ceiling is said beside the training time rather than left in the
 * tables unread.
 */
function downtimeNotes(spend: KarmaSpend): AdvanceNote[] {
  const limits = DOWNTIME_LIMITS;
  const over = (asked: number, ceiling: number, noun: string, ref: Ref): AdvanceNote[] =>
    asked > ceiling
      ? [{ message: `One downtime raises ${noun} by ${plural(ceiling, 'rating')}; this asks for ${asked}.`, ref }]
      : [];
  switch (spend.kind) {
    case 'attribute':
      if (spend.id === 'edg') return [];
      return over(spend.to - spend.from, limits.attributeRatings, 'an attribute', limits.ref);
    case 'skill':
    case 'knowledge':
    case 'language':
      return over(spend.to - spend.from, limits.skillRatings, 'a skill', limits.skillRef);
    case 'group':
      return over(spend.to - spend.from, limits.skillGroupRatings, 'a skill group', limits.skillRef);
    default:
      return [];
  }
}

/** Everything the Improve panel and the advance route say about one spend. */
export interface AdvanceQuote {
  /** "Raise Agility 4 → 5". */
  label: string;
  /** Karma, doubled where Uncouth or Uneducated say so (`karmaCostOf`). */
  cost: number;
  /** Training time, with Dependents' half again (shown, never enforced). */
  training: SpendTraining;
  /** The ledger line: "Raise Agility 4 → 5 · 25 Karma". */
  reason: string;
  /** Empty when the spend applies. */
  refusals: readonly AdvanceRefusal[];
  /** What is said but not enforced — today, a downtime ceiling the raise passes. */
  notes: readonly AdvanceNote[];
}

/** A spend on a sheet in play: its name, price, training time and every rule against it. */
export function quoteAdvance(
  sheet: SheetV1,
  spend: KarmaSpend,
  options: AdvanceCheckOptions & Pick<TrainingOptions, 'instructor'> = {},
): AdvanceQuote {
  const facts = options.facts ?? playFacts(sheet);
  const label = advanceLabel(spend, sheet);
  const cost = karmaCostOf(spend, sheet);
  return {
    label,
    cost,
    training: trainingTimeOf(spend, { dependents: facts.dependents, ...(options.instructor ? { instructor: true } : {}) }),
    reason: `${label} · ${cost.toLocaleString('en-US')} Karma`,
    refusals: advanceRefusals(sheet, spend, { ...options, facts }),
    notes: downtimeNotes(spend),
  };
}
