/**
 * Pure merge/normalise helpers behind live-state hydration (LIVE-1).
 *
 * The web app used to render only the WebSocket events it happened to receive
 * while mounted, so a page load mid-session showed an empty world. Every live
 * view now hydrates from REST first and merges WS events on top; this module
 * owns the two hard parts of that, with no React and no I/O so both are
 * directly testable:
 *
 *   1. `mergeEvents` — one idempotent, order-insensitive event window. A
 *      snapshot's backfill, the hub's `last_event_id` replay and the live
 *      stream all go through it, so a replayed event never double-applies.
 *   2. `normalizeEncounter` — a defensive read of whatever the encounters API
 *      hands back (`GET /api/encounters/:id`, `encounter.updated` payloads,
 *      the GM shape and the reduced player shape) into one `Encounter`.
 */
import type { Combatant, CombatantMonitors, Encounter, WsEvent } from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Tolerant readers (the server owns the shapes; we never throw on a surprise)
// ---------------------------------------------------------------------------

export function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function int(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function firstDefined<T>(...vals: Array<T | undefined>): T | undefined {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// The event window
// ---------------------------------------------------------------------------

export interface EventWindow {
  /** Persisted events, oldest → newest, deduplicated by id. */
  events: WsEvent[];
  /** Highest persisted id ever seen — what the socket replays from. */
  lastEventId: number;
  /**
   * Highest id that has fallen off the front of the ring buffer. Anything at
   * or below it is history we deliberately dropped: re-adding it on a replay
   * would resurrect a line the log already scrolled past.
   */
  floorEventId: number;
}

export const EMPTY_WINDOW: EventWindow = { events: [], lastEventId: 0, floorEventId: 0 };

/** A value that looks like a persisted event (id + type). */
export function isPersistedEvent(v: unknown): v is WsEvent {
  const o = rec(v);
  return typeof o['id'] === 'number' && Number.isFinite(o['id']) && typeof o['type'] === 'string';
}

/**
 * Fold `incoming` into `window`, idempotently and regardless of order.
 *
 * Returns the SAME object when nothing changed, so a zustand `set` driven by
 * this never churns subscribers on a duplicate replay.
 */
export function mergeEvents(
  window: EventWindow,
  incoming: readonly unknown[],
  cap: number,
): EventWindow {
  const existing = new Set(window.events.map((e) => e.id));
  const added: WsEvent[] = [];
  let highest = window.lastEventId;
  const batchSeen = new Set<number>();

  for (const raw of incoming) {
    if (!isPersistedEvent(raw)) continue;
    const id = raw.id;
    if (id <= window.floorEventId) continue; // already scrolled off the tail
    if (batchSeen.has(id)) continue; // duplicate inside this batch
    batchSeen.add(id);
    if (id > highest) highest = id;
    if (existing.has(id)) continue; // already in the buffer
    added.push(raw);
  }

  if (added.length === 0) {
    // A pure replay of events we already hold still tells us how far the
    // server has got, but only ever forward.
    return highest > window.lastEventId ? { ...window, lastEventId: highest } : window;
  }

  const merged = [...window.events, ...added].sort((a, b) => a.id - b.id);
  let floorEventId = window.floorEventId;
  if (cap > 0 && merged.length > cap) {
    const dropped = merged.splice(0, merged.length - cap);
    const lastDropped = dropped[dropped.length - 1];
    if (lastDropped && lastDropped.id > floorEventId) floorEventId = lastDropped.id;
  }

  return { events: merged, lastEventId: highest, floorEventId };
}

// ---------------------------------------------------------------------------
// Encounter normalisation (FR4.2–4.10)
// ---------------------------------------------------------------------------

const ZERO_MONITORS: CombatantMonitors = {
  physical: { max: 0, filled: 0 },
  stun: { max: 0, filled: 0 },
  overflow: { max: 0, filled: 0 },
};

function monitorState(v: unknown, fallback: { max: number; filled: number }) {
  const o = rec(v);
  return {
    max: Math.max(0, int(o['max']) ?? fallback.max),
    filled: Math.max(0, int(o['filled']) ?? fallback.filled),
  };
}

function parseMonitors(v: unknown): CombatantMonitors | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = rec(v);
  return {
    physical: monitorState(o['physical'], { max: 0, filled: 0 }),
    stun: monitorState(o['stun'], { max: 0, filled: 0 }),
    overflow: monitorState(o['overflow'], { max: 0, filled: 0 }),
  };
}

/**
 * The reduced player view of a combatant carries a coarse `condition` word
 * instead of boxes (FR4.9 — exact numbers never leave the server for someone
 * else's row). Turn it into the smallest monitors object that lands in the
 * right public band, so the tracker paints "badly hurt" rather than a
 * cheerful, wrong "unhurt".
 *
 * This is ONLY ever read through the coarse renderer: `monitorDetailFor` gives
 * a non-own public row `coarse`, which draws the band chip and no numbers. A
 * row the viewer owns comes with its real monitors from the server, so nothing
 * synthesised is ever shown as a box count.
 */
export function monitorsFromCondition(condition: string | undefined): CombatantMonitors {
  const band = (max: number, filled: number): CombatantMonitors => ({
    physical: { max, filled },
    stun: { max, filled: 0 },
    overflow: { max: 0, filled: 0 },
  });
  switch (condition) {
    case 'down':
      return band(10, 10);
    case 'bloodied':
      return band(10, 8);
    case 'wounded':
      return band(10, 5);
    case 'unharmed':
      return band(10, 0);
    default:
      return ZERO_MONITORS;
  }
}

/**
 * Marker written onto a normalised combatant when the SERVER said this row
 * belongs to the viewing device (`own: true` on the player view). The player
 * shape drops `sourceId`, so ownership cannot be re-derived client-side — and
 * guessing it would be worse than asking.
 */
export const OWNED_BY_VIEWER = 'ownedByViewer';

export function normalizeCombatant(raw: unknown, encounterId: string): Combatant | null {
  const o = rec(raw);
  const id = str(o['id']);
  const name = str(o['name']);
  if (!id || !name) return null;

  const own = o['own'] === true;
  const parsed = parseMonitors(o['monitors']);
  // Synthesise only for someone else's row (see monitorsFromCondition): an own
  // row with no monitors is a server bug, and zeros say so honestly.
  const monitors = parsed ?? (own ? ZERO_MONITORS : monitorsFromCondition(str(o['condition'])));

  const effects = arr(o['effects'])
    .map((e) => {
      const r = rec(e);
      const eid = str(r['id']);
      const ename = str(r['name']);
      if (!eid || !ename) return null;
      const duration = rec(r['duration']);
      const kind = str(duration['kind']);
      return {
        id: eid,
        name: ename,
        mods: arr(r['mods']) as Combatant['effects'][number]['mods'],
        duration: {
          kind: (kind === 'end_of_turn' || kind === 'while_sustained' || kind === 'passes'
            ? kind
            : 'manual') as 'end_of_turn' | 'while_sustained' | 'passes' | 'manual',
          ...(int(duration['value']) !== undefined ? { value: int(duration['value']) as number } : {}),
        },
        ...(str(r['note']) ? { note: str(r['note']) as string } : {}),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const visRaw = str(o['visibility']);
  const visibility =
    visRaw === 'gm' || visRaw === 'gm_owner' || visRaw === 'public' ? visRaw : 'public';
  const srcRaw = str(o['source']);
  const source = (
    srcRaw === 'character' ||
    srcRaw === 'npc_template' ||
    srcRaw === 'generated' ||
    srcRaw === 'grunt_group' ||
    srcRaw === 'manual'
      ? srcRaw
      : 'manual'
  ) as Combatant['source'];
  const kindRaw = str(o['initKind']);
  const initKind = (
    kindRaw === 'astral' ||
    kindRaw === 'matrix_ar' ||
    kindRaw === 'vr_cold' ||
    kindRaw === 'vr_hot' ||
    kindRaw === 'physical'
      ? kindRaw
      : 'physical'
  ) as Combatant['initKind'];

  const copilot = { ...rec(o['copilot']) };
  if (own) copilot[OWNED_BY_VIEWER] = true;

  const edge = rec(o['edge']);
  const edgeMax = int(edge['max']);
  const edgeCurrent = int(edge['current']);

  return {
    id,
    encounterId: str(o['encounterId']) ?? encounterId,
    ...(str(o['tokenId']) ? { tokenId: str(o['tokenId']) as string } : {}),
    source,
    ...(str(o['sourceId']) ? { sourceId: str(o['sourceId']) as string } : {}),
    name,
    initBase: int(o['initBase']) ?? 0,
    initDice: Math.min(5, Math.max(0, int(o['initDice']) ?? 1)),
    initScore: int(o['initScore']) ?? 0,
    initKind,
    monitors,
    effects,
    visibility,
    actedThisPass: o['actedThisPass'] === true,
    ...(edgeMax !== undefined && edgeCurrent !== undefined
      ? { edge: { max: edgeMax, current: edgeCurrent } }
      : {}),
    ...(rec(o['grunt'])['size'] !== undefined ? { grunt: o['grunt'] as Combatant['grunt'] } : {}),
    ...(Object.keys(copilot).length > 0 ? { copilot } : {}),
  };
}

/**
 * Read an encounter out of whatever the API or the event stream produced.
 *
 * Accepted shapes (the encounters domain is still settling where `state`,
 * `turn` and `pass` live, so read all of them):
 *   `{ encounter, combatants, activeCombatantId, state, turn, pass }`  REST
 *   `{ encounterId, scope, reason, encounter, combatants, … }`         event
 *   `{ encounter: { …, combatants } }`                                 event
 *   `{ id, state, turn, pass, combatants }`                            bare
 *
 * The `encounter.updated` broadcast is the sharp one: it nests the ROW under
 * `payload.encounter` (serialised without its roster) and puts `combatants`
 * and `activeCombatantId` at the TOP level. Reading `payload.encounter` alone
 * — which is what the store used to do — yields a live encounter with no
 * combatants and no acting row, which is half of why the tracker read
 * "No combatants yet" over a fully staged fight.
 */
export function normalizeEncounter(raw: unknown, fallbackId?: string): Encounter | null {
  const root = rec(raw);
  const nested = 'encounter' in root ? rec(root['encounter']) : null;
  const enc = nested ?? root;

  const id = firstDefined(
    str(enc['id']),
    str(root['id']),
    str(root['encounterId']),
    str(enc['encounterId']),
    fallbackId,
  );
  if (!id) return null;

  const stateRaw = firstDefined(str(enc['state']), str(root['state']));
  const state = (
    stateRaw === 'live' || stateRaw === 'done' || stateRaw === 'prep' ? stateRaw : 'prep'
  ) as Encounter['state'];

  const rawCombatants = arr(
    firstDefined(
      Array.isArray(root['combatants']) ? root['combatants'] : undefined,
      Array.isArray(enc['combatants']) ? enc['combatants'] : undefined,
    ),
  );
  const combatants = rawCombatants
    .map((c) => normalizeCombatant(c, id))
    .filter((c): c is Combatant => c !== null);

  const activeCombatantId =
    firstDefined(str(root['activeCombatantId']), str(enc['activeCombatantId'])) ?? null;

  const name = firstDefined(str(enc['name']), str(root['name']));
  const turn = firstDefined(int(enc['turn']), int(root['turn']));
  const pass = firstDefined(int(enc['pass']), int(root['pass']));
  const sceneId = firstDefined(str(enc['sceneId']), str(root['sceneId']));

  const out: Encounter = {
    id,
    campaignId: firstDefined(str(enc['campaignId']), str(root['campaignId'])) ?? '',
    sceneId: sceneId ?? null,
    name: name ?? 'Encounter',
    state,
    turn: Math.max(0, turn ?? 0),
    pass: Math.max(0, pass ?? 0),
    activeCombatantId,
    // Present only when the source actually carried rows: an encounter list
    // entry has none, and an empty array there would look like "0 combatants"
    // rather than "not asked" (honest empty states).
    ...(rawCombatants.length > 0 || 'combatants' in root || 'combatants' in enc
      ? { combatants }
      : {}),
  };
  // Which header fields the source actually said, so a thin delta ("this
  // fight was staged") can be folded onto the fight on screen without its
  // defaults — "Encounter", prep, turn 0 — overwriting a name and a turn the
  // delta never mentioned. Non-enumerable: it is bookkeeping, not data.
  const carried: CarriedField[] = [];
  if (name !== undefined) carried.push('name');
  if (stateRaw !== undefined) carried.push('state');
  if (turn !== undefined) carried.push('turn');
  if (pass !== undefined) carried.push('pass');
  if (sceneId !== undefined) carried.push('sceneId');
  Object.defineProperty(out, CARRIED, { value: carried, enumerable: false });
  return out;
}

type CarriedField = 'name' | 'state' | 'turn' | 'pass' | 'sceneId';
const CARRIED = Symbol('carried');

/** The header fields a normalised encounter's source actually carried, or null for a hand-built one. */
function carriedFields(e: Encounter): ReadonlySet<CarriedField> | null {
  const list = (e as unknown as Record<symbol, unknown>)[CARRIED];
  return Array.isArray(list) ? new Set(list as CarriedField[]) : null;
}

/**
 * Fold an incoming encounter onto the one already on screen.
 *
 * Several `encounter.updated` emitters send a thin delta — "this fight was
 * staged", "this fight was deleted" — with no roster in it. Overwriting with
 * such a delta empties a tracker that was correctly populated a moment ago, so
 * a delta about the SAME fight inherits the roster and the acting row it did
 * not mention. A payload that does carry combatants is authoritative and
 * replaces them wholesale, empty list included.
 */
export function mergeEncounter(prev: Encounter | null, next: Encounter | null): Encounter | null {
  if (!next) return prev;
  if (!prev || prev.id !== next.id) return next;
  if (next.combatants !== undefined) return next;
  // A delta: the roster, the acting row AND every header field it did not
  // mention come from the fight already on screen. A "staged" frame that
  // named neither the fight nor its turn used to rename it "Encounter" and
  // set a live fight back to prep until the next read.
  const carried = carriedFields(next);
  const header: Partial<Encounter> = carried
    ? {
        ...(carried.has('name') ? { name: next.name } : {}),
        ...(carried.has('state') ? { state: next.state } : {}),
        ...(carried.has('turn') ? { turn: next.turn } : {}),
        ...(carried.has('pass') ? { pass: next.pass } : {}),
        ...(carried.has('sceneId') ? { sceneId: next.sceneId } : {}),
      }
    : { name: next.name, state: next.state, turn: next.turn, pass: next.pass, sceneId: next.sceneId };
  return {
    ...prev,
    ...header,
    ...(prev.combatants !== undefined ? { combatants: prev.combatants } : {}),
    activeCombatantId: next.activeCombatantId ?? prev.activeCombatantId ?? null,
  };
}

/** True when an `encounter.updated` payload announces a deletion. */
export function isEncounterDeleted(raw: unknown): boolean {
  return rec(raw)['deleted'] === true;
}

/**
 * Which encounter the tracker should show: the running fight, else the most
 * recently prepared one, else nothing. Mirrors the server's own preference so
 * a refresh lands on the same fight the table is looking at.
 */
export function pickLiveEncounter(list: readonly Encounter[] | undefined): Encounter | null {
  if (!list || list.length === 0) return null;
  return list.find((e) => e.state === 'live') ?? list.find((e) => e.state === 'prep') ?? list[0] ?? null;
}
