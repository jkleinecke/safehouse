/**
 * Party-aware threat readout (FR10.5) and its balance-lever recompute (FR10.6).
 *
 * The feature only an integrated tool can do: the PCs' LIVE sheets are already
 * in the system, so the planner shows the math BOTH ways — every opposition
 * attack pool vs each PC's defense/soak and the reverse, plus initiative and
 * action-economy comparisons. Everything here is an ESTIMATE, labeled as one:
 * SR5 has no CR and we don't pretend otherwise (Principle 3, R10).
 */
import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  CombatantMonitorsSchema,
  SheetV1Schema,
  type SheetV1,
} from '@safehouse/contracts';
import { deriveCharacter, exchangeEstimate, type ExchangeEstimate } from '@safehouse/rules';
import { characters, combatants, npcTemplates, type Db } from '@safehouse/db';
import { httpError } from './auth.js';
// Type-only (erased at runtime): ./generator.js imports ThreatService from
// here, so the module graph stays one-way.
import type { BuildPartInput, EncounterRow, GeneratorService } from './generator.js';

/**
 * Copilot jsonb shape written on generator-backed combatants — the db-row
 * contract this service reads back (see ./generator.ts for the writer).
 * INTEGRATION: `combatants` has no init_dice column — initiative dice ride in
 * copilot.initDice; grunt state (contracts GruntState) rides in copilot.grunt.
 */
