/**
 * Exchange rows (migration 0014), the pure steps between states, and each
 * player's copy. No service deps: the tracker and the damage path call these
 * inside their own transactions.
 */
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  ExchangeSchema,
  type Exchange,
  type ExchangeDamage,
  type ExchangeDefense,
  type ExchangeSoak,
  type ExchangeState,
} from '@safehouse/contracts';
import { boxesAfterSoak, damageAfterHit, resolveHit } from '@safehouse/rules';
import { characters, combatants, exchanges, type Db } from '@safehouse/db';
import type { EventTx } from '../hub.js';

export type ExchangeRow = typeof exchanges.$inferSelect;
const COLUMNS = ['id', 'encounterId', 'turn', 'state', 'appliedAt', 'createdAt'] as const;
export type ExchangeBody = Omit<Exchange, (typeof COLUMNS)[number]>;

export const OPEN_STATES: ExchangeState[] = ['awaiting_defense', 'awaiting_soak', 'awaiting_apply'];

export function toExchange(row: ExchangeRow): Exchange {
  return ExchangeSchema.parse({
    ...(row.body as object),
    id: row.id,
    encounterId: row.encounterId,
    turn: row.turn,
    state: row.state,
    ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  });
}

export function bodyOf(x: Exchange): ExchangeBody {
  const body: Partial<Exchange> = { ...x };
  for (const k of COLUMNS) delete body[k];
  return body as ExchangeBody;
}

export async function openExchanges(db: Db, encounterId: string): Promise<Exchange[]> {
  const rows = await db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.encounterId, encounterId), inArray(exchanges.state, OPEN_STATES)))
    .orderBy(exchanges.createdAt);
  return rows.map(toExchange);
}

// ---------------------------------------------------------------------------
// The steps (p.173)
// ---------------------------------------------------------------------------

type Settled = 'defense' | 'netHits' | 'outcome' | 'damage' | 'soak' | 'boxes' | 'track';

function cleared(x: Exchange): Exchange {
  const out = { ...x };
  for (const k of ['defense', 'netHits', 'outcome', 'damage', 'soak', 'boxes', 'track'] as Settled[]) delete out[k];
  return out;
}

function damageOf(x: Exchange, netHits: number, armor: number): ExchangeDamage {
  const { value, type } = x.declared.dv;
  // A direct spell's boxes are its net hits, whatever the armor (p.283).
  const spell = x.attack === 'direct-spell';
  const d = damageAfterHit({
    base: { value, type, raw: `${value}${type}` },
    netHits,
    armor: spell ? 0 : armor,
    ap: spell ? 0 : x.declared.ap,
  });
  return {
    modifiedDv: d.modifiedDv,
    type: d.type,
    armor: d.armor,
    modifiedArmor: d.modifiedArmor,
    convertedToStun: d.convertedToStun,
  };
}

const trackOf = (type: 'P' | 'S') => (type === 'P' ? 'physical' : 'stun');

/** The defense is in: hit, graze or miss. A re-rolled defense starts the rest over. */
export function afterDefense(x: Exchange, defense: ExchangeDefense, armor: number): Exchange {
  const hit = resolveHit(x.attackHits ?? 0, defense.hits);
  const next: Exchange = { ...cleared(x), defense, netHits: hit.netHits, outcome: hit.outcome };
  if (hit.outcome !== 'hit') return { ...next, state: 'done' };
  const damage = damageOf(x, hit.netHits, armor);
  if (x.attack === 'direct-spell') {
    return { ...next, damage, boxes: damage.modifiedDv, track: trackOf(damage.type), state: 'awaiting_apply' };
  }
  return { ...next, damage, state: 'awaiting_soak' };
}

/** The soak is in: boxes and the monitor. No defense yet counts as unaware (p.189). */
export function afterSoak(x: Exchange, soak: ExchangeSoak, armor: number): Exchange {
  const damage = damageOf(x, Math.max(0, x.netHits ?? x.attackHits ?? 0), armor);
  const { boxes, track } = boxesAfterSoak(damage, soak.hits);
  return { ...x, damage, soak, boxes, track, state: 'awaiting_apply' };
}

// ---------------------------------------------------------------------------
// Rows inside a transaction
// ---------------------------------------------------------------------------

export async function lockExchange(tx: EventTx, id: string): Promise<{ x: Exchange; row: ExchangeRow } | null> {
  const row = (await tx.db.select().from(exchanges).where(eq(exchanges.id, id)).limit(1).for('update'))[0];
  return row ? { x: toExchange(row), row } : null;
}

export async function writeExchange(tx: EventTx, x: Exchange, appliedAt?: Date | null): Promise<Exchange> {
  const row = (
    await tx.db
      .update(exchanges)
      .set({ state: x.state, body: bodyOf(x), ...(appliedAt !== undefined ? { appliedAt } : {}) })
      .where(eq(exchanges.id, x.id))
      .returning()
  )[0]!;
  return toExchange(row);
}

