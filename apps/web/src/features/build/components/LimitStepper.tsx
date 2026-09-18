/**
 * A −/+ stepper that refuses, and says why (FR3.9, docs/CHARGEN.md §4.4
 * Step 3 "the second stepper that reaches its max refuses and says…", §8.6).
 *
 * The sheet's `Stepper` clamps silently at `max` and has no way to say no
 * with a reason, which is fine for a Force picker and wrong for character
 * creation, where every ceiling is a rule a first-timer has not read yet:
 * the natural maximum, one attribute at max, rating 6, 7 per contact. So a
 * refused press here does not just do nothing — the button stays focusable
 * (`aria-disabled`, not `disabled`, which would drop it out of the tab order
 * and hide the reason from a screen reader), its reason is a sentence on the
 * screen tied to the button by `aria-describedby`, and when a `ref` comes
 * with it the "why?" chip opens the page. Colour marks it too, but never
 * alone.
 *
 * **Quiet until pressed.** A column of seventy-five skill rows used to show
 * the red ⛔ sentence under every row at its cap before anyone had tried to
 * pass it, and a refusal written for the tap ("2 native languages; one is
 * free") read as if the build already had the problem. So a refusal nobody
 * has pressed is said quietly: the caller's few neutral words (`hint`, "at
 * 6", "can't afford") on screen, the full sentence still what a screen
 * reader hears; with no hint, the sentence and its page in a muted tone. Pressing
 * the refused button turns it into the ⛔ sentence and its page, framed as
 * what that press would have done.
 *
 * **Where the refusal sits.** Inside the component, under the buttons, which
 * suits a form. A list of rows with the stepper at the right edge wants the
 * sentence under the *whole row* instead — inside the stepper it widened the
 * component to the sentence and pushed a refused row's buttons out of line
 * with the rest — so `useLimitStepper` hands the caller the buttons and the
 * refusal as two pieces to place.
 *
 * The rule itself is the caller's (the engine's eligibility and budget
 * answers); this component only enforces "past the limit, refuse and explain".
 * On a touch screen its buttons are 40 px square, a thumb's target.
 */
import { useId, useState, type ReactNode } from 'react';
import type { Ref } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';

/** Why a direction is shut: our sentence, and the page it comes from. */
export interface Refusal {
  reason: string;
  ref?: Ref;
  /** A few neutral words said before the control is pressed ("at 6", "can't afford"); the sentence shows once it is. */
  hint?: string;
}

export interface LimitStepperProps {
  /** The quantity's name, used in every accessible label ("Agility"). */
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  /** A rule that shuts increasing before `max` does (or explains `max`). */
  refuseIncrease?: Refusal | null;
  /** A rule that shuts decreasing before `min` does. */
  refuseDecrease?: Refusal | null;
  /** Read-only: show the value, offer nothing. */
  readOnly?: boolean;
  /** Suffix after the value ("pts"). */
  unit?: string;
  /**
   * The id of text beside the stepper that says what the increase does — a
   * price quote ("to 5: costs 10 Karma"), a consequence — read with the +
   * button while it is open. A refusal, when there is one, is tied as well.
   */
  increaseDescribedBy?: string;
  /** Visually hide the label (the row already names it). */
  hideLabel?: boolean;
  testId?: string;
}

export interface StepperGate {
  canIncrease: boolean;
  canDecrease: boolean;
  increaseReason: Refusal | null;
  decreaseReason: Refusal | null;
}

/**
 * Which way the stepper may move and why not. A caller's refusal wins over
 * the plain bounds, because its sentence names the rule; the bounds get a
 * sentence of their own so a refusal is never wordless.
 */
export function stepperGate(p: Pick<LimitStepperProps, 'label' | 'value' | 'min' | 'max' | 'step' | 'refuseIncrease' | 'refuseDecrease'>): StepperGate {
  const step = p.step ?? 1;
  const min = p.min ?? 0;
  const increaseReason =
    p.refuseIncrease ??
    (p.max !== undefined && p.value + step > p.max ? { reason: `${p.label} is at its limit of ${p.max}.`, hint: `at ${p.max}` } : null);
  const decreaseReason =
    p.refuseDecrease ?? (p.value - step < min ? { reason: `${p.label} cannot go below ${min}.`, hint: `at ${min}` } : null);
  return {
    canIncrease: increaseReason === null,
    canDecrease: decreaseReason === null,
    increaseReason,
    decreaseReason,
  };
}

/** How a refusal is said: quietly (nobody pressed it) or as the answer to a press. */
export type RefusalVoice = 'quiet' | 'pressed';

/** One refusal line, in its voice. Exported for the rows that say a refusal the same way outside a stepper. */
export function RefusalNote({
  id,
  refusal,
  voice,
  direction,
  className = '',
}: {
  id: string;
  refusal: Refusal;
  voice: RefusalVoice;
  direction: 'increase' | 'decrease';
  className?: string;
}) {
  if (voice === 'pressed') {
    return (
      // The glyph stays beside the first line of its sentence, however narrow the row.
      <p id={id} className={`flex items-baseline gap-1.5 text-xs text-warn ${className}`} data-refusal={direction} data-voice="pressed">
        <span aria-hidden className="shrink-0">
          ⛔
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>{refusal.reason}</span>
          {refusal.ref && <RefChip refValue={refusal.ref} />}
        </span>
      </p>
    );
  }
  return (
    <p id={id} className={`flex flex-wrap items-center gap-1.5 text-xs text-faint ${className}`} data-refusal={direction} data-voice="quiet">
      {refusal.hint ? (
        <>
          <span aria-hidden>{refusal.hint}</span>
          <span className="sr-only">{refusal.reason}</span>
        </>
      ) : (
        <>
          <span>{refusal.reason}</span>
          {refusal.ref && <RefChip refValue={refusal.ref} />}
        </>
      )}
    </p>
  );
}

