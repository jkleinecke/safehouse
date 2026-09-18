/**
 * The step registry: walkthrough step number → its lazy screen (FR3.9,
 * docs/CHARGEN.md §4.4, §8.6 "Steps: steps/Concept … Finish").
 *
 * The shell renders `STEP_SCREENS[step]` inside a Suspense boundary and hands
 * it `StepProps` (`./types.ts`, which documents the rules a step follows).
 * Each screen is its own chunk, so the builder's first paint pays for the
 * shell and the step on screen, not for the gear catalogue on step 7.
 *
 * To write a step: replace the body of its file (`Concept.tsx` …
 * `Finish.tsx`), keep the default export, read everything from props, edit
 * only through `update(fn)`, and build the body from the step kit
 * (`../kit/index.ts`). Nothing here changes. The copy around a step — title,
 * intro, "why?" page — is `STEP_META` in `./meta.ts`.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { BuildStep } from '@safehouse/contracts';
import type { StepProps } from './types.js';

export { STEP_META, stepMeta, stepMetaFor, type StepMeta } from './meta.js';
export { inertActions, type BuildActions, type StepProps } from './types.js';
export { nextConfirmFor, type NextConfirm } from './confirm.js';

export type StepScreen = LazyExoticComponent<ComponentType<StepProps>>;

/** The nine step numbers as a type (`BuildStep` itself is a plain number). */
export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const STEP_SCREENS: Readonly<Record<StepNumber, StepScreen>> = {
  1: lazy(() => import('./Concept.js')),
  2: lazy(() => import('./Priorities.js')),
  3: lazy(() => import('./Metatype.js')),
  4: lazy(() => import('./Magic.js')),
  5: lazy(() => import('./Qualities.js')),
  6: lazy(() => import('./Skills.js')),
  7: lazy(() => import('./Gear.js')),
  8: lazy(() => import('./Karma.js')),
  9: lazy(() => import('./Finish.js')),
};

/** The screen for a step number; step 1's for anything out of range. */
export function stepScreen(step: BuildStep): StepScreen {
  return (STEP_SCREENS as Readonly<Record<number, StepScreen | undefined>>)[step] ?? STEP_SCREENS[1];
}
