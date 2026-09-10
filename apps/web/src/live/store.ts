/**
 * Live campaign state (DESIGN.md §11).
 *
 * Two inputs, one state:
 *   `hydrate(snapshot)` — a REST read of what the server already holds, run on
 *      mount and again after every reconnect (LIVE-1). Without it the UI only
 *      ever knew about events that happened to arrive while it was mounted, so
 *      a refresh mid-session showed an empty log and an empty tracker.
 *   `applyEvent(event)` — the live WS stream and the hub's `last_event_id`
 *      replay, merged on top.
 *
 * Both funnel through `mergeEvents`, so backfill, replay and live traffic are
 * idempotent and order-insensitive: an event that arrives twice applies once.
 * Ephemeral messages (presence, drags, pings, fixer stream) never touch the
 * event window.
 */
import { create } from 'zustand';
import type { Encounter, WsEphemeral, WsEvent } from '@safehouse/contracts';
import {
  isEncounterDeleted,
  mergeEncounter,
  mergeEvents,
  normalizeEncounter,
  type EventWindow,
} from './merge.js';

export type SocketStatus = 'idle' | 'connecting' | 'online' | 'offline';

export const EVENT_BUFFER_SIZE = 500;
export const FIXER_BUFFER_SIZE = 200;

export interface PresenceEntry {
  userId: string;
  state: string;
  ts: number;
}

export interface DragPosition {
  x: number;
  y: number;
  ts: number;
}

export interface PingMarker {
  x: number;
  y: number;
  sceneId?: string;
  /**
   * How to render the mark (FR9.15): a `ping` flashes, a `pointer` extends a
   * trail, a `focus` recentres the camera. The server stamps it on every
   * ephemeral mark, so nothing downstream has to guess from cadence — a wrong
   * guess pans the table's shared screen off the action.
   */
  kind?: 'ping' | 'pointer' | 'focus';
  ts: number;
}

/** One chunk of the Fixer's streamed output (type `fixer.*`, ephemeral). */
export interface FixerChunk {
  type: string;
  payload: unknown;
  ts: number;
}

/** The slices a live view can wait on before it may claim "nothing yet". */
export type HydrationSlice = 'campaign' | 'log' | 'encounter' | 'session' | 'tables';

export const HYDRATION_SLICES: HydrationSlice[] = [
  'campaign',
  'log',
  'encounter',
  'session',
  'tables',
];

/**
 * `idle` means we have not asked yet — an empty view under `idle` or `loading`
 * must say "loading", never "nothing here". `error` is its own word so a 403
 * or a dead server never masquerades as a quiet table.
 */
export type HydrationStatus = 'idle' | 'loading' | 'ready' | 'error';

export type HydrationMap = Record<HydrationSlice, HydrationStatus>;

/** A REST read of server-held state, merged onto whatever the socket brought. */
export interface LiveSnapshot {
  /** Persisted events in any order; deduplicated against the window. */
  events?: readonly unknown[];
  encounter?: Encounter | null;
  activeSceneId?: string | null;
  activeSessionId?: string | null;
  sessionLive?: boolean;
  connectedCount?: number;
  /**
   * The store's `lastEventId` when the fetch that produced this snapshot was
   * ISSUED. A projected slice (encounter, active scene) is only accepted when
   * no newer WS event has already written it — a snapshot in flight must never
   * roll the table back.
   */
  asOfEventId?: number;
}

export interface LiveState {
  status: SocketStatus;
  /** Highest persisted event id seen — sent on reconnect for gap replay. */
  lastEventId: number;
  /** Highest id that has aged out of the ring buffer. */
  floorEventId: number;
  /** Ring buffer of persisted events, oldest → newest. */
  events: WsEvent[];
  presence: Record<string, PresenceEntry>;
  activeSceneId: string | null;
  encounter: Encounter | null;
  /** Interim token-drag positions by tokenId (cosmetic, never replayed). */
  drags: Record<string, DragPosition>;
  lastPing: PingMarker | null;
  fixerStream: FixerChunk[];

  /** Live-mode readout from `GET /api/campaigns/:id/live` (FR6.2). */
  activeSessionId: string | null;
  sessionLive: boolean;
  connectedCount: number;

  /** Per-slice hydration state — what powers honest empty states. */
  hydration: HydrationMap;
  /** Bumped on every reconnect (online after having been online). */
  reconnectEpoch: number;
  /** Whether the socket has ever reached `online` in this campaign. */
  hasBeenOnline: boolean;

