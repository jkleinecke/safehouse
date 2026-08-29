/**
 * Sign-in helpers for the landing screen (FR1.1/1.2, BUILD_REPORT gap #2).
 *
 * Pure string/route logic only — the network calls live in `signin-api.ts` so
 * the fiddly parts (what counts as a pairing code, what a pasted token looks
 * like, where a role lands) are unit tested without a DOM.
 */
import type { Role } from '@safehouse/contracts';
import { ROLES, isRole, type Session } from '../../api/session.js';

/** Where a freshly signed-in device belongs. */
export function destinationFor(session: Pick<Session, 'role' | 'campaignId'>): string {
  if (session.role === 'display') return `/tv/${session.campaignId}`;
  if (session.role === 'gm') return `/c/${session.campaignId}/gm`;
  return `/c/${session.campaignId}`;
}

/** Human label for the switcher / "signed in as" chip. */
export function roleLabel(role: Role): string {
  return role === 'display' ? 'table TV' : role;
}

/**
 * What the GM actually has in hand: a code read aloud (`ABCD-2345`), a code
 * typed with the wrong case, or the whole join URL off the QR. All three
 * normalise to the bare code the server minted.
 *
 * The alphabet is deliberately narrow (`mintJoinCode`: no 0/O/1/I), so we keep
 * only characters that can legally appear and reject anything left empty —
 * better a clear "that isn't a code" than a 404 from the server.
 */
export function normalizePairCode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // A pasted join URL: take the last non-empty path segment after /join/.
  const fromUrl = /\/join\/([^/?#\s]+)/i.exec(trimmed);
  const raw = fromUrl?.[1] ?? trimmed;

  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4 || code.length > 32) return null;
  return code;
}

/** The SPA route a pairing code is redeemed on (never the API path — LIVE-3). */
export function joinRouteFor(code: string): string {
  return `/join/${encodeURIComponent(code)}`;
}

/**
 * A pasted device token — the escape hatch for a GM holding a token printed by
 * `seed:demo` or `POST /api/campaigns`. Accepts either the whole JSON blob the
 * old workaround told people to write into localStorage, or a bare token plus
 * the campaign id typed beside it.
 */
export interface PastedSession {
  token: string;
  role: Role;
  campaignId: string;
}

export function parsePastedSession(
  text: string,
  fallback: { campaignId?: string; role?: Role } = {},
): PastedSession | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const token = typeof parsed['token'] === 'string' ? parsed['token'].trim() : '';
      const campaignId =
        typeof parsed['campaignId'] === 'string'
          ? parsed['campaignId'].trim()
          : (fallback.campaignId ?? '').trim();
      const role = isRole(parsed['role']) ? parsed['role'] : (fallback.role ?? 'gm');
      if (!token || !campaignId) return null;
      return { token, role, campaignId };
    } catch {
      return null;
    }
  }

  // Bare token: base64url from `mintToken()`, so anything outside that alphabet
  // is a paste accident (a stray quote, a "Bearer " prefix) rather than a token.
  const token = trimmed.replace(/^Bearer\s+/i, '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const campaignId = (fallback.campaignId ?? '').trim();
  if (!campaignId) return null;
  return { token, role: fallback.role ?? 'gm', campaignId };
}

/** Roles a device can be pasted in as (a display token pastes too — kiosks). */
export const PASTE_ROLES: readonly Role[] = ROLES;
