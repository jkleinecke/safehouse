/**
 * The fight starts from the map the GM is looking at (FR9.10): every runner
 * and NPC token on the scene becomes a row, hidden tokens as GM-only rows.
 * With a fight already on the scene, tokens it has not got yet join it.
 */
import type { Combatant, Encounter, Token } from '@safehouse/contracts';
import { useStartFight } from '../api.js';

/** Tokens on the map that fight (runners, NPCs, flagged props) and have no row in the fight yet. */
export function newTokenCount(
  tokens: readonly Pick<Token, 'id' | 'source' | 'combatant'>[],
  combatants: readonly Pick<Combatant, 'tokenId'>[],
): number {
  const linked = new Set(combatants.flatMap((c) => (c.tokenId ? [c.tokenId] : [])));
  return tokens.filter((t) => (t.source !== 'prop' || t.combatant === true) && !linked.has(t.id)).length;
}

/** The scene's own fight, if the tracker's is this scene's and not over. */
export function sceneFight(encounter: Encounter | null, sceneId: string): Encounter | null {
  return encounter && encounter.sceneId === sceneId && encounter.state !== 'done' ? encounter : null;
}

export interface FightFromMapProps {
  campaignId: string;
  sceneId: string;
  sceneName: string;
  tokens: readonly Token[];
  /** The fight the tracker shows for this scene (any other fight counts as none). */
  encounter: Encounter | null;
}

export default function FightFromMap({ campaignId, sceneId, sceneName, tokens, encounter }: FightFromMapProps) {
  const start = useStartFight(campaignId);
  const fight = sceneFight(encounter, sceneId);
  const count = fight ? newTokenCount(tokens, fight.combatants ?? []) : 0;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {fight ? (
        <button
          type="button"
          className={`btn px-2 py-0.5 ${count > 0 ? 'border-cyan text-cyan' : ''}`}
          disabled={start.isPending}
          onClick={() => start.mutate({ sceneId, encounterId: fight.id })}
          title={
            count > 0
              ? `Add ${count} new token${count === 1 ? '' : 's'} to the fight: tokens placed since it was staged join it`
              : 'Every token on the map is in the fight already'
          }
          aria-label={count > 0 ? `Add ${count} new token${count === 1 ? '' : 's'} to the fight` : 'Add new tokens to the fight'}
        >
          {count > 0 ? `Add ${count}` : 'Add'}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-accent px-2 py-0.5"
          data-testid="start-fight"
          disabled={start.isPending}
          onClick={() => start.mutate({ sceneId, name: sceneName })}
          title="Start the fight from this map: every runner and NPC token becomes a row; hidden tokens stay hidden"
          aria-label="Start the fight from the map"
        >
          Start
        </button>
      )}
      {start.isError && <span className="mono-label text-danger">could not stage it, try again</span>}
    </span>
  );
}
