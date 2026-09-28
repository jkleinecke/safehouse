/**
 * The GM's view of one fighter: the attacks open on it, "Declare an attack",
 * and its actions, each opening its card. In the Play panel for the picked
 * token, and above the list on the GM's Actions sheet.
 */
import { useMemo } from 'react';
import type { CardActorRef, Combatant, Token } from '@safehouse/contracts';
import { useTrackerEncounter } from '../table/commands.js';
import ActionList from './ActionList.js';
import { useActorActions } from './cardApi.js';
import { useGmExchanges } from './gmApi.js';
import { openGmCard } from './gmCard.js';
import GmIncoming, { AppliedLines } from './GmIncoming.js';

function rowOf(rows: readonly Combatant[], actor: CardActorRef): Combatant | undefined {
  if (actor.kind === 'combatant') return rows.find((c) => c.id === actor.id);
  if (actor.kind === 'token') return rows.find((c) => c.tokenId === actor.id);
  return rows.find((c) => c.source === 'character' && c.sourceId === actor.id);
}

export function GmActorBlock({
  campaignId,
  sceneId = null,
  actor,
  name,
}: {
  campaignId: string;
  sceneId?: string | null;
  actor: CardActorRef;
  name: string;
}) {
  const { encounter } = useTrackerEncounter(campaignId, null, sceneId);
  const row = rowOf(encounter?.combatants ?? [], actor);
  const open = useGmExchanges(encounter?.id);
  const mine = row ? open.filter((x) => x.target.combatantId === row.id) : [];
  return (
    <div className="mb-3 space-y-1">
      {mine.map((x) => (
        <GmIncoming key={x.id} x={x} row={row} />
      ))}
      {row && <AppliedLines combatantId={row.id} />}
      <button
        type="button"
        className="btn w-full py-1.5 text-xs pointer-coarse:min-h-10"
        onClick={() =>
          openGmCard({ kind: 'declare', target: row ? { kind: 'combatant', id: row.id } : actor, targetName: name })
        }
        title="A tabletop attack: who, hits, DV, AP, fire mode"
        aria-label={`Declare attack on ${name}`}
      >
        Declare attack
      </button>
    </div>
  );
}

export default function TokenCombat({
  campaignId,
  sceneId,
  token,
  onClose,
}: {
  campaignId: string;
  sceneId: string;
  token: Token;
  onClose: () => void;
}) {
  const actor = useMemo<CardActorRef>(() => ({ kind: 'token', id: token.id }), [token.id]);
  const actions = useActorActions(actor);
  const runner = token.source === 'character';
  return (
    <section
      data-testid="token-combat"
      aria-label={`${token.name}: actions`}
      className="max-h-[32rem] shrink-0 overflow-y-auto border-b border-edge px-3 py-2"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="mono-label min-w-0 flex-1 truncate text-cyan">{token.name}</span>
        <button type="button" className="btn px-2 py-0.5" title="Deselect" aria-label="Deselect" onClick={onClose}>
          ✕
        </button>
      </div>
      <GmActorBlock campaignId={campaignId} sceneId={sceneId} actor={actor} name={token.name} />
      {actions.data ? (
        <ActionList
          actions={actions.data}
          onPick={(a) => openGmCard({ kind: 'act', actor, title: token.name, runner, start: { action: a } })}
        />
      ) : (
        <p className="text-xs text-faint" role="status">
          {actions.isError ? 'No actions for this token.' : 'Loading the actions…'}
        </p>
      )}
    </section>
  );
}
