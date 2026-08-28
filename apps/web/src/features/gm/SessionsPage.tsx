/**
 * /c/:campaignId/gm/sessions — M6: session records with start/end (live mode),
 * attendance, the housekeeping queue of pending ledger approvals (FR3.6), and
 * the recap editor with its publish-to-Discord action (FR6.3).
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCampaign } from '../../api/campaigns.js';
import Housekeeping from './sessions/Housekeeping.js';
import RecapEditor from './sessions/RecapEditor.js';
import SessionList from './sessions/SessionList.js';
import { useSessions } from './sessions/api.js';
import { GmGuard, SectionTitle } from './ui.js';

export default function SessionsPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data: campaign } = useCampaign(campaignId);
  const sessions = useSessions(campaignId ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the live session, else the newest record.
  useEffect(() => {
    if (selectedId || !sessions.data || sessions.data.length === 0) return;
    const live = sessions.data.find((s) => s.state === 'live');
    const newest = [...sessions.data].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    setSelectedId(live?.id ?? newest?.id ?? null);
  }, [sessions.data, selectedId]);

  if (!campaignId) return null;
  const selected = (sessions.data ?? []).find((s) => s.id === selectedId) ?? null;
  const settings = (campaign as { settings?: { webhookUrl?: string | null } } | undefined)?.settings;
  const webhookConfigured = settings ? Boolean(settings.webhookUrl) : undefined;

  return (
    <GmGuard>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle hint="run the night, then close the books">Sessions</SectionTitle>
          {campaign?.ingameDate && (
            <span className="chip text-faint">in-game {campaign.ingameDate}</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <SessionList
              campaignId={campaignId}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <Housekeeping campaignId={campaignId} />
          </div>

          {selected ? (
            <RecapEditor
              campaignId={campaignId}
              session={selected}
              {...(campaign?.ingameDate ? { ingameDate: campaign.ingameDate } : {})}
              {...(webhookConfigured !== undefined ? { webhookConfigured } : {})}
            />
          ) : (
            <div className="panel p-6 text-sm text-dim">
              Pick a session (or start a new one) to write its recap.
            </div>
          )}
        </div>
      </div>
    </GmGuard>
  );
}
