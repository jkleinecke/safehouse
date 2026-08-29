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
import type { MarkKind, Role, Visibility, WsEvent } from '@safehouse/contracts';
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

/**
 * One unit of work in which a domain row and the event announcing it commit
 * together — see `Hub.atomic`.
 */
export interface EventTx {
  /**
   * The TRANSACTION handle. Every read and write inside an `atomic` block must
   * go through this one, never the service's own `db` — see the deadlock
   * warning on `Hub.atomic`.
   */
  readonly db: Db;
  /**
   * Append an event inside the transaction. It reaches sockets only once the
   * transaction commits, so nobody is ever told about a write that rolled back.
   */
  emit(input: EmitInput): Promise<WsEvent>;
}

export interface HubCommandContext {
  hub: Hub;
  client: HubClient;
  campaignId: string;
  auth: HubAuth;
  /** Send a frame to the sender only (acks, errors). */
  reply(frame: Record<string, unknown>): void;
}

/** The Postgres-level facts a driver wrapper hides behind `.cause`. */
export interface DbErrorInfo {
  /** The driver's own message, e.g. `duplicate key value violates …`. */
  message: string;
  /** SQLSTATE, e.g. `23505` (unique violation), `23514` (check violation). */
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

/**
 * Dig the real Postgres error out of a driver wrapper.
 *
 * Drizzle's `DrizzleQueryError.message` is only the statement it tried to run
 * ("Failed query: insert into \"ws_events\" …"); everything that says WHAT went
 * wrong — SQLSTATE, the violated constraint, the offending key — hangs off
 * `.cause`. A 500 that logged the wrapper alone is what turned an event-append
 * failure into a guessing game, so the hub logs both.
 */
export function describeDbError(err: unknown): DbErrorInfo {
  const seen = new Set<unknown>();
  let best: Record<string, unknown> | undefined;
  let cursor: unknown = err;
  for (let depth = 0; depth < 8 && cursor !== null && cursor !== undefined && !seen.has(cursor); depth++) {
    seen.add(cursor);
    const obj = cursor as Record<string, unknown>;
    // A pg/PGlite error is the one carrying SQLSTATE-ish fields; the deepest
    // such link wins, because drizzle may wrap more than once.
    if (
      typeof obj['code'] === 'string' ||
      typeof obj['severity'] === 'string' ||
      typeof obj['routine'] === 'string'
    ) {
      best = obj;
    }
    cursor = obj['cause'];
  }
  const src = best ?? ((err ?? {}) as Record<string, unknown>);
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const message =
    str(src['message']) ?? (err instanceof Error ? err.message : String(err ?? 'unknown error'));
  const code = str(src['code']);
  const detail = str(src['detail']);
  const constraint = str(src['constraint']);
  const table = str(src['table']);
  return {
    message,
    ...(code ? { code } : {}),
    ...(detail ? { detail } : {}),
    ...(constraint ? { constraint } : {}),
    ...(table ? { table } : {}),
  };
}

/** A 500 the API can name: the write failed because its event could not be recorded. */
function eventAppendError(type: string, cause: unknown): Error {
  const err = new Error(`could not record the '${type}' event; the change was not saved`) as Error & {
    statusCode: number;
    code: string;
    expose: boolean;
  };
  err.statusCode = 500;
  err.code = 'event_append_failed';
  err.expose = true;
  err.cause = cause;
  return err;
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
    // Built-in table gestures (FR9.15) — all ephemeral, never stored.
    //
    // Every mark carries an explicit `kind` so no client has to infer one from
    // cadence: a ping flashes, a pointer draws a trail, and a focus recentres
    // the camera. The wire type stays in the §11 catalog (`ping` / `pointer`),
    // so a viewer that ignores `kind` still marks the right spot.
    this.onCommand('ping', (msg, ctx) => this.relayMark('ping', 'ping', msg, ctx));
    this.onCommand('pointer', (msg, ctx) => this.relayMark('pointer', 'pointer', msg, ctx));
    // "Focus here" is the GM's alone — a player cannot yank the table's camera.
    this.onCommand('scene.focus', (msg, ctx) => {
      if (ctx.auth.role !== 'gm') {
        return ctx.reply({
          type: 'error',
          payload: { code: 'forbidden', message: 'focus is GM-only' },
          ephemeral: true,
        });
      }
      this.relayMark('ping', 'focus', msg, ctx);
    });
  }

