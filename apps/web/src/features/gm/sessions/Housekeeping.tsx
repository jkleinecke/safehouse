/**
 * Housekeeping screen (FR3.6): the pending ledger queue. Players propose
 * karma/nuyen spends; nothing moves a balance until the GM approves it here.
 * Balances are sums of approved entries — no free-floating numbers.
 */
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import {
  useApproveLedger,
  usePendingLedger,
  useRejectLedger,
  type PendingLedgerEntry,
} from './api.js';

function Delta({ entry }: { entry: PendingLedgerEntry }) {
  const positive = entry.delta > 0;
  return (
    <span className={`chip ${positive ? 'border-ok/50 text-ok' : 'border-warn/50 text-warn'}`}>
      {positive ? '+' : ''}
      {entry.delta} {entry.currency}
    </span>
  );
}

export interface HousekeepingProps {
  campaignId: string;
}

export default function Housekeeping({ campaignId }: HousekeepingProps) {
  const pending = usePendingLedger(campaignId);
  const approve = useApproveLedger(campaignId);
  const reject = useRejectLedger(campaignId);
  const rows = pending.data ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <SectionTitle hint="the GM's approval is the transaction">
          Housekeeping
        </SectionTitle>
        {rows.length > 0 && <span className="chip border-warn/50 text-warn">{rows.length}</span>}
        {pending.isFetching && <Spinner />}
      </div>

      <ErrorNote error={pending.error} />

      {rows.length === 0 && !pending.isLoading && (
        <p className="mt-3 text-sm text-dim">Nothing pending — the books balance.</p>
      )}

      <ul className="mt-3 divide-y divide-edge">
        {rows.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
            <Delta entry={entry} />
            <span className="min-w-0 flex-1">
              <span className="text-sm text-ink">{entry.reason}</span>
              <span className="mono-label ml-2 text-faint">
                {entry.characterName ?? entry.characterId}
                {entry.createdAt ? ` · ${entry.createdAt.slice(0, 10)}` : ''}
              </span>
            </span>
            <button
              className="btn px-2.5 py-1 text-ok"
              disabled={approve.isPending}
              onClick={() => approve.mutate(entry.id)}
            >
              approve
            </button>
            <button
              className="btn px-2.5 py-1 text-danger"
              disabled={reject.isPending}
              onClick={() => reject.mutate(entry.id)}
            >
              reject
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={approve.error ?? reject.error} />
    </div>
  );
}
