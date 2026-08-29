/**
 * Pinned identity/condition strip (FR3.2): alias + metatype, tap-to-damage
 * monitors with the wound-modifier badge, current Edge with spend/burn.
 * Sticky under the campaign header on the phone.
 */
import type { DerivedCharacter } from '@safehouse/contracts';
import { woundModifierFor } from '@safehouse/rules';
import { clampFill, signed, type ConditionState, type EdgeOp } from '../lib.js';
import type { CharacterRecord } from '../api.js';
import EdgeControl, { type EdgeActionsApi } from './EdgeControl.js';
import MonitorRow from './MonitorRow.js';
import type { OverrideApi } from './Provenance.js';

export interface IdentityStripProps {
  character: CharacterRecord;
  derived: DerivedCharacter;
  onCondition: (next: ConditionState) => void;
  onEdgeOp: (op: EdgeOp) => void;
  overrideFor: (target: string) => OverrideApi;
  busy?: boolean;
  /** Seize the Initiative / Blitz, offered only while in a live encounter. */
  edgeActions?: EdgeActionsApi;
}

export default function IdentityStrip({
  character,
  derived,
  onCondition,
  onEdgeOp,
  overrideFor,
  busy,
  edgeActions,
}: IdentityStripProps) {
  const { sheet, condition } = character;
  const physMax = Math.max(0, derived.monitors.physical.value);
  const overMax = Math.max(0, derived.monitors.overflow.value);

  const physFilled = clampFill(Math.min(condition.physical, physMax), physMax);
  const overflowFilled = clampFill(condition.physical - physMax, overMax);
  const stunFilled = clampFill(condition.stun, Math.max(0, derived.monitors.stun.value));

  // Wound modifier from capped monitor fills (overflow doesn't deepen it).
  const wound =
    derived.woundModifier?.value ?? woundModifierFor({ physical: physFilled, stun: stunFilled });

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
          {sheet.identity.alias || character.name}
        </h2>
        <span className="mono-label">{sheet.identity.metatype}</span>
        <span
          className={`chip ${wound < 0 ? 'border-danger/60 text-danger' : 'text-faint'}`}
          aria-label={`Wound modifier ${signed(wound)}, applied to pools and initiative`}
        >
          <span aria-hidden>wounds {signed(wound)}</span>
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        <MonitorRow
          label="Physical"
          short="PHY"
          size={derived.monitors.physical}
          filled={physFilled}
          tone="physical"
          override={overrideFor('monitor.physical')}
          onSetFilled={(f) => onCondition({ ...condition, physical: f })}
        />
        {(overflowFilled > 0 || physFilled >= physMax) && physMax > 0 && (
          <MonitorRow
            label="Overflow"
            short="OVR"
            size={derived.monitors.overflow}
            filled={overflowFilled}
            tone="overflow"
            override={overrideFor('monitor.overflow')}
            onSetFilled={(f) => onCondition({ ...condition, physical: physMax + f })}
          />
        )}
        <MonitorRow
          label="Stun"
          short="STN"
          size={derived.monitors.stun}
          filled={stunFilled}
          tone="stun"
          override={overrideFor('monitor.stun')}
          onSetFilled={(f) => onCondition({ ...condition, stun: f })}
        />
        <EdgeControl
          edge={sheet.attributes.edg}
          burned={character.edgeBurned}
          onOp={onEdgeOp}
          busy={busy}
          {...(edgeActions ? { actions: edgeActions } : {})}
        />
      </div>
    </div>
  );
}
