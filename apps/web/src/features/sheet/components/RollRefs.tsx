/**
 * The "read up on it" row (FR11.2/FR11.3): one chip per reference that
 * explains the roll on screen — the skill, each attribute in the pool, the
 * test, the limit. A tap opens the book at that page over the dialog; the
 * dialog is still there when the book closes.
 */
import type { RuleRef } from '@safehouse/rules';
import { RefChip } from '../../gm/books/RefChip.js';

export interface RollRefsProps {
  refs: readonly RuleRef[];
  /** A word before the chips; defaults to "read up". */
  label?: string;
  className?: string;
}

export default function RollRefs({ refs, label = 'read up', className }: RollRefsProps) {
  if (refs.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}
      data-testid="roll-refs"
      role="group"
      aria-label="Rules for this roll"
    >
      <span className="mono-label text-faint">{label}</span>
      {refs.map((r) => (
        <span key={`${r.book}-${r.page}-${r.topic}`} title={r.topic} className="inline-flex items-center gap-1">
          <RefChip refValue={{ book: r.book, page: r.page, note: r.topic }} className="text-faint" />
          <span className="text-[0.65rem] text-faint">{r.topic}</span>
        </span>
      ))}
    </div>
  );
}
