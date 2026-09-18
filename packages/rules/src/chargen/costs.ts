/**
 * What improvement costs — Karma and training time (FR3.7, FR3.9;
 * docs/CHARGEN.md §8.4). The same functions price Step Eight's leftover
 * Karma at creation and every advancement in play, so the two can never
 * drift apart.
 *
 * The book prints cumulative tables (SR5 p. 107); what it states is the rule
 * behind them — attribute new rating × 5, active skill × 2, group × 5,
 * knowledge and language × 1 — and a raise of several ratings costs the sum
 * of each step. That is what these compute; `chargen-tables.test.ts` checks
 * them cell by cell against the printed table. Raising from a rating to the
 * same or a lower one costs nothing: refunds are not a thing the book has.
 *
 * Training time (p. 107) is shown, not enforced (§8.5). The instructor and
 * Dependents factors are data only — the book rounds the instructor's 25%
 * "down" and then prints 4.5 weeks in its own example (p. 106), so the
 * rounding is left to the caller that shows it.
 *
 * Numbers and page refs only (DESIGN.md §14).
 */
import type { Ref } from '@safehouse/contracts';
import { SR5 } from './pages.js';

/** The flat and per-rating Karma prices (SR5 pp. 98, 106–107). */
export const KARMA_COSTS = {
  attributePerRating: 5,
  activeSkillPerRating: 2,
  skillGroupPerRating: 5,
  knowledgeSkillPerRating: 1,
  /** A new specialisation on an active, knowledge or language skill. */
  specialization: 7,
  /** A new knowledge or language skill at rating 1. */
  newKnowledgeSkill: 1,
  /** A new spell, ritual or preparation. */
  spell: 5,
  complexForm: 4,
  /** A mystic adept's Power Point (p. 69). */
  powerPoint: 5,
  /** Initiation or submersion: base + grade × perGrade. */
  initiationBase: 10,
  initiationPerGrade: 3,
  /** In play: a positive quality at its cost × 2; buying off a negative at its bonus × 2. */
  positiveQualityInPlayMultiplier: 2,
  negativeQualityBuyOffMultiplier: 2,
  /** At creation: a bound spirit's service or a registered sprite's task (p. 98). */
  spiritService: 1,
  spriteTask: 1,
  ref: SR5(107),
} as const;

/** Σ r × perRating for r in (from, to]; zero when nothing is raised. */
function perRating(from: number, to: number, perRatingCost: number): number {
  if (to <= from) return 0;
  const lo = Math.max(0, from);
  return (perRatingCost * (to * (to + 1) - lo * (lo + 1))) / 2;
}

/** An attribute (mental, physical or special) from one rating to another: new × 5 per step. */
export function karmaForAttribute(from: number, to: number): number {
  return perRating(from, to, KARMA_COSTS.attributePerRating);
}

/** An active skill, including a new one from 0: new × 2 per step. */
export function karmaForActiveSkill(from: number, to: number): number {
  return perRating(from, to, KARMA_COSTS.activeSkillPerRating);
}

/** A skill group: new × 5 per step. */
export function karmaForSkillGroup(from: number, to: number): number {
  return perRating(from, to, KARMA_COSTS.skillGroupPerRating);
}

/** A knowledge or language skill: new × 1 per step (a new one to rating 1 is the flat 1). */
export function karmaForKnowledgeSkill(from: number, to: number): number {
  return perRating(from, to, KARMA_COSTS.knowledgeSkillPerRating);
}

/**
 * Where each rite is explained: a magician initiates (p. 325), a technomancer
 * submerges (p. 259). One Karma cost, two names and two pages, so a screen can
 * call the control what the runner in front of it would call it.
 */
export const INITIATION_REFS = {
  initiation: SR5(325),
  submersion: SR5(259),
} as const;

/** Initiation or submersion to a grade: 10 + grade × 3. Not purchasable at creation below prime (p. 98). */
export function karmaForInitiation(grade: number): number {
  return KARMA_COSTS.initiationBase + grade * KARMA_COSTS.initiationPerGrade;
}

/** A positive quality bought in play, from its listed cost. */
export function karmaForQualityInPlay(listedCost: number): number {
  return listedCost * KARMA_COSTS.positiveQualityInPlayMultiplier;
}

/** Buying off a negative quality, from its listed bonus. */
export function karmaForQualityBuyOff(listedBonus: number): number {
  return listedBonus * KARMA_COSTS.negativeQualityBuyOffMultiplier;
}

// ---------------------------------------------------------------------------
// Training time (SR5 pp. 105–107)
// ---------------------------------------------------------------------------

export type TrainingKind = 'attribute' | 'edge' | 'skill' | 'skillGroup' | 'specialization';
export type TrainingUnit = 'none' | 'day' | 'week' | 'month';

export interface TrainingTime {
  amount: number;
  unit: TrainingUnit;
}

/**
 * How long one step of training takes, to `newRating` (ignored for Edge and
 * specialisations). Attributes — Magic and Resonance included — take new ×
 * 1 week; Edge takes none; a skill (active, knowledge or language) takes
 * new × 1 day to rating 4, new × 1 week to 8, new × 2 weeks beyond; a group
 * new × 2 weeks; a specialisation one month.
 */
export function trainingTime(kind: TrainingKind, newRating = 0): TrainingTime {
  switch (kind) {
    case 'edge':
      return { amount: 0, unit: 'none' };
    case 'attribute':
      return { amount: newRating, unit: 'week' };
    case 'skill':
      if (newRating <= 4) return { amount: newRating, unit: 'day' };
      if (newRating <= 8) return { amount: newRating, unit: 'week' };
      return { amount: newRating * 2, unit: 'week' };
    case 'skillGroup':
      return { amount: newRating * 2, unit: 'week' };
    case 'specialization':
      return { amount: 1, unit: 'month' };
  }
}

/** Multipliers on training time, unrounded (see the file note). */
export const TRAINING_MODIFIERS = {
  /** An instructor cuts skill training by 25%; never attributes (p. 105). */
  instructor: { factor: 0.75, ref: SR5(105) },
  /** The Dependents quality adds 50% (p. 80). */
  dependents: { factor: 1.5, ref: SR5(80) },
} as const satisfies Readonly<Record<string, { factor: number; ref: Ref }>>;

/**
 * Per-downtime ceilings on advancement (pp. 105–106). The attribute ceiling
 * and the skills-only rule are printed on p. 105, the skill and skill-group
 * ones on p. 106, so there are two refs: a quote that names one of these
 * sends the reader to the page it is actually on.
 */
export const DOWNTIME_LIMITS = {
  attributeRatings: 2,
  skillRatings: 3,
  skillGroupRatings: 1,
  /** A skills-only downtime trains up to ⌈LOG ÷ this⌉ skills. */
  skillsOnlyLogicDivisor: 2,
  ref: SR5(105),
  /** Where the skill and skill-group ceilings are printed. */
  skillRef: SR5(106),
} as const;