  /** WS event id that last wrote `encounter` / `activeSceneId`. */
  encounterEventId: number;
  /**
   * Which frame filled `encounter`: the server announces every fight twice,
   * `gm` (everything) then `public` (hidden rows stripped, lines reduced), and
   * a GM socket hears both. Once a `gm` frame has painted the roster, a
   * `public` one for the same fight must not overwrite it — that emptied the
   * GM's own tracker of every hidden ganger the moment anything happened.
   */
  encounterScope: 'gm' | 'public' | null;
  sceneEventId: number;

  setStatus: (status: SocketStatus) => void;
  applyEvent: (event: WsEvent) => void;
  hydrate: (snapshot: LiveSnapshot) => void;
  setHydration: (slice: HydrationSlice, status: HydrationStatus) => void;
  handleEphemeral: (msg: WsEphemeral) => void;
  clearFixerStream: () => void;
  reset: () => void;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function idleHydration(): HydrationMap {
  return { campaign: 'idle', log: 'idle', encounter: 'idle', session: 'idle', tables: 'idle' };
}

const initialState = {
  status: 'idle' as SocketStatus,
  lastEventId: 0,
  floorEventId: 0,
  events: [] as WsEvent[],
  presence: {} as Record<string, PresenceEntry>,
  activeSceneId: null as string | null,
  encounter: null as Encounter | null,
  drags: {} as Record<string, DragPosition>,
  lastPing: null as PingMarker | null,
  fixerStream: [] as FixerChunk[],
  activeSessionId: null as string | null,
  sessionLive: false,
  connectedCount: 0,
  hydration: idleHydration(),
  reconnectEpoch: 0,
  hasBeenOnline: false,
  encounterEventId: 0,
  encounterScope: null,
  sceneEventId: 0,
};

function windowOf(state: LiveState): EventWindow {
  return { events: state.events, lastEventId: state.lastEventId, floorEventId: state.floorEventId };
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  ...initialState,

  setStatus: (status) =>
    set((s) => {
      if (s.status === status) return s;
      if (status !== 'online') return { status };
      // A reconnect is the second and every later arrival at `online`. It is
      // the cue to re-read REST: the hub replays persisted events from
      // `last_event_id`, but derived state (the encounter, the active scene)
      // is a snapshot the client can only get by asking.
      return s.hasBeenOnline
        ? { status, reconnectEpoch: s.reconnectEpoch + 1 }
        : { status, hasBeenOnline: true };
    }),

  applyEvent: (event) => {
    const state = get();
    const win = windowOf(state);
    const merged = mergeEvents(win, [event], EVENT_BUFFER_SIZE);
    // The same object back means we already hold this event (a replay, or a
    // duplicate broadcast). Projections must not re-run: a replayed
    // `encounter.updated` would clobber a newer optimistic patch
    // (BUILD_CONVENTIONS "replay from last_event_id").
    if (merged === win) return;

    const patch: Partial<LiveState> = {
      events: merged.events,
      lastEventId: merged.lastEventId,
      floorEventId: merged.floorEventId,
    };
    const payload = asRecord(event.payload);

    switch (event.type) {
      case 'scene.activated': {
        const sceneId = payload['sceneId'] ?? payload['id'];
        if (typeof sceneId === 'string' && event.id >= state.sceneEventId) {
          patch.activeSceneId = sceneId;
          patch.sceneEventId = event.id;
        }
        break;
      }
      case 'encounter.updated': {
        if (event.id < state.encounterEventId) break;
        if (isEncounterDeleted(event.payload)) {
          const gone = normalizeEncounter(event.payload);
          if (!gone || !state.encounter || gone.id === state.encounter.id) {
            patch.encounter = null;
            patch.encounterEventId = event.id;
          }
          break;
        }
        // The broadcast nests the row under `payload.encounter` but keeps
        // `combatants` and `activeCombatantId` at the top level — reading the
        // nested object alone drops the whole roster. `mergeEncounter` also
        // stops a roster-less delta from emptying a populated tracker.
        const next = normalizeEncounter(event.payload);
        if (next) {
          const scope = payload['scope'] === 'gm' ? 'gm' : payload['scope'] === 'public' ? 'public' : null;
          // The player-safe twin of a frame this socket already took in full.
          if (scope === 'public' && state.encounterScope === 'gm' && state.encounter?.id === next.id) break;
          patch.encounter = mergeEncounter(state.encounter, next);
          patch.encounterEventId = event.id;
          patch.encounterScope = scope ?? (state.encounter?.id === next.id ? state.encounterScope : null);
        }
        break;
      }
      case 'token.moved': {
        // A drag ends with one persisted final position — drop the interim ghost.
        const tokenId = payload['tokenId'] ?? asRecord(payload['token'])['id'];
        if (typeof tokenId === 'string' && state.drags[tokenId]) {
          const drags = { ...state.drags };
          delete drags[tokenId];
          patch.drags = drags;
        }
        break;
      }
      default:
        break;
    }

    set(patch);
  },

  /**
   * Fold a REST snapshot in. Events merge (never replacing the live window);
   * projected slices are only accepted when no NEWER socket event has already
   * written them, so a slow response can never roll the table back.
   */
  hydrate: (snapshot) => {
    const state = get();
    const patch: Partial<LiveState> = {};

    if (snapshot.events && snapshot.events.length > 0) {
      const win = windowOf(state);
      const merged = mergeEvents(win, snapshot.events, EVENT_BUFFER_SIZE);
      if (merged !== win) {
        patch.events = merged.events;
        patch.lastEventId = merged.lastEventId;
        patch.floorEventId = merged.floorEventId;
      }
    }

    const asOf = snapshot.asOfEventId ?? Number.POSITIVE_INFINITY;

    if (snapshot.encounter !== undefined && asOf >= state.encounterEventId) {
      // A snapshot normally carries the whole roster and simply replaces what
      // is there; `mergeEncounter` covers the case where the detail read fell
      // back to a list row that has no combatants on it. An explicit `null`
      // is the server saying there is no fight — that must clear, not merge.
      patch.encounter =
        snapshot.encounter === null ? null : mergeEncounter(state.encounter, snapshot.encounter);
    }
    if (snapshot.activeSceneId !== undefined && asOf >= state.sceneEventId) {
      patch.activeSceneId = snapshot.activeSceneId;
    }
    if (snapshot.activeSessionId !== undefined) patch.activeSessionId = snapshot.activeSessionId;
    if (snapshot.sessionLive !== undefined) patch.sessionLive = snapshot.sessionLive;
    if (snapshot.connectedCount !== undefined) patch.connectedCount = snapshot.connectedCount;

    if (Object.keys(patch).length > 0) set(patch);
  },

  setHydration: (slice, status) =>
    set((s) =>
      s.hydration[slice] === status ? s : { hydration: { ...s.hydration, [slice]: status } },
    ),

  handleEphemeral: (msg) => {
    const payload = asRecord(msg.payload);
    const ts = Date.now();

    if (msg.type === 'presence.changed') {
      const userId = payload['userId'];
      if (typeof userId !== 'string') return;
      const state = typeof payload['state'] === 'string' ? (payload['state'] as string) : 'online';
      set((s) => ({ presence: { ...s.presence, [userId]: { userId, state, ts } } }));
      return;
    }

    if (msg.type === 'token.dragging') {
      const tokenId = payload['tokenId'];
      const x = payload['x'];
      const y = payload['y'];
      if (typeof tokenId !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
      set((s) => ({ drags: { ...s.drags, [tokenId]: { x, y, ts } } }));
      return;
    }

    if (msg.type === 'ping' || msg.type === 'pointer') {
      const x = payload['x'];
      const y = payload['y'];
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const sceneId = typeof payload['sceneId'] === 'string' ? (payload['sceneId'] as string) : undefined;
      // The server stamps `kind`; fall back to the wire type for anything
      // older, which is exactly what the two names already mean.
      const raw = payload['kind'];
      const kind =
        raw === 'ping' || raw === 'pointer' || raw === 'focus'
          ? raw
          : msg.type === 'pointer'
            ? 'pointer'
            : 'ping';
      set({ lastPing: { x, y, sceneId, kind, ts } });
      return;
    }

    if (msg.type.startsWith('fixer.')) {
      set((s) => {
        const fixerStream = [...s.fixerStream, { type: msg.type, payload: msg.payload, ts }];
        if (fixerStream.length > FIXER_BUFFER_SIZE)
          fixerStream.splice(0, fixerStream.length - FIXER_BUFFER_SIZE);
        return { fixerStream };
      });
    }
  },

  clearFixerStream: () => set({ fixerStream: [] }),

  reset: () => set({ ...initialState, hydration: idleHydration() }),
}));

// ---------------------------------------------------------------------------
// Selectors — one place that decides what "we have nothing" means
// ---------------------------------------------------------------------------

/** True once the server has answered for this slice (with rows or with none). */
export function isHydrated(state: Pick<LiveState, 'hydration'>, slice: HydrationSlice): boolean {
  const s = state.hydration[slice];
  return s === 'ready' || s === 'error';
}

/** True while we have not yet heard back — the view must not say "empty". */
export function isHydrating(state: Pick<LiveState, 'hydration'>, slice: HydrationSlice): boolean {
  const s = state.hydration[slice];
  return s === 'idle' || s === 'loading';
}
