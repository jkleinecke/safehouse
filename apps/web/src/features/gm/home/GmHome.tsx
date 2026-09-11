/**
 * `/c/:campaignId/gm` — the GM console.
 *
 * It used to be three admin panels (settings, invites, devices) plus a strip of
 * bare lowercase chips, which is why a GM "filling out info in the campaign"
 * could not find the party, the scenes, or anything else: the console described
 * its own plumbing and nothing about the job. It is now one workspace —
 *
 *   1. what is set up and what is not, each row with the control that fixes it;
 *   2. the party, because who is at the table comes before everything else;
 *   3. campaign settings (FR5.7 clock, FR6.3 webhook);
 *   4. how devices get here (invites, pairing, revoke — FR1.1/1.3);
 *   5. every other screen, named and described, in the order a GM works.
 *
 * The screen list is `GM_NAV`, the same list the sidebar renders, so a surface
 * can never exist in one and be invisible in the other.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { useCampaign } from '../../../api/campaigns.js';
import JoinQrModal from '../../../components/shell/JoinQrModal.js';
import {
  GM_NAV,
  GM_NAV_SECTIONS,
  gmHref,
  type GmNavEntry,
} from '../../../components/shell/gmNav.js';
import { addDays } from '../common.js';
import { EmptyState, ErrorNote, Field, GmGuard, inputClass, SectionTitle, Spinner } from '../ui.js';
import PairPanel from '../pairing/PairPanel.js';
import { useCreateInvite, useDevices, useRevokeDevice, useUpdateCampaign, type InviteResult } from './api.js';
import PartyPanel from './PartyPanel.js';
import SetupChecklist from './SetupChecklist.js';
import TransferPanel from './TransferPanel.js';

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
      <SectionTitle>Campaign settings</SectionTitle>
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

function InvitePanel({
  campaignId,
  onShowQr,
}: {
  campaignId: string;
  onShowQr: (role: Exclude<Role, 'gm'>) => void;
}) {
  const create = useCreateInvite(campaignId);
  // No `gm` option: the GM device is minted with the campaign itself, and the
  // server refuses a gm invite rather than letting the screen be handed round.
  const [role, setRole] = useState<Exclude<Role, 'gm'>>('player');
  const [minted, setMinted] = useState<InviteResult[]>([]);

  return (
    <div className="panel p-4">
      <SectionTitle hint="nobody ever types an IP">Invites & join QR</SectionTitle>
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
        <button className="btn btn-accent ml-auto px-3 py-1.5" onClick={() => onShowQr(role)}>
          show join QR
        </button>
      </div>
      <p className="mono-label mt-2 text-faint">
        A joined phone still has no sheet until you hand it one on the Party roster.
      </p>
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

function DevicesPanel({ campaignId, onShowQr }: { campaignId: string; onShowQr: () => void }) {
  const devices = useDevices(campaignId);
  const revoke = useRevokeDevice(campaignId);

  return (
    <div className="panel p-4">
      <SectionTitle hint="lost phone? revoke it">Devices</SectionTitle>
      {devices.isLoading && (
        <div className="mt-3">
          <Spinner label="loading devices" />
        </div>
      )}
      <ErrorNote error={devices.error} />
      {devices.data && devices.data.length === 0 && (
        <div className="mt-3">
          <EmptyState
            testId="devices-empty"
            title="No devices have joined"
            blurb="Players scan a QR off this laptop and they are in — no accounts, no app store, nobody typing an IP address. The table TV needs its own display invite."
            actions={
              <button className="btn btn-accent px-3 py-1.5" onClick={onShowQr}>
                show join QR
              </button>
            }
          />
        </div>
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

function ScreenCard({ campaignId, entry }: { campaignId: string; entry: GmNavEntry }) {
  return (
    <Link
      to={gmHref(campaignId, entry)}
      data-nav-card={entry.key}
      className="panel block p-3 transition-colors hover:border-cyan"
    >
      <div className="font-label text-xs uppercase tracking-widest text-cyan">{entry.label}</div>
      <p className="mt-1 text-xs leading-snug text-dim">{entry.blurb}</p>
    </Link>
  );
}

export default function GmHome() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data: campaign } = useCampaign(campaignId);
  const [qr, setQr] = useState<{ open: boolean; role: Role }>({ open: false, role: 'player' });
  if (!campaignId) return null;

  const named = Boolean(campaign?.name && campaign.name.trim().length > 0);

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="prep between sessions, run the table during them">GM console</SectionTitle>
        {/* Deliberately not an <h1> carrying the campaign name: the shell
            header already is one, and two headings with the same accessible
            name make every "the campaign heading is visible" assertion
            ambiguous. */}
        <p className="mt-1 text-sm text-dim">
          Everything this table has, in the order you use it — who is playing, what is set up, and
          where each tool lives.
        </p>

        <div className="mt-4 max-w-5xl">
          <SetupChecklist campaignId={campaignId} named={named} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <PartyPanel
              campaignId={campaignId}
              compact
              limit={6}
              onShowQr={() => setQr({ open: true, role: 'player' })}
            />
            <SettingsPanel campaignId={campaignId} />
            <TransferPanel campaignId={campaignId} />
          </div>
          <div className="space-y-4">
            <InvitePanel campaignId={campaignId} onShowQr={(role) => setQr({ open: true, role })} />
            <PairPanel campaignId={campaignId} />
            <DevicesPanel
              campaignId={campaignId}
              onShowQr={() => setQr({ open: true, role: 'player' })}
            />
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle hint="every screen this console has">Where everything lives</SectionTitle>
          {GM_NAV_SECTIONS.map((section) => {
            const entries = GM_NAV.filter((e) => e.section === section.id && e.key !== 'overview');
            if (entries.length === 0) return null;
            return (
              <div key={section.id} className="mt-3">
                <div className="mono-label text-faint">
                  {section.label} — {section.hint}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {entries.map((entry) => (
                    <ScreenCard key={entry.key} campaignId={campaignId} entry={entry} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <JoinQrModal
          campaignId={campaignId}
          open={qr.open}
          initialRole={qr.role}
          onClose={() => setQr((s) => ({ ...s, open: false }))}
        />
      </div>
    </GmGuard>
  );
}
