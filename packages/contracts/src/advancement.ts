/**
 * Career-mode advancement (FR3.7, docs/CHARGEN.md §8.5 "Advancement") — the
 * wire shapes between the sheet's Improve panel, the advance route and the
 * ledger that settles it.
 *
 * A runner in play improves with Karma the way a build's Step 8 does, at the
 * same prices (SR5 p. 107), so the request carries exactly a build's
 * `KarmaSpend`. What the server writes is not a sheet change but a *pending
 * Karma ledger entry* that carries the change with it: the GM approves the
 * spend where every other Karma spend is settled, and approving it is what
 * applies the change to the sheet as a revision. The entry's `advance` is
 * that carried change — the spend, the price and the training time the
 * player was quoted, and the words the ledger shows ("Raise Agility 4 → 5").
 *
 * The same file holds the little a character row says about how the runner
 * was built (`CharacterBuildSummary`), so the sheet can show "built with
 * Priority B/A/E/C/D" without shipping the whole build record to every
 * reader of a character.
 *
 * Schemas only; the rules are `@safehouse/rules` `chargen/advance.ts`.
 */
import { z } from 'zod';
import {
  BuildMethodSchema,
  BuildPrioritiesSchema,
  CreationLevelSchema,
  KarmaSpendSchema,
  PriorityTableSchema,
} from './build.js';
import { MagicKindSchema } from './sheet.js';

/** The units the Training Rate Table (SR5 p. 107) counts in; `none` is Edge's. */
export const TRAINING_UNITS = ['none', 'day', 'week', 'month'] as const;
export const TrainingUnitSchema = z.enum(TRAINING_UNITS);

/** One stretch of training. `amount` may be fractional (an instructor's 4.5 weeks). */
export const TrainingTimeSchema = z.object({
  amount: z.number().min(0),
  unit: TrainingUnitSchema,
});

/**
 * How long a spend trains: one step per rating raised, and their sum when the
 * units agree (null when they do not — a skill crossing rating 4). Shown,
 * never enforced (§8.5).
 */
export const SpendTrainingSchema = z.object({
  steps: z.array(TrainingTimeSchema),
  total: TrainingTimeSchema.nullable(),
});
export type SpendTrainingDto = z.infer<typeof SpendTrainingSchema>;

/**
 * `POST /api/characters/:id/advance`. The owner's request is always pending;
 * the GM's own is approved (and applied) at once unless `state: 'pending'`
 * asks to leave it on the ledger like anyone else's.
 */
export const AdvanceRequestSchema = z.object({
  spend: KarmaSpendSchema,
  state: z.enum(['pending', 'approved']).optional(),
});
export type AdvanceRequest = z.infer<typeof AdvanceRequestSchema>;
export type AdvanceRequestInput = z.input<typeof AdvanceRequestSchema>;

/**
 * The change a Karma ledger entry carries until it is settled: applied to the
 * sheet when the entry is approved, forgotten when it is rejected. `cost` is
 * the Karma quoted when it was asked for (the entry's delta is −cost);
 * `label` is our words for it.
 */
export const AdvanceMutationSchema = z.object({
  kind: z.literal('advance'),
  spend: KarmaSpendSchema,
  cost: z.number().int().min(0),
  trainingTime: SpendTrainingSchema,
  label: z.string().min(1).max(300),
});
export type AdvanceMutation = z.infer<typeof AdvanceMutationSchema>;

/**
 * What a character row says about the build that made it (§4.1 "the sheet
 * page can show 'built with Priority B/A/E/C/D'"): the method, the level, the
 * printing, the five priorities in column order, the metatype and the magic
 * type. Null on a character that was imported or typed in.
 */
export const CharacterBuildSummarySchema = z.object({
  method: BuildMethodSchema,
  level: CreationLevelSchema,
  table: PriorityTableSchema,
  priorities: BuildPrioritiesSchema,
  metatype: z.string().nullable(),
  magic: MagicKindSchema,
});
export type CharacterBuildSummary = z.infer<typeof CharacterBuildSummarySchema>;
