/**
 * The runner's background (FR3.9, docs/CHARGEN.md §4.4 Step 9 "a background
 * box"; the book's final touches, p. 103).
 *
 * A labelled textarea bound straight to `identity.background` through
 * `update(withBackground)`: no private copy of the text, so a save's echo or a
 * GM's return shows at once, and every keystroke rides the walkthrough's
 * debounced autosave like any other edit. Read only, it is the text (or a
 * line saying there is none), never a disabled box. The contract's length
 * limit is the box's `maxLength`, and the count is shown once it gets close.
 */
import { useId } from 'react';
import type { CharacterBuild } from '@safehouse/contracts';
import type { BuildUpdater } from '../../session.js';
import { BACKGROUND_MAX, backgroundOf, withBackground } from './checklist.js';

export interface BackgroundBoxProps {
  build: Pick<CharacterBuild, 'identity'>;
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
  testId?: string;
}

/** Show the count once the text is within a tenth of the limit. */
export function backgroundCount(text: string): string | null {
  return text.length >= BACKGROUND_MAX * 0.9 ? `${text.length.toLocaleString('en-US')} of ${BACKGROUND_MAX.toLocaleString('en-US')} characters` : null;
}

export default function BackgroundBox({ build, update, readOnly, testId = 'finish-background' }: BackgroundBoxProps) {
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const saveId = useId();
  const text = backgroundOf(build);
  const count = backgroundCount(text);

  return (
    <section aria-labelledby={headingId} className="panel space-y-2 p-3 sm:p-4" data-testid={testId} data-print-hide="">
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Background
      </h2>
      {readOnly ? (
        text.trim() ? (
          <p className="whitespace-pre-wrap text-sm text-ink" data-testid={`${testId}-text`}>
            {text}
          </p>
        ) : (
          <p className="text-sm text-faint">No background written.</p>
        )
      ) : (
        <>
          <p id={hintId} className="text-sm text-dim">
            Where the runner comes from, what they want, who they owe. A few lines are enough.
          </p>
          <textarea
            id={fieldId}
            className="block min-h-32 w-full rounded-md border border-edge-bright bg-ground px-3 py-2 text-sm text-ink"
            value={text}
            maxLength={BACKGROUND_MAX}
            rows={6}
            aria-labelledby={headingId}
            aria-describedby={`${hintId} ${saveId}`}
            onChange={(e) => {
              const next = e.target.value;
              update((b) => withBackground(b, next));
            }}
            data-testid={`${testId}-field`}
          />
          <p id={saveId} className="text-xs text-faint">
            Saved as you type{count ? ` · ${count}` : ''}.
          </p>
        </>
      )}
    </section>
  );
}
