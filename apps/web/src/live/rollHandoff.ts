/**
 * The ruler → dice handoff (FR9.9).
 *
 * Measuring on the Grid produces a range band and its modifier ("medium range
 * (9.5 m, heavy_pistol) −1"). That number is worth nothing until it reaches the
 * roll the player is about to make — and the two live in different features, on
 * different routes, quite possibly on different devices in the same hand.
 *
 * So the handoff is deliberately dumb and dependency-free: one localStorage key
 * plus one window event, owned here rather than by either feature. The Grid
 * publishes; the sheet's roll dialog subscribes. Neither imports the other's
 * store, which is the whole point — a phone that never opens the Grid pays
 * nothing for this, and the chip survives the navigation from `/c/:id/grid` to
 * `/c/:id/sheet/:characterId` because localStorage does.
 *
 * The mod is an OFFER, not a fact: it lands as an armed chip the player can tap
 * off, and the server re-prices the pool from its own state either way (§10.1).
 */

/** A situational modifier handed from the ruler to the next roll (FR9.9). */
export interface PendingRollMod {
  value: number;
  label: string;
  /** Matches `Modifier.source.kind` — the receipt says where the die went. */
  sourceKind: 'range';
  /** When it was measured; a stale measurement is not worth applying. */
  ts: number;
}

export const PENDING_ROLL_MOD_KEY = 'safehouse.pendingRollMod';
export const PENDING_ROLL_MOD_EVENT = 'safehouse:pending-roll-mod';

/**
 * How long a measurement stays on offer. Ranges change the moment anything
 * moves, and a chip from twenty minutes ago is a wrong answer wearing a
 * receipt — better to offer nothing than to quietly subtract a die.
 */
export const PENDING_ROLL_MOD_TTL_MS = 5 * 60_000;

function isMod(value: unknown): value is PendingRollMod {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['value'] === 'number' &&
    typeof v['label'] === 'string' &&
    v['sourceKind'] === 'range' &&
    typeof v['ts'] === 'number'
  );
}

/** Publish (or clear) the offer. Storage being blocked is not an error. */
export function publishPendingRollMod(mod: PendingRollMod | null): void {
  try {
    if (mod) localStorage.setItem(PENDING_ROLL_MOD_KEY, JSON.stringify(mod));
    else localStorage.removeItem(PENDING_ROLL_MOD_KEY);
  } catch {
    // storage blocked — the in-memory store + event still work this session
  }
  try {
    window.dispatchEvent(new CustomEvent(PENDING_ROLL_MOD_EVENT, { detail: mod }));
  } catch {
    // non-DOM test environment
  }
}

/**
 * The current offer, or null. Returns null for anything malformed or older
 * than {@link PENDING_ROLL_MOD_TTL_MS}; `now` is injectable for tests.
 */
export function readPendingRollMod(now: number = Date.now()): PendingRollMod | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_ROLL_MOD_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isMod(parsed)) return null;
  if (now - parsed.ts > PENDING_ROLL_MOD_TTL_MS) return null;
  return parsed;
}

/**
 * Call `handler` whenever the offer changes — in this tab (the CustomEvent)
 * and in another one (the `storage` event, so measuring on a laptop reaches a
 * dialog already open on a phone sharing the browser profile).
 * Returns an unsubscribe.
 */
export function subscribePendingRollMod(
  handler: (mod: PendingRollMod | null) => void,
): () => void {
  const onCustom = (e: Event): void => {
    const detail = (e as CustomEvent<unknown>).detail;
    handler(detail === null || detail === undefined ? null : isMod(detail) ? detail : null);
  };
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== PENDING_ROLL_MOD_KEY) return;
    handler(readPendingRollMod());
  };
  try {
    window.addEventListener(PENDING_ROLL_MOD_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
  } catch {
    return () => {};
  }
  return () => {
    window.removeEventListener(PENDING_ROLL_MOD_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
