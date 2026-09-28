/**
 * Attack exchanges (SR5 p.173): opened by an attack's settle or by the GM's
 * hand, answered by a defense and a soak, put on the monitor by the GM. Nothing
 * here applies damage or moves the tracker on its own.
 */
import { eq } from 'drizzle-orm';
import type {
  DeclaredBy,
  Exchange,
  ExchangeApplyRequest,
  ExchangeDefense,
  ExchangeOpenRequest,
  ExchangeSoak,
  Role,
} from '@safehouse/contracts';
import { exchanges, type Db } from '@safehouse/db';
import type { EventTx, Hub } from '../hub.js';
import { httpError } from './auth.js';
import type { EncountersService } from './encounters.js';
import type { CombatDamageService } from './encounters-damage.js';
import {
  afterDefense,
  afterSoak,
  announceToPlayers,
  copiesFor,
  lockExchange,
  logToGm,
  partiesOf,
  toExchange,
  writeExchange,
  type ExchangeBody,
} from './exchanges-model.js';
import type { LoadedActor } from './roll-cards-load.js';

export interface ExchangeDeps {
  db: Db;
  hub: Hub;
  encounters: EncountersService;
  damage: CombatDamageService;
}

export interface OpenInput {
  campaignId: string;
  encounterId: string;
  turn: number;
  targetId: string;
  body: ExchangeBody;
}

/** Thrown inside a transaction to roll it back when a second apply lost the race. */
class AlreadyApplied extends Error {}

const STATE_WORDS: Record<Exchange['state'], string> = {
  awaiting_defense: 'awaiting defense',
  awaiting_soak: 'awaiting soak',
  awaiting_apply: 'awaiting apply',
  done: 'done',
  cancelled: 'cancelled',
};

const who = (x: Exchange) => `${x.attacker?.name ?? 'Someone'} → ${x.target.name}`;
const signed = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

export class ExchangesService {
  constructor(private readonly deps: ExchangeDeps) {}

  async load(id: string): Promise<{ x: Exchange; campaignId: string; targetId: string }> {
    const row = (await this.deps.db.select().from(exchanges).where(eq(exchanges.id, id)).limit(1))[0];
    if (!row) throw httpError(404, 'not_found', 'unknown exchange');
    return { x: toExchange(row), campaignId: row.campaignId, targetId: row.targetId };
  }

  /** The GM's copy, or a player's own side; null when it is none of theirs. */
  async copyFor(viewer: { userId: string; role: Role }, x: Exchange): Promise<Exchange | null> {
    if (viewer.role === 'gm') return x;
    const { owners, hidden } = await partiesOf(this.deps.db, [x]);
    return copiesFor([x], viewer.userId, owners, hidden)[0] ?? null;
  }

  /** Frames for the GM (the fight's) and each player's own copy. */
  private async announce(tx: EventTx, x: Exchange, reason: string): Promise<void> {
    const encounter = await this.deps.encounters.getEncounter(x.encounterId, tx);
    await this.deps.encounters.emitUpdated(encounter, reason, tx);
    await announceToPlayers(tx, [x]);
  }

  private async locked(tx: EventTx, id: string): Promise<Exchange> {
    const found = await lockExchange(tx, id);
    if (!found) throw httpError(404, 'not_found', 'unknown exchange');
    const { x } = found;
    if (x.state === 'cancelled') throw httpError(409, 'exchange_closed', `${who(x)} was cancelled`);
    if (x.appliedAt) throw httpError(409, 'exchange_applied', `${who(x)} is already on the monitor; undo it first`);
    return x;
  }

  async openIn(tx: EventTx, input: OpenInput): Promise<Exchange> {
    const row = (
      await tx.db
        .insert(exchanges)
        .values({
          campaignId: input.campaignId,
          encounterId: input.encounterId,
          targetId: input.targetId,
          turn: input.turn,
          state: 'awaiting_defense',
          body: input.body,
        })
        .returning()
    )[0]!;
    const x = toExchange(row);
    await this.announce(tx, x, 'exchange.opened');
    return x;
  }

