/**
 * Condition monitors on a tracker row (FR4.5/4.9). The GM and a row's owner
 * read exact boxes; everyone else gets the coarse public band — no numbers.
 */
import type { CombatantMonitors } from '@safehouse/contracts';
import { CONDITION_LABEL, conditionBand, type MonitorDetail } from './initiative.js';

export interface MonitorBarProps {
  monitors: CombatantMonitors;
  detail: MonitorDetail;
  /** GM-only affordance: tap a track to open the damage dialog on it. */
  onPick?: (track: 'physical' | 'stun') => void;
}

const BAND_CLASS: Record<string, string> = {
  fresh: 'border-edge text-dim',
  scratched: 'border-edge-bright text-dim',
  wounded: 'border-warn/50 text-warn',
  bloodied: 'border-danger/60 text-danger',
  down: 'border-danger bg-danger/15 font-bold text-danger',
};

function Track({
  label,
  filled,
  max,
  tone,
  onPick,
}: {
  label: string;
  filled: number;
  max: number;
  tone: 'physical' | 'stun';
  onPick?: () => void;
}) {
  const boxes = Math.min(max, 24);
  const fillClass = tone === 'physical' ? 'bg-danger' : 'bg-warn';
  const body = (
    <>
      <span className="mono-label w-3 shrink-0 text-faint">{label}</span>
      <span className="flex flex-wrap gap-[2px]">
        {Array.from({ length: boxes }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2 rounded-[1px] border border-edge ${i < filled ? fillClass : 'bg-deck'}`}
          />
        ))}
      </span>
      <span className="mono-label shrink-0 tabular-nums">
        {filled}/{max}
      </span>
    </>
  );

  if (!onPick) return <div className="flex items-center gap-1.5">{body}</div>;
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded px-0.5 hover:bg-raised"
      onClick={onPick}
      title={`Apply ${tone} damage`}
    >
      {body}
    </button>
  );
}

export default function MonitorBar({ monitors, detail, onPick }: MonitorBarProps) {
  if (detail === 'none') return null;

  if (detail === 'coarse') {
    const band = conditionBand(monitors);
    return (
      <span className={`chip ${BAND_CLASS[band] ?? 'border-edge text-dim'}`}>
        {CONDITION_LABEL[band]}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Track
        label="P"
        filled={monitors.physical.filled}
        max={monitors.physical.max}
        tone="physical"
        {...(onPick ? { onPick: () => onPick('physical') } : {})}
      />
      <Track
        label="S"
        filled={monitors.stun.filled}
        max={monitors.stun.max}
        tone="stun"
        {...(onPick ? { onPick: () => onPick('stun') } : {})}
      />
      {monitors.overflow.filled > 0 && (
        <span className="mono-label text-danger">
          overflow {monitors.overflow.filled}/{monitors.overflow.max}
        </span>
      )}
    </div>
  );
}
