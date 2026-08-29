import { z } from 'zod';
import { VisibilitySchema, PointSchema } from './common.js';
import { RollRequestSchema } from './roll.js';
import { FogRegionSchema } from './scene.js';

/** Persisted event types (DESIGN.md §11 catalog) — the replayable campaign log. */
export const WS_EVENT_TYPES = [
  'roll.created',
  'log.posted',
  'encounter.updated',
  'combatant.damaged',
  'sheet.updated',
  'ledger.changed',
  'scene.activated',
  'scene.updated',
  'token.added',
  'token.moved',
  'token.updated',
  'token.removed',
  'fog.updated',
  'drawing.added',
  'drawing.cleared',
  'handout.revealed',
  'wiki.revealed',
  'os.changed',
  'clock.advanced',
  /**
   * GM steering of the table display (FR9.21): `{ blank?, ribbon?, focus? }`.
   * Persisted so a TV that reboots mid-session comes back blanked if that is
   * what the GM left it as — the §11 catalog calls itself representative and
   * the display's state is exactly the kind of thing replay has to restore.
   */
  'display.updated',
] as const;
export type WsEventType = (typeof WS_EVENT_TYPES)[number];

/** Ephemeral message types — relayed, throttled, never stored (§11). */
export const WS_EPHEMERAL_TYPES = ['token.dragging', 'ping', 'pointer', 'presence.changed'] as const;
export type WsEphemeralType = (typeof WS_EPHEMERAL_TYPES)[number];

/**
 * A persisted server→client event. `id` is monotonic per campaign; clients
 * track `last_event_id` and replay the gap on reconnect (§11).
 * `type` is an open string so new events don't break old clients; the
 * canonical names live in WS_EVENT_TYPES.
 */
export const WsEventSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  payload: z.unknown(),
  visibility: VisibilitySchema,
  /** For visibility 'gm_owner': the owning user. */
  ownerUserId: z.string().optional(),
  /** ISO timestamp. */
  ts: z.string(),
});
export type WsEvent = z.infer<typeof WsEventSchema>;

/** An ephemeral server→client message — same socket, never stored. */
export const WsEphemeralSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  ephemeral: z.literal(true),
});
export type WsEphemeral = z.infer<typeof WsEphemeralSchema>;

// ---------------------------------------------------------------------------
// Client→server WS commands: `{ cmd: string, ...payload }` (BUILD_CONVENTIONS)
// ---------------------------------------------------------------------------

export const RollRequestCommandSchema = z.object({
  cmd: z.literal('roll.request'),
  ...RollRequestSchema.shape,
});
export type RollRequestCommand = z.infer<typeof RollRequestCommandSchema>;

/** Final position — persisted as `token.moved` (server-authoritative, FR9.5). */
export const TokenMoveCommandSchema = z.object({
  cmd: z.literal('token.move'),
  tokenId: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().optional(),
});
export type TokenMoveCommand = z.infer<typeof TokenMoveCommandSchema>;

/** Interim drag position — relayed as ephemeral `token.dragging`, never stored. */
export const TokenDragCommandSchema = z.object({
  cmd: z.literal('token.drag'),
  tokenId: z.string(),
  x: z.number(),
  y: z.number(),
});
export type TokenDragCommand = z.infer<typeof TokenDragCommandSchema>;

/** Fog region ops: reveal/hide a named region, or define a new one (FR9.13/9.14). */
export const FogRevealCommandSchema = z.object({
  cmd: z.literal('fog.reveal'),
  sceneId: z.string(),
  op: z.enum(['reveal', 'hide', 'define']).default('reveal'),
  /** For reveal/hide of a named region. */
  regionId: z.string().optional(),
  /** For op 'define': the new named region. */
  region: FogRegionSchema.optional(),
  /** For freeform brush/polygon reveals. */
  shape: z.array(PointSchema).optional(),
  /** Announce the reveal in the session log (FR9.14). */
  announce: z.boolean().optional(),
});
export type FogRevealCommand = z.infer<typeof FogRevealCommandSchema>;

/** Advance to the next actor / pass / turn (FR4.3). */
export const EncounterAdvanceCommandSchema = z.object({
  cmd: z.literal('encounter.advance'),
  encounterId: z.string(),
});
export type EncounterAdvanceCommand = z.infer<typeof EncounterAdvanceCommandSchema>;

/** Apply boxes to a combatant's monitor (FR4.5). Negative boxes heal/undo. */
export const DamageApplyCommandSchema = z.object({
  cmd: z.literal('damage.apply'),
  combatantId: z.string(),
  encounterId: z.string().optional(),
  monitor: z.enum(['physical', 'stun']),
  boxes: z.number().int(),
  note: z.string().optional(),
});
export type DamageApplyCommand = z.infer<typeof DamageApplyCommandSchema>;

/** Tap-to-flash for everyone (FR9.15) — ephemeral. */
export const PingCommandSchema = z.object({
  cmd: z.literal('ping'),
  sceneId: z.string().optional(),
  x: z.number(),
  y: z.number(),
});
export type PingCommand = z.infer<typeof PingCommandSchema>;

/**
 * Pointer trail (FR9.15) — a stream of positions relayed as ephemeral
 * `pointer`, throttled by the sender, never stored. A ping is one flash; a
 * pointer is "look, along here".
 */
export const PointerCommandSchema = z.object({
  cmd: z.literal('pointer'),
  sceneId: z.string().optional(),
  x: z.number(),
  y: z.number(),
});
export type PointerCommand = z.infer<typeof PointerCommandSchema>;

/**
 * "Focus here" (FR9.15/FR9.21) — the GM recentres every viewer's camera once.
 * Relayed as an ephemeral ping-family mark carrying `kind: 'focus'`, so a
 * client that only understands pings still flashes the right spot.
 */
export const SceneFocusCommandSchema = z.object({
  cmd: z.literal('scene.focus'),
  sceneId: z.string().optional(),
  x: z.number(),
  y: z.number(),
});
export type SceneFocusCommand = z.infer<typeof SceneFocusCommandSchema>;

/**
 * GM steering of the table display (FR9.21): blank the TV, or drop the
 * initiative ribbon during pure roleplay. GM-only; persisted as
 * `display.updated` with public visibility (the TV is a `display` device and
 * must receive it).
 */
export const DisplaySetCommandSchema = z.object({
  cmd: z.literal('display.set'),
  blank: z.boolean().optional(),
  ribbon: z.boolean().optional(),
});
export type DisplaySetCommand = z.infer<typeof DisplaySetCommandSchema>;

export const WsCommandSchema = z.discriminatedUnion('cmd', [
  RollRequestCommandSchema,
  TokenMoveCommandSchema,
  TokenDragCommandSchema,
  FogRevealCommandSchema,
  EncounterAdvanceCommandSchema,
  DamageApplyCommandSchema,
  PingCommandSchema,
  PointerCommandSchema,
  SceneFocusCommandSchema,
  DisplaySetCommandSchema,
]);
export type WsCommand = z.infer<typeof WsCommandSchema>;
export type WsCommandInput = z.input<typeof WsCommandSchema>;

export const WS_COMMANDS = [
  'roll.request',
  'token.move',
  'token.drag',
  'fog.reveal',
  'encounter.advance',
  'damage.apply',
  'ping',
  'pointer',
  'scene.focus',
  'display.set',
] as const;
export type WsCommandName = (typeof WS_COMMANDS)[number];

/**
 * How a client should render an incoming ephemeral mark. Carried as
 * `payload.kind` on `ping` / `pointer` so nothing has to guess from cadence.
 */
export const MARK_KINDS = ['ping', 'pointer', 'focus'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
