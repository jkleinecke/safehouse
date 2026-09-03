/**
 * Device sessions (FR1.1/1.3) — long-lived per-device bearer tokens minted by
 * `GET /api/join/:code`, the GM bootstrap `POST /api/campaigns`, a GM pairing
 * code, or `POST /api/gm/recover` on the machine hosting the server.
 *
 * ## Why this is not one localStorage key any more
 *
 * Two tabs of one browser share localStorage. The GM keeps a player view open
 * on the same laptop all the time — to see what the table sees — and the moment
 * that tab joined, it overwrote the single `safehouse.session` blob and logged
 * the GM out of their own console. Observed live; it is the same-origin session
 * collision.
 *
 * The fix is two-part and both halves matter:
 *
 *   1. **Per-role slots in localStorage** (`safehouse.session.gm`,
 *      `…player`, …). A second role never destroys the first, so even when
 *      per-tab storage is unavailable the GM token still exists and the
 *      switcher can return to it.
 *   2. **A per-tab pin in sessionStorage** (`safehouse.session.role`). A tab
 *      decides once which role it is and keeps it for its whole life, so the
 *      player tab joining next door cannot move the GM tab.
 *
 * When sessionStorage is blocked (private mode, a locked-down kiosk) the tab
 * pin degrades to the localStorage "last active role" pointer: the collision
 * comes back as a *display* problem, never as data loss, and the switcher fixes
 * it in one tap.
 *
 * ## Why a role is no longer the whole identity
 *
 * The same collision has a second axis. A device token is minted per
 * (campaign, device), so a GM running two tables holds two `gm` tokens — and
 * with one slot per role, creating or joining the second campaign evicted the
 * first exactly the way the player tab used to evict the GM. The GM is meant to
 * reopen the browser between sessions and pick a table, which is impossible if
 * only the newest one survives.
 *
 * So the stored identity is now the **(campaign, role) pair** (`sessionKey`),
 * and the layout grew one key:
 *
 *   - `safehouse.session.campaigns` — the **roster**: every stored session, as
 *     a JSON array, most-recently-activated first. This is what makes several
 *     campaigns coexist, and it is the authoritative list.
 *   - `safehouse.session.<role>` — unchanged, and deliberately kept: it now
 *     mirrors *which* session that role is currently using. It is what an old
 *     browser upgrading into this build already has, and what the rest of the
 *     app has always been able to read with one `getItem`.
 *   - `safehouse.session.active` / `…active-campaign` (localStorage) and
 *     `safehouse.session.role` / `…tab-campaign` (sessionStorage) — the
 *     last-active pointer and the tab pin, each grown a campaign half. Both
 *     halves are plain strings so a tab pinned by the previous build still
 *     resolves: a role with no campaign beside it means "that role's most
 *     recent campaign", which is what the old build meant.
 *
 * Reads merge roster + legacy blob + role slots, so nothing that ever wrote a
 * session is stranded, and a slot wins over the roster for the same pair —
 * a single-key write is the fresher fact.
 *
 * Storage is injected through `StorageLike` so the resolution rules are unit
 * tested without a DOM; the exported convenience functions bind the browser's
 * real stores.
 */
import type { Role } from '@safehouse/contracts';

export interface Session {
  token: string;
  role: Role;
  campaignId: string;
  deviceId?: string;
  userId?: string;
  displayName?: string;
  /**
   * The campaign's name, remembered opportunistically once the server has told
   * us (`GET /api/campaigns`). Never trusted for anything but a label — the
   * switcher and the campaign picker would otherwise offer a row of UUIDs.
   */
  campaignName?: string;
}
// The device's own character is NOT stored here: invites are not
// character-bound, and a client-declared id would let any device claim any
// sheet. Resolve it from the roster with `useMyCharacterId` instead.

/**
 * Response of `GET /api/join/:code` — a user, a device, and its long-lived
 * bearer token, all minted in one hop so nobody types anything (FR1.1).
 * `POST /api/campaigns`, `POST /api/campaigns/:id/gm-device` and
 * `POST /api/gm/recover` answer with the same shape minus `user.displayName`
 * guarantees, so all four feed `sessionFrom`.
 */
