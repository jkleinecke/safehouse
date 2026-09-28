/**
 * Encounters + combat tracker service (M4: FR4.1–4.8) — the encounter and
 * combatant rows, the initiative-pass turn engine, status effects, and the
 * copilot's data lookups. Damage / undo / morale live in
 * `services/encounters-damage.ts`; the copilot maths in
 * `services/encounters-copilot.ts`; the row model in
 * `services/encounters-model.ts` (re-exported here so callers import once).
 *
 * Hidden combatants are filtered server-side (Principle 4 / FR4.9): the player
 * view never carries a `gm` row, not even a redacted one.
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  SceneEnvironmentSchema,
  SheetV1Schema,
  type Combatant,
  type Encounter,
  type EncounterState,
  type InitiativeEntry,
  type InitKind,
  type Modifier,
  type SheetV1,
  type StatusEffect,
  type Visibility,
} from '@safehouse/contracts';
import {
  actNowOrder,
  advancePass,
  anyActiveScores,
  applyInterrupt,
  DEFAULT_INTERRUPTS,
  delayedRows,
  environment,
  moveInOrder,
  nextActor as nextActorRules,
  seizeInitiative as seizeInitiativeRules,
  turnOrder,
  type EricAttributes,
  type SeizeInitiativeOutcome,
  type TurnOrderOptions,
} from '@safehouse/rules';
import { characters, combatants, encounters, rolls, scenes, type Db } from '@safehouse/db';
import type { EventTx, Hub } from '../hub.js';
import { httpError } from './auth.js';
import { rollDice } from './dice.js';
import {
  conditionOf,
  deriveFor,
  ericOf,
  latePenalty,
  orderOptionsOf,
  parseCopilot,
  parseEffects,
  rowsTiedOnScore,
  serializeCombatant,
  serializeEncounter,
  ZERO_MONITORS,
  type AddCombatantInput,
  type CombatantPatch,
  type CombatantRow,
  type EncounterRow,
  type InitiativeDetail,
  withTableVisibility,
} from './encounters-model.js';
import type { ChainOutcome } from './encounters-copilot.js';
import { announceToPlayers, closeBeforeTurn, logToGm, openExchanges } from './exchanges-model.js';
import { buildRecipe, entryThisTurn, recipeSource, scoreOf, withGmLine } from './initiative-recipe.js';
import { ScenesService } from './scenes.js';
import {
  recordChainRolls,
  recordCopilotRoll,
  type ChainRollTarget,
  type CopilotRollInput,
} from './encounters-rolls.js';

export * from './encounters-model.js';
export {
  chainRollInputs,
  recordChainRolls,
  recordCopilotRoll,
  type ChainRollInput,
  type ChainRollTarget,
  type CopilotRollInput,
} from './encounters-rolls.js';

/**
 * What `addCombatant` accepts. Widens the row-model input with the FR4.6/FR10.9
 * Professional Rating so a HAND-ADDED NPC measures morale against a real
 * number instead of PR 0 — `grunt.professionalRating` is the older spelling of
 * the same value and stays accepted (top-level wins when both are sent).
 */
export interface AddCombatantOptions extends Omit<AddCombatantInput, 'grunt'> {
  professionalRating?: number;
  grunt?: { size: number; professionalRating?: number; groupEdge?: number; labelPrefix?: string };
}

/** `updateCombatant` patch, plus the same hand-editable PR (FR4.8). */
export interface CombatantPatchOptions extends CombatantPatch {
  professionalRating?: number;
}

/**
 * The GM's three levers on the acting order (`POST /api/encounters/:id/order`).
 * All three move PLACES only; no score changes (the GM's decision of
 * 2026-09-28), so nobody gains or loses a pass (SR5 p.159).
 *
 *  - `move`: drag one row to `toIndex` in the order as drawn (0 is first).
 *  - `actNow`: this row acts now, in front of whoever was next. This is how a
 *    Delayed Action is used (p.161), and how the GM calls a row out of turn.
 *  - `sort: 'score'`: throw the manual order away, back to the book's order.
 */
export type OrderRequest =
  | { move: { combatantId: string; toIndex: number } }
  | { actNow: string }
  | { sort: 'score' };

/** The fight after a change to its order: the same shape the GM's frame carries. */
export interface OrderView {
  encounter: Encounter;
  combatants: Combatant[];
  activeCombatantId: string | null;
  turnOrder: string[];
}

/**
 * What one press of "Next" did (`advance`):
 *  - `next`: the acting row is done and someone else is up;
 *  - `waiting`: the acting row is done, nobody else is up, but a row is still
 *    holding a Delayed Action, so the pass waits for the GM (p.161);
 *  - `pass`: the pass is over, every score −10, and someone is still above 0;
 *  - `turn`: nobody was left, so a new Combat Turn began;
 *  - `start`: initiative was being gathered, and the turn started.
 */
export interface AdvanceResult {
  step: 'next' | 'waiting' | 'pass' | 'turn' | 'start';
  acted: Combatant | null;
  active: Combatant | null;
  encounter: Encounter;
  combatants: Combatant[];
}

/**
 * Keys a new Combat Turn takes off every row's copilot: a seize and a delay
 * last for the turn they were made in (SR5 p.160-161), and a Delayed Action in
 * use lasts for one Action Phase. Literal SQL — these are constants, never input.
 */
const CLEAR_TURN_FLAGS = sql`${combatants.copilot} - 'delayed'::text - 'seized'::text - 'delayedAction'::text - 'lateEntry'::text - 'initEntry'::text`;
/** The end of a pass, or a row marked done: the Delayed Action in use is spent. */
const CLEAR_DELAYED_ACTION = sql`${combatants.copilot} - 'delayedAction'::text`;
/** A row marked done: its phase is over, so is the count of defenses since it last acted (p.189). */
const CLEAR_ON_ACTED = sql`${combatants.copilot} - 'delayedAction'::text - 'defendedSinceAction'::text`;

/** Merge a few flags into a row's copilot in place, without a read-modify-write. */
function mergeCopilot(patch: Record<string, unknown>) {
  return sql`${combatants.copilot} || ${JSON.stringify(patch)}::jsonb`;
}

export class EncountersService {
  constructor(
    readonly db: Db,
    readonly hub: Hub,
  ) {}

  /**
   * The handle a read must use: the caller's transaction when there is one,
   * the service's own otherwise.
   *
   * Every write below now commits its row and the `encounter.updated` frames
   * announcing it in ONE transaction (`Hub.atomic`), so a failed append can no
   * longer leave the tracker showing a fight the database never recorded — or
   * hide a combatant it did. Inside an open transaction PGlite's single
   * connection makes a query on `this.db` wait forever, so every read on those
   * paths comes through here (or is hoisted out of the block entirely).
   */
  private read(tx?: EventTx): Db {
    return tx?.db ?? this.db;
  }

