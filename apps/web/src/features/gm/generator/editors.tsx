/**
 * Small generic editors for the archetype template form (FR10.1):
 * tag input, {key → min/max} range maps, {key → weight} maps, loadout slots.
 */
import { useState } from 'react';
import type { LoadoutSlot, NumRange } from '@safehouse/contracts';
import { inputClass } from '../ui.js';

export function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          className="chip cursor-pointer text-dim hover:text-danger"
          onClick={() => onChange(tags.filter((x) => x !== t))}
          title="Remove"
        >
          {t} ×
        </button>
      ))}
      <input
        className={`${inputClass} w-36`}
        value={draft}
        placeholder={placeholder ?? 'add…'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function numOr(v: string, fallback: number): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Rows of key → { min, max } (tier attribute/skill sampling ranges). */
export function RangeMapEditor({
  entries,
  onChange,
  keyLabel,
  addPlaceholder,
}: {
  entries: Record<string, NumRange>;
  onChange: (entries: Record<string, NumRange>) => void;
  keyLabel: string;
  addPlaceholder?: string;
}) {
  const [newKey, setNewKey] = useState('');
  const set = (key: string, range: NumRange) => onChange({ ...entries, [key]: range });
  const remove = (key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {Object.entries(entries).map(([key, range]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="mono-label w-24 truncate" title={key}>{key}</span>
          <input
            type="number"
            className={`${inputClass} w-16`}
            value={range.min}
            aria-label={`${key} min`}
            onChange={(e) => set(key, { ...range, min: numOr(e.target.value, range.min) })}
          />
          <span className="text-faint">–</span>
          <input
            type="number"
            className={`${inputClass} w-16`}
            value={range.max}
            aria-label={`${key} max`}
            onChange={(e) => set(key, { ...range, max: numOr(e.target.value, range.max) })}
          />
          <button type="button" className="btn px-2 py-1 text-danger" onClick={() => remove(key)}>
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          className={`${inputClass} w-24`}
          value={newKey}
          placeholder={addPlaceholder ?? keyLabel}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button
          type="button"
          className="btn px-2.5 py-1"
          onClick={() => {
            const k = newKey.trim();
            if (k && !(k in entries)) set(k, { min: 2, max: 4 });
            setNewKey('');
          }}
        >
          + {keyLabel}
        </button>
      </div>
    </div>
  );
}

/** Rows of key → weight (metatype weights). */
export function WeightMapEditor({
  entries,
  onChange,
}: {
  entries: Record<string, number>;
  onChange: (entries: Record<string, number>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  return (
    <div className="space-y-1.5">
      {Object.entries(entries).map(([key, weight]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="mono-label w-24 truncate">{key}</span>
          <input
            type="number"
            min={0}
            className={`${inputClass} w-20`}
            value={weight}
            aria-label={`${key} weight`}
            onChange={(e) => onChange({ ...entries, [key]: Math.max(0, Number(e.target.value) || 0) })}
          />
          <button
            type="button"
            className="btn px-2 py-1 text-danger"
            onClick={() => {
              const next = { ...entries };
              delete next[key];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          className={`${inputClass} w-24`}
          value={newKey}
          placeholder="metatype"
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button
          type="button"
          className="btn px-2.5 py-1"
          onClick={() => {
            const k = newKey.trim().toLowerCase();
            if (k && !(k in entries)) onChange({ ...entries, [k]: 1 });
            setNewKey('');
          }}
        >
          + metatype
        </button>
      </div>
    </div>
  );
}

/** Loadout slots: slot name + candidate options (the GM's own gear records). */
export function LoadoutEditor({
  slots,
  onChange,
}: {
  slots: LoadoutSlot[];
  onChange: (slots: LoadoutSlot[]) => void;
}) {
  const setSlot = (i: number, slot: LoadoutSlot) =>
    onChange(slots.map((s, j) => (j === i ? slot : s)));
  return (
    <div className="space-y-2">
      {slots.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} w-32`}
            value={slot.slot}
            aria-label="Slot name"
            onChange={(e) => setSlot(i, { ...slot, slot: e.target.value })}
          />
          <input
            className={`${inputClass} min-w-40 flex-1`}
            value={slot.options.join(', ')}
            placeholder="options, comma-separated (your own gear records)"
            aria-label="Slot options"
            onChange={(e) =>
              setSlot(i, {
                ...slot,
                options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
          />
          <button
            type="button"
            className="btn px-2 py-1 text-danger"
            onClick={() => onChange(slots.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn px-2.5 py-1"
        onClick={() => onChange([...slots, { slot: `slot-${slots.length + 1}`, options: [] }])}
      >
        + loadout slot
      </button>
    </div>
  );
}
