/**
 * The fight rail: the initiative tracker over the session log, beside the
 * canvas (UX proposal 4.1). Running a fight used to mean the Table screen
 * for the tracker and the Map for the tokens, a screen change per turn. The
 * map is what the players orient around, so the fight lives next to it.
 *
 * Both panels are the Table page's own components, unchanged — the Table
 * still exists for the TV and for a player who wants the log big. This is a
 * layout decision, not a data one.
 */
import LogStream from '../../table/LogStream.js';
import Tracker from '../../table/Tracker.js';
import '../../table/table.css';

export interface PlayRailProps {
  campaignId: string;
  onCollapse: () => void;
}

export default function PlayRail({ campaignId, onCollapse }: PlayRailProps) {
  return (
    <aside
      data-testid="play-rail"
      aria-label="The fight and the log"
      // Beside the canvas on a wide screen; under it, full width and capped,
      // on a laptop — the page's own layout switches at the same breakpoint.
      className="hidden max-h-[42dvh] min-h-0 w-full shrink-0 flex-col border-t border-edge bg-deck md:flex xl:max-h-none xl:w-96 xl:border-l xl:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-edge px-2 py-1">
        <span className="mono-label text-dim">the fight · the log</span>
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
          <Tracker campaignId={campaignId} />
        </div>
        <div className="flex min-h-0 basis-1/2 flex-col border-edge md:border-l xl:border-l-0 xl:border-t">
          <LogStream campaignId={campaignId} />
        </div>
      </div>
    </aside>
  );
}
