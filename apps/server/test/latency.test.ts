/**
 * NFR harness — **roll-to-visible latency** (DESIGN.md §15, "Latency — rolls":
 * a roll tap must be visible on every connected client at p95 < 500 ms over
 * WAN, < 250 ms on the LAN).
 *
 * That row had no harness. The rolls suites prove a roll is *correct* and that
 * it *reaches* the right sockets; none of them ever asked how long it took, so
 * a change that added a query per roll — or an emit that moved outside the
 * transaction and back — could double the number the table actually feels and
 * every test would stay green. This file is the first thing in the repo that
 * measures it.
 *
 * ## Method
 *
 * One app, one campaign, SIX live sockets in the room (GM + four players + the
 * table display), which is the shape of the real table (§15 "Capacity: 10
 * concurrent users"). A player socket then issues N=200 `roll.request` frames,
 * strictly one at a time, each tagged with `meta.probe` so it can be followed
 * end to end. Four timestamps per roll, all from `performance.now()` in ONE
 * process (so there is no clock skew to correct for):
 *
 *   t_send       the test writes the frame to the socket
 *   t_received   the hub dispatches it to the `roll.request` handler
 *   t_broadcast  `roll.created` is handed to the hub's socket writer
 *   t_visible    the LAST of the six sockets has the frame in hand
 *
 * Two figures come out of that:
 *
 *   server   = t_broadcast − t_received   the span this repo owns: validation,
 *                                         pool recomputation, CSPRNG, the
 *                                         `rolls` row and the `ws_events` row
 *                                         in one transaction, then fan-out.
 *   visible  = t_visible  − t_send        the whole loop as a client sees it,
 *                                         WS framing included — a strict
 *                                         superset of `server`, and the thing
 *                                         §15's row is actually about.
 *
 * `visible` is what the assertion is made against, because asserting on the
 * inner span alone would let a slow socket write hide inside a fast number.
 *
 * ## What this deliberately does NOT measure (read before quoting the output)
 *
 *  - **The network.** Both sockets live on 127.0.0.1 in the same process as the
 *    server. Add the venue's Wi-Fi RTT (typically 2–15 ms on a good AP, tens of
 *    ms on a bad one, and the WAN figure is a different row of §15 entirely) to
 *    everything printed here. The measurement is a FLOOR on real latency, not
 *    an estimate of it.
 *  - **The browser.** Nothing here parses the frame, reconciles a React store or
 *    paints a die. "Visible" means "the bytes have arrived", not "a human saw
 *    it". The Grid-side frame budget is the other NFR harness
 *    (`apps/web/e2e/perf.spec.ts`).
 *  - **Postgres.** This runs on embedded PGlite, per BUILD_CONVENTIONS. A
 *    node-postgres deployment pays a socket hop per statement instead of a WASM
 *    call; the shape of the work is the same, the constant is not.
 *  - **A busy table.** The rolls are serialized and nothing else is writing.
 *    Concurrent fog reveals and token drags share the same single PGlite
 *    connection and would queue behind each roll's transaction.
 *
 * Instrumentation is deliberately *outside* `src/`: the two stamps are taken by
 * wrapping the registered command handler and the hub's `broadcast` on the live
 * instance. No production file carries a timing hook that only a test reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hub, HubCommandHandler } from '../src/hub.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  wsUrl,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

/** Measured rolls. §15 quotes a p95, so the sample has to be able to show one. */
const N = 200;
/** Discarded: first-call JIT, PGlite's first transaction, socket warm-up. */
const WARMUP = 20;
/** DESIGN §15 — the LAN half of the roll-latency row. */
const LAN_P95_MS = 250;
/** DESIGN §15 — the WAN half, for the report's second column. */
const WAN_P95_MS = 500;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Nearest-rank percentile (0..1) over an ASCENDING copy of `values`. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

function stats(values: readonly number[]): Stats {
  const total = values.reduce((sum, v) => sum + v, 0);
  return {
    n: values.length,
    min: percentile(values, 0),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: percentile(values, 1),
    mean: values.length === 0 ? Number.NaN : total / values.length,
  };
}

const ms = (v: number) => `${v.toFixed(1)} ms`;

function line(label: string, s: Stats): string {
  return (
    `  ${label.padEnd(22)} n=${String(s.n).padStart(3)}  ` +
    `min ${ms(s.min).padStart(9)}  p50 ${ms(s.p50).padStart(9)}  ` +
    `p95 ${ms(s.p95).padStart(9)}  p99 ${ms(s.p99).padStart(9)}  max ${ms(s.max).padStart(9)}`
  );
}

// ---------------------------------------------------------------------------
// A socket that records WHEN each frame landed
// ---------------------------------------------------------------------------

