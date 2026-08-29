/**
 * Rollable tables panel (FR2.11): campaign-defined weighted tables — one
 * Roll button each; the server draws the entry and logs it as an event.
 */
import { useState } from 'react';
import { rollOnTable, useRollTables } from './commands.js';

export default function RollTablesPanel({ campaignId }: { campaignId: string }) {
  const { data: tables, isLoading, isError } = useRollTables(campaignId);
  const [last, setLast] = useState<{ tableId: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const roll = async (tableId: string) => {
    setBusy(tableId);
    try {
      const result = await rollOnTable(tableId);
      const text = result?.text ?? result?.entry?.text;
      if (text) setLast({ tableId, text });
    } catch {
      setLast({ tableId, text: 'Roll failed — is the server up?' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" aria-label="Rollable tables">
      <header className="border-b border-edge px-3 py-2">
        <span className="mono-label text-cyan">Rollable tables</span>
      </header>

      <div className="max-h-64 overflow-y-auto">
        {isLoading && (
          <p className="p-3 text-sm text-faint" aria-busy="true">
            Loading tables…
          </p>
        )}
        {/* A failed read is not an empty table list — say which one it is. */}
        {isError && (
          <p className="p-3 text-sm text-warn">Could not load the rollable tables.</p>
        )}
        {tables && tables.length === 0 && (
          <p className="p-3 text-sm text-faint">No tables — the GM can add complications, loot, weather…</p>
        )}
        <ul>
          {tables?.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-b border-edge/50 px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{t.title}</div>
                <div className="mono-label text-faint">
                  {t.entries.length} entries
                  {t.visibility !== 'public' && <span className="ml-2 text-magenta">GM</span>}
                </div>
                {last?.tableId === t.id && (
                  <div className="mt-1 text-xs text-cyan">→ {last.text}</div>
                )}
              </div>
              <button
                type="button"
                className="btn px-2.5 py-1"
                disabled={busy === t.id || t.entries.length === 0}
                onClick={() => void roll(t.id)}
              >
                Roll
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
