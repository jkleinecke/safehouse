/**
 * Step 6 — Skills (FR3.9, docs/CHARGEN.md §4.4 Step 6).
 *
 * The walkthrough shell lazy-loads this screen through `steps/index.ts` and
 * hands it `StepProps` (`types.ts` holds the rules a step follows). The body
 * is `skills/SkillsView.tsx`: groups first, then the active skills under
 * their attributes, then knowledge and languages, every number and refusal
 * the engine's. This wrapper owns the only state the screen keeps for itself
 * — the search text and "show only mine", which are how a phone reaches one
 * skill out of seventy-five — and nothing of the build: every edit goes
 * through `update`.
 *
 * A read-only view (a submitted build, the GM's review) opens with "show only
 * mine" on, because someone reading a finished runner wants its skills, not
 * the list it was chosen from; the toggle still shows the rest. So does a
 * phone once the build holds skills (a concept card filled them): the whole
 * list there ran to a dozen screens past skills the player never wanted.
 */
import { useState } from 'react';
import SkillsView from './skills/SkillsView.js';
import type { SkillFilter } from './skills/model.js';
import type { StepProps } from './types.js';

/** Where the filter starts: everything for a builder; only the runner's own for a reader, or on a phone once skills are bought. */
export function initialSkillFilter(
  props: Pick<StepProps, 'readOnly' | 'reviewMode'> & { build?: Pick<StepProps['build'], 'skills'> },
  narrow = false,
): SkillFilter {
  const holds = !!props.build && (props.build.skills.active.some((s) => s.points > 0) || props.build.skills.groups.some((g) => g.points > 0));
  return { query: '', onlyMine: props.readOnly || props.reviewMode || (narrow && holds) };
}

/** A phone-width screen (below Tailwind's `sm`), read once as the step opens. */
function narrowScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 39.99rem)').matches;
}

export default function SkillsStep(props: StepProps) {
  const [filter, setFilter] = useState<SkillFilter>(() => initialSkillFilter(props, narrowScreen()));
  return <SkillsView {...props} filter={filter} onFilter={setFilter} />;
}