/**
 * `core-helpers`' `WsTestClient` resolves waiters as microtasks, which is fine
 * for ordering assertions and wrong for a stopwatch. This one stamps inside the
 * `message` listener itself, so `arrivalOf` is the moment the frame was handed
 * to userland and not the moment a promise chain got around to it.
 */
class TimedSocket {
  /** probe id → performance.now() when `roll.created` for it arrived. */
  readonly arrivals = new Map<number, number>();
  private readonly ws: WebSocket;
  private waiters: Array<{ probe: number; resolve: () => void }> = [];

  private constructor(
    readonly label: string,
    url: string,
  ) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (ev) => {
      const at = performance.now();
      const frame = JSON.parse(String(ev.data)) as {
        type?: string;
        payload?: { request?: { meta?: Record<string, unknown> } };
      };
      if (frame.type !== 'roll.created') return;
      const probe = frame.payload?.request?.meta?.['probe'];
      if (typeof probe !== 'number') return;
      this.arrivals.set(probe, at);
      this.waiters = this.waiters.filter((w) => {
        if (w.probe !== probe) return true;
        w.resolve();
        return false;
      });
    });
  }

  static connect(label: string, url: string): Promise<TimedSocket> {
    return new Promise((resolve, reject) => {
      const sock = new TimedSocket(label, url);
      const timer = setTimeout(() => reject(new Error(`ws connect timeout: ${label}`)), 10_000);
      sock.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(sock);
      });
      sock.ws.addEventListener('close', () => {
        clearTimeout(timer);
        reject(new Error(`ws closed before open: ${label}`));
      });
      sock.ws.addEventListener('error', () => {
        /* the close handler reports it */
      });
    });
  }

  waitFor(probe: number, timeoutMs = 15_000): Promise<void> {
    if (this.arrivals.has(probe)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.label}: never saw roll probe ${probe}`)),
        timeoutMs,
      );
      this.waiters.push({
        probe,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  send(obj: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.ws.close();
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Sample {
  probe: number;
  /** t_broadcast − t_received: the server's own span. */
  server: number;
  /** t_visible − t_send: the whole loopback round trip. */
  visible: number;
  /** How far the last socket trailed the first — fan-out spread. */
  spread: number;
}

let t: TestApp;
let boot: BootstrapResult;
let sockets: TimedSocket[] = [];
let samples: Sample[] = [];
let report = '';

/** probe → server-side stamps, filled by the two instrumentation wrappers. */
const received = new Map<number, number>();
const broadcast = new Map<number, number>();

function probeOf(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const meta = (value as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return null;
  const probe = (meta as Record<string, unknown>)['probe'];
  return typeof probe === 'number' ? probe : null;
}

beforeAll(async () => {
  t = await makeTestApp('latency');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Latency Bench');

  // -- instrumentation, on the live instance only ---------------------------
  //
  // `roll.request` received: the hub looks its handler up in this map on every
  // frame, so replacing the entry with a wrapper around the real one puts the
  // stamp exactly at dispatch — after JSON.parse and the auth check the socket
  // already did, before any of the roll's own work.
  const commands = (t.app.hub as unknown as { commands: Map<string, HubCommandHandler> }).commands;
  const realHandler = commands.get('roll.request');
  if (!realHandler) throw new Error('no roll.request handler registered — the plugin did not load');
  commands.set('roll.request', async (msg, ctx) => {
    const probe = probeOf(msg);
    if (probe !== null) received.set(probe, performance.now());
    await realHandler(msg, ctx);
  });

  // `roll.created` broadcast: `Hub.broadcast` is the single last hop before the
  // socket writes, for both `emit` and the post-commit drain of `atomic`. The
  // stamp is taken BEFORE the writes so it reads "handed to the wire".
  const hub = t.app.hub as Hub & { broadcast: Hub['broadcast'] };
  const realBroadcast = hub.broadcast.bind(hub);
  hub.broadcast = (campaignId, event) => {
    if (event.type === 'roll.created') {
      const probe = probeOf((event.payload as { request?: unknown } | undefined)?.request);
      if (probe !== null) broadcast.set(probe, performance.now());
    }
    realBroadcast(campaignId, event);
  };

  // -- the table ------------------------------------------------------------
  const players: JoinResult[] = [];
  for (const name of ['Kestrel', 'Doc', 'Switch', 'Ratchet']) {
    players.push(await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', name));
  }
  const display = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');

  sockets = [
    await TimedSocket.connect('gm', wsUrl(t.app, boot.campaignId, boot.gmToken)),
    ...(await Promise.all(
      players.map((p, i) =>
        TimedSocket.connect(`player${i + 1}`, wsUrl(t.app, boot.campaignId, p.token)),
      ),
    )),
    await TimedSocket.connect('display', wsUrl(t.app, boot.campaignId, display.token)),
  ];
  expect(t.app.hub.roomSize(boot.campaignId)).toBe(sockets.length);

  // -- the run --------------------------------------------------------------
  const roller = sockets[1];
  if (!roller) throw new Error('no player socket to roll from');

  const collected: Sample[] = [];
  for (let i = 0; i < WARMUP + N; i += 1) {
    const probe = i;
    const sent = performance.now();
    roller.send({
      cmd: 'roll.request',
      pool: 12,
      actor: {},
      visibility: 'public',
      meta: { probe, poolRef: 'freeform', tag: 'latency-bench' },
    });
    // Strictly serial: the next frame is not written until every socket in the
    // room has this one. A pipelined run would measure throughput, not latency.
    await Promise.all(sockets.map((s) => s.waitFor(probe)));

    if (i < WARMUP) continue;
    const arrivals = sockets.map((s) => s.arrivals.get(probe) ?? Number.NaN);
    const last = Math.max(...arrivals);
    const first = Math.min(...arrivals);
    const rx = received.get(probe);
    const bx = broadcast.get(probe);
    if (rx === undefined || bx === undefined) {
      throw new Error(`probe ${probe}: server stamps missing — instrumentation did not fire`);
    }
    collected.push({ probe, server: bx - rx, visible: last - sent, spread: last - first });
  }
  samples = collected;

  const server = stats(collected.map((s) => s.server));
  const visible = stats(collected.map((s) => s.visible));
  const spread = stats(collected.map((s) => s.spread));
  report = [
    '',
    `roll-to-visible latency — ${N} rolls, ${sockets.length} sockets attached, PGlite, loopback`,
    `  (excludes network, browser render, and Postgres — see the file's header)`,
    line('server received→bcast', server),
    line('visible send→last rx', visible),
    line('fan-out spread', spread),
    `  budget: p95 ${ms(visible.p95)} against §15's ${LAN_P95_MS} ms LAN / ${WAN_P95_MS} ms WAN` +
      ` — ${(LAN_P95_MS / visible.p95).toFixed(1)}× headroom on the LAN figure`,
    '',
  ].join('\n');
  // Printed unconditionally: the CI `perf` job exists to surface this number
  // even on a run where nothing failed.
  console.log(report);
}, 180_000);

