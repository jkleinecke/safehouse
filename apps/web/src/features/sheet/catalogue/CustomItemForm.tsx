/**
 * Write your own — an item that is in no table, or in no book: house gear,
 * a custom weapon, a spell the GM invented. The fields are the ones the sheet
 * keeps for that kind, in the player's own words (§14); a page is optional.
 * It lands through the same mapping a row from the books does (`customHit`).
 */
import { useState } from 'react';
import { KIND_LABEL, type CatalogueKind } from './api.js';
import { customHit, type CatalogueHit } from './toSheet.js';

export interface CustomItemFormProps {
  kinds: readonly CatalogueKind[];
  /** Which kind the form opens on. */
  kind: CatalogueKind;
  onKind: (k: CatalogueKind) => void;
  onAdd: (hit: CatalogueHit) => void;
  /** Take it through the Availability test and a negotiated price instead of adding outright. */
  onFind?: ((hit: CatalogueHit) => void) | undefined;
  testId: string;
}

const inputClass = 'w-full rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none';

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  /** Written into `stats` under this key; the sheet mapping reads it. */
  stat?: string;
  wide?: boolean;
}

/** The fields each kind asks for, beyond the name. */
export function fieldsFor(kind: CatalogueKind): FieldDef[] {
  switch (kind) {
    case 'weapon':
      return [
        { key: 'category', label: 'Table', placeholder: 'heavy pistols, blades…', wide: true },
        { key: 'acc', label: 'Accuracy', placeholder: '5', stat: 'ACC' },
        { key: 'dv', label: 'Damage', placeholder: '8P', stat: 'DAMAGE' },
        { key: 'ap', label: 'AP', placeholder: '-1', stat: 'AP' },
        { key: 'mode', label: 'Modes', placeholder: 'SA / BF', stat: 'MODE' },
        { key: 'rc', label: 'RC', placeholder: '1', stat: 'RC' },
        { key: 'ammo', label: 'Ammo', placeholder: '15 (c)', stat: 'AMMO' },
      ];
    case 'armor':
      return [{ key: 'rating', label: 'Armor rating', placeholder: '12', stat: 'ARMOR RATING' }];
    case 'augmentation':
      return [
        { key: 'essence', label: 'Essence', placeholder: '0.2', stat: 'ESSENCE' },
        { key: 'rating', label: 'Rating', placeholder: '', stat: 'RATING' },
        { key: 'capacity', label: 'Capacity', placeholder: '[1]', stat: 'CAPACITY' },
      ];
    case 'spell':
      return [
        { key: 'category', label: 'Category', placeholder: 'combat, detection…' },
        { key: 'drain', label: 'Drain', placeholder: 'F-3', stat: 'DRAIN' },
        { key: 'type', label: 'Type', placeholder: 'P or M', stat: 'TYPE' },
        { key: 'range', label: 'Range', placeholder: 'LOS', stat: 'RANGE' },
        { key: 'duration', label: 'Duration', placeholder: 'I, S or P', stat: 'DURATION' },
      ];
    case 'power':
      return [
        { key: 'cost', label: 'PP cost', placeholder: '0.5', stat: 'COST' },
        { key: 'activation', label: 'Activation', placeholder: 'Free Action', stat: 'ACTIVATION' },
      ];
    case 'complex_form':
      return [
        { key: 'target', label: 'Target', placeholder: 'Device', stat: 'TARGET' },
        { key: 'fv', label: 'Fading', placeholder: 'L+1', stat: 'FV' },
        { key: 'duration', label: 'Duration', placeholder: 'S', stat: 'DURATION' },
      ];
    case 'quality':
      return [
        { key: 'karma', label: 'Karma', placeholder: '5', stat: 'KARMA' },
        { key: 'type', label: 'Positive or negative', placeholder: 'positive', stat: 'TYPE' },
      ];
    default:
      return [{ key: 'rating', label: 'Rating', placeholder: '', stat: 'RATING' }];
  }
}

export default function CustomItemForm({ kinds, kind, onKind, onAdd, onFind, testId }: CustomItemFormProps) {
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [cost, setCost] = useState('');
  const [avail, setAvail] = useState('');
  const [book, setBook] = useState('');
  const [page, setPage] = useState('');
  const fields = fieldsFor(kind);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const ready = name.trim().length > 0;

  const build = () => {
    const stats: Record<string, string> = {};
    for (const f of fields) if (f.stat && values[f.key]) stats[f.stat] = values[f.key]!;
    const category = kind === 'spell' ? `${(values['category'] ?? '').trim()} spells`.trim() : (values['category'] ?? '');
    const priced = Number(cost.replace(/[,¥\s]/g, ''));
    return customHit({
      kind,
      name,
      category: kind === 'spell' && !values['category'] ? '' : category,
      stats,
      avail,
      cost: Number.isFinite(priced) && priced > 0 ? priced : null,
      ref: book.trim() && Number(page) >= 1 ? { book: book.trim(), page: Number(page) } : null,
    });
  };
  const reset = () => {
    setName('');
    setValues({});
    setCost('');
    setAvail('');
  };
  const submit = () => {
    if (!ready) return;
    onAdd(build());
    reset();
  };

  return (
    <form
      className="mt-2 rounded-md border border-edge bg-deck/60 p-3"
      data-testid={`${testId}-custom`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mono-label text-cyan">Write your own</span>
        <span className="mono-label text-faint">not in the books, or not in a table — your words, a page if you have one</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="col-span-2 block">
          <span className="mono-label block">Name</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Item name" data-testid={`${testId}-custom-name`} />
        </label>
        {kinds.length > 1 && (
          <label className="block">
            <span className="mono-label block">Kind</span>
            <select className={inputClass} value={kind} onChange={(e) => onKind(e.target.value as CatalogueKind)} aria-label="Item kind">
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.map((f) => (
          <label key={f.key} className={`block ${f.wide ? 'col-span-2' : ''}`}>
            <span className="mono-label block">{f.label}</span>
            <input
              className={inputClass}
              value={values[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              aria-label={f.label}
              data-testid={`${testId}-custom-${f.key}`}
            />
          </label>
        ))}
        <label className="block">
          <span className="mono-label block">Cost ¥</span>
          <input className={inputClass} inputMode="numeric" value={cost} placeholder="725" onChange={(e) => setCost(e.target.value)} aria-label="Cost in nuyen" data-testid={`${testId}-custom-cost`} />
        </label>
        <label className="block">
          <span className="mono-label block">Availability</span>
          <input className={inputClass} value={avail} placeholder="5R" onChange={(e) => setAvail(e.target.value)} aria-label="Availability" />
        </label>
        <label className="block">
          <span className="mono-label block">Book · page</span>
          <span className="flex gap-1">
            <input className={`${inputClass} w-16`} value={book} placeholder="SR5" onChange={(e) => setBook(e.target.value)} aria-label="Book code" />
            <input className={`${inputClass} w-16`} inputMode="numeric" value={page} placeholder="426" onChange={(e) => setPage(e.target.value)} aria-label="Printed page" />
          </span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-accent px-3 py-1.5" disabled={!ready} data-testid={`${testId}-custom-add`}>
          add {name.trim() || 'it'} to the sheet
        </button>
        {onFind && (
          <button
            type="button"
            className="btn px-3 py-1.5"
            disabled={!ready}
            onClick={() => {
              onFind(build());
              reset();
            }}
            data-testid={`${testId}-custom-find`}
          >
            find &amp; negotiate
          </button>
        )}
      </div>
    </form>
  );
}
