/**
 * Step 1 — Concept (FR3.9, docs/CHARGEN.md §4.4 Step 1).
 *
 * What kind of runner, and who. Three parts, under the frame's heading:
 *
 * - **Who the runner is** — alias, real name, age, sex. The alias is the one
 *   thing this step needs, and the field says so with the validator's own
 *   sentence while it is missing (`concept/IdentityFields.tsx`).
 * - **Describe your runner** — a sentence, and the Fixer drafts a whole build
 *   from this campaign's books, shown as "was → would be" before anything
 *   changes (`concept/DescribeRunner.tsx`, §8.5). It is there only when the
 *   campaign has turned drafts on and has a model, so it arrives as a slot
 *   (`describe`) the mounted step fills and `ConceptStepView` leaves empty:
 *   the box asks the server whether it works, and a step body that renders to
 *   static markup in a node test must not need a query client to do it.
 * - **Concept** — the engine's concept presets as cards, each saying what it
 *   fills in; picking one runs `applyConcept`, and "start from nothing" puts
 *   the spend back to an empty build's. A card that would change something
 *   the player did asks first, naming each change and saying who the runner
 *   is stays (`concept/ConceptCards.tsx`, decided by `concept/plan.ts`).
 * - **What this campaign builds** — the GM's creation level and priority
 *   table, shown in the numbers they move, never chosen here
 *   (`concept/CreationRules.tsx`).
 *
 * The walkthrough mode toggle is the shell's, and so are Next and Back. The
 * only state this screen keeps is which card is waiting on the player's
 * answer — never a copy of the build: every edit is a pure updater through
 * `update`, re-read from `build` on the next render. `ConceptStepView` takes
 * that one piece of state as props, so every state of the screen, the
 * question included, renders to static markup in a node test.
 */
import { useState, type ReactNode } from 'react';
import ConceptCards from './concept/ConceptCards.js';
import CreationRules from './concept/CreationRules.js';
import DescribeRunner from './concept/DescribeRunner.js';
import IdentityFields from './concept/IdentityFields.js';
import { matchCampaign } from './concept/campaign.js';
import { aliasIssue } from './concept/identity.js';
import { applyCard, pickCard } from './concept/plan.js';
import type { StepProps } from './types.js';

export interface ConceptStepViewProps extends StepProps {
  /** The card waiting on the player's answer. */
  pending: string | null;
  onPending: (id: string | null) => void;
  /**
   * The Fixer's "describe your runner" box, when the campaign has one. The
   * mounted step passes `<DescribeRunner>`; a test passes nothing, or its own
   * `DescribeRunnerView` in whichever state it is pinning.
   */
  describe?: ReactNode;
}

/** What the screen's controls do, as plain functions over the props — so a node test can press them. */
export interface ConceptHandlers {
  /** A card tapped, or the chosen card put back: applied at once, asked about first, or ignored. */
  pick(id: string): void;
  /** The question answered yes. */
  confirm(): void;
  /** The question answered no. */
  cancel(): void;
  /** Record the campaign's level and table on the build. */
  match(): void;
}

export function conceptHandlers(
  props: Pick<ConceptStepViewProps, 'build' | 'settings' | 'readOnly' | 'reviewMode' | 'update' | 'pending' | 'onPending'>,
): ConceptHandlers {
  const { build, settings, update, pending, onPending } = props;
  const editable = !props.readOnly && !props.reviewMode;
  return {
    pick(id) {
      const outcome = pickCard(build, id, settings, editable);
      if (outcome === 'apply') update((b) => applyCard(b, id, settings));
      else if (outcome === 'ask') onPending(id);
    },
    confirm() {
      if (pending !== null && editable) update((b) => applyCard(b, pending, settings));
      onPending(null);
    },
    cancel() {
      onPending(null);
    },
    match() {
      if (editable) update((b) => matchCampaign(b, settings));
    },
  };
}

export function ConceptStepView(props: ConceptStepViewProps) {
  const { build, settings, settingsFromCampaign, issues, update, pending } = props;
  const readOnly = props.readOnly || props.reviewMode;
  const on = conceptHandlers(props);

  return (
    <div className="space-y-6" data-testid="concept-step" data-editable={readOnly ? 'no' : 'yes'}>
      <IdentityFields identity={build.identity} aliasIssue={aliasIssue(issues)} readOnly={readOnly} onEdit={update} />
      {props.describe}
      <ConceptCards
        build={build}
        settings={settings}
        readOnly={readOnly}
        pending={pending}
        onPick={on.pick}
        onConfirm={on.confirm}
        onCancel={on.cancel}
      />
      <CreationRules
        build={build}
        settings={settings}
        settingsFromCampaign={settingsFromCampaign}
        issues={issues}
        readOnly={readOnly}
        onMatch={on.match}
      />
    </div>
  );
}

export default function ConceptStep(props: StepProps) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <ConceptStepView
      {...props}
      pending={pending}
      onPending={setPending}
      describe={
        <DescribeRunner
          buildId={props.buildId}
          build={props.build}
          settings={props.settings}
          readOnly={props.readOnly || props.reviewMode}
          update={props.update}
        />
      }
    />
  );
}
