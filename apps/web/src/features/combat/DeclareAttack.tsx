/**
 * "Ari shot the bouncer: 4 hits, 8P, AP −1": the GM types a tabletop attack
 * and it opens an exchange on the target, as an app attack would.
 */
import { useMemo, useState } from 'react';
import type { AttackKind, CardActorRef, Combatant } from '@safehouse/contracts';
import { Sheet, Stepper } from '../sheet/components/ui.js';
import { useTrackerEncounter } from '../table/commands.js';
import { openExchange } from './gmApi.js';
import { FIRE_CHOICES, openRequest, saidBy, type DeclareForm, type DeclaredAttacker } from './gmModel.js';
import { NumberField } from './RollCardPanel.js';

const KINDS: readonly [AttackKind, string][] = [
  ['ranged', 'Ranged'],
  ['melee', 'Melee'],
  ['direct-spell', 'Direct spell'],
];

function chip(on: boolean): string {
  return `chip pointer-coarse:min-h-9 ${on ? 'border-cyan text-cyan' : 'text-dim'}`;
}

export interface DeclareAttackProps {
  campaignId: string;
  sceneId?: string | null;
  target: CardActorRef;
  targetName: string;
  onClose: () => void;
}

function isTarget(c: Combatant, t: CardActorRef): boolean {
  return (t.kind === 'combatant' && c.id === t.id) || (t.kind === 'token' && c.tokenId === t.id);
}

export default function DeclareAttack({ campaignId, sceneId = null, target, targetName, onClose }: DeclareAttackProps) {
  const { encounter } = useTrackerEncounter(campaignId, null, sceneId);
  // Runners first: this is for the player at the table with real dice.
  const rows = useMemo(() => {
    const all = (encounter?.combatants ?? []).filter((c) => !isTarget(c, target));
    return [...all.filter((c) => c.source === 'character'), ...all.filter((c) => c.source !== 'character')];
  }, [encounter, target]);
  const acting = rows.find((c) => c.id === encounter?.activeCombatantId);
  const asRow = (c: Combatant): DeclaredAttacker => ({ kind: 'row', id: c.id, name: c.name, runner: c.source === 'character' });

  const [form, setForm] = useState<DeclareForm>(() => ({
    target,
    attacker: acting ? asRow(acting) : null,
    attack: 'ranged',
    hits: 0,
    dv: { value: 0, type: 'P' },
    ap: 0,
    fire: FIRE_CHOICES[0]!,
    defenseModifier: 0,
    note: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<DeclareForm>) => setForm((f) => ({ ...f, ...patch }));
  const a = form.attacker;
  const req = openRequest(form);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    openExchange(req)
      .then(onClose)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not go through.'))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open onClose={onClose} title={`Declare an attack on ${targetName}`}>
      <div className="space-y-3 text-xs" data-testid="declare-attack">
        <section>
          <div className="mono-label mb-1 text-faint">Attacker</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Attacker">
            {rows.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={a?.kind === 'row' && a.id === c.id}
                className={chip(a?.kind === 'row' && a.id === c.id)}
                onClick={() => set({ attacker: asRow(c) })}
              >
                {c.name}
                {c.id === acting?.id && <span className="ml-1 text-faint">(acting)</span>}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={a?.kind === 'name'}
              className={chip(a?.kind === 'name')}
              onClick={() => set({ attacker: { kind: 'name', name: a?.kind === 'name' ? a.name : '' } })}
            >
              Someone else
            </button>
          </div>
          {a?.kind === 'name' && (
            <input
              value={a.name}
              placeholder="Their name"
              aria-label="Attacker's name"
              maxLength={80}
              onChange={(e) => set({ attacker: { kind: 'name', name: e.target.value } })}
              className="mt-1.5 w-full rounded border border-edge bg-deck px-2 py-1 text-sm outline-none focus:border-cyan pointer-coarse:min-h-10"
            />
          )}
        </section>

        <section className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of attack">
          {KINDS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={form.attack === id} className={chip(form.attack === id)} onClick={() => set({ attack: id })}>
              {label}
            </button>
          ))}
        </section>

        <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1">
            <span className="mono-label">Hits</span>
            <NumberField value={form.hits} label="Hits rolled" max={60} onCommit={(n) => set({ hits: n })} />
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="mono-label">DV</span>
            <NumberField value={form.dv.value} label="Damage value" max={40} onCommit={(n) => set({ dv: { ...form.dv, value: n } })} />
            {(['P', 'S'] as const).map((type) => (
              <button key={type} type="button" aria-pressed={form.dv.type === type} className={chip(form.dv.type === type)} onClick={() => set({ dv: { ...form.dv, type } })}>
                {type}
              </button>
            ))}
          </span>
          <Stepper value={form.ap} min={-20} max={10} onChange={(n) => set({ ap: n })} label="AP" />
        </section>
        {form.hits === 0 && <p className="text-faint">0 hits: it misses whatever the defense rolls.</p>}

        <section>
          <div className="mono-label mb-1 text-faint">Fire mode</div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fire mode">
            {FIRE_CHOICES.map((f) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={form.fire === f}
                className={chip(form.fire === f)}
                onClick={() => set({ fire: f, defenseModifier: f.defenseModifier })}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            <Stepper value={form.defenseModifier} min={-10} max={0} onChange={(n) => set({ defenseModifier: n })} label="to defend" />
          </div>
        </section>

        <input
          value={form.note}
          placeholder="Note"
          aria-label="Note"
          maxLength={500}
          onChange={(e) => set({ note: e.target.value })}
          className="w-full rounded border border-edge bg-deck px-2 py-1 text-sm outline-none placeholder:text-faint focus:border-cyan pointer-coarse:min-h-10"
        />

        <p className="text-faint">The defender's card will say: {saidBy(req.by ?? { role: 'gm', name: 'GM' })}.</p>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-accent w-full py-2.5 text-sm" disabled={busy} onClick={submit}>
          {busy ? 'Declaring…' : 'Declare'}
        </button>
      </div>
    </Sheet>
  );
}
