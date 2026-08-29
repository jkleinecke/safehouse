/**
 * The Edge actions that are not extra dice (FR2.3, FR4.4): Seize the
 * Initiative, Blitz, Close Call. Push the Limit and Second Chance ride on the
 * roll itself and live in `services/rolls.ts`.
 *
 * Shape of every action here:
 *   authorize → engine decides (pure, `@safehouse/rules`) → the point of Edge
 *   is debited from whichever ledger the actor has (a PC's sheet, an NPC's
 *   copilot Edge) → the tracker is updated so initiative ORDERING moves with
 *   the spend → one loud `log.posted` line naming the action, the actor and
 *   the Edge left (FR2.3: "Edge spend decrements the character's current Edge
 *   with a log entry").
 *
 * Close Call never edits the roll row. A rolled record is immutable (G5), so
 * the negation lands as its own log event carrying `rollId` — the receipt of
 * the spend, not a rewrite of history.
 *
 * The tracker arrives as a narrow port (`InitiativeTracker`), structurally
 * satisfied by `EncountersService`. That keeps this file free of a runtime
 * import of the encounters domain (which already imports this one's sibling
 * for `activeSessionId`) and lets tests drive it with a fake.
 */
import type { Combatant, Glitch, RollResult, Visibility } from '@safehouse/contracts';
import type { Db } from '@safehouse/db';
import {
  BLITZ_INITIATIVE_DICE,
  blitzInitiative,
  closeCall,
  computeWoundModifier,
  EDGE_ACTION_LABELS,
  seizeInitiative,
  type BlitzOutcome,
  type SeizeInitiativeOutcome,
} from '@safehouse/rules';
import type { Hub } from '../hub.js';
import { httpError } from './auth.js';
import { applyEdgeOp } from './character-play.js';
import { loadCharacter, saveCharacter, type CharacterRecord } from './characters.js';
import type { RollRecord, RollViewer } from './roll-log.js';
import type { RollService } from './rolls.js';

/** The slice of the combat tracker the Edge actions need. */
export interface InitiativeTracker {
  getCombatant(id: string): Promise<{ id: string; encounterId: string }>;
  getEncounter(id: string): Promise<{ id: string; campaignId: string }>;
  listCombatants(encounterId: string): Promise<Combatant[]>;
  updateCombatant(
    id: string,
    patch: {
      initScore?: number;
      actedThisPass?: boolean;
      edge?: { max: number; current: number };
    },
  ): Promise<Combatant>;
}

export interface EdgeState {
  max: number;
  current: number;
}

export interface SeizeResult {
  action: 'seize_initiative';
  combatant: Combatant;
  outcome: SeizeInitiativeOutcome;
  edge: EdgeState;
}

export interface BlitzResult {
  action: 'blitz';
  combatant: Combatant;
  outcome: BlitzOutcome;
  edge: EdgeState;
}

export interface CloseCallResult {
  action: 'close_call';
  rollId: string;
  /** The glitch that was bought off. */
  negated: Glitch;
  /** The roll as it now stands at the table (the stored row is untouched). */
  result: RollResult;
  edge: EdgeState;
}

/** Who pays: a PC's sheet, or an NPC combatant's own Edge pool. */
type Payer =
  | { kind: 'character'; rec: CharacterRecord }
  | { kind: 'combatant'; combatant: Combatant };