export interface JoinResponse {
  token: string;
  role: Role;
  campaignId: string;
  deviceId: string;
  user?: { id: string; displayName: string };
}

export const ROLES: readonly Role[] = ['gm', 'player', 'observer', 'display'];

/** Legacy single-blob key. Read once, migrated into the roster, then left. */
export const LEGACY_KEY = 'safehouse.session';
/** Per-role slot prefix in localStorage — the role's *current* session. */
export const SESSION_PREFIX = 'safehouse.session.';
/** localStorage: every stored (campaign, role) session, newest first. */
export const ROSTER_KEY = 'safehouse.session.campaigns';
/** localStorage: which role was signed in most recently (tab-pin fallback). */
export const ACTIVE_ROLE_KEY = 'safehouse.session.active';
/** localStorage: which campaign that role was last using. */
export const ACTIVE_CAMPAIGN_KEY = 'safehouse.session.active-campaign';
/** sessionStorage: this tab's pinned role — the collision fix. */
export const TAB_ROLE_KEY = 'safehouse.session.role';
/** sessionStorage: this tab's pinned campaign — the second axis of the pin. */
export const TAB_CAMPAIGN_KEY = 'safehouse.session.tab-campaign';

/**
 * How many sessions the roster keeps. A token is re-mintable and localStorage
 * is not; an unbounded roster of ~400-byte blobs is how a browser eventually
 * throws QuotaExceeded on the one write that matters. The oldest falls off.
 */
export const ROSTER_LIMIT = 24;

/** The slice of the Storage interface we use (so tests can fake it). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStores {
  /** Shared by every tab of this browser. */
  local: StorageLike | null;
  /** This tab only. `null` when sessionStorage is unavailable. */
  tab: StorageLike | null;
}

// ---------------------------------------------------------------------------
// Storage-safe primitives (a blocked store must never throw into React)
// ---------------------------------------------------------------------------

function read(store: StorageLike | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(store: StorageLike | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // Private mode / storage blocked — the session just won't survive reload.
  }
}

