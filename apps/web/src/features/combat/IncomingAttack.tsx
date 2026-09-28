/**
 * The runner's side of an attack exchange (p.173): an attack on them offers a
 * Defend card, a hit then the damage resistance card, and their own attacks
 * come back as Hit, Grazed or Miss. All optional: the GM can do it for them.
 */
import { useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Token } from '@safehouse/contracts';
import { useMyCharacterId } from '../../api/campaigns.js';
import { useLiveStore } from '../../live/store.js';
import { useTrackerEncounter } from '../table/commands.js';
import { isOwnCombatant } from '../table/initiative.js';
import CardFlow, { type CardFlowMode } from './CardFlow.js';
import {
  OUTCOME_WORD,
  attackFacts,
  exchangeTasks,
  latestExchanges,
  type ExchangeTask,
  type SeenExchange,
} from './cardModel.js';

/** How long an outcome stays news. */
const NEWS_MS = 10 * 60_000;

/** Dismissed per state, so the next step of the same exchange shows again. */
const useDismissed = create<{ ids: Record<string, true>; dismiss: (key: string) => void }>()((set) => ({
  ids: {},
  dismiss: (key) => set((s) => ({ ids: { ...s.ids, [key]: true } })),
}));

const keyOf = (t: ExchangeTask) => `${t.x.id}:${t.x.state}:${t.kind}`;

function line(t: ExchangeTask): string {
  const x = t.x;
  const from = x.attacker?.name ?? 'Someone';
  switch (t.kind) {
    case 'defend':
      return `${from} attacks you: ${attackFacts(x)}`;
    case 'soak':
      return x.damage
        ? `Hit: resist ${x.damage.modifiedDv}${x.damage.type}, armor ${x.damage.modifiedArmor}`
        : `Hit by ${from}: resist the damage`;
    case 'apply':
      return `${x.boxes ?? 0} ${x.track === 'stun' ? 'Stun' : 'Physical'} boxes from ${from}: the GM puts them on`;
    case 'defended':
      if (x.outcome === 'miss') return `${from} missed you`;
      if (x.outcome === 'graze') return `${from} grazed you: no damage`;
      return x.appliedAt ? `${x.boxes ?? 0} boxes from ${from} on your monitor` : `Hit by ${from}`;
    case 'attacked':
      return `Your attack on ${x.target.name}: ${x.outcome ? OUTCOME_WORD[x.outcome] : ''}`;
  }
}

export interface IncomingAttackProps {
  campaignId: string;
  sceneId?: string | null;
  /** The runner's tracker rows (usually one). */
  myCombatantIds: readonly string[];
  skills?: readonly string[];
  tokens?: readonly Token[];
}

export default function IncomingAttack(props: IncomingAttackProps) {
  const events = useLiveStore((s) => s.events);
  // Outcomes only once seen here: a reload does not replay old news.
  const since = useRef(useLiveStore.getState().lastEventId);
  const dismissed = useDismissed((s) => s.ids);
  const dismiss = useDismissed((s) => s.dismiss);
  const [open, setOpen] = useState<{ combatantId: string; mode: CardFlowMode; title: string } | null>(null);

  const mine = useMemo(() => new Set(props.myCombatantIds), [props.myCombatantIds]);
  const tasks = useMemo(() => {
    const fresh = (s: SeenExchange) => s.eventId > since.current && Date.now() - Date.parse(s.ts) < NEWS_MS;
    return exchangeTasks(latestExchanges(events), mine, fresh).filter((t) => !dismissed[keyOf(t)]);
  }, [events, mine, dismissed]);

  if (tasks.length === 0 && !open) return null;

  const act = (t: ExchangeTask) => {
    const id = t.x.target.combatantId;
    if (!id) return;
    if (t.kind === 'defend') {
      setOpen({ combatantId: id, mode: { kind: 'defend', exchangeId: t.x.id, against: t.x.attack }, title: 'Defend' });
    } else if (t.kind === 'soak') {
      setOpen({ combatantId: id, mode: { kind: 'card', action: { id: 'soak' }, exchangeId: t.x.id }, title: 'Resist damage' });
    }
  };

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-3 z-40 mx-auto flex w-[min(100%-2rem,28rem)] flex-col gap-1.5"
        data-testid="incoming-attack"
        aria-live="polite"
      >
        {tasks.map((t) => {
          const answer = t.kind === 'defend' || t.kind === 'soak';
          return (
            <div
              key={keyOf(t)}
              className={`flex items-center gap-2 rounded-lg border bg-panel/95 px-3 py-2 shadow-lg ${answer ? 'border-magenta-dim' : 'border-edge'}`}
            >
              <span className={`min-w-0 flex-1 text-sm ${answer ? 'text-ink' : 'text-dim'}`}>{line(t)}</span>
              {answer && (
                <button type="button" className="btn btn-accent px-3 py-1 pointer-coarse:min-h-10" onClick={() => act(t)}>
                  {t.kind === 'defend' ? 'Defend' : 'Resist'}
                </button>
              )}
              <button
                type="button"
                className="btn px-2 py-1 text-xs pointer-coarse:min-h-10"
                onClick={() => dismiss(keyOf(t))}
                title={answer ? 'Leave it to the GM' : 'Dismiss'}
              >
                {answer ? 'Not now' : '✕'}
              </button>
            </div>
          );
        })}
      </div>
      {open && (
        <CardFlow
          campaignId={props.campaignId}
          sceneId={props.sceneId ?? null}
          actor={{ kind: 'combatant', id: open.combatantId }}
          title={open.title}
          mode={open.mode}
          gm={false}
          {...(props.skills ? { skills: props.skills } : {})}
          {...(props.tokens ? { tokens: props.tokens } : {})}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** On the map: the runner's rows come from the scene's fight. */
export function MapIncoming(props: Omit<IncomingAttackProps, 'myCombatantIds'>) {
  const { encounter } = useTrackerEncounter(props.campaignId, null, props.sceneId ?? null);
  const myCharacterId = useMyCharacterId(props.campaignId);
  const ids = useMemo(() => {
    const viewer = { role: 'player' as const, ...(myCharacterId ? { characterId: myCharacterId } : {}) };
    return (encounter?.combatants ?? []).filter((c) => isOwnCombatant(c, viewer)).map((c) => c.id);
  }, [encounter, myCharacterId]);
  return <IncomingAttack {...props} myCombatantIds={ids} />;
}
