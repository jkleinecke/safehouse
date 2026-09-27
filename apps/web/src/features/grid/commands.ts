/**
 * Client→server WS commands raised by the Grid ("commands up, events down",
 * DESIGN.md §11). Everything here is fire-and-forget: the server is
 * authoritative and the truth comes back as an event.
 */
import type { FogRegion, FogRevealAs, Point, WsCommandInput } from '@safehouse/contracts';
import type { LiveSocket } from '../../live/socket.js';

/** ~12 Hz interim drag relay (NFR "Latency — Grid"). */
export const DRAG_HZ = 12;
export const DRAG_INTERVAL_MS = Math.round(1000 / DRAG_HZ);
/** Pointer trails are chattier but cheaper; same ballpark. */
export const POINTER_INTERVAL_MS = 80;

/**
 * Leading-edge rate limiter with a trailing flush: the first sample goes out
 * immediately (so a drag starts moving on other screens at once) and the last
 * sample of a burst is never dropped (so the ghost lands where the pointer is).
 * `now`/`schedule` are injectable for tests.
 */
export interface ThrottleDeps {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface Throttled<T> {
  push(value: T): void;
  /** Send any pending trailing value right now (drag drop). */
  flush(): void;
  cancel(): void;
}

export function throttle<T>(
  intervalMs: number,
  send: (value: T) => void,
  deps: ThrottleDeps = {},
): Throttled<T> {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelTimer = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: unknown = null;

  const fire = (value: T): void => {
    last = now();
    send(value);
  };

  const onTimer = (): void => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    fire(value);
  };

  return {
    push(value: T) {
      const elapsed = now() - last;
      if (elapsed >= intervalMs) {
        pending = null;
        if (timer !== null) {
          cancelTimer(timer);
          timer = null;
        }
        fire(value);
        return;
      }
      pending = { value };
      if (timer === null) timer = schedule(onTimer, intervalMs - elapsed);
    },
    flush() {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
      if (!pending) return;
      const { value } = pending;
      pending = null;
      fire(value);
    },
    cancel() {
      pending = null;
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
    },
  };
}

/**
 * The three table-feel commands (FR9.15/FR9.21) are now in the contracts'
 * `WsCommandSchema` union and handled server-side:
 *
 *   `pointer`      → ephemeral `pointer` `{ sceneId, x, y, kind: 'pointer' }`
 *   `scene.focus`  → ephemeral ping-family mark carrying `kind: 'focus'`,
 *                    GM-only; every viewer recentres ONCE and keeps panning
 *   `display.set`  → PERSISTED `display.updated` `{ blank, ribbon }`, GM-only,
 *                    public visibility, full state (not a patch) so the newest
 *                    event is the whole answer for a TV that just rebooted
 *
 * Nothing local remains: `WsCommandInput` covers all of them.
 */
export type GridCommand = WsCommandInput;

export interface CommandSink {
  send(cmd: WsCommandInput): boolean;
}

function post(socket: CommandSink | null, cmd: GridCommand): boolean {
  if (!socket) return false;
  return socket.send(cmd);
}

export class GridCommands {
  private readonly dragRelay: Throttled<{ tokenId: string; x: number; y: number }>;
  private readonly pointerRelay: Throttled<Point>;

  constructor(
    private socket: CommandSink | null,
    private sceneId: string | null,
    deps: ThrottleDeps = {},
  ) {
    this.dragRelay = throttle(
      DRAG_INTERVAL_MS,
      (v) => void post(this.socket, { cmd: 'token.drag', tokenId: v.tokenId, x: v.x, y: v.y }),
      deps,
    );
    this.pointerRelay = throttle(
      POINTER_INTERVAL_MS,
      (p) => void post(this.socket, { cmd: 'pointer', sceneId: this.sceneId ?? undefined, ...p }),
      deps,
    );
  }

  /** Rebind without recreating the relays (route/scene changes mid-session). */
  bind(socket: CommandSink | null, sceneId: string | null): void {
    this.socket = socket;
    this.sceneId = sceneId;
  }

