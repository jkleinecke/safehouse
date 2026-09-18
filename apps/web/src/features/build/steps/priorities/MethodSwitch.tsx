/**
 * How the rows are paid for: the priority table or Sum to Ten (FR3.9,
 * docs/CHARGEN.md §8.3 `method`, RF p. 62).
 *
 * Sum to Ten is a campaign option, so this section only appears where the GM
 * turned it on — or where a build already uses it, so a player whose GM has
 * since turned it off can see why the step is blocked and switch back. The
 * two methods read the same rows differently (under one a row sits in one
 * column, under the other rows repeat and cost points), and switching to the
 * table can empty a column that repeats a row. So the switch never happens
 * on one tap: it opens a confirm that says what the switch will do to *these*
 * rows (`methodSwitchSentence`, over the engine's own `setMethod`), and only
 * its button switches. No browser `confirm()` (UX_SITE).
 *
 * Under Sum to Ten the section also carries the priority-points pool
 * (`PoolLine` over `budgets.pools.priorityPoints`), the one number the method
 * adds. `MethodSwitchView` takes the open/closed state as a prop so a node
 * test can render both; the default export owns it.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { BuildMethod, Budgets } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import PoolLine from '../../kit/PoolLine.js';
import WhyLink from '../../kit/WhyLink.js';
import { methodLead, methodSwitchLabel, methodSwitchSentence, methodWord, type MethodModel } from './model.js';

export interface MethodSwitchProps {
  method: MethodModel;
  budgets: Budgets;
  onSwitch: (target: BuildMethod) => void;
  readOnly?: boolean;
}

export interface MethodSwitchViewProps extends MethodSwitchProps {
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
}

function ConfirmPanel({ method, onConfirm, onCancel }: { method: MethodModel; onConfirm: () => void; onCancel: () => void }) {
  const textId = useId();
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    goRef.current?.focus();
  }, []);
  return (
    <div role="group" aria-labelledby={textId} className="rounded-md border border-warn/50 bg-deck p-3" data-testid="priority-method-confirm">
      <p id={textId} className="text-sm text-ink">
        {methodSwitchSentence(method.plan)}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn px-3 py-1.5" onClick={onCancel} data-testid="priority-method-keep">
          keep {methodWord(method.current)}
        </button>
        <button ref={goRef} type="button" className="btn btn-accent px-3 py-1.5" onClick={onConfirm} data-testid="priority-method-go">
          {methodSwitchLabel(method.target)}
        </button>
      </div>
    </div>
  );
}

export function MethodSwitchView({ method, budgets, onSwitch, readOnly = false, confirming, onAsk, onCancel }: MethodSwitchViewProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const notAllowedId = `${id}-not-allowed`;
  const switchRef = useRef<HTMLButtonElement>(null);
  // Closing the confirm unmounts the button that had focus; hand focus back
  // to the switch it replaced rather than dropping it to the document.
  const wasConfirming = useRef(confirming);
  useEffect(() => {
    if (wasConfirming.current && !confirming) switchRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
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
      {!readOnly &&
        method.canSwitch &&
        (confirming ? (
          <ConfirmPanel
            method={method}
            onConfirm={() => {
              onCancel();
              onSwitch(method.target);
            }}
            onCancel={onCancel}
          />
        ) : (
          <button
            ref={switchRef}
            type="button"
            className="btn px-3 py-1.5"
            onClick={onAsk}
            {...(method.notAllowed ? { 'aria-describedby': notAllowedId } : {})}
            data-testid="priority-method-switch"
          >
            {methodSwitchLabel(method.target)}
          </button>
        ))}
    </section>
  );
}

export default function MethodSwitch(props: MethodSwitchProps) {
  const [confirming, setConfirming] = useState(false);
  return <MethodSwitchView {...props} confirming={confirming} onAsk={() => setConfirming(true)} onCancel={() => setConfirming(false)} />;
}