  // --- encounters CRUD (FR4.1) -------------------------------------------

  async getEncounter(id: string, tx?: EventTx): Promise<EncounterRow> {
    const row = (
      await this.read(tx).select().from(encounters).where(eq(encounters.id, id)).limit(1)
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown encounter');
    return row;
  }

  /** Oldest first: the newest prep fight on a scene is the one placed tokens join (`sceneFight`). */
  async listEncounters(campaignId: string): Promise<EncounterRow[]> {
    return this.db
      .select()
      .from(encounters)
      .where(eq(encounters.campaignId, campaignId))
      .orderBy(asc(encounters.createdAt));
  }

  async createEncounter(input: {
    campaignId: string;
    name: string;
    sceneId?: string | null;
    state?: EncounterState;
  }): Promise<EncounterRow> {
    if (input.sceneId) await this.assertScene(input.campaignId, input.sceneId);
    return this.hub.atomic(input.campaignId, async (tx) => {
      const row = (
        await tx.db
          .insert(encounters)
          .values({
            campaignId: input.campaignId,
            name: input.name,
            sceneId: input.sceneId ?? null,
            state: input.state ?? 'prep',
          })
          .returning()
      )[0]!;
      await this.emitUpdated(row, 'created', tx);
      return row;
    });
  }

  async updateEncounter(
    id: string,
    patch: {
      name?: string;
      sceneId?: string | null;
      state?: EncounterState;
      turn?: number;
      pass?: number;
      /** The table rolls its own initiative: a new turn opens blank (FR4.2). */
      handRolls?: boolean;
    },
  ): Promise<EncounterRow> {
    const current = await this.getEncounter(id);
    if (patch.sceneId) await this.assertScene(current.campaignId, patch.sceneId);
    return this.hub.atomic(current.campaignId, async (tx) => {
      const row = (
        await tx.db.update(encounters).set(patch).where(eq(encounters.id, id)).returning()
      )[0]!;
      if (patch.state === 'live') await this.retireOtherLive(tx, row.campaignId, row.id);
      await this.emitUpdated(row, 'updated', tx);
      return row;
    });
  }

  async deleteEncounter(id: string): Promise<void> {
    const row = await this.getEncounter(id);
    await this.hub.atomic(row.campaignId, async (tx) => {
      await tx.db.delete(encounters).where(eq(encounters.id, id));
      await tx.emit({
        type: 'encounter.updated',
        payload: { encounterId: id, deleted: true, reason: 'deleted', scope: 'gm' },
        visibility: 'gm',
      });
    });
  }

  private async assertScene(campaignId: string, sceneId: string): Promise<void> {
    const scene = (await this.db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1))[0];
    if (!scene || scene.campaignId !== campaignId) {
      throw httpError(400, 'bad_request', 'sceneId does not name a scene in this campaign');
    }
  }

  // --- combatants (FR4.1 / FR4.6 / FR4.8) --------------------------------

