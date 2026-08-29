/**
 * Background tab (FR3.2): qualities with the modifiers they inject,
 * lifestyles, and the alias notes. Contacts moved to their own tab — see
 * `ContactsTab.tsx`.
 */
import { signed } from '../lib.js';
import { Empty, RefChip, SectionLabel } from '../components/ui.js';
import type { TabProps } from './shared.js';

function monthly(n: number): string {
  return `${n.toLocaleString('en-US')}¥/mo`;
}

export default function BackgroundTab({ character }: TabProps) {
  const sheet = character.sheet;

  return (
    <div className="p-4">
      <SectionLabel>Identity</SectionLabel>
      <div className="panel p-3">
        <div className="text-sm text-ink">{sheet.identity.alias}</div>
        <div className="mono-label mt-0.5">{sheet.identity.metatype}</div>
        {sheet.identity.notes && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-dim">{sheet.identity.notes}</p>
        )}
      </div>

      <SectionLabel>Qualities</SectionLabel>
      {sheet.qualities.length === 0 && <Empty>No qualities entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.qualities.map((q) => (
          <li key={q.name} className="flex items-start gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{q.name}</div>
              {(q.note || q.mods.length > 0) && (
                <div className="mono-label truncate">
                  {q.mods.map((m) => `${m.target} ${signed(m.value)}`).join(', ')}
                  {q.mods.length > 0 && q.note ? ' · ' : ''}
                  {q.note ?? ''}
                </div>
              )}
            </div>
            <RefChip refInfo={q.ref} />
          </li>
        ))}
      </ul>

      <SectionLabel>Lifestyle</SectionLabel>
      {sheet.lifestyles.length === 0 && <Empty>No lifestyle entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.lifestyles.map((l) => (
          <li key={l.name} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{l.name}</div>
              <div className="mono-label">
                {monthly(l.costPerMonth)}
                {l.paidThrough ? ` · paid through ${l.paidThrough}` : ' · unpaid'}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
