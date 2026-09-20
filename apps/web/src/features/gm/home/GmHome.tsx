/**
 * `/c/:campaignId/gm` — the GM console.
 *
 * It used to be three admin panels (settings, invites, devices) plus a strip of
 * bare lowercase chips, which is why a GM "filling out info in the campaign"
 * could not find the party, the scenes, or anything else: the console described
 * its own plumbing and nothing about the job. It is now one workspace —
 *
 *   1. what is set up and what is not, each row with the control that fixes it;
 *   2. the party, because who is at the table comes before everything else —
 *      and beside it the runners still being built, with the ones waiting for
 *      review counted (FR3.9);
 *   3. campaign settings (FR5.7 clock, FR6.3 webhook), with a way through to
 *      how runners are built here — that form is its own screen now (FR3.9:
 *      level, caps, books, optional rules), because it is set once and then
 *      left alone while this page is read every session;
 *   4. how devices get here (invites, pairing, revoke — FR1.1/1.3).
 *
 * Every other screen is reached from the sidebar (`GM_NAV`); this page does not
 * repeat that list.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { useCampaign } from '../../../api/campaigns.js';
import JoinQrModal from '../../../components/shell/JoinQrModal.js';
import { gmHref } from '../../../components/shell/gmNav.js';
import { addDays } from '../common.js';
import { EmptyState, ErrorNote, Field, GmGuard, inputClass, SectionTitle, Spinner } from '../ui.js';
import { BuildsWaitingCard } from '../../build/entry.js';
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
      <SectionTitle>Invites & join QR</SectionTitle>
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

  // Revoked devices are hidden entirely — the list is "who is here", not
  // "who was ever here".
  const active = (devices.data ?? []).filter((d) => !d.revokedAt);

  return (
    <div className="panel p-4">
      <SectionTitle>Devices</SectionTitle>
      {devices.isLoading && (
        <div className="mt-3">
          <Spinner label="loading devices" />
        </div>
      )}
      <ErrorNote error={devices.error} />
      {devices.data && active.length === 0 && (
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
        {active.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2">
            <span className="chip">{d.role}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {d.label ?? d.userName ?? d.id}
              {d.lastSeenAt && (
                <span className="mono-label ml-2 text-faint">
                  seen {new Date(d.lastSeenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </span>
            <button
              className="btn px-2.5 py-1 text-danger"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(d.id)}
            >
              revoke
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={revoke.error} />
    </div>
  );
}

/**
 * Character creation is a whole form — level, caps, books, optional rules —
 * and it used to render inline here, where it was the tallest thing on the
 * console and the least often read: a GM sets it once when the campaign
 * starts. The console now carries only what it is currently set to do and the
 * way in; the form lives on `/gm/chargen`.
 */
function ChargenLink({ campaignId }: { campaignId: string }) {
  return (
    <div className="panel p-4" data-testid="chargen-link">
      <SectionTitle>Character creation</SectionTitle>
      <p className="mt-2 text-sm text-dim">
        The creation level and its caps, which printing of the priority table, which of the table's
        shared books the builder draws on, and the optional rules — everything the walkthrough reads
        on every device.
      </p>
      <Link
        className="btn btn-accent mt-3 inline-block px-3 py-1.5"
        to={gmHref(campaignId, { to: '/gm/chargen' })}
      >
        set creation rules
      </Link>
    </div>
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
        <SectionTitle>GM console</SectionTitle>
        {/* Deliberately not an <h1> carrying the campaign name: the shell
            header already is one, and two headings with the same accessible
            name make every "the campaign heading is visible" assertion
            ambiguous. */}
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
            <BuildsWaitingCard campaignId={campaignId} />
            <SettingsPanel campaignId={campaignId} />
            <ChargenLink campaignId={campaignId} />
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