export class EdgeActionService {
  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly tracker: InitiativeTracker,
    private readonly rolls: RollService,
  ) {}

  /**
   * Seize the Initiative (FR2.3/FR4.4): a point of Edge puts the actor at the
   * head of the current pass and un-marks them as having acted.
   */
  async seize(opts: {
    campaignId: string;
    viewer: RollViewer;
    combatantId: string;
  }): Promise<SeizeResult> {
    const { combatant, list } = await this.scopeCombatant(opts.campaignId, opts.combatantId);
    const payer = await this.payerFor(combatant);
    this.assertMaySpend(opts.viewer, payer);

    // Balance first, tracker second, debit last: a refused spend never moves
    // anyone in the order, and a failed tracker write never costs a point.
    this.assertCanPay(payer);
    const outcome = seizeInitiative(
      combatant.initScore,
      list.filter((c) => c.id !== combatant.id).map((c) => c.initScore),
    );
    const moved = await this.tracker.updateCombatant(combatant.id, {
      initScore: outcome.to,
      actedThisPass: false,
    });
    const paid = await this.debit(opts.campaignId, payer);
    const { edge } = paid;
    const updated = paid.combatant ?? moved;
    await this.announce(opts, payer, 'seize_initiative', {
      detail:
        outcome.beat === null
          ? `initiative ${outcome.from} → ${outcome.to}`
          : `initiative ${outcome.from} → ${outcome.to}, ahead of ${outcome.beat}`,
      edge,
      extra: { combatantId: combatant.id, initScore: outcome.to, from: outcome.from },
    });
    return { action: 'seize_initiative', combatant: updated, outcome, edge };
  }

  /**
   * Blitz (FR2.3/FR4.4): a point of Edge re-rolls initiative with the maximum
   * 5d6. Dice come from the roll service's entropy source, so production is
   * always the CSPRNG and a test's seeded rng reaches here too (G5).
   */
  async blitz(opts: {
    campaignId: string;
    viewer: RollViewer;
    combatantId: string;
  }): Promise<BlitzResult> {
    const { combatant } = await this.scopeCombatant(opts.campaignId, opts.combatantId);
    const payer = await this.payerFor(combatant);
    this.assertMaySpend(opts.viewer, payer);

    this.assertCanPay(payer); // no dice are thrown for a spend that cannot pay
    const outcome = blitzInitiative(
      {
        base: combatant.initBase,
        dice: combatant.initDice,
        woundModifier: computeWoundModifier(combatant.monitors),
      },
      () => this.rolls.nextRandom(),
    );
    const moved = await this.tracker.updateCombatant(combatant.id, {
      initScore: outcome.score,
      actedThisPass: false,
    });
    const paid = await this.debit(opts.campaignId, payer);
    const { edge } = paid;
    const updated = paid.combatant ?? moved;
    await this.announce(opts, payer, 'blitz', {
      detail: `${BLITZ_INITIATIVE_DICE}d6 [${outcome.rolls.join(', ')}] → initiative ${outcome.score}`,
      edge,
      extra: { combatantId: combatant.id, initScore: outcome.score, rolls: outcome.rolls },
    });
    return { action: 'blitz', combatant: updated, outcome, edge };
  }

  /**
   * Close Call (FR2.3): a point of Edge negates a glitch after the fact. The
   * `rolls` row is NEVER edited — the spend is appended as its own log line
   * carrying `rollId`, which is what an append-only record means (G5).
   */
  async closeCall(opts: {
    campaignId: string;
    viewer: RollViewer;
    rollId: string;
    combatantId?: string;
  }): Promise<CloseCallResult> {
    const roll = await this.rolls.getRoll(opts.campaignId, opts.viewer, opts.rollId);
    if (!roll) throw httpError(404, 'not_found', 'unknown roll');
    const outcome = closeCall(toResult(roll));
    if (!outcome.applied) {
      throw httpError(400, 'no_glitch', 'that roll did not glitch — nothing to negate');
    }

    const payer = await this.payerForRoll(opts.campaignId, roll, opts.combatantId);
    this.assertMaySpend(opts.viewer, payer);
    const { edge } = await this.debit(opts.campaignId, payer);
    // The log line is as visible as the roll it answers — a Close Call on a
    // roll behind the screen must not announce itself to the table.
    await this.announce(opts, payer, 'close_call', {
      detail: `${outcome.negated === 'critical' ? 'critical glitch' : 'glitch'} negated`,
      edge,
      visibility: roll.visibility,
      ownerUserId: payer.kind === 'character' ? payer.rec.ownerUserId : null,
      extra: { rollId: roll.id, negated: outcome.negated },
    });
    return {
      action: 'close_call',
      rollId: roll.id,
      negated: outcome.negated,
      result: outcome.result,
      edge,
    };
  }

  // --- internals ---------------------------------------------------------

  /** Combatant + its pass, checked against the caller's campaign. */
  private async scopeCombatant(
    campaignId: string,
    combatantId: string,
  ): Promise<{ combatant: Combatant; list: Combatant[] }> {
    const row = await this.tracker.getCombatant(combatantId);
    const encounter = await this.tracker.getEncounter(row.encounterId);
    if (encounter.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown combatant');
    }
    const list = await this.tracker.listCombatants(row.encounterId);
    const combatant = list.find((c) => c.id === combatantId);
    if (!combatant) throw httpError(404, 'not_found', 'unknown combatant');
    return { combatant, list };
  }

  /** A character-backed combatant pays from its sheet; anyone else from copilot Edge. */
  private async payerFor(combatant: Combatant): Promise<Payer> {
    if (combatant.source === 'character' && combatant.sourceId) {
      const rec = await loadCharacter(this.db, combatant.sourceId);
      if (rec) return { kind: 'character', rec };
    }
    return { kind: 'combatant', combatant };
  }

  /** Close Call: the roll names its actor; a GM may point at a combatant instead. */
  private async payerForRoll(
    campaignId: string,
    roll: RollRecord,
    combatantId: string | undefined,
  ): Promise<Payer> {
    const characterId = roll.actor.characterId;
    if (characterId) {
      const rec = await loadCharacter(this.db, characterId);
      if (!rec || rec.campaignId !== campaignId) {
        throw httpError(404, 'not_found', 'unknown character');
      }
      return { kind: 'character', rec };
    }
    const id = combatantId ?? roll.actor.combatantId;
    if (id) {
      const { combatant } = await this.scopeCombatant(campaignId, id);
      return this.payerFor(combatant);
    }
    throw httpError(400, 'no_actor', 'that roll has no Edge pool to spend from');
  }

  /** §13: the GM spends anyone's Edge; a player only their own character's. */
  private assertMaySpend(viewer: RollViewer, payer: Payer): void {
    if (viewer.role === 'gm') return;
    if (viewer.role !== 'player') {
      throw httpError(403, 'forbidden', 'only the GM and players spend Edge');
    }
    if (payer.kind !== 'character' || payer.rec.ownerUserId !== viewer.userId) {
      throw httpError(403, 'forbidden', 'only the owner or the GM may spend this Edge');
    }
  }

  /**
   * The balance check, run BEFORE anything is written: an actor with no Edge
   * left must not move in the tracker on the way to being refused.
   */
  private assertCanPay(payer: Payer): void {
    const current =
      payer.kind === 'character'
        ? payer.rec.sheet.attributes.edg.current
        : (payer.combatant.edge?.current ?? 0);
    if (current < 1) throw httpError(400, 'no_edge', 'no Edge left to spend');
  }

  /**
   * Debit one point, from the sheet (reusing the characters service's own
   * arithmetic and writer, so live-play state rides along untouched) or from
   * the combatant's copilot Edge.
   */
  private async debit(
    campaignId: string,
    payer: Payer,
  ): Promise<{ edge: EdgeState; combatant?: Combatant }> {
    this.assertCanPay(payer);
    if (payer.kind === 'character') {
      const rec = payer.rec;
      // Pure arithmetic, hoisted OUT of the block: nothing inside may touch
      // `this.db` while the transaction holds PGlite's single connection.
      const change = applyEdgeOp(rec.sheet, rec.play, { op: 'spend', amount: 1 }, rec.name);
      // The debited sheet and the announcement share one fate. Split, the bad
      // half is silent: the point is gone from the row and every open sheet —
      // the player's own phone included — still shows it until a reload, so it
      // gets spent twice (LIVE-4's shape, on a resource that does not grow back).
      await this.hub.atomic(campaignId, async (tx) => {
        await saveCharacter(tx.db, rec.id, { sheet: change.sheet, play: change.play });
        await tx.emit({
          type: 'sheet.updated',
          payload: { characterId: rec.id, cause: 'edge.spent', edge: change.edge },
          visibility: 'public',
        });
      });
      return { edge: change.edge };
    }
    const edge = payer.combatant.edge!;
    const next = { max: edge.max, current: edge.current - 1 };
    const combatant = await this.tracker.updateCombatant(payer.combatant.id, { edge: next });
    return { edge: next, combatant };
  }

  /** The loud part (FR2.3): one log line per spend, naming what it bought. */
  private async announce(
    opts: { campaignId: string; viewer: RollViewer },
    payer: Payer,
    action: 'seize_initiative' | 'blitz' | 'close_call',
    detail: {
      detail: string;
      edge: EdgeState;
      visibility?: Visibility;
      ownerUserId?: string | null;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    const who = payer.kind === 'character' ? payer.rec.name : payer.combatant.name;
    await this.rolls.postLog({
      campaignId: opts.campaignId,
      kind: 'edge',
      text: `${who} spends 1 Edge — ${EDGE_ACTION_LABELS[action]}: ${detail.detail} (${detail.edge.current}/${detail.edge.max} left)`,
      visibility: detail.visibility ?? 'public',
      ownerUserId: detail.ownerUserId ?? null,
      by: { userId: opts.viewer.userId },
      extra: { edgeAction: action, edge: detail.edge, ...(detail.extra ?? {}) },
    });
  }
}

/** The stored row's dice, as the engine's RollResult. */
function toResult(roll: RollRecord): RollResult {
  return {
    faces: roll.faces,
    hits: roll.hits,
    ones: roll.ones,
    glitch: roll.glitch,
    limitedHits: roll.limitedHits,
  };
}
