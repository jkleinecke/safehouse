/**
 * The GM's note on a returned build (FR3.9, docs/CHARGEN.md §4.4 "Return with
 * notes, which reopens the build for the player with the GM's note pinned to
 * the top of whichever step it names").
 *
 * On the step the note names it is the whole note, in full, at the top of
 * the frame. On every other step it is one line saying where the note is, with
 * a button that goes there — a player who resumes on step 7 should not have
 * to hunt for a note about step 3. A note that names no step is shown in full
 * everywhere. Nothing shows once the build is submitted again or approved;
 * the note is history then.
 *
 * Finish is the one exception to the pointer: it is where the player comes to
 * send the build back, so the note is shown there in full, with the way to
 * the step it names. It is shown once — this banner is the only place that
 * renders it; the Finish screen used to add its own copy under the pointer,
 * and a returned build read the same note twice.
 */
import type { BuildState, BuildStep } from '@safehouse/contracts';
import { stepMeta } from '../steps/meta.js';

export interface GmNoteBannerProps {
  state: BuildState;
  notes: string | null;
  returnedStep: BuildStep | null;
  /** The step on screen. */
  step: BuildStep;
  onGoTo?: (step: BuildStep) => void;
}

/** The step the note is shown in full on wherever it points: Finish, where the build is sent back. */
const FINISH_STEP = 9;

/** Where the note shows: in full, as a pointer to its step, or not at all. */
export function noteDisplay(p: Pick<GmNoteBannerProps, 'state' | 'notes' | 'returnedStep' | 'step'>): 'full' | 'pointer' | 'none' {
  if (p.state !== 'returned' || !p.notes?.trim()) return 'none';
  if (p.returnedStep === null || p.returnedStep === p.step || p.step === FINISH_STEP) return 'full';
  return 'pointer';
}

export default function GmNoteBanner(props: GmNoteBannerProps) {
  const display = noteDisplay(props);
  if (display === 'none') return null;
  const { notes, returnedStep, step, onGoTo } = props;

  if (display === 'pointer' && returnedStep !== null) {
    const meta = stepMeta(returnedStep);
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-magenta/40 bg-magenta/5 px-3 py-2 text-sm"
        data-testid="gm-note-pointer"
        role="note"
      >
        <span className="mono-label text-magenta">GM note</span>
        <span className="text-dim">
          The GM returned this build with a note on step {returnedStep}, {meta.title}.
        </span>
        {onGoTo && (
          <button type="button" className="chip text-magenta pointer-coarse:min-h-10" onClick={() => onGoTo(returnedStep)}>
            read it
          </button>
        )}
      </div>
    );
  }

  // In full on a step other than the one it names (Finish): the way there goes with it.
  const elsewhere = returnedStep !== null && returnedStep !== step ? returnedStep : null;
  return (
    <div
      className="rounded-md border border-magenta/50 bg-magenta/10 px-3 py-2.5"
      data-testid="gm-note"
      role="note"
      aria-label="The GM's note"
    >
      <div className="mono-label text-magenta">Returned by the GM</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{notes}</p>
      {elsewhere !== null && onGoTo && (
        <button type="button" className="btn mt-2 px-3 py-1.5" onClick={() => onGoTo(elsewhere)} data-testid="gm-note-step">
          go to step {elsewhere} · {stepMeta(elsewhere).title}
        </button>
      )}
    </div>
  );
}
