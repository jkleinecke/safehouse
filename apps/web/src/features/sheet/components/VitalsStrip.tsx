/**
 * Limits, initiative variants and movement (FR3.3) as a horizontally
 * scrollable strip of tappable numbers — each expands to its provenance and
 * accepts an override (Principles 2 + 3).
 */
import { useState } from 'react';
import type { DerivedCharacter, DerivedValue } from '@safehouse/contracts';
import { initiativeLabel, limitCellLabel, movementLabel } from '../a11y.js';
import { BreakdownButton, type OverrideApi } from './Provenance.js';

export interface VitalsStripProps {
  derived: DerivedCharacter;
  overrideFor: (target: string) => OverrideApi;
}

/** `label` is the two-character chip; `spoken` is what a screen reader says. */
const INIT_LINES = [
  { key: 'physical', label: 'Init', spoken: 'Physical' },
  { key: 'astral', label: 'Astral', spoken: 'Astral' },
  { key: 'matrixAR', label: 'AR', spoken: 'Matrix augmented reality' },
  { key: 'vrCold', label: 'VR cold', spoken: 'Cold-sim VR' },
  { key: 'vrHot', label: 'VR hot', spoken: 'Hot-sim VR' },
] as const;

function Cell({
  label,
  spoken,
  value,
  breakdown,
  override,
  suffix,
}: {
  label: string;
  /** The full name the reader announces — "P limit" tells nobody anything. */
  spoken: string;
  value: number;
  breakdown: DerivedValue['breakdown'];
  override?: OverrideApi;
  suffix?: string;
}) {
  return (
    <BreakdownButton
      title={spoken}
      value={value}
      breakdown={breakdown}
      {...(override ? { override } : {})}
      className="panel flex shrink-0 flex-col items-center gap-0.5 px-3 py-1.5"
    >
      <span className="mono-label" aria-hidden>
        {label}
      </span>
      <span className="font-label text-sm text-ink" aria-hidden>
        {value}
        {suffix ?? ''}
      </span>
    </BreakdownButton>
  );
}

export default function VitalsStrip({ derived, overrideFor }: VitalsStripProps) {
  const [showAllInit, setShowAllInit] = useState(false);
  const lines = showAllInit ? INIT_LINES : INIT_LINES.slice(0, 1);

  return (
    <div
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
      role="group"
      aria-label="Limits, initiative and movement"
    >
      <Cell
        label="P limit"
        spoken={limitCellLabel('Physical limit', derived.limits.physical.value)}
        value={derived.limits.physical.value}
        breakdown={derived.limits.physical.breakdown}
        override={overrideFor('limit.physical')}
      />
      <Cell
        label="M limit"
        spoken={limitCellLabel('Mental limit', derived.limits.mental.value)}
        value={derived.limits.mental.value}
        breakdown={derived.limits.mental.breakdown}
        override={overrideFor('limit.mental')}
      />
      <Cell
        label="S limit"
        spoken={limitCellLabel('Social limit', derived.limits.social.value)}
        value={derived.limits.social.value}
        breakdown={derived.limits.social.breakdown}
        override={overrideFor('limit.social')}
      />

      {lines.map((line) => {
        const init = derived.initiative[line.key];
        return (
          <Cell
            key={line.key}
            label={line.label}
            spoken={initiativeLabel(line.spoken, init.base.value, init.dice.value)}
            value={init.base.value}
            breakdown={[...init.base.breakdown, ...init.dice.breakdown]}
            override={overrideFor(`initiative.${line.key}.score`)}
            suffix={`+${init.dice.value}d6`}
          />
        );
      })}
      {!showAllInit && (
        <button
          type="button"
          className="chip shrink-0 text-faint hover:border-cyan hover:text-cyan"
          onClick={() => setShowAllInit(true)}
          aria-label="Show astral and Matrix initiative variants"
        >
          +4
        </button>
      )}

      <Cell
        label="Walk"
        spoken={movementLabel('Walk', derived.movement.walk.value)}
        value={derived.movement.walk.value}
        breakdown={derived.movement.walk.breakdown}
        override={overrideFor('movement.walk')}
        suffix="m"
      />
      <Cell
        label="Run"
        spoken={movementLabel('Run', derived.movement.run.value)}
        value={derived.movement.run.value}
        breakdown={derived.movement.run.breakdown}
        override={overrideFor('movement.run')}
        suffix="m"
      />
    </div>
  );
}
