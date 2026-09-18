/**
 * Background tab (FR3.2): who the runner is behind the alias, the qualities
 * with what each cost or gave and the modifiers they inject, and the
 * lifestyles. Contacts moved to their own tab — see `ContactsTab.tsx`.
 *
 * The builder records a quality's side, its Karma and its rating (§8.3), and
 * this tab used to render none of them: a quality bought at rating 3 for 18
 * Karma read exactly like a 4-Karma flaw. Same for the real name, age and sex
 * the player entered on Step 1.
 */
import { signed } from '../lib.js';
import { identityDetails, qualityDetail } from '../rows.js';
import { Empty, RefChip, SectionLabel } from '../components/ui.js';
import type { TabProps } from './shared.js';

function monthly(n: number): string {
  return `${n.toLocaleString('en-US')}¥/mo`;
}

export default function BackgroundTab({ character }: TabProps) {
  const sheet = character.sheet;
  const details = identityDetails(sheet.identity);

  return (
    <div className="p-4">
      <SectionLabel>Identity</SectionLabel>
      <div className="panel p-3">
        <div className="text-sm text-ink">{sheet.identity.alias}</div>
        <div className="mono-label mt-0.5">{sheet.identity.metatype}</div>
        {details.length > 0 && (
          <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {details.map((d) => (
              <div key={d.label} className="flex gap-1">
                <dt className="mono-label">{d.label}</dt>
                <dd className="text-xs text-dim">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {sheet.identity.notes && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-dim">{sheet.identity.notes}</p>
        )}
      </div>

      <SectionLabel>Qualities</SectionLabel>
      {sheet.qualities.length === 0 && <Empty>No qualities entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.qualities.map((q) => {
          const priced = qualityDetail(q);
          const effects = [
            ...q.mods.map((m) => `${m.target} ${signed(m.value)}`),
            ...(q.note ? [q.note] : []),
          ].join(', ');
          return (
            <li key={q.name} className="flex items-start gap-2 py-2" data-type={q.type ?? 'unstated'}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{q.name}</div>
                {priced && <div className="mono-label truncate">{priced}</div>}
                {effects && <div className="mono-label truncate">{effects}</div>}
              </div>
              <RefChip refInfo={q.ref} lookup={q.name} />
            </li>
          );
        })}
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
