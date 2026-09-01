/**
 * Generator service (M10, FR10.1–10.4): npc_templates CRUD backing, seeded
 * procedural generation via @safehouse/rules (output is returned directly —
 * procedural, not AI, so it never lands as an ai_generations draft),
 * promote-to-template (FR10.3) and the encounter builder (FR10.4, db rows only).
 *
 * The party-aware threat readout (FR10.5/10.6) lives in ./generator-threat.ts.
 */
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  GenTemplateSchema,
  SheetV1Schema,
  type CombatantMonitors,
  type GenTemplate,
} from '@safehouse/contracts';
import {
  combineSeed,
  deriveCharacter,
  generateGruntGroup,
  generateNpc,
  hashSeed,
  regenerate,
  type GeneratedGruntGroup,
  type GeneratedNpc,
  type LoadoutCatalog,
  type MonitorSizes,
  type RegenerateLocks,
} from '@safehouse/rules';
import {
  combatants,
  encounters,
  gruntGroups,
  npcTemplates,
  scenes,
  tokens,
  type Db,
} from '@safehouse/db';
import { httpError } from './auth.js';
import { ThreatService, type ThreatReadout } from './generator-threat.js';

export { CopilotSchema, type ThreatReadout, type ThreatUnit } from './generator-threat.js';

export type NpcTemplateRow = typeof npcTemplates.$inferSelect;
export type EncounterRow = typeof encounters.$inferSelect;
export type CombatantRow = typeof combatants.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;

// ---------------------------------------------------------------------------
// Locks (FR10.2 "keep the stats, reroll the names")
// ---------------------------------------------------------------------------

export const LOCK_ASPECTS = ['stats', 'metatype', 'name', 'flavor', 'loadout'] as const;
export type LockAspect = (typeof LOCK_ASPECTS)[number];

