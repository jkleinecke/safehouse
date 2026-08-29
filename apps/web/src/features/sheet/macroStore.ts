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
 * ## The server surface this speaks (now live)
 *
 *   GET  /api/campaigns/:id/macros            this user's rack
 *   PUT  /api/campaigns/:id/macros  { macros } replace the rack wholesale
 *   POST /api/campaigns/:id/macros  { …one }   add one, idempotent on label
 *
 * All three are scoped to the *authenticated user* by the device token — there
 * is no user id in the path, which is why no request can address someone
 * else's rack even by accident.
 *
 * **The migration uses POST, not PUT, and that is deliberate.** PUT replaces
 * the rack; a device that had gone stale would use it to delete macros the
 * player made elsewhere. POST is additive and idempotent on
 * `(user, campaign, label)`, so pushing the same leftover rack from a second
 * handset — or retrying a push that failed halfway — converges instead of
 * racing. The server's unique index is what makes that a guarantee rather than
 * a hope, so this module never has to read-then-write.
 *
 * PUT stays for deliberate edits from the rack UI, where "the list is now
 * exactly this" is precisely what the player meant, deletions included.
 *
 * The table roller (`features/table/DiceRoller.tsx`) reads this store too, so
 * the sheet's rack and the table's are the same rack. What is left of
 * `features/table/macros.ts` is the reader for its old device-local key, which
 * `takeLegacyMacros` hands over here once on upgrade.
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

/** The server's own bounds (`plugins/macros.ts`), so nothing normalised here can 400. */
const MAX_NAME = 120;
const MAX_POOL = 100;

const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, Math.floor(n)));

/**
 * Accept `[…]`, `{ macros: […] }`, or junk; always return a clean, capped list.
 *
 * The clamping is not cosmetic. Everything that reaches the server passes
 * through here, and a macro outside the column's bounds would be a permanent
 * 400 in the middle of a migration — one unpushable macro wedging every good
 * one behind it. Bounding the value is better than discarding the macro:
 * "Composure 100" is at least the button the player made.
 */
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
    const name = item.name.trim().slice(0, MAX_NAME);
    // A nameless macro is an unpressable button and an unkeyable row.
    if (name === '') continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      name,
      pool: clamp(item.pool, MAX_POOL),
      ...(item.limitKind ? { limitKind: item.limitKind } : {}),
      ...(typeof item.limitValue === 'number'
        ? { limitValue: clamp(item.limitValue, MAX_POOL) }
        : {}),
      ...(item.edge ? { edge: item.edge } : {}),
    });
    if (out.length >= MACRO_LIMIT) break;
  }
  return out;
}

/**
 * A macro's identity as the SERVER sees it: the label, trimmed and folded.
 *
 * Ids cannot dedupe a migration — each device minted its own before the route
 * existed, so the same "Composure 8" arrives with two different ids. The server
 * keys `user_macros` on `(user, campaign, label)` for exactly that reason, and
 * matching that here is what stops the rack showing one button twice while the
 * first push is still in flight.
 */
function labelKey(macro: DiceMacro): string {
  return macro.name.trim().toLowerCase();
}

/**
 * Server list wins on id OR label collision (it is the shared truth);
 * device-only macros are appended so a phone's unsynced work is adopted rather
 * than discarded. Order is server-first, which keeps the rack stable across
 * devices.
 */
export function mergeMacros(remote: readonly DiceMacro[], local: readonly DiceMacro[]): DiceMacro[] {
  return [...remote, ...localOnly(remote, local)].slice(0, MACRO_LIMIT);
}

/**
 * The macros this device is holding that the account has never seen — by id
 * and by label, because a second handset carries the same names under
 * different ids.
 */
export function localOnly(
  remote: readonly DiceMacro[],
  local: readonly DiceMacro[],
): DiceMacro[] {
  const ids = new Set(remote.map((m) => m.id));
  const labels = new Set(remote.map(labelKey));
  const out: DiceMacro[] = [];
  for (const macro of local) {
    if (ids.has(macro.id) || labels.has(labelKey(macro))) continue;
    ids.add(macro.id);
    labels.add(labelKey(macro));
    out.push(macro);
  }
  return out;
}

