/**
 * GM device pairing (FR1.1/1.2 — the half M1 never shipped).
 *
 * `join-qr` refuses `role=gm` by construction, so a second GM machine — a
 * borrowed laptop, a reinstalled phone, the laptop that died on Friday — had
 * no way in. Two buttons close it, both from a console that is already signed
 * in as the GM:
 *
 *   - **pairing code** (`POST …/gm-pair`): single-use, minutes-long, shown as
 *     a big readable code plus a QR of the SPA join URL. The other machine
 *     scans it or types it on the front door.
 *   - **another device for me** (`POST …/gm-device`): mints a token for the
 *     same GM identity and shows it once, for a phone that will not scan.
 *
 * The token is deliberately shown once and never re-queried: `devices` stores
 * only its hash, so there is nothing to go back for.
 */
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useMintGmDevice, useMintPairingCode } from '../../../components/shell/signin-api.js';
import { ErrorNote, SectionTitle } from '../ui.js';

export interface PairPanelProps {
  campaignId: string;
}

function minutesLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60_000));
}

export default function PairPanel({ campaignId }: PairPanelProps) {
  const pair = useMintPairingCode(campaignId);
  const device = useMintGmDevice(campaignId);
  const [label, setLabel] = useState('');

  const code = pair.data;
  const minted = device.data;

  return (
    <div className="panel p-4">
      <SectionTitle hint="a second GM machine, without a console hack">
        Pair a GM device
      </SectionTitle>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-accent px-3 py-1.5"
          disabled={pair.isPending}
          onClick={() => pair.mutate({})}
        >
          {pair.isPending ? 'minting…' : code ? 'new pairing code' : 'show pairing code'}
        </button>
        <input
          className="min-w-0 flex-1 rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label, e.g. GM phone"
          aria-label="Label for a new GM device"
        />
        <button
          className="btn px-3 py-1.5"
          disabled={device.isPending}
          onClick={() => device.mutate(label.trim() ? { label: label.trim() } : {})}
        >
          {device.isPending ? 'minting…' : 'mint token for me'}
        </button>
      </div>

      <ErrorNote error={pair.error ?? device.error} />

      {code && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-md border border-edge bg-deck p-4 sm:flex-row sm:items-start">
          <QRCodeSVG
            value={code.url}
            size={168}
            marginSize={2}
            bgColor="#d7e0ea"
            fgColor="#060a12"
            level="M"
          />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="mono-label text-faint">Pairing code — single use</div>
            <div className="mt-1 font-label text-2xl tracking-[0.3em] text-cyan">{code.code}</div>
            <p className="mt-2 break-all font-label text-xs text-dim">{code.url}</p>
            <p className="mono-label mt-2 text-warn">
              expires in {minutesLeft(code.expiresAt) ?? code.expiresInMinutes} min
            </p>
            <p className="mt-2 text-xs text-dim">
              On the other machine: open the front door and enter this code. It binds that browser
              to <em>this same GM</em> — same campaign, same owned sheets.
            </p>
          </div>
        </div>
      )}

      {minted && (
        <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 p-3">
          <div className="mono-label text-warn">Device token — shown once</div>
          <code className="mt-1 block break-all font-label text-xs text-ink">{minted.token}</code>
          <p className="mt-2 text-xs text-dim">
            Paste it into the front door&apos;s &ldquo;paste a token&rdquo; tab together with the
            campaign id <code className="text-cyan">{campaignId}</code>. Only its hash is stored
            server-side, so it cannot be shown again — revoke and mint another if it is lost.
          </p>
        </div>
      )}
    </div>
  );
}
