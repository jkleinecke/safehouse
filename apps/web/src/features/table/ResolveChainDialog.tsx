/**
 * Resolve-chain flow (FR10.8): attack vs defense → net hits → modified DV →
 * soak → boxes, each step rendered as an editable card before commit.
 * The preview runs the shared rules engine locally; committing sends the
 * authoritative `damage.apply` command with the final (GM-edited) boxes.
 *
 * KNOWN GAP: the encounters plugin now exposes an authoritative chain
 * (`POST /api/encounters/:id/resolve-chain` + `/commit`) whose dice are
 * server-rolled for every step. This dialog still previews locally and commits
 * only the final boxes, which is sound — the damage that lands is
 * server-applied — but the dice shown mid-chain are the browser's. Swapping the
 * preview for that endpoint keeps this card UI and the commit path unchanged.
 */
import { useMemo, useState } from 'react';
import type { Combatant, RollResult, SheetWeapon } from '@safehouse/contracts';
import { resolveAttackChain, type AttackChainResult, type CombatActor } from '@safehouse/rules';
import { sendCommand } from './commands.js';
import { parseCopilot } from './copilot.js';
import DiceFaces from './DiceFaces.js';

export interface ResolveChainDialogProps {
  campaignId: string;
  encounterId: string;
  combatants: Combatant[];
  initialAttackerId: string;
  onClose: () => void;
}

interface ActorFields {
  attackPool: number;
  rea: number;
  int: number;
  wil: number;
  bod: number;
  armor: number;
}

function seedFields(c: Combatant | undefined): ActorFields {
  const view = c ? parseCopilot(c) : null;
  return {
    attackPool: view?.pools.attack ?? 8,
    rea: view?.attributes.rea ?? 3,
    int: view?.attributes.int ?? 3,
    wil: view?.attributes.wil ?? 3,
    bod: view?.attributes.bod ?? 3,
    armor: view?.armor ?? 9,
  };
}

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

