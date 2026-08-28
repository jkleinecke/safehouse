/**
 * WS hub (DESIGN.md §11): one room per campaign; persisted events append to
 * `ws_events` and broadcast filtered by visibility/role; ephemeral messages
 * relay with the same filtering and are never stored; reconnecting clients
 * replay the gap from `last_event_id`.
 *
 * Visibility filtering happens HERE, before serialization (Principle 4):
 * - `gm` role sees everything;
 * - `public` reaches everyone in the room;
 * - `gm` visibility reaches only GM sockets;
 * - `gm_owner` reaches GM sockets + the owning user's sockets;
 * - `player` / `observer` / `display` roles otherwise receive public only.
 * Hidden tokens are events with non-public visibility — they are simply never
 * serialized onto non-GM sockets.
 */
import type { Role, Visibility, WsEvent } from '@safehouse/contracts';
import { appendEvent, eventsSince, type Db } from '@safehouse/db';

/** Minimal structural view of a ws socket (matches `ws.WebSocket`). */
export interface HubSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

const OPEN = 1;

/** Who is on the other end of a socket (from the device token). */
export interface HubAuth {
  userId: string;
  role: Role;
  deviceId?: string;
  displayName?: string;
}

export interface HubClient {
  socket: HubSocket;
  campaignId: string;
  auth: HubAuth;
}

/** Input to `emit` / `emitEphemeral`. */
export interface EmitInput {
  /** Event type per the §11 catalog (`roll.created`, `token.moved`, …). */
  type: string;
  payload: unknown;
  visibility?: Visibility;
  /** Required for `gm_owner` visibility: the owning user. */
  ownerUserId?: string | null;
}

export interface HubCommandContext {
  hub: Hub;
  client: HubClient;
  campaignId: string;
  auth: HubAuth;
  /** Send a frame to the sender only (acks, errors). */
  reply(frame: Record<string, unknown>): void;
}

/**
 * A client→server command handler. Register with `hub.onCommand('roll.request',
 * handler)`; `msg` is the raw parsed frame `{ cmd, ...payload }` — validate it
 * with the matching contracts schema inside the handler.
 */
export type HubCommandHandler = (
  msg: Record<string, unknown>,
  ctx: HubCommandContext,
) => void | Promise<void>;

interface HubLogger {
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

/** May `auth` see an item with this visibility/owner? (Principle 4.) */
export function canSee(
  auth: Pick<HubAuth, 'userId' | 'role'>,
  item: { visibility: Visibility; ownerUserId?: string | null },
): boolean {
  if (auth.role === 'gm') return true;
  switch (item.visibility) {
    case 'public':
      return true;
    case 'gm':
      return false;
    case 'gm_owner':
      return item.ownerUserId != null && item.ownerUserId === auth.userId;
  }
}

export class Hub {
  private readonly rooms = new Map<string, Set<HubClient>>();
  private readonly commands = new Map<string, HubCommandHandler>();

  constructor(
    private readonly db: Db,
    private readonly log?: HubLogger,
  ) {
    // Built-in table gesture: tap-to-flash for everyone (FR9.15) — ephemeral.
    this.onCommand('ping', (msg, ctx) => {
      const x = typeof msg['x'] === 'number' ? msg['x'] : 0;
      const y = typeof msg['y'] === 'number' ? msg['y'] : 0;
      const sceneId = typeof msg['sceneId'] === 'string' ? msg['sceneId'] : undefined;
      this.emitEphemeral(ctx.campaignId, {
        type: 'ping',
        payload: { x, y, ...(sceneId ? { sceneId } : {}), userId: ctx.auth.userId },
      });
    });
  }

  /**
   * Add an authenticated socket to a campaign room. Wires message dispatch and
   * removal on close, announces presence, and returns the client handle.
   */
  joinRoom(socket: HubSocket, campaignId: string, auth: HubAuth): HubClient {
    const client: HubClient = { socket, campaignId, auth };
    let room = this.rooms.get(campaignId);
    if (!room) {
      room = new Set();
      this.rooms.set(campaignId, room);
    }
    room.add(client);
    socket.on('close', () => this.leave(client));
    socket.on('message', (data: unknown) => {
      void this.handleMessage(client, data);
    });
    this.emitEphemeral(campaignId, {
      type: 'presence.changed',
      payload: { userId: auth.userId, role: auth.role, state: 'connected' },
    });
    return client;
  }

  leave(client: HubClient): void {
    const room = this.rooms.get(client.campaignId);
    if (!room?.delete(client)) return;
    if (room.size === 0) this.rooms.delete(client.campaignId);
    this.emitEphemeral(client.campaignId, {
      type: 'presence.changed',
      payload: { userId: client.auth.userId, role: client.auth.role, state: 'disconnected' },
    });
  }

