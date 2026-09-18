/**
 * The price of a tap, quoted before it is made (FR3.9, docs/CHARGEN.md §4.4
 * Step 8 "each with the cost quoted before the tap").
 *
 * "costs 10 Karma — you have 26" beside a raise, a spell, a quality: the
 * player sees what the pool will be before the pool moves, and a price the
 * pool cannot pay says how short it is ("you have 6, 4 short") in words as
 * well as the warning colour. The figure is the caller's — the engine's cost
 * for that spend (`karmaCostOf`, a quality's `hitToQuality(…).karma`) — and
 * the pool is `budgets()`'s; `costQuote` only puts them in a sentence. Give it
 * an `id` and point the button's `aria-describedby` at it, so the price is
 * read with the control.
 */
import type { Budgets } from '@safehouse/contracts';
import type { RailPoolKey } from '../lib.js';
import { costQuote, poolOf } from './words.js';

export interface CostQuoteProps {
  /** The price; negative when the pool gains (a negative quality). */
  amount: number;
  budgets: Budgets;
  /** The pool it is paid from (default Karma). */
  pool?: RailPoolKey;
  id?: string;
  className?: string;
}

export default function CostQuote({ amount, budgets, pool = 'karma', id, className }: CostQuoteProps) {
  const quote = costQuote(amount, pool, poolOf(budgets, pool));
  return (
    <span
      {...(id ? { id } : {})}
      className={`text-xs ${quote.short ? 'text-warn' : 'text-dim'} ${className ?? ''}`}
      data-testid="cost-quote"
      data-short={quote.short ? 'yes' : 'no'}
    >
      {quote.text}
    </span>
  );
}
