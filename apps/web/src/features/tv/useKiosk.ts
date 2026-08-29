/**
 * Kiosk plumbing for the table TV (FR9.19): a wall clock, a screen wake lock,
 * and the "latch" that holds a big moment on screen for a few seconds before
 * the TV falls back to the ribbon.
 *
 * Every timer here is cleared on unmount and every one of them is single —
 * the TV runs unattended for a whole session, so nothing may accumulate.
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveStore } from '../../live/store.js';

/** Wall clock, HH:MM, refreshed on the minute boundary (one timer, ever). */
export function useWallClock(): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      // Re-arm on the next minute boundary rather than drifting on an interval.
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()));
    };
    timer = setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    return () => clearTimeout(timer);
    // Deliberately mount-only: `now` is the seed, re-arming happens inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', cb: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

/**
 * Hold the screen awake for the session, re-acquiring after the browser drops
 * the lock (tab hidden, display sleep). Entirely best-effort: unsupported
 * browsers and denied permissions are silent no-ops.
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined') return;
    const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = () => {
      api
        .request('screen')
        .then((s) => {
          if (cancelled) {
            void s.release().catch(() => undefined);
            return;
          }
          sentinel = s;
        })
        .catch(() => undefined);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}

/**
 * How stale an event may be and still count as news worth animating. Wide
 * enough to survive modest clock skew between the server and the TV, tight
 * enough that a reconnect's replayed backlog never re-animates.
 */
export const LATCH_MAX_AGE_MS = 5 * 60_000;

/** Age in ms of an ISO timestamp; 0 when it can't be parsed (treat as news). */
function ageOf(ts: string): number {
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : Math.max(0, Date.now() - parsed);
}

/**
 * Hold `value` on screen for `ttlMs` after it first appears, then drop back
 * to null. Identity is the `id`, so re-deriving the same object every render
 * does not restart the timer.
 *
 * Backlog is swallowed twice over: the first value seen after mount, and
 * anything older than LATCH_MAX_AGE_MS. A reconnect replays hours of events —
 * the TV must not re-animate them.
 */
export function useLatched<T extends { id: number; ts: string }>(
  value: T | null,
  ttlMs: number,
): T | null {
  const [latched, setLatched] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRef = useRef<number | null>(null);
  const primedRef = useRef(false);

  useEffect(() => {
    if (!value || value.id === seenRef.current) return;
    seenRef.current = value.id;

    if (!primedRef.current) {
      primedRef.current = true;
      return; // backlog, not news
    }
    if (ageOf(value.ts) > LATCH_MAX_AGE_MS) return;

    setLatched(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setLatched(null);
    }, ttlMs);
  }, [value, ttlMs]);

  // A campaign with no history at mount is still "primed" — the next event is news.
  useEffect(() => {
    primedRef.current = true;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  return latched;
}

export interface FocusMark {
  x: number;
  y: number;
  ts: number;
}

/**
 * The GM's "focus here" gesture, which drives the TV camera (FR9.21).
 *
 * Only an explicitly-typed `focus` mark moves the camera: a TV that chased
 * every ping would lurch away from the fight every time a player tapped the
 * map. Subscribing outside React's render means an ephemeral burst costs one
 * state write, not one per frame.
 *
 * The GM's `scene.focus` command relays a ping-family ephemeral stamped
 * `kind: 'focus'`, which `live/store.ts` carries through on `lastPing`. This
 * deliberately does NOT fall back to a cadence guess: a wrong guess pans the
 * table's shared screen off the action, so an unlabelled mark leaves the
 * camera exactly where it is.
 */
export function useFocusMark(sceneId: string | null): FocusMark | null {
  const [mark, setMark] = useState<FocusMark | null>(null);
  const sceneRef = useRef(sceneId);
  sceneRef.current = sceneId;

  useEffect(() => {
    let lastTs = 0;
    return useLiveStore.subscribe((state) => {
      const ping = state.lastPing;
      if (!ping || ping.ts === lastTs) return;
      if ((ping as { kind?: string }).kind !== 'focus') return;
      if (ping.sceneId && sceneRef.current && ping.sceneId !== sceneRef.current) return;
      lastTs = ping.ts;
      setMark({ x: ping.x, y: ping.y, ts: ping.ts });
    });
  }, []);

  return mark;
}