function StepCard({
  title,
  roll,
  onReroll,
  children,
}: {
  title: string;
  roll?: RollResult;
  onReroll?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-edge bg-deck p-2.5">
      <div className="flex items-center gap-2">
        <span className="mono-label text-cyan">{title}</span>
        {onReroll && (
          <button type="button" className="mono-label ml-auto text-faint hover:text-magenta" onClick={onReroll}>
            ↻ reroll
          </button>
        )}
      </div>
      {roll && <DiceFaces faces={roll.faces} exploded={roll.exploded} size={20} className="mt-1.5" />}
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

export default function ResolveChainDialog({
  campaignId,
  encounterId,
  combatants,
  initialAttackerId,
  onClose,
}: ResolveChainDialogProps) {
  const [attackerId, setAttackerId] = useState(initialAttackerId);
  const [defenderId, setDefenderId] = useState(
    combatants.find((c) => c.id !== initialAttackerId)?.id ?? initialAttackerId,
  );
  const attacker = combatants.find((c) => c.id === attackerId);
  const defender = combatants.find((c) => c.id === defenderId);

  const [atk, setAtk] = useState<ActorFields>(() => seedFields(attacker));
  const [def, setDef] = useState<ActorFields>(() => seedFields(defender));
  const seededWeapon = attacker ? parseCopilot(attacker)?.weapons[0] : undefined;
  const [weaponName, setWeaponName] = useState(seededWeapon?.name ?? 'Weapon');
  const [acc, setAcc] = useState(seededWeapon?.acc ?? 5);
  const [dv, setDv] = useState(seededWeapon?.dv ?? '7P');
  const [ap, setAp] = useState(seededWeapon?.ap ?? 0);
  const [fullDefense, setFullDefense] = useState(false);

  const [result, setResult] = useState<AttackChainResult | null>(null);
  const [finalBoxes, setFinalBoxes] = useState<number | null>(null);

  const reseed = (side: 'attacker' | 'defender', id: string) => {
    const c = combatants.find((x) => x.id === id);
    if (side === 'attacker') {
      setAttackerId(id);
      setAtk(seedFields(c));
      const w = c ? parseCopilot(c)?.weapons[0] : undefined;
      if (w) {
        setWeaponName(w.name);
        if (w.acc !== undefined) setAcc(w.acc);
        if (w.dv) setDv(w.dv);
        if (w.ap !== undefined) setAp(w.ap);
      }
    } else {
      setDefenderId(id);
      setDef(seedFields(c));
    }
    setResult(null);
    setFinalBoxes(null);
  };

  const weapon: SheetWeapon = useMemo(
    () => ({ name: weaponName || 'Weapon', skillId: 'copilot', acc, dv, ap, modes: [] }),
    [weaponName, acc, dv, ap],
  );

  const run = (keep: { attack?: RollResult; defense?: RollResult; soak?: RollResult } = {}) => {
    if (!attacker || !defender) return;
    const attackerActor: CombatActor = {
      name: attacker.name,
      attributes: { bod: atk.bod, rea: atk.rea, int: atk.int, wil: atk.wil },
      attackPool: atk.attackPool,
      monitors: attacker.monitors,
    };
    const defenderActor: CombatActor = {
      name: defender.name,
      attributes: { bod: def.bod, rea: def.rea, int: def.int, wil: def.wil },
      armor: def.armor,
      monitors: defender.monitors,
    };
    const chain = resolveAttackChain(attackerActor, defenderActor, weapon, Math.random, {
      fullDefense,
      rolls: keep,
      apply: false,
    });
    setResult(chain);
    setFinalBoxes(chain.soak?.boxes ?? 0);
  };

  const commitTrack: 'physical' | 'stun' =
    result?.soak?.track === 'stun' || result?.damage?.type === 'S' ? 'stun' : 'physical';
  const boxes = finalBoxes ?? result?.soak?.boxes ?? 0;

  const commit = () => {
    if (!result || !defender) return;
    sendCommand(campaignId, {
      cmd: 'damage.apply',
      combatantId: defender.id,
      encounterId,
      monitor: commitTrack,
      boxes,
      note: `${attacker?.name ?? '?'} → ${weapon.name}: DV ${result.damage?.modifiedDv ?? '?'}${result.damage?.type ?? ''}, soak ${result.soak?.roll.hits ?? 0}`,
    });
    onClose();
  };

  const selectCls =
    'min-w-0 flex-1 rounded border border-edge bg-deck px-2 py-1.5 text-sm outline-none focus:border-cyan-dim';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/80 p-4" role="dialog" aria-modal="true">
      <div className="panel w-full max-w-lg p-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Resolve chain</h2>
          <button type="button" className="text-faint hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="mt-3 flex items-center gap-2">
          <select value={attackerId} onChange={(e) => reseed('attacker', e.target.value)} className={selectCls} aria-label="Attacker">
            {combatants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="mono-label text-magenta">vs</span>
          <select value={defenderId} onChange={(e) => reseed('defender', e.target.value)} className={selectCls} aria-label="Defender">
            {combatants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Num label="Attack pool" value={atk.attackPool} onChange={(n) => { setAtk({ ...atk, attackPool: n }); setResult(null); }} w="w-20" />
          <label className="flex flex-col gap-0.5">
            <span className="mono-label">Weapon</span>
            <input value={weaponName} onChange={(e) => setWeaponName(e.target.value)} className="w-32 rounded border border-edge bg-deck px-1.5 py-1 text-sm outline-none focus:border-cyan-dim" />
          </label>
          <Num label="Acc" value={acc} onChange={(n) => { setAcc(n); setResult(null); }} />
          <label className="flex flex-col gap-0.5">
            <span className="mono-label">DV</span>
            <input value={dv} onChange={(e) => { setDv(e.target.value); setResult(null); }} className="w-16 rounded border border-edge bg-deck px-1.5 py-1 text-sm outline-none focus:border-cyan-dim" placeholder="8P" />
          </label>
          <Num label="AP" value={ap} onChange={(n) => { setAp(n); setResult(null); }} />
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Num label="Def REA" value={def.rea} onChange={(n) => { setDef({ ...def, rea: n }); setResult(null); }} />
          <Num label="INT" value={def.int} onChange={(n) => { setDef({ ...def, int: n }); setResult(null); }} />
          <Num label="WIL" value={def.wil} onChange={(n) => { setDef({ ...def, wil: n }); setResult(null); }} />
          <Num label="BOD" value={def.bod} onChange={(n) => { setDef({ ...def, bod: n }); setResult(null); }} />
          <Num label="Armor" value={def.armor} onChange={(n) => { setDef({ ...def, armor: n }); setResult(null); }} />
          <label className="mono-label mb-1 flex items-center gap-1.5">
            <input type="checkbox" checked={fullDefense} onChange={(e) => { setFullDefense(e.target.checked); setResult(null); }} className="accent-[#2fe6ff]" />
            Full Defense (+WIL)
          </label>
        </div>

        <button type="button" className="btn btn-accent mt-3 w-full" onClick={() => run()}>
          {result ? 'Reroll whole chain' : 'Roll the exchange'}
        </button>

        {result && (
          <div className="mt-3 space-y-2">
            <StepCard title={`1 · Attack — pool ${result.attack.pool}`} roll={result.attack.roll} onReroll={() => run({ defense: result.defense.roll, ...(result.soak ? { soak: result.soak.roll } : {}) })}>
              <span className="font-label text-cyan">{result.attack.roll.limitedHits} hits</span>
              {result.attack.limit && <span className="mono-label ml-2">limit {result.attack.limit.value}</span>}
              {result.attack.roll.glitch !== 'none' && <span className="ml-2 font-bold text-warn">{result.attack.roll.glitch.toUpperCase()}</span>}
            </StepCard>

            <StepCard title={`2 · Defense — pool ${result.defense.pool}${result.defense.fullDefense ? ' (full def.)' : ''}`} roll={result.defense.roll} onReroll={() => run({ attack: result.attack.roll, ...(result.soak ? { soak: result.soak.roll } : {}) })}>
              <span className="font-label text-cyan">{result.defense.roll.hits} hits</span>
              <span className="ml-3">
                net <span className="font-label text-magenta">{result.netHits}</span> —{' '}
                <span className={result.outcome === 'hit' ? 'text-danger' : 'text-ok'}>{result.outcome.toUpperCase()}</span>
              </span>
            </StepCard>

            {result.damage && (
              <StepCard title="3 · Damage">
                DV {result.damage.base.value}
                {result.damage.base.type} + {result.netHits} net ={' '}
                <span className="font-label text-danger">
                  {result.damage.modifiedDv}
                  {result.damage.type}
                </span>
                <span className="mono-label ml-2">
                  AP {result.damage.ap} · armor {result.damage.armor} → {result.damage.modifiedArmor}
                </span>
                {result.damage.convertedToStun && <span className="ml-2 text-warn">→ Stun</span>}
              </StepCard>
            )}

            {result.soak && (
              <StepCard title={`4 · Soak — pool ${result.soak.pool}`} roll={result.soak.roll} onReroll={() => run({ attack: result.attack.roll, defense: result.defense.roll })}>
                <span className="font-label text-cyan">{result.soak.roll.hits} hits</span>
                <span className="ml-3">
                  → <span className="font-label text-danger">{result.soak.boxes}</span> {result.soak.track} box
                  {result.soak.boxes === 1 ? '' : 'es'}
                </span>
              </StepCard>
            )}

            {result.notes.length > 0 && (
              <div className="mono-label px-1 text-faint">{result.notes.join(' · ')}</div>
            )}

            <div className="flex items-end justify-end gap-2 border-t border-edge pt-3">
              <Num label={`Commit boxes (${commitTrack})`} value={boxes} onChange={setFinalBoxes} w="w-20" />
              <button type="button" className="btn" onClick={onClose}>
                Discard
              </button>
              <button type="button" className="btn btn-accent" onClick={commit} disabled={boxes <= 0}>
                Commit damage
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