  async getCombatant(id: string, tx?: EventTx): Promise<CombatantRow> {
    const row = (
      await this.read(tx).select().from(combatants).where(eq(combatants.id, id)).limit(1)
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown combatant');
    return row;
  }

  async listCombatants(encounterId: string, tx?: EventTx): Promise<Combatant[]> {
    const rows = await this.read(tx)
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, encounterId));
    return rows.map(serializeCombatant);
  }

  /** One combatant as the contract shape (404 when it moved encounters). */
  async combatantIn(encounterId: string, combatantId: string): Promise<Combatant> {
    const found = (await this.listCombatants(encounterId)).find((c) => c.id === combatantId);
    if (!found) throw httpError(404, 'not_found', 'unknown combatant');
    return found;
  }

  /**
   * Add a combatant (FR4.1). `source: 'character'` links the PC's LIVE sheet:
   * nothing is copied, the row keeps only `sourceId` and the derived numbers
   * are recomputed from `characters.sheet` on every read.
   */
  async addCombatant(encounterId: string, input: AddCombatantOptions): Promise<Combatant> {
    const encounter = await this.getEncounter(encounterId);
    const source = input.source ?? 'manual';
    let name = input.name ?? '';
    let sheet = input.sheet;
    let monitors = input.monitors;
    let initBase = input.initBase;
    let initDice = input.initDice;
    let visibility: Visibility = input.visibility ?? (source === 'character' ? 'public' : 'gm');
    // A line typed for a row with a sheet wins over the sheet's (`buildRecipe`).
    const typedLine =
      (source === 'character' || input.sheet) && (input.initBase !== undefined || input.initDice !== undefined)
        ? withGmLine({}, input.initKind ?? 'physical', input.initBase, input.initDice)
        : undefined;

    if (source === 'character') {
      if (!input.sourceId) throw httpError(400, 'bad_request', 'character combatants need sourceId');
      const character = (
        await this.db.select().from(characters).where(eq(characters.id, input.sourceId)).limit(1)
      )[0];
      if (!character || character.campaignId !== encounter.campaignId) {
        throw httpError(400, 'bad_request', 'sourceId does not name a character in this campaign');
      }
      const parsed = SheetV1Schema.safeParse(character.sheet);
      if (!parsed.success) throw httpError(400, 'bad_request', 'character sheet is not a SheetV1');
      sheet = undefined; // live link — never snapshot a PC sheet onto the row
      name = name || character.name;
      const derived = deriveFor(parsed.data, input.initKind ?? 'physical');
      initBase = initBase ?? derived.base;
      initDice = initDice ?? derived.dice;
      monitors = monitors ?? derived.monitors;
      visibility = input.visibility ?? 'public';
    } else if (sheet) {
      const derived = deriveFor(sheet, input.initKind ?? 'physical');
      initBase = initBase ?? derived.base;
      initDice = initDice ?? derived.dice;
      monitors = monitors ?? derived.monitors;
    }
    if (!name) throw httpError(400, 'bad_request', 'combatant needs a name');

    // Professional Rating (FR4.6): ONE number per row, whether it arrived at the
    // top level or inside `grunt`. Every non-PC row carries it in
    // `copilot.generator` — the same place the generator writes it — so FR10.9
    // morale measures real pressure on hand-added opposition too.
    const professionalRating = Math.max(
      0,
      Math.floor(input.professionalRating ?? input.grunt?.professionalRating ?? 0),
    );
    const size = input.grunt ? Math.max(1, Math.floor(input.grunt.size)) : 0;
    const grunt = input.grunt
      ? {
          size,
          professionalRating,
          groupEdge: Math.max(0, Math.floor(input.grunt.groupEdge ?? 0)),
          members: Array.from({ length: size }, (_, i) => ({
            label: `${input.grunt?.labelPrefix ?? name} ${i + 1}`,
            filled: 0,
            down: false,
          })),
        }
      : undefined;

    // Everything above is a read or pure derivation, done before the block
    // opens; only the insert and its events are inside it (the deadlock rule).
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      const row = (
        await tx.db
          .insert(combatants)
          .values({
            encounterId,
            source,
            sourceId: input.sourceId ?? null,
            tokenId: input.tokenId ?? null,
            name,
            initBase: initBase ?? 0,
            initScore: input.initScore ?? 0,
            initKind: input.initKind ?? 'physical',
            monitors: monitors ?? ZERO_MONITORS,
            effects: [],
            visibility,
            actedThisPass: false,
            copilot: {
              initDice: initDice ?? 1,
              ...(sheet ? { sheet } : {}),
              ...(input.edge ? { edge: input.edge } : {}),
              ...(grunt ? { grunt } : {}),
              ...(input.leader ? { leader: true } : {}),
              ...(typedLine ? { initLine: typedLine } : {}),
              ...(source === 'character' ? {} : { generator: { professionalRating } }),
            },
          })
          .returning()
      )[0]!;
      await this.emitUpdated(encounter, 'combatant.added', tx);
      return serializeCombatant(row);
    });
  }

  /** Hand-edit anything mid-fight (FR4.8 / Principle 2). */
  async updateCombatant(
    id: string,
    patch: CombatantPatchOptions,
    extras: { entry?: InitiativeEntry } = {},
  ): Promise<Combatant> {
    const row = await this.getCombatant(id);
    const encounter = await this.getEncounter(row.encounterId);
    const copilot = parseCopilot(row.copilot);
    if (patch.initDice !== undefined) copilot.initDice = patch.initDice;
    // A line the GM types wins over the sheet's.
    if (patch.initBase !== undefined || patch.initDice !== undefined) {
      const kind = patch.initKind ?? serializeCombatant(row).initKind;
      copilot.initLine = withGmLine(copilot, kind, patch.initBase, patch.initDice);
    }
    if (patch.edge !== undefined) copilot.edge = patch.edge;
    if (patch.grunt !== undefined) copilot.grunt = patch.grunt;
    if (patch.leader !== undefined) copilot.leader = patch.leader;
    // A score entered settles a late entry and is this turn's entry.
    if (patch.initScore !== undefined) {
      delete copilot.lateEntry;
      copilot.initEntry = extras.entry ?? { turn: encounter.turn, via: 'score', score: patch.initScore, by: 'gm' };
    }
    if (patch.professionalRating !== undefined) {
      const pr = Math.max(0, Math.floor(patch.professionalRating));
      copilot.generator = { ...(copilot.generator ?? {}), professionalRating: pr };
      if (copilot.grunt) copilot.grunt = { ...copilot.grunt, professionalRating: pr };
    }
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      const updated = (
        await tx.db
          .update(combatants)
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.initBase !== undefined ? { initBase: patch.initBase } : {}),
            ...(patch.initScore !== undefined ? { initScore: patch.initScore } : {}),
            ...(patch.initKind !== undefined ? { initKind: patch.initKind } : {}),
            ...(patch.monitors !== undefined ? { monitors: patch.monitors } : {}),
            ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
            ...(patch.actedThisPass !== undefined ? { actedThisPass: patch.actedThisPass } : {}),
            ...(patch.tokenId !== undefined ? { tokenId: patch.tokenId } : {}),
            copilot,
          })
          .where(eq(combatants.id, id))
          .returning()
      )[0]!;
      await this.emitUpdated(encounter, 'combatant.updated', tx);
      return serializeCombatant(updated);
    });
  }

  async removeCombatant(id: string): Promise<void> {
    const row = await this.getCombatant(id);
    const encounter = await this.getEncounter(row.encounterId);
    await this.hub.atomic(encounter.campaignId, async (tx) => {
      await tx.db.delete(combatants).where(eq(combatants.id, id));
      await this.emitUpdated(encounter, 'combatant.removed', tx);
    });
  }

  // --- initiative (FR4.2) -------------------------------------------------

  /** Each row's recipe with the server's dice; on a fight not started, this starts turn 1 (FR4.3). */
  async rollInitiativeAll(
    encounterId: string,
    opts: { combatantIds?: string[]; kinds?: Record<string, InitKind>; by?: InitiativeEntry['by'] } = {},
    tx?: EventTx,
  ): Promise<{ encounter: Encounter; combatants: Combatant[]; details: InitiativeDetail[] }> {
    const encounter = await this.getEncounter(encounterId, tx);
    const list = await this.listCombatants(encounterId, tx);
    const ids = opts.combatantIds;
    const targets = ids ? list.filter((c) => ids.includes(c.id)) : list;
    const fight =
      encounter.turn < 1 || encounter.pass < 1 ? { turn: Math.max(1, encounter.turn), pass: 1 } : encounter;
    // Reads and dice before the transaction opens (the deadlock rule).
    const rolled: Array<{ detail: InitiativeDetail; sheet: boolean; entry: InitiativeEntry }> = [];
    for (const combatant of targets) {
      const kind = opts.kinds?.[combatant.id] ?? combatant.initKind;
      const src = await recipeSource(this.read(tx), combatant);
      const recipe = buildRecipe(combatant, src, fight, kind);
      const rolls = rollDice(recipe.dice);
      const total = rolls.reduce((n, r) => n + r, 0);
      const score = scoreOf(recipe, total);
      const late = latePenalty(combatant, fight);
      rolled.push({
        detail: {
          combatantId: combatant.id,
          kind,
          base: recipe.base,
          dice: recipe.dice,
          rolls,
          woundModifier: recipe.modifier - late,
          ...(late ? { latePenalty: late } : {}),
          score,
        },
        sheet: src.sheet !== null,
        entry: { turn: fight.turn, via: 'app', rolled: total, rolls, score, by: opts.by ?? 'gm' },
      });
    }
    return this.hub.atomicIn(encounter.campaignId, tx, async (itx) => {
      const details: InitiativeDetail[] = [];
      for (const r of rolled) {
        // A sheetless line already counts its effects: stored, they would count again next roll.
        const line = r.sheet ? { initDice: r.detail.dice } : {};
        await itx.db
          .update(combatants)
          .set({
            initScore: r.detail.score,
            initKind: r.detail.kind,
            ...(r.sheet ? { initBase: r.detail.base } : {}),
            actedThisPass: false,
            // A roll settles a late entry.
            copilot: sql`(${combatants.copilot} - 'lateEntry'::text) || ${JSON.stringify({ ...line, initEntry: r.entry })}::jsonb`,
          })
          .where(eq(combatants.id, r.detail.combatantId));
        details.push(r.detail);
      }
      const started =
        fight !== encounter
          ? ((
              await itx.db
                .update(encounters)
                .set({ turn: fight.turn, pass: 1 })
                .where(eq(encounters.id, encounterId))
                .returning()
            )[0] ?? encounter)
          : encounter;
      const after = await this.emitUpdated(started, 'initiative.rolled', itx);
      const order = await this.orderOptions(started, after, itx);
      return {
        // `combatants` rides beside it, so the encounter object carries only the
        // derived active id and order — never a second copy of the roster.
        encounter: {
          ...serializeEncounter(started),
          activeCombatantId: nextActorRules(after, order)?.id ?? null,
          turnOrder: turnOrder(after, order).map((c) => c.id),
        },
        combatants: after,
        details,
      };
    });
  }

  /** Hand-set a score or line (FR4.2, FR4.8): `rolled` is the table's dice, added to the recipe; `score` is final. */
  async setInitiative(
    combatantId: string,
    input: {
      score?: number;
      base?: number;
      dice?: number;
      kind?: InitKind;
      rolled?: number;
      by?: InitiativeEntry['by'];
    },
  ): Promise<Combatant> {
    const current = serializeCombatant(await this.getCombatant(combatantId));
    const encounter = await this.getEncounter(current.encounterId);
    const by = input.by ?? 'gm';
    let score = input.score;
    let entry: InitiativeEntry | undefined;
    if (input.rolled !== undefined) {
      const kind = input.kind ?? current.initKind;
      // A line edit in the same call counts toward this score.
      const edited = input.base !== undefined || input.dice !== undefined;
      const row: Combatant = edited
        ? {
            ...current,
            initBase: input.base ?? current.initBase,
            initDice: input.dice ?? current.initDice,
            copilot: { ...current.copilot, initLine: withGmLine(parseCopilot(current.copilot), kind, input.base, input.dice) },
          }
        : current;
      score = scoreOf(buildRecipe(row, await recipeSource(this.db, current), encounter, kind), input.rolled);
      entry = { turn: encounter.turn, via: 'dice', rolled: input.rolled, score, by };
    } else if (score !== undefined) {
      entry = { turn: encounter.turn, via: 'score', score, by };
    }
    return this.updateCombatant(
      combatantId,
      {
        ...(score !== undefined ? { initScore: score, actedThisPass: false } : {}),
        ...(input.base !== undefined ? { initBase: input.base } : {}),
        ...(input.dice !== undefined ? { initDice: input.dice } : {}),
        ...(input.kind !== undefined ? { initKind: input.kind } : {}),
      },
      entry ? { entry } : {},
    );
  }

  // --- turn engine (FR4.3 / FR4.4) ---------------------------------------

  /**
   * The fight's row, read and LOCKED for the rest of the caller's transaction.
   *
   * Every change to the order reads the order, decides, and writes: a manual
   * order, who is acting, whose turn is done. Two of those at once (a double
   * press of "Next", two devices) would both read the same state and both
   * act on it — and "mark X done" twice is harmless, but "end the pass" twice
   * takes 20 off every score. `FOR UPDATE` on the fight's row makes the second
   * wait for the first to commit, and then read what the first wrote.
   */
  private async lockEncounter(tx: EventTx, id: string): Promise<EncounterRow> {
    const row = (
      await tx.db.select().from(encounters).where(eq(encounters.id, id)).limit(1).for('update')
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown encounter');
    return row;
  }

  /** ERIC tie-break attributes of tied rows (`ericForRows`). */
  async ericFor(list: Combatant[], tx?: EventTx): Promise<Record<string, EricAttributes>> {
    return ericForRows(this.read(tx), list);
  }

  /** Everything `turnOrder` needs for this fight, as it stands in `list`. */
  async orderOptions(
    encounter: EncounterRow,
    list: Combatant[],
    tx?: EventTx,
  ): Promise<TurnOrderOptions> {
    return orderOptionsOf(encounter, await this.ericFor(list, tx));
  }

  /**
   * The double-press guard on "Next": the caller says who it saw acting (null
   * for nobody), and when the fight has moved on since, nothing happens. Left
   * out (`undefined`), there is no check — the older clients' behaviour.
   */
  private assertExpectedActor(acting: Combatant | null, expected: string | null | undefined): void {
    if (expected === undefined) return;
    const actual = acting?.id ?? null;
    if (actual !== expected) {
      throw httpError(
        409,
        'stale_actor',
        actual
          ? 'someone else is acting now; the order moved on since this was pressed, and nobody was skipped'
          : 'nobody is acting now; the order moved on since this was pressed, and nobody was skipped',
      );
    }
  }

  /** Mark one row's Action Phase done; a Delayed Action it was using is spent with it. */
  private async markActedIn(tx: EventTx, combatantId: string): Promise<void> {
    await tx.db
      .update(combatants)
      .set({ actedThisPass: true, copilot: CLEAR_ON_ACTED })
      .where(eq(combatants.id, combatantId));
  }

  /**
   * Mark the acting combatant done and hand back the next one up. Nothing
   * else: a spent pass stays spent until `endPass` (the REST twin of one step
   * of "Next"; `advance` is the whole button).
   *
   * `expectedActorId` is the double-press guard (see `advance`).
   */
  async nextActor(
    encounterId: string,
    opts: { expectedActorId?: string | null } = {},
    tx?: EventTx,
  ): Promise<{ acted: Combatant | null; active: Combatant | null; combatants: Combatant[] }> {
    const head = await this.getEncounter(encounterId, tx);
    return this.hub.atomicIn(head.campaignId, tx, async (itx) => {
      const encounter = await this.lockEncounter(itx, encounterId);
      const list = await this.listCombatants(encounterId, itx);
      const order = await this.orderOptions(encounter, list, itx);
      const acting = nextActorRules(list, order);
      this.assertExpectedActor(acting, opts.expectedActorId);
      if (acting) await this.markActedIn(itx, acting.id);
      const after = await this.emitUpdated(encounter, 'next-actor', itx);
      return { acted: acting, active: nextActorRules(after, order), combatants: after };
    });
  }

  /**
   * "Next ▸" — the whole FR4.3 loop behind one button, in ONE transaction:
   *
   *  0. while initiative is being gathered, it starts the turn (`startTurn`);
   *  1. the acting row is done;
   *  2. if someone else is up, that is it;
   *  3. if nobody is, but a row is still holding a Delayed Action, the pass
   *     WAITS: a delayed character may act after everyone else, as long as it
   *     is before the pass ends (SR5 p.161). The GM presses "Act now" on it,
   *     or "Next" again to move on (the delay then carries into the next pass);
   *  4. otherwise the pass ends, every score −10;
   *  5. and when nobody is left above 0, a new Combat Turn begins — rolled by
   *     the server, or, with hand rolls on, blank and gathering initiative.
   *
   * `expectedActorId` is who the pressing device saw acting (null: nobody).
   * When that is no longer so — the first of two presses already moved the
   * order on — the second does nothing and says why (409 `stale_actor`),
   * instead of marking the NEXT row done before anyone called on them. The
   * check and the change share the transaction and the lock on the fight, so
   * two devices pressing at once cannot both get through.
   */
  async advance(
    encounterId: string,
    opts: { expectedActorId?: string | null } = {},
  ): Promise<AdvanceResult> {
    const head = await this.getEncounter(encounterId);
    return this.hub.atomic(head.campaignId, async (tx) => {
      const encounter = await this.lockEncounter(tx, encounterId);
      const list = await this.listCombatants(encounterId, tx);
      const order = await this.orderOptions(encounter, list, tx);
      const acting = nextActorRules(list, order);
      this.assertExpectedActor(acting, opts.expectedActorId);
      if (encounter.gathering) {
        const started = await this.startTurn(encounterId, tx);
        return {
          step: 'start',
          acted: null,
          active: started.combatants.find((c) => c.id === started.activeCombatantId) ?? null,
          encounter: started.encounter,
          combatants: started.combatants,
        };
      }
      if (acting) {
        await this.markActedIn(tx, acting.id);
        const marked = list.map((c) => (c.id === acting.id ? { ...c, actedThisPass: true } : c));
        const next = nextActorRules(marked, order);
        if (next || delayedRows(marked, order).length > 0) {
          const after = await this.emitUpdated(encounter, 'next-actor', tx);
          return {
            step: next ? 'next' : 'waiting',
            acted: acting,
            active: next,
            encounter: serializeEncounter(encounter),
            combatants: after,
          };
        }
      }
      const passed = await this.endPass(encounterId, tx);
      if (passed.anyActive) {
        const opts2 = await this.orderOptions(passed.encounter, passed.combatants, tx);
        return {
          step: 'pass',
          acted: acting,
          active: nextActorRules(passed.combatants, opts2),
          encounter: serializeEncounter(passed.encounter),
          combatants: passed.combatants,
        };
      }
      const turned = await this.newTurn(encounterId, {}, tx);
      const opts3 = await this.orderOptions(turned.encounter, turned.combatants, tx);
      return {
        step: 'turn',
        acted: acting,
        active: nextActorRules(turned.combatants, opts3),
        encounter: serializeEncounter(turned.encounter),
        combatants: turned.combatants,
      };
    });
  }

  /**
   * End of pass: −10 to every score, `actedThisPass` cleared (FR4.3). A
   * Delayed Action in use is spent; a delay still HELD carries on into the
   * next pass (p.161), and seizes and the manual order hold for the turn.
   */
  async endPass(
    encounterId: string,
    tx?: EventTx,
  ): Promise<{ encounter: EncounterRow; combatants: Combatant[]; anyActive: boolean }> {
    const head = await this.getEncounter(encounterId, tx);
    return this.hub.atomicIn(head.campaignId, tx, async (itx) => {
      const encounter = await this.lockEncounter(itx, encounterId);
      // `advancePass` is pure — the −10 loop runs on the list read here, and
      // the writes below only record what it decided.
      const advanced = advancePass(await this.listCombatants(encounterId, itx));
      for (const c of advanced) {
        await itx.db
          .update(combatants)
          .set({ initScore: c.initScore, actedThisPass: false, copilot: CLEAR_DELAYED_ACTION })
          .where(eq(combatants.id, c.id));
      }
      const row = (
        await itx.db
          .update(encounters)
          .set({ pass: encounter.pass + 1 })
          .where(eq(encounters.id, encounterId))
          .returning()
      )[0]!;
      const after = await this.emitUpdated(row, 'end-pass', itx);
      return { encounter: row, combatants: after, anyActive: anyActiveScores(advanced) };
    });
  }

  /**
   * New combat turn: everyone re-rolls, pass resets to 1 (FR4.3).
   *
   * The turn bump and the re-roll are ONE transaction: half of this — a turn
   * counter that moved with nobody's initiative rerolled, or the reverse —
   * is a tracker the table has to unpick by hand mid-fight.
   *
   * Everything that lasts "for this Combat Turn" ends here: the GM's manual
   * order, every seize (p.160-161: "you return to your normal place ... at the
   * start of the following Combat Turn"), every delay held over (p.161), and
   * any Delayed Action in use.
   *
   * `roll` left out follows the fight's own setting: the server rolls unless
   * the fight is set to hand rolls, when the turn opens blank and gathering.
   * `first` starts a fight that is not live yet: turn 1, not turn + 1.
   */
  async newTurn(
    encounterId: string,
    opts: { roll?: boolean; first?: boolean } = {},
    tx?: EventTx,
  ): Promise<{ encounter: EncounterRow; combatants: Combatant[] }> {
    const head = await this.getEncounter(encounterId, tx);
    return this.hub.atomicIn(head.campaignId, tx, async (itx) => {
      const encounter = await this.lockEncounter(itx, encounterId);
      const roll = opts.roll ?? !encounter.handRolls;
      const turn = opts.first ? Math.max(1, encounter.turn) : encounter.turn + 1;
      const row = (
        await itx.db
          .update(encounters)
          .set({ turn, pass: 1, state: 'live', manualOrder: null, gathering: !roll })
          .where(eq(encounters.id, encounterId))
          .returning()
      )[0]!;
      await itx.db
        .update(combatants)
        .set({ copilot: CLEAR_TURN_FLAGS })
        .where(eq(combatants.encounterId, encounterId));
      const closed = await closeBeforeTurn(itx, encounterId, row.turn);
      for (const x of closed) {
        await logToGm(itx, `${x.attacker?.name ?? 'Someone'} → ${x.target.name}: closed with the Combat Turn`, x);
      }
      if (closed.length > 0) await announceToPlayers(itx, closed);
      // One fight at a time: the table, the phones and the TV all follow
      // "the live encounter", and two of them would be a coin toss.
      await this.retireOtherLive(itx, row.campaignId, row.id);
      if (!roll) {
        // Hand rolls (FR4.2): every score blank, each line refreshed from its
        // recipe (a spell cast last turn counts), the dice come in row by row.
        for (const c of await this.listCombatants(encounterId, itx)) {
          const src = await recipeSource(itx.db, c);
          // Only a sheet's line is stored: a sheetless one would count its effects again.
          const recipe = src.sheet ? buildRecipe(c, src, row) : null;
          await itx.db
            .update(combatants)
            .set({
              initScore: 0,
              actedThisPass: false,
              ...(recipe ? { initBase: recipe.base, copilot: mergeCopilot({ initDice: recipe.dice }) } : {}),
            })
            .where(eq(combatants.id, c.id));
        }
        const list = await this.emitUpdated(row, 'new-turn', itx);
        return { encounter: row, combatants: list };
      }
      const rolled = await this.rollInitiativeAll(encounterId, {}, itx);
      await this.emitUpdated(row, 'new-turn', itx);
      return { encounter: row, combatants: rolled.combatants };
    });
  }

  /** Call for initiative: turn 1, or the next turn if live; blank and gathering. A no-op while gathering. */
  async callInitiative(encounterId: string): Promise<EncounterRow> {
    const head = await this.getEncounter(encounterId);
    return this.hub.atomic(head.campaignId, async (tx) => {
      const encounter = await this.lockEncounter(tx, encounterId);
      if (encounter.gathering) return encounter;
      const first = encounter.state !== 'live';
      return (await this.newTurn(encounterId, { roll: false, first }, tx)).encounter;
    });
  }

  /** Start the turn: blank rows join late (p.160) when their score comes in. A no-op unless gathering. */
  async startTurn(encounterId: string, tx?: EventTx): Promise<OrderView & { late: string[] }> {
    const head = await this.getEncounter(encounterId, tx);
    return this.hub.atomicIn(head.campaignId, tx, async (itx) => {
      const encounter = await this.lockEncounter(itx, encounterId);
      if (!encounter.gathering) return { ...(await this.orderViewIn(itx, encounter, 'initiative.started')), late: [] };
      const blank = (await this.listCombatants(encounterId, itx)).filter((c) => !entryThisTurn(c, encounter));
      const lateEntry = { turn: encounter.turn, passesGone: Math.max(0, encounter.pass - 1) };
      for (const c of blank) {
        await itx.db.update(combatants).set({ copilot: mergeCopilot({ lateEntry }) }).where(eq(combatants.id, c.id));
      }
      const row = (
        await itx.db.update(encounters).set({ gathering: false }).where(eq(encounters.id, encounterId)).returning()
      )[0]!;
      return { ...(await this.orderViewIn(itx, row, 'initiative.started')), late: blank.map((c) => c.id) };
    });
  }

  // --- the order: manual places, delays, seizes (SR5 p.159-161) -----------

  /**
   * Move a row, call one to act now, or go back to the book's order. Place
   * only, never a score (see `OrderRequest`). GM-only at the route.
   *
   * A row with no score left (0 or less) has no place to move to: it has no
   * Action Phase this pass (p.159), so it is refused rather than parked in a
   * list it cannot act from. "Act now" on a row that already acted this pass
   * is refused too: that would be a second Action Phase in one pass, which is
   * a score change in disguise. The GM can still un-mark a row by hand.
   */
  async setOrder(encounterId: string, input: OrderRequest): Promise<OrderView> {
    const head = await this.getEncounter(encounterId);
    return this.hub.atomic(head.campaignId, async (tx) => {
      const encounter = await this.lockEncounter(tx, encounterId);
      const list = await this.listCombatants(encounterId, tx);
      const order = await this.orderOptions(encounter, list, tx);

      let manualOrder: string[] | null;
      let reason: string;
      if ('sort' in input) {
        manualOrder = null;
        reason = 'order.sorted';
      } else if ('move' in input) {
        const moved = moveInOrder(list, input.move.combatantId, input.move.toIndex, order);
        if (!moved) throw this.noPlace(list, input.move.combatantId);
        manualOrder = moved;
        reason = 'order.moved';
      } else {
        const id = input.actNow;
        const row = list.find((c) => c.id === id);
        if (row?.actedThisPass) {
          throw httpError(409, 'already_acted', `${row.name} has already acted this pass`);
        }
        const placed = actNowOrder(list, id, order);
        if (!placed || !row) throw this.noPlace(list, id);
        // A row already up needs no arrangement: leave the order as it was
        // rather than pin the book's order as a "manual" one.
        const alreadyUp = nextActorRules(list, order)?.id === id;
        manualOrder = alreadyUp ? (order.manualOrder ? [...order.manualOrder] : null) : placed;
        reason = 'order.act-now';
        if (row.delayed) {
          // Using the delay (p.161): the hold is over, and this Action Phase
          // is a Delayed Action — −1 die on what it does.
          await tx.db
            .update(combatants)
            .set({ copilot: mergeCopilot({ delayed: false, delayedAction: true }) })
            .where(eq(combatants.id, id));
        }
      }
      const updated = (
        await tx.db
          .update(encounters)
          .set({ manualOrder })
          .where(eq(encounters.id, encounterId))
          .returning()
      )[0]!;
      return this.orderViewIn(tx, updated, reason);
    });
  }

  /**
   * Hold (or stop holding) a Delayed Action (SR5 p.161). The row keeps its
   * score and its place; "Next" steps over it until the GM calls it with
   * "Act now". Only a row still to act this pass can delay: a row that has
   * acted has no Action Phase left to hold.
   *
   * The −1 die the book puts on a delayed character's actions belongs to the
   * phase in which the delay is USED, not to the declaration: it is set when
   * the GM calls the row ("Act now"), not here.
   */
  async delay(combatantId: string, delayed = true): Promise<Combatant> {
    const row = await this.getCombatant(combatantId);
    const head = await this.getEncounter(row.encounterId);
    return this.hub.atomic(head.campaignId, async (tx) => {
      const encounter = await this.lockEncounter(tx, row.encounterId);
      const list = await this.listCombatants(encounter.id, tx);
      const current = list.find((c) => c.id === combatantId);
      if (!current) throw httpError(404, 'not_found', 'unknown combatant');
      if (delayed) {
        if (current.initScore <= 0) throw this.noPlace(list, combatantId);
        if (current.actedThisPass) {
          throw httpError(409, 'already_acted', `${current.name} has already acted this pass`);
        }
      }
      const updated = (
        await tx.db
          .update(combatants)
          .set({ copilot: mergeCopilot({ delayed }) })
          .where(eq(combatants.id, combatantId))
          .returning()
      )[0]!;
      await this.emitUpdated(encounter, delayed ? 'delay' : 'delay.cancelled', tx);
      return serializeCombatant(updated);
    });
  }

  /**
   * Seize the Initiative (SR5 p.160-161) on the tracker: the row goes to the
   * top of the order for the rest of this Combat Turn, its score untouched,
   * and no Action Phase it already took is handed back. The Edge itself is
   * `EdgeActionService.seize`'s business; this is only the place.
   *
   * Refused once the row's score is spent after the first pass: it has no
   * Action Phase left this turn to go first with. In the first pass a 0 is a
   * line still blank for the table's dice, and a seize there waits for it.
   */
  async seizeInitiative(
    combatantId: string,
  ): Promise<{ combatant: Combatant; outcome: SeizeInitiativeOutcome }> {
    const row = await this.getCombatant(combatantId);
    const head = await this.getEncounter(row.encounterId);
    return this.hub.atomic(head.campaignId, async (tx) => {
      const encounter = await this.lockEncounter(tx, row.encounterId);
      const list = await this.listCombatants(encounter.id, tx);
      const current = list.find((c) => c.id === combatantId);
      if (!current) throw httpError(404, 'not_found', 'unknown combatant');
      if (current.initScore <= 0 && encounter.pass > 1) {
        throw httpError(
          409,
          'no_action_phase',
          `${current.name} has no Action Phase left this Combat Turn to go first with`,
        );
      }
      const outcome = seizeInitiativeRules(list, combatantId, await this.orderOptions(encounter, list, tx));
      const updated = (
        await tx.db
          .update(combatants)
          .set({ copilot: mergeCopilot({ seized: true }) })
          .where(eq(combatants.id, combatantId))
          .returning()
      )[0]!;
      const fight = (
        await tx.db
          .update(encounters)
          .set({ manualOrder: outcome.manualOrder })
          .where(eq(encounters.id, encounter.id))
          .returning()
      )[0]!;
      await this.emitUpdated(fight, 'seize', tx);
      return { combatant: serializeCombatant(updated), outcome };
    });
  }

  /** The refusal for a row with no place in the order. */
  private noPlace(list: Combatant[], combatantId: string): Error {
    const row = list.find((c) => c.id === combatantId);
    if (!row) return httpError(404, 'not_found', 'unknown combatant');
    return httpError(
      409,
      'no_place',
      `${row.name} has no Initiative Score above 0, so no place in the order this pass`,
    );
  }

  /** Emit the change and hand back the fight as the GM's frame shows it. */
  private async orderViewIn(tx: EventTx, encounter: EncounterRow, reason: string): Promise<OrderView> {
    const list = await this.emitUpdated(encounter, reason, tx);
    const order = await this.orderOptions(encounter, list, tx);
    return {
      encounter: serializeEncounter(encounter),
      combatants: list,
      activeCombatantId: nextActorRules(list, order)?.id ?? null,
      turnOrder: turnOrder(list, order).map((c) => c.id),
    };
  }

  /** Every other live encounter in the campaign is over (state `done`). */
  private async retireOtherLive(tx: EventTx, campaignId: string, keepId: string): Promise<void> {
    const others = await tx.db
      .update(encounters)
      .set({ state: 'done' })
      .where(and(eq(encounters.campaignId, campaignId), eq(encounters.state, 'live'), ne(encounters.id, keepId)))
      .returning();
    for (const other of others) await this.emitUpdated(other, 'updated', tx);
  }

  /** Interrupt action: deduct its Initiative Score cost immediately (FR4.4). */
  async interrupt(
    combatantId: string,
    input: { actionId?: string; cost?: number; name?: string },
  ): Promise<{ combatant: Combatant; action: { id: string; name: string; cost: number } }> {
    const row = await this.getCombatant(combatantId);
    const preset = input.actionId
      ? DEFAULT_INTERRUPTS.find((a) => a.id === input.actionId)
      : undefined;
    const cost = Math.abs(input.cost ?? preset?.cost ?? 0);
    if (cost === 0) {
      throw httpError(400, 'bad_request', 'interrupt needs a known actionId or an explicit cost');
    }
    const updated = applyInterrupt(serializeCombatant(row), cost);
    const encounter = await this.getEncounter(row.encounterId);
    await this.hub.atomic(encounter.campaignId, async (tx) => {
      await tx.db
        .update(combatants)
        .set({ initScore: updated.initScore })
        .where(eq(combatants.id, combatantId));
      await this.emitUpdated(encounter, 'interrupt', tx);
    });
    return {
      combatant: updated,
      action: { id: input.actionId ?? 'custom', name: input.name ?? preset?.name ?? 'Interrupt', cost },
    };
  }

  // --- status effects (FR4.7) --------------------------------------------

  async attachEffect(combatantId: string, effect: StatusEffect): Promise<Combatant> {
    const row = await this.getCombatant(combatantId);
    const effects = parseEffects(row.effects).filter((e) => e.id !== effect.id);
    effects.push(effect);
    return this.writeEffects(row, effects, 'effect.attached');
  }

  async detachEffect(combatantId: string, effectId: string): Promise<Combatant> {
    const row = await this.getCombatant(combatantId);
    return this.writeEffects(
      row,
      parseEffects(row.effects).filter((e) => e.id !== effectId),
      'effect.detached',
    );
  }

  async setEffects(combatantId: string, effects: StatusEffect[]): Promise<Combatant> {
    const row = await this.getCombatant(combatantId);
    const had = parseEffects(row.effects).length;
    return this.writeEffects(row, effects, effects.length < had ? 'effect.detached' : 'effect.attached');
  }

  private async writeEffects(
    row: CombatantRow,
    effects: StatusEffect[],
    reason: string,
  ): Promise<Combatant> {
    const encounter = await this.getEncounter(row.encounterId);
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      const updated = (
        await tx.db
          .update(combatants)
          .set({ effects })
          .where(eq(combatants.id, row.id))
          .returning()
      )[0]!;
      await this.emitUpdated(encounter, reason, tx);
      return serializeCombatant(updated);
    });
  }

  // --- copilot support ----------------------------------------------------

  /** The playable sheet behind a combatant: PCs link live, NPCs carry theirs. */
  async sheetFor(combatant: Combatant, tx?: EventTx): Promise<SheetV1 | null> {
    if (combatant.source === 'character' && combatant.sourceId) {
      const character = (
        await this.read(tx)
          .select()
          .from(characters)
          .where(eq(characters.id, combatant.sourceId))
          .limit(1)
      )[0];
      if (!character) return null;
      const parsed = SheetV1Schema.safeParse(character.sheet);
      return parsed.success ? parsed.data : null;
    }
    return parseCopilot(combatant.copilot).sheet ?? null;
  }

  /** Scene environment as engine modifiers (FR9.11), empty when unlinked. */
  async sceneModifiers(encounter: EncounterRow): Promise<Modifier[]> {
    if (!encounter.sceneId) return [];
    const scene = (
      await this.db.select().from(scenes).where(eq(scenes.id, encounter.sceneId)).limit(1)
    )[0];
    if (!scene) return [];
    const env = SceneEnvironmentSchema.safeParse(scene.environment ?? {});
    return env.success ? environment(env.data) : [];
  }

  /** Owner user id per combatant (character rows only) — drives FR4.9. */
  async ownersFor(list: Combatant[]): Promise<Map<string, string | null>> {
    const owners = new Map<string, string | null>();
    const ids = list
      .filter((c) => c.source === 'character' && c.sourceId)
      .map((c) => c.sourceId as string);
    if (ids.length === 0) return owners;
    const rows = await this.db
      .select({ id: characters.id, ownerUserId: characters.ownerUserId })
      .from(characters)
      .where(inArray(characters.id, ids));
    const byCharacter = new Map(rows.map((r) => [r.id, r.ownerUserId]));
    for (const c of list) {
      if (c.source === 'character' && c.sourceId) {
        owners.set(c.id, byCharacter.get(c.sourceId) ?? null);
      }
    }
    return owners;
  }

  /**
   * Persist one copilot roll to the immutable log (G5) and announce it —
   * session-stamped, so it counts in the session's own record (FR6.1). The
   * write itself lives in `services/encounters-rolls.ts`.
   */
  async recordRoll(input: CopilotRollInput, tx?: EventTx): Promise<{ rollId: string }> {
    return recordCopilotRoll(this.db, this.hub, input, tx);
  }

  /**
   * Persist the dice an FR10.8 chain threw (attack / defence / soak) as GM-only
   * rows linked by one `chainId`. Damage still lands only on commit.
   */
  async recordChainRolls(input: {
    campaignId: string;
    encounterId: string;
    attacker: ChainRollTarget;
    defender: ChainRollTarget;
    weaponName: string;
    outcome: ChainOutcome;
  }): Promise<{ chainId: string; rolls: Array<{ step: string; rollId: string }> }> {
    return recordChainRolls(this.db, this.hub, input);
  }

  // --- emission -----------------------------------------------------------

  /** The fight's two frames (`emitFightFrames`), in the caller's transaction or one of their own. */
  async emitUpdated(
    encounter: EncounterRow,
    reason: string,
    tx?: EventTx,
  ): Promise<Combatant[]> {
    return this.hub.atomicIn(encounter.campaignId, tx, async (itx) => emitFightFrames(itx, encounter, reason));
  }

  async emitUpdatedById(encounterId: string, reason: string, tx?: EventTx): Promise<void> {
    await this.emitUpdated(await this.getEncounter(encounterId, tx), reason, tx);
  }
}

