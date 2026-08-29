/**
 * Resolve-chain dialog (FR10.8): attack vs defence → net hits → modified DV →
 * soak → boxes, every step an overridable card, damage only when the GM commits.
 *
 * THE DICE ARE THE SERVER'S, and none of them are thrown here. "Roll the
 * exchange" goes through `createChainStore` (`./resolveChain.ts`) to
 * `POST /api/encounters/:id/resolve-chain`, which rolls all three pools and
 * writes one `rolls` row per pool before it answers. What this file renders is
 * that response — the faces on these cards are the faces in the log, which is
 * the whole of G5. There is no local fallback anywhere in the feature: when the
 * endpoint cannot be reached this dialog says so and draws no dice at all,
 * because a browser-rolled die the GM reads out to the table is worse than no
 * die.
 *
 * What is unchanged from the version that previewed locally: the card UI (each
 * step still an editable card, Principle 2) and the commit path (the GM still
 * confirms, and the boxes still land through the server-applied `damage.apply`
 * command, FR4.5).
 *
 * What went with the local engine, on purpose: the per-step reroll. The server
 * throws the exchange as a unit and records what it threw, so re-rolling one
 * step while keeping the others would either lie about the record or ask the
 * server to un-roll a die it has already written down. "Reroll" now means a new
 * exchange, on the record, which is what the one button does.
 *
 * Pools are not proposed by this client either (the `CopilotRack` rule): the GM
 * names a weapon and, if they want them, situational dice and DV/AP overrides —
 * the server decides what those are worth against live wounds and scene
 * modifiers, and every knob here is one the endpoint honours.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Combatant, ProvenanceEntry, RollResult } from '@safehouse/contracts';
import DiceFaces from './DiceFaces.js';
import { useQuickRolls } from './quickRolls.js';
import {
  chainRequest,
  chainView,
  commitBoxes,
  commitTrack,
  createChainStore,
  type ChainForm,
  type ChainState,
} from './resolveChain.js';

function Num({
  label,
  value,
  onChange,
  w = 'w-14',
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  w?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="mono-label">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={`${w} rounded border border-edge bg-deck px-1.5 py-1 text-sm outline-none focus:border-cyan-dim`}
      />
    </label>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  w = 'w-16',
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  w?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="mono-label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        className={`${w} rounded border border-edge bg-deck px-1.5 py-1 text-sm outline-none focus:border-cyan-dim`}
      />
    </label>
  );
}

/** Provenance for the pool, as a tooltip (Principle 3: the receipt travels). */
function receipt(breakdown: ProvenanceEntry[]): string | undefined {
  if (breakdown.length === 0) return undefined;
  return breakdown.map((e) => `${e.label} ${e.value >= 0 ? '+' : ''}${e.value}`).join(' · ');
}