  /** Interim drag position, throttled to ~12 Hz (ephemeral `token.dragging`). */
  drag(tokenId: string, x: number, y: number): void {
    this.dragRelay.push({ tokenId, x, y });
  }

  /** Final drop — flush the interim stream first so ordering is sane (FR9.5). */
  move(tokenId: string, x: number, y: number, rotation?: number): void {
    this.dragRelay.cancel();
    post(this.socket, { cmd: 'token.move', tokenId, x, y, ...(rotation === undefined ? {} : { rotation }) });
  }

  ping(x: number, y: number): void {
    post(this.socket, { cmd: 'ping', sceneId: this.sceneId ?? undefined, x, y });
  }

  pointer(x: number, y: number): void {
    this.pointerRelay.push({ x, y });
  }

  focus(x: number, y: number): void {
    post(this.socket, { cmd: 'scene.focus', sceneId: this.sceneId ?? undefined, x, y });
  }

  /**
   * GM steering of the table display (FR9.21): blank the table, or hide the
   * initiative ribbon during pure roleplay. Returns false when the socket is
   * down so the panel can say so instead of pretending it landed.
   */
  display(patch: { blank?: boolean; ribbon?: boolean }): boolean {
    return post(this.socket, { cmd: 'display.set', ...patch });
  }

  /**
   * Reveal a region to the table, in one of the two fashions
   * (`FogRevealAsSchema`): `live` (the default) opens it, and everyone in it
   * with it; `explored` shows it dimmed, as remembered, with nobody in it.
   * A region revealed one way and then the other moves across.
   */
  fogReveal(sceneId: string, regionId: string, announce = false, as: FogRevealAs = 'live'): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'reveal', regionId, announce, as });
  }

  /** Fog a region again, whichever fashion it was revealed in. */
  fogHide(sceneId: string, regionId: string): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'hide', regionId });
  }

  fogDefine(sceneId: string, region: FogRegion): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'define', region });
  }

  /**
   * Take a fog region off the scene, and every reveal of it. A region is a
   * window the fog is opened through, so with the fog on the ground it
   * revealed goes back under the fog (unless another reveal covers it).
   */
  fogRemove(sceneId: string, regionId: string): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'remove', regionId });
  }

  /**
   * Switch the scene's fog on: the players and the TV see only what is
   * revealed, and nothing at all while nothing is. The regions and reveals
   * are whatever they were; this turns them back into a cover.
   */
  fogEnable(sceneId: string): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'enable' });
  }

  /**
   * Switch the scene's fog off: the players and the TV see the whole map.
   * Every region and every reveal is kept, so the GM can lay the fog out while
   * the table looks on, and `fogEnable` picks up exactly where this left it.
   */
  fogDisable(sceneId: string): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'disable' });
  }

  /**
   * Wipe the party's memory of floor `level` (sightlines, P6), or of every
   * floor when `level` is not given: the rooms the runners have seen and
   * left go back under the fog. What they see right now stays, because the
   * server's sight pass remembers it again at once. Nothing else changes:
   * the GM's own reveals, live or as seen before, are the GM's to hide.
   */
  fogForget(sceneId: string, level?: number): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'forget', ...(level === undefined ? {} : { level }) });
  }

  /**
   * "Fog everything" (the fog bar, 2026-09-27): start over, as one op on the
   * server (`refog`). The fog goes on, every reveal is hidden, the brush's
   * marks are cleared and the party's memory is forgotten, so the table is
   * left with only what the runners can see right now. The regions stay,
   * hidden, for the GM to reveal again from Prep's list.
   */
  fogRefog(sceneId: string): void {
    post(this.socket, { cmd: 'fog.reveal', sceneId, op: 'refog' });
  }

  dispose(): void {
    this.dragRelay.cancel();
    this.pointerRelay.cancel();
  }
}

/** Adapter so `GridCommands` can take the app's live socket directly. */
export function sinkFor(socket: LiveSocket | null): CommandSink | null {
  return socket;
}
