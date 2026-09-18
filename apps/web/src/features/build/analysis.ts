/**
 * Everything the rail, the strip and the steps show about a build, computed
 * in the browser from the rules engine (FR3.9, docs/CHARGEN.md §8.6 "runs
 * budgets / validate / compile locally on every change for an instant rail").
 *
 * One function, `analyseBuild(build, settings)`, runs the engine's pure
 * functions in the order they depend on each other — `validate` once, its
 * issues handed to `stepStatus` so it is not run twice — and compiles the
 * build into a sheet and derives it, so the rail's initiative, limits and
 * monitors are the numbers play will use, not a second approximation.
 *
 * A full recompute over a concept-sized build measured under a millisecond
 * in node (budgets + validate + stepStatus + compile + derive), so the
 * memoisation here is not about speed per call: it is about *identity*. The
 * build session hands out the same record object until something changes,
 * and `createAnalyser` answers the same analysis object for it, so a
 * re-render that changed nothing gives every memoised child the same props.
 *
 * Compile or derive can throw on a record half-way through being made (an
 * unknown metatype id, a hand-typed purchase). That must never take the page
 * down: the preview carries the error instead, and budgets and issues — which
 * the validator is written to answer for any record — still render.
 *
 * Two answers exist for the step screens' refusing controls, so no step
 * hand-codes a creation rule:
 *
 * - `ratings` — every attribute's base, points, natural and table maximum,
 *   and every skill's grant, group and creation rating, from the engine's
 *   `ratings()`;
 * - `probe(fn)` — "what would this change break": the validator run over
 *   `fn(build)`, with the errors it would *introduce* separated out, so a
 *   stepper's `refuseIncrease` is the engine's own sentence and page ("only
 *   one attribute may start at its natural maximum") rather than a second
 *   copy of the rule. The warnings a change would bring in come back apart
 *   (`warned`), so a screen can say a loss before the tap without refusing
 *   it. A probe costs one `validate` (measured in node at a few hundredths of
 *   a millisecond on a concept build, 0.03–0.08 ms); a screen that probes many
 *   controls per render passes a `key`, and the answer is kept for as long as
 *   the draft is unchanged.
 */
import type { Budgets, CharacterBuild, ChargenSettings, DerivedCharacter, Issue } from '@safehouse/contracts';
import {
  budgets as engineBudgets,
  compileBuild,
  deriveCharacter,
  eligibilityContext,
  ratings as engineRatings,
  stepStatus,
  validate,
  type BuildRatings,
  type CompiledBuild,
  type EligibilityContext,
  type StepStatus,
} from '@safehouse/rules';

/** The build compiled and derived, as play would see it — or why it could not be. */
export interface BuildPreview {
  compiled: CompiledBuild | null;
  derived: DerivedCharacter | null;
  error: string | null;
}

/** What a candidate change would leave blocking, and which of those it would bring in. */
export interface BuildProbe {
  /** Every error the changed record would have. */
  blocking: Issue[];
  /** The errors the change introduces (not on the record as it stands). */
  introduced: Issue[];
  /**
   * The warnings the change introduces — nothing refuses on these (a Magic
   * row a mundane would pay for), but a screen can say them before the tap.
   */
  warned: Issue[];
}

export type BuildProber = (fn: (build: CharacterBuild) => CharacterBuild, key?: string) => BuildProbe;

export interface BuildAnalysis {
  budgets: Budgets;
  issues: Issue[];
  steps: StepStatus[];
  eligibility: EligibilityContext;
  /** Every rating the build produces, with its maxima (the engine's `ratings`). */
  ratings: BuildRatings;
  preview: BuildPreview;
  /** Validate a candidate change against this build (see the file header). */
  probe: BuildProber;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const issueKey = (i: Issue): string => `${i.code}|${i.step}|${i.path ?? ''}`;

/**
 * A prober for one build: `fn(build)` validated, its errors diffed against
 * the build's own by code, step and path. Keyed answers are cached for the
 * life of the prober, which is the life of the analysis, which is the life of
 * the draft object.
 */
export function createProber(build: CharacterBuild, settings: ChargenSettings, issues: readonly Issue[]): BuildProber {
  const current = new Set(issues.filter((i) => i.severity === 'error').map(issueKey));
  const warnings = new Set(issues.filter((i) => i.severity === 'warning').map(issueKey));
  const cache = new Map<string, BuildProbe>();
  return (fn, key) => {
    if (key !== undefined) {
      const hit = cache.get(key);
      if (hit) return hit;
    }
    const candidate = fn(build);
    const all = candidate === build ? issues : validate(candidate, settings);
    const blocking = all.filter((i) => i.severity === 'error');
    const answer: BuildProbe = {
      blocking,
      introduced: blocking.filter((i) => !current.has(issueKey(i))),
      warned: all.filter((i) => i.severity === 'warning' && !warnings.has(issueKey(i))),
    };
    if (key !== undefined) cache.set(key, answer);
    return answer;
  };
}

/** Run the engine over one build. Pure; see the file header for what throws and what does not. */
export function analyseBuild(build: CharacterBuild, settings: ChargenSettings): BuildAnalysis {
  const issues = validate(build, settings);
  const steps = stepStatus(build, settings, issues);
  const budgets = engineBudgets(build, settings);
  const eligibility = eligibilityContext(build, settings);
  const ratings = engineRatings(build, settings);
  let preview: BuildPreview;
  try {
    const compiled = compileBuild(build, settings);
    try {
      preview = { compiled, derived: deriveCharacter(compiled.sheet), error: null };
    } catch (err) {
      preview = { compiled, derived: null, error: message(err) };
    }
  } catch (err) {
    preview = { compiled: null, derived: null, error: message(err) };
  }
  return { budgets, issues, steps, eligibility, ratings, preview, probe: createProber(build, settings, issues) };
}

/**
 * A memoised `analyseBuild`: the same `build` and `settings` objects answer
 * the same analysis object. One cache slot — the walkthrough only ever asks
 * about the draft it is showing.
 */
export function createAnalyser(run: typeof analyseBuild = analyseBuild) {
  let lastBuild: CharacterBuild | null = null;
  let lastSettings: ChargenSettings | null = null;
  let last: BuildAnalysis | null = null;
  return (build: CharacterBuild, settings: ChargenSettings): BuildAnalysis => {
    if (last && build === lastBuild && settings === lastSettings) return last;
    lastBuild = build;
    lastSettings = settings;
    last = run(build, settings);
    return last;
  };
}
