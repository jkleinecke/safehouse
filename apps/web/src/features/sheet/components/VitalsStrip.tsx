/**
 * Limits, initiative variants and movement (FR3.3) as a horizontally
 * scrollable strip of tappable numbers — each expands to its provenance and
 * accepts an override (Principles 2 + 3).
 */
import { useState } from 'react';
import type { DerivedCharacter, DerivedValue } from '@safehouse/contracts';
import { BreakdownButton, type OverrideApi } from './Provenance.js';

export interface VitalsStripProps {
  derived: DerivedCharacter;
  overrideFor: (target: string) => OverrideApi;
}

const INIT_LINES = [
  { key: 'physical', label: 'Init' },
  { key: 'astral', label: 'Astral' },
  { key: 'matrixAR', label: 'AR' },
  { key: 'vrCold', label: 'VR cold' },
  { key: 'vrHot', label: 'VR hot' },
] as const;

function Cell({
  label,
  value,
  breakdown,
  override,
  suffix,
}: {
  label: string;
  value: number;
  breakdown: DerivedValue['breakdown'];
  override?: OverrideApi;
  suffix?: string;
}) {
  return (
    <BreakdownButton
      title={label}
      value={value}
      breakdown={breakdown}
      {...(override ? { override } : {})}
      className="panel flex shrink-0 flex-col items-center gap-0.5 px-3 py-1.5"
    >
      <span className="mono-label">{label}</span>
      <span className="font-label text-sm text-ink">
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
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      <Cell
        label="P limit"
        value={derived.limits.physical.value}
        breakdown={derived.limits.physical.breakdown}
        override={overrideFor('limit.physical')}
      />
      <Cell
        label="M limit"
        value={derived.limits.mental.value}
        breakdown={derived.limits.mental.breakdown}
        override={overrideFor('limit.mental')}
      />
      <Cell
        label="S limit"
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
          title="Astral / Matrix initiative variants (FR4.2)"
        >
          +4
        </button>
      )}

      <Cell
        label="Walk"
        value={derived.movement.walk.value}
        breakdown={derived.movement.walk.breakdown}
        override={overrideFor('movement.walk')}
        suffix="m"
      />
      <Cell
        label="Run"
        value={derived.movement.run.value}
        breakdown={derived.movement.run.breakdown}
        override={overrideFor('movement.run')}
        suffix="m"
      />
    </div>
  );
}
