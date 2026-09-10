/**
 * A destructive action that takes two clicks (docs/UX_MAP_BUILDER.md §3.6):
 * the first arms it and says so, the second does it. The tracker's ✕ already
 * worked this way; a browser `confirm()` dialog is the thing this replaces —
 * it steals focus, reads as an error, and cannot be styled to say what is
 * about to go. Arming wears off on its own, or when the button loses focus.
 */
import { useEffect, useState } from 'react';

export interface ConfirmButtonProps {
  label: string;
  /** What the armed button says; defaults to the label with a question. */
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
  testId?: string;
}

const ARMED_MS = 4000;

export default function ConfirmButton(p: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      data-testid={p.testId}
      data-armed={armed ? 'yes' : 'no'}
      disabled={p.disabled}
      title={armed ? 'Click again to confirm' : p.title}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          p.onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={
        (p.className ?? 'btn py-1') + (armed ? ' border-danger bg-danger/10 text-danger' : ' text-danger')
      }
    >
      {armed ? (p.confirmLabel ?? `${p.label}?`) : p.label}
    </button>
  );
}
