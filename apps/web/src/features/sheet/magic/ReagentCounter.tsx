/**
 * Reagent drams (FR8.4) — the last magic side-spreadsheet, folded in.
 *
 * The only interesting property is the one the counter guarantees: it never
 * goes below zero. Spending more than is on hand is refused at the button and
 * floored by the engine behind it, so the optimistic number and the
 * authoritative one can never disagree about what happened.
 */
import { useState } from 'react';
import { reagentsAfterSpend } from './lib.js';
import { SectionLabel, Stepper } from '../components/ui.js';

export interface ReagentCounterProps {
  drams: number;
  onSpend: (amount: number) => void;
  onRestock: (amount: number) => void;
  busy?: boolean;
}

export default function ReagentCounter({ drams, onSpend, onRestock, busy }: ReagentCounterProps) {
  const [amount, setAmount] = useState(1);
  const preview = reagentsAfterSpend(drams, amount);
  const empty = drams <= 0;

  return (
    <>
      <SectionLabel>Reagents</SectionLabel>
      <div className="flex items-center justify-between gap-2 rounded border border-edge/70 bg-raised/40 p-3">
        <div>
          <div className="font-label text-2xl text-cyan" aria-label={`${drams} drams of reagents on hand`}>
            {drams}
          </div>
          <div className="mono-label">drams on hand</div>
        </div>
        <Stepper value={amount} onChange={setAmount} min={1} max={99} label="amount" />
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={`btn flex-1 py-2.5 text-sm ${empty ? 'text-faint' : ''}`}
          disabled={empty || busy === true}
          onClick={() => onSpend(amount)}
          aria-label={
            empty
              ? 'No reagents left to spend'
              : `Spend ${amount} ${amount === 1 ? 'dram' : 'drams'}, leaving ${preview.after}`
          }
        >
          Spend {amount}
        </button>
        <button
          type="button"
          className="btn flex-1 py-2.5 text-sm"
          disabled={busy === true}
          onClick={() => onRestock(amount)}
          aria-label={`Restock ${amount} ${amount === 1 ? 'dram' : 'drams'}, making ${drams + amount}`}
        >
          Restock {amount}
        </button>
      </div>

      {preview.shortfall > 0 && !empty && (
        <p className="mt-1 text-xs text-warn" role="status">
          Only {drams} on hand — spending would stop at zero, {preview.shortfall} short.
        </p>
      )}
    </>
  );
}
