/**
 * Shell layout for /c/:campaignId/* — campaign header (name + in-game date),
 * connection chip, GM sidebar on desktop, player bottom-nav on phones.
 * Mounts the live WS connection for the whole campaign subtree.
 */
import { useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useCampaign, useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import FixerDock from '../../features/gm/fixer/FixerDock.js';
import { useLiveConnection } from '../../live/useLiveConnection.js';
import BottomNav from './BottomNav.js';
import ConnectionChip from './ConnectionChip.js';
import GmSidebar from './GmSidebar.js';
import JoinQrModal from './JoinQrModal.js';

function NoSession() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel max-w-sm p-8 text-center">
        <div className="mono-label text-cyan">Safehouse</div>
        <h1 className="mt-4 text-lg font-semibold">No device token</h1>
        <p className="mt-2 text-sm text-dim">
          This device hasn't joined the campaign. Scan the GM's join QR to get in.
        </p>
      </div>
    </main>
  );
}

export default function CampaignLayout() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  const status = useLiveConnection(campaignId);
  const { data: campaign } = useCampaign(campaignId);
  const myCharacterId = useMyCharacterId(campaignId);
  const [qrOpen, setQrOpen] = useState(false);

  if (!session || !campaignId) return <NoSession />;

  const isGm = session.role === 'gm';
  const name = campaign?.name ?? 'Campaign';

  return (
    <div className="flex min-h-dvh bg-ground text-ink">
      {isGm && <GmSidebar campaignId={campaignId} onShowQr={() => setQrOpen(true)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-edge bg-deck/95 px-4 py-2.5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-wide">{name}</h1>
            <div className="mono-label text-faint">
              {campaign?.ingameDate ?? '2076-??-??'}
              <span className="mx-1.5 text-edge-bright">/</span>
              {session.role}
            </div>
          </div>
          <ConnectionChip status={status} />
          {isGm && (
            <button
              className="btn btn-accent px-3 py-1.5"
              onClick={() => setQrOpen(true)}
              aria-label="Show join QR"
            >
              QR
            </button>
          )}
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        <BottomNav
          campaignId={campaignId}
          role={session.role}
          characterId={myCharacterId ?? undefined}
        />
      </div>

      <JoinQrModal campaignId={campaignId} open={qrOpen} onClose={() => setQrOpen(false)} />

      {/* Follows the GM across every screen; hides itself when AI is off (NG7). */}
      {isGm && (
        <FixerDock
          campaignId={campaignId}
          sessionLive={campaign?.activeSessionId != null}
        />
      )}
    </div>
  );
}