export function parseLocks(locks: readonly string[]): RegenerateLocks {
  const out: RegenerateLocks = {};
  for (const lock of locks) {
    if (!(LOCK_ASPECTS as readonly string[]).includes(lock)) {
      throw httpError(400, 'bad_request', `unknown lock "${lock}" (valid: ${LOCK_ASPECTS.join(', ')})`);
    }
    out[lock as LockAspect] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

/** Random uint32 seed — returned to the caller so reroll-identical works. */
export function newSeed(): number {
  return randomInt(0, 0x1_0000_0000);
}

/** Parse a template row's gen params, 400 when it has none / invalid ones. */
export function genOf(row: NpcTemplateRow): GenTemplate {
  const parsed = GenTemplateSchema.safeParse(row.gen);
  if (!parsed.success || parsed.data.tiers.length === 0) {
    throw httpError(400, 'template_invalid', `template "${row.name}" has no usable gen params (FR10.1)`);
  }
  return parsed.data;
}

/**
 * Loadout catalog resolved from the template's own statblock records (FR10.1:
 * slots reference the GM's entered gear records — here, the weapons/armor/gear
 * entered on the template statblock, keyed by name).
 * INTEGRATION: when a campaign-level gear library lands, resolve options
 * against it here as well.
 */
export function catalogOf(row: NpcTemplateRow): LoadoutCatalog {
  const parsed = SheetV1Schema.partial().safeParse(row.statblock ?? {});
  if (!parsed.success) return {};
  const sb = parsed.data;
  const catalog: LoadoutCatalog = { weapons: {}, armor: {}, gear: {} };
  for (const w of sb.weapons ?? []) catalog.weapons![w.name] = w;
  for (const a of sb.armor ?? []) catalog.armor![a.name] = a;
  for (const g of sb.gear ?? []) catalog.gear![g.name] = g;
  return catalog;
}

export function monitorsFor(sizes: MonitorSizes): CombatantMonitors {
  return {
    physical: { max: sizes.physical, filled: 0 },
    stun: { max: sizes.stun, filled: 0 },
    overflow: { max: sizes.overflow, filled: 0 },
  };
}

// ---------------------------------------------------------------------------
// Encounter builder inputs
// ---------------------------------------------------------------------------

/**
 * Coordination with the encounters/copilot agents happens via db rows only:
 * generator-backed combatants carry their playable SheetV1 and seed in
 * `combatants.copilot` (shape: `CopilotSchema` in ./generator-threat.ts).
 */
export interface BuildPartInput {
  kind: 'npc' | 'gruntGroup';
  templateId: string;
  tierId: string;
  /** npc parts: how many independent NPCs. */
  count?: number;
  /** gruntGroup parts: shared-statblock squad size. */
  size?: number;
  seed?: number;
  /**
   * GM override of the rolled Professional Rating (the FR10.6 lever).
   *
   * Applied to the combatant AFTER generation rather than fed into it: PR is
   * morale and Edge-spend behaviour (FR10.9), not an input the statblock is
   * rolled from, so overriding it must not change a single die of the sheet
   * the seed reproduces. Same seed, same body, different nerve.
   */
  professionalRating?: number;
}

export interface BuildResult {
  encounter: EncounterRow;
  combatants: CombatantRow[];
  tokens: TokenRow[];
  /** Per-part resolved seeds (reroll-identical, FR10.2). */
  parts: Array<{ kind: 'npc' | 'gruntGroup'; templateId: string; tierId: string; seed: number }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GeneratorService {
  constructor(readonly db: Db) {}

  async getTemplate(id: string): Promise<NpcTemplateRow> {
    const row = (await this.db.select().from(npcTemplates).where(eq(npcTemplates.id, id)).limit(1))[0];
    if (!row) throw httpError(404, 'not_found', 'unknown npc template');
    return row;
  }

  async listTemplates(campaignId: string): Promise<NpcTemplateRow[]> {
    return this.db.select().from(npcTemplates).where(eq(npcTemplates.campaignId, campaignId));
  }

  async createTemplate(values: typeof npcTemplates.$inferInsert): Promise<NpcTemplateRow> {
    return (await this.db.insert(npcTemplates).values(values).returning())[0]!;
  }

  async updateTemplate(
    id: string,
    patch: Partial<typeof npcTemplates.$inferInsert>,
  ): Promise<NpcTemplateRow> {
    const row = (
      await this.db.update(npcTemplates).set(patch).where(eq(npcTemplates.id, id)).returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown npc template');
    return row;
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.db.delete(npcTemplates).where(eq(npcTemplates.id, id));
  }

  /** One NPC (FR10.2). `prevSeed` + locks hold aspects from a prior roll. */
  generateFromTemplate(
    row: NpcTemplateRow,
    tierId: string,
    seed: number | undefined,
    locks: readonly string[] = [],
    prevSeed?: number,
  ): { seed: number; prevSeed?: number; npc: GeneratedNpc } {
    const gen = genOf(row);
    const catalog = catalogOf(row);
    const s = seed ?? newSeed();
    const lock = parseLocks(locks);
    if (Object.keys(lock).length > 0) {
      if (prevSeed === undefined) {
        throw httpError(400, 'bad_request', 'locks require prevSeed (the roll whose fields to keep)');
      }
      const prev = generateNpc(gen, tierId, prevSeed, { catalog });
      return { seed: s, prevSeed, npc: regenerate(prev, gen, tierId, s, { catalog, lock }) };
    }
    return { seed: s, npc: generateNpc(gen, tierId, s, { catalog }) };
  }

  /** A grunt group (FR10.2/FR4.6): one statblock, `size` faces. */
  generateGroupFromTemplate(
    row: NpcTemplateRow,
    tierId: string,
    size: number,
    seed?: number,
  ): { seed: number; group: GeneratedGruntGroup } {
    const s = seed ?? newSeed();
    return { seed: s, group: generateGruntGroup(genOf(row), tierId, size, s, { catalog: catalogOf(row) }) };
  }

  /** Seeds for the members of an `npc` part (count > 1 splits the substream). */
  memberSeeds(seed: number, count: number): number[] {
    const base = hashSeed(seed);
    if (count <= 1) return [base];
    return Array.from({ length: count }, (_, i) => combineSeed(base, `npc:${i}`));
  }

  /** Encounter builder (FR10.4): encounter + combatant rows (+ staged tokens). */
  async buildEncounter(opts: {
    campaignId: string;
    sceneId?: string | null;
    name: string;
    parts: BuildPartInput[];
  }): Promise<BuildResult> {
    let sceneId: string | null = null;
    if (opts.sceneId) {
      const scene = (
        await this.db.select().from(scenes).where(eq(scenes.id, opts.sceneId)).limit(1)
      )[0];
      if (!scene || scene.campaignId !== opts.campaignId) {
        throw httpError(400, 'bad_request', 'sceneId does not name a scene in this campaign');
      }
      sceneId = scene.id;
    }

    const encounter = (
      await this.db
        .insert(encounters)
        .values({ campaignId: opts.campaignId, sceneId, name: opts.name, state: 'prep' })
        .returning()
    )[0]!;

    const rows: CombatantRow[] = [];
    const resolvedParts: BuildResult['parts'] = [];
    for (const part of opts.parts) {
      const template = await this.getTemplate(part.templateId);
      if (template.campaignId !== opts.campaignId) {
        throw httpError(403, 'forbidden', 'template belongs to another campaign');
      }
      const seed = part.seed ?? newSeed();
      resolvedParts.push({ kind: part.kind, templateId: part.templateId, tierId: part.tierId, seed });
      const prOverride = part.professionalRating;
      if (part.kind === 'gruntGroup') {
        rows.push(
          await this.insertGruntCombatant(
            encounter.id,
            template,
            part.tierId,
            part.size ?? 1,
            seed,
            prOverride,
          ),
        );
      } else {
        for (const memberSeed of this.memberSeeds(seed, part.count ?? 1)) {
          const { npc } = this.generateFromTemplate(template, part.tierId, memberSeed);
          rows.push(await this.insertNpcCombatant(encounter.id, template, npc, prOverride));
        }
      }
    }

    const tokenRows: TokenRow[] = [];
    if (sceneId) {
      for (let i = 0; i < rows.length; i++) {
        const combatant = rows[i]!;
        const token = (
          await this.db
            .insert(tokens)
            .values({
              sceneId,
              source: 'combatant',
              sourceId: combatant.id,
              name: combatant.name,
              x: i,
              y: 0,
              hidden: true, // GM staging — hidden until revealed (Principle 4)
              barsVisibility: 'gm',
            })
            .returning()
        )[0]!;
        tokenRows.push(token);
        rows[i] = (
          await this.db
            .update(combatants)
            .set({ tokenId: token.id })
            .where(eq(combatants.id, combatant.id))
            .returning()
        )[0]!;
      }
    }
    return { encounter, combatants: rows, tokens: tokenRows, parts: resolvedParts };
  }

  private async insertNpcCombatant(
    encounterId: string,
    template: NpcTemplateRow,
    npc: GeneratedNpc,
    prOverride?: number,
  ): Promise<CombatantRow> {
    const derived = deriveCharacter(npc.sheet);
    const professionalRating = prOverride ?? npc.professionalRating;
    return (
      await this.db
        .insert(combatants)
        .values({
          encounterId,
          source: 'generated',
          sourceId: template.id,
          name: npc.name,
          initBase: derived.initiative.physical.base.value,
          initKind: 'physical',
          monitors: monitorsFor(npc.monitors),
          visibility: 'gm',
          copilot: {
            sheet: npc.sheet,
            initDice: derived.initiative.physical.dice.value,
            generator: {
              templateId: template.id,
              tierId: npc.tierId,
              seed: npc.seed,
              professionalRating,
              loadout: npc.loadout,
              flavor: npc.flavor,
            },
          },
        })
        .returning()
    )[0]!;
  }

  private async insertGruntCombatant(
    encounterId: string,
    template: NpcTemplateRow,
    tierId: string,
    size: number,
    seed: number,
    prOverride?: number,
  ): Promise<CombatantRow> {
    const { group } = this.generateGroupFromTemplate(template, tierId, size, seed);
    // The override lands on the group row AND both copies inside `copilot`, so
    // the morale check, the tracker chip and the readout can never disagree
    // about how professional this squad is.
    const professionalRating = prOverride ?? group.professionalRating;
    const groupRow = (
      await this.db
        .insert(gruntGroups)
        .values({
          campaignId: template.campaignId,
          templateId: template.id,
          size,
          professionalRating,
          groupEdge: 0,
        })
        .returning()
    )[0]!;
    const derived = deriveCharacter(group.statblock);
    return (
      await this.db
        .insert(combatants)
        .values({
          encounterId,
          source: 'grunt_group',
          sourceId: groupRow.id,
          name: `${template.name} x${size}`,
          initBase: derived.initiative.physical.base.value,
          initKind: 'physical',
          monitors: monitorsFor(group.monitors),
          visibility: 'gm',
          copilot: {
            sheet: group.statblock,
            initDice: derived.initiative.physical.dice.value,
            generator: {
              templateId: template.id,
              tierId: group.tierId,
              seed: group.seed,
              professionalRating,
            },
            grunt: {
              size,
              professionalRating,
              groupEdge: 0,
              members: group.members.map((m) => ({ label: m.name, filled: 0, down: false })),
            },
          },
        })
        .returning()
    )[0]!;
  }

  async getEncounter(id: string): Promise<EncounterRow> {
    const row = (await this.db.select().from(encounters).where(eq(encounters.id, id)).limit(1))[0];
    if (!row) throw httpError(404, 'not_found', 'unknown encounter');
    return row;
  }

  // --- threat readout (FR10.5/10.6) — implemented in ./generator-threat.ts --

  private threatService?: ThreatService;

  private threat(): ThreatService {
    return (this.threatService ??= new ThreatService(this.db, this));
  }

  /** Party-aware threat readout for a stored encounter (FR10.5). */
  threatReadout(encounterId: string): Promise<ThreatReadout> {
    return this.threat().readout(encounterId);
  }

  /** Balance levers: recompute against hypothetical parts, persisting nothing (FR10.6). */
  threatRecompute(encounterId: string, parts: BuildPartInput[]): Promise<ThreatReadout> {
    return this.threat().recompute(encounterId, parts);
  }
}
