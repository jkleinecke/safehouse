/**
 * The ruler → dice handoff (FR9.9).
 *
 * Before this landed, `MeasurePanel`'s "apply" published a range modifier that
 * nothing on the sheet ever read: the number the Grid had just priced died in
 * localStorage and the player retyped it as an anonymous situational bump.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_ROLL_MOD_EVENT,
  PENDING_ROLL_MOD_KEY,
  PENDING_ROLL_MOD_TTL_MS,
  publishPendingRollMod,
  readPendingRollMod,
  subscribePendingRollMod,
  type PendingRollMod,
} from './rollHandoff.js';

const MOD: PendingRollMod = {
  value: -1,
  label: 'medium range (9.5 m, heavy_pistol)',
  sourceKind: 'range',
  ts: 1_000_000,
};

/** A localStorage stand-in; the test env has no DOM storage of its own. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  vi.stubGlobal('localStorage', store);
  return map;
}

/** A minimal window with just the listener plumbing this module uses. */
function installWindow(): { fire: (type: string, event: unknown) => void } {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (e: { type: string }) => {
      for (const fn of listeners.get(e.type) ?? []) fn(e);
      return true;
    },
  });
  vi.stubGlobal(
    'CustomEvent',
    class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail ?? null;
      }
    },
  );
  return {
    fire: (type, event) => {
      for (const fn of listeners.get(type) ?? []) fn(event as never);
    },
  };
}

describe('pending roll mod handoff', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installStorage();
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('survives the navigation from the Grid to the sheet', () => {
    publishPendingRollMod(MOD);
    expect(storage.get(PENDING_ROLL_MOD_KEY)).toBeDefined();
    // A fresh read is what a sheet mounting later actually does.
    expect(readPendingRollMod(MOD.ts + 1_000)).toEqual(MOD);
  });

  it('clearing the offer clears the stored key', () => {
    publishPendingRollMod(MOD);
    publishPendingRollMod(null);
    expect(readPendingRollMod(MOD.ts)).toBeNull();
  });

  it('expires a stale measurement instead of quietly subtracting a die', () => {
    publishPendingRollMod(MOD);
    expect(readPendingRollMod(MOD.ts + PENDING_ROLL_MOD_TTL_MS - 1)).toEqual(MOD);
    expect(readPendingRollMod(MOD.ts + PENDING_ROLL_MOD_TTL_MS + 1)).toBeNull();
  });

  it('refuses malformed stored values rather than throwing at the dialog', () => {
    storage.set(PENDING_ROLL_MOD_KEY, 'not json');
    expect(readPendingRollMod()).toBeNull();
    storage.set(PENDING_ROLL_MOD_KEY, JSON.stringify({ value: 'lots', sourceKind: 'range' }));
    expect(readPendingRollMod()).toBeNull();
  });

  it('notifies subscribers in this tab, and unsubscribes cleanly', () => {
    const seen: (PendingRollMod | null)[] = [];
    const stop = subscribePendingRollMod((m) => seen.push(m));
    publishPendingRollMod(MOD);
    publishPendingRollMod(null);
    stop();
    publishPendingRollMod(MOD);
    expect(seen).toEqual([MOD, null]);
  });

  it('follows a change made in another tab via the storage event', () => {
    const win = installWindow();
    const seen: (PendingRollMod | null)[] = [];
    subscribePendingRollMod((m) => seen.push(m));
    // The cross-tab path re-reads storage against the wall clock, so this
    // measurement has to be a fresh one rather than the fixed fixture.
    const fresh: PendingRollMod = { ...MOD, ts: Date.now() };
    storage.set(PENDING_ROLL_MOD_KEY, JSON.stringify(fresh));
    win.fire('storage', { type: 'storage', key: PENDING_ROLL_MOD_KEY });
    expect(seen.at(-1)).toEqual(fresh);
    // An unrelated key is not our business.
    seen.length = 0;
    win.fire('storage', { type: 'storage', key: 'safehouse.session' });
    expect(seen).toEqual([]);
  });

  it('publishing survives blocked storage — the event still lands', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    const seen: (PendingRollMod | null)[] = [];
    subscribePendingRollMod((m) => seen.push(m));
    expect(() => publishPendingRollMod(MOD)).not.toThrow();
    expect(seen).toEqual([MOD]);
    expect(readPendingRollMod()).toBeNull();
  });

  it('names the contract both halves agreed on', () => {
    expect(PENDING_ROLL_MOD_KEY).toBe('safehouse.pendingRollMod');
    expect(PENDING_ROLL_MOD_EVENT).toBe('safehouse:pending-roll-mod');
  });
});
