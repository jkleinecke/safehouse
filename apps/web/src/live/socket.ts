/**
 * WS client for /ws?campaign=&token= (DESIGN.md §11, BUILD_CONVENTIONS).
 * Auto-reconnects with capped exponential backoff; tracks last persisted
 * event id and requests gap replay on reconnect; feeds the zustand live store.
 */
import type { WsCommandInput, WsEphemeral, WsEvent } from '@safehouse/contracts';
import { useLiveStore } from './store.js';

export interface LiveSocketOptions {
  campaignId: string;
  token: string;
  /** Override the ws origin (tests). Defaults to the page origin. */
  baseUrl?: string;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

function isEphemeral(v: Record<string, unknown>): v is Record<string, unknown> & { ephemeral: true } {
  return v['ephemeral'] === true && typeof v['type'] === 'string';
}

function isPersistedEvent(v: Record<string, unknown>): boolean {
  return typeof v['id'] === 'number' && typeof v['type'] === 'string';
}

export class LiveSocket {
  readonly campaignId: string;
  private readonly token: string;
  private readonly baseUrl?: string;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(opts: LiveSocketOptions) {
    this.campaignId = opts.campaignId;
    this.token = opts.token;
    this.baseUrl = opts.baseUrl;
  }

  private url(): string {
    const base =
      this.baseUrl ??
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const last = useLiveStore.getState().lastEventId;
    const params = new URLSearchParams({ campaign: this.campaignId, token: this.token });
    // Gap replay is a connect parameter, not a command: the hub replays every
    // event after this id as soon as it accepts the socket (§11), so a phone
    // that lost Wi-Fi for a minute misses nothing persisted.
    if (last > 0) params.set('last_event_id', String(last));
    return `${base}/ws?${params.toString()}`;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUser = false;
    useLiveStore.getState().setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      useLiveStore.getState().setStatus('online');
      // No replay command: `last_event_id` on the URL already asked for it.
    };

    ws.onmessage = (msgEvent: MessageEvent) => {
      if (typeof msgEvent.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(msgEvent.data);
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const obj = parsed as Record<string, unknown>;
      const store = useLiveStore.getState();
      if (isEphemeral(obj)) {
        store.handleEphemeral(obj as unknown as WsEphemeral);
      } else if (isPersistedEvent(obj)) {
        store.applyEvent(obj as unknown as WsEvent);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUser) {
        useLiveStore.getState().setStatus('idle');
        return;
      }
      useLiveStore.getState().setStatus('offline');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows and drives the reconnect.
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay =
      Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** this.attempts) +
      Math.floor(Math.random() * 250);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Send a typed client→server command. Returns false when not connected. */
  send(cmd: WsCommandInput): boolean {
    return this.sendRaw(cmd);
  }

  private sendRaw(data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(data));
    return true;
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    useLiveStore.getState().setStatus('idle');
  }
}

// ---------------------------------------------------------------------------
// Singleton per campaign — route changes inside a campaign reuse one socket.
// ---------------------------------------------------------------------------

let current: LiveSocket | null = null;

export function getLiveSocket(opts: LiveSocketOptions): LiveSocket {
  if (current && current.campaignId !== opts.campaignId) {
    current.close();
    useLiveStore.getState().reset();
    current = null;
  }
  if (!current) current = new LiveSocket(opts);
  return current;
}

export function disconnectLiveSocket(): void {
  current?.close();
  current = null;
}