  /** Connected client count for a campaign (presence, tests). */
  roomSize(campaignId: string): number {
    return this.rooms.get(campaignId)?.size ?? 0;
  }

  /**
   * Persist one event to `ws_events` and broadcast it visibility-filtered.
   * Returns the stored event (with its monotonic id) so callers can link it.
   */
  async emit(campaignId: string, input: EmitInput): Promise<WsEvent> {
    const row = await appendEvent(this.db, {
      campaignId,
      type: input.type,
      payload: input.payload,
      visibility: input.visibility ?? 'public',
      ownerUserId: input.ownerUserId ?? null,
    });
    const event: WsEvent = {
      id: row.id,
      type: row.type,
      payload: row.payload,
      visibility: row.visibility,
      ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
      ts: row.createdAt.toISOString(),
    };
    this.broadcastEvent(campaignId, event);
    return event;
  }

  /**
   * Broadcast without persistence (`{ type, payload, ephemeral: true }`) —
   * drags-in-motion, pings, presence (§11). Same visibility filtering.
   */
  emitEphemeral(campaignId: string, input: EmitInput): void {
    const visibility = input.visibility ?? 'public';
    const ownerUserId = input.ownerUserId ?? null;
    const frame = JSON.stringify({ type: input.type, payload: input.payload, ephemeral: true });
    for (const client of this.rooms.get(campaignId) ?? []) {
      if (canSee(client.auth, { visibility, ownerUserId })) this.sendRaw(client, frame);
    }
  }

  /** Register a client→server command handler (`{ cmd: 'roll.request', … }`). */
  onCommand(cmd: string, handler: HubCommandHandler): void {
    this.commands.set(cmd, handler);
  }

  /**
   * Replay every event the client may see with id > `sinceId`, in id order
   * (§11 — reconnect with `last_event_id`). Chunked; ends with a
   * `replay.complete` ephemeral frame so clients know the gap is closed.
   */
  async replaySince(client: HubClient, sinceId: number): Promise<void> {
    let cursor = Number.isFinite(sinceId) ? Math.max(0, Math.floor(sinceId)) : 0;
    const CHUNK = 500;
    for (;;) {
      const rows = await eventsSince(this.db, client.campaignId, cursor, CHUNK);
      for (const row of rows) {
        cursor = row.id;
        if (!canSee(client.auth, { visibility: row.visibility, ownerUserId: row.ownerUserId })) {
          continue;
        }
        const event: WsEvent = {
          id: row.id,
          type: row.type,
          payload: row.payload,
          visibility: row.visibility,
          ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
          ts: row.createdAt.toISOString(),
        };
        this.sendRaw(client, JSON.stringify(event));
      }
      if (rows.length < CHUNK) break;
    }
    this.sendRaw(
      client,
      JSON.stringify({ type: 'replay.complete', payload: { lastEventId: cursor }, ephemeral: true }),
    );
  }

  private broadcastEvent(campaignId: string, event: WsEvent): void {
    const frame = JSON.stringify(event);
    for (const client of this.rooms.get(campaignId) ?? []) {
      if (canSee(client.auth, { visibility: event.visibility, ownerUserId: event.ownerUserId })) {
        this.sendRaw(client, frame);
      }
    }
  }

  private sendRaw(client: HubClient, frame: string): void {
    if (client.socket.readyState !== OPEN) return;
    try {
      client.socket.send(frame);
    } catch (err) {
      this.log?.error(err, 'hub: send failed');
    }
  }

  private async handleMessage(client: HubClient, data: unknown): Promise<void> {
    const text =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : String(data);
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.replyError(client, 'bad_json', 'message is not valid JSON');
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof (msg as { cmd?: unknown }).cmd !== 'string') {
      this.replyError(client, 'bad_command', 'expected { cmd: string, ... }');
      return;
    }
    const frame = msg as Record<string, unknown>;
    const cmd = frame['cmd'] as string;
    const handler = this.commands.get(cmd);
    if (!handler) {
      this.replyError(client, 'unknown_command', `no handler for '${cmd}'`);
      return;
    }
    const ctx: HubCommandContext = {
      hub: this,
      client,
      campaignId: client.campaignId,
      auth: client.auth,
      reply: (f) => this.sendRaw(client, JSON.stringify(f)),
    };
    try {
      await handler(frame, ctx);
    } catch (err) {
      this.log?.error(err, `hub: command '${cmd}' failed`);
      this.replyError(client, 'command_failed', err instanceof Error ? err.message : 'command failed');
    }
  }

  private replyError(client: HubClient, code: string, message: string): void {
    this.sendRaw(
      client,
      JSON.stringify({ type: 'error', payload: { code, message }, ephemeral: true }),
    );
  }
}
