/**
 * Damage, one-tap undo, and morale for the combat tracker (FR4.5, FR4.6,
 * FR10.9). Split out of `EncountersService` so each file stays readable; it
 * borrows that service for row access and event emission.
 *
 * The propagation chain per application: monitors fill (overflow handled) →
 * wound modifier recomputes → Initiative Score shifts → `combatant.damaged`
 * (mirrored to the owning player for PCs) → morale triggers evaluated.
 */
import { eq } from 'drizzle-orm';
import type { Combatant } from '@safehouse/contracts';
import {
  applyDamage as applyDamageRules,
  computeWoundModifier,
  gruntCasualties,
  gruntMoraleTriggers,
  moraleReport,
  tickGruntDamage,
  type DamageResult,
  type DamageTrack,
  type MoraleReport,
  type MoraleTriggers,
} from '@safehouse/rules';
import { characters, combatants } from '@safehouse/db';
import { httpError } from './auth.js';
import type { EncountersService } from './encounters.js';
import {
  conditionOf,
  isDown,
  parseCopilot,
  serializeCombatant,
  type DamageInput,
  type DamageOutcome,
  type UndoSnapshot,
} from './encounters-model.js';

export class CombatDamageService {
  constructor(private readonly encounters: EncountersService) {}

  private get db() {
    return this.encounters.db;
  }

  private get hub() {
    return this.encounters.hub;
  }

  /**
   * Apply boxes to a combatant (FR4.5). Grunt rows with a `memberIndex` tick
   * that member's row instead (FR4.6) — the shared statblock is untouched.
   */
  async applyDamage(input: DamageInput): Promise<DamageOutcome> {
    const encounter = await this.encounters.getEncounter(input.encounterId);
    const row = await this.encounters.getCombatant(input.targetId);
    if (row.encounterId !== encounter.id) {
      throw httpError(400, 'bad_request', 'combatant is not in this encounter');
    }
    const before = serializeCombatant(row);
    const copilot = parseCopilot(row.copilot);
    const snapshot: UndoSnapshot = {
      monitors: before.monitors,
      ...(before.grunt ? { grunt: before.grunt } : {}),
      initScore: before.initScore,
      boxes: input.boxes,
      track: input.track,
      ...(input.note ? { note: input.note } : {}),
      ts: new Date().toISOString(),
    };

    let result: DamageResult | undefined;
    let gruntMember: DamageOutcome['gruntMember'];
    let monitors = before.monitors;
    let initScore = before.initScore;

    if (before.grunt && input.memberIndex !== undefined) {
      const max = before.monitors.physical.max || 10;
      const ticked = tickGruntDamage(before.grunt, input.memberIndex, input.boxes, max);
      copilot.grunt = ticked.grunt;
      gruntMember = {
        index: input.memberIndex,
        label: ticked.member.label,
        filled: ticked.member.filled,
        down: ticked.member.down,
      };
    } else {
      result = applyDamageRules(before.monitors, input.boxes, input.track, {
        ...(input.painTolerance !== undefined ? { painTolerance: input.painTolerance } : {}),
      });
      monitors = result.monitors;
      initScore = before.initScore + result.woundModifier.delta;
    }
    copilot.lastDamage = snapshot;

    const updatedRow = (
      await this.db
        .update(combatants)
        .set({ monitors, initScore, copilot })
        .where(eq(combatants.id, row.id))
        .returning()
    )[0]!;
    const combatant = serializeCombatant(updatedRow);

    await this.hub.emit(encounter.campaignId, {
      type: 'combatant.damaged',
      payload: {
        encounterId: encounter.id,
        combatantId: combatant.id,
        name: combatant.name,
        boxes: input.boxes,
        track: input.track,
        monitors: combatant.monitors,
        condition: conditionOf(combatant.monitors),
        woundModifier: result?.woundModifier ?? null,
        initScore: combatant.initScore,
        ...(gruntMember ? { gruntMember, grunt: combatant.grunt } : {}),
        ...(input.note ? { note: input.note } : {}),
        undoAvailable: true,
      },
      visibility: combatant.visibility,
    });
    await this.mirrorToCharacter(encounter.campaignId, combatant, result);
    const morale = await this.evaluateMorale(encounter.campaignId, encounter.id, combatant);
    await this.encounters.emitUpdated(encounter, 'damage');
    return {
      combatant,
      ...(result ? { result } : {}),
      ...(gruntMember ? { gruntMember } : {}),
      morale,
    };
  }

  /**
   * FR4.5 "apply from an opposed roll's net result": boxes = (base DV + net
   * hits) − soak hits, then the ordinary damage path.
   */
  async damageFromRoll(input: {
    encounterId: string;
    targetId: string;
    baseDv: number;
    netHits: number;
    soakHits?: number;
    damageType?: 'P' | 'S';
    note?: string;
  }): Promise<DamageOutcome & { modifiedDv: number; boxes: number }> {
    const modifiedDv = Math.max(0, Math.floor(input.baseDv) + Math.floor(input.netHits));
    const boxes = Math.max(0, modifiedDv - Math.max(0, Math.floor(input.soakHits ?? 0)));
    const track: DamageTrack = (input.damageType ?? 'P') === 'S' ? 'stun' : 'physical';
    const outcome = await this.applyDamage({
      encounterId: input.encounterId,
      targetId: input.targetId,
      boxes,
      track,
      note: input.note ?? `from roll: DV ${input.baseDv} + ${input.netHits} net − soak`,
    });
    return { ...outcome, modifiedDv, boxes };
  }

