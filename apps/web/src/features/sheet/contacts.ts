/**
 * Contacts on the sheet (FR3.2 tab, FR5.8 data) — the little black book.
 *
 * `GET /api/characters/:id/contacts` → `{ characterId, contacts: ContactDto[] }`
 * (`apps/server/src/plugins/contacts.ts`). BUILD_REPORT §4.9 had this call
 * pointing at a route that did not exist; it does now, and the sheet grew the
 * tab that shows it.
 *
 * Access is owner-or-GM and it is enforced SERVER-side (Principle 4): another
 * player's fixer, the debt they owe him and what they wrote about him are
 * theirs. This client never filters — it either gets the list or gets a 403.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client.js';
import { characterKey, HYDRATE_ON_MOUNT } from './api.js';

export interface ContactFavours {
  /** Favours the contact owes the character. */
  owed: number;
  /** Favours the character owes the contact. */
  owing: number;
}

export interface ContactRecord {
  id: string;
  characterId?: string;
  name: string;
  archetype: string;
  /** SR5 Connection 1–12: how far their reach goes. */
  connection: number;
  /** SR5 Loyalty 1–6: how far they will stick their neck out. */
  loyalty: number;
  notes: string;
  favours: ContactFavours;
  /** The codex page this contact actually is, when one is linked (FR5.1/5.3). */
  npcPageId: string | null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** Tolerant of the older shapes too (a bare array, a contact with no favours). */
export function normalizeContacts(raw: unknown): ContactRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { contacts?: unknown } | null)?.contacts)
      ? (raw as { contacts: unknown[] }).contacts
      : [];
  const out: ContactRecord[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c['id'] !== 'string' || typeof c['name'] !== 'string') continue;
    const fav = (typeof c['favours'] === 'object' && c['favours'] !== null
      ? c['favours']
      : {}) as Record<string, unknown>;
    out.push({
      id: c['id'],
      ...(typeof c['characterId'] === 'string' ? { characterId: c['characterId'] } : {}),
      name: c['name'],
      archetype: typeof c['archetype'] === 'string' ? c['archetype'] : '',
      connection: num(c['connection']),
      loyalty: num(c['loyalty']),
      notes: typeof c['notes'] === 'string' ? c['notes'] : '',
      favours: { owed: num(fav['owed']), owing: num(fav['owing']) },
      npcPageId: typeof c['npcPageId'] === 'string' ? c['npcPageId'] : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Contacts sorted into "owes me / I owe" order for the tab's summary line. */
export function favourTotals(contacts: readonly ContactRecord[]): ContactFavours {
  return contacts.reduce<ContactFavours>(
    (acc, c) => ({ owed: acc.owed + c.favours.owed, owing: acc.owing + c.favours.owing }),
    { owed: 0, owing: 0 },
  );
}

export function useContacts(characterId: string | undefined) {
  return useQuery({
    queryKey: [...characterKey(characterId ?? ''), 'contacts'],
    queryFn: async (): Promise<ContactRecord[]> =>
      normalizeContacts(await apiGet<unknown>(`/api/characters/${characterId}/contacts`)),
    enabled: Boolean(characterId),
    // A 403 here means "not your sheet" — a real answer worth showing once,
    // not something to retry into a spinner.
    retry: false,
    ...HYDRATE_ON_MOUNT,
  });
}
