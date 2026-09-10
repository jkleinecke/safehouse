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
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  SceneEnvironmentSchema,
  SheetV1Schema,
  type Combatant,
  type Encounter,
  type EncounterState,
  type InitKind,
  type Modifier,
  type SheetV1,
  type StatusEffect,
  type Visibility,
} from '@safehouse/contracts';
import {
  advancePass,
  anyActiveScores,
  applyInterrupt,
  computeWoundModifier,
  DEFAULT_INTERRUPTS,
  environment,
  nextActor as nextActorRules,
  rollInitiative,
  turnOrder,
} from '@safehouse/rules';
import { characters, combatants, encounters, rolls, scenes, type Db } from '@safehouse/db';
import type { EventTx, Hub } from '../hub.js';
import { httpError } from './auth.js';
import { rng } from './dice.js';
import {
  conditionOf,
  deriveFor,
  parseCopilot,
  parseEffects,
  serializeCombatant,
  serializeEncounter,
  ZERO_MONITORS,
  type AddCombatantInput,
  type CombatantPatch,
  type CombatantRow,
  type EncounterRow,
  type InitiativeDetail,
} from './encounters-model.js';
import type { ChainOutcome } from './encounters-copilot.js';
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

  async listEncounters(campaignId: string): Promise<EncounterRow[]> {
    return this.db.select().from(encounters).where(eq(encounters.campaignId, campaignId));
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
  async updateCombatant(id: string, patch: CombatantPatchOptions): Promise<Combatant> {
    const row = await this.getCombatant(id);
    const copilot = parseCopilot(row.copilot);
    if (patch.initDice !== undefined) copilot.initDice = patch.initDice;
    if (patch.edge !== undefined) copilot.edge = patch.edge;
    if (patch.grunt !== undefined) copilot.grunt = patch.grunt;
    if (patch.leader !== undefined) copilot.leader = patch.leader;
    if (patch.professionalRating !== undefined) {
      const pr = Math.max(0, Math.floor(patch.professionalRating));
      copilot.generator = { ...(copilot.generator ?? {}), professionalRating: pr };
      if (copilot.grunt) copilot.grunt = { ...copilot.grunt, professionalRating: pr };
    }
    const encounter = await this.getEncounter(row.encounterId);
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

  /**
   * Roll initiative for every combatant (or a subset): base + Nd6 through the
   * CSPRNG dice service, wound modifiers applied to the score.
   *
   * Rolling initiative on an encounter that has not started IS the start of
   * turn 1 / pass 1 (FR4.3). `turn`/`pass` default to 0 on a fresh row and only
   * `newTurn` ever bumped them, so the tracker used to read a pass behind for
   * the whole first turn; this clamps them the moment the dice hit the table.
   */
  async rollInitiativeAll(
    encounterId: string,
    opts: { combatantIds?: string[]; kinds?: Record<string, InitKind> } = {},
    tx?: EventTx,
  ): Promise<{ encounter: Encounter; combatants: Combatant[]; details: InitiativeDetail[] }> {
    const encounter = await this.getEncounter(encounterId, tx);
    const list = await this.listCombatants(encounterId, tx);
    const ids = opts.combatantIds;
    const targets = ids ? list.filter((c) => ids.includes(c.id)) : list;
    // Roll everything FIRST. `initiativeLineFor` reads `characters` for a PC
    // changing init kind, and that read cannot happen once the transaction is
    // open (the deadlock rule) — so the dice, which need no writes, are thrown
    // out here and only the resulting scores go inside.
    const rolled: Array<{ combatantId: string; kind: InitKind; detail: InitiativeDetail }> = [];
    for (const combatant of targets) {
      const kind = opts.kinds?.[combatant.id] ?? combatant.initKind;
      const line = await this.initiativeLineFor(combatant, kind, tx);
      const detail = rollInitiative(combatant, kind, rng, {
        ...(line ? { base: line.base, dice: line.dice } : {}),
      });
      rolled.push({
        combatantId: combatant.id,
        kind,
        detail: {
          combatantId: combatant.id,
          kind: detail.kind,
          base: detail.base,
          dice: detail.dice,
          rolls: detail.rolls,
          woundModifier: detail.woundModifier,
          score: detail.score,
        },
      });
    }
    return this.hub.atomicIn(encounter.campaignId, tx, async (itx) => {
      const details: InitiativeDetail[] = [];
      for (const r of rolled) {
        await itx.db
          .update(combatants)
          .set({
            initScore: r.detail.score,
            initKind: r.kind,
            initBase: r.detail.base,
            actedThisPass: false,
          })
          .where(eq(combatants.id, r.combatantId));
        details.push(r.detail);
      }
      const started =
        encounter.turn < 1 || encounter.pass < 1
          ? ((
              await itx.db
                .update(encounters)
                .set({ turn: Math.max(1, encounter.turn), pass: 1 })
                .where(eq(encounters.id, encounterId))
                .returning()
            )[0] ?? encounter)
          : encounter;
      const after = await this.emitUpdated(started, 'initiative.rolled', itx);
      return {
        // `combatants` rides beside it, so the encounter object carries only the
        // derived active id — never a second copy of the roster.
        encounter: {
          ...serializeEncounter(started),
          activeCombatantId: nextActorRules(after)?.id ?? null,
        },
        combatants: after,
        details,
      };
    });
  }

  /**
   * Hand-set a score or line (FR4.2 "roll or hand-enter", FR4.8).
   *
   * `rolled` is the dice total off a real table — the player rolled 2d6 and
   * got 9 — and the server adds the base and the wound modifier, so nobody
   * at the table does arithmetic and a wounded runner's penalty is never
   * forgotten. `score` remains the blunt override: whatever number the GM
   * types is the number.
   */
  async setInitiative(
    combatantId: string,
    input: { score?: number; base?: number; dice?: number; kind?: InitKind; rolled?: number },
  ): Promise<Combatant> {
    let score = input.score;
    if (input.rolled !== undefined) {
      const current = serializeCombatant(await this.getCombatant(combatantId));
      const base = input.base ?? current.initBase;
      score = base + input.rolled + computeWoundModifier(current.monitors);
    }
    return this.updateCombatant(combatantId, {
      ...(score !== undefined ? { initScore: score, actedThisPass: false } : {}),
      ...(input.base !== undefined ? { initBase: input.base } : {}),
      ...(input.dice !== undefined ? { initDice: input.dice } : {}),
      ...(input.kind !== undefined ? { initKind: input.kind } : {}),
    });
  }

  /** Derived line for a different init kind, when the combatant has a sheet. */
  private async initiativeLineFor(
    combatant: Combatant,
    kind: InitKind,
    tx?: EventTx,
  ): Promise<{ base: number; dice: number } | null> {
    if (kind === combatant.initKind) return null;
    const sheet = await this.sheetFor(combatant, tx);
    if (!sheet) return null;
    const derived = deriveFor(sheet, kind);
    return { base: derived.base, dice: derived.dice };
  }

  // --- turn engine (FR4.3 / FR4.4) ---------------------------------------

  /** Mark the acting combatant done and hand back the next one up. */
  async nextActor(
    encounterId: string,
  ): Promise<{ acted: Combatant | null; active: Combatant | null; combatants: Combatant[] }> {
    const encounter = await this.getEncounter(encounterId);
    const list = await this.listCombatants(encounterId);
    const acting = nextActorRules(list);
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      if (acting) {
        await tx.db
          .update(combatants)
          .set({ actedThisPass: true })
          .where(eq(combatants.id, acting.id));
      }
      const after = await this.emitUpdated(encounter, 'next-actor', tx);
      return { acted: acting, active: nextActorRules(after), combatants: after };
    });
  }

  /** End of pass: −10 to every score, `actedThisPass` cleared (FR4.3). */
  async endPass(
    encounterId: string,
  ): Promise<{ encounter: EncounterRow; combatants: Combatant[]; anyActive: boolean }> {
    const encounter = await this.getEncounter(encounterId);
    // `advancePass` is pure — the −10 loop runs on the list read above, and the
    // block below only writes what it decided.
    const advanced = advancePass(await this.listCombatants(encounterId));
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      for (const c of advanced) {
        await tx.db
          .update(combatants)
          .set({ initScore: c.initScore, actedThisPass: false })
          .where(eq(combatants.id, c.id));
      }
      const row = (
        await tx.db
          .update(encounters)
          .set({ pass: encounter.pass + 1 })
          .where(eq(encounters.id, encounterId))
          .returning()
      )[0]!;
      const after = await this.emitUpdated(row, 'end-pass', tx);
      return { encounter: row, combatants: after, anyActive: anyActiveScores(advanced) };
    });
  }

  /**
   * New combat turn: everyone re-rolls, pass resets to 1 (FR4.3).
   *
   * The turn bump and the re-roll are ONE transaction: half of this — a turn
   * counter that moved with nobody's initiative rerolled, or the reverse —
   * is a tracker the table has to unpick by hand mid-fight.
   */
  async newTurn(
    encounterId: string,
    opts: { roll?: boolean } = {},
  ): Promise<{ encounter: EncounterRow; combatants: Combatant[] }> {
    const encounter = await this.getEncounter(encounterId);
    return this.hub.atomic(encounter.campaignId, async (tx) => {
      const row = (
        await tx.db
          .update(encounters)
          .set({ turn: encounter.turn + 1, pass: 1, state: 'live' })
          .where(eq(encounters.id, encounterId))
          .returning()
      )[0]!;
      // One fight at a time: the table, the phones and the TV all follow
      // "the live encounter", and two of them would be a coin toss.
      await this.retireOtherLive(tx, row.campaignId, row.id);
      if (opts.roll === false) {
        // Hand rolls (FR4.2): the turn opens with every score blank, and the
        // dice come in from the table one row at a time.
        await tx.db
          .update(combatants)
          .set({ initScore: 0, actedThisPass: false })
          .where(eq(combatants.encounterId, encounterId));
        const list = await this.emitUpdated(row, 'new-turn', tx);
        return { encounter: row, combatants: list };
      }
      const rolled = await this.rollInitiativeAll(encounterId, {}, tx);
      await this.emitUpdated(row, 'new-turn', tx);
      return { encounter: row, combatants: rolled.combatants };
    });
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

  /**
   * `encounter.updated` twice: the full delta at `gm` visibility, and a
   * player-safe delta at `public` (hidden combatants stripped before
   * serialization, Principle 4). Payloads carry `scope` so clients pick.
   *
   * Pass the caller's `tx` and both frames join that transaction — they then
   * describe the row as it will be after COMMIT, and a rolled-back change is
   * also an unsent frame. Without one this opens its own block, so the two
   * frames still cannot half-land relative to each other.
   */
  async emitUpdated(
    encounter: EncounterRow,
    reason: string,
    tx?: EventTx,
  ): Promise<Combatant[]> {
    return this.hub.atomicIn(encounter.campaignId, tx, async (itx) =>
      this.emitUpdatedIn(itx, encounter, reason),
    );
  }

  private async emitUpdatedIn(
    tx: EventTx,
    encounter: EncounterRow,
    reason: string,
  ): Promise<Combatant[]> {
    const list = await this.listCombatants(encounter.id, tx);
    const active = nextActorRules(list)?.id ?? null;
    await tx.emit({
      type: 'encounter.updated',
      payload: {
        encounterId: encounter.id,
        scope: 'gm',
        reason,
        encounter: serializeEncounter(encounter),
        combatants: list,
        activeCombatantId: active,
        turnOrder: turnOrder(list).map((c) => c.id),
      },
      visibility: 'gm',
    });
    const visible = list.filter((c) => c.visibility === 'public');
    await tx.emit({
      type: 'encounter.updated',
      payload: {
        encounterId: encounter.id,
        scope: 'public',
        reason,
        encounter: serializeEncounter(encounter),
        combatants: visible.map((c) => ({
          id: c.id,
          name: c.name,
          source: c.source,
          initScore: c.initScore,
          initKind: c.initKind,
          actedThisPass: c.actedThisPass,
          // The party's dice lines travel with the frame (FR4.2); an NPC's stays the GM's.
          ...(c.source === 'character' ? { initBase: c.initBase, initDice: c.initDice } : {}),
          condition: conditionOf(c.monitors),
        })),
        activeCombatantId: visible.some((c) => c.id === active) ? active : null,
        turnOrder: turnOrder(visible).map((c) => c.id),
      },
      visibility: 'public',
    });
    return list;
  }

  async emitUpdatedById(encounterId: string, reason: string, tx?: EventTx): Promise<void> {
    await this.emitUpdated(await this.getEncounter(encounterId, tx), reason, tx);
  }
}
