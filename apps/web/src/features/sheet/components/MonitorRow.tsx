/**
 * One condition monitor as a tap-to-damage/heal box row (FR3.4): tap a box
 * to fill up to it, tap the last filled box to heal one. Boxes group in
 * threes — the wound-modifier steps. The label opens the size's provenance.
 */
import type { DerivedValue } from '@safehouse/contracts';
import { monitorTapTarget } from '../lib.js';
import { BreakdownButton, type OverrideApi } from './Provenance.js';

export interface MonitorRowProps {
  label: string;
  short: string;
  size: DerivedValue;
  filled: number;
  tone: 'physical' | 'stun' | 'overflow';
  onSetFilled: (filled: number) => void;
  /** Long-press the label to override the monitor size (Principle 2). */
  override?: OverrideApi;
}

const TONE: Record<MonitorRowProps['tone'], { filled: string; empty: string }> = {
  physical: { filled: 'bg-danger border-danger', empty: 'border-edge-bright' },
  stun: { filled: 'bg-warn border-warn', empty: 'border-edge-bright' },
  overflow: { filled: 'bg-magenta border-magenta', empty: 'border-edge' },
};

export default function MonitorRow({
  label,
  short,
  size,
  filled,
  tone,
  onSetFilled,
  override,
}: MonitorRowProps) {
  const max = Math.max(0, size.value);
  const boxes = Array.from({ length: max }, (_, i) => i);
  const t = TONE[tone];

  return (
    <div className="flex items-center gap-2">
      <BreakdownButton
        title={`${label} monitor`}
        value={max}
        breakdown={size.breakdown}
        {...(override ? { override } : {})}
        className="mono-label w-7 shrink-0 text-left hover:text-cyan"
      >
        {short}
      </BreakdownButton>
      <div className="flex flex-wrap items-center gap-y-1" role="group" aria-label={`${label} monitor, ${filled}/${max}`}>
        {boxes.map((i) => (
          <button
            key={i}
            type="button"
            className={`h-4.5 w-4.5 border ${i < filled ? t.filled : t.empty} ${
              (i + 1) % 3 === 0 ? 'mr-1.5' : 'mr-px'
            } rounded-[2px] active:scale-90`}
            onClick={() => onSetFilled(monitorTapTarget(filled, i))}
            aria-label={`${label} box ${i + 1}${i < filled ? ' (filled)' : ''}`}
          />
        ))}
        {max === 0 && <span className="text-xs text-faint">—</span>}
      </div>
      <span className="ml-auto shrink-0 font-label text-xs text-dim">
        {filled}/{max}
      </span>
    </div>
  );
}
