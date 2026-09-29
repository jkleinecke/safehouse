/**
 * The "are you sure?" popup. Only for actions the GM asked to be confirmed;
 * everything else runs on the first press.
 *
 * Centred, so the confirm never sits where the first press was. Focus starts
 * on Cancel; Escape, Cancel or the backdrop back out. Portalled to the body
 * and stops mouse and key events there, so a menu that closes on an outside
 * click (the floor menu, the chat menu) stays open under it.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question: "Remove Floor 2?" */
  title: string;
  /** What goes, in a sentence. */
  detail?: ReactNode;
  /** One word for the confirm button: "Remove", "Delete", "Burn". */
  action: string;
  /** Red confirm button. Default true. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export default function ConfirmDialog(p: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!p.open) return;
    returnTo.current = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      const back = returnTo.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [p.open]);

  if (!p.open || typeof document === 'undefined') return null;
  const danger = p.danger ?? true;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        p.onCancel();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Esc') p.onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={p.testId ?? 'confirm-dialog'}
        className="w-full max-w-sm rounded-xl border border-edge bg-panel p-4 shadow-xl"
        onClick={stop}
      >
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          {p.title}
        </h2>
        {p.detail && <div className="mt-1.5 text-sm text-dim">{p.detail}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn px-3 py-1.5" onClick={p.onCancel} data-testid="confirm-cancel">
            Cancel
          </button>
          <button
            type="button"
            className={`btn px-3 py-1.5 ${danger ? 'border-danger/60 text-danger' : 'btn-accent'}`}
            disabled={p.busy}
            onClick={p.onConfirm}
            data-testid="confirm-go"
          >
            {p.action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
