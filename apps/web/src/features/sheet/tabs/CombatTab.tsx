/**
 * Combat tab (FR3.2/3.4): defense + soak quick rolls, armor with worn
 * toggles, weapons with per-mode pools (progressive-recoil aware), ammo
 * counters with decrement + reload, and the one-tap recoil reset.
 */
import { useState } from 'react';
import type { SheetWeapon } from '@safehouse/contracts';
import { rangeModifier } from '@safehouse/rules';
import {
  bulletsForMode,
  recoilPenalty,
  signed,
  withWeaponAmmo,
  type RollChip,
} from '../lib.js';
import { rollRowLabel } from '../a11y.js';
import { recoilKey, useSheetPlayStore } from '../playState.js';
import { BreakdownButton } from '../components/Provenance.js';
import { Empty, RefChip, SectionLabel } from '../components/ui.js';
import VitalsStrip from '../components/VitalsStrip.js';
import type { TabProps } from './shared.js';

export default function CombatTab(props: TabProps) {
  const { character, derived, roll, patchSheet, overrideFor } = props;
  const sheet = character.sheet;

  /**
   * Defense / soak quick rolls. The card was a `div` with a click handler
   * wrapping the provenance button — no accessible name, no keyboard path, and
   * a nested interactive element. It is now a real button beside the
   * provenance button.
   */
  const quick = (key: 'defense' | 'soak', title: string) => {
    const pool = derived.pools[key];
    if (!pool) return null;
    return (
      <div key={key} className="panel flex flex-1 flex-col items-center gap-1 py-2.5">
        <button
          type="button"
          className="mono-label rounded px-2 py-0.5 hover:text-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
          aria-label={rollRowLabel(title, pool.total)}
          onClick={() =>
            roll({
              title,
              baseTotal: pool.total,
              baseBreakdown: pool.breakdown,
              meta: { poolRef: key, poolKey: key },
            })
          }
        >
          {title}
        </button>
        <BreakdownButton
          title={`${title} pool`}
          value={pool.total}
          breakdown={pool.breakdown}
          override={overrideFor(`pool.${key}`)}
        />
      </div>
    );
  };

  const armor = derived.pools['armor'];

  return (
    <div className="p-4">
      <VitalsStrip derived={derived} overrideFor={overrideFor} />

      <div className="mt-2 flex gap-2">
        {quick('defense', 'Defense')}
        {quick('soak', 'Soak')}
        {armor && (
          <div className="panel flex flex-1 flex-col items-center gap-1 py-2.5">
            <span className="mono-label">Armor</span>
            <BreakdownButton
              title="Armor value"
              value={armor.total}
              breakdown={armor.breakdown}
              override={overrideFor('armor')}
            />
          </div>
        )}
      </div>

      <SectionLabel>Weapons</SectionLabel>
      {sheet.weapons.length === 0 && <Empty>No weapons entered.</Empty>}
      <div className="space-y-3">
        {sheet.weapons.map((weapon) => (
          <WeaponCard key={weapon.name} weapon={weapon} {...props} />
        ))}
      </div>

      <SectionLabel>Armor worn</SectionLabel>
      {sheet.armor.length === 0 && <Empty>No armor entered.</Empty>}
      <ul className="divide-y divide-edge/60">
        {sheet.armor.map((piece) => (
          <li key={piece.name} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <span className="text-sm text-ink">{piece.name}</span>
              <span className="ml-2 font-label text-xs text-dim">{piece.rating}</span>
            </div>
            <RefChip refInfo={piece.ref} lookup={piece.name} />
            <button
              type="button"
              aria-pressed={piece.worn}
              aria-label={`${piece.name}, armor ${piece.rating}, ${
                piece.worn ? 'worn — activate to stow' : 'stowed — activate to wear'
              }`}
              className={`chip ${piece.worn ? 'border-cyan-dim text-cyan' : 'text-faint'}`}
              onClick={() =>
                patchSheet({
                  ...sheet,
                  armor: sheet.armor.map((a) =>
                    a.name === piece.name ? { ...a, worn: !a.worn } : a,
                  ),
                })
              }
            >
              {piece.worn ? 'Worn' : 'Stowed'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeaponCard({ weapon, character, derived, roll, patchSheet, overrideFor }: TabProps & { weapon: SheetWeapon }) {
  const sheet = character.sheet;
  const pool = derived.pools[`weapon.${weapon.name}`];
  const rKey = recoilKey(character.id, weapon.name);
  const fired = useSheetPlayStore((s) => s.recoil[rKey] ?? 0);
  const bumpRecoil = useSheetPlayStore((s) => s.bumpRecoil);
  const resetRecoil = useSheetPlayStore((s) => s.resetRecoil);
  const [distance, setDistance] = useState('');

  const comp = weapon.recoilComp ?? 0;
  const modes = weapon.modes.length > 0 ? weapon.modes : ['SA'];

  // Range band from the sheet's own user-entered table (FR9.9, G6).
  const rangeCat = weapon.rangeCat;
  const ranged = Boolean(rangeCat && sheet.rangeTables[rangeCat]);
  const rawDist = distance.trim() === '' ? null : Number(distance);
  const distM = rawDist !== null && Number.isFinite(rawDist) ? rawDist : null;
  const rangeMod =
    ranged && rangeCat && distM !== null
      ? rangeModifier(distM, rangeCat, sheet.rangeTables)
      : null;
  const outOfRange = ranged && distM !== null && rangeMod === null;

  if (!pool) return null;

  const fire = (mode: string) => {
    const bullets = bulletsForMode(mode);
    const penalty = recoilPenalty(fired, bullets, comp);
    const chips: RollChip[] = [];
    if (rangeMod) {
      chips.push({
        id: rangeMod.id,
        label: rangeMod.note ?? 'range',
        value: rangeMod.value,
        active: true,
        source: 'range',
      });
    }
    if (penalty !== 0) {
      chips.push({
        id: `recoil.${weapon.name}`,
        label: `recoil (${fired + bullets} rds, comp ${comp})`,
        value: penalty,
        active: true,
        source: 'situational',
      });
    }
    if (mode.toUpperCase() === 'BF' || mode.toUpperCase() === 'FA') {
      chips.push({
        id: `mode.${mode}`,
        label: `${mode} burst`,
        value: 0,
        active: true,
        source: 'situational',
      });
    }
    roll(
      {
        title: `${weapon.name} — ${mode}`,
        baseTotal: pool.total,
        baseBreakdown: pool.breakdown,
        ...(pool.limit ? { limit: pool.limit } : {}),
        extraChips: chips,
        meta: {
          // §10.1: `poolRef` makes the server recompute from the live sheet;
          // the chips above ride along as `meta.mods` so recoil and range are
          // not lost in that recompute (see rollDialogState.ts).
          poolRef: `weapon.${weapon.name}`,
          poolKey: `weapon.${weapon.name}`,
          weapon: weapon.name,
          // The skill behind the pool, so the dialog can say where to read up.
          skill: weapon.skillId,
          mode,
          bullets,
          ...(rangeMod ? { distanceM: distM } : {}),
        },
      },
      () => {
        bumpRecoil(rKey, bullets);
        if (weapon.ammo) {
          patchSheet(
            withWeaponAmmo(sheet, weapon.name, Math.max(0, weapon.ammo.current - bullets)),
          );
        }
      },
    );
  };

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{weapon.name}</div>
        <RefChip refInfo={weapon.ref} lookup={weapon.name} />
        <BreakdownButton
          title={`${weapon.name} pool`}
          value={pool.total}
          breakdown={pool.breakdown}
          limit={pool.limit}
          override={overrideFor(`pool.weapon.${weapon.name}`)}
        />
      </div>
      <div className="mono-label mt-1">
        {weapon.dv ?? '—'}
        {typeof weapon.ap === 'number' && weapon.ap !== 0 ? ` · AP ${weapon.ap}` : ''}
        {typeof weapon.acc === 'number' ? ` · acc ${weapon.acc}` : ''}
        {comp > 0 ? ` · RC ${comp}` : ''}
      </div>

      {/* Per-mode attack buttons with the recoil-adjusted pool preview */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {modes.map((mode) => {
          const penalty = recoilPenalty(fired, bulletsForMode(mode), comp) + (rangeMod?.value ?? 0);
          const effective = Math.max(0, pool.total + penalty);
          return (
            <button
              key={mode}
              type="button"
              className="btn btn-accent"
              disabled={Boolean(weapon.ammo && weapon.ammo.current < bulletsForMode(mode))}
              onClick={() => fire(mode)}
              aria-label={`Fire ${weapon.name} in ${mode} mode, ${effective} dice`}
            >
              <span aria-hidden>
                {mode} {effective}
                {penalty !== 0 && <span className="text-magenta">{signed(penalty)}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {ranged && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="mono-label">range</span>
          <input
            className="w-16 rounded border border-edge bg-ground px-2 py-1 font-label text-xs text-ink"
            inputMode="numeric"
            placeholder="m"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            aria-label={`distance to target for ${weapon.name}`}
          />
          {rangeMod && (
            <span className={`chip ${rangeMod.value < 0 ? 'text-magenta' : 'text-dim'}`}>
              {rangeMod.note ?? 'range'} {signed(rangeMod.value)}
            </span>
          )}
          {outOfRange && <span className="chip text-danger">beyond extreme</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {weapon.ammo && (
          <div className="flex items-center gap-1.5">
            <span className="mono-label" aria-hidden>
              ammo
            </span>
            <span
              className="font-label text-sm text-ink"
              aria-label={`${weapon.name} ammunition, ${weapon.ammo.current} of ${weapon.ammo.cap}`}
            >
              <span aria-hidden>
                {weapon.ammo.current}/{weapon.ammo.cap}
              </span>
            </span>
            <button
              type="button"
              className="chip text-dim hover:border-cyan hover:text-cyan disabled:opacity-40"
              disabled={weapon.ammo.current <= 0}
              onClick={() =>
                patchSheet(withWeaponAmmo(sheet, weapon.name, (weapon.ammo?.current ?? 1) - 1))
              }
              aria-label={`Spend one round of ${weapon.name} ammunition`}
            >
              −1
            </button>
            <button
              type="button"
              className="chip text-dim hover:border-cyan hover:text-cyan"
              onClick={() => patchSheet(withWeaponAmmo(sheet, weapon.name, weapon.ammo?.cap ?? 0))}
              aria-label={`Reload ${weapon.name}`}
            >
              Reload
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="mono-label" aria-hidden>
            recoil
          </span>
          <span
            className={`font-label text-sm ${fired > 0 ? 'text-magenta' : 'text-dim'}`}
            aria-label={`${fired} rounds fired this turn`}
          >
            <span aria-hidden>{fired} rds</span>
          </span>
          <button
            type="button"
            className="chip text-dim hover:border-cyan hover:text-cyan disabled:opacity-40"
            disabled={fired === 0}
            onClick={() => resetRecoil(rKey)}
            aria-label="Reset progressive recoil — it clears when you stop shooting"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
