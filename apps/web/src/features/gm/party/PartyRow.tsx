/**
 * One PC on the GM's party roster.
 *
 * Purely presentational — every number arrives as a prop and every button
 * calls one out. That is what lets `party.test.tsx` render a row from nothing
 * but the two REST bodies the server returns, with no WebSocket and no DOM.
 *
 * The affordances are inline on purpose: applying damage, awarding karma and
 * finding a runner on the map are things a GM does WHILE looking at the party,
 * and a control two screens away from the moment it is needed does not exist
 * as far as the table is concerned.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { OwnerOption } from '../home/PartyPanel.js';
import { EstBadge } from '../ui.js';
import {
  DEVICE_WORDS,
  formatNuyen,
  isReachable,
  signed,
  type AwardRequest,
  type Currency,
  type DamageRequest,
  type DeviceLink,
  type MonitorKey,
  type MonitorTrack,
  type PartyMember,
  type PartyVitals,
  type RosterToken,
} from './roster.js';

const DEVICE_TONE: Record<DeviceLink['state'], string> = {
  online: 'border-ok/50 text-ok',
  paired: 'border-edge text-dim',
  revoked: 'border-danger/50 text-danger',
  unclaimed: 'border-warn/50 text-warn',
  'no-device': 'border-warn/50 text-warn',
};

/** Compact monitor read-out: filled/max boxes grouped in threes (§10.2). */
function MonitorBar({
  short,
  track,
  tone,
}: {
  short: string;
  track: MonitorTrack;
  tone: 'physical' | 'stun';
}) {
  const max = Math.max(0, track.max);
  const filled = Math.min(Math.max(0, track.filled), max);
  const on = tone === 'physical' ? 'bg-danger border-danger' : 'bg-warn border-warn';
  return (
    <div className="flex items-center gap-1.5">
      <span className="mono-label w-6 shrink-0">{short}</span>
      <span
        className="flex flex-wrap items-center"
        role="img"
        aria-label={`${tone} condition monitor, ${filled} of ${max} boxes filled`}
      >
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-3 w-3 rounded-[2px] border ${
              i < filled ? on : 'border-edge-bright'
            } ${(i + 1) % 3 === 0 ? 'mr-1.5' : 'mr-px'}`}
          />
        ))}
        {max === 0 && <span className="text-xs text-faint">—</span>}
      </span>
      <span className="mono-label ml-auto shrink-0 text-faint" aria-hidden>
        {filled}/{max}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="mono-label text-faint">{label}</span>{' '}
      <span className="font-label text-sm text-ink">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

export interface PartyRowProps {
  campaignId: string;
  member: PartyMember;
  vitals: PartyVitals;
  device: DeviceLink;
  /** This PC's token on the scene the table is looking at, if it has one. */
  token: RosterToken | null;
  sceneName: string | null;
  /** Joined devices a sheet can be handed to (`ownerOptions`, home/PartyPanel). */
  owners?: readonly OwnerOption[];
  onDamage: (member: PartyMember, req: DamageRequest) => void;
  onAward: (member: PartyMember, req: AwardRequest) => void;
  onJumpToToken: (token: RosterToken) => void;
  onAssignOwner?: (member: PartyMember, ownerUserId: string | null) => void;
  busy?: boolean;
}

export default function PartyRow({
  campaignId,
  member,
  vitals,
  device,
  token,
  sceneName,
  owners = [],
  onDamage,
  onAward,
  onJumpToToken,
  onAssignOwner,
  busy = false,
}: PartyRowProps) {
  const [monitor, setMonitor] = useState<MonitorKey>('physical');
  const [currency, setCurrency] = useState<Currency>('karma');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const sheetHref = `/c/${campaignId}/sheet/${member.id}`;
  const wound = vitals.woundModifier;
  const pending = member.balances.pending;
  const pendingKarma = pending.karma - member.balances.karma;
  const pendingNuyen = pending.nuyen - member.balances.nuyen;

  const award = (sign: 1 | -1) => {
    const parsed = Number.parseInt(amount, 10);
    if (!Number.isFinite(parsed) || parsed === 0) return;
    onAward(member, {
      currency,
      delta: sign * Math.abs(parsed),
      reason: reason.trim().length > 0 ? reason.trim() : 'GM adjustment',
    });
    setAmount('');
    setReason('');
  };

  return (
    <li className="py-3" data-testid="party-row" data-character-id={member.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link to={sheetHref} className="text-base font-semibold text-ink hover:text-cyan">
          {member.alias}
        </Link>
        <span className="chip text-dim">{member.metatype}</span>
        <span className={`chip ${DEVICE_TONE[device.state]}`} data-device-state={device.state}>
          {device.label ? `${device.label} · ${DEVICE_WORDS[device.state]}` : DEVICE_WORDS[device.state]}
        </span>
        {member.status !== 'active' && <span className="chip text-warn">{member.status}</span>}
        {!vitals.authoritative && <EstBadge />}
        <span className="ml-auto flex items-center gap-2">
          <Link to={sheetHref} className="btn px-2.5 py-1">
            open sheet
          </Link>
          {token ? (
            <button
              type="button"
              className="btn px-2.5 py-1"
              onClick={() => onJumpToToken(token)}
              title={`${token.name} on ${sceneName ?? 'the active scene'} at ${token.x}, ${token.y}`}
            >
              find on map
            </button>
          ) : (
            <span className="mono-label text-faint" title="No token for this PC on the active scene">
              no token
            </span>
          )}
        </span>
      </div>

      {onAssignOwner && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="mono-label text-faint">held by</span>
          <select
            className="rounded border border-edge bg-deck px-1.5 py-1 font-label text-xs text-ink"
            aria-label={`Assign ${member.alias} to a device`}
            value={member.ownerUserId ?? ''}
            disabled={busy}
            onChange={(e) =>
              onAssignOwner(member, e.target.value === '' ? null : e.target.value)
            }
          >
            <option value="">— unclaimed —</option>
            {owners.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.label}
              </option>
            ))}
          </select>
          {!isReachable(device.state) && (
            <span className="text-xs text-warn">
              {device.state === 'revoked'
                ? 'that device was revoked — hand the sheet to a phone that is still here'
                : 'no phone at this table can open this sheet — that device shows no Sheet tab at all'}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <MonitorBar short="phys" track={vitals.physical} tone="physical" />
        <MonitorBar short="stun" track={vitals.stun} tone="stun" />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Stat
          label="wound"
          value={wound === 0 ? '—' : signed(wound)}
        />
        <Stat label="def" value={vitals.pools.defense === null ? '—' : String(vitals.pools.defense)} />
        <Stat label="soak" value={vitals.pools.soak === null ? '—' : String(vitals.pools.soak)} />
        <Stat
          label="perc"
          value={vitals.pools.perception === null ? '—' : String(vitals.pools.perception)}
        />
        <Stat
          label="init"
          value={vitals.initiative ? `${vitals.initiative.base}+${vitals.initiative.dice}d6` : '—'}
        />
        <Stat
          label="edge"
          value={`${vitals.edge.current}/${vitals.edge.max}${
            vitals.edge.burned > 0 ? ` (${vitals.edge.burned} burned)` : ''
          }`}
        />
        <Stat label="karma" value={String(member.balances.karma)} />
        <Stat label="nuyen" value={formatNuyen(member.balances.nuyen)} />
        {(pendingKarma !== 0 || pendingNuyen !== 0) && (
          <span className="chip border-warn/40 text-warn" title="Ledger entries awaiting approval">
            pending {pendingKarma !== 0 ? `${signed(pendingKarma)} karma` : ''}
            {pendingKarma !== 0 && pendingNuyen !== 0 ? ' · ' : ''}
            {pendingNuyen !== 0 ? `${signed(pendingNuyen)}¥` : ''}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* --- damage / heal (FR3.4) --- */}
        <span className="flex items-center gap-1.5">
          <select
            className="rounded border border-edge bg-deck px-1.5 py-1 font-label text-xs text-ink"
            value={monitor}
            aria-label={`Monitor to change for ${member.alias}`}
            onChange={(e) => setMonitor(e.target.value as MonitorKey)}
          >
            <option value="physical">physical</option>
            <option value="stun">stun</option>
          </select>
          {([1, 3] as const).map((boxes) => (
            <button
              key={`dmg${boxes}`}
              type="button"
              className="btn px-2 py-1 text-danger"
              disabled={busy}
              aria-label={`Apply ${boxes} ${monitor} damage to ${member.alias}`}
              onClick={() => onDamage(member, { monitor, boxes, op: 'damage' })}
            >
              +{boxes}
            </button>
          ))}
          {([1, 3] as const).map((boxes) => (
            <button
              key={`heal${boxes}`}
              type="button"
              className="btn px-2 py-1 text-ok"
              disabled={busy}
              aria-label={`Heal ${boxes} ${monitor} to ${member.alias}`}
              onClick={() => onDamage(member, { monitor, boxes, op: 'heal' })}
            >
              −{boxes}
            </button>
          ))}
        </span>

        {/* --- karma / nuyen: always a ledger entry (FR3.6) --- */}
        <span className="flex flex-wrap items-center gap-1.5">
          <select
            className="rounded border border-edge bg-deck px-1.5 py-1 font-label text-xs text-ink"
            value={currency}
            aria-label={`Currency to award ${member.alias}`}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            <option value="karma">karma</option>
            <option value="nuyen">nuyen</option>
          </select>
          <input
            className="w-16 rounded border border-edge bg-deck px-1.5 py-1 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            value={amount}
            inputMode="numeric"
            placeholder="amt"
            aria-label={`Amount for ${member.alias}`}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="w-40 rounded border border-edge bg-deck px-1.5 py-1 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
            value={reason}
            placeholder="reason (goes in the ledger)"
            aria-label={`Reason for ${member.alias}`}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn px-2 py-1 text-ok"
            disabled={busy}
            aria-label={`Award ${currency} to ${member.alias}`}
            onClick={() => award(1)}
          >
            award
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-danger"
            disabled={busy}
            aria-label={`Deduct ${currency} from ${member.alias}`}
            onClick={() => award(-1)}
          >
            deduct
          </button>
        </span>
    </div>
    </li>
  );
}
