/**
 * Closing half of the FR8.1 casting flow: after the linked Drain roll goes to
 * the table, unresisted Drain lands on the caster's monitor **on confirm**.
 * Hits prefill from the matching `roll.created` event when one arrives; the
 * number stays editable either way (Principle 2).
 */
import { useMemo, useState } from 'react';
import { useLiveStore } from '../../../live/store.js';
import { drainHitsFromEvents, type ConditionState } from '../lib.js';

export interface PendingDrain {
  spell: string;
  dv: number;
  /** Force exceeded Magic → the boxes are Physical, not Stun (FR8.1). */
  physical: boolean;
  /** Cast timestamp — keys the panel so a re-cast starts with a clean field. */
  at: number;
}

export default function DrainApplyPanel({
  pending,
  condition,
  onApply,
  onDismiss,
}: {
  pending: PendingDrain;
  condition: ConditionState;
  onApply: (next: ConditionState) => void;
  onDismiss: () => void;
}) {
  const events = useLiveStore((s) => s.events);
  const rolled = useMemo(() => drainHitsFromEvents(events, pending.spell), [events, pending.spell]);
  const [edited, setEdited] = useState<string | null>(null);

  const hitsText = edited ?? (rolled === null ? '' : String(rolled));
  const hits = Number(hitsText);
  const valid = hitsText.trim() !== '' && Number.isFinite(hits) && hits >= 0;
  const boxes = valid ? Math.max(0, pending.dv - Math.floor(hits)) : pending.dv;

  return (
    <div className="panel mt-3 border-magenta-dim p-3">
      <div className="mono-label text-magenta">Drain — {pending.spell}</div>
      <p className="mt-1 text-xs text-dim">
        Resisting {pending.dv} {pending.physical ? 'Physical' : 'Stun'}.
        {rolled === null
          ? ' Enter the hits your drain roll scored.'
          : ' Hits picked up from the table log.'}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <input
          className="w-16 rounded border border-edge-bright bg-ground px-2 py-1.5 font-label text-sm text-ink"
          inputMode="numeric"
          placeholder="hits"
          value={hitsText}
          onChange={(e) => setEdited(e.target.value)}
          aria-label="Drain resistance hits"
        />
        <span className="font-label text-sm text-ink">
          → {boxes} {pending.physical ? 'P' : 'S'} box{boxes === 1 ? '' : 'es'}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button type="button" className="chip text-dim" onClick={onDismiss}>
            Dismiss
          </button>
          <button
            type="button"
            className="chip border-magenta text-magenta disabled:opacity-40"
            disabled={boxes <= 0}
            onClick={() =>
              onApply(
                pending.physical
                  ? { ...condition, physical: condition.physical + boxes }
                  : { ...condition, stun: condition.stun + boxes },
              )
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
