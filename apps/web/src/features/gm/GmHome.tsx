/**
 * /c/:campaignId/gm — GM console home: campaign settings incl. in-game date
 * advance (FR5.7), Discord webhook (FR6.3 plumbing), invite minting + device
 * manager with per-device revoke (FR1.1/1.3), and the join QR (§16).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { useCampaign } from '../../api/campaigns.js';
import JoinQrModal from '../../components/shell/JoinQrModal.js';
import { addDays } from './common.js';
import {
  useCreateInvite,
  useDevices,
  useRevokeDevice,
  useUpdateCampaign,
  type InviteResult,
} from './home/api.js';
import { ErrorNote, Field, GmGuard, inputClass, SectionTitle, Spinner } from './ui.js';

const TOOL_LINKS = ['scenes', 'generator', 'fixer', 'books', 'sessions'] as const;

function SettingsPanel({ campaignId }: { campaignId: string }) {
  const { data: campaign } = useCampaign(campaignId);
  const update = useUpdateCampaign(campaignId);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [webhook, setWebhook] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (campaign && loadedFor !== campaign.id) {
      setName(campaign.name);
      setDate(campaign.ingameDate ?? '2076-05-12');
      // `settings` is GM-only and simply absent for other roles (Principle 4).
      const settings = (campaign as { settings?: { discordWebhookUrl?: string } }).settings;
      setWebhook(settings?.discordWebhookUrl ?? '');
      setLoadedFor(campaign.id);
    }
  }, [campaign, loadedFor]);

  const advance = (days: number) => {
    const next = addDays(date, days);
    setDate(next);
    update.mutate({ ingameDate: next });
  };

  return (
    <div className="panel p-4">
      <SectionTitle hint="FR5.7 / FR6.3">Campaign settings</SectionTitle>
      <div className="mt-3 space-y-3">
        <Field label="Campaign name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="In-game date (Sixth World)">
          <span className="flex items-center gap-2">
            <input
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2076-05-12"
            />
            <button className="btn shrink-0 px-2.5 py-1.5" onClick={() => advance(1)}>
              +1d
            </button>
            <button className="btn shrink-0 px-2.5 py-1.5" onClick={() => advance(7)}>
              +1w
            </button>
          </span>
        </Field>
        <Field label="Discord webhook URL (recap publishing)">
          <input
            className={inputClass}
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-accent px-3 py-1.5"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                name,
                ingameDate: date,
                settings: { discordWebhookUrl: webhook || null },
              })
            }
          >
            {update.isPending ? 'saving…' : 'save settings'}
          </button>
          {update.isSuccess && <span className="mono-label text-ok">saved</span>}
        </div>
        <ErrorNote error={update.error} />
      </div>
    </div>
  );
}

function InvitePanel({ campaignId, onShowQr }: { campaignId: string; onShowQr: () => void }) {
  const create = useCreateInvite(campaignId);
  // No `gm` option: the GM device is minted with the campaign itself, and the
  // server refuses a gm invite rather than letting the screen be handed round.
  const [role, setRole] = useState<Exclude<Role, 'gm'>>('player');
  const [minted, setMinted] = useState<InviteResult[]>([]);

  return (
    <div className="panel p-4">
      <SectionTitle hint="FR1.1 — nobody ever types an IP">Invites & join QR</SectionTitle>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={`${inputClass} w-auto`}
          value={role}
          onChange={(e) => setRole(e.target.value as Exclude<Role, 'gm'>)}
          aria-label="Invite role"
        >
          <option value="player">player</option>
          <option value="observer">observer</option>
          <option value="display">display (table TV)</option>
        </select>
        <button
          className="btn px-3 py-1.5"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({ role }, { onSuccess: (inv) => setMinted((m) => [inv, ...m]) })
          }
        >
          {create.isPending ? 'minting…' : 'mint invite'}
        </button>
        <button className="btn btn-accent ml-auto px-3 py-1.5" onClick={onShowQr}>
          show join QR
        </button>
      </div>
      <ErrorNote error={create.error} />
      {minted.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {minted.map((inv, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className="chip">{inv.role}</span>
              <code className="min-w-0 flex-1 truncate text-cyan">{inv.url}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DevicesPanel({ campaignId }: { campaignId: string }) {
  const devices = useDevices(campaignId);
  const revoke = useRevokeDevice(campaignId);

  return (
    <div className="panel p-4">
      <SectionTitle hint="FR1.3 — lost phone? revoke it">Devices</SectionTitle>
      {devices.isLoading && <div className="mt-3"><Spinner label="loading devices" /></div>}
      <ErrorNote error={devices.error} />
      {devices.data && devices.data.length === 0 && (
        <p className="mt-3 text-sm text-dim">No devices have joined yet.</p>
      )}
      <ul className="mt-3 divide-y divide-edge">
        {(devices.data ?? []).map((d) => {
          const revoked = Boolean(d.revokedAt);
          return (
            <li key={d.id} className={`flex items-center gap-3 py-2 ${revoked ? 'opacity-50' : ''}`}>
              <span className="chip">{d.role}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {d.label ?? d.userName ?? d.id}
                {d.lastSeenAt && (
                  <span className="mono-label ml-2 text-faint">seen {d.lastSeenAt.slice(0, 10)}</span>
                )}
              </span>
              {revoked ? (
                <span className="mono-label text-danger">revoked</span>
              ) : (
                <button
                  className="btn px-2.5 py-1 text-danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(d.id)}
                >
                  revoke
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNote error={revoke.error} />
    </div>
  );
}

export default function GmHome() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [qrOpen, setQrOpen] = useState(false);
  if (!campaignId) return null;

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="prep between sessions, run the table during them">GM console</SectionTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          {TOOL_LINKS.map((t) => (
            <Link key={t} to={`/c/${campaignId}/gm/${t}`} className="chip text-dim hover:text-cyan">
              {t}
            </Link>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SettingsPanel campaignId={campaignId} />
          <div className="space-y-4">
            <InvitePanel campaignId={campaignId} onShowQr={() => setQrOpen(true)} />
            <DevicesPanel campaignId={campaignId} />
          </div>
        </div>

        <JoinQrModal campaignId={campaignId} open={qrOpen} onClose={() => setQrOpen(false)} />
      </div>
    </GmGuard>
  );
}
