/**
 * The fight rail: the initiative tracker over the session log, beside the
 * canvas (UX proposal 4.1). Running a fight used to mean the Table screen
 * for the tracker and the Map for the tokens, a screen change per turn. The
 * map is what the players orient around, so the fight lives next to it.
 *
 * Both panels are the Table page's own components — the Table still exists
 * for the TV and for a player who wants the log big. The rail follows the
 * scene's fight, and the GM starts one here from the map's tokens.
 */
import type { Token } from '@safehouse/contracts';
import { getSession } from '../../../api/session.js';
import { useTrackerEncounter } from '../../table/commands.js';
import LogStream from '../../table/LogStream.js';
import Tracker from '../../table/Tracker.js';
import '../../table/table.css';
import FightFromMap from './FightFromMap.js';

export interface PlayRailProps {
  campaignId: string;
  /** The map's scene: the rail shows its fight. */
  sceneId?: string | null;
  sceneName?: string;
  /** The scene's tokens, for "Add N new tokens". */
  tokens?: readonly Token[];
  onCollapse: () => void;
}

export default function PlayRail({ campaignId, sceneId = null, sceneName = 'Fight', tokens = [], onCollapse }: PlayRailProps) {
  const isGm = getSession()?.role === 'gm';
  const { encounter, fetched } = useTrackerEncounter(campaignId, null, sceneId);
  // Not before the server has answered: a second "Start" would stage a second fight.
  const start =
    isGm && sceneId && fetched ? (
      <FightFromMap campaignId={campaignId} sceneId={sceneId} sceneName={sceneName} tokens={tokens} encounter={encounter} />
    ) : null;
  return (
    <aside
      data-testid="play-rail"
      aria-label="The fight and the log"
      // Beside the canvas on a wide screen; under it, full width and capped,
      // on a laptop — the page's own layout switches at the same breakpoint.
      className="hidden max-h-[42dvh] min-h-0 w-full shrink-0 flex-col border-t border-edge bg-deck md:flex xl:max-h-none xl:w-96 xl:border-l xl:border-t-0"
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1">
        <span className="mono-label text-dim">the fight · the log</span>
        <span className="ml-auto" />
        {start}
        <button
          type="button"
          className="btn px-2 py-0.5"
          title="Hide the rail (the tracker chip brings it back)"
          onClick={onCollapse}
        >
          hide
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row xl:flex-col">
        <div className="flex min-h-0 basis-1/2 flex-col overflow-y-auto">
          <Tracker campaignId={campaignId} sceneId={sceneId} emptyAction={start} />
        </div>
        <div className="flex min-h-0 basis-1/2 flex-col border-edge md:border-l xl:border-l-0 xl:border-t">
          <LogStream campaignId={campaignId} />
        </div>
      </div>
    </aside>
  );
}
