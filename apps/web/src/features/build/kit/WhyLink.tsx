/**
 * "why?" beside a rule, opening the book at the page that states it (FR3.9,
 * docs/CHARGEN.md §4.4 "a 'why?' link on any constraint that opens the reader
 * at the page").
 *
 * The frame puts one under every step's intro; a step puts one wherever a
 * number is a rule a first-timer has not read yet — the 25 Karma cap beside
 * the qualities, the Force limit beside the foci. It is the app's own reader
 * chip (`RefChip`, which opens the reader over the page rather than leaving
 * it) with our one word in front, so every "why?" in the builder looks and
 * behaves the same. On a touch screen the chip grows to a 40 px target.
 */
import type { Ref } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';

export interface WhyLinkProps {
  refValue: Ref;
  /** The word in front of the page (default "why?"). */
  label?: string;
  className?: string;
}

export default function WhyLink({ refValue, label = 'why?', className }: WhyLinkProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`} data-testid="why-link">
      <span className="mono-label text-faint">{label}</span>
      <RefChip refValue={refValue} className="pointer-coarse:min-h-10" />
    </span>
  );
}
