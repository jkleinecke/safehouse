/**
 * Implant grades (FR3.9 P4, docs/CHARGEN.md §8.4): the Essence, cost and
 * Availability multipliers a cyberware or bioware grade applies, and which
 * grades a character may start with.
 *
 * From the Implant Grades table (SR5 p. 451); the creation fence — standard,
 * alphaware and used only — is p. 95. The Availability modifier matters to
 * the builder as much as the other two: alphaware's +2 is what pushes a
 * 12-Availability implant past the creation cap. Used does not combine with
 * another grade, and an add-on takes its host's grade (p. 451); those are
 * the validator's to enforce.
 *
 * Numbers and page refs only (DESIGN.md §14). Sheets store Essence with the
 * grade already applied (`SheetAugment.essence`), so derive never sees these.
 */
import type { AugmentGrade, Ref } from '@safehouse/contracts';
import { SR5 } from './pages.js';

/** Keyed by the contracts' `AugmentGrade` (the `grade` a build purchase carries). */
export interface ImplantGradeRow {
  id: AugmentGrade;
  /** Essence cost multiplier. */
  essence: number;
  /** Nuyen cost multiplier. */
  cost: number;
  /** Added to the item's Availability (negative for used). */
  availability: number;
  /** Legal at character creation (p. 95). */
  atCreation: boolean;
  ref: Ref;
}

export const IMPLANT_GRADES: Readonly<Record<AugmentGrade, ImplantGradeRow>> = {
  standard: { id: 'standard', essence: 1, cost: 1, availability: 0, atCreation: true, ref: SR5(451) },
  alphaware: { id: 'alphaware', essence: 0.8, cost: 1.2, availability: 2, atCreation: true, ref: SR5(451) },
  betaware: { id: 'betaware', essence: 0.7, cost: 1.5, availability: 4, atCreation: false, ref: SR5(451) },
  deltaware: { id: 'deltaware', essence: 0.5, cost: 2.5, availability: 8, atCreation: false, ref: SR5(451) },
  used: { id: 'used', essence: 1.25, cost: 0.75, availability: -4, atCreation: true, ref: SR5(451) },
};

/** Where the creation fence on grades is stated. */
export const CREATION_GRADE_REF: Ref = SR5(95);
