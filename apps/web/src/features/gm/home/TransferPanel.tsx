/**
 * Hand the campaign to another member (FR1.2). `POST
 * /api/campaigns/:id/transfer-ownership` has done its five writes under one
 * transaction since M1; nothing on screen called it (docs/UX_AUDIT.md,
 * "built server-side, no UI entry point"). The device that does this becomes
 * a player at the same table, so the panel says so before the click and as
 * the click's own label, and then moves this tab to the player's side.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCampaign } from '../../../api/campaigns.js';
import { clearSession, getSession, saveSession } from '../../../api/session.js';
import ConfirmButton from '../../grid/gm/ConfirmButton.js';
import { ErrorNote, SectionTitle, inputClass } from '../ui.js';
import { ownerOptions, type OwnerOption } from './PartyPanel.js';
import { useDevices, useTransferOwnership } from './api.js';

/** Who can take the campaign: every joined person except whoever owns it now. */
export function transferCandidates(
  options: readonly OwnerOption[],
  ownerIds: readonly (string | undefined)[],
): OwnerOption[] {
  const taken = new Set(ownerIds.filter((x): x is string => typeof x === 'string' && x.length > 0));
  return options.filter((o) => !taken.has(o.userId));
}

export default function TransferPanel({ campaignId }: { campaignId: string }) {
  const { data: campaign } = useCampaign(campaignId);
  const devices = useDevices(campaignId);
  const transfer = useTransferOwnership(campaignId);
  const navigate = useNavigate();
  const session = getSession();
  const [toUserId, setToUserId] = useState('');

  const candidates = transferCandidates(ownerOptions(devices.data ?? []), [
    campaign?.gmUserId,
    session?.userId,
  ]);
  const picked = candidates.find((c) => c.userId === toUserId) ?? candidates[0];

  const hand = () => {
    if (!picked) return;
    transfer.mutate(picked.userId, {
      onSuccess: () => {
        // This device is a player here now: same token, different role. The
        // server already re-filed the device; the browser has to agree.
        const current = getSession();
        if (current && current.campaignId === campaignId && current.role === 'gm') {
          clearSession('gm', campaignId);
          saveSession({ ...current, role: 'player' });
        }
        navigate(`/c/${campaignId}`);
      },
    });
  };

  return (
    <div className="panel p-4" data-testid="transfer-panel">
      <SectionTitle hint="the table's log says who did it">Hand the campaign over</SectionTitle>
      <p className="mt-2 text-sm text-dim">
        The new owner becomes the GM everywhere at once — the record, the seats, every signed-in
        device. You keep a seat as a player.
      </p>
      {devices.isPending && <p className="mt-2 text-sm text-dim">Loading who is here…</p>}
      {devices.data && candidates.length === 0 && (
        <p className="mt-2 text-sm text-dim" data-testid="transfer-nobody">
          Nobody else has joined yet — a player has to be at the table before it can be theirs.
        </p>
      )}
      {candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="mono-label">to</span>
            <select
              className={`${inputClass} w-auto`}
              value={picked?.userId ?? ''}
              onChange={(e) => setToUserId(e.target.value)}
              aria-label="New owner"
              data-testid="transfer-to"
            >
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <ConfirmButton
            className="btn px-3 py-1.5"
            label={`make ${picked?.label ?? 'them'} the GM`}
            confirmLabel="yes — I become a player"
            onConfirm={hand}
            disabled={!picked || transfer.isPending}
            testId="transfer-confirm"
            title="Two clicks: this one arms it, the next one does it"
          />
        </div>
      )}
      <ErrorNote error={transfer.error} />
    </div>
  );
}
