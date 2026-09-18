/**
 * The GM's review of a submitted build (FR3.9, docs/CHARGEN.md §4.4 Step 9
 * "The GM opens the same page in review mode: the sheet, the build's choices
 * step by step, the issues list including the needs-GM items with
 * approve/deny per item, and two buttons — Approve … and Return with notes";
 * §8.5 the approvals, return and approve routes).
 *
 * The Finish step renders this in `reviewMode` — a GM on a submitted build,
 * which is read only. The decisions come first: with the sheet on top they
 * began about 3,000 px down a laptop screen and five screens down a phone,
 * so the order is the one a GM acts in, with what to read after:
 *
 * 1. **Needs your decision** — every approval item the build raises
 *    (`approvalItems`: the engine run without decisions), each with approve
 *    and deny as pressed-state buttons that write through
 *    `actions.setApprovals`, and the decision already on the row pressed —
 *    pressed again, it is taken back (`null`).
 * 2. **The server's check**, as the player's Finish shows it.
 * 3. **Return with notes** — a required note and the step it is pinned to
 *    (the first step with an error, by default), through
 *    `actions.returnWithNotes`.
 * 4. **Approve** — shut, with the sentence, while errors or undecided items
 *    remain (`approveGate`, the server's own rule); open, it asks once more
 *    what approving does, then runs `actions.approve` and offers the new
 *    character's sheet.
 * 5. **The runner in play** — the same sheet preview the player saw.
 * 6. **The build, step by step** — each step's mark as the player's checklist
 *    shows it and its key numbers, with a button to open that step (review
 *    mode is free, so every step is one tap away and read only).
 *
 * `ReviewView` takes every piece of state as props, so each face renders to
 * static markup in a node test; `ReviewScreen` is the thin live wrapper that
 * owns the note, the picked step and the confirmation.
 */
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalDecision, BuildStep } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import ActionError from '../finish/ActionError.js';
import ServerCheck from '../finish/ServerCheck.js';
import SheetPreview from '../finish/SheetPreview.js';
import { plural, sheetHref } from '../finish/checklist.js';
import { stepMeta } from '../meta.js';
import type { StepProps } from '../types.js';
import {
  NOTE_MAX,
  approvalItems,
  approveGate,
  decisionCounts,
  decisionWrite,
  defaultReturnStep,
  returnGate,
  returnStepOptions,
  stepFromOption,
  stepSummaries,
  type ApprovalItem,
  type ApproveGate,
  type ReturnGate,
  type StepSummary,
} from './review.js';

// ---------------------------------------------------------------------------
// The build, step by step
// ---------------------------------------------------------------------------

const MARKS: Readonly<Record<StepSummary['mark'], { glyph: string; spoken: string; tone: string }>> = {
  done: { glyph: '✓', spoken: 'complete', tone: 'text-ok' },
  todo: { glyph: '✕', spoken: 'not complete', tone: 'text-danger' },
  skipped: { glyph: '–', spoken: 'skipped', tone: 'text-faint' },
};

