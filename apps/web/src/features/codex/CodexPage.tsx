/**
 * `/c/:campaignId/codex` and `/c/:campaignId/codex/:pageId` — the campaign
 * wiki (M5, FR5.1–5.4).
 *
 * Table-wide, not a GM screen: players browse shared lore during sessions (§4).
 * What differs by role is what the server sends, never what this component
 * decides to draw (Principle 4).
 *
 * Phone-first: the list and the page stack; on a laptop the browser pane sits
 * beside the page so the GM can jump around while reading.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSession } from '../../api/session.js';
import { useCodexLive } from './live.js';
import PageBrowser from './PageBrowser.js';
import PageView from './PageView.js';

export default function CodexPage() {
  const { campaignId, pageId } = useParams<{ campaignId: string; pageId?: string }>();
  const session = getSession();
  const isGm = session?.role === 'gm';
  // A reveal mid-session lands here without a refresh (§11 `wiki.revealed`).
  useCodexLive(campaignId);
  // A `[[link]]` with no page behind it hands its title to the create form.
  const [pendingTitle, setPendingTitle] = useState<string | undefined>(undefined);

  if (!campaignId) return null;

  return (
    <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-3.25rem)] lg:flex-row">
      <div className="flex min-h-0 flex-col border-b border-edge p-4 lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="mono-label text-cyan">Codex</div>
        <p className="mono-label mb-3 text-faint">
          {isGm ? 'everything — reveal deliberately' : 'what the team knows'}
        </p>
        <PageBrowser
          campaignId={campaignId}
          isGm={isGm}
          {...(pendingTitle ? { pendingTitle } : {})}
          onPendingHandled={() => setPendingTitle(undefined)}
        />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {pageId ? (
          <PageView
            campaignId={campaignId}
            pageId={pageId}
            isGm={isGm}
            onCreatePrompt={setPendingTitle}
          />
        ) : (
          <div className="p-6">
            <p className="text-sm text-dim">
              Pick a page — NPCs, factions, locations, runs, the lore the team has actually earned.
            </p>
            <p className="mt-2 text-sm text-faint">
              {isGm
                ? 'Pages are GM-only until you reveal them, and each `##` section reveals on its own (FR5.2).'
                : 'You see what the GM has shared. The rest is not hidden in your browser — it never left the server.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
