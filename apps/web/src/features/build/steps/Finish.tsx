/**
 * Step 9 — Finish, and the GM's review (FR3.9, docs/CHARGEN.md §4.4 Step 9,
 * §8.5, §8.6).
 *
 * The last screen has four faces, chosen by `finishPhase` from the build's
 * state and whether the GM is reviewing it:
 *
 * - **edit** — a draft, or a build the GM returned. The creation checklist
 *   (the book's p. 101 list as the engine's step statuses: a tick, or a
 *   cross with the engine's sentences and a button to the step that fixes
 *   it); the background box, autosaved like every other edit; the server's
 *   own check beside this page's; Submit, for the build's owner only
 *   (`isOwner` — the server refuses anyone else), shut with a count while any
 *   error remains; and the runner as play will see it. A returned build's
 *   note is the frame's banner, shown in full on this step whichever step it
 *   names — once, never a second copy here.
 * - **submitted** — frozen while the GM looks: what that means and what
 *   happens next, and the sheet.
 * - **review** — the GM on a submitted build (`review/ReviewScreen.tsx`).
 * - **approved** — history: a way to the character it became, and the sheet.
 *
 * Every face that shows the sheet mounts the print stylesheet (`finish/
 * print.ts`), so the browser's Print on this screen gives a clean one-page
 * runner rather than the dark shell around it.
 *
 * `FinishView` takes everything as props and renders to static markup in a
 * node test. `FinishStep`, the default export the shell lazy-loads, adds the
 * one thing that outlives a face: the character id approval answered with,
 * so the review turns into the approved face on the same screen. A build
 * opened already approved names its character through `StepProps`
 * (`characterId`, the row's).
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionError from './finish/ActionError.js';
import BackgroundBox from './finish/BackgroundBox.js';
import ChecklistPanel from './finish/ChecklistPanel.js';
import ServerCheck from './finish/ServerCheck.js';
import SheetPreview from './finish/SheetPreview.js';
import SubmitPanel from './finish/SubmitPanel.js';
import { checklistLines, finishPhase, sheetHref, submitGate } from './finish/checklist.js';
import { FINISH_PRINT_CSS } from './finish/print.js';
import ReviewScreen from './review/ReviewScreen.js';
import type { StepProps } from './types.js';

export interface FinishViewProps extends StepProps {
  /** The review reports the character approval created. */
  onApproved: (characterId: string | null) => void;
  /** The print button (the live screen passes `window.print`). */
  onPrint?: () => void;
}

/** The print rules for this screen, mounted only while it is. */
export function FinishPrintStyle() {
  return <style data-testid="finish-print-style" dangerouslySetInnerHTML={{ __html: FINISH_PRINT_CSS }} />;
}

function EditFace(props: FinishViewProps) {
  const { build, steps, allIssues, actions, goTo, update, readOnly, reviewMode, preview, role, isOwner } = props;
  const lines = checklistLines(build, steps, allIssues);
  const gate = submitGate({ state: build.state, readOnly, reviewMode, isOwner, allIssues, busy: actions.busy });
  return (
    <div className="space-y-4" data-testid="finish-edit" data-state={build.state}>
      <ChecklistPanel lines={lines} onGoTo={goTo} />
      <BackgroundBox build={build} update={update} readOnly={readOnly} />
      <ServerCheck check={actions.check} local={allIssues} onGoTo={goTo} />
      {gate.show ? (
        <SubmitPanel gate={gate} actions={actions} allIssues={allIssues} onGoTo={goTo} />
      ) : (
        <p className="text-sm text-dim" data-testid="finish-submit-note">
          {role === 'gm'
            ? 'The player sends this build when it is ready; it opens for your review then.'
            : 'Only the runner’s player can send this build to the GM.'}
        </p>
      )}
      <SheetPreview preview={preview} build={build} background="print" {...(props.onPrint ? { onPrint: props.onPrint } : {})} />
    </div>
  );
}

function SubmittedFace(props: FinishViewProps) {
  const { build, allIssues, preview, actions, goTo } = props;
  const gm = allIssues.filter((i) => i.severity === 'approval').length;
  const titleId = useId();
  return (
    <div className="space-y-4" data-testid="finish-submitted">
      <section aria-labelledby={titleId} className="panel space-y-2 border-cyan-dim/60 p-3 sm:p-4">
        <h2 id={titleId} className="text-base font-semibold text-cyan">
          Waiting for the GM
        </h2>
        <p className="text-sm text-ink">
          This build is frozen while the GM looks at it. Nothing in it can change until they approve it or send it back.
        </p>
        <h3 className="mono-label text-dim">What happens next</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-dim">
          <li>Approved: the runner joins the campaign with its sheet, the Karma it carries and a starting-nuyen roll made on the record.</li>
          <li>Returned: the build opens again with the GM&apos;s note pinned to the step it is about.</li>
        </ul>
        {gm > 0 && (
          <p className="text-sm text-dim" data-testid="finish-submitted-gm">
            {gm === 1 ? '1 item waits' : `${gm} items wait`} on the GM&apos;s decision.
          </p>
        )}
      </section>
      <ActionError error={actions.error} issues={actions.refusalIssues} onGoTo={goTo} />
      <SheetPreview preview={preview} build={build} background="always" {...(props.onPrint ? { onPrint: props.onPrint } : {})} />
    </div>
  );
}

function ApprovedFace(props: FinishViewProps) {
  const { build, preview, campaignId, characterId } = props;
  const titleId = useId();
  return (
    <div className="space-y-4" data-testid="finish-approved">
      <section aria-labelledby={titleId} className="panel space-y-2 border-ok/40 p-3 sm:p-4">
        <h2 id={titleId} className="text-base font-semibold text-ok">
          Approved
        </h2>
        <p className="text-sm text-ink">
          The GM approved this build and the runner is in play. From here it grows through advancement on its sheet; the build stays as the
          record of how it was made.
        </p>
        {characterId ? (
          <Link to={sheetHref(campaignId, characterId)} className="btn btn-accent inline-flex px-3 py-1.5" data-testid="finish-character-link">
            open the character sheet
          </Link>
        ) : (
          <p className="text-sm text-dim">The sheet is on the party roster.</p>
        )}
      </section>
      <SheetPreview preview={preview} build={build} background="always" {...(props.onPrint ? { onPrint: props.onPrint } : {})} />
    </div>
  );
}

export function FinishView(props: FinishViewProps) {
  const phase = finishPhase(props.build.state, props.reviewMode);
  return (
    <div data-testid="finish-step" data-phase={phase}>
      <FinishPrintStyle />
      {phase === 'review' ? (
        <ReviewScreen {...props} />
      ) : phase === 'submitted' ? (
        <SubmittedFace {...props} />
      ) : phase === 'approved' ? (
        <ApprovedFace {...props} />
      ) : (
        <EditFace {...props} />
      )}
    </div>
  );
}

function printPage() {
  if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
}

export default function FinishStep(props: StepProps) {
  const [approvedId, setApprovedId] = useState<string | null>(null);
  return <FinishView {...props} characterId={approvedId ?? props.characterId} onApproved={setApprovedId} onPrint={printPage} />;
}
