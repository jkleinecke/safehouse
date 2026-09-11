/** Small shared UI atoms for the sheet feature (phone-first, dark theme). */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Ref } from '@safehouse/contracts';
import { isDismissKey } from '../a11y.js';
import { RefChip as BookRefChip } from '../../gm/books/RefChip.js';
import { openBookSearch } from '../../gm/books/searchStore.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom-sheet modal — thumb-reach on a 390px phone, centered on desktop.
 *
 * Keyboard contract (found missing live: the provenance popover could be
 * opened but not escaped): Escape closes it, focus moves inside on open, Tab
 * cycles within the panel instead of wandering into the sheet behind it, and
 * focus returns to whatever opened it on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const returnTo = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    closeRef.current = onClose;
  });

  // Focus in on open, focus back on close. This effect depends on `open`
  // ALONE on purpose: callers pass a fresh `onClose` closure every render, and
  // including it would re-run this on every keystroke — yanking focus back to
  // the opener and then to the panel between one character and the next.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const node = panel.current;
    // Nothing inside has claimed focus (the roll dialog claims its own button)
    // → park it on the panel so a reader starts at the title, not at the page.
    if (node && !node.contains(document.activeElement)) node.focus();
    return () => {
      const back = returnTo.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (isDismissKey(e.key)) {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-xl border border-edge bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none sm:max-w-md sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        {...(title !== undefined ? { 'aria-labelledby': titleId } : {})}
      >
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="mono-label text-cyan" id={titleId}>
              {title}
            </div>
            <button
              type="button"
              className="text-dim hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mono-label mt-4 mb-2 first:mt-0">{children}</div>;
}

/** +/− stepper for small integers (Force picker, situational bump). */
export function Stepper({
  value,
  onChange,
  min = -20,
  max = 20,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const name = label ?? 'value';
  return (
    <div
      className="inline-flex items-center gap-1"
      role="group"
      aria-label={label ? `${label}, ${value}` : undefined}
    >
      {label && <span className="mono-label mr-1">{label}</span>}
      <button
        type="button"
        className="btn h-8 w-8 p-0"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={`decrease ${name}`}
      >
        −
      </button>
      <span className="w-9 text-center font-label text-sm text-ink" aria-hidden>
        {value}
      </span>
      <button
        type="button"
        className="btn h-8 w-8 p-0"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={`increase ${name}`}
      >
        +
      </button>
    </div>
  );
}

/**
 * {book, page} → tappable chip opening the in-app reader OVER the sheet
 * (M11, FR11.3) — the same overlay every other ref surface uses, so a chip
 * tapped on a phone mid-fight does not throw the player out of their sheet.
 * With no page but a name, the chip searches the books for the thing
 * (FR12.14), so an item Chummer did not source is still one tap from the rule.
 */
export function RefChip({ refInfo, lookup }: { refInfo: Ref | undefined; lookup?: string | undefined }) {
  if (refInfo) {
    return (
      <span className="inline-flex" onClick={(e) => e.stopPropagation()} role="presentation">
        <BookRefChip refValue={refInfo} className="text-faint" />
      </span>
    );
  }
  if (!lookup) return null;
  return (
    <button
      type="button"
      className="chip text-faint hover:border-cyan hover:text-cyan"
      onClick={(e) => {
        e.stopPropagation();
        openBookSearch(lookup);
      }}
      aria-label={`Find ${lookup} in the books`}
      title="No page on the sheet — search the books for it"
      data-testid="ref-lookup"
    >
      find ⌕
    </button>
  );
}

/** Inline empty-state note. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-faint">{children}</p>;
}

/**
 * A whole list row whose job is one action (roll this skill, cast this spell).
 * A real `<button>`, not a `div` with a click handler: Enter and Space, focus
 * ring and the "button" role all come for free, and the accessible name is
 * mandatory rather than optional.
 */
export function RowButton({
  label,
  onActivate,
  className,
  children,
}: {
  label: string;
  onActivate: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onActivate}
      className={
        className ??
        'flex min-w-0 flex-1 items-center gap-2 rounded py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan active:bg-raised/60'
      }
    >
      {children}
    </button>
  );
}