  /** Tabletop: the GM types the attack's hits and facts, no app roll. */
  async openByHand(req: ExchangeOpenRequest, target: LoadedActor, attacker: LoadedActor | null): Promise<Exchange> {
    const row = target.row;
    if (!row) throw httpError(409, 'not_in_fight', `${target.body.actor.name} has no row on the tracker`);
    const by: DeclaredBy = req.by ?? { role: 'gm', name: 'GM' };
    const attackerParty = attacker
      ? { ...(attacker.row ? { combatantId: attacker.row.combatantId } : {}), name: attacker.body.actor.name }
      : req.attackerName
        ? { name: req.attackerName }
        : undefined;
    const body: ExchangeBody = {
      ...(req.actionId ? { actionId: req.actionId } : {}),
      attack: req.attack,
      ...(attackerParty ? { attacker: attackerParty } : {}),
      target: { combatantId: row.combatantId, name: target.body.actor.name },
      ...(req.weapon ? { weapon: { name: req.weapon } } : {}),
      declared: {
        dv: req.dv,
        ap: req.ap,
        defenseModifier: req.defenseModifier,
        extras: req.extras,
        ...(req.note ? { note: req.note } : {}),
        by,
      },
      attackRollId: null,
      attackHits: req.hits,
    };
    return this.deps.hub.atomic(target.campaignId, async (tx) => {
      const x = await this.openIn(tx, {
        campaignId: target.campaignId,
        encounterId: row.encounterId,
        turn: row.turn,
        targetId: row.combatantId,
        body,
      });
      const { dv, ap } = x.declared;
      await logToGm(tx, `${who(x)}: ${req.hits} hits at the table, ${dv.value}${dv.type} AP ${signed(ap)}`, x);
      return x;
    });
  }

  async defendIn(tx: EventTx, id: string, defense: ExchangeDefense, armor: number): Promise<Exchange> {
    const x = await writeExchange(tx, afterDefense(await this.locked(tx, id), defense, armor));
    const word = x.outcome === 'hit' ? 'hit' : x.outcome === 'graze' ? 'grazed' : 'missed';
    await logToGm(tx, `${who(x)}: ${word} (${x.attackHits ?? 0} vs ${defense.hits})`, x);
    await this.announce(tx, x, 'exchange.defended');
    return x;
  }

  async soakIn(tx: EventTx, id: string, soak: ExchangeSoak, armor: number): Promise<Exchange> {
    const x = await writeExchange(tx, afterSoak(await this.locked(tx, id), soak, armor));
    await this.announce(tx, x, 'exchange.soaked');
    return x;
  }

  /** Boxes onto the monitor through the damage path (undoable there). A second apply returns the first. */
  async apply(id: string, req: ExchangeApplyRequest): Promise<Exchange> {
    const { x, campaignId, targetId } = await this.load(id);
    if (x.appliedAt) return x;
    if (x.state === 'cancelled') throw httpError(409, 'exchange_closed', `${who(x)} was cancelled`);
    const boxes = req.boxes ?? x.boxes;
    const track = req.track ?? x.track ?? 'physical';
    if (boxes === undefined) throw httpError(409, 'not_ready', 'no boxes yet: settle the soak, or send boxes');
    let out: Exchange | undefined;
    const mark = async (tx: EventTx) => {
      const found = await lockExchange(tx, id);
      if (!found || found.x.appliedAt || found.x.state === 'cancelled') throw new AlreadyApplied();
      out = await writeExchange(tx, { ...found.x, boxes, track, state: 'done' }, new Date());
      await announceToPlayers(tx, [out]);
    };
    try {
      if (boxes === 0) {
        await this.deps.hub.atomic(campaignId, async (tx) => {
          await mark(tx);
          const encounter = await this.deps.encounters.getEncounter(x.encounterId, tx);
          await this.deps.encounters.emitUpdated(encounter, 'exchange.applied', tx);
        });
      } else {
        await this.deps.damage.applyDamage(
          {
            encounterId: x.encounterId,
            targetId,
            boxes,
            track,
            ...(req.memberIndex !== undefined ? { memberIndex: req.memberIndex } : {}),
            note: who(x),
          },
          { exchangeId: id, alsoInTx: mark },
        );
      }
    } catch (err) {
      if (err instanceof AlreadyApplied) return (await this.load(id)).x;
      throw err;
    }
    return out!;
  }

  async cancel(id: string): Promise<Exchange> {
    const { x, campaignId } = await this.load(id);
    if (x.state === 'cancelled') return x;
    return this.deps.hub.atomic(campaignId, async (tx) => {
      const current = await this.locked(tx, id);
      const next = await writeExchange(tx, { ...current, state: 'cancelled' });
      await logToGm(tx, `${who(next)}: cancelled (was ${STATE_WORDS[current.state]})`, next);
      await this.announce(tx, next, 'exchange.cancelled');
      return next;
    });
  }

  /** Only while this exchange is the target's last damage; the damage path reopens it. */
  async undo(id: string): Promise<Exchange> {
    const { x, targetId } = await this.load(id);
    if (!x.appliedAt) throw httpError(409, 'not_applied', `${who(x)} is not on the monitor`);
    const last = await this.deps.damage.lastDamageExchange(targetId);
    if (last !== id) throw httpError(409, 'not_last', `later damage on ${x.target.name} came after this; undo that first`);
    await this.deps.damage.undoDamage(targetId);
    return (await this.load(id)).x;
  }
}