/** Still open when a new Combat Turn starts: closed with the old one. */
export async function closeBeforeTurn(tx: EventTx, encounterId: string, turn: number): Promise<Exchange[]> {
  const before = await tx.db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.encounterId, encounterId), inArray(exchanges.state, OPEN_STATES), lt(exchanges.turn, turn)));
  if (before.length === 0) return [];
  await tx.db
    .update(exchanges)
    .set({ state: 'cancelled' })
    .where(inArray(exchanges.id, before.map((r) => r.id)));
  return before.map((r) => ({ ...toExchange(r), state: 'cancelled' as const }));
}

/** An undone apply: the boxes are off again, so the exchange waits for the GM. */
export async function reopenApplied(tx: EventTx, id: string): Promise<Exchange | null> {
  const row = (
    await tx.db
      .update(exchanges)
      .set({ state: 'awaiting_apply', appliedAt: null })
      .where(and(eq(exchanges.id, id), isNotNull(exchanges.appliedAt)))
      .returning()
  )[0];
  return row ? toExchange(row) : null;
}

export async function logToGm(tx: EventTx, text: string, x: Exchange): Promise<void> {
  await tx.emit({
    type: 'log.posted',
    payload: { kind: 'exchange', text, exchangeId: x.id, encounterId: x.encounterId },
    visibility: 'gm',
  });
}

// ---------------------------------------------------------------------------
// Players' copies (Principle 3)
// ---------------------------------------------------------------------------

const ATTACKER_ONLY = ['weapon', 'attackRollId', 'attackHits', 'netHits'] as const;
const TARGET_ONLY = ['defense', 'damage', 'soak', 'boxes', 'track', 'appliedAt'] as const;
const UNSEEN = 'someone unseen';

/** Their own side and the outcome; a hidden other party loses its name and id. */
export function playerCopy(x: Exchange, sides: { attacker: boolean; target: boolean }, hidden: ReadonlySet<string>): Exchange {
  const out: Exchange = { ...x };
  if (!sides.attacker) for (const k of ATTACKER_ONLY) delete out[k];
  if (!sides.target) for (const k of TARGET_ONLY) delete out[k];
  const vague = (id?: string) => id !== undefined && hidden.has(id);
  if (!sides.attacker && out.attacker && vague(out.attacker.combatantId)) out.attacker = { name: UNSEEN };
  if (!sides.target && vague(out.target.combatantId)) out.target = { name: UNSEEN };
  return out;
}

/** `owners`: combatant id → the user whose runner it is. */
export function copiesFor(
  list: readonly Exchange[],
  userId: string,
  owners: ReadonlyMap<string, string | null>,
  hidden: ReadonlySet<string>,
): Exchange[] {
  const own = (id?: string) => id !== undefined && owners.get(id) === userId;
  return list.flatMap((x) => {
    const sides = { attacker: own(x.attacker?.combatantId), target: own(x.target.combatantId) };
    return sides.attacker || sides.target ? [playerCopy(x, sides, hidden)] : [];
  });
}

/** Owner and hidden-ness of the parties' rows, read through `db` (a tx's own inside one). */
export async function partiesOf(db: Db, list: readonly Exchange[]) {
  const ids = [...new Set(list.flatMap((x) => [x.attacker?.combatantId, x.target.combatantId]))].filter(
    (id): id is string => id !== undefined,
  );
  const owners = new Map<string, string | null>();
  const hidden = new Set<string>();
  if (ids.length === 0) return { owners, hidden };
  const rows = await db
    .select({ id: combatants.id, visibility: combatants.visibility, owner: characters.ownerUserId })
    .from(combatants)
    .leftJoin(characters, and(eq(combatants.source, 'character'), eq(characters.id, combatants.sourceId)))
    .where(inArray(combatants.id, ids));
  for (const r of rows) {
    owners.set(r.id, r.owner ?? null);
    if (r.visibility !== 'public') hidden.add(r.id);
  }
  return { owners, hidden };
}

/** Each player whose runner is a party gets their copy; GM sockets see it too and use the frame instead. */
export async function announceToPlayers(tx: EventTx, list: readonly Exchange[]): Promise<void> {
  const { owners, hidden } = await partiesOf(tx.db, list);
  const users = new Set([...owners.values()].filter((u): u is string => u !== null));
  for (const userId of users) {
    for (const exchange of copiesFor(list, userId, owners, hidden)) {
      await tx.emit({
        type: 'exchange.updated',
        payload: { scope: 'player', encounterId: exchange.encounterId, exchange },
        visibility: 'gm_owner',
        ownerUserId: userId,
      });
    }
  }
}
