/**
 * Damage dialog (FR4.5): pick monitor + boxes (or derive boxes from an
 * opposed roll's net DV), preview the resulting fill/overflow/wound shift via
 * the rules engine, then commit with the `damage.apply` WS command. Negative
 * boxes heal — the one-tap undo.
 */
import { useMemo, useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { applyDamage } from '@safehouse/rules';
import { sendCommand } from './commands.js';

export interface DamageDialogProps {
  campaignId: string;
  encounterId: string;
  combatant: Combatant;
  /** Preselected track — tapping a monitor bar opens the dialog on it. */
  initialTrack?: 'physical' | 'stun';
  onClose: () => void;
}

export default function DamageDialog({
  campaignId,
  encounterId,
  combatant,
  initialTrack,
  onClose,
}: DamageDialogProps) {
  const [monitor, setMonitor] = useState<'physical' | 'stun'>(initialTrack ?? 'physical');
  const [boxes, setBoxes] = useState(1);
  const [note, setNote] = useState('');
  // "From roll" helper: modified DV − soak hits → boxes.
  const [fromDv, setFromDv] = useState(0);
  const [fromSoak, setFromSoak] = useState(0);

  const preview = useMemo(() => {
    if (boxes <= 0) return null; // healing preview would need healDamage; keep it simple
    try {
      return applyDamage(combatant.monitors, boxes, monitor);
    } catch {
      return null;
    }
  }, [combatant.monitors, monitor, boxes]);

  const commit = () => {
    if (boxes === 0) return;
    sendCommand(campaignId, {
      cmd: 'damage.apply',
      combatantId: combatant.id,
      encounterId,
      monitor,
      boxes,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    onClose();
  };

  const inputCls =
    'rounded-md border border-edge bg-deck px-2 py-1.5 text-sm outline-none focus:border-cyan-dim';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ground/80 p-4" role="dialog" aria-modal="true">
      <div className="panel w-full max-w-sm p-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Damage — {combatant.name}</h2>
          <button type="button" className="text-faint hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="mt-3 flex gap-2">
          {(['physical', 'stun'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn flex-1 ${monitor === m ? 'btn-accent' : ''}`}
              onClick={() => setMonitor(m)}
            >
              {m === 'physical' ? 'Physical' : 'Stun'}
            </button>
          ))}
        </div>

        <label className="mt-3 flex items-center gap-2">
          <span className="mono-label w-16">Boxes</span>
          <input
            type="number"
            min={-30}
            max={30}
            value={boxes}
            onChange={(e) => setBoxes(Math.trunc(Number(e.target.value) || 0))}
            className={`${inputCls} w-20 font-label text-lg`}
          />
          <span className="text-xs text-faint">negative heals</span>
        </label>

        <details className="mt-3">
          <summary className="mono-label cursor-pointer text-faint hover:text-cyan">From a roll (DV − soak hits)</summary>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Mod. DV</span>
              <input type="number" min={0} value={fromDv} onChange={(e) => setFromDv(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-16`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">Soak hits</span>
              <input type="number" min={0} value={fromSoak} onChange={(e) => setFromSoak(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-16`} />
            </label>
            <button type="button" className="btn" onClick={() => setBoxes(Math.max(0, fromDv - fromSoak))}>
              = {Math.max(0, fromDv - fromSoak)}
            </button>
          </div>
        </details>

        <label className="mt-3 flex items-center gap-2">
          <span className="mono-label w-16">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} className={`${inputCls} min-w-0 flex-1`} placeholder="Ares Predator, burst" />
        </label>

        {preview && (
          <div className="mono-label mt-3 rounded border border-edge bg-deck px-3 py-2">
            → P {preview.monitors.physical.filled}/{preview.monitors.physical.max} · S{' '}
            {preview.monitors.stun.filled}/{preview.monitors.stun.max}
            {preview.monitors.overflow.filled > 0 && (
              <span className="text-danger"> · overflow {preview.monitors.overflow.filled}</span>
            )}
            <span className="ml-2 text-warn">wounds {preview.woundModifier.after}</span>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-accent" onClick={commit} disabled={boxes === 0}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
