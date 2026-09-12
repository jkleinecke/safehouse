/**
 * Spells and adept powers (FR8.1-lite, FR8.5) — the half of the Magic tab that
 * needs nothing but the sheet: a Force picker feeding the cast roll, the Drain
 * resistance roll chained automatically behind it, and powers as toggled
 * modifier sources.
 *
 * Lifted out of `tabs/MagicTab.tsx` unchanged in behaviour so the tab can be
 * assembled two ways: with the live magic workbench above it (the real app), or
 * on its own where no query client is mounted. Sustaining is the one seam —
 * `onSustain` decides where the −2 gets recorded, because a spell a spirit can
 * be handed has to live in the server's sustained list, not in a sheet
 * modifier (FR8.2 × FR8.3).
 */
import { useState } from 'react';
import type { ProvenanceEntry, SheetSpell } from '@safehouse/contracts';
import { drainValue, isPowerActive, setPowerActive, signed } from '../lib.js';
import { spellRowLabel } from '../a11y.js';
import { useSheetPlayStore, type DrainAttr } from '../playState.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, RefChip, RowButton, SectionLabel, Sheet, Stepper } from '../components/ui.js';
import AddFromBooks from '../catalogue/AddFromBooks.js';
import { withoutItem } from '../catalogue/toSheet.js';
import type { TabProps } from '../tabs/shared.js';
import DrainApplyPanel, { type PendingDrain } from '../tabs/DrainApply.js';

const DRAIN_ATTRS: { id: DrainAttr; label: string }[] = [
  { id: 'cha', label: 'CHA' },
  { id: 'log', label: 'LOG' },
  { id: 'int', label: 'INT' },
  { id: 'wil', label: 'WIL' },
];

export interface SpellBookProps extends TabProps {
  /** Names already being sustained, from wherever the −2 is recorded. */
  sustainedNames: readonly string[];
  /** Start sustaining a freshly cast spell. */
  onSustain: (spellName: string) => void;
}

export default function SpellBook(props: SpellBookProps) {
  const { character, derived, patchSheet, setCondition, roll } = props;
  const sheet = character.sheet;
  const [casting, setCasting] = useState<SheetSpell | null>(null);
  const [pendingDrain, setPendingDrain] = useState<PendingDrain | null>(null);

  const held = new Set(props.sustainedNames.map((n) => n.toLowerCase()));
  const isHeld = (name: string) => held.has(name.toLowerCase());

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
        meta: {
          poolRef: `spell.${spell.name}`,
          poolKey: `spell.${spell.name}`,
          spell: spell.name,
          force,
        },
      },
      () => {
        if (sustain && !isHeld(spell.name)) props.onSustain(spell.name);
        if (dv !== null) rollDrain(spell, force, dv);
      },
    );
  };

  return (
    <>
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

      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Spells</SectionLabel>
        <AddFromBooks characterId={character.id} sheet={sheet} patchSheet={patchSheet} kinds={['spell']} derived={derived} characterName={character.name} testId="add-spell" />
      </div>
      {sheet.spells.length === 0 && <Empty>No spells entered — add one from the books, write your own, or import the sheet.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.spells.map((spell) => {
          const pool = derived.pools[`spell.${spell.name}`];
          return (
            <li key={spell.name} className="flex items-center gap-2">
              <RowButton
                label={spellRowLabel(spell.name, pool?.total, spell.drain)}
                onActivate={() => setCasting(spell)}
              >
                <div className="min-w-0 flex-1" aria-hidden>
                  <div className="truncate text-sm text-ink">{spell.name}</div>
                  <div className="mono-label">
                    {spell.category ?? 'spell'}
                    {spell.drain ? ` · drain ${spell.drain}` : ''}
                    {isHeld(spell.name) ? ' · sustaining' : ''}
                  </div>
                </div>
              </RowButton>
              <RefChip refInfo={spell.ref} lookup={spell.name} />
              <button
                type="button"
                className="chip text-faint hover:border-danger hover:text-danger"
                onClick={() => patchSheet(withoutItem(sheet, 'spells', spell.name))}
                aria-label={`remove ${spell.name}`}
                title="Removes it — History can put it back"
              >
                ×
              </button>
              {pool && (
                <BreakdownButton
                  title={`${spell.name} pool`}
                  value={pool.total}
                  breakdown={pool.breakdown}
                  override={props.overrideFor(`pool.spell.${spell.name}`)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Adept powers</SectionLabel>
        <AddFromBooks characterId={character.id} sheet={sheet} patchSheet={patchSheet} kinds={['power']} derived={derived} characterName={character.name} testId="add-power" />
      </div>
      {sheet.powers.length === 0 && <Empty>No powers entered — add one from the books, write your own, or import the sheet.</Empty>}
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
              <RefChip refInfo={power.ref} lookup={power.name} />
              <button
                type="button"
                className="chip text-faint hover:border-danger hover:text-danger"
                onClick={() => patchSheet(withoutItem(sheet, 'powers', power.name))}
                aria-label={`remove ${power.name}`}
                title="Removes it — History can put it back"
              >
                ×
              </button>
              {toggleable ? (
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${power.name}, ${on ? 'active — activate to switch off' : 'inactive — activate to switch on'}`}
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
          alreadySustained={isHeld(casting.name)}
          onClose={() => setCasting(null)}
          onCast={cast}
        />
      )}
    </>
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
