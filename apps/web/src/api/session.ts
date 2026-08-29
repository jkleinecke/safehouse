/**
 * Device sessions (FR1.1/1.3) — long-lived per-device bearer tokens minted by
 * `GET /api/join/:code`, the GM bootstrap `POST /api/campaigns`, or a GM
 * pairing code.
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
}
// The device's own character is NOT stored here: invites are not
// character-bound, and a client-declared id would let any device claim any
// sheet. Resolve it from the roster with `useMyCharacterId` instead.

/**
 * Response of `GET /api/join/:code` — a user, a device, and its long-lived
 * bearer token, all minted in one hop so nobody types anything (FR1.1).
 * `POST /api/campaigns` and `POST /api/campaigns/:id/gm-device` answer with the
 * same shape minus `user.displayName` guarantees, so both feed `sessionFrom`.
 */
export interface JoinResponse {
  token: string;
  role: Role;
  campaignId: string;
  deviceId: string;
  user?: { id: string; displayName: string };
}

export const ROLES: readonly Role[] = ['gm', 'player', 'observer', 'display'];

/** Legacy single-blob key. Read once, migrated into its role slot, then left. */
export const LEGACY_KEY = 'safehouse.session';
/** Per-role slot prefix in localStorage. */
export const SESSION_PREFIX = 'safehouse.session.';
/** localStorage: which role was signed in most recently (tab-pin fallback). */
export const ACTIVE_ROLE_KEY = 'safehouse.session.active';
/** sessionStorage: this tab's pinned role — the collision fix. */
export const TAB_ROLE_KEY = 'safehouse.session.role';

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

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.token || !isRole(parsed.role) || !parsed.campaignId) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

function slotKey(role: Role): string {
  return `${SESSION_PREFIX}${role}`;
}

/** Normalise a join/bootstrap response into a stored session. */
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
 * Every stored session, newest-role-first is not meaningful, so the order is
 * the stable `ROLES` order. The legacy blob is folded into its role slot on the
 * way past, so an old hand-written `safehouse.session` keeps working exactly
 * once and then lives in the new world.
 */
export function readSessions(stores: SessionStores): Session[] {
  const out = new Map<Role, Session>();

  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (legacy) out.set(legacy.role, legacy);

  for (const role of ROLES) {
    const slot = parseSession(read(stores.local, slotKey(role)));
    // A slot must match its key: a corrupted/renamed blob is ignored, never
    // trusted into another role's chair.
    if (slot && slot.role === role) out.set(role, slot);
  }
  return ROLES.flatMap((role) => {
    const s = out.get(role);
    return s ? [s] : [];
  });
}

/** Which role this tab is bound to, if it has been decided yet. */
export function readTabRole(stores: SessionStores): Role | null {
  const pinned = read(stores.tab, TAB_ROLE_KEY);
  return isRole(pinned) ? pinned : null;
}

/** The most recently signed-in role — the fallback when a tab has no pin. */
export function readActiveRole(stores: SessionStores): Role | null {
  const active = read(stores.local, ACTIVE_ROLE_KEY);
  return isRole(active) ? active : null;
}

/** Pin this tab to a role (idempotent). */
export function pinTabRole(stores: SessionStores, role: Role): void {
  write(stores.tab, TAB_ROLE_KEY, role);
}

/**
 * The session this tab should be using.
 *
 * Order: the tab's own pin → the browser's last-active role → the only stored
 * session → nothing. Resolving also *pins* the tab, which is what stops a
 * later join in another tab from moving this one (see the header).
 */
export function resolveSession(stores: SessionStores): Session | null {
  const sessions = readSessions(stores);
  if (sessions.length === 0) return null;

  const byRole = new Map(sessions.map((s) => [s.role, s]));

  const pinned = readTabRole(stores);
  if (pinned) {
    const hit = byRole.get(pinned);
    if (hit) return hit;
    // The pinned role was signed out in another tab. Fall through rather than
    // stranding this tab on a dead pin.
  }

  const active = readActiveRole(stores);
  const chosen = (active ? byRole.get(active) : undefined) ?? sessions[0];
  if (!chosen) return null;
  pinTabRole(stores, chosen.role);
  return chosen;
}

/**
 * Store a session in its role slot and make it this tab's session. Other roles'
 * slots — and other tabs' pins — are untouched: that is the whole point.
 */
export function writeSession(stores: SessionStores, session: Session): void {
  write(stores.local, slotKey(session.role), JSON.stringify(session));
  write(stores.local, ACTIVE_ROLE_KEY, session.role);
  pinTabRole(stores, session.role);
  // The legacy blob would otherwise shadow a later sign-out of this same role.
  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (legacy && legacy.role === session.role) drop(stores.local, LEGACY_KEY);
}

/**
 * Point this tab at an already-stored session (the "switch device" affordance).
 * Returns null when that role has no stored session.
 */
export function activateSession(stores: SessionStores, role: Role): Session | null {
  const hit = readSessions(stores).find((s) => s.role === role);
  if (!hit) return null;
  pinTabRole(stores, role);
  write(stores.local, ACTIVE_ROLE_KEY, role);
  return hit;
}

/**
 * Sign out one role (default: this tab's). Only that slot goes; a GM signing
 * their player view out keeps the GM token.
 */
export function dropSession(stores: SessionStores, role?: Role): void {
  const target = role ?? resolveSession(stores)?.role ?? null;
  if (!target) return;
  drop(stores.local, slotKey(target));
  const legacy = parseSession(read(stores.local, LEGACY_KEY));
  if (legacy && legacy.role === target) drop(stores.local, LEGACY_KEY);
  if (readTabRole(stores) === target) drop(stores.tab, TAB_ROLE_KEY);
  if (readActiveRole(stores) === target) drop(stores.local, ACTIVE_ROLE_KEY);
}

/** Sign every role out of this browser. */
export function dropAllSessions(stores: SessionStores): void {
  for (const role of ROLES) drop(stores.local, slotKey(role));
  drop(stores.local, LEGACY_KEY);
  drop(stores.local, ACTIVE_ROLE_KEY);
  drop(stores.tab, TAB_ROLE_KEY);
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

/** Sign out — this tab's role by default, or a named one. */
export function clearSession(role?: Role): void {
  dropSession(browserStores(), role);
}

export function clearAllSessions(): void {
  dropAllSessions(browserStores());
}

/** Every device session stored in this browser (for the switcher UI). */
export function listSessions(): Session[] {
  return readSessions(browserStores());
}

/** Switch this tab to another stored session; null when there is none. */
export function switchSession(role: Role): Session | null {
  return activateSession(browserStores(), role);
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}
