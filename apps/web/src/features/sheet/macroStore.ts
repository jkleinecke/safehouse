/**
 * Personal dice macros (FR2.8), persisted per USER rather than per device.
 *
 * The gap: macros lived only in this browser's localStorage, so a player who
 * picked up a second phone — or cleared site data — lost every quick roll they
 * had built. FR2.8 calls them *personal* macros; personal means they follow the
 * person, not the handset.
 *
 * ## Shape of the fix
 *
 * The store is server-first with a local mirror:
 *
 *   1. read the user's macros from the server;
 *   2. fold in anything this device has that the server has not seen (the
 *      one-time migration off localStorage) and push the union back up;
 *   3. keep writing a local mirror so a phone that loses Wi-Fi mid-session
 *      still has its macros (Principle 5 — the app plays with no network).
 *
 * When the route is absent the whole thing degrades to exactly the old
 * behaviour: local mirror only, no errors, no lost macros.
 *
 * INTEGRATION (server): the surface this expects is
 *   `GET  /api/campaigns/:id/macros` → `{ macros: DiceMacro[] }`
 *   `PUT  /api/campaigns/:id/macros` `{ macros }` → `{ macros }`
 * scoped to the *authenticated user* (the device token already carries the
 * user id, so there is no id in the path). It needs one table —
 * `user_macros(campaign_id, user_id, macros jsonb, updated_at)` keyed on
 * (campaign_id, user_id) — which lives in @safehouse/db and apps/server, both
 * outside this agent's paths. Until it lands, `hasRemote` stays false, the
 * rack says "this device only", and the mirror is the whole story.
 *
 * INTEGRATION (web): `features/table/macros.ts` still holds the old
 * device-local implementation behind the table's DiceRoller. It is the same
 * `DiceMacro` shape; pointing that rack at this module gives the GM's table
 * view the same per-user persistence with no other change.
 */
import type { LimitKind } from '@safehouse/contracts';
import { ApiError, apiGet, api } from '../../api/client.js';

export interface DiceMacro {
  id: string;
  name: string;
  pool: number;
  limitKind?: LimitKind;
  limitValue?: number;
  edge?: 'push_pre' | 'push_post' | 'second_chance';
}

/** Enough for a full page of quick rolls; a phone cannot usefully show more. */
export const MACRO_LIMIT = 24;

export const macrosPath = (campaignId: string) => `/api/campaigns/${campaignId}/macros`;

/** localStorage key. Scoped by user so two players sharing a laptop do not mix. */
export function macroKey(campaignId: string, userId: string | undefined): string {
  return `safehouse.macros.${campaignId}.${userId ?? 'device'}`;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isMacro(v: unknown): v is DiceMacro {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m['id'] === 'string' && typeof m['name'] === 'string' && typeof m['pool'] === 'number';
}

/** Accept `[…]`, `{ macros: […] }`, or junk; always return a clean, capped list. */
export function normalizeMacros(raw: unknown): DiceMacro[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { macros?: unknown } | null)?.macros)
      ? (raw as { macros: unknown[] }).macros
      : [];
  const seen = new Set<string>();
  const out: DiceMacro[] = [];
  for (const item of list) {
    if (!isMacro(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      name: item.name,
      pool: Math.max(0, Math.floor(item.pool)),
      ...(item.limitKind ? { limitKind: item.limitKind } : {}),
      ...(typeof item.limitValue === 'number' ? { limitValue: item.limitValue } : {}),
      ...(item.edge ? { edge: item.edge } : {}),
    });
    if (out.length >= MACRO_LIMIT) break;
  }
  return out;
}

/**
 * Server list wins on id collision (it is the shared truth); device-only
 * macros are appended so a phone's unsynced work is adopted rather than
 * discarded. Order is server-first, which keeps the rack stable across devices.
 */
export function mergeMacros(remote: readonly DiceMacro[], local: readonly DiceMacro[]): DiceMacro[] {
  const ids = new Set(remote.map((m) => m.id));
  return [...remote, ...local.filter((m) => !ids.has(m.id))].slice(0, MACRO_LIMIT);
}

/** Ids present locally but not on the server — the reason to push after a read. */
export function needsPush(remote: readonly DiceMacro[], local: readonly DiceMacro[]): boolean {
  const ids = new Set(remote.map((m) => m.id));
  return local.some((m) => !ids.has(m.id));
}

export function newMacroId(now = Date.now(), rand = Math.random): string {
  return `m${now.toString(36)}${Math.floor(rand() * 1e4).toString(36)}`;
}

export function withMacro(list: readonly DiceMacro[], macro: DiceMacro): DiceMacro[] {
  return [macro, ...list.filter((m) => m.id !== macro.id)].slice(0, MACRO_LIMIT);
}

export function withoutMacro(list: readonly DiceMacro[], id: string): DiceMacro[] {
  return list.filter((m) => m.id !== id);
}

