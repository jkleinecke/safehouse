/**
 * The spirit tracker (FR8.3) — Force, services, bound/unbound, and the three
 * things a summoner actually does at the table: spend a service, dismiss it,
 * and send it into the fight.
 *
 * Presentational on purpose: every action is a callback, so the list renders
 * from a hydrated view in a test with no network and no DOM behind it.
 */
import { useState } from 'react';
import { spendServiceLabel, spiritIsInFight, spiritSummaryLabel } from './lib.js';
import type { SpiritRow } from './types.js';
import { Empty, SectionLabel, Sheet, Stepper } from '../components/ui.js';

export interface SpiritActions {
  onSpendService: (spiritId: string) => void;
  onSetBound: (spiritId: string, bound: boolean) => void;
  onDismiss: (spiritId: string) => void;
  onJoin: (spiritId: string, encounterId: string) => void;
  onSummon: (input: { spiritType: string; force: number; services: number; bound: boolean }) => void;
}

export interface SpiritListProps extends SpiritActions {
  spirits: SpiritRow[];
  /** The fight a spirit can be sent into; null when none is running. */
  encounterId: string | null;
  encounterName: string | null;
  /** False when this device may not place figures on the tracker (GM-only). */
  canPlaceOnTracker: boolean;
  busy?: boolean;
  error?: string | null;
}

export default function SpiritList(props: SpiritListProps) {
  const [summoning, setSummoning] = useState(false);
  const live = props.spirits.filter((s) => s.status === 'summoned');
  const gone = props.spirits.filter((s) => s.status === 'dismissed');

  return (
    <>
      <SectionLabel>
        Spirits — {live.length} summoned
        {gone.length > 0 ? `, ${gone.length} released` : ''}
      </SectionLabel>

      {live.length === 0 && <Empty>Nothing summoned. The astral is quiet.</Empty>}

      <ul className="divide-y divide-edge/60">
        {live.map((spirit) => (
          <SpiritRowView key={spirit.id} spirit={spirit} {...props} />
        ))}
      </ul>

      {props.error && (
        <p className="mt-2 text-xs text-magenta" role="status">
          {props.error}
        </p>
      )}

      <button
        type="button"
        className="btn mt-3 w-full py-2.5 text-sm"
        onClick={() => setSummoning(true)}
        aria-label="Summon a spirit"
      >
        + Summon
      </button>

      {summoning && (
        <SummonDialog
          onClose={() => setSummoning(false)}
          onSummon={(input) => {
            props.onSummon(input);
            setSummoning(false);
          }}
        />
      )}
    </>
  );
}

function SpiritRowView({
  spirit,
  encounterId,
  encounterName,
  canPlaceOnTracker,
  busy,
  onSpendService,
  onSetBound,
  onDismiss,
  onJoin,
}: { spirit: SpiritRow } & SpiritListProps) {
  const inFight = spiritIsInFight(spirit, encounterId);
  const exhausted = spirit.services <= 0;

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">{spirit.name}</div>
          <div className="mono-label">
            {spirit.spiritType} · Force {spirit.force} · {spirit.bound ? 'bound' : 'unbound'}
            {spirit.sustainingSpellId ? ' · holding a spell' : ''}
            {inFight ? ' · in the fight' : ''}
          </div>
        </div>
        <span
          className={`chip shrink-0 ${exhausted ? 'text-faint' : 'border-cyan-dim text-cyan'}`}
          aria-label={spiritSummaryLabel(spirit)}
        >
          {spirit.services}/{spirit.servicesInitial}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip ${exhausted ? 'text-faint' : 'border-cyan-dim text-cyan'}`}
          disabled={exhausted || busy === true}
          onClick={() => onSpendService(spirit.id)}
          aria-label={spendServiceLabel(spirit)}
        >
          Spend a service
        </button>

        <button
          type="button"
          className={`chip ${spirit.bound ? 'border-magenta-dim text-magenta' : 'text-dim'}`}
          aria-pressed={spirit.bound}
          onClick={() => onSetBound(spirit.id, !spirit.bound)}
          aria-label={
            spirit.bound
              ? `${spirit.name} is bound — activate to release the binding`
              : `${spirit.name} is unbound — activate to mark it bound`
          }
        >
          {spirit.bound ? 'Bound' : 'Unbound'}
        </button>

        {encounterId && !inFight && (
          <button
            type="button"
            className="chip text-dim"
            disabled={busy === true}
            onClick={() => onJoin(spirit.id, encounterId)}
            aria-label={`Send ${spirit.name} into ${encounterName ?? 'the fight'} as a combatant`}
          >
            Into the fight
          </button>
        )}

        <button
          type="button"
          className="chip text-faint"
          onClick={() => onDismiss(spirit.id)}
          aria-label={`Dismiss ${spirit.name}, releasing anything it is holding`}
        >
          Dismiss
        </button>
      </div>

      {encounterId && !canPlaceOnTracker && !inFight && (
        <p className="mt-1 text-xs text-faint">The GM places figures on the tracker.</p>
      )}
      {!encounterId && (
        <p className="mt-1 text-xs text-faint">No fight running — nothing to send it into yet.</p>
      )}
    </li>
  );
}

function SummonDialog({
  onClose,
  onSummon,
}: {
  onClose: () => void;
  onSummon: (input: { spiritType: string; force: number; services: number; bound: boolean }) => void;
}) {
  const [spiritType, setSpiritType] = useState('');
  const [force, setForce] = useState(4);
  const [services, setServices] = useState(1);
  const [bound, setBound] = useState(false);

  const type = spiritType.trim();
  return (
    <Sheet open onClose={onClose} title="Summon a spirit">
      <label className="mono-label block" htmlFor="spirit-type">
        Kind of spirit
      </label>
      <input
        id="spirit-type"
        className="mt-1 w-full rounded border border-edge bg-ground px-2 py-2 text-sm text-ink"
        value={spiritType}
        onChange={(e) => setSpiritType(e.target.value)}
        placeholder="your own label — the app ships no bestiary"
        aria-label="Kind of spirit"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="mono-label">Force</span>
        <Stepper value={force} onChange={setForce} min={1} max={24} label="Force" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="mono-label">Services owed</span>
        <Stepper value={services} onChange={setServices} min={0} max={99} label="services" />
      </div>

      <button
        type="button"
        className={`chip mt-3 ${bound ? 'border-magenta-dim text-magenta' : 'text-dim'}`}
        aria-pressed={bound}
        onClick={() => setBound((b) => !b)}
        aria-label={bound ? 'Bound spirit — activate to make it unbound' : 'Unbound spirit — activate to make it bound'}
      >
        {bound ? 'Bound' : 'Unbound'}
      </button>

      <button
        type="button"
        className="btn btn-accent mt-4 w-full py-3 text-sm"
        disabled={type.length === 0}
        onClick={() => onSummon({ spiritType: type, force, services, bound })}
        aria-label={`Summon a Force ${force} ${type || 'spirit'} owing ${services} services`}
      >
        Summon at Force {force}
      </button>
    </Sheet>
  );
}