function drop(store: StorageLike | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

function parseSessionValue(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null;
  const parsed = value as Partial<Session>;
  if (!parsed.token || !isRole(parsed.role) || !parsed.campaignId) return null;
  return parsed as Session;
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    return parseSessionValue(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseRoster(raw: string | null): Session[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Session[] = [];
    for (const entry of parsed) {
      const session = parseSessionValue(entry);
      if (session) out.push(session);
    }
    return out;
  } catch {
    return [];
  }
}

function slotKey(role: Role): string {
  return `${SESSION_PREFIX}${role}`;
}

/**
 * Stable identity of a stored session, and the React key the switcher lists it
 * under. A device token belongs to one campaign and one role, so that pair —
 * not the role alone — is what two sessions must differ in to coexist. The
 * role goes first because its alphabet is closed: no role contains a colon, so
 * no server-supplied campaign id can spell a different pair.
 */
export function sessionKey(session: Pick<Session, 'role' | 'campaignId'>): string {
  return `${session.role}:${session.campaignId}`;
}

/** Normalise a join/bootstrap/recover response into a stored session. */
export function sessionFrom(join: JoinResponse): Session {
  return {
    token: join.token,
    role: join.role,
    campaignId: join.campaignId,
    ...(join.deviceId ? { deviceId: join.deviceId } : {}),
    ...(join.user?.id ? { userId: join.user.id } : {}),
    ...(join.user?.displayName ? { displayName: join.user.displayName } : {}),
  };
}

// ---------------------------------------------------------------------------
// Store-level operations (pure given the stores — unit tested directly)
// ---------------------------------------------------------------------------

/**
 * Every stored session in roster order (most recently activated first).
 *
 * Three sources are folded together so nothing that ever wrote a session is
 * stranded: the roster, the legacy single blob, and the per-role slots. A
 * later source wins the *content* of a pair it already has — `Map.set` on an
 * existing key keeps its position — because a single-key write is newer than
 * the roster entry it shadows.
 */
function allSessions(stores: SessionStores): Session[] {
  const byKey = new Map<string, Session>();

  for (const session of parseRoster(read(stores.local, ROSTER_KEY))) {
    byKey.set(sessionKey(session), session);
  }

  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (legacy) byKey.set(sessionKey(legacy), legacy);

  for (const role of ROLES) {
    const slot = parseSession(read(stores.local, slotKey(role)));
    // A slot must match its key: a corrupted/renamed blob is ignored, never
    // trusted into another role's chair.
    if (slot && slot.role === role) byKey.set(sessionKey(slot), slot);
  }

  return [...byKey.values()];
}

/**
 * Every stored session, grouped in the stable `ROLES` order and, within a role,
 * most-recently-activated first — so `find(s => s.role === r)` still means
 * "that role's current session" the way it did when there was only one.
 */
export function readSessions(stores: SessionStores): Session[] {
  const all = allSessions(stores);
  return ROLES.flatMap((role) => all.filter((s) => s.role === role));
}

/** Which role this tab is bound to, if it has been decided yet. */
export function readTabRole(stores: SessionStores): Role | null {
  const pinned = read(stores.tab, TAB_ROLE_KEY);
  return isRole(pinned) ? pinned : null;
}

/** Which campaign this tab is bound to. Null on a tab pinned by an old build. */
export function readTabCampaign(stores: SessionStores): string | null {
  return read(stores.tab, TAB_CAMPAIGN_KEY);
}

/** The most recently signed-in role — the fallback when a tab has no pin. */
export function readActiveRole(stores: SessionStores): Role | null {
  const active = read(stores.local, ACTIVE_ROLE_KEY);
  return isRole(active) ? active : null;
}

/** The campaign that role was last using. */
export function readActiveCampaign(stores: SessionStores): string | null {
  return read(stores.local, ACTIVE_CAMPAIGN_KEY);
}

/** Pin this tab to a role (idempotent). */
export function pinTabRole(stores: SessionStores, role: Role): void {
  write(stores.tab, TAB_ROLE_KEY, role);
}

/** Pin this tab to one session — both halves of the identity. */
export function pinTab(stores: SessionStores, session: Session): void {
  write(stores.tab, TAB_ROLE_KEY, session.role);
  write(stores.tab, TAB_CAMPAIGN_KEY, session.campaignId);
}

/**
 * Resolve a pointer (a pinned or last-active role, plus the campaign beside
 * it) against what is actually stored.
 *
 * The campaign half is a preference, not a requirement: a pointer left by the
 * previous build has no campaign at all, and a pointer whose campaign was
 * signed out elsewhere should keep this tab in the same *role* rather than
 * throwing it back to whatever is newest.
 */
function pick(sessions: Session[], role: Role | null, campaignId: string | null): Session | undefined {
  if (!role) return undefined;
  const ofRole = sessions.filter((s) => s.role === role);
  if (ofRole.length === 0) return undefined;
  if (campaignId) {
    const exact = ofRole.find((s) => s.campaignId === campaignId);
    if (exact) return exact;
  }
  return ofRole[0];
}

/**
 * The session this tab should be using.
 *
 * Order: the tab's own pin → the browser's last-active pointer → the newest
 * stored session → nothing. Resolving also *pins* the tab, which is what stops
 * a later join in another tab from moving this one (see the header).
 */
export function resolveSession(stores: SessionStores): Session | null {
  const pinnedRole = readTabRole(stores);
  const pinnedCampaign = readTabCampaign(stores);

  // Fast path, and it is not a micro-optimisation: `getToken()` runs this on
  // every REST call and every socket URL, and a fully pinned tab already knows
  // the answer. The role slot mirrors that role's current session, so when it
  // matches the pin it *is* what the merge below would return — one read and a
  // small parse instead of the whole roster.
  if (pinnedRole && pinnedCampaign) {
    const slot = parseSession(read(stores.local, slotKey(pinnedRole)));
    if (slot && slot.role === pinnedRole && slot.campaignId === pinnedCampaign) return slot;
  }

  const sessions = readSessions(stores);
  if (sessions.length === 0) return null;

  const chosen =
    pick(sessions, pinnedRole, pinnedCampaign) ??
    pick(sessions, readActiveRole(stores), readActiveCampaign(stores)) ??
    sessions[0];
  if (!chosen) return null;

  pinTab(stores, chosen);
  return chosen;
}

function saveRoster(stores: SessionStores, sessions: Session[]): void {
  write(stores.local, ROSTER_KEY, JSON.stringify(sessions.slice(0, ROSTER_LIMIT)));
}

/**
 * Retire the legacy blob — but only once its session is provably in the
 * roster. Dropping it on the assumption that the roster write landed is how a
 * quota-full browser would turn a migration into the loss of the only GM token
 * on the machine.
 */
function retireLegacy(stores: SessionStores): void {
  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (!legacy) return;
  const key = sessionKey(legacy);
  const kept = parseRoster(read(stores.local, ROSTER_KEY)).some((s) => sessionKey(s) === key);
  if (kept) drop(stores.local, LEGACY_KEY);
}

/**
 * Store a session and make it this tab's session. Other pairs — other roles,
 * other campaigns, other tabs' pins — are untouched: that is the whole point.
 */
export function writeSession(stores: SessionStores, session: Session): void {
  const key = sessionKey(session);
  const rest = allSessions(stores).filter((s) => sessionKey(s) !== key);
  saveRoster(stores, [session, ...rest]);

  write(stores.local, slotKey(session.role), JSON.stringify(session));
  write(stores.local, ACTIVE_ROLE_KEY, session.role);
  write(stores.local, ACTIVE_CAMPAIGN_KEY, session.campaignId);
  pinTab(stores, session);
  retireLegacy(stores);
}

/**
 * Point this tab at an already-stored session (the "switch device" and "switch
 * campaign" affordances). Without `campaignId` it takes that role's current
 * session, which is what the single-campaign call sites have always meant.
 * Returns null when there is no such session.
 */
export function activateSession(
  stores: SessionStores,
  role: Role,
  campaignId?: string,
): Session | null {
  const sessions = readSessions(stores);
  const hit = sessions.find(
    (s) => s.role === role && (campaignId === undefined || s.campaignId === campaignId),
  );
  if (!hit) return null;
  writeSession(stores, hit);
  return hit;
}

/**
 * Forget the sessions `match` selects, keeping every store consistent: the
 * roster, the per-role mirror, the legacy blob, and both pointers.
 */
function removeSessions(stores: SessionStores, match: (s: Session) => boolean): void {
  const all = allSessions(stores);
  const gone = all.filter(match);
  if (gone.length === 0) return;

  const goneKeys = new Set(gone.map(sessionKey));
  const kept = all.filter((s) => !goneKeys.has(sessionKey(s)));
  saveRoster(stores, kept);

  // The mirror follows: a role whose current session went either falls back to
  // that role's next campaign or loses its key entirely.
  for (const role of new Set(gone.map((s) => s.role))) {
    const next = kept.find((s) => s.role === role);
    if (next) write(stores.local, slotKey(role), JSON.stringify(next));
    else drop(stores.local, slotKey(role));
  }

  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (legacy && goneKeys.has(sessionKey(legacy))) drop(stores.local, LEGACY_KEY);

  prunePointer(stores.tab, TAB_ROLE_KEY, TAB_CAMPAIGN_KEY, kept);
  prunePointer(stores.local, ACTIVE_ROLE_KEY, ACTIVE_CAMPAIGN_KEY, kept);
}

/**
 * A pointer to a session that no longer exists is worse than no pointer: it
 * strands a tab. The role half survives as long as *some* campaign of that
 * role does, so signing one table out leaves a GM tab a GM tab.
 */
function prunePointer(
  store: StorageLike | null,
  roleKey: string,
  campaignKey: string,
  kept: Session[],
): void {
  const role = read(store, roleKey);
  if (!isRole(role)) return;
  const ofRole = kept.filter((s) => s.role === role);
  if (ofRole.length === 0) {
    drop(store, roleKey);
    drop(store, campaignKey);
    return;
  }
  const campaignId = read(store, campaignKey);
  if (campaignId && !ofRole.some((s) => s.campaignId === campaignId)) drop(store, campaignKey);
}

/**
 * Sign out. With no arguments: this tab's session only — a GM signing out of
 * one table keeps the other and keeps their player view. With a role and no
 * campaign: that role everywhere, which is what "sign this role out of the
 * browser" has always meant.
 */
export function dropSession(stores: SessionStores, role?: Role, campaignId?: string): void {
  if (!role) {
    const current = resolveSession(stores);
    if (!current) return;
    const key = sessionKey(current);
    removeSessions(stores, (s) => sessionKey(s) === key);
    return;
  }
  removeSessions(
    stores,
    (s) => s.role === role && (campaignId === undefined || s.campaignId === campaignId),
  );
}

/**
 * Forget whichever session carries this token — the server-rejected-it path.
 *
 * Keyed on the token rather than the role so a 401 from one campaign cannot
 * take a still-good session for another campaign down with it, and so an
 * in-flight request answered after the user already switched clears the token
 * that actually failed.
 */
export function dropSessionForToken(stores: SessionStores, token: string): void {
  if (!token) return;
  removeSessions(stores, (s) => s.token === token);
}

/** Sign every role, on every campaign, out of this browser. */
export function dropAllSessions(stores: SessionStores): void {
  for (const role of ROLES) drop(stores.local, slotKey(role));
  drop(stores.local, ROSTER_KEY);
  drop(stores.local, LEGACY_KEY);
  drop(stores.local, ACTIVE_ROLE_KEY);
  drop(stores.local, ACTIVE_CAMPAIGN_KEY);
  drop(stores.tab, TAB_ROLE_KEY);
  drop(stores.tab, TAB_CAMPAIGN_KEY);
}

/**
 * Label a campaign we now know the name of. Purely cosmetic, and written back
 * so the *next* visit's picker reads "Static on the Line" before the server
 * has answered — the alternative is a list of UUID prefixes.
 */
export function noteCampaignNames(stores: SessionStores, names: Map<string, string>): void {
  if (names.size === 0) return;
  const all = allSessions(stores);
  let changed = false;
  const next = all.map((session) => {
    const name = names.get(session.campaignId);
    if (!name || session.campaignName === name) return session;
    changed = true;
    return { ...session, campaignName: name };
  });
  if (!changed) return;

  saveRoster(stores, next);
  for (const role of ROLES) {
    const slot = parseSession(read(stores.local, slotKey(role)));
    if (!slot || slot.role !== role) continue;
    const name = names.get(slot.campaignId);
    if (name && slot.campaignName !== name) {
      write(stores.local, slotKey(role), JSON.stringify({ ...slot, campaignName: name }));
    }
  }
}

// ---------------------------------------------------------------------------
// Browser bindings — the app-facing API (unchanged names, new behaviour)
// ---------------------------------------------------------------------------

function browserStores(): SessionStores {
  let local: StorageLike | null = null;
  let tab: StorageLike | null = null;
  try {
    local = globalThis.localStorage ?? null;
  } catch {
    local = null;
  }
  try {
    tab = globalThis.sessionStorage ?? null;
  } catch {
    tab = null;
  }
  return { local, tab };
}

export function getSession(): Session | null {
  return resolveSession(browserStores());
}

export function saveSession(session: Session): void {
  writeSession(browserStores(), session);
}

/**
 * Sign out — this tab's session by default, or a named role (optionally
 * narrowed to one campaign).
 */
export function clearSession(role?: Role, campaignId?: string): void {
  dropSession(browserStores(), role, campaignId);
}

/** Forget the session holding this token (a 401 came back for it). */
export function clearSessionForToken(token: string): void {
  dropSessionForToken(browserStores(), token);
}

export function clearAllSessions(): void {
  dropAllSessions(browserStores());
}

/** Every device session stored in this browser (for the switcher / picker). */
export function listSessions(): Session[] {
  return readSessions(browserStores());
}

/** Switch this tab to another stored session; null when there is none. */
export function switchSession(role: Role, campaignId?: string): Session | null {
  return activateSession(browserStores(), role, campaignId);
}

/** Remember campaign names the server just told us (labels only). */
export function rememberCampaignNames(names: Map<string, string>): void {
  noteCampaignNames(browserStores(), names);
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}
