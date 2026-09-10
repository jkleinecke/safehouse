/**
 * Shell layout for /c/:campaignId/* — campaign header (name + in-game date),
 * connection chip, GM sidebar on desktop, player bottom-nav on phones.
 * Mounts the live WS connection for the whole campaign subtree.
 */
import { useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { useCampaign, useMyCharacterId } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import FixerDock from '../../features/gm/fixer/FixerDock.js';
import { useLiveConnection } from '../../live/useLiveConnection.js';
import BottomNav from './BottomNav.js';
import ConnectionChip from './ConnectionChip.js';
import GmSidebar from './GmSidebar.js';
import JoinQrModal from './JoinQrModal.js';
import SessionMenu from './SessionMenu.js';
import { useSessionExpiry } from './useSessionExpiry.js';

function NoSession() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel max-w-sm p-8 text-center">
        <div className="mono-label text-cyan">Safehouse</div>
        <h1 className="mt-4 text-lg font-semibold">No device token</h1>
        <p className="mt-2 text-sm text-dim">
          This device hasn't joined the campaign. Scan the GM's join QR, or sign in from the front
          door — a GM can start a campaign or pair with a code there.
        </p>
        <Link className="btn btn-accent mt-5 w-full" to="/">
          go to sign-in
        </Link>
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
  const [qr, setQr] = useState<{ open: boolean; role: Role }>({ open: false, role: 'player' });
  // A token the server has revoked used to render this whole shell in silence
  // while every call 401'd. Now it retires itself and this tab goes back to
  // the front door, where the campaign picker still has the sessions that work.
  useSessionExpiry(session?.token);

  if (!session || !campaignId) return <NoSession />;

  const isGm = session.role === 'gm';
  const name = campaign?.name ?? 'Campaign';

  // The shell is exactly one viewport tall and the main column scrolls inside
  // it: a page can never grow the document. The Grid depends on that — its
  // canvas fills what is left beside the GM panel, and a long panel tab used
  // to stretch the row, grow the canvas under a camera that had already
  // fitted the map, and put every click half a cell off (docs/UX_MAP_BUILDER.md §3.2).
  return (
    <div className="flex h-dvh bg-ground text-ink">
      {isGm && (
        <GmSidebar
          campaignId={campaignId}
          onShowQr={() => setQr({ open: true, role: 'player' })}
          onShowDisplayQr={() => setQr({ open: true, role: 'display' })}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-edge bg-deck/95 px-4 py-2.5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-wide">{name}</h1>
            <div className="mono-label text-faint">
              {campaign?.ingameDate ?? '2076-??-??'}
            </div>
          </div>
          <ConnectionChip status={status} />
          {/* Which device this tab is, and how to hop to another (FR1.1/1.3). */}
          <SessionMenu
            role={session.role}
            campaignId={session.campaignId}
            displayName={session.displayName}
          />
          {isGm && (
            <button
              className="btn btn-accent px-3 py-1.5"
              onClick={() => setQr({ open: true, role: 'player' })}
              aria-label="Show join QR"
            >
              QR
            </button>
          )}
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        <BottomNav
          campaignId={campaignId}
          role={session.role}
          characterId={myCharacterId ?? undefined}
        />
      </div>

      <JoinQrModal
        campaignId={campaignId}
        open={qr.open}
        initialRole={qr.role}
        onClose={() => setQr((s) => ({ ...s, open: false }))}
      />

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
