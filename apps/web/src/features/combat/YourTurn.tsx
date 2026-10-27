/**
 * The runner's turn, on their own screen: "Your turn" with Act and Done while
 * their row acts, "On deck" when they are next, and otherwise whose turn it
 * is. Nothing here waits on the phone — the GM's Next runs the order whether
 * or not anyone presses Done (the table may be playing without the app), and
 * Act works on any turn.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Encounter } from '@safehouse/contracts';
import { useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { postEndTurn, useTrackerEncounter } from '../table/commands.js';
import { turnQueue, type QueueEntry, type Viewer } from '../table/initiative.js';

export interface TurnQueueView {
  encounter: Encounter | null;
  queue: QueueEntry[];
  acting: QueueEntry | undefined;
  onDeck: QueueEntry | undefined;
  viewer: Viewer;
  /** The server has answered the first read. */
  fetched: boolean;
}

/** The fight on this screen (the scene's, else the live one) and its turn queue, for this viewer. */
export function useTurnQueue(campaignId: string, sceneId: string | null): TurnQueueView {
  const session = getSession();
  const myCharacterId = useMyCharacterId(campaignId);
  const viewer: Viewer = useMemo(
    () => ({ role: session?.role ?? 'observer', ...(myCharacterId ? { characterId: myCharacterId } : {}) }),
    [session?.role, myCharacterId],
  );
  const { encounter, fetched } = useTrackerEncounter(campaignId, null, sceneId);
  const queue = useMemo(() => turnQueue(encounter, viewer), [encounter, viewer]);
  return {
    encounter,
    queue,
    acting: queue.find((e) => e.state === 'acting'),
    onDeck: queue.find((e) => e.state === 'next'),
    viewer,
    fetched,
  };
}

export interface YourTurnProps {
  campaignId: string;
  sceneId?: string | null;
  /** Opens the act sheet (the map's runner token); left out where the actions are already on screen. */
  onAct?: () => void;
  /** `map`: chips in the HUD row; `sheet`: a block above the sheet's actions. */
  variant?: 'map' | 'sheet';
}

export default function YourTurn({ campaignId, sceneId = null, onAct, variant = 'map' }: YourTurnProps) {
  const { encounter, acting, onDeck } = useTurnQueue(campaignId, sceneId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = acting?.own === true;
  const turnKey = mine && encounter ? `${encounter.id}:${encounter.turn}:${encounter.pass}:${acting.combatant.id}` : null;

  // One buzz as the turn comes round, not on every frame of it.
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (!turnKey || buzzed.current === turnKey) return;
    buzzed.current = turnKey;
    setError(null);
    try {
      navigator.vibrate?.([120, 60, 120]);
    } catch {
      // A browser that refuses is a browser without a buzz.
    }
  }, [turnKey]);

  if (!encounter || encounter.state !== 'live' || encounter.gathering) return null;

  const done = () => {
    if (!acting || busy) return;
    setBusy(true);
    setError(null);
    postEndTurn(encounter.id, acting.combatant.id, { turn: encounter.turn, pass: encounter.pass })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not go through.'))
      .finally(() => setBusy(false));
  };

  const block = variant === 'sheet';

  if (mine) {
    const next = onDeck && onDeck.combatant.id !== acting.combatant.id ? onDeck.combatant.name : null;
    return (
      <div
        data-testid="your-turn"
        role="status"
        aria-live="assertive"
        className={`pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-cyan bg-panel/95 shadow-lg ${
          block ? 'mb-3 px-3 py-2' : 'px-3 py-1.5'
        }`}
      >
        <span className="font-label text-base uppercase tracking-wide text-cyan">Your turn</span>
        <span className="mono-label text-faint">
          pass {acting.pass} · {acting.score}
        </span>
        {onAct && (
          <button
            type="button"
            className="btn btn-accent px-3 py-1 pointer-coarse:min-h-10"
            title="Your actions, each with its roll card"
            onClick={onAct}
          >
            Act
          </button>
        )}
        <button
          type="button"
          className="btn px-3 py-1 pointer-coarse:min-h-10"
          disabled={busy}
          title={`End your Action Phase${next ? `; ${next} is up` : ''}`}
          onClick={done}
        >
          Done
        </button>
        {error && <span className="w-full text-xs text-warn">{error}</span>}
      </div>
    );
  }

  const up = acting?.combatant.name ?? (encounter.gmTurn ? 'GM’s turn' : null);
  const deck = onDeck?.own === true;
  if (!up && !deck) return null;
  return (
    <span
      data-testid="whose-turn"
      className={`chip pointer-events-auto bg-panel/90 ${deck ? 'border-warn text-warn' : 'text-dim'} ${
        block ? 'mb-3' : deck ? '' : 'hidden md:inline-flex'
      }`}
      title={deck ? 'You act after this turn' : 'Whose Action Phase it is'}
    >
      {deck ? 'On deck' : null}
      {deck && up ? ' · ' : null}
      {up ? `up: ${up}` : null}
    </span>
  );
}