/** A macro is a free-form roll (FR2.8): no sheet pool to check it against. */
export function macroRollConfig(macro: DiceMacro): {
  title: string;
  baseTotal: number;
  baseBreakdown: { label: string; value: number; source: string }[];
  limit?: { kind: LimitKind; value: number };
  meta: Record<string, unknown>;
} {
  return {
    title: macro.name,
    baseTotal: macro.pool,
    baseBreakdown: [{ label: macro.name, value: macro.pool, source: 'situational' }],
    ...(macro.limitKind && typeof macro.limitValue === 'number'
      ? { limit: { kind: macro.limitKind, value: macro.limitValue } }
      : {}),
    meta: { macroId: macro.id },
  };
}

// ---------------------------------------------------------------------------
// Local mirror (storage-safe: a blocked store must never throw into React)
// ---------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readLocalMacros(
  campaignId: string,
  userId: string | undefined,
  store: StorageLike | null = browserStorage(),
): DiceMacro[] {
  if (!store) return [];
  try {
    const raw = store.getItem(macroKey(campaignId, userId));
    return raw ? normalizeMacros(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeLocalMacros(
  campaignId: string,
  userId: string | undefined,
  macros: readonly DiceMacro[],
  store: StorageLike | null = browserStorage(),
): void {
  if (!store) return;
  try {
    store.setItem(macroKey(campaignId, userId), JSON.stringify(macros.slice(0, MACRO_LIMIT)));
  } catch {
    // private mode / quota — the mirror is a convenience, never the record
  }
}

/**
 * Has this device ever completed a read from the server?
 *
 * This flag is what keeps a DELETION from being undone. Adopting the mirror's
 * extra macros is right exactly once — the migration off device-local storage.
 * After that the mirror is a cache, and a macro the server no longer has is a
 * macro the player deleted on their other phone, not one this device invented.
 * Without the flag, every fetch would resurrect it.
 */
export function hasSynced(
  campaignId: string,
  userId: string | undefined,
  store: StorageLike | null = browserStorage(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(`${macroKey(campaignId, userId)}.synced`) === '1';
  } catch {
    return false;
  }
}

export function markSynced(
  campaignId: string,
  userId: string | undefined,
  store: StorageLike | null = browserStorage(),
): void {
  if (!store) return;
  try {
    store.setItem(`${macroKey(campaignId, userId)}.synced`, '1');
  } catch {
    // Storage blocked: the migration simply runs again next time, which is
    // idempotent as long as nothing was deleted in between.
  }
}

// ---------------------------------------------------------------------------
// Network (degrades to local-only when the route is not there yet)
// ---------------------------------------------------------------------------

export interface MacroSnapshot {
  macros: DiceMacro[];
  /** False when the server has no macro route — the caller stays local-only. */
  hasRemote: boolean;
  /** The route exists but the call failed (offline / server fault). */
  degraded?: boolean;
}

/**
 * A 404/405/501 means "route not built yet"; anything else is offline or a
 * server fault. Both end in the same place — the local mirror — but the
 * distinction is what stops the UI shouting "sync failed" at a table whose
 * server simply does not have the route.
 */
export function isMissingRoute(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);
}

export async function fetchMacros(
  campaignId: string,
  userId: string | undefined,
): Promise<MacroSnapshot> {
  const local = readLocalMacros(campaignId, userId);
  try {
    const remote = normalizeMacros(await apiGet<unknown>(macrosPath(campaignId)));
    // After the first successful sync the server is simply the truth: a macro
    // it does not have was deleted, not discovered (see `hasSynced`).
    const migrating = !hasSynced(campaignId, userId);
    const merged = migrating ? mergeMacros(remote, local) : remote;
    writeLocalMacros(campaignId, userId, merged);
    // One-time adoption of whatever this device had before the route existed.
    if (migrating && needsPush(remote, local)) {
      try {
        await api<unknown>(macrosPath(campaignId), { method: 'PUT', body: { macros: merged } });
      } catch {
        // The mirror still holds them; the next fetch retries the migration.
        return { macros: merged, hasRemote: true, degraded: true };
      }
    }
    markSynced(campaignId, userId);
    return { macros: merged, hasRemote: true };
  } catch (err) {
    // Route absent, or offline — either way the mirror is what it is for.
    return { macros: local, hasRemote: false, ...(isMissingRoute(err) ? {} : { degraded: true }) };
  }
}

/** Persist the whole list. Local first, so a failed PUT never loses the edit. */
export async function saveMacros(
  campaignId: string,
  userId: string | undefined,
  macros: readonly DiceMacro[],
): Promise<MacroSnapshot> {
  const capped = macros.slice(0, MACRO_LIMIT);
  writeLocalMacros(campaignId, userId, capped);
  try {
    const saved = normalizeMacros(
      await api<unknown>(macrosPath(campaignId), { method: 'PUT', body: { macros: capped } }),
    );
    const next = saved.length > 0 ? saved : capped;
    writeLocalMacros(campaignId, userId, next);
    // A successful write is a sync: from here on the server is the truth, so a
    // deletion made here is not undone by the next read.
    markSynced(campaignId, userId);
    return { macros: next, hasRemote: true };
  } catch {
    return { macros: capped, hasRemote: false };
  }
}