function StepCard({
  title,
  roll,
  breakdown = [],
  children,
}: {
  title: string;
  roll?: RollResult | null;
  breakdown?: ProvenanceEntry[];
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-edge bg-deck p-2.5">
      <div className="flex items-center gap-2">
        <span className="mono-label text-cyan" title={receipt(breakdown)}>
          {title}
        </span>
      </div>
      {roll && <DiceFaces faces={roll.faces} exploded={roll.exploded ?? []} size={20} className="mt-1.5" />}
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

export interface ChainResultViewProps {
  state: ChainState;
  onBoxes: (n: number) => void;
  onCommit: () => void;
  onDiscard: () => void;
}

/**
 * Everything below the "roll" button: the failure notice, or the server's
 * cards plus the commit row. Exported because this is where the guarantee is
 * visible — these faces came off the wire, and the failure case renders no dice.
 *
 * The two failures are drawn differently on purpose. A roll that never happened
 * has no result and gets the "no server dice" panel INSTEAD of cards. A commit
 * the socket refused happened after dice that are already in the log, so the
 * cards stay up and the notice sits next to the commit button — telling that GM
 * "nothing was rolled" would be a lie about the record, and hiding the button
 * would take away the retry the store still allows.
 */
export function ChainResultView({ state, onBoxes, onCommit, onDiscard }: ChainResultViewProps) {
  if (state.status === 'rolling') {
    return <p className="mono-label mt-3 text-faint">Rolling on the server…</p>;
  }

  if (state.error && !state.result) {
    return (
      <div role="alert" className="mt-3 rounded-md border border-danger/60 bg-[#2a0d12] p-2.5 text-sm">
        <div className="mono-label text-danger">No server dice</div>
        <p className="mt-1">{state.error}</p>
        <p className="mt-1 text-faint">
          Nothing was rolled and nothing was recorded. This dialog does not roll dice in the browser —
          resolve the exchange by hand, or try again once the server answers.
        </p>
      </div>
    );
  }

  const res = state.result;
  if (!res) return null;
  const view = chainView(res);
  const boxes = commitBoxes(state);
  const track = commitTrack(state);

  return (
    <div className="mt-3 space-y-2">
      {view.attack && (
        <StepCard
          title={`1 · Attack — pool ${view.attack.pool}`}
          roll={view.attack.roll}
          breakdown={view.attack.breakdown}
        >
          <span className="font-label text-cyan">{view.attack.roll?.limitedHits ?? 0} hits</span>
          {view.attack.limit && <span className="mono-label ml-2">limit {view.attack.limit.value}</span>}
          {view.attack.roll && view.attack.roll.glitch !== 'none' && (
            <span className="ml-2 font-bold text-warn">{view.attack.roll.glitch.toUpperCase()}</span>
          )}
        </StepCard>
      )}

      {view.defense && (
        <StepCard
          title={`2 · Defense — pool ${view.defense.pool}${view.defense.fullDefense ? ' (full def.)' : ''}`}
          roll={view.defense.roll}
          breakdown={view.defense.breakdown}
        >
          <span className="font-label text-cyan">{view.defense.roll?.hits ?? 0} hits</span>
          <span className="ml-3">
            net <span className="font-label text-magenta">{view.defense.netHits}</span> —{' '}
            <span className={view.defense.outcome === 'hit' ? 'text-danger' : 'text-ok'}>
              {view.defense.outcome.toUpperCase()}
            </span>
          </span>
        </StepCard>
      )}

      {view.damage && (
        <StepCard title="3 · Damage">
          DV {view.damage.baseValue}
          {view.damage.baseType} + {view.defense?.netHits ?? 0} net ={' '}
          <span className="font-label text-danger">
            {view.damage.modifiedDv}
            {view.damage.type}
          </span>
          <span className="mono-label ml-2">
            AP {view.damage.ap} · armor {view.damage.armor} → {view.damage.modifiedArmor}
          </span>
          {view.damage.convertedToStun && <span className="ml-2 text-warn">→ Stun</span>}
        </StepCard>
      )}

      {view.soak && (
        <StepCard title={`4 · Soak — pool ${view.soak.pool}`} roll={view.soak.roll} breakdown={view.soak.breakdown}>
          <span className="font-label text-cyan">{view.soak.roll?.hits ?? 0} hits</span>
          <span className="ml-3">
            → <span className="font-label text-danger">{view.soak.boxes}</span> {view.soak.track} box
            {view.soak.boxes === 1 ? '' : 'es'}
          </span>
        </StepCard>
      )}

      {res.notes.length > 0 && <div className="mono-label px-1 text-faint">{res.notes.join(' · ')}</div>}

      <div className="mono-label px-1 text-faint">
        {res.rolls.length} pool{res.rolls.length === 1 ? '' : 's'} on the record · chain{' '}
        {res.chainId.slice(0, 8)}
      </div>

      {state.error && (
        <div role="alert" className="rounded-md border border-danger/60 bg-[#2a0d12] p-2.5 text-sm">
          <div className="mono-label text-danger">Damage not applied</div>
          <p className="mt-1">{state.error}</p>
          <p className="mt-1 text-faint">
            The dice above are on the record either way — chain {res.chainId.slice(0, 8)}. Only the
            boxes are outstanding; commit again once the socket is back.
          </p>
        </div>
      )}

      <div className="flex items-end justify-end gap-2 border-t border-edge pt-3">
        <Num label={`Commit boxes (${track})`} value={boxes} onChange={onBoxes} w="w-20" />
        <button type="button" className="btn" onClick={onDiscard}>
          Discard
        </button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={onCommit}
          disabled={boxes <= 0 || state.committed}
        >
          Commit damage
        </button>
      </div>
    </div>
  );
}

export interface ResolveChainDialogProps {
  campaignId: string;
  encounterId: string;
  combatants: Combatant[];
  initialAttackerId: string;
  onClose: () => void;
}

export default function ResolveChainDialog({
  campaignId,
  encounterId,
  combatants,
  initialAttackerId,
  onClose,
}: ResolveChainDialogProps) {
  // `useState` and not `useMemo`: the store IS the dialog's identity, and a
  // recomputed memo would silently drop every subscriber mid-exchange.
  const [store] = useState(() => createChainStore({ campaignId, encounterId }));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const [attackerId, setAttackerId] = useState(initialAttackerId);
  const [defenderId, setDefenderId] = useState(
    combatants.find((c) => c.id !== initialAttackerId)?.id ?? initialAttackerId,
  );
  const [weaponName, setWeaponName] = useState<string | null>(null);
  const [fullDefense, setFullDefense] = useState(false);
  const [attackMod, setAttackMod] = useState(0);
  const [defenseMod, setDefenseMod] = useState(0);
  const [dv, setDv] = useState('');
  const [ap, setAp] = useState('');

  const attacker = combatants.find((c) => c.id === attackerId);
  const defender = combatants.find((c) => c.id === defenderId);

  // The attacker's weapons as the SERVER lists them, so the name we send is one
  // it can find. Shares `CopilotRack`'s cache entry — no extra round trip.
  const rack = useQuickRolls(attackerId, Boolean(attackerId));
  const weapons = useMemo(
    () =>
      (rack.data?.entries ?? [])
        .filter((e) => e.kind === 'attack' && e.weapon)
        .map((e) => e.weapon as { name: string; dv: string | null; ap: number }),
    [rack.data],
  );
  const selectedWeapon = weapons.find((w) => w.name === weaponName) ?? weapons[0] ?? null;

  /** Any edit invalidates the exchange the server already rolled. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
      set(v);
      store.clear();
    };

  const form: ChainForm = {
    attackerId,
    defenderId,
    weaponName: selectedWeapon?.name ?? null,
    fullDefense,
    attackMod,
    defenseMod,
    dv,
    ap,
  };

  const roll = () => {
    if (!attacker || !defender || attackerId === defenderId) return;
    void store.roll(chainRequest(form));
  };

  const commit = () => {
    const sent = store.commit(attacker?.name ? { attackerName: attacker.name } : {});
    if (sent) onClose();
  };

  const selectCls =
    'min-w-0 flex-1 rounded border border-edge bg-deck px-2 py-1.5 text-sm outline-none focus:border-cyan-dim';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="panel w-full max-w-lg p-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Resolve chain</h2>
          <button type="button" className="text-faint hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="mt-3 flex items-center gap-2">
          <select
            value={attackerId}
            onChange={(e) => {
              edit(setAttackerId)(e.target.value);
              setWeaponName(null);
            }}
            className={selectCls}
            aria-label="Attacker"
          >
            {combatants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="mono-label text-magenta">vs</span>
          <select
            value={defenderId}
            onChange={(e) => edit(setDefenderId)(e.target.value)}
            className={selectCls}
            aria-label="Defender"
          >
            {combatants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="mono-label">Weapon</span>
            <select
              value={selectedWeapon?.name ?? ''}
              onChange={(e) => edit(setWeaponName)(e.target.value)}
              className="w-40 rounded border border-edge bg-deck px-1.5 py-1 text-sm outline-none focus:border-cyan-dim"
              aria-label="Weapon"
              disabled={weapons.length === 0}
            >
              {weapons.length === 0 && <option value="">(server picks)</option>}
              {weapons.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                  {w.dv ? ` · ${w.dv}` : ''}
                </option>
              ))}
            </select>
          </label>
          <Text
            label="DV override"
            value={dv}
            onChange={edit(setDv)}
            placeholder={selectedWeapon?.dv ?? 'weapon'}
          />
          <Text label="AP override" value={ap} onChange={edit(setAp)} placeholder={String(selectedWeapon?.ap ?? '')} />
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Num label="Atk dice mod" value={attackMod} onChange={edit(setAttackMod)} w="w-20" />
          <Num label="Def dice mod" value={defenseMod} onChange={edit(setDefenseMod)} w="w-20" />
          <label className="mono-label mb-1 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={fullDefense}
              onChange={(e) => edit(setFullDefense)(e.target.checked)}
              className="accent-[#2fe6ff]"
            />
            Full Defense (+WIL)
          </label>
        </div>

        <p className="mono-label mt-2 text-faint">
          Pools, wounds and scene modifiers are the server's — and so are the dice, which land in the roll
          log the moment they are thrown (G5). Nothing is applied until you commit.
        </p>

        <button
          type="button"
          className="btn btn-accent mt-3 w-full"
          onClick={roll}
          disabled={state.status === 'rolling' || !attacker || !defender || attackerId === defenderId}
        >
          {state.status === 'rolling'
            ? 'Rolling…'
            : state.result
              ? 'Reroll whole chain (new dice on the record)'
              : 'Roll the exchange'}
        </button>

        <ChainResultView
          state={state}
          onBoxes={(n) => store.setBoxes(n)}
          onCommit={commit}
          onDiscard={onClose}
        />
      </div>
    </div>
  );
}
