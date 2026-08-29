/**
 * Bonded foci as real toggled modifier sources (FR8.4).
 *
 * The point of this rack is that the toggle is not cosmetic: flipping a focus
 * changes the derived pool underneath it, and that pool's breakdown names the
 * focus as a contributing source (Principle 3). The "moves" strip below the
 * list is where the mage watches that happen — each affected pool with its
 * current number and its receipts one tap away.
 *
 * Two gates, both real and both visible: an unbonded focus contributes nothing
 * at all, and a bonded focus that is switched off contributes nothing now.
 */
import { useState } from 'react';
import type { DerivedCharacter } from '@safehouse/contracts';
import { focusSummary } from '@safehouse/rules';
import { affectedPools, focusContributes, focusToggleLabel, focusTargets, prettyTarget, toBondedFocus } from './lib.js';
import type { FocusRow } from './types.js';
import { BreakdownButton, type OverrideApi } from '../components/Provenance.js';
import { Empty, RefChip, SectionLabel, Sheet, Stepper } from '../components/ui.js';

export interface FociRackProps {
  foci: FocusRow[];
  /** The character derived WITH the current rack folded in. */
  derived: DerivedCharacter | null;
  onToggle: (focusId: string, patch: { active?: boolean; bonded?: boolean }) => void;
  onAdd: (input: { name: string; kind: string; force: number; targets: string[]; bonded: boolean }) => void;
  onRemove: (focusId: string) => void;
  overrideFor?: (target: string) => OverrideApi;
  busy?: boolean;
}

export default function FociRack(props: FociRackProps) {
  const [adding, setAdding] = useState(false);
  const summary = focusSummary(props.foci.map(toBondedFocus));
  const moves = affectedPools(props.foci, props.derived);

  return (
    <>
      <SectionLabel>
        Foci — {summary.bonded} bonded, {summary.contributing} burning
      </SectionLabel>

      {props.foci.length === 0 && <Empty>No foci bonded.</Empty>}

      <ul className="divide-y divide-edge/60">
        {props.foci.map((focus) => (
          <FocusRowView key={focus.id} focus={focus} {...props} />
        ))}
      </ul>

      {moves.length > 0 && (
        <div className="mt-2 rounded border border-edge/70 bg-raised/40 p-2">
          <div className="mono-label mb-1.5">What the rack moves</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {moves.map((move) => (
              <BreakdownButton
                key={move.key}
                title={`${move.label} pool`}
                value={move.pool.total}
                breakdown={move.pool.breakdown}
                {...(move.pool.limit ? { limit: move.pool.limit } : {})}
                {...(props.overrideFor ? { override: props.overrideFor(`pool.${move.key}`) } : {})}
              >
                <span className="text-dim">{move.label}</span>
                <span className="ml-1 text-cyan">{move.pool.total}</span>
              </BreakdownButton>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn mt-3 w-full py-2.5 text-sm"
        onClick={() => setAdding(true)}
        aria-label="Bond a focus"
      >
        + Bond a focus
      </button>

      {adding && (
        <BondDialog
          onClose={() => setAdding(false)}
          onAdd={(input) => {
            props.onAdd(input);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function FocusRowView({ focus, onToggle, onRemove, busy }: { focus: FocusRow } & FociRackProps) {
  const targets = focusTargets(focus);
  const live = focusContributes(focus);
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">
            {focus.name}
            {focus.kind ? ` · ${focus.kind}` : ''}
          </div>
          <div className="mono-label">
            Force {focus.force}
            {targets.length > 0 ? ` · ${targets.map(prettyTarget).join(', ')}` : ' · no targets set'}
            {focus.bonded ? '' : ' · not bonded'}
          </div>
        </div>
        <RefChip refInfo={focus.ref} />
        <button
          type="button"
          className={`chip shrink-0 ${live ? 'border-cyan text-cyan' : 'text-faint'}`}
          aria-pressed={focus.active && focus.bonded}
          disabled={!focus.bonded || busy === true}
          onClick={() => onToggle(focus.id, { active: !focus.active })}
          aria-label={focusToggleLabel(focus)}
        >
          {live ? 'On' : 'Off'}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip ${focus.bonded ? 'border-magenta-dim text-magenta' : 'text-dim'}`}
          aria-pressed={focus.bonded}
          onClick={() => onToggle(focus.id, { bonded: !focus.bonded })}
          aria-label={
            focus.bonded
              ? `${focus.name} is bonded — activate to unbond it, which switches it off`
              : `${focus.name} is not bonded — activate to bond it`
          }
        >
          {focus.bonded ? 'Bonded' : 'Unbonded'}
        </button>
        <button
          type="button"
          className="chip text-faint"
          onClick={() => onRemove(focus.id)}
          aria-label={`Remove ${focus.name} from the rack`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Bonding a focus is user entry, not a lookup: the name, the kind and what it
 * feeds are the mage's own words (§14). With no explicit modifiers the engine
 * applies the generic mechanic — the focus adds its Force to what it is for.
 */
function BondDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: { name: string; kind: string; force: number; targets: string[]; bonded: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [force, setForce] = useState(2);
  const [target, setTarget] = useState('pool.skill.spellcasting');

  const trimmed = name.trim();
  return (
    <Sheet open onClose={onClose} title="Bond a focus">
      <label className="mono-label block" htmlFor="focus-name">
        Name
      </label>
      <input
        id="focus-name"
        className="mt-1 w-full rounded border border-edge bg-ground px-2 py-2 text-sm text-ink"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Focus name"
      />

      <label className="mono-label mt-3 block" htmlFor="focus-kind">
        Kind (your own label)
      </label>
      <input
        id="focus-kind"
        className="mt-1 w-full rounded border border-edge bg-ground px-2 py-2 text-sm text-ink"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        placeholder="power focus, weapon focus…"
        aria-label="Focus kind"
      />

      <label className="mono-label mt-3 block" htmlFor="focus-target">
        What it feeds
      </label>
      <input
        id="focus-target"
        className="mt-1 w-full rounded border border-edge bg-ground px-2 py-2 font-label text-sm text-ink"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="pool.skill.spellcasting"
        aria-label="Modifier target the focus feeds"
      />
      <p className="mt-1 text-xs text-faint">
        A pipeline target, e.g. <code>pool.skill.spellcasting</code>, <code>pool.all</code> or{' '}
        <code>limit.astral</code>. It adds its Force there while it is switched on.
      </p>

      <div className="mt-3 flex items-center justify-between">
        <span className="mono-label">Force</span>
        <Stepper value={force} onChange={setForce} min={0} max={12} label="Force" />
      </div>

      <button
        type="button"
        className="btn btn-accent mt-4 w-full py-3 text-sm"
        disabled={trimmed.length === 0}
        onClick={() =>
          onAdd({
            name: trimmed,
            kind: kind.trim(),
            force,
            targets: target.trim() ? [target.trim()] : [],
            bonded: true,
          })
        }
        aria-label={`Bond ${trimmed || 'the focus'} at Force ${force}`}
      >
        Bond it
      </button>
    </Sheet>
  );
}
