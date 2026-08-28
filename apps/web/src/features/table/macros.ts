/**
 * Personal dice macros (FR2.8) — recurring custom rolls, stored per campaign
 * in localStorage. Device-local by design: macros are a convenience, the
 * server never needs them.
 */
import type { LimitKind } from '@safehouse/contracts';

export interface DiceMacro {
  id: string;
  name: string;
  pool: number;
  limitKind?: LimitKind;
  limitValue?: number;
  edge?: 'push_pre' | 'push_post' | 'second_chance';
}

export const MACRO_LIMIT = 24;

const keyFor = (campaignId: string) => `safehouse.macros.${campaignId}`;

function storage(override?: Storage): Storage | null {
  if (override) return override;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadMacros(campaignId: string, store?: Storage): DiceMacro[] {
  const s = storage(store);
  if (!s) return [];
  try {
    const raw = s.getItem(keyFor(campaignId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
      .filter((m) => typeof m['id'] === 'string' && typeof m['name'] === 'string' && typeof m['pool'] === 'number')
      .map((m) => m as unknown as DiceMacro)
      .slice(0, MACRO_LIMIT);
  } catch {
    return [];
  }
}

export function saveMacros(campaignId: string, macros: DiceMacro[], store?: Storage): void {
  const s = storage(store);
  if (!s) return;
  try {
    s.setItem(keyFor(campaignId), JSON.stringify(macros.slice(0, MACRO_LIMIT)));
  } catch {
    // storage full / private mode — macros just don't persist
  }
}

/** Add (newest first, capped); returns the new list. */
export function addMacro(
  campaignId: string,
  macro: Omit<DiceMacro, 'id'>,
  store?: Storage,
): DiceMacro[] {
  const withId: DiceMacro = { ...macro, id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}` };
  const next = [withId, ...loadMacros(campaignId, store)].slice(0, MACRO_LIMIT);
  saveMacros(campaignId, next, store);
  return next;
}

export function removeMacro(campaignId: string, id: string, store?: Storage): DiceMacro[] {
  const next = loadMacros(campaignId, store).filter((m) => m.id !== id);
  saveMacros(campaignId, next, store);
  return next;
}
