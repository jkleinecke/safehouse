/**
 * Device session persisted in localStorage — minted by GET /join/:code
 * (QR-join auth, DESIGN.md FR1.1/1.3). Long-lived per-device bearer token.
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
 * Response of GET /join/:code — a fresh user, a device, and its long-lived
 * bearer token, all minted in one hop so nobody types anything (FR1.1).
 */
export interface JoinResponse {
  token: string;
  role: Role;
  campaignId: string;
  deviceId: string;
  user: { id: string; displayName: string };
}

const KEY = 'safehouse.session';

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.token || !parsed.role || !parsed.campaignId) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private mode / storage blocked — the session just won't survive reload.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}
