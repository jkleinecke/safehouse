/**
 * The frame every step screen sits in (FR3.9, docs/CHARGEN.md §4.4).
 *
 * Two rules hold the walkthrough together and both live here, so no step
 * can forget them:
 *
 * - **Next only opens when the step is complete, and the screen says exactly
 *   what is missing.** In guided mode Next is shut while the engine's
 *   `stepStatus` has anything blocking this step, and the first blocking
 *   issue's sentence sits under the button, tied to it with
 *   `aria-describedby`, with a "why?" chip to the page. The button stays
 *   focusable (`aria-disabled`), so a keyboard or screen-reader user finds
 *   the reason by reaching the button rather than by guessing.
 * - **Back always works.**
 * - **A loss is acknowledged, once.** When the step has a warning the book
 *   makes final (unspent special points, nuyen above the carry-over — the
 *   registry is `steps/confirm.ts`), an open Next first shows the engine's
 *   sentence with "I meant to — next" and "stay here"; only the first goes on.
 *
 * Focus follows the step. When the step changes the heading takes focus (it
 * is `tabIndex=-1`, so it is reachable by script, not by Tab), so a keyboard
 * or screen-reader user pressing Next hears the new step's title instead of
 * being left on a button at the bottom of a page that changed above them. Back
 * stays mounted on the first step — shut with `aria-disabled` rather than
 * removed — so pressing Back on step 2 never drops focus to the document.
 * Next is not drawn on the last step at all: a greyed "next" with no reason
 * under Finish's Submit only said there was somewhere else to go.
 *
 * In free mode nothing is gated but Submit (§4.4): Next is always open, and
 * what is still unfinished is said beside it as a note, not a lock.
 *
 * Above the body sit the step's own words (§4.4: two sentences on what it is
 * for, one on what the rules let you do, and a "why?" link), a line when the
 * engine skipped the step (a mundane's Magic step), and any banner the page
 * pins here (the GM's note).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BuildMode } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';
import { gatingReason, type StepGate } from '../lib.js';
import type { NextConfirm } from '../steps/confirm.js';
import type { StepMeta } from '../steps/meta.js';

export interface StepFrameProps {
  meta: StepMeta;
  status: StepGate;
  mode: BuildMode;
  /** Where Back goes; null on the first step. */
  onBack: (() => void) | null;
  /** Where Next goes; null on the last step (Finish owns Submit). */
  onNext: (() => void) | null;
  readOnly?: boolean;
  /**
   * The intro slot: replaces the step's two stock sentences when a screen has
   * something more specific to open with. The "what the rules let you do"
   * line and its why-link stay.
   */
  intro?: ReactNode;
  /** Pinned above the body (the GM's note). */
  banner?: ReactNode;
  /** The panel id the free-mode tabs control. */
  panelId?: string;
  /** A loss to acknowledge before Next goes (`nextConfirmFor`); null when Next simply goes. */
  nextConfirm?: NextConfirm | null;
  children: ReactNode;
}

/** What pressing Next does: go, ask first, or nothing (shut, or no step after this one). */
export function nextPress(
  nextOpen: boolean,
  hasNext: boolean,
  confirm: NextConfirm | null,
  confirming: boolean,
): 'go' | 'confirm' | 'none' {
  if (!nextOpen || !hasNext) return 'none';
  return confirm && !confirming ? 'confirm' : 'go';
}

export interface NextConfirmPanelProps {
  confirm: NextConfirm;
  onConfirm: () => void;
  onStay: () => void;
}

/** The acknowledgement under Next: our lead-in, the engine's sentence and page, go on or stay. */
export function NextConfirmPanel({ confirm, onConfirm, onStay }: NextConfirmPanelProps) {
  const titleId = useId();
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    goRef.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="w-full max-w-sm rounded-md border border-warn/50 bg-deck p-3 text-left"
      data-testid="step-next-confirm"
    >
      <p id={titleId} className="text-sm text-ink">
        {confirm.lead}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-warn">
        <span>{confirm.message}</span>
        {confirm.ref && <RefChip refValue={confirm.ref} />}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn px-3 py-1.5" onClick={onStay} data-testid="step-next-stay">
          stay here
        </button>
        <button ref={goRef} type="button" className="btn btn-accent px-3 py-1.5" onClick={onConfirm} data-testid="step-next-go">
          {confirm.confirmLabel}
        </button>
      </div>
    </div>
  );
}