export function ChoicesSummary({ summaries, onGoTo, testId = 'review-choices' }: { summaries: readonly StepSummary[]; onGoTo: (step: BuildStep) => void; testId?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="panel p-3 sm:p-4" data-testid={testId}>
      <h2 id={headingId} className="text-base font-semibold text-ink">
        The build, step by step
      </h2>
      <ol className="mt-2 divide-y divide-edge/60">
        {summaries.map((s) => {
          const mark = MARKS[s.mark];
          return (
            <li key={s.step} className="flex items-start gap-2 py-2" data-summary={s.step} data-done={s.mark === 'todo' ? 'no' : 'yes'}>
              <span className={`mt-0.5 w-4 shrink-0 text-center font-label ${mark.tone}`} aria-hidden>
                {mark.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm text-ink">
                  <span className="mono-label mr-1.5 text-faint">{s.step}</span>
                  {s.title}
                  <span className="sr-only">, {mark.spoken}</span>
                  {s.blocking > 0 && <span className="ml-1.5 text-xs text-danger">{plural(s.blocking, 'thing', 'things')} to fix</span>}
                </h3>
                <ul className="mt-0.5 text-xs text-dim">
                  {s.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className="btn shrink-0 px-2.5 py-1"
                onClick={() => onGoTo(s.step)}
                aria-label={`open step ${s.step} · ${s.title}`}
                data-testid={`${testId}-open`}
              >
                open
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Needs your decision
// ---------------------------------------------------------------------------

export interface ApprovalListProps {
  items: readonly ApprovalItem[];
  busy: boolean;
  onDecide: (write: Record<string, ApprovalDecision | null>) => void;
  onGoTo: (step: BuildStep) => void;
  testId?: string;
}

const DECISIONS: ReadonlyArray<{ value: ApprovalDecision; label: string; on: string }> = [
  { value: 'approved', label: 'approve', on: 'border-ok text-ok' },
  { value: 'denied', label: 'deny', on: 'border-danger text-danger' },
];

export function ApprovalList({ items, busy, onDecide, onGoTo, testId = 'review-approvals' }: ApprovalListProps) {
  const headingId = useId();
  const { approved, denied, open } = decisionCounts(items);
  return (
    <section aria-labelledby={headingId} className="panel p-3 sm:p-4" data-testid={testId} aria-busy={busy}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Needs your decision
        </h2>
        {items.length > 0 && (
          <span className="mono-label text-dim" data-testid={`${testId}-count`}>
            {approved} approved · {denied} denied · {open} open
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-dim" data-testid={`${testId}-empty`}>
          Nothing in this build needs your approval.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-dim">
            The rules leave these to you. A denied item counts as something to fix, so a build with one goes back to the player. Press a decision again to take it back.
          </p>
          <ul className="mt-2 space-y-2">
            {items.map((item) => {
              const { issue, decision } = item;
              return (
                <li
                  key={issue.code}
                  className="rounded-md border border-edge bg-deck px-2.5 py-2"
                  data-approval={issue.code}
                  data-decision={decision ?? 'open'}
                >
                  <p className="text-sm text-ink">{issue.message}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="chip text-dim hover:text-cyan pointer-coarse:min-h-10"
                      onClick={() => onGoTo(issue.step)}
                      aria-label={`step ${issue.step} — go to ${stepMeta(issue.step).title}`}
                    >
                      step {issue.step}
                    </button>
                    <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
                    <span className="sr-only">{decision === null ? 'Not decided yet.' : `You ${decision} this.`}</span>
                    <div className="ml-auto flex gap-1.5" role="group" aria-label={`Your decision: ${issue.message}`}>
                      {DECISIONS.map((d) => {
                        const pressed = decision === d.value;
                        return (
                          <button
                            key={d.value}
                            type="button"
                            className={`btn px-3 py-1 ${pressed ? d.on : ''} ${busy ? 'cursor-wait opacity-60' : ''}`}
                            aria-pressed={pressed}
                            {...(busy ? { 'aria-disabled': 'true' as const } : {})}
                            onClick={() => {
                              if (busy) return;
                              const write = decisionWrite(item, d.value);
                              onDecide(write);
                            }}
                            data-testid={`${testId}-${d.value}`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Return with notes
// ---------------------------------------------------------------------------

export interface ReturnFormViewProps {
  notes: string;
  /** The picker's value: '' for no step, else the step number. */
  step: string;
  gate: ReturnGate;
  /** Whether the user has tried to send an empty note (the reason shows then, not before). */
  tried: boolean;
  onNotes: (notes: string) => void;
  onStep: (value: string) => void;
  onSubmit: () => void;
  testId?: string;
}

export function ReturnFormView({ notes, step, gate, tried, onNotes, onStep, onSubmit, testId = 'review-return' }: ReturnFormViewProps) {
  const headingId = useId();
  const notesId = useId();
  const stepId = useId();
  const reasonId = useId();
  const showReason = gate.reason !== null && (tried || notes.trim() !== '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <section aria-labelledby={headingId} className="panel p-3 sm:p-4" data-testid={testId}>
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Return with notes
      </h2>
      <p className="mt-1 text-sm text-dim">The build reopens for the player with your note pinned to the step you pick.</p>
      <form className="mt-2 space-y-2" onSubmit={submit} noValidate>
        <div>
          <label htmlFor={notesId} className="mono-label text-dim">
            Note for the player
          </label>
          <textarea
            id={notesId}
            className="mt-1 block min-h-24 w-full rounded-md border border-edge-bright bg-ground px-3 py-2 text-sm text-ink"
            value={notes}
            maxLength={NOTE_MAX}
            rows={4}
            onChange={(e) => onNotes(e.target.value)}
            {...(showReason ? { 'aria-describedby': reasonId, 'aria-invalid': true } : {})}
            data-testid={`${testId}-notes`}
          />
        </div>
        <div>
          <label htmlFor={stepId} className="mono-label text-dim">
            Pin it to
          </label>
          <select
            id={stepId}
            className="mt-1 block w-full rounded-md border border-edge-bright bg-ground px-2 py-2 text-sm text-ink sm:w-auto"
            value={step}
            onChange={(e) => onStep(e.target.value)}
            data-testid={`${testId}-step`}
          >
            {returnStepOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className={`btn px-4 py-1.5 ${gate.open ? '' : 'opacity-60'}`}
            {...(gate.open ? {} : { 'aria-disabled': 'true' as const })}
            {...(gate.reason ? { 'aria-describedby': reasonId } : {})}
            data-testid={`${testId}-send`}
          >
            return with notes
          </button>
          {gate.reason && (
            <p id={reasonId} className={`text-sm ${showReason ? 'text-warn' : 'sr-only'}`} data-testid={`${testId}-reason`}>
              {gate.reason}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export interface ApprovePanelViewProps {
  campaignId: string;
  gate: ApproveGate;
  confirming: boolean;
  busy: boolean;
  /** The character approval created, once known. */
  characterId: string | null;
  approved: boolean;
  onPress: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export function ApprovePanelView({
  campaignId,
  gate,
  confirming,
  busy,
  characterId,
  approved,
  onPress,
  onConfirm,
  onCancel,
  testId = 'review-approve',
}: ApprovePanelViewProps) {
  const headingId = useId();
  const reasonId = useId();
  const confirmId = useId();

  if (approved) {
    return (
      <section aria-labelledby={headingId} className="panel space-y-2 border-ok/40 p-3 sm:p-4" data-testid={testId} data-state="approved">
        <h2 id={headingId} className="text-base font-semibold text-ok">
          Approved
        </h2>
        <p className="text-sm text-dim" role="status">
          The runner is in play, with its first revision, its carried Karma and its starting nuyen rolled on the record.
        </p>
        {characterId ? (
          <Link to={sheetHref(campaignId, characterId)} className="btn btn-accent inline-flex px-3 py-1.5" data-testid={`${testId}-sheet`}>
            open the character sheet
          </Link>
        ) : (
          <p className="text-sm text-dim">The new sheet is on the party roster.</p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="panel space-y-2 p-3 sm:p-4" data-testid={testId} data-open={gate.open ? 'yes' : 'no'}>
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Approve
      </h2>
      <p className="text-sm text-dim">
        Approving creates the character: its sheet, its contacts and bonded magic, the Karma it carries, and a starting-nuyen roll made on
        the record. The build cannot change after that.
      </p>
      {confirming && gate.open ? (
        <div role="group" aria-labelledby={confirmId} className="rounded-md border border-cyan-dim/60 bg-deck p-3" data-testid={`${testId}-confirm`}>
          <p id={confirmId} className="text-sm text-ink">
            Approve this build and create the character now?
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn px-3 py-1.5" onClick={onCancel} data-testid={`${testId}-cancel`}>
              not yet
            </button>
            <button type="button" className="btn btn-accent px-3 py-1.5" onClick={onConfirm} data-testid={`${testId}-go`}>
              approve now
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`btn px-4 py-1.5 ${gate.open ? 'btn-accent' : 'cursor-not-allowed opacity-60'}`}
            onClick={() => {
              if (gate.open) onPress();
            }}
            {...(gate.open ? {} : { 'aria-disabled': 'true' as const })}
            {...(gate.reason ? { 'aria-describedby': reasonId } : {})}
            aria-busy={busy}
            data-testid={`${testId}-button`}
          >
            {busy ? 'approving…' : 'approve'}
          </button>
          {gate.reason && (
            <p id={reasonId} className={`text-sm ${gate.errors + gate.undecided > 0 ? 'text-warn' : 'text-dim'}`} data-testid={`${testId}-reason`}>
              {gate.reason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export interface ReviewState {
  notes: string;
  returnStep: string;
  triedReturn: boolean;
  confirming: boolean;
}

export interface ReviewHandlers {
  onNotes: (notes: string) => void;
  onReturnStep: (value: string) => void;
  onReturn: () => void;
  onDecide: (write: Record<string, ApprovalDecision | null>) => void;
  onApprovePress: () => void;
  onApproveConfirm: () => void;
  onApproveCancel: () => void;
  onPrint?: () => void;
}

export type ReviewViewProps = StepProps &
  ReviewState &
  ReviewHandlers & {
    items: readonly ApprovalItem[];
    characterId: string | null;
  };

export function ReviewView(props: ReviewViewProps) {
  const { build, budgets, steps, allIssues, preview, actions, goTo, items, campaignId } = props;
  const summaries = stepSummaries({ build, budgets, steps, allIssues, opening: preview.compiled?.opening ?? null });
  const approve = approveGate({ allIssues, items, busy: actions.busy });
  const ret = returnGate({ notes: props.notes, busy: actions.busy });
  const approved = build.state === 'approved' || props.characterId !== null;

  return (
    <div className="space-y-4" data-testid="finish-review">
      <ApprovalList items={items} busy={actions.busy === 'approvals'} onDecide={props.onDecide} onGoTo={goTo} />
      <ServerCheck check={actions.check} local={allIssues} onGoTo={goTo} audience="review" />
      <ActionError error={actions.error} issues={actions.refusalIssues} onGoTo={goTo} testId="review-error" />
      {!approved && (
        <ReturnFormView
          notes={props.notes}
          step={props.returnStep}
          gate={ret}
          tried={props.triedReturn}
          onNotes={props.onNotes}
          onStep={props.onReturnStep}
          onSubmit={props.onReturn}
        />
      )}
      <ApprovePanelView
        campaignId={campaignId}
        gate={approve}
        confirming={props.confirming}
        busy={actions.busy === 'approve'}
        characterId={props.characterId}
        approved={approved}
        onPress={props.onApprovePress}
        onConfirm={props.onApproveConfirm}
        onCancel={props.onApproveCancel}
      />
      <SheetPreview preview={preview} build={build} background="always" {...(props.onPrint ? { onPrint: props.onPrint } : {})} />
      <ChoicesSummary summaries={summaries} onGoTo={goTo} />
    </div>
  );
}

export interface ReviewScreenProps extends StepProps {
  /** The character approval created, when this page knows it. */
  characterId: string | null;
  /** Called with the new character's id (or null when the server did not name it). */
  onApproved: (characterId: string | null) => void;
  onPrint?: () => void;
}

/** The live review: the note, the picked step and the confirmation are this screen's; the rest is props. */
export default function ReviewScreen(props: ReviewScreenProps) {
  const { build, settings, allIssues, actions, onApproved, ...rest } = props;
  const items = useMemo(() => approvalItems(build, settings), [build, settings]);
  const [notes, setNotes] = useState('');
  const [returnStep, setReturnStep] = useState(() => {
    const step = defaultReturnStep(allIssues);
    return step === null ? '' : String(step);
  });
  const [triedReturn, setTriedReturn] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const onReturn = () => {
    setTriedReturn(true);
    if (!returnGate({ notes, busy: actions.busy }).open) return;
    actions.returnWithNotes(notes.trim(), stepFromOption(returnStep)).catch(() => undefined);
  };
  const onApproveConfirm = () => {
    setConfirming(false);
    if (!approveGate({ allIssues, items, busy: actions.busy }).open) return;
    actions.approve().then(onApproved, () => undefined);
  };

  return (
    <ReviewView
      {...rest}
      build={build}
      settings={settings}
      allIssues={allIssues}
      actions={actions}
      items={items}
      notes={notes}
      returnStep={returnStep}
      triedReturn={triedReturn}
      confirming={confirming}
      onNotes={setNotes}
      onReturnStep={setReturnStep}
      onReturn={onReturn}
      onDecide={(write) => {
        actions.setApprovals(write).catch(() => undefined);
      }}
      onApprovePress={() => setConfirming(true)}
      onApproveConfirm={onApproveConfirm}
      onApproveCancel={() => setConfirming(false)}
    />
  );
}
