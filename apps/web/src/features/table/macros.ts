/**
 * The table roller's OLD device-local macro rack (FR2.8), kept for one job:
 * handing its contents over.
 *
 * Macros are server-backed and per-user now (`features/sheet/macroStore.ts`),
 * so a player's rack follows them onto a borrowed phone and the GM's follows
 * them onto a second laptop. This module's key —
 * `safehouse.macros.<campaign>`, with no user in it — predates that, and a GM
 * upgrading mid-campaign has a rack sitting under it that the new store would
 * never look at. `takeLegacyMacros` reads that rack once and clears it, so the
 * buttons move rather than vanish.
 *
 * Nothing writes here any more. When no upgrading instance can plausibly still
 * be holding a rack under the old key, this file goes.
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

/**
 * Read the legacy rack and clear it, in that order — the migration into the
 * server-backed store (`features/table/DiceRoller.tsx`).
 *
 * Clearing immediately is deliberate. The alternative is clearing after the
 * push succeeds, which sounds safer and is not: the push is idempotent on the
 * label, so a retry costs nothing, while a rack left in place is re-adopted on
 * every load and resurrects a macro the player deleted on their other device.
 * Returns `[]` when there is nothing to take, which is the common case.
 */
export function takeLegacyMacros(campaignId: string, store?: Storage): DiceMacro[] {
  const s = storage(store);
  if (!s) return [];
  const macros = loadMacros(campaignId, store);
  if (macros.length === 0) return [];
  try {
    s.removeItem(keyFor(campaignId));
  } catch {
    // Storage blocked: nothing was persisted to clear either.
  }
  return macros;
}
