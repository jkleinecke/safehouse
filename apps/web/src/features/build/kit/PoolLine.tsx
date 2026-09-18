/**
 * One pool, in a sentence, where a step spends it (FR3.9, docs/CHARGEN.md
 * §4.4 "numbers chosen earlier are shown wherever they matter later").
 *
 * The rail lists every pool, but on a phone the rail folds away, and even on
 * a laptop the eye is on the steppers. So a step says the pool it is
 * spending right above them: "12 of 28 skill points left". Spent past what it
 * holds, it says so in words and in the warning colour, never as a negative
 * number: "3 skill points over: 31 spent of 28". The sentence is
 * `poolSentence`; the number is `budgets()`'s. A pool this build does not
 * have (power points for a mundane) renders nothing.
 */
import type { Budgets } from '@safehouse/contracts';
import type { RailPoolKey } from '../lib.js';
import { poolOf, poolSentence } from './words.js';

export interface PoolLineProps {
  budgets: Budgets;
  pool: RailPoolKey;
  className?: string;
  /** For `aria-describedby` from the controls that spend it. */
  id?: string;
}

export default function PoolLine({ budgets, pool, className, id }: PoolLineProps) {
  const row = poolOf(budgets, pool);
  if (!row) return null;
  const over = row.remaining < 0;
  return (
    <p
      {...(id ? { id } : {})}
      className={`text-sm ${over ? 'text-danger' : row.remaining === 0 ? 'text-ok' : 'text-dim'} ${className ?? ''}`}
      data-testid="pool-line"
      data-pool={pool}
      data-over={over ? 'yes' : 'no'}
    >
      {over && <span aria-hidden>✕ </span>}
      {poolSentence(pool, row)}
    </p>
  );
}
