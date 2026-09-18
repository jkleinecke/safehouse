/**
 * The small pieces the Gear step's panels share (FR3.9, docs/CHARGEN.md §4.4
 * Step 7): one way to say an engine finding beside the thing it is about, and
 * one heading style for the step's sections.
 *
 * The step lays its findings where they apply — an Availability over the cap
 * on the line that is over it, an overspend beside the nuyen pool, a missing
 * lifestyle over the lifestyles — rather than in one list at the top, so a
 * player reads "why" next to "what". Each finding is the validator's own
 * sentence and page; the mark in front says which kind it is in a glyph *and*
 * a word for a screen reader, never colour alone.
 */
import type { ReactNode } from 'react';
import type { Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';

/** A reader chip grown to a thumb's 40 px on a touch screen, as the kit's picker rows and "why?" links do. */
export const TOUCH_CHIP = 'pointer-coarse:min-h-10';

const MARK: Readonly<Record<Issue['severity'], { glyph: string; word: string; tone: string }>> = {
  error: { glyph: '✕', word: 'must fix:', tone: 'text-danger' },
  warning: { glyph: '!', word: 'worth a look:', tone: 'text-warn' },
  approval: { glyph: '?', word: 'needs the GM:', tone: 'text-magenta' },
};

/** One engine finding: its mark, its sentence, its page. Render inside a list. */
export function IssueNote({ issue, id }: { issue: Issue; id?: string }) {
  const mark = MARK[issue.severity];
  return (
    <li
      {...(id ? { id } : {})}
      className="flex flex-wrap items-center gap-1.5 text-xs"
      data-issue={issue.code}
      data-severity={issue.severity}
    >
      <span aria-hidden className={mark.tone}>
        {mark.glyph}
      </span>
      <span className="sr-only">{mark.word}</span>
      <span className="text-ink">{issue.message}</span>
      <RefChip refValue={issue.ref} className={TOUCH_CHIP} />
    </li>
  );
}

/** A list of findings, or nothing when there are none. */
export function IssueNotes({ issues, testId }: { issues: readonly Issue[]; testId?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" {...(testId ? { 'data-testid': testId } : {})}>
      {issues.map((issue, i) => (
        <IssueNote key={`${issue.code}-${i}`} issue={issue} />
      ))}
    </ul>
  );
}

/** A section of the step: a panel with its h2, labelled by it. */
export function GearSection({
  id,
  headingId,
  title,
  aside,
  testId,
  children,
}: {
  id?: string;
  headingId: string;
  title: string;
  aside?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      aria-labelledby={headingId}
      className="panel min-w-0 space-y-3 p-3 sm:p-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Our mono micro-heading for a group inside a section (an h3). */
export function SubHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 {...(id ? { id } : {})} className="mono-label text-dim">
      {children}
    </h3>
  );
}
