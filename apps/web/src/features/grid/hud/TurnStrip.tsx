/**
 * The order at a glance, over the tracker in Play mode: TURN · PASS, the row
 * acting (big), who is on deck, then every Action Phase still to come this
 * Combat Turn as chips, split by pass (SR5 p.159: −10 per pass, a row acts
 * again while its score is above 0). The GM's Next is here, one press; the
 * runner whose row acts gets Done. The full tracker stays underneath.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTurnQueue } from '../../combat/YourTurn.js';
import { postAdvance, postEndTurn } from '../../table/commands.js';
import type { QueueEntry } from '../../table/initiative.js';
import { isTypingTarget } from './modes.js';

export interface TurnStripProps {
  campaignId: string;
  sceneId?: string | null;
  /** Enter presses Next for the GM (the rail's strip only: one listener per page). */
  hotkey?: boolean;
}

/** The Next button's tooltip: whose phase ends and what follows. */
export function nextTitle(acting: QueueEntry | undefined, onDeck: QueueEntry | undefined, holding: number): string {
  const after = onDeck
    ? onDeck.pass !== acting?.pass && acting
      ? `the pass ends; ${onDeck.combatant.name} is up`
      : `${onDeck.combatant.name} is up`
    : holding > 0
      ? 'only rows holding a Delayed Action are left'
      : 'a new Combat Turn starts';
  if (!acting) return holding > 0 ? `Move on past the held actions; ${after}` : `On to the next; ${after}`;
  return `End ${acting.combatant.name}’s action phase; ${after}`;
}

export default function TurnStrip({ campaignId, sceneId = null, hotkey = false }: TurnStripProps) {
  const { encounter, queue, acting, onDeck, viewer } = useTurnQueue(campaignId, sceneId);
  const isGm = viewer.role === 'gm';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = encounter?.state === 'live';
  const gathering = live && encounter?.gathering === true;
  const encounterId = encounter?.id ?? null;
  const actingId = acting?.combatant.id ?? null;

  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not go through.'))
      .finally(() => setBusy(false));
  };
  const at = encounter ? { turn: encounter.turn, pass: encounter.pass } : undefined;
  const next = () => {
    if (encounterId) run(() => postAdvance(encounterId, actingId, at));
  };

  // Enter = Next, for the GM, when nothing else has the key (a field, a button, a link).
  const nextRef = useRef(next);
  nextRef.current = next;
  const armed = hotkey && isGm && live && encounterId !== null;
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = e.target as { closest?: (s: string) => unknown } | null;
      if (isTypingTarget(e.target)) return;
      if (el && typeof el.closest === 'function' && el.closest('button, a, [role="dialog"], [contenteditable]')) return;
      e.preventDefault();
      nextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);

  if (!encounter || !live) return null;

  const turn = Math.max(1, encounter.turn);
  const pass = Math.max(1, encounter.pass);
  const holding = queue.filter((e) => e.state === 'holding');
  const later = queue.filter((e) => e.state !== 'acting' && e.state !== 'next');
  const upName = acting?.combatant.name ?? (encounter.gmTurn ? 'GM’s turn' : holding.length > 0 ? 'Held actions' : '—');
  const ownActing = acting?.own === true && !isGm;

  return (
    <div data-testid="turn-strip" className="border-b border-edge bg-panel/60 px-3 py-2" aria-label="The order">
      <div className="flex items-center gap-2">
        <span className="mono-label text-faint">
          TURN {turn} · {gathering ? 'INITIATIVE' : `PASS ${pass}`}
        </span>
        <span className="ml-auto" />
        {isGm && gathering && (
          <button
            type="button"
            className="btn btn-accent px-3 py-1"
            disabled={busy}
            onClick={next}
            title="Start the turn with the scores in; blank rows join late (p.160)"
          >
            Start
          </button>
        )}
        {isGm && !gathering && (
          <button
            type="button"
            data-testid="turn-next"
            className="btn btn-accent px-4 py-1 text-base pointer-coarse:min-h-10"
            disabled={busy}
            onClick={next}
            title={`${nextTitle(acting, onDeck, holding.length)}${hotkey ? ' (Enter)' : ''}`}
          >
            Next
          </button>
        )}
        {ownActing && encounterId && acting && (
          <button
            type="button"
            className="btn btn-accent px-3 py-1 pointer-coarse:min-h-10"
            disabled={busy}
            onClick={() => run(() => postEndTurn(encounterId, acting.combatant.id, at))}
            title="End your Action Phase"
          >
            Done
          </button>
        )}
      </div>

      {gathering ? (
        <p className="mt-1 text-sm text-dim">Initiative is coming in; nobody acts until the turn starts.</p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="mono-label w-16 shrink-0 text-faint">Acting</span>
            <span
              className={`min-w-0 truncate text-lg font-semibold ${acting ? 'text-cyan' : 'text-dim'}`}
              data-testid="turn-acting"
            >
              {upName}
              {acting?.own ? <span className="ml-1.5 text-sm text-cyan">(you)</span> : null}
            </span>
            {acting && <span className="mono-label text-faint">{acting.score}</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="mono-label w-16 shrink-0 text-faint">On deck</span>
            {onDeck ? (
              <span className={`min-w-0 truncate text-sm ${onDeck.own ? 'text-warn' : 'text-ink'}`}>
                {onDeck.combatant.name}
                {onDeck.own ? ' (you)' : ''}
                <span className="mono-label ml-1.5 text-faint">
                  {onDeck.pass !== pass ? `P${onDeck.pass} · ` : ''}
                  {onDeck.score}
                </span>
              </span>
            ) : (
              <span className="text-sm text-faint">{holding.length > 0 ? 'held actions only' : 'new turn'}</span>
            )}
          </div>
          {later.length > 0 && (
            <ol className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Then">
              {later.map((e, i) => {
                const prev = later[i - 1];
                const divider = e.state !== 'holding' && e.pass !== pass && (!prev || prev.pass !== e.pass || prev.state === 'holding');
                return (
                  <Fragment key={`${e.combatant.id}:${e.pass}:${e.state}`}>
                    {divider && (
                      <li className="mono-label px-1 text-faint" aria-label={`Pass ${e.pass}`}>
                        P{e.pass}
                      </li>
                    )}
                    <li
                      className={`chip py-0 text-xs ${
                        e.state === 'holding'
                          ? 'border-warn/70 text-warn'
                          : e.own
                            ? 'border-cyan-dim text-cyan'
                            : 'text-dim'
                      }`}
                      title={
                        e.state === 'holding'
                          ? `${e.combatant.name} is holding a Delayed Action (p.161)`
                          : `${e.combatant.name}: pass ${e.pass}, score ${e.score}`
                      }
                    >
                      {e.combatant.name}
                      {e.state === 'holding' ? ' · holding' : ''}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
        </>
      )}
      {error && (
        <p className="mt-1 text-xs text-warn" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
