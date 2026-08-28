import { describe, expect, it } from 'vitest';
import { DRAG_INTERVAL_MS, GridCommands, throttle, type CommandSink } from './commands.js';

/** Deterministic clock + timer queue so the ~12 Hz relay is testable. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      now: () => now,
      schedule: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      cancel: (handle: unknown) => void timers.delete(handle as number),
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
        }
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

function sink(): CommandSink & { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    send(cmd) {
      sent.push(cmd as unknown as Record<string, unknown>);
      return true;
    },
  };
}

describe('throttle', () => {
  it('sends the first sample immediately', () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const t = throttle<number>(100, (v) => seen.push(v), clock.deps);
    t.push(1);
    expect(seen).toEqual([1]);
  });

  it('coalesces a burst into one trailing send per interval', () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const t = throttle<number>(100, (v) => seen.push(v), clock.deps);
    t.push(1);
    t.push(2);
    t.push(3);
    expect(seen).toEqual([1]);
    clock.advance(100);
    expect(seen).toEqual([1, 3]);
  });

  it('never drops the final sample of a gesture', () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const t = throttle<number>(100, (v) => seen.push(v), clock.deps);
    t.push(1);
    t.push(9);
    t.flush();
    expect(seen).toEqual([1, 9]);
  });

  it('drops the pending sample on cancel', () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const t = throttle<number>(100, (v) => seen.push(v), clock.deps);
    t.push(1);
    t.push(2);
    t.cancel();
    clock.advance(500);
    expect(seen).toEqual([1]);
  });
});

describe('GridCommands', () => {
  it('relays interim drags at roughly 12 Hz', () => {
    const clock = fakeClock();
    const s = sink();
    const c = new GridCommands(s, 'sc1', clock.deps);
    for (let i = 0; i < 20; i += 1) {
      c.drag('t1', i, 0);
      clock.advance(8); // ~120 Hz pointer stream
    }
    const drags = s.sent.filter((m) => m['cmd'] === 'token.drag');
    // 160 ms of pointer moves must not produce 20 relays.
    expect(drags.length).toBeGreaterThan(0);
    expect(drags.length).toBeLessThanOrEqual(Math.ceil(160 / DRAG_INTERVAL_MS) + 1);
    expect(drags[0]).toMatchObject({ cmd: 'token.drag', tokenId: 't1' });
  });

  it('sends the authoritative move on drop and stops the interim stream', () => {
    const clock = fakeClock();
    const s = sink();
    const c = new GridCommands(s, 'sc1', clock.deps);
    c.drag('t1', 1, 1);
    c.drag('t1', 2, 2); // queued, not yet sent
    c.move('t1', 3, 3);
    clock.advance(500);
    expect(s.sent.map((m) => m['cmd'])).toEqual(['token.drag', 'token.move']);
    expect(s.sent.at(-1)).toEqual({ cmd: 'token.move', tokenId: 't1', x: 3, y: 3 });
  });

  it('tags pings, pointer trails and focus with the scene', () => {
    const clock = fakeClock();
    const s = sink();
    const c = new GridCommands(s, 'sc7', clock.deps);
    c.ping(4, 5);
    c.pointer(6, 7);
    c.focus(8, 9);
    expect(s.sent).toEqual([
      { cmd: 'ping', sceneId: 'sc7', x: 4, y: 5 },
      { cmd: 'pointer', sceneId: 'sc7', x: 6, y: 7 },
      { cmd: 'scene.focus', sceneId: 'sc7', x: 8, y: 9 },
    ]);
  });

  it('emits the three fog operations', () => {
    const s = sink();
    const c = new GridCommands(s, 'sc1', fakeClock().deps);
    c.fogReveal('sc1', 'r1', true);
    c.fogHide('sc1', 'r1');
    c.fogDefine('sc1', { id: 'r2', name: 'the lab', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
    expect(s.sent.map((m) => [m['cmd'], m['op']])).toEqual([
      ['fog.reveal', 'reveal'],
      ['fog.reveal', 'hide'],
      ['fog.reveal', 'define'],
    ]);
    expect(s.sent[0]).toMatchObject({ regionId: 'r1', announce: true });
  });

  it('is a no-op while the socket is missing', () => {
    const c = new GridCommands(null, null, fakeClock().deps);
    expect(() => {
      c.move('t1', 1, 1);
      c.ping(0, 0);
    }).not.toThrow();
  });

  it('rebinds to a new socket and scene without losing its relays', () => {
    const clock = fakeClock();
    const a = sink();
    const b = sink();
    const c = new GridCommands(a, 'sc1', clock.deps);
    c.ping(1, 1);
    c.bind(b, 'sc2');
    c.ping(2, 2);
    expect(a.sent).toHaveLength(1);
    expect(b.sent[0]).toMatchObject({ sceneId: 'sc2' });
  });
});