/** ERIC tie-break attributes (p.159) of rows sharing a score: the sheet's, else the Edge pool. */
export async function ericForRows(db: Db, list: Combatant[]): Promise<Record<string, EricAttributes>> {
  const tied = rowsTiedOnScore(list);
  if (tied.length === 0) return {};
  const characterIds = tied
    .filter((c) => c.source === 'character' && c.sourceId)
    .map((c) => c.sourceId as string);
  const sheets = new Map<string, SheetV1>();
  if (characterIds.length > 0) {
    const rows = await db
      .select({ id: characters.id, sheet: characters.sheet })
      .from(characters)
      .where(inArray(characters.id, characterIds));
    for (const r of rows) {
      const parsed = SheetV1Schema.safeParse(r.sheet);
      if (parsed.success) sheets.set(r.id, parsed.data);
    }
  }
  const out: Record<string, EricAttributes> = {};
  for (const c of tied) {
    const sheet =
      c.source === 'character' && c.sourceId ? sheets.get(c.sourceId) : parseCopilot(c.copilot).sheet;
    if (sheet) out[c.id] = ericOf(sheet);
    else if (c.edge) out[c.id] = { edg: c.edge.max };
  }
  return out;
}

/**
 * `encounter.updated` at `gm` and at `public`, in the caller's transaction. Token
 * rows are public only while on the table; a hidden row acting shows as `gmTurn`.
 */
