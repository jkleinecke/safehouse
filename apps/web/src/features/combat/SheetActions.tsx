/** Sheet ▸ Combat: the runner's actions, each opening its roll card. */
import { useMemo, useState } from 'react';
import type { CardActorRef, DeclaredBy } from '@safehouse/contracts';
import { getSession } from '../../api/session.js';
import ActionList from './ActionList.js';
import { useActorActions, type ActionSummary } from './cardApi.js';
import CardFlow from './CardFlow.js';

export interface SheetActionsProps {
  campaignId: string;
  characterId: string;
  characterName: string;
  skills?: readonly string[];
}

export default function SheetActions({ campaignId, characterId, characterName, skills }: SheetActionsProps) {
  const gm = getSession()?.role === 'gm';
  const actor = useMemo<CardActorRef>(() => ({ kind: 'character', id: characterId }), [characterId]);
  const actions = useActorActions(actor);
  const [picked, setPicked] = useState<ActionSummary | null>(null);
  // The GM on a runner's sheet is entering it for the player at the table.
  const forActorBy: DeclaredBy | undefined = gm ? { role: 'player', name: characterName } : undefined;

  return (
    <section className="mt-4" aria-label="Actions">
      <div className="mono-label mb-2">Actions</div>
      {actions.data ? (
        <ActionList actions={actions.data} onPick={setPicked} />
      ) : (
        <p className="text-xs text-faint" role="status">
          {actions.isError ? 'The actions could not be loaded.' : 'Loading the actions…'}
        </p>
      )}
      {picked && (
        <CardFlow
          campaignId={campaignId}
          actor={actor}
          title={characterName}
          mode={{ kind: 'card', action: picked }}
          gm={gm}
          {...(forActorBy ? { forActorBy } : {})}
          {...(skills ? { skills } : {})}
          onClose={() => setPicked(null)}
        />
      )}
    </section>
  );
}
