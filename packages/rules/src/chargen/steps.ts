/**
 * Where the walkthrough stands — each of the nine screens complete or not,
 * and why (FR3.9, docs/CHARGEN.md §4.4 "Complete when", §8.7 numbering).
 *
 * Guided mode opens Next only on a complete step, and the screen names what
 * is missing; free mode gates nothing but Submit. Both read this. A step is
 * complete when nothing *blocks* it, and what blocks a step is:
 *
 * - every `error` the validator files under that step — so a change upstream
 *   that breaks a later step turns that step red again rather than clearing
 *   it (§4.4 "nothing is lost by going back");
 * - plus the step's own completion rule where it is stricter than its
 *   errors: Step 7 needs a lifestyle, which is otherwise only a warning.
 *
 * Steps 1–8 follow §4.4: 1 an alias; 2 all five priorities; 3 every attribute
 * point spent (unspent special points warn — they vanish, p. 66 — but the
 * step lets a player pass with "I meant to"); 4 every grant filled or waived,
 * and a mundane's Step 4 is skipped (unless a finding is still filed there —
 * leftovers from an earlier kind — which makes it a step to visit, not pass);
 * 5 both quality totals within the cap;
 * 6 every skill, group and knowledge point spent; 7 nuyen not overspent and a
 * lifestyle kept; 8 no more Karma left than carries. Step 9 is Submit's gate:
 * blocked by every error in the build. Warnings and undecided GM approvals
 * are listed but never block — the approvals are the GM's to make.
 *
 * Pure — no I/O. No book text (DESIGN.md §14).
 */
import {
  BUILD_STEPS,
  type BuildStep,
  type BuildStepName,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
} from '@safehouse/contracts';
import { validate } from './validate.js';

export interface StepStatus {
  step: BuildStep;
  name: BuildStepName;
  complete: boolean;
  /** Nothing to do on this step for this build (a mundane's Magic step). */
  skipped: boolean;
  /** What stops Next (or, on Finish, Submit). */
  blocking: readonly Issue[];
  /** Worth a look, not blocking: warnings and approvals still waiting on the GM. */
  warnings: readonly Issue[];
}

/** Issue codes a step needs gone even though their severity alone would not block. */
const STEP_REQUIRES: Readonly<Partial<Record<BuildStep, readonly string[]>>> = {
  7: ['lifestyle-missing'],
};

const FINISH: BuildStep = BUILD_STEPS.length as BuildStep;

/**
 * The nine steps' status, in order. Pass `issues` when `validate` has
 * already run for this build so it is not run twice.
 */
export function stepStatus(
  build: CharacterBuild,
  settings: ChargenSettings,
  issues: readonly Issue[] = validate(build, settings),
): StepStatus[] {
  return BUILD_STEPS.map((name, i) => {
    const step = (i + 1) as BuildStep;
    const here = issues.filter((issue) => issue.step === step);
    const required = STEP_REQUIRES[step] ?? [];
    const blocking =
      step === FINISH
        ? issues.filter((issue) => issue.severity === 'error')
        : here.filter((issue) => issue.severity === 'error' || required.includes(issue.code));
    const warnings = here.filter((issue) => issue.severity !== 'error' && !required.includes(issue.code));
    // Skipped only when there is truly nothing to do: an error still filed on a
    // mundane's Magic step (a spell an earlier kind left) needs the step shown.
    const skipped = name === 'magic' && build.magic.kind === 'mundane' && build.priorities.magic === 'E' && blocking.length === 0;
    return { step, name, complete: blocking.length === 0, skipped, blocking, warnings };
  });
}