afterAll(async () => {
  for (const s of sockets) s.close();
  await t?.close();
});

describe('roll-to-visible latency (DESIGN §15)', () => {
  it('measured a full sample on every socket — the harness is not vacuous', () => {
    expect(samples.length).toBe(N);
    for (const sock of sockets) {
      // Every socket saw every roll, warm-up included: a socket that silently
      // stopped receiving would otherwise make the numbers look better.
      expect(sock.arrivals.size, `${sock.label} missed rolls`).toBe(WARMUP + N);
    }
    // Non-degenerate stamps: a broken wrapper that recorded the same instant
    // twice would produce a perfect, meaningless zero.
    expect(samples.every((s) => s.server > 0)).toBe(true);
    expect(samples.every((s) => s.visible >= s.server)).toBe(true);
  });

  it('holds the LAN p95 budget of 250 ms', () => {
    const visible = stats(samples.map((s) => s.visible));
    expect(
      visible.p95,
      `p95 roll-to-visible was ${ms(visible.p95)} (p50 ${ms(visible.p50)}, p99 ${ms(visible.p99)}, ` +
        `max ${ms(visible.max)}) against §15's ${LAN_P95_MS} ms LAN budget. ` +
        `Remember this excludes the network — the venue's Wi-Fi RTT adds to it.${report}`,
    ).toBeLessThan(LAN_P95_MS);
    // The WAN row is the looser one; it must not be the binding constraint.
    expect(visible.p95).toBeLessThan(WAN_P95_MS);
  });

  it('the server keeps a wide margin inside the client-visible figure', () => {
    const server = stats(samples.map((s) => s.server));
    const visible = stats(samples.map((s) => s.visible));
    // The span this repo owns has to be the small part of the loop; if the
    // server's own p95 ever approaches the whole budget there is no room left
    // for the network the budget is really about.
    expect(
      server.p95,
      `server-side p95 was ${ms(server.p95)} of a ${ms(visible.p95)} round trip.${report}`,
    ).toBeLessThan(LAN_P95_MS / 2);
  });

  it('fans out to every socket within a frame of each other', () => {
    const spread = stats(samples.map((s) => s.spread));
    // One `JSON.stringify`, six `socket.send`s: the last client must not be
    // meaningfully later than the first, or "visible on all clients" stops
    // meaning what §15 says it means.
    expect(spread.p95, `fan-out p95 spread ${ms(spread.p95)}.${report}`).toBeLessThan(50);
  });
});