export interface LimitStepperParts {
  /** The labelled −, value and + group. */
  controls: ReactNode;
  /** The refusal lines, or null when nothing is refused (or the stepper is read-only). */
  refusal: ReactNode;
  gate: StepperGate;
}

/**
 * The stepper as two pieces a row can place apart: the buttons (keep them in
 * the row) and the refusal (put it under the row, full width). Both carry the
 * ids that tie them together.
 */
export function useLimitStepper(props: LimitStepperProps): LimitStepperParts {
  const { label, value, onChange, readOnly = false, unit, hideLabel = false } = props;
  const step = props.step ?? 1;
  const gate = stepperGate(props);
  const id = useId();
  // The reason last pressed against, per direction: a press is answered for
  // that reason only, so a new refusal (a change elsewhere) starts quiet again.
  const [pressed, setPressed] = useState<{ up: string | null; down: string | null }>({ up: null, down: null });
  const upId = `${id}-up`;
  const downId = `${id}-down`;
  const labelId = `${id}-label`;
  // The increase refusal is the one people meet; show it. A decrease refusal
  // at the floor is obvious and only worth words when a rule caused it.
  const showDown = gate.decreaseReason !== null && props.refuseDecrease != null;
  const upDescribedBy = [
    ...(props.increaseDescribedBy && gate.canIncrease ? [props.increaseDescribedBy] : []),
    ...(gate.increaseReason ? [upId] : []),
  ].join(' ');
  const upVoice: RefusalVoice = gate.increaseReason && pressed.up === gate.increaseReason.reason ? 'pressed' : 'quiet';
  const downVoice: RefusalVoice = gate.decreaseReason && pressed.down === gate.decreaseReason.reason ? 'pressed' : 'quiet';

  const controls = (
    <div className="inline-flex shrink-0 items-center gap-1.5" role="group" aria-labelledby={labelId}>
      <span id={labelId} className={hideLabel ? 'sr-only' : 'mono-label mr-1'}>
        {label}
      </span>
      {!readOnly && (
        <button
          type="button"
          className={`btn h-9 w-9 p-0 pointer-coarse:h-10 pointer-coarse:w-10 ${gate.canDecrease ? '' : 'cursor-not-allowed opacity-50'}`}
          aria-label={`decrease ${label}`}
          aria-disabled={gate.canDecrease ? undefined : 'true'}
          {...(showDown ? { 'aria-describedby': downId } : {})}
          data-refused={gate.canDecrease ? 'no' : 'yes'}
          onClick={() => {
            if (gate.canDecrease) onChange(value - step);
            else if (gate.decreaseReason) setPressed((p) => ({ ...p, down: gate.decreaseReason!.reason }));
          }}
        >
          −
        </button>
      )}
      <output className="min-w-[2.5ch] text-center font-label text-sm text-ink" aria-live="polite">
        {value}
        {unit ? <span className="ml-0.5 text-faint">{unit}</span> : null}
      </output>
      {!readOnly && (
        <button
          type="button"
          className={`btn h-9 w-9 p-0 pointer-coarse:h-10 pointer-coarse:w-10 ${gate.canIncrease ? '' : 'cursor-not-allowed opacity-50'}`}
          aria-label={`increase ${label}`}
          aria-disabled={gate.canIncrease ? undefined : 'true'}
          {...(upDescribedBy ? { 'aria-describedby': upDescribedBy } : {})}
          data-refused={gate.canIncrease ? 'no' : 'yes'}
          onClick={() => {
            if (gate.canIncrease) onChange(value + step);
            else if (gate.increaseReason) setPressed((p) => ({ ...p, up: gate.increaseReason!.reason }));
          }}
        >
          +
        </button>
      )}
    </div>
  );

  const up = !readOnly && gate.increaseReason ? <RefusalNote id={upId} refusal={gate.increaseReason} voice={upVoice} direction="increase" /> : null;
  const down =
    !readOnly && showDown && gate.decreaseReason ? (
      <RefusalNote id={downId} refusal={gate.decreaseReason} voice={downVoice} direction="decrease" />
    ) : null;
  const refusal = up || down ? (
    <>
      {up}
      {down}
    </>
  ) : null;
  return { controls, refusal, gate };
}

export default function LimitStepper(props: LimitStepperProps) {
  const { controls, refusal } = useLimitStepper(props);
  return (
    <div className="inline-flex max-w-full flex-col items-start gap-1" data-testid={props.testId}>
      {controls}
      {refusal}
    </div>
  );
}

/**
 * `useLimitStepper` as a component, for a row that decides after an early
 * return whether it has a stepper at all (hooks cannot wait for that): the
 * children get the buttons and the refusal to place.
 */
export function SplitStepper({ children, ...props }: LimitStepperProps & { children: (parts: LimitStepperParts) => ReactNode }) {
  return <>{children(useLimitStepper(props))}</>;
}
