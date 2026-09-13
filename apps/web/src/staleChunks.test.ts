/**
 * A stale tab reloads onto the new build once, and only once: a chunk that
 * still fails straight after a reload is surfaced, not looped on.
 */
import { describe, expect, it, vi } from 'vitest';
import { reloadOnStaleChunk } from './staleChunks.js';

function fakeWindow() {
  const target = new EventTarget();
  const store = new Map<string, string>();
  const reload = vi.fn();
  const win = {
    addEventListener: target.addEventListener.bind(target),
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: { reload },
  };
  const fire = () => {
    const e = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  return { win: win as never, reload, fire };
}

describe('reloadOnStaleChunk', () => {
  it('reloads when a lazy chunk fails to load, and swallows that error', () => {
    const { win, reload, fire } = fakeWindow();
    reloadOnStaleChunk(win, () => 1_000_000);
    const e = fire();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('does not reload again within the window — the error surfaces instead', () => {
    const { win, reload, fire } = fakeWindow();
    let t = 1_000_000;
    reloadOnStaleChunk(win, () => t);
    fire();
    t += 5_000;
    const second = fire();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    t += 60_000;
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
