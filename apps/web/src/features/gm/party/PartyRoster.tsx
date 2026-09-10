/**
 * The party roster with the numbers a GM asks for out loud.
 *
 * One REST read builds it (`GET /api/campaigns/:id/characters`), so it is
 * populated the instant it mounts and survives a mid-session reload (LIVE-1);
 * a per-character `/derived` fan-out then replaces the browser's own numbers
 * with the server's, and rows still waiting say `est` rather than pretending
 * (Principle 3).
 *
 * Every row opens that character's sheet. That is the first complaint answered:
 * before the roster existed, the only two links to `/sheet/:characterId` in the
 * app were gated on the device's OWN character, and a GM owns none — so reading
 * a player's sheet meant pasting a UUID into the address bar.
 *
 * Handing a sheet to a phone (`PATCH /api/characters/:id/owner`) and importing
 * a `.chum5` (`POST /api/characters`) are the console's own controls, imported
 * from `../home` rather than reimplemented, so there is exactly one write path
 * to each route.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveStore } from '../../../live/store.js';
import { useGridStore } from '../../grid/store.js';
import AddCharacter from '../home/AddCharacter.js';
import { ownerOptions } from '../home/PartyPanel.js';
import { useAssignOwner, useDevices } from '../home/api.js';
import { ErrorNote, SectionTitle, Spinner } from '../ui.js';
import PortraitControl from '../../sheet/components/PortraitControl.js';
import PartyRow from './PartyRow.js';
import {
  useApplyDamage,
  useAward,
  useDerivedRows,
  useParty,
  usePartyLive,
  usePartyScene,
} from './api.js';
import {
  deviceFor,
  formatNuyen,
  partyTotals,
  tokenFor,
  vitalsFor,
  type DeviceLink,
  type PartyMember,
  type RosterToken,
} from './roster.js';

export interface PartyRosterProps {
  campaignId: string;
}

/**
 * Honest empty state: say what is missing, why it matters, and offer the
 * control that fixes it — never a blank panel and never a dead-end sentence.
 */
function EmptyRoster({ campaignId }: { campaignId: string }) {
  return (
    <div data-testid="party-empty" className="mt-3">
      <p className="text-sm text-dim">
        No characters in this campaign yet. Nothing runs without them: the tracker has no
        combatants, the grid has no PC tokens, and a phone that scans the join QR reaches no
        sheet.
      </p>
      <p className="mt-2 text-sm text-dim">
        Import a Chummer5a <code className="text-cyan">.chum5</code> export — skills,
        gear, qualities and the build&apos;s opening karma and nuyen all come across as ledger
        entries — or start a blank sheet and fill it in at the table.
      </p>
      <div className="mt-3">
        <AddCharacter campaignId={campaignId} />
      </div>
    </div>
  );
}

export default function PartyRoster({ campaignId }: PartyRosterProps) {
  const navigate = useNavigate();
  const party = useParty(campaignId);
  const devices = useDevices(campaignId);
  const presence = useLiveStore((s) => s.presence);
  const scene = usePartyScene(campaignId);
  const derived = useDerivedRows(party.data);
  const damage = useApplyDamage(campaignId);
  const award = useAward(campaignId);
  const assign = useAssignOwner(campaignId);
  usePartyLive(campaignId);

  const members = useMemo<PartyMember[]>(() => party.data ?? [], [party.data]);
  const owners = useMemo(() => ownerOptions(devices.data ?? []), [devices.data]);

  const links = useMemo<Record<string, DeviceLink>>(() => {
    const out: Record<string, DeviceLink> = {};
    for (const m of members) out[m.id] = deviceFor(m, devices.data, presence);
    return out;
  }, [members, devices.data, presence]);

  const totals = useMemo(() => partyTotals(members), [members]);

  /**
   * Jump to the runner on the map: point the Grid's own UI state at this token
   * and go there. The Grid reads `viewSceneId` / `selectedTokenId` from that
   * store on mount, so the GM lands with the right scene up and the right token
   * ringed instead of hunting a name in a token list.
   */
  const jumpToToken = (token: RosterToken) => {
    const grid = useGridStore.getState();
    grid.setViewSceneId(token.sceneId);
    grid.selectToken(token.id);
    navigate(`/c/${campaignId}/grid`);
  };

  const loading = party.isLoading;
  const busy = damage.isPending || award.isPending || assign.isPending;

  return (
    <div className="panel p-4" data-testid="party-roster">
      <SectionTitle hint="condition, Edge, pools, ledger">Party</SectionTitle>

      {members.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="mono-label text-faint">
            {totals.count} {totals.count === 1 ? 'runner' : 'runners'}
          </span>
          <span className="mono-label text-faint">
            {totals.karma} karma · {formatNuyen(totals.nuyen)}
          </span>
          {totals.wounded > 0 && (
            <span className="chip border-danger/40 text-danger">{totals.wounded} wounded</span>
          )}
          {totals.unclaimed > 0 && (
            <span className="chip border-warn/40 text-warn">{totals.unclaimed} unclaimed</span>
          )}
          {scene.sceneName && <span className="mono-label text-faint">on {scene.sceneName}</span>}
        </div>
      )}

      {loading && (
        <div className="mt-3">
          <Spinner label="loading party" />
        </div>
      )}
      <ErrorNote error={party.error} />
      <ErrorNote error={damage.error} />
      <ErrorNote error={award.error} />
      <ErrorNote error={assign.error} />

      {!loading && !party.error && members.length === 0 && (
        <EmptyRoster campaignId={campaignId} />
      )}

      {members.length > 0 && (
        <ul className="mt-2 divide-y divide-edge">
          {members.map((member) => (
            <PartyRow
              key={member.id}
              campaignId={campaignId}
              member={member}
              vitals={vitalsFor(member, derived[member.id])}
              device={links[member.id] ?? { state: 'unclaimed', label: null, deviceId: null }}
              token={tokenFor(member, scene.tokens)}
              sceneName={scene.sceneName}
              owners={owners}
              busy={busy}
              portrait={
                <PortraitControl
                  compact
                  subject={{
                    id: member.id,
                    name: member.name,
                    alias: member.alias,
                    ownerUserId: member.ownerUserId,
                    portraitId: member.sheet?.identity.portraitId ?? null,
                  }}
                />
              }
              onDamage={(m, req) => damage.mutate({ characterId: m.id, req })}
              onAward={(m, req) => award.mutate({ characterId: m.id, req })}
              onJumpToToken={jumpToToken}
              onAssignOwner={(m, ownerUserId) =>
                assign.mutate({ characterId: m.id, ownerUserId })
              }
            />
          ))}
        </ul>
      )}

      {members.length > 0 && (
        <div className="mt-4 border-t border-edge pt-3">
          <div className="mono-label">Add another runner</div>
          <div className="mt-2">
            <AddCharacter campaignId={campaignId} />
          </div>
        </div>
      )}
    </div>
  );
}
