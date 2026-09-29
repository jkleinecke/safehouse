/**
 * A button whose action the GM asked to confirm: the press opens the
 * "are you sure?" popup (`ConfirmDialog`), and its own button does it.
 * Never two presses on the same button.
 */
import { useState, type ReactNode } from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog.js';

export interface ConfirmButtonProps {
  label: string;
  /** The popup's question: "Remove Floor 2?" */
  question: string;
  /** The popup's sentence on what goes. */
  detail?: ReactNode;
  /** One word for the popup's confirm button. */
  action: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
  testId?: string;
}

export default function ConfirmButton(p: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid={p.testId}
        disabled={p.disabled}
        title={p.title}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={(p.className ?? 'btn py-1') + ' text-danger'}
      >
        {p.label}
      </button>
      <ConfirmDialog
        open={open}
        title={p.question}
        detail={p.detail}
        action={p.action}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          p.onConfirm();
        }}
      />
    </>
  );
}
