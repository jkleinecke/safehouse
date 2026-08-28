/** Small shared UI atoms for the sheet feature (phone-first, dark theme). */
import { useEffect, type ReactNode } from 'react';
import type { Ref } from '@safehouse/contracts';
import { readerHref } from '../lib.js';

/** Bottom-sheet modal — thumb-reach on a 390px phone, centered on desktop. */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-xl border border-edge bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="mono-label text-cyan">{title}</div>
            <button className="text-dim hover:text-ink" onClick={onClose} aria-label="Close">
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
  return (
    <div className="inline-flex items-center gap-1">
      {label && <span className="mono-label mr-1">{label}</span>}
      <button
        type="button"
        className="btn h-8 w-8 p-0"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={`decrease ${label ?? 'value'}`}
      >
        −
      </button>
      <span className="w-9 text-center font-label text-sm text-ink">{value}</span>
      <button
        type="button"
        className="btn h-8 w-8 p-0"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={`increase ${label ?? 'value'}`}
      >
        +
      </button>
    </div>
  );
}

/** {book, page} → tappable chip opening the in-app reader (M11, FR11.3). */
export function RefChip({ refInfo }: { refInfo: Ref | undefined }) {
  if (!refInfo) return null;
  return (
    <a
      className="chip text-faint hover:border-cyan hover:text-cyan"
      href={readerHref(refInfo)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {refInfo.book} p.{refInfo.page}
    </a>
  );
}

/** Inline empty-state note. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-faint">{children}</p>;
}
