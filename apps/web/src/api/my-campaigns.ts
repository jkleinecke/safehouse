/**
 * "Which tables am I at?" — the data behind the front door's campaign picker.
 *
 * The GM hosts the server on their own laptop and plays across many evenings,
 * and the app had no way to answer that question: nothing listed campaigns, so
 * the only way back into a table was a token you still held or a pairing code
 * only a live GM could mint. Two server routes close it, and this module is
 * their client half.
 *
 *   - `GET /api/campaigns` — authenticated, scoped to the caller's own
 *     memberships. It names the campaigns a stored token can already open, and
 *     surfaces the ones the same *user* belongs to but this browser holds no
 *     device for.
 *   - `GET /api/gm/recover` — behind the same loopback gate, which campaigns
 *     this machine hosts. It mints nothing, so the front door can ask it on
 *     every visit: opening `/` must not quietly hand the browser a GM token.
 *   - `POST /api/gm/recover` — mints the GM device, no secret, but only when
 *     the request provably originates on the machine hosting the server. On
 *     every other device — every player phone on the table's Wi-Fi — both
 *     refuse, and **that is the normal answer, not an error**: the refusal is
 *     swallowed and nothing is ever shown about it.
 *
 * One list, several tokens. A device token is bound to one campaign and one
 * user, so a browser holding a GM token for one table and a player token for
 * another has to ask twice and merge — there is no token that sees both. A
 * token the server rejects on the way is retired by `api/client.ts`, which is
 * how a stale session gets noticed at the front door instead of three screens
 * deep.
 */
import type { Role } from '@safehouse/contracts';
import { apiGet, apiPost } from './client.js';
import {
  isRole,
  rememberCampaignNames,
  sessionFrom,
  type JoinResponse,
  type Session,
} from './session.js';

/** A row of `GET /api/campaigns` — the caller's membership in one campaign. */
export interface CampaignMembership {
  id: string;
  name: string;
  role: Role;
  /** Who started it. Only `GET /api/gm/recover` knows this; a membership
   *  listing does not, so it is optional everywhere downstream. */
  gmName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastPlayedAt?: string | null;
}

/**
 * One line in the picker: a campaign, the role it would be entered as, and the
 * stored device that opens it — `undefined` when the server knows about the
 * campaign but this browser has no token for it.
 */
export interface CampaignCard {
  campaignId: string;
  name: string;
  role: Role;
  session?: Session;
  lastPlayedAt?: string | null;
  /** "started by Jim" — the only thing that tells two untitled tables apart. */
  gmName?: string;
}

function isMembership(value: unknown): value is CampaignMembership {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<CampaignMembership>;
  return typeof row.id === 'string' && row.id.length > 0 && isRole(row.role);
}

/**
 * Ask one device token which campaigns its user belongs to.
 *
 * The header is explicit (and the request `anonymous`) because the answer is
 * per-token: resolving it from the store would ask the same question with the
 * same token every time and never see the second table.
 */
export async function fetchCampaignsWithToken(token: string): Promise<CampaignMembership[]> {
  const res = await apiGet<{ campaigns?: unknown }>('/api/campaigns', {
    anonymous: true,
    headers: { Authorization: `Bearer ${token}` },
  });
  const rows = Array.isArray(res?.campaigns) ? res.campaigns : [];
  return rows.filter(isMembership);
}

/**
 * Every campaign any stored token can see, merged by id.
 *
 * A token that fails is dropped from the result and nothing else: it is either
 * revoked (in which case `api/client.ts` has already retired it) or the server
 * is not up, and neither is worth a red box on the sign-in screen. The cap is
 * there so a browser that has collected a dozen sessions does not open a dozen
 * connections on first paint.
 */
