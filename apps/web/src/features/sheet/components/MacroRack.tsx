/**
 * Personal dice macros on the sheet (FR2.8) — the recurring free-form rolls a
 * player keeps reaching for ("Composure 8", "Sneak 11, physical limit 5").
 *
 * They are stored per USER, not per device (see `../macroStore.ts`), so
 * picking up a second phone mid-session brings the rack with you. When the
 * server has no macro route yet the rack still works off the local mirror and
 * says so, quietly, rather than pretending to have synced.
 */
import { useState } from 'react';
import type { LimitKind } from '@safehouse/contracts';
import { MACRO_LIMIT, macroRollConfig, newMacroId, withMacro, withoutMacro, type DiceMacro } from '../macroStore.js';
import type { RollConfig } from '../rollDialogState.js';
import { Empty, SectionLabel, Sheet } from './ui.js';

const LIMIT_KINDS: LimitKind[] = ['physical', 'mental', 'social', 'accuracy', 'force'];

export interface MacroRackProps {
  macros: readonly DiceMacro[];
  /** False when the macros live only on this device (route not up yet). */
  synced: boolean;
  busy?: boolean;
  onSave: (macros: DiceMacro[]) => void;
  onRoll: (config: RollConfig) => void;
}

function describe(macro: DiceMacro): string {
  const limit =
    macro.limitKind && typeof macro.limitValue === 'number'
      ? `, ${macro.limitKind} limit ${macro.limitValue}`
      : '';
  return `Roll ${macro.name}, ${macro.pool} dice${limit}`;
}

export default function MacroRack({ macros, synced, busy, onSave, onRoll }: MacroRackProps) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <SectionLabel>
        Macros{synced ? '' : ' — this device only'}
      </SectionLabel>
      {macros.length === 0 && <Empty>No macros yet. Build one for the roll you keep making.</Empty>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Personal dice macros">
        {macros.map((macro) => (
          <span key={macro.id} className="inline-flex items-center">
            <button
              type="button"
              className="chip border-cyan-dim text-cyan"
              onClick={() => onRoll(macroRollConfig(macro))}
              aria-label={describe(macro)}
            >
              {macro.name} {macro.pool}
            </button>
            <button
              type="button"
              className="ml-0.5 text-xs text-faint hover:text-danger disabled:opacity-40"
              disabled={busy}
              onClick={() => onSave(withoutMacro(macros, macro.id))}
              aria-label={`Delete the ${macro.name} macro`}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          className="chip text-dim hover:border-cyan hover:text-cyan disabled:opacity-40"
          disabled={macros.length >= MACRO_LIMIT || busy}
          onClick={() => setEditing(true)}
          aria-label="Add a dice macro"
        >
          + macro
        </button>
      </div>

      {editing && (
        <MacroEditor
          onClose={() => setEditing(false)}
          onCreate={(macro) => {
            onSave(withMacro(macros, macro));
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function MacroEditor({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (macro: DiceMacro) => void;
}) {
  const [name, setName] = useState('');
  const [pool, setPool] = useState('');
  const [limitKind, setLimitKind] = useState<LimitKind | ''>('');
  const [limitValue, setLimitValue] = useState('');

  const dice = Number(pool);
  const valid = name.trim() !== '' && pool.trim() !== '' && Number.isFinite(dice) && dice > 0;
  const limitNum = Number(limitValue);
  const hasLimit = limitKind !== '' && limitValue.trim() !== '' && Number.isFinite(limitNum);

  return (
    <Sheet open onClose={onClose} title="New macro">
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-edge-bright bg-ground px-2 py-1.5 text-sm text-ink"
          placeholder="what is it called?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Macro name"
          autoFocus
        />
        <input
          className="w-20 rounded border border-edge-bright bg-ground px-2 py-1.5 font-label text-sm text-ink"
          inputMode="numeric"
          placeholder="dice"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          aria-label="Dice pool"
        />
      </div>

      <div className="mt-3">
        <div className="mono-label mb-1.5" id="macro-limit">
          Limit (optional)
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="macro-limit">
          {LIMIT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={limitKind === kind}
              className={`chip ${limitKind === kind ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => setLimitKind((k) => (k === kind ? '' : kind))}
            >
              {kind}
            </button>
          ))}
          <input
            className="w-16 rounded border border-edge bg-ground px-2 py-1 font-label text-xs text-ink"
            inputMode="numeric"
            placeholder="value"
            value={limitValue}
            onChange={(e) => setLimitValue(e.target.value)}
            aria-label="Limit value"
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-accent mt-4 w-full py-3 text-sm"
        disabled={!valid}
        onClick={() =>
          onCreate({
            id: newMacroId(),
            name: name.trim(),
            pool: Math.floor(dice),
            ...(hasLimit ? { limitKind, limitValue: Math.floor(limitNum) } : {}),
          })
        }
      >
        Save macro
      </button>
      <p className="mt-2 text-xs text-faint">
        Macros are free-form rolls (FR2.8): the server takes the pool as given —
        there is no sheet pool to check them against.
      </p>
    </Sheet>
  );
}