/** Anything present locally but not on the server — the reason to push after a read. */
export function needsPush(remote: readonly DiceMacro[], local: readonly DiceMacro[]): boolean {
  return localOnly(remote, local).length > 0;
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

/** The wire body for one macro. `name` is what the server stores as `label`. */
function macroBody(macro: DiceMacro): Record<string, unknown> {
  return {
    name: macro.name,
    pool: macro.pool,
    ...(macro.limitKind ? { limitKind: macro.limitKind } : {}),
    ...(typeof macro.limitValue === 'number' ? { limitValue: macro.limitValue } : {}),
    ...(macro.edge ? { edge: macro.edge } : {}),
  };
}

/**
 * The one-time migration off `localStorage`: POST each leftover macro.
 *
 * Sequential on purpose. The server hands each new row a `sortOrder` from the
 * current count, so a parallel burst would land the rack in an arbitrary order
 * — and this runs once per device, on a list of at most two dozen. Correct beats
 * fast here.
 *
 * A **4xx is skipped, a 5xx aborts.** They are different problems: a macro the
 * server will never accept (a pool of 900 typed into an old build, a name past
 * the column's length, a full rack) must not wedge the migration in a retry
 * loop that also blocks every well-formed macro behind it — while a server
 * that is briefly down deserves the retry. Skipping loses nothing the mirror
 * was not already holding.
 */
export async function pushLocalMacros(
  campaignId: string,
  macros: readonly DiceMacro[],
): Promise<void> {
  for (const macro of macros) {
    try {
      await api<unknown>(macrosPath(campaignId), { method: 'POST', body: macroBody(macro) });
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) continue;
      throw err;
    }
  }
}

export async function fetchMacros(
  campaignId: string,
  userId: string | undefined,
): Promise<MacroSnapshot> {
  const local = readLocalMacros(campaignId, userId);
  let remote: DiceMacro[];
  try {
    remote = normalizeMacros(await apiGet<unknown>(macrosPath(campaignId)));
  } catch (err) {
    // Route absent, or offline — either way the mirror is what it is for.
    return { macros: local, hasRemote: false, ...(isMissingRoute(err) ? {} : { degraded: true }) };
  }

  // After the first successful sync the server is simply the truth: a macro it
  // does not have was deleted on the player's other phone, not discovered here
  // (see `hasSynced`). Adopting the mirror's extras is right exactly once.
  const strays = hasSynced(campaignId, userId)
    ? []
    : localOnly(remote, local).slice(0, Math.max(0, MACRO_LIMIT - remote.length));

  if (strays.length === 0) {
    writeLocalMacros(campaignId, userId, remote);
    markSynced(campaignId, userId);
    return { macros: remote, hasRemote: true };
  }

  try {
    await pushLocalMacros(campaignId, strays);
    // Re-read rather than guess, and trust the answer whatever it says: the
    // server minted the real ids and settled the order, and mirroring anything
    // else is what made a second device show its own macros twice. A macro the
    // re-read does not contain is one the server declined — keeping a local
    // copy of it would only resurrect it for one load and lose it on the next.
    const macros = normalizeMacros(await apiGet<unknown>(macrosPath(campaignId)));
    writeLocalMacros(campaignId, userId, macros);
    markSynced(campaignId, userId);
    return { macros, hasRemote: true };
  } catch {
    // Nothing is lost: POST is idempotent on the label, so the next load simply
    // pushes whatever did not make it. The mirror carries the rack until then.
    const macros = mergeMacros(remote, strays);
    writeLocalMacros(campaignId, userId, macros);
    return { macros, hasRemote: true, degraded: true };
  }
}

/**
 * Persist the whole list (PUT — "the rack is now exactly this", deletions
 * included). Local first, so a failed write never loses the edit.
 */
export async function saveMacros(
  campaignId: string,
  userId: string | undefined,
  macros: readonly DiceMacro[],
): Promise<MacroSnapshot> {
  // Normalised, not merely sliced: the editor's number field is free text, and
  // a pool the column cannot hold would fail the PUT on every retry.
  const capped = normalizeMacros(macros);
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
  } catch (err) {
    // "No route" and "the write failed" both end at the mirror, but they are
    // not the same sentence to show a player: one is a server that never had
    // the feature, the other is an edit that has not landed yet.
    return isMissingRoute(err)
      ? { macros: capped, hasRemote: false }
      : { macros: capped, hasRemote: true, degraded: true };
  }
}
