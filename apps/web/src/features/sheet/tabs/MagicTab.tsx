/**
 * Magic tab (FR8.1-lite, 8.2, 8.5): spells with a Force picker feeding the
 * cast roll, an automatically chained Drain resistance roll, sustained-spell
 * toggles showing their −2, and adept powers as modifier toggles.
 */
import { useState } from 'react';
import type { ProvenanceEntry, SheetSpell } from '@safehouse/contracts';
import {
  drainValue,
  isPowerActive,
  isSustained,
  setPowerActive,
  signed,
  sustainedSpells,
  toggleSustain,
} from '../lib.js';
import { useSheetPlayStore, type DrainAttr } from '../playState.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, RefChip, SectionLabel, Sheet, Stepper } from '../components/ui.js';
import type { TabProps } from './shared.js';
import DrainApplyPanel, { type PendingDrain } from './DrainApply.js';

const DRAIN_ATTRS: { id: DrainAttr; label: string }[] = [
  { id: 'cha', label: 'CHA' },
  { id: 'log', label: 'LOG' },
  { id: 'int', label: 'INT' },
  { id: 'wil', label: 'WIL' },
];

export default function MagicTab(props: TabProps) {
  const { character, derived, patchSheet, setCondition, roll } = props;
  const sheet = character.sheet;
  const [casting, setCasting] = useState<SheetSpell | null>(null);
  const [pendingDrain, setPendingDrain] = useState<PendingDrain | null>(null);
  const sustained = sustainedSpells(sheet);

  const attr = (code: string): number => derived.attributes[code]?.value ?? 0;
  const drainAttr = useSheetPlayStore((s) => s.drainAttr[character.id] ?? 'cha');
  const setDrainAttr = useSheetPlayStore((s) => s.setDrainAttr);

  /** The linked Drain resistance roll (FR8.1) — WIL + the tradition attribute. */
  const rollDrain = (spell: SheetSpell, force: number, dv: number) => {
    const wil = attr('wil');
    const second = attr(drainAttr);
    const physical = force > attr('mag');
    const breakdown: ProvenanceEntry[] = [
      { label: 'WIL', value: wil, source: 'attribute' },
      { label: drainAttr.toUpperCase(), value: second, source: 'attribute' },
    ];
    roll(
      {
        title: `Drain — ${spell.name}`,
        note: `Resist ${dv} ${physical ? 'Physical' : 'Stun'} (Force ${force}${
          physical ? ' > MAG' : ''
        }); unresisted boxes hit your monitor.`,
        kind: 'threshold',
        baseTotal: wil + second,
        baseBreakdown: breakdown,
        meta: { drainFor: spell.name, threshold: dv, force, damage: physical ? 'P' : 'S' },
      },
      () => setPendingDrain({ spell: spell.name, dv, physical, at: Date.now() }),
    );
  };

  const cast = (spell: SheetSpell, force: number, sustain: boolean) => {
    const pool = derived.pools[`spell.${spell.name}`];
    const dv = drainValue(spell.drain, force);
    setCasting(null);
    roll(
      {
        title: `${spell.name} — Force ${force}`,
        ...(dv === null
          ? { note: 'No drain code on this spell — roll drain by hand after.' }
          : {}),
        baseTotal: pool?.total ?? 0,
        baseBreakdown: pool?.breakdown ?? [],
        limit: { kind: 'force', value: force },
        meta: { poolKey: `spell.${spell.name}`, spell: spell.name, force },
      },
      () => {
        if (sustain && !isSustained(sheet, spell.name)) patchSheet(toggleSustain(sheet, spell.name));
        if (dv !== null) rollDrain(spell, force, dv);
      },
    );
  };

  return (
    <div className="p-4">
      {sustained.length > 0 && (
        <>
          <SectionLabel>
            Sustaining — {signed(-2 * sustained.length)} to pools (FR8.2)
          </SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {sustained.map((name) => (
              <button
                key={name}
                type="button"
                className="chip border-magenta-dim text-magenta"
                onClick={() => patchSheet(toggleSustain(sheet, name))}
                title="Tap to drop this spell"
              >
                {name} −2 ✕
              </button>
            ))}
          </div>
        </>
      )}

      {pendingDrain && (
        <DrainApplyPanel
          key={pendingDrain.at}
          pending={pendingDrain}
          condition={character.condition}
          onApply={(next) => {
            setCondition(next);
            setPendingDrain(null);
          }}
          onDismiss={() => setPendingDrain(null)}
        />
      )}

      <SectionLabel>Spells</SectionLabel>
      {sheet.spells.length === 0 && <Empty>No spells entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.spells.map((spell) => {
          const pool = derived.pools[`spell.${spell.name}`];
          return (
            <li key={spell.name}>
              <div
                className="flex cursor-pointer items-center gap-2 py-2.5 active:bg-raised/60"
                role="button"
                tabIndex={0}
                onClick={() => setCasting(spell)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setCasting(spell);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{spell.name}</div>
                  <div className="mono-label">
                    {spell.category ?? 'spell'}
                    {spell.drain ? ` · drain ${spell.drain}` : ''}
                    {isSustained(sheet, spell.name) ? ' · sustaining' : ''}
                  </div>
                </div>
                <RefChip refInfo={spell.ref} />
                {pool && (
                  <BreakdownButton
                    title={`${spell.name} pool`}
                    value={pool.total}
                    breakdown={pool.breakdown}
                    override={props.overrideFor(`pool.spell.${spell.name}`)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <SectionLabel>Adept powers</SectionLabel>
      {sheet.powers.length === 0 && <Empty>No powers entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.powers.map((power) => {
          const toggleable = power.mods.length > 0;
          const on = isPowerActive(power);
          return (
            <li key={power.name} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">
                  {power.name}
                  {power.rating ? ` ${power.rating}` : ''}
                </div>
                <div className="mono-label">
                  {power.cost !== undefined ? `${power.cost} PP` : 'power'}
                  {power.mods.length > 0
                    ? ` · ${power.mods.map((m) => `${m.target} ${signed(m.value)}`).join(', ')}`
                    : ''}
                </div>
              </div>
              <RefChip refInfo={power.ref} />
              {toggleable ? (
                <button
                  type="button"
                  className={`chip ${on ? 'border-cyan-dim text-cyan' : 'text-faint'}`}
                  onClick={() => patchSheet(setPowerActive(sheet, power.name, !on))}
                >
                  {on ? 'On' : 'Off'}
                </button>
              ) : (
                <span className="chip text-faint">passive</span>
              )}
            </li>
          );
        })}
      </ul>

      {casting && (
        <CastDialog
          spell={casting}
          mag={attr('mag')}
          pool={derived.pools[`spell.${casting.name}`]?.total ?? 0}
          drainAttr={drainAttr}
          onDrainAttr={(a) => setDrainAttr(character.id, a)}
          alreadySustained={isSustained(sheet, casting.name)}
          onClose={() => setCasting(null)}
          onCast={cast}
        />
      )}
    </div>
  );
}

function CastDialog({
  spell,
  mag,
  pool,
  drainAttr,
  onDrainAttr,
  alreadySustained,
  onClose,
  onCast,
}: {
  spell: SheetSpell;
  mag: number;
  pool: number;
  drainAttr: DrainAttr;
  onDrainAttr: (a: DrainAttr) => void;
  alreadySustained: boolean;
  onClose: () => void;
  onCast: (spell: SheetSpell, force: number, sustain: boolean) => void;
}) {
  const [force, setForce] = useState(Math.max(1, mag));
  const [sustain, setSustain] = useState(false);
  const dv = drainValue(spell.drain, force);
  const physical = force > mag;

  return (
    <Sheet open onClose={onClose} title={`Cast ${spell.name}`}>
      <div className="flex items-center justify-between">
        <span className="mono-label">Force (limit)</span>
        <Stepper value={force} onChange={setForce} min={1} max={Math.max(1, mag * 2)} />
      </div>
      <p className="mt-1 text-xs text-faint">
        Pool {pool} · limit Force {force}
        {physical ? ' · over Magic — drain is Physical' : ''}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="mono-label">Drain resist</span>
        <div className="flex gap-1">
          <span className="chip text-dim">WIL +</span>
          {DRAIN_ATTRS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`chip ${drainAttr === a.id ? 'border-cyan text-cyan' : 'text-dim'}`}
              onClick={() => onDrainAttr(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-faint">
        {dv === null
          ? `No drain code entered${spell.drain ? ` ("${spell.drain}" unrecognized)` : ''} — the drain roll is skipped.`
          : `Drain ${dv} ${physical ? 'Physical' : 'Stun'} (min 2), rolled right after the cast.`}
      </p>

      {!alreadySustained && (
        <button
          type="button"
          className={`chip mt-3 ${sustain ? 'border-magenta-dim text-magenta' : 'text-dim'}`}
          onClick={() => setSustain((s) => !s)}
        >
          {sustain ? 'Will sustain (−2)' : 'Sustain after casting?'}
        </button>
      )}

      <button
        type="button"
        className="btn btn-accent mt-4 w-full py-3 text-sm"
        onClick={() => onCast(spell, force, sustain)}
      >
        Cast at Force {force}
      </button>
    </Sheet>
  );
}
