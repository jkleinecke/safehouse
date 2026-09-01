/**
 * Party roster domain — pure transforms, no React and no I/O
 * (BUILD_CONVENTIONS "Web architecture"). Unit-tested in `roster.test.ts`.
 *
 * The roster is built from ONE REST body — `GET /api/campaigns/:id/characters`,
 * one `characterDto` per row — so the screen comes up fully populated with no
 * WebSocket traffic at all (LIVE-1). Filled monitor boxes ride in `play`, not
 * on the sheet (FR3.4); karma and nuyen are ledger sums, never sheet numbers
 * (FR3.6).
 *
 * Numbers the GM reads off a row are the SERVER's derived numbers once
 * `GET /api/characters/:id/derived` has answered. Until then the browser runs
 * the same `@safehouse/rules` engine locally and the row is flagged `est`,
 * because a locally-derived pool is missing the active scene's environment and
 * the caster's live foci — printing it as authoritative would be a number with
 * a false receipt (Principle 3).
 */
import { SheetV1Schema, type DerivedCharacter, type SheetV1 } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface MonitorTrack {
  max: number;
  filled: number;
}

export interface PartyBalances {
  karma: number;
  nuyen: number;
  /** What the balances become if every pending entry is approved (FR3.6). */
  pending: { karma: number; nuyen: number };
}

