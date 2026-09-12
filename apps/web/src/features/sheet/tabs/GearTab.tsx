/**
 * Gear tab (FR3.2): carried gear with live quantity steppers, augmentations
 * with their Essence cost and injected modifiers, and the persona/deck stats
 * when the sheet carries one.
 */
import type { SheetV1 } from '@safehouse/contracts';
import { signed } from '../lib.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, RefChip, SectionLabel } from '../components/ui.js';
import AddFromBooks from '../catalogue/AddFromBooks.js';
import { withoutItem } from '../catalogue/toSheet.js';
import type { TabProps } from './shared.js';

const ASDF = ['Attack', 'Sleaze', 'Data Proc', 'Firewall'] as const;

function withGearQty(sheet: SheetV1, name: string, qty: number): SheetV1 {
  return {
    ...sheet,
    gear: sheet.gear.map((g) => (g.name === name ? { ...g, qty: Math.max(1, qty) } : g)),
  };
}

export default function GearTab({ character, derived, patchSheet, overrideFor }: TabProps) {
  const sheet = character.sheet;
  const essence = derived.attributes['ess'];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Carried</SectionLabel>
        <AddFromBooks
          characterId={character.id}
          sheet={sheet}
          patchSheet={patchSheet}
          kinds={['gear', 'ammo', 'electronics', 'vehicle', 'program']}
          derived={derived} characterName={character.name} testId="add-gear"
        />
      </div>
      {sheet.gear.length === 0 && <Empty>No gear entered — add it from the books, write your own, or import the sheet.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.gear.map((item) => (
          <li key={item.name} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{item.name}</div>
              {(item.rating !== undefined || item.note) && (
                <div className="mono-label truncate">
                  {item.rating !== undefined ? `rating ${item.rating}` : ''}
                  {item.rating !== undefined && item.note ? ' · ' : ''}
                  {item.note ?? ''}
                </div>
              )}
            </div>
            <RefChip refInfo={item.ref} lookup={item.name} />
            <button
              type="button"
              className="chip text-faint hover:border-danger hover:text-danger"
              onClick={() => patchSheet(withoutItem(sheet, 'gear', item.name))}
              aria-label={`remove ${item.name}`}
              title="Removes it — History can put it back"
            >
              ×
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="chip text-dim hover:border-cyan hover:text-cyan disabled:opacity-40"
                disabled={item.qty <= 1}
                onClick={() => patchSheet(withGearQty(sheet, item.name, item.qty - 1))}
                aria-label={`one fewer ${item.name}`}
              >
                −
              </button>
              <span className="w-7 text-center font-label text-sm text-ink">×{item.qty}</span>
              <button
                type="button"
                className="chip text-dim hover:border-cyan hover:text-cyan"
                onClick={() => patchSheet(withGearQty(sheet, item.name, item.qty + 1))}
                aria-label={`one more ${item.name}`}
              >
                +
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Augmentations</SectionLabel>
        <AddFromBooks characterId={character.id} sheet={sheet} patchSheet={patchSheet} kinds={['augmentation']} derived={derived} characterName={character.name} testId="add-augment" />
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="mono-label">Essence</span>
        {essence && (
          <BreakdownButton
            title="Essence"
            value={essence.value}
            breakdown={essence.breakdown}
            override={overrideFor('attr.ess')}
          />
        )}
      </div>
      {sheet.augments.length === 0 && <Empty>No augmentations entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.augments.map((aug) => (
          <li key={aug.name} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{aug.name}</div>
              <div className="mono-label truncate">
                {aug.essence > 0 ? `−${aug.essence} ess` : 'no essence cost'}
                {aug.mods.length > 0
                  ? ` · ${aug.mods.map((m) => `${m.target} ${signed(m.value)}`).join(', ')}`
                  : ''}
              </div>
            </div>
            <RefChip refInfo={aug.ref} lookup={aug.name} />
            <button
              type="button"
              className="chip text-faint hover:border-danger hover:text-danger"
              onClick={() => patchSheet(withoutItem(sheet, 'augments', aug.name))}
              aria-label={`remove ${aug.name}`}
              title="Removes it — History can put it back"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {sheet.matrix.deck && (
        <>
          <SectionLabel>Persona — {sheet.matrix.deck.name}</SectionLabel>
          <div className="grid grid-cols-4 gap-1.5">
            {ASDF.map((label, i) => (
              <div key={label} className="panel flex flex-col items-center gap-0.5 py-2">
                <span className="mono-label">{label}</span>
                <span className="font-label text-lg text-ink">
                  {sheet.matrix.deck?.asdf[i] ?? 0}
                </span>
              </div>
            ))}
          </div>
          {sheet.matrix.deck.programs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sheet.matrix.deck.programs.map((p) => (
                <span key={p} className="chip text-dim">
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
