/**
 * The GM's side of an open attack (p.173), on the target's row and token:
 * the defenses (the free test first, all offered), then the soak, then the
 * boxes onto the monitor with Undo. Cancel at any step.
 */
import { useState } from 'react';
import type { Combatant, Exchange } from '@safehouse/contracts';
import { Stepper } from '../sheet/components/ui.js';
import { applyExchange, cancelExchange, undoExchange } from './gmApi.js';
import { forgetApplied, openGmCard, rememberApplied, useApplied } from './gmCard.js';
import { saidBy, stepLine } from './gmModel.js';

/** The GM's order for an incoming attack (the free test first). */
const DEFENSES: readonly [string, string][] = [
  ['defense', 'Defend'],
  ['full_defense', 'Full Defense'],
  ['dodge', 'Dodge'],
  ['block', 'Block'],
  ['parry', 'Parry'],
];

function failText(e: unknown): string {
  return e instanceof Error ? e.message : 'That did not go through.';
}

const small = 'btn px-2 py-0.5 text-xs pointer-coarse:min-h-10';

export interface GmIncomingProps {
  x: Exchange;
  /** The target's row, to tell a runner from an NPC. */
  row?: Combatant | undefined;
  /** In a list of every open attack: name the target too. */
  named?: boolean;
}

export default function GmIncoming({ x, row, named }: GmIncomingProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<number | null>(null);
  const targetId = x.target.combatantId;
  const who = targetId
    ? { actor: { kind: 'combatant' as const, id: targetId }, title: x.target.name, runner: row?.source === 'character' }
    : null;

  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    fn()
      .catch((e: unknown) => setError(failText(e)))
      .finally(() => setBusy(false));
  };

  const defend = (id?: string) =>
    who &&
    openGmCard({
      ...who,
      kind: 'defend',
      exchangeId: x.id,
      against: x.attack,
      ...(id ? { start: { action: { id } } } : {}),
    });

  const n = boxes ?? x.boxes ?? 0;
  let actions;
  if (x.state === 'awaiting_defense') {
    actions =
      x.attack === 'direct-spell' ? (
        <button type="button" className={`${small} btn-accent`} onClick={() => defend()}>
          Resist
        </button>
      ) : (
        <>
          {DEFENSES.map(([id, label], i) => (
            <button key={id} type="button" className={`${small} ${i === 0 ? 'btn-accent' : ''}`} onClick={() => defend(id)}>
              {label}
            </button>
          ))}
          <button type="button" className={small} onClick={() => defend()} title="Every defense, Hit the Dirt included">
            More…
          </button>
        </>
      );
  } else if (x.state === 'awaiting_soak') {
    actions = (
      <button
        type="button"
        className={`${small} btn-accent`}
        onClick={() => who && openGmCard({ ...who, kind: 'soak', exchangeId: x.id })}
        title="Resist damage"
        aria-label="Resist damage"
      >
        Resist
      </button>
    );
  } else {
    actions = (
      <>
        <Stepper value={n} min={0} max={40} onChange={setBoxes} label="boxes" />
        <button
          type="button"
          className={`${small} btn-accent`}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const done = await applyExchange(x.id, n !== x.boxes ? { boxes: n } : {});
              // Nothing reached the monitor with 0 boxes: nothing to undo.
              if ((done.boxes ?? 0) > 0) rememberApplied(done);
            })
          }
        >
          Apply {n} {n === 1 ? 'box' : 'boxes'}
        </button>
      </>
    );
  }

  return (
    <div
      className="mt-1.5 rounded border border-magenta-dim bg-deck/80 px-2 py-1.5"
      data-testid="gm-incoming"
      data-state={x.state}
    >
      <p className="text-xs text-ink">
        {named && <span className="font-semibold">{x.target.name}: </span>}
        {stepLine(x)}
        <span className="text-faint"> · {saidBy(x.declared.by)}</span>
      </p>
      {x.declared.note && <p className="text-[0.65rem] text-faint">{x.declared.note}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {actions}
        <button
          type="button"
          className={`${small} ml-auto text-faint`}
          disabled={busy}
          onClick={() => run(() => cancelExchange(x.id))}
          title="Cancel this attack"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Boxes this screen put on a row, with Undo while it is the row's last damage. */
export function AppliedLines({ combatantId }: { combatantId: string }) {
  const list = useApplied((s) => s.list).filter((x) => x.target.combatantId === combatantId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (list.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {list.map((x) => (
        <p key={x.id} className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
          <span className="min-w-0 flex-1">
            {x.boxes ?? 0} {x.track === 'stun' ? 'Stun' : 'Physical'} from {x.attacker?.name ?? 'someone'} applied
          </span>
          <button
            type="button"
            className={small}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              undoExchange(x.id)
                .then(() => forgetApplied(x.id))
                .catch((e: unknown) => setError(failText(e)))
                .finally(() => setBusy(false));
            }}
          >
            Undo
          </button>
          <button type="button" className={`${small} text-faint`} onClick={() => forgetApplied(x.id)} aria-label="Dismiss">
            ✕
          </button>
        </p>
      ))}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
