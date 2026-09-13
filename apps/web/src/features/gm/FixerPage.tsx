/**
 * /c/:campaignId/gm/fixer — the Fixer's own room (M12): which model it talks
 * to, and the drafts inbox (accept / edit / reject, spoiler-guard flags).
 *
 * The chat is not here any more. It is the dock — one assistant that follows
 * the GM to every screen and knows what that screen shows (UX proposal 4.2)
 * — opened with the corner chip or a backtick. The NPC voice went with it:
 * it opens under "speak as" whenever an NPC token is selected on the map.
 */
import { useParams } from 'react-router-dom';
import { useCampaign } from '../../api/campaigns.js';
import AiSettings from './fixer/AiSettings.js';
import DraftsInbox from './fixer/DraftsInbox.js';
import { GmGuard, SectionTitle } from './ui.js';

export default function FixerPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data: campaign } = useCampaign(campaignId);
  if (!campaignId) return null;
  const sessionLive = Boolean(campaign?.activeSessionId);

  return (
    <GmGuard>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle hint="GM-only, drafts before anything reaches the table">
            The Fixer
          </SectionTitle>
          {sessionLive && (
            <span className="chip border-ok/50 text-ok" title="fast slot during play">
              session live
            </span>
          )}
        </div>
        <p className="mt-2 max-w-prose text-sm text-dim">
          To talk to it, press <kbd className="rounded border border-edge px-1 text-ink">`</kbd> or
          tap <span className="text-ink">ask the fixer</span> in the corner of any screen — it
          knows which scene, page or sheet you have open. Everything it writes arrives here as a
          draft for you to accept or bin.
        </p>

        <div className="mt-4">
          <AiSettings campaignId={campaignId} />
        </div>

        <div className="mt-4">
          <DraftsInbox campaignId={campaignId} />
        </div>
      </div>
    </GmGuard>
  );
}