export async function fetchCampaignsForTokens(
  tokens: readonly string[],
  limit = 4,
): Promise<CampaignMembership[]> {
  const unique = [...new Set(tokens.filter((t) => t.length > 0))].slice(0, limit);
  const answers = await Promise.all(
    unique.map((token) => fetchCampaignsWithToken(token).catch(() => [] as CampaignMembership[])),
  );

  const byId = new Map<string, CampaignMembership>();
  for (const row of answers.flat()) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * `GET /api/gm/recover` — which campaigns this machine hosts, if this machine
 * is the one hosting the server.
 *
 * The front door asks on every visit, which is only reasonable because the GET
 * mints nothing: it is the "what is here?" half of the recovery, and the POST
 * that actually issues a device waits for the GM to pick a table. Off the
 * loopback interface it refuses and this returns an empty list — no throw, no
 * copy, no console noise, because a refusal on a player's phone is correct.
 *
 * The rows carry no role: recovery only ever mints for the campaign's owner of
 * record, so `gm` is the only role it can produce.
 */
export async function probeGmRecovery(): Promise<CampaignMembership[]> {
  try {
    const res = await apiGet<{ campaigns?: unknown }>('/api/gm/recover', {
      anonymous: true,
      keepSessionOn401: true,
    });
    const rows = Array.isArray(res?.campaigns) ? res.campaigns : [];
    return rows.flatMap((row): CampaignMembership[] => {
      if (typeof row !== 'object' || row === null) return [];
      const r = row as { id?: unknown; name?: unknown; lastPlayedAt?: unknown; gm?: unknown };
      if (typeof r.id !== 'string' || r.id.length === 0) return [];
      // `gm` is `{ id, displayName }`; only the name is of any use on screen.
      const gm = typeof r.gm === 'object' && r.gm !== null ? (r.gm as { displayName?: unknown }) : null;
      const card: CampaignMembership = {
        id: r.id,
        name: typeof r.name === 'string' ? r.name : '',
        role: 'gm',
        ...(typeof gm?.displayName === 'string' && gm.displayName.length > 0
          ? { gmName: gm.displayName }
          : {}),
      };
      return [typeof r.lastPlayedAt === 'string' ? { ...card, lastPlayedAt: r.lastPlayedAt } : card];
    });
  } catch {
    return [];
  }
}

function playedAt(card: CampaignCard): number {
  const when = card.lastPlayedAt;
  if (!when) return 0;
  const ms = Date.parse(when);
  return Number.isNaN(ms) ? 0 : ms;
}

/** One row per (campaign, role): the same table as GM and as player is two. */
function rowKey(campaignId: string, role: Role): string {
  return `${role}:${campaignId}`;
}

/**
 * Turn stored sessions plus whatever the server listed into the picker's rows.
 *
 * Stored sessions come first and in their storage order — they are the ones a
 * tap actually opens, and that order is already "most recently used". A
 * campaign the server named but this browser has no device for still gets a
 * row: it is the difference between "you have no campaigns" and "your token
 * for that one is on the other laptop", and only one of those is true.
 *
 * A (campaign, role) pair is one row. The same campaign held as both GM and
 * player — the GM's own laptop with a player view open — is deliberately two,
 * because they are two devices and they land on two different screens.
 */
export function mergeCampaignCards(
  sessions: readonly Session[],
  listed: readonly CampaignMembership[],
): CampaignCard[] {
  const named = new Map(listed.map((row) => [row.id, row]));

  const mine: CampaignCard[] = sessions.map((session) => {
    const row = named.get(session.campaignId);
    const card: CampaignCard = {
      campaignId: session.campaignId,
      name: row?.name ?? session.campaignName ?? '',
      role: session.role,
      session,
      ...(row?.gmName ? { gmName: row.gmName } : {}),
    };
    const when = row?.lastPlayedAt ?? row?.updatedAt;
    return when ? { ...card, lastPlayedAt: when } : card;
  });

  // Deduped on the pair, not on the campaign: a GM whose laptop also holds a
  // player view of the same table can still recover the GM device for it, and
  // the two rows land on two different screens.
  const seen = new Set(sessions.map((s) => rowKey(s.campaignId, s.role)));
  const others: CampaignCard[] = [];
  for (const row of listed) {
    const key = rowKey(row.id, row.role);
    if (seen.has(key)) continue;
    seen.add(key);
    const card: CampaignCard = {
      campaignId: row.id,
      name: row.name,
      role: row.role,
      ...(row.gmName ? { gmName: row.gmName } : {}),
    };
    const when = row.lastPlayedAt ?? row.updatedAt;
    others.push(when ? { ...card, lastPlayedAt: when } : card);
  }
  others.sort((a, b) => playedAt(b) - playedAt(a) || a.name.localeCompare(b.name));

  return [...mine, ...others];
}

/** Cache the names the server just gave us, so the next visit reads them cold. */
export function rememberNames(listed: readonly CampaignMembership[]): void {
  rememberCampaignNames(new Map(listed.filter((r) => r.name).map((r) => [r.id, r.name])));
}

/**
 * `POST /api/gm/recover` — the loopback GM device.
 *
 * Called on the front door with no secret and no ceremony. On the laptop
 * hosting the server it hands back a GM session for a campaign that laptop
 * already owns; anywhere else — a player's phone on the same Wi-Fi, a second
 * machine, a browser behind a reverse proxy — the server refuses, and the
 * refusal is the *expected* answer for most devices that will ever call it.
 *
 * So every failure is swallowed and returns null: no throw into React, no
 * error copy, no console noise, and `keepSessionOn401` so a refusal can never
 * be mistaken for "your stored token died".
 *
 * It deliberately does **not** store what it gets back. Merely opening `/` on
 * the host machine should not silently sign that browser in — the human picks
 * a table and that click is the consent, which also keeps "start a campaign"
 * on the front door meaning what its copy says for a browser that has not
 * chosen one yet. The caller saves the session it decides to use.
 *
 * Pass the campaign: with several on one laptop the route answers 409 rather
 * than guessing which table the GM meant, and `probeGmRecovery` is where the
 * picker learned the ids to offer.
 */
export async function recoverGmSession(campaignId?: string): Promise<Session | null> {
  try {
    const res = await apiPost<(JoinResponse & { campaignName?: string }) | null>(
      '/api/gm/recover',
      campaignId ? { campaignId } : {},
      { anonymous: true, keepSessionOn401: true },
    );
    if (!res || typeof res.token !== 'string' || res.role !== 'gm' || !res.campaignId) return null;
    const session = sessionFrom(res);
    return res.campaignName ? { ...session, campaignName: res.campaignName } : session;
  } catch {
    return null;
  }
}
