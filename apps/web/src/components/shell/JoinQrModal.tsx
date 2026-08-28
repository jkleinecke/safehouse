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

export interface JoinQrModalProps {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}

export default function JoinQrModal({ campaignId, open, onClose }: JoinQrModalProps) {
  const [role, setRole] = useState<Role>('player');
  const { data, isLoading, error } = useJoinQr(campaignId, role, open);

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
