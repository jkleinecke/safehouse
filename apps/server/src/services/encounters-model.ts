/**
 * Encounter row model (M4): the `encounters` / `combatants` db-row contract,
 * serialization to the `contracts` shapes, and the FR4.9 viewer filtering.
 * No db access and no hub — `EncountersService` owns those.
 *
 * Two shapes this half has to live with (db-row contract shared with the
 * generator agent — see services/generator.ts):
 *   - `combatants` has no init_dice / edge / grunt columns; those ride in the
 *     `copilot` JSONB (`initDice`, `edge`, `grunt`, plus our `lastDamage`).
 *   - `encounters` has no active_combatant_id; the acting combatant is DERIVED
 *     (highest score that has not acted this pass), so nothing can drift.
 */
import { z } from 'zod';
import {
  CombatantMonitorsSchema,
  CombatantSourceSchema,
  EdgeStateSchema,
  GruntStateSchema,
  InitKindSchema,
  SheetV1Schema,
  StatusEffectSchema,
  type Combatant,
  type CombatantMonitors,
  type Encounter,
  type GruntState,
  type InitKind,
  type Role,
  type SheetV1,
  type StatusEffect,
  type Visibility,
} from '@safehouse/contracts';
import {
  deriveCharacter,
  nextActor as nextActorRules,
  turnOrder,
  type DamageResult,
  type DamageTrack,
  type MoraleReport,
} from '@safehouse/rules';
import { combatants, encounters } from '@safehouse/db';

export type EncounterRow = typeof encounters.$inferSelect;
export type CombatantRow = typeof combatants.$inferSelect;

// ---------------------------------------------------------------------------
// combatants.copilot — the JSONB side-channel
// ---------------------------------------------------------------------------

const UndoSnapshotSchema = z.object({
  monitors: CombatantMonitorsSchema,
  grunt: GruntStateSchema.optional(),
  initScore: z.number().int(),
  boxes: z.number().int().optional(),
  track: z.enum(['physical', 'stun']).optional(),
  note: z.string().optional(),
  ts: z.string(),
});
export type UndoSnapshot = z.infer<typeof UndoSnapshotSchema>;

const CopilotSchema = z
  .object({
    sheet: SheetV1Schema.optional(),
    initDice: z.number().int().min(0).max(5).optional(),
    edge: EdgeStateSchema.optional(),
    grunt: GruntStateSchema.optional(),
    /** GM flag for the FR10.9 "leader down" trigger. */
    leader: z.boolean().optional(),
    /** One-tap undo (FR4.5): the inverse of the last damage application. */
    lastDamage: UndoSnapshotSchema.optional(),
    generator: z.object({ professionalRating: z.number().optional() }).loose().optional(),
  })
  .loose();
export type CombatantCopilot = z.infer<typeof CopilotSchema>;

export const ZERO_MONITORS: CombatantMonitors = {
  physical: { max: 0, filled: 0 },
  stun: { max: 0, filled: 0 },
  overflow: { max: 0, filled: 0 },
};