  /** One-tap undo (FR4.5): restore the stored inverse of the last damage. */
  async undoDamage(combatantId: string): Promise<Combatant> {
    const row = await this.encounters.getCombatant(combatantId);
    const copilot = parseCopilot(row.copilot);
    const snapshot = copilot.lastDamage;
    if (!snapshot) throw httpError(409, 'conflict', 'no damage to undo for this combatant');
    const encounter = await this.encounters.getEncounter(row.encounterId);
    if (snapshot.grunt) copilot.grunt = snapshot.grunt;
    delete copilot.lastDamage;
    const updated = (
      await this.db
        .update(combatants)
        .set({ monitors: snapshot.monitors, initScore: snapshot.initScore, copilot })
        .where(eq(combatants.id, combatantId))
        .returning()
    )[0]!;
    const combatant = serializeCombatant(updated);
    await this.hub.emit(encounter.campaignId, {
      type: 'combatant.damaged',
      payload: {
        encounterId: encounter.id,
        combatantId: combatant.id,
        name: combatant.name,
        undo: true,
        monitors: combatant.monitors,
        condition: conditionOf(combatant.monitors),
        initScore: combatant.initScore,
        undoAvailable: false,
      },
      visibility: combatant.visibility,
    });
    await this.mirrorToCharacter(encounter.campaignId, combatant);
    await this.encounters.emitUpdated(encounter, 'damage.undo');
    return combatant;
  }

  /**
   * FR4.5 "propagate": the PC's own sheet view mirrors the tracker's monitors.
   * INTEGRATION: there is no character play-state column yet (schema §9.2 keeps
   * only `sheet`), so the mirror rides as a `sheet.updated` event scoped to the
   * owner; point it at the play-state row once the characters agent lands one.
   */
  private async mirrorToCharacter(
    campaignId: string,
    combatant: Combatant,
    result?: DamageResult,
  ): Promise<void> {
    if (combatant.source !== 'character' || !combatant.sourceId) return;
    const character = (
      await this.db.select().from(characters).where(eq(characters.id, combatant.sourceId)).limit(1)
    )[0];
    if (!character) return;
    await this.hub.emit(campaignId, {
      type: 'sheet.updated',
      payload: {
        characterId: character.id,
        combatantId: combatant.id,
        monitors: combatant.monitors,
        woundModifier: result?.woundModifier.after ?? computeWoundModifier(combatant.monitors),
        source: 'encounter',
      },
      visibility: character.ownerUserId ? 'gm_owner' : 'gm',
      ownerUserId: character.ownerUserId,
    });
  }

  /**
   * Evaluate the configured triggers after damage and post a GM-only
   * suggestion (FR10.9). Grunt rows check their own member ticks; single NPCs
   * check the opposition side as a whole. A suggestion only — the GM decides,
   * and the log records it.
   */
  private async evaluateMorale(
    campaignId: string,
    encounterId: string,
    target: Combatant,
  ): Promise<(MoraleReport & { combatantId: string }) | null> {
    if (target.source === 'character') return null;
    let triggers: MoraleTriggers;
    let pr = 0;
    if (target.grunt) {
      triggers = gruntMoraleTriggers(target.grunt, {
        leaderDown: parseCopilot(target.copilot).leader === true,
      });
      pr = target.grunt.professionalRating;
    } else {
      const side = (await this.encounters.listCombatants(encounterId)).filter(
        (c) => c.source !== 'character',
      );
      const bodies = side.reduce((n, c) => n + (c.grunt ? c.grunt.size : 1), 0);
      const casualties = side.reduce(
        (n, c) => n + (c.grunt ? gruntCasualties(c.grunt) : isDown(c) ? 1 : 0),
        0,
      );
      triggers = {
        firstCasualty: casualties >= 1,
        leaderDown: side.some((c) => parseCopilot(c.copilot).leader === true && isDown(c)),
        halfStrength: bodies > 0 && casualties * 2 >= bodies,
      };
      pr = Number(parseCopilot(target.copilot).generator?.professionalRating ?? 0);
    }
    const report = moraleReport(pr, triggers);
    if (report.pressure === 0) return null;
    await this.hub.emit(campaignId, {
      type: 'log.posted',
      payload: {
        kind: 'morale',
        encounterId,
        combatantId: target.id,
        name: target.name,
        suggestion: report.suggestion,
        pressure: report.pressure,
        threshold: report.threshold,
        reasons: report.reasons,
        text: `Morale check — ${target.name}: ${report.reasons.join(', ')} vs PR ${report.threshold} → ${report.suggestion.replace(/_/g, ' ')}. Your call.`,
      },
      visibility: 'gm',
    });
    return { ...report, combatantId: target.id };
  }
}
