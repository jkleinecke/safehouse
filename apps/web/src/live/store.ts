/**
 * Live campaign state fed by the WS client (DESIGN.md §11).
 * Persisted events land in a ring buffer (the session log tail); a few
 * well-known types also project into dedicated slices. Ephemeral messages
 * (presence, drags, pings, fixer stream) never touch the event buffer.
 */
import { create } from 'zustand';
import type { Encounter, WsEphemeral, WsEvent } from '@safehouse/contracts';

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
  ts: number;
}

/** One chunk of the Fixer's streamed output (type `fixer.*`, ephemeral). */
export interface FixerChunk {
  type: string;
  payload: unknown;
  ts: number;
}

export interface LiveState {
  status: SocketStatus;
  /** Highest persisted event id seen — sent on reconnect for gap replay. */
  lastEventId: number;
  /** Ring buffer of persisted events, oldest → newest. */
  events: WsEvent[];
  presence: Record<string, PresenceEntry>;
  activeSceneId: string | null;
  encounter: Encounter | null;
  /** Interim token-drag positions by tokenId (cosmetic, never replayed). */
  drags: Record<string, DragPosition>;
  lastPing: PingMarker | null;
  fixerStream: FixerChunk[];

  setStatus: (status: SocketStatus) => void;
  applyEvent: (event: WsEvent) => void;
  handleEphemeral: (msg: WsEphemeral) => void;
  clearFixerStream: () => void;
  reset: () => void;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

const initialState = {
  status: 'idle' as SocketStatus,
  lastEventId: 0,
  events: [] as WsEvent[],
  presence: {} as Record<string, PresenceEntry>,
  activeSceneId: null as string | null,
  encounter: null as Encounter | null,
  drags: {} as Record<string, DragPosition>,
  lastPing: null as PingMarker | null,
  fixerStream: [] as FixerChunk[],
};

export const useLiveStore = create<LiveState>()((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  applyEvent: (event) => {
    const state = get();
    // Replay can resend events we already hold — ids are monotonic per campaign.
    if (event.id <= state.lastEventId) return;

    const events = [...state.events, event];
    if (events.length > EVENT_BUFFER_SIZE) events.splice(0, events.length - EVENT_BUFFER_SIZE);

    const patch: Partial<LiveState> = { events, lastEventId: event.id };
    const payload = asRecord(event.payload);

    switch (event.type) {
      case 'scene.activated': {
        const sceneId = payload['sceneId'] ?? payload['id'];
        if (typeof sceneId === 'string') patch.activeSceneId = sceneId;
        break;
      }
      case 'encounter.updated': {
        // Payload is the encounter (or `{ encounter }` delta wrapper).
        const enc = 'encounter' in payload ? payload['encounter'] : event.payload;
        patch.encounter = (enc ?? null) as Encounter | null;
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
      set({ lastPing: { x, y, sceneId, ts } });
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

  reset: () => set({ ...initialState }),
}));
