/**
 * The party roster — the screen the GM console never had.
 *
 * `GET /api/campaigns/:id/characters` has always returned every sheet in the
 * campaign, and the only two links to `/sheet/:characterId` in the whole app
 * were gated on `useMyCharacterId` — the device's OWN character. A GM owns
 * none, so opening a player's sheet meant pasting a UUID into the address bar.
 * This renders that roster, links each row to its sheet, and does the other
 * half of FR1.1 the invite cannot: say which runner a joined phone is holding
 * (`characters.ownerUserId` is the only link between the two).
 *
 * Hydrates from REST on mount (LIVE-1) — never from live events alone.
 */
import { Link } from 'react-router-dom';
import { PortraitAvatar } from '../../sheet/components/PortraitControl.js';
import { EmptyState, ErrorNote, SectionTitle, Spinner } from '../ui.js';
import AddCharacter from './AddCharacter.js';
import { useAssignOwner, useDevices, useRoster, type RosterCharacter } from './api.js';

export interface PartyPanelProps {
  campaignId: string;
  /** Show only the first N rows and link on to the full roster. */
  limit?: number;
  /** Console-home mode: compact, and the CTA is "open the roster". */
  compact?: boolean;
  onShowQr?: () => void;
}

/** A campaign member a sheet can be handed to, folded down from the devices. */
export interface OwnerOption {
  userId: string;
  label: string;
}

export function ownerOptions(
  devices: Array<{ userId?: string; userName?: string; role: string; revokedAt?: string | null }>,
): OwnerOption[] {
  const byUser = new Map<string, string>();
  for (const d of devices) {
    if (!d.userId || d.revokedAt) continue;
    // A display kiosk is not a person and never holds a sheet.
    if (d.role === 'display') continue;
    if (!byUser.has(d.userId)) byUser.set(d.userId, d.userName ?? d.userId.slice(0, 8));
  }
  return [...byUser].map(([userId, label]) => ({ userId, label }));
}

/** Display name for a roster row: the sheet's alias wins, then the row name. */
export function rosterLabel(c: RosterCharacter): string {
  return c.sheet?.identity?.alias?.trim() || c.name?.trim() || 'unnamed runner';
}

function Row({
  campaignId,
  character,
  owners,
  ownerName,
  onAssign,
  busy,
}: {
  campaignId: string;
  character: RosterCharacter;
  owners: OwnerOption[];
  ownerName: string | null;
  onAssign: (ownerUserId: string | null) => void;
  busy: boolean;
}) {
  const metatype = character.sheet?.identity?.metatype;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-character={character.id}>
      <PortraitAvatar
        portraitId={character.sheet?.identity?.portraitId ?? null}
        label={rosterLabel(character)}
        size="h-8 w-8"
        text="text-xs"
      />
      <Link
        to={`/c/${campaignId}/sheet/${character.id}`}
        className="min-w-0 flex-1 truncate text-sm text-ink hover:text-cyan"
        data-testid="roster-sheet-link"
      >
        <span className="font-semibold">{rosterLabel(character)}</span>
        {metatype && <span className="mono-label ml-2 text-faint">{metatype}</span>}
      </Link>

      {character.balances && (
        <span className="mono-label shrink-0 text-faint">
          {character.balances.karma} karma · {character.balances.nuyen.toLocaleString()}¥
        </span>
      )}

      {ownerName ? (
        <span className="chip shrink-0 border-ok/40 text-ok">{ownerName}</span>
      ) : (
        <span className="chip shrink-0 border-warn/40 text-warn">no device</span>
      )}

      <select
        className="shrink-0 rounded-md border border-edge bg-deck px-2 py-1 text-xs text-ink focus:border-cyan focus:outline-none"
        aria-label={`Assign ${rosterLabel(character)} to a device`}
        value={character.ownerUserId ?? ''}
        disabled={busy}
        onChange={(e) => onAssign(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">— unclaimed —</option>
        {owners.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.label}
          </option>
        ))}
      </select>

      <Link
        to={`/c/${campaignId}/sheet/${character.id}`}
        className="btn shrink-0 px-2.5 py-1"
        aria-label={`Open ${rosterLabel(character)}'s sheet`}
      >
        open sheet
      </Link>
    </li>
  );
}

export default function PartyPanel({ campaignId, limit, compact, onShowQr }: PartyPanelProps) {
  const roster = useRoster(campaignId);
  const devices = useDevices(campaignId);
  const assign = useAssignOwner(campaignId);

  const rows = roster.data ?? [];
  const owners = ownerOptions(devices.data ?? []);
  const ownerLabel = new Map(owners.map((o) => [o.userId, o.label]));
  const shown = limit ? rows.slice(0, limit) : rows;
  const unclaimed = rows.filter((c) => !c.ownerUserId).length;

  return (
    <div className="panel p-4" data-testid="party-panel">
      <SectionTitle hint={rows.length > 0 ? `${rows.length} on the crew` : 'nobody on the crew yet'}>
        Party
      </SectionTitle>

      {roster.isLoading && (
        <div className="mt-3">
          <Spinner label="loading the roster" />
        </div>
      )}
      <ErrorNote error={roster.error} />
      <ErrorNote error={assign.error} />

      {roster.data && rows.length === 0 && (
        <div className="mt-3">
          <EmptyState
            testId="party-empty"
            title="No characters yet"
            blurb="A campaign with no runners in it. Import a Chummer5a build, or start a blank sheet and fill it in at the table — either one shows up here and on the owner's phone."
            actions={<AddCharacter campaignId={campaignId} />}
            hint={
              onShowQr ? (
                <button type="button" className="btn px-2.5 py-1" onClick={onShowQr}>
                  or show the join QR first
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-edge">
            {shown.map((c) => (
              <Row
                key={c.id}
                campaignId={campaignId}
                character={c}
                owners={owners}
                ownerName={c.ownerUserId ? (ownerLabel.get(c.ownerUserId) ?? 'claimed') : null}
                busy={assign.isPending}
                onAssign={(ownerUserId) => assign.mutate({ characterId: c.id, ownerUserId })}
              />
            ))}
          </ul>

          {unclaimed > 0 && (
            <p className="mono-label mt-2 text-warn" data-testid="unclaimed-note">
              {unclaimed} sheet{unclaimed === 1 ? '' : 's'} not handed to a device yet — a player
              whose sheet is unclaimed sees no Sheet tab at all.
            </p>
          )}

          {compact ? (
            <div className="mt-3">
              <Link className="btn px-2.5 py-1" to={`/c/${campaignId}/gm/party`}>
                open the roster
              </Link>
            </div>
          ) : (
            <div className="mt-4 border-t border-edge pt-4">
              <div className="mono-label">Add another runner</div>
              <div className="mt-2">
                <AddCharacter campaignId={campaignId} />
              </div>
            </div>
          )}

          {limit && rows.length > limit && (
            <p className="mono-label mt-2 text-faint">
              {rows.length - limit} more on the full roster
            </p>
          )}
        </>
      )}
    </div>
  );
}
