/**
 * The progress strip across the top of the walkthrough (FR3.9,
 * docs/CHARGEN.md §4.4 "names the nine steps, ticks the finished ones, and
 * marks any that a later change broke"; "free: the progress strip is a tab
 * bar").
 *
 * Every mark is a glyph and a spoken phrase as well as a colour: ✓ done, ! a
 * step that a later change broke (behind you, or ahead of you with choices
 * already in it), – skipped (a mundane's Magic step), the number for one
 * still to do. Which marks go where is `stepMark` in `lib.ts`, from the
 * engine's `stepStatus` and the record's own fields.
 *
 * Each button's accessible name starts with the word it shows ("Skills — step
 * 6, Skills: done"), so a voice-control user who says what they see reaches
 * it (WCAG 2.5.3).
 *
 * Two shapes for the two modes, because they are two different widgets:
 *
 * - **guided** — an ordered list of links-as-buttons. Going back is always
 *   open; going forward only as far as the first unfinished step
 *   (`canReach`), so the strip cannot be used to walk round Next's gate. A
 *   step out of reach stays focusable with `aria-disabled` and its reason.
 * - **free** — a WAI-ARIA tablist: every step reachable, roving tabindex,
 *   arrow keys and Home/End, like the sheet's tab bar.
 *
 * It scrolls sideways on a 390 px phone rather than wrapping into a block,
 * and keeps the current step's tab in view as the step changes
 * (`stripScrollLeft`), which it did not: a player pressing Next on a phone
 * watched the highlighted tab walk off the right edge. Each tab is a
 * thumb's 40 px tall on a touch screen.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { BuildMode, BuildStep } from '@safehouse/contracts';
import { canReach, stepMark, stripScrollLeft, type StepContent, type StepGate, type StepMark } from '../lib.js';
import { stepMeta } from '../steps/meta.js';

export interface ProgressStripProps {
  steps: readonly StepGate[];
  current: BuildStep;
  mode: BuildMode;
  onSelect: (step: BuildStep) => void;
  /** The step a GM's note is pinned to, marked on the strip. */
  noteStep?: BuildStep | null;
  /** The id of the step panel the tabs control in free mode. */
  panelId?: string;
  /** The record, so a broken step ahead of the player is marked too (`stepMark`). */
  build?: StepContent;
}

const MARK_GLYPH: Record<StepMark, (step: BuildStep) => string> = {
  done: () => '✓',
  broken: () => '!',
  skipped: () => '–',
  current: (step) => String(step),
  todo: (step) => String(step),
};

const MARK_PHRASE: Record<StepMark, string> = {
  done: 'done',
  // Behind the player it was broken by a later change; ahead of them it holds
  // choices (a concept card's, a change upstream) that are not finished.
  broken: 'needs attention',
  skipped: 'skipped',
  current: 'current step',
  todo: 'not done yet',
};

const MARK_TONE: Record<StepMark, string> = {
  done: 'border-ok/50 text-ok',
  broken: 'border-danger/60 text-danger',
  skipped: 'border-edge text-faint',
  current: 'border-cyan text-cyan shadow-glow-cyan',
  todo: 'border-edge-bright text-dim',
};

/** "Step 3, Metatype & attributes: needs attention" — what a screen reader hears. */
export function stepPhrase(gate: StepGate, current: BuildStep, build?: StepContent): string {
  const meta = stepMeta(gate.step);
  const mark = stepMark(gate, current, build);
  // The current step can be broken too; say both.
  const extra = mark === 'current' && !gate.complete && !gate.skipped ? ', not done yet' : '';
  return `Step ${gate.step}, ${meta.title}: ${MARK_PHRASE[mark]}${extra}`;
}

export default function ProgressStrip({ steps, current, mode, onSelect, noteStep = null, panelId, build }: ProgressStripProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const free = mode === 'free';

  // Keep the current step's tab in view: scroll the strip itself, never the page. The list is
  // `relative`, so a tab's offsetLeft is measured from the list's own edge.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLButtonElement>(`[data-step="${current}"]`) ?? null;
    if (!list || !tab) return;
    const left = stripScrollLeft({ left: tab.offsetLeft, width: tab.offsetWidth }, { width: list.clientWidth, scrollWidth: list.scrollWidth });
    if (typeof list.scrollTo === 'function') list.scrollTo({ left, behavior: 'smooth' });
    else list.scrollLeft = left;
    // Only when the step changes: a strip the player scrolled by hand is left alone while they edit.
  }, [current]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!free) return;
    const last = steps.length - 1;
    const target =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (target === null) return;
    e.preventDefault();
    const gate = steps[target];
    if (!gate) return;
    refs.current[target]?.focus();
    onSelect(gate.step);
  };

  return (
    <nav aria-label="Build steps" data-testid="progress-strip" data-mode={mode}>
      <ol
        ref={listRef}
        className="relative flex gap-1 overflow-x-auto px-3 py-2 sm:px-4"
        {...(free ? { role: 'tablist', 'aria-label': 'Build steps' } : {})}
      >
        {steps.map((gate, index) => {
          const meta = stepMeta(gate.step);
          const mark = stepMark(gate, current, build);
          const reachable = canReach(steps, gate.step, current, mode);
          const selected = gate.step === current;
          const hasNote = noteStep === gate.step;
          return (
            <li key={gate.step} className="shrink-0" {...(free ? { role: 'presentation' } : {})}>
              <button
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                data-step={gate.step}
                data-mark={mark}
                data-complete={gate.complete ? 'yes' : 'no'}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors pointer-coarse:min-h-10 ${
                  selected ? 'bg-raised' : 'bg-deck hover:border-cyan/60'
                } ${reachable ? '' : 'cursor-not-allowed opacity-50'} ${MARK_TONE[mark]}`}
                {...(free
                  ? { role: 'tab', 'aria-selected': selected, tabIndex: selected ? 0 : -1, ...(panelId ? { 'aria-controls': panelId } : {}) }
                  : { 'aria-current': selected ? ('step' as const) : undefined })}
                {...(reachable ? {} : { 'aria-disabled': 'true' as const })}
                aria-label={`${meta.short} — ${stepPhrase(gate, current, build)}${hasNote ? ', the GM left a note here' : ''}${
                  reachable ? '' : ' — finish the steps before it first'
                }`}
                onClick={() => {
                  if (reachable) onSelect(gate.step);
                }}
                onKeyDown={(e) => onKey(e, index)}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full border font-label text-[0.6875rem] ${MARK_TONE[mark]}`}
                >
                  {mark === 'current' && gate.complete ? '✓' : MARK_GLYPH[mark](gate.step)}
                </span>
                <span aria-hidden className="font-label uppercase tracking-wider">
                  {meta.short}
                </span>
                {hasNote && (
                  <span aria-hidden className="text-magenta">
                    ✎
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