  /** One ephemeral position mark: `{ x, y, sceneId?, kind, userId }`. */
  private relayMark(
    type: 'ping' | 'pointer',
    kind: MarkKind,
    msg: Record<string, unknown>,
    ctx: HubCommandContext,
  ): void {
    const x = typeof msg['x'] === 'number' ? msg['x'] : 0;
    const y = typeof msg['y'] === 'number' ? msg['y'] : 0;
    const sceneId = typeof msg['sceneId'] === 'string' ? msg['sceneId'] : undefined;
    this.emitEphemeral(ctx.campaignId, {
      type,
      payload: { x, y, ...(sceneId ? { sceneId } : {}), kind, userId: ctx.auth.userId },
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
   *
   * Use `atomic` instead whenever a domain row is being written alongside the
   * event: on its own this call cannot undo a row somebody else already
   * committed.
   */
  async emit(campaignId: string, input: EmitInput): Promise<WsEvent> {
    const event = await this.append(this.db, campaignId, input);
    this.broadcast(campaignId, event);
    return event;
  }

  /**
   * Write a domain row and the event announcing it in ONE transaction, then
   * broadcast — the two either both land or neither does.
   *
   * Without this the roll path had the worst of both: `insert into rolls`
   * committed as its own statement, a throw from the following `emit` returned
   * 500, and the table was left with a roll in the database that no client was
   * ever told about and no log would ever show. Events queued here go on the
   * wire only after COMMIT, so a rolled-back write is also an unsent event.
   *
   * DEADLOCK RULE — read this before using it. PGlite is a single embedded
   * connection: while a transaction is open, any query issued through the
   * outer `db` handle waits on the transaction's own mutex and therefore waits
   * forever (measured: a `db.query` inside `client.transaction` never
   * resolves). So inside the block:
   *   - every read and write goes through `tx.db`, never the service's `db`;
   *   - call only helpers that take a `Db` parameter and pass them `tx.db`;
   *   - hoist any lookup you can do beforehand OUT of the block.
   * A hang is worse than the 500 this fixes, so keep the body short and
   * explicit rather than routing broad helpers through it.
   */
  async atomic<T>(campaignId: string, body: (tx: EventTx) => Promise<T>): Promise<T> {
    const pending: WsEvent[] = [];
    const result = await this.db.transaction(async (tx) => {
      // The PGlite/node-postgres transaction handle exposes the same query API
      // as `Db`; drizzle just types it as a distinct class.
      const txDb = tx as unknown as Db;
      const collector: EventTx = {
        db: txDb,
        emit: async (input) => {
          const event = await this.append(txDb, campaignId, input);
          pending.push(event);
          return event;
        },
      };
      return body(collector);
    });
    for (const event of pending) this.broadcast(campaignId, event);
    return result;
  }

  /**
   * Append one event through `db` (a handle or a transaction) and shape it for
   * the wire. On failure the underlying Postgres error is logged with the
   * campaign and event type — the drizzle wrapper's message is only the SQL.
   */
  private async append(db: Db, campaignId: string, input: EmitInput): Promise<WsEvent> {
    const visibility = input.visibility ?? 'public';
    const ownerUserId = input.ownerUserId ?? null;
    try {
      const row = await appendEvent(db, {
        campaignId,
        type: input.type,
        payload: input.payload,
        visibility,
        ownerUserId,
      });
      return {
        id: row.id,
        type: row.type,
        payload: row.payload,
        visibility: row.visibility,
        ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
        ts: row.createdAt.toISOString(),
      };
    } catch (err) {
      const info = describeDbError(err);
      this.log?.error(
        {
          err,
          campaignId,
          eventType: input.type,
          visibility,
          dbMessage: info.message,
          ...(info.code ? { dbCode: info.code } : {}),
          ...(info.detail ? { dbDetail: info.detail } : {}),
          ...(info.constraint ? { dbConstraint: info.constraint } : {}),
          ...(info.table ? { dbTable: info.table } : {}),
        },
        `hub: ws_events append failed for '${input.type}' on campaign ${campaignId}`,
      );
      throw eventAppendError(input.type, err);
    }
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

  /**
   * Send an already-persisted event to the room, visibility-filtered. Public so
   * `atomic` callers can hand over post-commit delivery; the event must already
   * be in `ws_events`, or a client that replays will not see it again.
   */
  broadcast(campaignId: string, event: WsEvent): void {
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