/** One PC as the GM's roster needs it. */
export interface PartyMember {
  id: string;
  campaignId: string;
  name: string;
  alias: string;
  metatype: string;
  ownerUserId: string | null;
  status: string;
  /** Null when the stored sheet does not validate — the row still renders. */
  sheet: SheetV1 | null;
  /** Live-play filled boxes (`play.monitors`), not sheet state. */
  wounds: { physical: number; stun: number; overflow: number };
  edge: { max: number; current: number; burned: number };
  balances: PartyBalances;
  hasChummerBlob: boolean;
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** `characterDto` (services/characters.ts) → the roster row. */
export function normalizeMember(raw: unknown): PartyMember {
  const r = rec(raw);
  const parsed = SheetV1Schema.safeParse(r['sheet']);
  const sheet = parsed.success ? parsed.data : null;
  const play = rec(r['play']);
  const monitors = rec(play['monitors']);
  const balances = rec(r['balances']);
  const pending = rec(balances['pending']);
  const edg = sheet?.attributes.edg ?? { max: 0, current: 0 };
  return {
    id: str(r['id'], ''),
    campaignId: str(r['campaignId'], ''),
    name: str(r['name'], sheet?.identity.alias ?? 'Unknown'),
    alias: sheet?.identity.alias ?? str(r['name'], 'Unknown'),
    metatype: sheet?.identity.metatype ?? 'unknown',
    ownerUserId: typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
    status: str(r['status'], 'active'),
    sheet,
    wounds: {
      physical: num(monitors['physical']),
      stun: num(monitors['stun']),
      overflow: num(monitors['overflow']),
    },
    edge: { max: edg.max, current: edg.current, burned: num(play['edgeBurned']) },
    balances: {
      karma: num(balances['karma']),
      nuyen: num(balances['nuyen']),
      pending: { karma: num(pending['karma']), nuyen: num(pending['nuyen']) },
    },
    hasChummerBlob: r['hasChummerBlob'] === true,
  };
}

/** Roster order: alias, case-insensitively — stable across refetches. */
export function sortMembers(members: readonly PartyMember[]): PartyMember[] {
  return [...members].sort((a, b) => a.alias.localeCompare(b.alias, 'en', { sensitivity: 'base' }));
}

// ---------------------------------------------------------------------------
// Derived vitals
// ---------------------------------------------------------------------------

/** The half of `GET /api/characters/:id/derived` the roster reads. */
export interface DerivedSnapshot {
  derived: DerivedCharacter;
  monitors: { physical: MonitorTrack; stun: MonitorTrack; overflow: MonitorTrack };
  wounds: { physical: number; stun: number; overflow: number };
  edge: { max: number; current: number; burned: number } | null;
}

function track(v: unknown): MonitorTrack {
  const t = rec(v);
  return { max: num(t['max']), filled: num(t['filled']) };
}

export function normalizeDerived(raw: unknown): DerivedSnapshot | null {
  const r = rec(raw);
  const body = r['derived'];
  const d = rec(body);
  if (!('pools' in d) || !('initiative' in d)) return null;
  const monitors = rec(r['monitors']);
  const wounds = rec(r['wounds']);
  const edge = rec(r['edge']);
  return {
    derived: body as DerivedCharacter,
    monitors: {
      physical: track(monitors['physical']),
      stun: track(monitors['stun']),
      overflow: track(monitors['overflow']),
    },
    wounds: {
      physical: num(wounds['physical']),
      stun: num(wounds['stun']),
      overflow: num(wounds['overflow']),
    },
    edge: 'max' in edge ? { max: num(edge['max']), current: num(edge['current']), burned: num(edge['burned']) } : null,
  };
}

/** The handful of numbers a GM actually asks a player for, mid-table. */
export interface PartyVitals {
  physical: MonitorTrack;
  stun: MonitorTrack;
  overflow: MonitorTrack;
  /** Negative; −1 per three filled boxes per monitor (§10.2). */
  woundModifier: number;
  pools: { defense: number | null; soak: number | null; perception: number | null };
  initiative: { base: number; dice: number } | null;
  edge: { max: number; current: number; burned: number };
  /**
   * False → these came from the browser's own engine, not the server, and are
   * missing the active scene's environment. The row prints `est` (FR10.5).
   */
  authoritative: boolean;
}

const NO_VITALS: PartyVitals = {
  physical: { max: 0, filled: 0 },
  stun: { max: 0, filled: 0 },
  overflow: { max: 0, filled: 0 },
  woundModifier: 0,
  pools: { defense: null, soak: null, perception: null },
  initiative: null,
  edge: { max: 0, current: 0, burned: 0 },
  authoritative: false,
};

function poolsOf(derived: DerivedCharacter): PartyVitals['pools'] {
  return {
    defense: derived.pools['defense']?.total ?? null,
    soak: derived.pools['soak']?.total ?? null,
    perception: derived.pools['skill.perception']?.total ?? null,
  };
}

/**
 * The row's numbers: the server's when a `/derived` snapshot has landed, the
 * browser's own derivation of the same sheet until then. Both are the SAME
 * engine (`@safehouse/rules`) — the difference is the situational context only
 * the server holds, which is exactly what `authoritative: false` warns about.
 */
export function vitalsFor(
  member: PartyMember,
  snapshot: DerivedSnapshot | null | undefined,
): PartyVitals {
  if (snapshot) {
    return {
      physical: snapshot.monitors.physical,
      stun: snapshot.monitors.stun,
      overflow: snapshot.monitors.overflow,
      woundModifier: snapshot.derived.woundModifier?.value ?? 0,
      pools: poolsOf(snapshot.derived),
      initiative: {
        base: snapshot.derived.initiative.physical.base.value,
        dice: snapshot.derived.initiative.physical.dice.value,
      },
      edge: snapshot.edge ?? member.edge,
      authoritative: true,
    };
  }
  if (!member.sheet) return { ...NO_VITALS, edge: member.edge };
  const derived = deriveCharacter(member.sheet, {
    wounds: { physical: member.wounds.physical, stun: member.wounds.stun },
  });
  return {
    physical: { max: derived.monitors.physical.value, filled: member.wounds.physical },
    stun: { max: derived.monitors.stun.value, filled: member.wounds.stun },
    overflow: { max: derived.monitors.overflow.value, filled: member.wounds.overflow },
    woundModifier: derived.woundModifier?.value ?? 0,
    pools: poolsOf(derived),
    initiative: {
      base: derived.initiative.physical.base.value,
      dice: derived.initiative.physical.dice.value,
    },
    edge: member.edge,
    authoritative: false,
  };
}

// ---------------------------------------------------------------------------
// GM affordances: damage / heal (FR3.4)
// ---------------------------------------------------------------------------

export type MonitorKey = 'physical' | 'stun';
export type DamageOp = 'damage' | 'heal';

export interface DamageRequest {
  monitor: MonitorKey;
  boxes: number;
  op: DamageOp;
  note?: string;
}

/**
 * Where a monitor lands after `boxes` of damage or healing, clamped to the
 * track. This is the OPTIMISTIC answer the row paints immediately; the server
 * re-answers with overflow handling and the real wound modifier, and its reply
 * wins. Assistive, never enforcing (Principle 2).
 */
export function nextFilled(filled: number, max: number, op: DamageOp, boxes: number): number {
  const step = Math.max(0, Math.trunc(boxes));
  const next = op === 'heal' ? filled - step : filled + step;
  return Math.min(Math.max(0, next), Math.max(0, max));
}

/** Fold a monitor move back into the member so the row re-derives from it. */
export function withWounds(
  member: PartyMember,
  patch: Partial<PartyMember['wounds']>,
): PartyMember {
  return { ...member, wounds: { ...member.wounds, ...patch } };
}

/** Apply a damage/heal request to a member, given the track it is moving. */
export function withDamage(
  member: PartyMember,
  vitals: PartyVitals,
  req: DamageRequest,
): PartyMember {
  const track = vitals[req.monitor];
  const next = nextFilled(track.filled, track.max, req.op, req.boxes);
  return withWounds(
    member,
    req.monitor === 'physical' ? { physical: next } : { stun: next },
  );
}

// ---------------------------------------------------------------------------
// GM affordances: karma / nuyen (FR3.6 — every move is a ledger entry)
// ---------------------------------------------------------------------------

export type Currency = 'karma' | 'nuyen';

export interface AwardRequest {
  currency: Currency;
  /** Signed: positive awards, negative deducts. */
  delta: number;
  reason: string;
}

/**
 * `POST /api/characters/:id/ledger` body. A GM-posted entry lands `approved`
 * (the server decides that from the device role — this only asks); a spend is
 * the same call with a negative delta. There is no "set the balance" path,
 * because a balance is a sum of entries and nothing else (FR3.6).
 */
export function awardBody(req: AwardRequest): { currency: Currency; delta: number; reason: string } {
  return {
    currency: req.currency,
    delta: Math.trunc(req.delta),
    reason: req.reason.trim().length > 0 ? req.reason.trim() : 'GM adjustment',
  };
}

export function awardIsValid(req: AwardRequest): boolean {
  return Number.isFinite(req.delta) && Math.trunc(req.delta) !== 0;
}

/** Optimistic balance move while the ledger write is in flight. */
export function withAward(member: PartyMember, req: AwardRequest): PartyMember {
  const delta = Math.trunc(req.delta);
  const b = member.balances;
  return {
    ...member,
    balances: {
      karma: b.karma + (req.currency === 'karma' ? delta : 0),
      nuyen: b.nuyen + (req.currency === 'nuyen' ? delta : 0),
      pending: b.pending,
    },
  };
}

// ---------------------------------------------------------------------------
// Which device is this PC's, and is it here?
// ---------------------------------------------------------------------------

/**
 * `unclaimed` is the honest word for a character with no `ownerUserId`: the
 * server binds a phone to a sheet by owner and nothing else, so an unclaimed
 * PC is one nobody at the table can open (see PATCH /api/characters/:id/owner).
 * `no-device` is its rarer cousin — an owner exists but has no device row left,
 * which reaches the same place by a different road and must not be reported as
 * "paired".
 */
export type DeviceState = 'online' | 'paired' | 'revoked' | 'unclaimed' | 'no-device';

export interface DeviceLink {
  state: DeviceState;
  /** Device label, else the player's display name, else null. */
  label: string | null;
  deviceId: string | null;
}

export interface RosterDevice {
  id: string;
  label?: string | undefined;
  role?: string | undefined;
  userId?: string | undefined;
  userName?: string | undefined;
  revokedAt?: string | null | undefined;
}

/**
 * REST is the base state (a device row exists, and is or is not revoked); the
 * live presence map only ever REFINES `paired` into `online`. That ordering is
 * LIVE-1: a GM who reloads mid-session must still see who owns which sheet,
 * even before a single `presence.changed` has arrived.
 */
export function deviceFor(
  member: PartyMember,
  devices: readonly RosterDevice[] | undefined,
  presence: Readonly<Record<string, { state: string }>> | undefined,
): DeviceLink {
  const owner = member.ownerUserId;
  if (!owner) return { state: 'unclaimed', label: null, deviceId: null };
  const mine = (devices ?? []).filter((d) => d.userId === owner);
  if (mine.length === 0) {
    // Owned by a user with no device row at all: claimed on paper, unreachable
    // in the room. Saying "paired" here would be a lie the GM acts on.
    return { state: 'no-device', label: null, deviceId: null };
  }
  const livePhone = mine.find((d) => !d.revokedAt);
  const chosen = livePhone ?? mine[0]!;
  const label = chosen.label ?? (chosen.userName && chosen.userName.length > 0 ? chosen.userName : null);
  if (!livePhone) return { state: 'revoked', label, deviceId: chosen.id };
  const here = presence?.[owner]?.state === 'online';
  return { state: here ? 'online' : 'paired', label, deviceId: chosen.id };
}

export const DEVICE_WORDS: Record<DeviceState, string> = {
  online: 'online',
  paired: 'paired',
  revoked: 'revoked',
  unclaimed: 'unclaimed',
  'no-device': 'no device',
};

/** Can any phone at the table open this sheet right now? */
export function isReachable(state: DeviceState): boolean {
  return state === 'online' || state === 'paired';
}

// ---------------------------------------------------------------------------
// Tokens on the active scene (FR9.4) — "where is this PC standing?"
// ---------------------------------------------------------------------------

export interface RosterToken {
  id: string;
  sceneId: string;
  source: string;
  sourceId?: string | null | undefined;
  name: string;
  x: number;
  y: number;
}

/** The token that IS this character on the scene being looked at, if any. */
export function tokenFor(
  member: PartyMember,
  tokens: readonly RosterToken[] | undefined,
): RosterToken | null {
  return (
    (tokens ?? []).find((t) => t.source === 'character' && t.sourceId === member.id) ?? null
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function formatNuyen(n: number): string {
  return `${n.toLocaleString('en-US')}¥`;
}

/** Roster-wide totals for the panel header — what the table is carrying. */
export interface PartyTotals {
  count: number;
  karma: number;
  nuyen: number;
  wounded: number;
  unclaimed: number;
}

export function partyTotals(members: readonly PartyMember[]): PartyTotals {
  let karma = 0;
  let nuyen = 0;
  let wounded = 0;
  let unclaimed = 0;
  for (const m of members) {
    karma += m.balances.karma;
    nuyen += m.balances.nuyen;
    if (m.wounds.physical > 0 || m.wounds.stun > 0) wounded += 1;
    // The count the chip advertises is the one the assign control fixes.
    if (!m.ownerUserId) unclaimed += 1;
  }
  return { count: members.length, karma, nuyen, wounded, unclaimed };
}