export default function StepFrame({
  meta,
  status,
  mode,
  onBack,
  onNext,
  readOnly = false,
  intro,
  banner,
  panelId,
  nextConfirm = null,
  children,
}: StepFrameProps) {
  const reasonId = useId();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const guided = mode === 'guided';
  const reason = gatingReason(status);
  // Read-only viewers are looking, not building: nothing to gate for them.
  const nextOpen = !guided || readOnly || status.complete;
  const hasNext = onNext !== null;
  const firstBlocking = status.blocking[0];
  const confirm = readOnly ? null : nextConfirm;
  const [confirmingStep, setConfirmingStep] = useState<number | null>(null);
  const confirming = confirmingStep === meta.step && confirm !== null;

  // Focus the new step's heading when the step changes — not on first paint,
  // where focus belongs to wherever the player came from.
  const shownStep = useRef(meta.step);
  useEffect(() => {
    if (shownStep.current === meta.step) return;
    shownStep.current = meta.step;
    headingRef.current?.focus({ preventScroll: true });
  }, [meta.step]);

  const go = () => {
    setConfirmingStep(null);
    onNext?.();
  };
  const pressNext = () => {
    const action = nextPress(nextOpen, hasNext, confirm, confirming);
    if (action === 'confirm') setConfirmingStep(meta.step);
    else if (action === 'go') go();
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="step-frame"
      data-step={meta.step}
      data-mode={mode}
      {...(panelId ? { id: panelId } : {})}
      {...(mode === 'free' && panelId ? { role: 'tabpanel' } : {})}
      className="space-y-4"
    >
      <header>
        <div className="mono-label text-faint">
          Step {meta.step} of 9{readOnly ? ' · read only' : ''}
        </div>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold text-ink outline-none">
          {meta.title}
        </h1>
        <div className="mt-1.5 max-w-prose text-sm text-dim" data-testid="step-intro">
          {intro ?? meta.intro}
        </div>
        <p className="mt-1 flex max-w-prose flex-wrap items-center gap-1.5 text-sm text-dim">
          <span>{meta.allows}</span>
          <span className="inline-flex items-center gap-1" data-testid="step-why">
            <span className="mono-label text-faint">why?</span>
            <RefChip refValue={meta.ref} />
          </span>
        </p>
      </header>

      {banner}

      {status.skipped && (
        <p className="rounded-md border border-edge bg-deck px-3 py-2 text-sm text-dim" data-testid="step-skipped">
          <span aria-hidden>– </span>
          Nothing to choose here for this runner; the walkthrough skips this step.
        </p>
      )}

      <div data-testid="step-body">{children}</div>

      <footer className="flex flex-wrap items-start gap-3 border-t border-edge pt-3" data-testid="step-nav">
        <button
          type="button"
          className={`btn px-3 py-1.5 ${onBack ? '' : 'cursor-not-allowed opacity-40'}`}
          onClick={() => onBack?.()}
          data-testid="step-back"
          data-open={onBack ? 'yes' : 'no'}
          {...(onBack ? {} : { 'aria-disabled': 'true' as const, title: 'This is the first step' })}
        >
          ← back
        </button>
        <div className="ml-auto flex min-w-0 flex-col items-end gap-1.5">
          {hasNext && (
            <button
              type="button"
              className={`btn px-4 py-1.5 ${nextOpen ? 'btn-accent' : 'cursor-not-allowed opacity-60'}`}
              data-testid="step-next"
              data-open={nextOpen ? 'yes' : 'no'}
              {...(nextOpen ? {} : { 'aria-disabled': 'true' as const })}
              {...(reason && !readOnly ? { 'aria-describedby': reasonId } : {})}
              {...(confirming ? { 'aria-expanded': true } : {})}
              onClick={pressNext}
            >
              next →
            </button>
          )}
          {reason && !readOnly && (hasNext || !guided) && (
            <p
              id={reasonId}
              className={`flex max-w-sm flex-wrap items-center justify-end gap-1.5 text-right text-xs ${
                guided ? 'text-warn' : 'text-faint'
              }`}
              data-testid="step-gate-reason"
              data-gated={guided ? 'yes' : 'no'}
            >
              <span>
                {guided ? 'Next opens when this is done: ' : 'Still open on this step: '}
                {reason}
              </span>
              {firstBlocking && <RefChip refValue={firstBlocking.ref} />}
            </p>
          )}
        </div>
        {confirming && confirm && (
          // Full width under the whole nav row: on a phone, inside Next's column it split Back and Next onto two lines.
          <div className="flex w-full justify-end">
            <NextConfirmPanel confirm={confirm} onConfirm={go} onStay={() => setConfirmingStep(null)} />
          </div>
        )}
      </footer>
    </section>
  );
}
