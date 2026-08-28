/**
 * Ledger tab (FR3.6): karma + nuyen balances as ledger sums (no free-floating
 * numbers), the append-only history, and a propose-spend form that lands as a
 * *pending* entry for the GM to settle at the table.
 */
import { useState } from 'react';
import type { Currency, LedgerEntry } from '@safehouse/contracts';
import { formatNuyen, ledgerBalances, signed } from '../lib.js';
import { useLedger, useProposeSpend } from '../api.js';
import { Empty, SectionLabel } from '../components/ui.js';
import type { TabProps } from './shared.js';

const STATE_CLASS: Record<string, string> = {
  approved: 'text-ok',
  pending: 'text-warn',
  rejected: 'text-faint line-through',
};

function amount(entry: LedgerEntry): string {
  return entry.currency === 'nuyen'
    ? `${entry.delta < 0 ? '−' : '+'}${formatNuyen(Math.abs(entry.delta))}`
    : `${signed(entry.delta)} karma`;
}

function BalanceCard({
  label,
  approved,
  pending,
  format,
}: {
  label: string;
  approved: number;
  pending: number;
  format: (n: number) => string;
}) {
  return (
    <div className="panel flex-1 p-3">
      <div className="mono-label">{label}</div>
      <div className="mt-0.5 font-label text-xl text-ink">{format(approved)}</div>
      {pending !== 0 && (
        <div className="mono-label text-warn">
          {format(pending)} pending → {format(approved + pending)}
        </div>
      )}
    </div>
  );
}

export default function LedgerTab({ character }: TabProps) {
  const { data: entries = [], isPending, isError } = useLedger(character.id);
  const propose = useProposeSpend(character.id);
  const [currency, setCurrency] = useState<Currency>('nuyen');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const balances = ledgerBalances(entries);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && reason.trim() !== '';

  const submit = () => {
    if (!valid) return;
    propose.mutate(
      { currency, amount: Math.abs(parsed), reason: reason.trim() },
      {
        onSuccess: () => {
          setValue('');
          setReason('');
        },
      },
    );
  };

  return (
    <div className="p-4">
      <div className="flex gap-2">
        <BalanceCard
          label="Nuyen"
          approved={balances.nuyen.approved}
          pending={balances.nuyen.pending}
          format={formatNuyen}
        />
        <BalanceCard
          label="Karma"
          approved={balances.karma.approved}
          pending={balances.karma.pending}
          format={(n) => String(n)}
        />
      </div>

      <SectionLabel>Propose a spend</SectionLabel>
      <div className="panel p-3">
        <div className="flex gap-1.5">
          {(['nuyen', 'karma'] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${currency === c ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => setCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="w-24 rounded border border-edge-bright bg-ground px-2 py-1.5 font-label text-sm text-ink"
            inputMode="numeric"
            placeholder="amount"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Spend amount"
          />
          <input
            className="min-w-0 flex-1 rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink"
            placeholder="what for?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Spend reason"
          />
        </div>
        <button
          type="button"
          className="btn btn-accent mt-3 w-full py-2.5 text-sm"
          disabled={!valid || propose.isPending}
          onClick={submit}
        >
          {propose.isPending ? 'Sending…' : 'Propose — pending GM approval'}
        </button>
        {propose.isError && (
          <p className="mt-2 text-xs text-danger">
            Couldn't reach the ledger. Settle it at the table and try again.
          </p>
        )}
      </div>

      <SectionLabel>History</SectionLabel>
      {isPending && <Empty>Loading ledger…</Empty>}
      {isError && <Empty>Ledger unavailable — balances shown are what we have.</Empty>}
      {!isPending && !isError && entries.length === 0 && <Empty>No entries yet.</Empty>}
      <ul className="divide-y divide-edge/60">
        {[...entries].reverse().map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{entry.reason}</div>
              <div className="mono-label">
                {entry.createdAt ? entry.createdAt.slice(0, 10) : '—'}
                {entry.sessionId ? ' · session' : ''}
              </div>
            </div>
            <span className={`chip shrink-0 ${STATE_CLASS[entry.state] ?? 'text-dim'}`}>
              {entry.state}
            </span>
            <span
              className={`shrink-0 font-label text-sm ${
                entry.delta < 0 ? 'text-magenta' : 'text-ok'
              }`}
            >
              {amount(entry)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