export const CopilotSchema = z
  .object({
    sheet: SheetV1Schema.optional(),
    initDice: z.number().int().min(0).max(5).optional(),
    generator: z
      .object({
        templateId: z.string().optional(),
        tierId: z.string().optional(),
        seed: z.number().optional(),
        professionalRating: z.number().optional(),
      })
      .loose()
      .optional(),
    grunt: z.object({ size: z.number().int().min(1) }).loose().optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Shapes (the math is on display — nothing here is hidden from the GM)
// ---------------------------------------------------------------------------

export interface ThreatAttack {
  weapon: string;
  pool: number;
  dv: string;
  ap: number;
}

export interface ThreatUnit {
  id: string;
  name: string;
  side: 'party' | 'opposition';
  /** Grunt-group size, else 1 — feeds action economy. */
  bodies: number;
  professionalRating?: number;
  defense: number;
  soak: number;
  armor: number;
  wounds: { physical: number; stun: number };
  initiative: { base: number; dice: number; estScore: number; estPasses: number };
  attacks: ThreatAttack[];
}

export interface ThreatTargetCell {
  defenderId: string;
  defenderName: string;
  defensePool: number;
  /** Soak vs THIS attack: BOD + max(0, armor + AP). */
  soakPool: number;
  estimate: ExchangeEstimate;
}

export interface ThreatExchangeRow {
  attackerId: string;
  attackerName: string;
  bodies: number;
  weapon: string;
  attackPool: number;
  dv: string;
  ap: number;
  targets: ThreatTargetCell[];
}

export interface ThreatSideSummary {
  bodies: number;
  /** Bodies-weighted mean estimated Initiative Score (base + 3.5 x dice). */
  avgEstScore: number;
  /** Sum of bodies x estimated passes — the side's actions per combat turn. */
  estActionsPerTurn: number;
}

export interface ThreatReadout {
  encounterId: string;
  encounterName: string;
  /** Always true — these are estimates, never promises (R10, Principle 3). */
  estimate: true;
  method: string;
  party: ThreatUnit[];
  opposition: ThreatUnit[];
  /** Each opposition attack pool vs each PC's defense/soak (FR10.5). */
  oppositionVsParty: ThreatExchangeRow[];
  /** And the reverse. */
  partyVsOpposition: ThreatExchangeRow[];
  initiative: { party: ThreatSideSummary; opposition: ThreatSideSummary };
  actionEconomy: { party: number; opposition: number; note: string };
  warnings: string[];
}

const METHOD =
  'Estimates only: hits ~ pool / 3; est. Initiative Score = base + 3.5 x dice; ' +
  'passes ~ ceil(score / 10); SR5 has no CR — tune with the levers (FR10.6).';

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

/** Soak against a specific attack: BOD + max(0, armor + AP) (AP<0 pierces). */
export function effectiveSoak(unit: Pick<ThreatUnit, 'soak' | 'armor'>, ap: number): number {
  const bod = unit.soak - unit.armor;
  return Math.max(0, bod + Math.max(0, unit.armor + ap));
}

/** Estimated initiative passes for a score: one per 10 points, minimum one. */
export function estPassesFor(estScore: number): number {
  return Math.max(1, Math.ceil(estScore / 10));
}

/** Derive one threat-table unit from a (live) sheet + wound state. */
export function unitFromSheet(
  id: string,
  name: string,
  side: 'party' | 'opposition',
  sheet: SheetV1,
  opts: {
    bodies?: number;
    professionalRating?: number;
    wounds?: { physical: number; stun: number };
  } = {},
): ThreatUnit {
  const wounds = opts.wounds ?? { physical: 0, stun: 0 };
  const derived = deriveCharacter(sheet, { wounds });
  const base = derived.initiative.physical.base.value;
  const dice = derived.initiative.physical.dice.value;
  const estScore = base + 3.5 * dice;
  return {
    id,
    name,
    side,
    bodies: opts.bodies ?? 1,
    ...(opts.professionalRating !== undefined ? { professionalRating: opts.professionalRating } : {}),
    defense: derived.pools['defense']?.total ?? 0,
    soak: derived.pools['soak']?.total ?? 0,
    armor: derived.pools['armor']?.total ?? 0,
    wounds,
    initiative: { base, dice, estScore, estPasses: estPassesFor(estScore) },
    attacks: sheet.weapons
      .filter((w) => typeof w.dv === 'string' && w.dv.length > 0)
      .map((w) => ({
        weapon: w.name,
        pool: derived.pools[`weapon.${w.name}`]?.total ?? 0,
        dv: w.dv as string,
        ap: w.ap,
      })),
  };
}

/** One direction of the table: every attacker's every weapon vs every target. */
export function exchangeRows(
  attackers: readonly ThreatUnit[],
  defenders: readonly ThreatUnit[],
): ThreatExchangeRow[] {
  const rows: ThreatExchangeRow[] = [];
  for (const attacker of attackers) {
    for (const attack of attacker.attacks) {
      rows.push({
        attackerId: attacker.id,
        attackerName: attacker.name,
        bodies: attacker.bodies,
        weapon: attack.weapon,
        attackPool: attack.pool,
        dv: attack.dv,
        ap: attack.ap,
        targets: defenders.map((d) => {
          const soakPool = effectiveSoak(d, attack.ap);
          return {
            defenderId: d.id,
            defenderName: d.name,
            defensePool: d.defense,
            soakPool,
            estimate: exchangeEstimate(attack.pool, d.defense, attack.dv, soakPool),
          };
        }),
      });
    }
  }
  return rows;
}

export function sideSummary(units: readonly ThreatUnit[]): ThreatSideSummary {
  const bodies = units.reduce((n, u) => n + u.bodies, 0);
  const scoreSum = units.reduce((n, u) => n + u.initiative.estScore * u.bodies, 0);
  return {
    bodies,
    avgEstScore: bodies > 0 ? scoreSum / bodies : 0,
    estActionsPerTurn: units.reduce((n, u) => n + u.bodies * u.initiative.estPasses, 0),
  };
}

/** Assemble both directions + the comparisons (pure — used by GET and recompute). */
export function assembleReadout(
  encounter: Pick<EncounterRow, 'id' | 'name'>,
  party: ThreatUnit[],
  opposition: ThreatUnit[],
  warnings: string[],
): ThreatReadout {
  for (const u of [...party, ...opposition]) {
    if (u.attacks.length === 0) {
      warnings.push(`"${u.name}" has no weapon with a damage code — no attack estimate for them`);
    }
  }
  const partySummary = sideSummary(party);
  const oppositionSummary = sideSummary(opposition);
  return {
    encounterId: encounter.id,
    encounterName: encounter.name,
    estimate: true,
    method: METHOD,
    party,
    opposition,
    oppositionVsParty: exchangeRows(opposition, party),
    partyVsOpposition: exchangeRows(party, opposition),
    initiative: { party: partySummary, opposition: oppositionSummary },
    actionEconomy: {
      party: partySummary.estActionsPerTurn,
      opposition: oppositionSummary.estActionsPerTurn,
      note: 'bodies x estimated passes per combat turn',
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ThreatService {
  constructor(
    private readonly db: Db,
    private readonly generator: GeneratorService,
  ) {}

  /** THE readout (FR10.5): stored opposition vs the live party. */
  async readout(encounterId: string): Promise<ThreatReadout> {
    const encounter = await this.generator.getEncounter(encounterId);
    const warnings: string[] = [];
    const rows = await this.db
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, encounter.id));

    const pcWounds = new Map<string, { physical: number; stun: number }>();
    const opposition: ThreatUnit[] = [];
    for (const row of rows) {
      const monitors = CombatantMonitorsSchema.safeParse(row.monitors);
      const wounds = monitors.success
        ? { physical: monitors.data.physical.filled, stun: monitors.data.stun.filled }
        : { physical: 0, stun: 0 };
      if (row.source === 'character') {
        if (row.sourceId) pcWounds.set(row.sourceId, wounds);
        continue;
      }
      const copilot = CopilotSchema.safeParse(row.copilot);
      let sheet: SheetV1 | undefined = copilot.success ? copilot.data.sheet : undefined;
      if (!sheet && row.source === 'npc_template' && row.sourceId) {
        const template = (
          await this.db.select().from(npcTemplates).where(eq(npcTemplates.id, row.sourceId)).limit(1)
        )[0];
        const parsed = template ? SheetV1Schema.safeParse(template.statblock) : undefined;
        if (parsed?.success) sheet = parsed.data;
      }
      if (!sheet) {
        warnings.push(`combatant "${row.name}" carries no playable sheet — excluded from estimates`);
        continue;
      }
      const gen = copilot.success ? copilot.data.generator : undefined;
      const grunt = copilot.success ? copilot.data.grunt : undefined;
      opposition.push(
        unitFromSheet(row.id, row.name, 'opposition', sheet, {
          bodies: grunt?.size ?? 1,
          ...(typeof gen?.professionalRating === 'number'
            ? { professionalRating: gen.professionalRating }
            : {}),
          wounds,
        }),
      );
    }

    const party = await this.partyUnits(encounter.campaignId, pcWounds, warnings);
    return assembleReadout(encounter, party, opposition, warnings);
  }

  /** FR10.6 levers: recompute against hypothetical parts, persisting nothing. */
  async recompute(encounterId: string, parts: BuildPartInput[]): Promise<ThreatReadout> {
    const encounter = await this.generator.getEncounter(encounterId);
    const warnings: string[] = [];
    const opposition: ThreatUnit[] = [];
    for (const [p, part] of parts.entries()) {
      const template = await this.generator.getTemplate(part.templateId);
      if (template.campaignId !== encounter.campaignId) {
        throw httpError(403, 'forbidden', 'template belongs to another campaign');
      }
      const seed = part.seed ?? randomInt(0, 0x1_0000_0000);
      if (part.kind === 'gruntGroup') {
        const size = part.size ?? 1;
        const { group } = this.generator.generateGroupFromTemplate(template, part.tierId, size, seed);
        opposition.push(
          unitFromSheet(`part:${p}`, `${template.name} x${size}`, 'opposition', group.statblock, {
            bodies: size,
            professionalRating: group.professionalRating,
          }),
        );
      } else {
        for (const [i, memberSeed] of this.generator.memberSeeds(seed, part.count ?? 1).entries()) {
          const { npc } = this.generator.generateFromTemplate(template, part.tierId, memberSeed);
          opposition.push(
            unitFromSheet(`part:${p}:${i}`, npc.name, 'opposition', npc.sheet, {
              professionalRating: npc.professionalRating,
            }),
          );
        }
      }
    }
    const party = await this.partyUnits(encounter.campaignId, new Map(), warnings);
    return assembleReadout(encounter, party, opposition, warnings);
  }

  /** The LIVE party: active PCs' derived sheets, wounds from combatant rows. */
  private async partyUnits(
    campaignId: string,
    pcWounds: Map<string, { physical: number; stun: number }>,
    warnings: string[],
  ): Promise<ThreatUnit[]> {
    const pcs = await this.db
      .select()
      .from(characters)
      .where(and(eq(characters.campaignId, campaignId), eq(characters.status, 'active')));
    const units: ThreatUnit[] = [];
    for (const pc of pcs) {
      const parsed = SheetV1Schema.safeParse(pc.sheet);
      if (!parsed.success) {
        warnings.push(`character "${pc.name}" has an unreadable sheet — excluded from estimates`);
        continue;
      }
      units.push(
        unitFromSheet(pc.id, pc.name, 'party', parsed.data, {
          wounds: pcWounds.get(pc.id) ?? { physical: 0, stun: 0 },
        }),
      );
    }
    if (units.length === 0) warnings.push('no active party characters — one side of the table is empty');
    return units;
  }
}