export function parseCopilot(raw: unknown): CombatantCopilot {
  const parsed = CopilotSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function parseMonitors(raw: unknown): CombatantMonitors {
  const parsed = CombatantMonitorsSchema.safeParse(raw);
  return parsed.success ? parsed.data : ZERO_MONITORS;
}

export function parseEffects(raw: unknown): StatusEffect[] {
  const parsed = z.array(StatusEffectSchema).safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/** Row → contract `Combatant` (initDice/edge/grunt lifted out of copilot). */
export function serializeCombatant(row: CombatantRow): Combatant {
  const copilot = parseCopilot(row.copilot);
  const source = CombatantSourceSchema.safeParse(row.source);
  const kind = InitKindSchema.safeParse(row.initKind);
  return {
    id: row.id,
    encounterId: row.encounterId,
    tokenId: row.tokenId,
    source: source.success ? source.data : 'manual',
    sourceId: row.sourceId,
    name: row.name,
    initBase: row.initBase,
    initDice: copilot.initDice ?? 1,
    initScore: row.initScore,
    initKind: kind.success ? kind.data : 'physical',
    monitors: parseMonitors(row.monitors),
    effects: parseEffects(row.effects),
    visibility: row.visibility,
    actedThisPass: row.actedThisPass,
    ...(copilot.edge ? { edge: copilot.edge } : {}),
    ...(copilot.grunt ? { grunt: copilot.grunt } : {}),
    copilot: copilot as Record<string, unknown>,
  };
}

export function serializeEncounter(row: EncounterRow, list?: Combatant[]): Encounter {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sceneId: row.sceneId,
    name: row.name,
    state: row.state,
    turn: row.turn,
    pass: row.pass,
    activeCombatantId: list ? (nextActorRules(list)?.id ?? null) : null,
    ...(list ? { combatants: list } : {}),
  };
}

// ---------------------------------------------------------------------------
// Views (FR4.9: hidden combatants excluded server-side)
// ---------------------------------------------------------------------------

export type Condition = 'unharmed' | 'wounded' | 'bloodied' | 'down';

export function conditionOf(m: CombatantMonitors): Condition {
  if (m.physical.max > 0 && m.physical.filled >= m.physical.max) return 'down';
  if (m.stun.max > 0 && m.stun.filled >= m.stun.max) return 'down';
  const cap = m.physical.max + m.stun.max;
  const filled = m.physical.filled + m.stun.filled;
  if (filled === 0) return 'unharmed';
  return cap > 0 && filled * 2 >= cap ? 'bloodied' : 'wounded';
}

/** Physical track full — a casualty for the FR10.9 triggers. */
export function isDown(c: Combatant): boolean {
  return c.monitors.physical.max > 0 && c.monitors.physical.filled >= c.monitors.physical.max;
}

/** What a player/observer phone is allowed to know about a row (FR4.9). */
export interface PlayerCombatantView {
  id: string;
  name: string;
  source: Combatant['source'];
  initScore: number;
  initKind: InitKind;
  actedThisPass: boolean;
  /** True when this row is the viewer's own PC. */
  own: boolean;
  condition: Condition;
  /**
   * The token this row drives, when it has one — what lets the table TV put
   * the acting glow and the coarse condition bar on the right figure instead
   * of matching on display name (FR4.10/FR9.20).
   *
   * Safe on a filtered view: a row only reaches this list because it is
   * public or the viewer's own, and a public combatant's token is already on
   * that socket. A hidden combatant was dropped above, token and all.
   */
  tokenId?: string;
  /** Own PCs only — never another combatant's exact boxes. */
  monitors?: CombatantMonitors;
  effects: Array<{ id: string; name: string; note?: string }>;
}

export interface EncounterView {
  encounter: Encounter;
  combatants: Combatant[] | PlayerCombatantView[];
  activeCombatantId: string | null;
  turnOrder: string[];
  scope: 'gm' | 'player';
}

export interface Viewer {
  userId: string;
  role: Role;
}

/**
 * Compose the encounter for one viewer. GMs get everything; everyone else gets
 * turn order, their own monitors, and public condition only — GM-hidden
 * combatants are dropped before serialization, never hidden client-side.
 */
export function encounterForViewer(
  row: EncounterRow,
  list: Combatant[],
  viewer: Viewer,
  ownerByCombatantId: ReadonlyMap<string, string | null> = new Map(),
): EncounterView {
  const active = nextActorRules(list)?.id ?? null;
  if (viewer.role === 'gm') {
    return {
      encounter: serializeEncounter(row),
      combatants: list,
      activeCombatantId: active,
      turnOrder: turnOrder(list).map((c) => c.id),
      scope: 'gm',
    };
  }
  const visible = list.filter((c) => {
    if (c.visibility === 'public') return true;
    if (c.visibility === 'gm_owner') return ownerByCombatantId.get(c.id) === viewer.userId;
    return false;
  });
  const views: PlayerCombatantView[] = visible.map((c) => {
    const own = ownerByCombatantId.get(c.id) === viewer.userId;
    return {
      id: c.id,
      name: c.name,
      source: c.source,
      initScore: c.initScore,
      initKind: c.initKind,
      actedThisPass: c.actedThisPass,
      own,
      condition: conditionOf(c.monitors),
      ...(c.tokenId ? { tokenId: c.tokenId } : {}),
      ...(own ? { monitors: c.monitors } : {}),
      effects: c.effects.map((e) => ({
        id: e.id,
        name: e.name,
        ...(e.note ? { note: e.note } : {}),
      })),
    };
  });
  return {
    encounter: serializeEncounter(row),
    combatants: views,
    activeCombatantId: visible.some((c) => c.id === active) ? active : null,
    turnOrder: turnOrder(visible).map((c) => c.id),
    scope: 'player',
  };
}

// ---------------------------------------------------------------------------
// Inputs shared by the service pair
// ---------------------------------------------------------------------------

export interface AddCombatantInput {
  source?: Combatant['source'];
  sourceId?: string | null;
  name?: string;
  initBase?: number;
  initDice?: number;
  initScore?: number;
  initKind?: InitKind;
  monitors?: CombatantMonitors;
  visibility?: Visibility;
  tokenId?: string | null;
  edge?: { max: number; current: number };
  grunt?: { size: number; professionalRating: number; groupEdge?: number; labelPrefix?: string };
  leader?: boolean;
  sheet?: SheetV1;
}

export interface CombatantPatch {
  name?: string;
  initBase?: number;
  initDice?: number;
  initScore?: number;
  initKind?: InitKind;
  monitors?: CombatantMonitors;
  visibility?: Visibility;
  actedThisPass?: boolean;
  tokenId?: string | null;
  edge?: { max: number; current: number };
  grunt?: GruntState;
  leader?: boolean;
}

export interface DamageInput {
  encounterId: string;
  targetId: string;
  boxes: number;
  track: DamageTrack;
  /** Grunt groups: which member's tick row takes it (FR4.6). */
  memberIndex?: number;
  note?: string;
  painTolerance?: number;
}

export interface DamageOutcome {
  combatant: Combatant;
  result?: DamageResult;
  gruntMember?: { index: number; label: string; filled: number; down: boolean };
  morale?: (MoraleReport & { combatantId: string }) | null;
}

export interface InitiativeDetail {
  combatantId: string;
  kind: InitKind;
  base: number;
  dice: number;
  rolls: number[];
  woundModifier: number;
  score: number;
}

const INIT_LINE: Record<InitKind, 'physical' | 'astral' | 'matrixAR' | 'vrCold' | 'vrHot'> = {
  physical: 'physical',
  astral: 'astral',
  matrix_ar: 'matrixAR',
  vr_cold: 'vrCold',
  vr_hot: 'vrHot',
};

/** Initiative line + monitor sizes for a sheet under one init kind (FR4.2). */
export function deriveFor(
  sheet: SheetV1,
  kind: InitKind,
): { base: number; dice: number; monitors: CombatantMonitors } {
  const derived = deriveCharacter(sheet);
  const line = derived.initiative[INIT_LINE[kind]];
  return {
    base: line.base.value,
    dice: line.dice.value,
    monitors: {
      physical: { max: derived.monitors.physical.value, filled: 0 },
      stun: { max: derived.monitors.stun.value, filled: 0 },
      overflow: { max: derived.monitors.overflow.value, filled: 0 },
    },
  };
}
