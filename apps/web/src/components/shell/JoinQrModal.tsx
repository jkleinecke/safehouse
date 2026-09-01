/**
 * GM "Show join QR" modal (FR1.1, §16 "Join QR").
 * Fetches /api/campaigns/:id/join-qr and renders the returned LAN join URL
 * as a QR big enough to scan across the table.
 */
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Role } from '@safehouse/contracts';
import { useJoinQr } from '../../api/campaigns.js';

const ROLES: Role[] = ['player', 'observer', 'display'];

/** Says what each invite is FOR — the display one is the non-obvious case. */
const ROLE_HINT: Record<Role, string> = {
  gm: 'a second GM machine — pair it with a code from the GM console',
  player: 'a runner at the table: their own sheet, the log, the map',
  observer: 'read-only — the active scene, the roll log, shared lore',
  display: 'the table TV: open /tv on that screen and scan this from it',
};

export interface JoinQrModalProps {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Which invite to mint first. The sidebar's "Pair the TV" opens straight on
   * `display`, because a table TV needs a display-role invite of its own and
   * nothing used to say so (the GM's own laptop already counts as bound, so
   * opening the kiosk there just shows "Standing by").
   */
  initialRole?: Role;
}

export default function JoinQrModal({
  campaignId,
  open,
  onClose,
  initialRole = 'player',
}: JoinQrModalProps) {
  const [role, setRole] = useState<Role>(initialRole);
  const { data, isLoading, error } = useJoinQr(campaignId, role, open);

  // Re-opening for a different purpose starts on that purpose's role rather
  // than on whatever the GM last looked at.
  useEffect(() => {
    if (open) setRole(initialRole);
  }, [open, initialRole]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Join QR code"
    >
      <div className="panel w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="mono-label text-cyan">Join this campaign</h2>
          <button className="btn px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              className={`chip cursor-pointer ${
                role === r ? 'border-cyan text-cyan' : 'text-dim hover:text-ink'
              }`}
              onClick={() => setRole(r)}
            >
              {r === 'display' ? 'TV' : r}
            </button>
          ))}
        </div>

        <p className="mono-label mt-2 text-faint">{ROLE_HINT[role]}</p>

        <div className="mt-4 flex min-h-72 items-center justify-center rounded-md border border-edge bg-deck p-4">
          {isLoading && <p className="mono-label animate-pulse">Minting invite…</p>}
          {error != null && (
            <p className="text-center text-sm text-magenta">
              Could not mint an invite. Is the server up?
            </p>
          )}
          {data && (
            <QRCodeSVG
              value={data.url}
              size={248}
              marginSize={2}
              bgColor="#d7e0ea"
              fgColor="#060a12"
              level="M"
            />
          )}
        </div>

        {data && (
          <p className="mt-3 break-all text-center font-label text-xs text-dim">{data.url}</p>
        )}
        <p className="mono-label mt-3 text-center">
          Scan with a phone camera — no passwords, no app store
        </p>
      </div>
    </div>
  );
}