export async function emitFightFrames(tx: EventTx, encounter: EncounterRow, reason: string): Promise<Combatant[]> {
  const rows = (await tx.db.select().from(combatants).where(eq(combatants.encounterId, encounter.id))).map(
    serializeCombatant,
  );
  const onTable = await new ScenesService(tx.db).tokensOnTable(rows.flatMap((c) => (c.tokenId ? [c.tokenId] : [])));
  const list = withTableVisibility(rows, onTable);
  // ONE order over the whole fight; the public frame gets it cut down, never re-sorted.
  const opts = orderOptionsOf(encounter, await ericForRows(tx.db, list));
  const order = turnOrder(list, opts).map((c) => c.id);
  const active = nextActorRules(list, opts)?.id ?? null;
  await tx.emit({
    type: 'encounter.updated',
    payload: {
      encounterId: encounter.id,
      scope: 'gm',
      reason,
      encounter: serializeEncounter(encounter),
      combatants: list,
      activeCombatantId: active,
      turnOrder: order,
      exchanges: await openExchanges(tx.db, encounter.id),
    },
    visibility: 'gm',
  });
  const visible = list.filter((c) => c.visibility === 'public');
  const visibleIds = new Set(visible.map((c) => c.id));
  await tx.emit({
    type: 'encounter.updated',
    payload: {
      encounterId: encounter.id,
      scope: 'public',
      reason,
      // The manual order names only rows the table may see (FR4.9).
      encounter: serializeEncounter(encounter, visibleIds),
      combatants: visible.map((c) => ({
        id: c.id,
        name: c.name,
        source: c.source,
        initScore: c.initScore,
        initKind: c.initKind,
        actedThisPass: c.actedThisPass,
        ...(c.delayed ? { delayed: true } : {}),
        ...(c.seized ? { seized: true } : {}),
        // The party's dice lines travel with the frame (FR4.2); an NPC's stays the GM's.
        ...(c.source === 'character' ? { initBase: c.initBase, initDice: c.initDice } : {}),
        condition: conditionOf(c.monitors),
      })),
      activeCombatantId: active !== null && visibleIds.has(active) ? active : null,
      ...(active !== null && !visibleIds.has(active) ? { gmTurn: true } : {}),
      turnOrder: order.filter((id) => visibleIds.has(id)),
    },
    visibility: 'public',
  });
  return list;
}
