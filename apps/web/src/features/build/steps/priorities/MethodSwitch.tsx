/**
 * How the rows are paid for: the priority table or Sum to Ten (FR3.9,
 * docs/CHARGEN.md §8.3 `method`, RF p. 62).
 *
 * Sum to Ten is a campaign option, so this section only appears where the GM
 * turned it on — or where a build already uses it, so a player whose GM has
 * since turned it off can see why the step is blocked and switch back. The
 * two methods read the same rows differently (under one a row sits in one
 * column, under the other rows repeat and cost points), and switching to the
 * table can empty a column that repeats a row. The switch happens on one
 * press; its title says what it will do to *these* rows
 * (`methodSwitchSentence`, over the engine's own `setMethod`).
 *
 * Under Sum to Ten the section also carries the priority-points pool
 * (`PoolLine` over `budgets.pools.priorityPoints`), the one number the method
 * adds.
 */
import { useId } from 'react';
import type { BuildMethod, Budgets } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import PoolLine from '../../kit/PoolLine.js';
import WhyLink from '../../kit/WhyLink.js';
import { methodLead, methodSwitchLabel, methodSwitchSentence, type MethodModel } from './model.js';

export interface MethodSwitchProps {
  method: MethodModel;
  budgets: Budgets;
  onSwitch: (target: BuildMethod) => void;
  readOnly?: boolean;
}

export function MethodSwitchView({ method, budgets, onSwitch, readOnly = false }: MethodSwitchProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const notAllowedId = `${id}-not-allowed`;
  if (!method.shown) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="priority-method" data-method={method.current}>
      <h2 id={headingId} className="mono-label text-cyan">
        Method
      </h2>
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-dim">
        <span>{methodLead(method.current)}</span>
        {method.current === 'sumToTen' && <WhyLink refValue={method.ref} />}
      </p>
      {method.current === 'sumToTen' && <PoolLine budgets={budgets} pool="priorityPoints" />}
      {method.notAllowed && (
        <p id={notAllowedId} className="flex items-baseline gap-1.5 text-sm text-warn" data-testid="priority-method-not-allowed">
          <span aria-hidden className="shrink-0">
            ⛔
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{method.notAllowed.message}</span>
            <RefChip refValue={method.notAllowed.ref} />
          </span>
        </p>
      )}
      {!readOnly && method.canSwitch && (
        <button
          type="button"
          className="btn px-3 py-1.5"
          onClick={() => onSwitch(method.target)}
          title={methodSwitchSentence(method.plan)}
          {...(method.notAllowed ? { 'aria-describedby': notAllowedId } : {})}
          data-testid="priority-method-switch"
        >
          {methodSwitchLabel(method.target)}
        </button>
      )}
    </section>
  );
}

export default MethodSwitchView;
