/**
 * /c/:campaignId/gm/fixer — the Fixer's own room (M12): the streaming chat
 * with tool-call chips and the live situation snapshot on the left (with
 * the in-character NPC voice under it, FR12.6), the drafts inbox (accept /
 * edit / reject, spoiler-guard flags) on the right.
 * The same chat docks over every other screen via FixerDock.
 */
import { useParams } from 'react-router-dom';
import { useCampaign } from '../../api/campaigns.js';
import AiSettings from './fixer/AiSettings.js';
import DraftsInbox from './fixer/DraftsInbox.js';
import FixerChat from './fixer/FixerChat.js';
import NpcVoice from './fixer/NpcVoice.js';
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

        <div className="mt-4">
          <AiSettings campaignId={campaignId} />
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="flex min-h-[28rem] flex-col gap-4">
            <FixerChat campaignId={campaignId} sessionLive={sessionLive} />
            <NpcVoice campaignId={campaignId} sessionLive={sessionLive} />
          </div>
          <DraftsInbox campaignId={campaignId} />
        </div>
      </div>
    </GmGuard>
  );
}
