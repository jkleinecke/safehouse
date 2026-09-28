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
 *     (the first row in the order that has not acted this pass and is not
 *     holding a Delayed Action), so nothing can drift.
 *
 * The order itself is derived too, in one place (`@safehouse/rules`
 * `turnOrder`), from three things this file reads off the rows: the fight's
 * stored manual order (`encounters.manual_order`), each row's seize and delay
 * flags (in `copilot`), and the ERIC tie-break attributes, which the service
 * reads off the sheets only when two scores tie (`orderOptionsOf`).
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
  type EricAttributes,
  type MoraleReport,
  type TurnOrderOptions,
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
  /** Undoing it puts that exchange back to awaiting apply. */
  exchangeId: z.string().optional(),
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
    /**
     * Holding a Delayed Action (SR5 p.161). Lifted onto the row as
     * `Combatant.delayed`; carries across passes, cleared by a new Combat Turn
     * and by acting ("Act now").
     */
    delayed: z.boolean().optional(),
    /**
     * Seized the Initiative this Combat Turn (SR5 p.160-161). Lifted onto the
     * row as `Combatant.seized`; cleared by a new Combat Turn.
     */
    seized: z.boolean().optional(),
    /**
     * This Action Phase is a Delayed Action being used: the row was holding
     * one and the GM pressed "Act now". Its actions take -1 die (p.161; the
     * catalogue's `delayed_action`), which a guided roll card reads from here.
     * Cleared when the row is marked done, at the end of the pass, and by a
     * new Combat Turn.
     */
    delayedAction: z.boolean().optional(),
    /** The Combat Turn Full Defense was taken in (+WIL to defenses for that turn, p.168). */
    fullDefenseTurn: z.number().int().optional(),
    /** Defense tests since the row last acted (p.189); cleared when it is marked done. */
    defendedSinceAction: z.number().int().min(0).optional(),
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
    ...(copilot.delayed ? { delayed: true } : {}),
    ...(copilot.seized ? { seized: true } : {}),
    ...(copilot.edge ? { edge: copilot.edge } : {}),
    ...(copilot.grunt ? { grunt: copilot.grunt } : {}),
    copilot: copilot as Record<string, unknown>,
  };
}

/**
 * Row -> contract `Encounter`: the header only. The acting row and the order
 * are derived per viewer and travel beside it (`encounterForViewer`, the
 * `encounter.updated` frames), so `activeCombatantId` here is always null.
 *
 * `visible`, when given, is the ids of the rows the reader may know about:
 * the manual order then names only those. A player's view must never carry a
 * hidden combatant's id (FR4.9 / Principle 4), and a manual order the GM
 * arranged with an ambusher in it would otherwise do exactly that. An empty
 * set leaves `[]` for "the GM has arranged the order", with no names in it.
 */
export function serializeEncounter(row: EncounterRow, visible?: ReadonlySet<string>): Encounter {
  const manual = manualOrderOf(row);
  return {
    id: row.id,
    campaignId: row.campaignId,
    sceneId: row.sceneId,
    name: row.name,
    state: row.state,
    turn: row.turn,
    pass: row.pass,
    activeCombatantId: null,
    manualOrder: manual && visible ? manual.filter((id) => visible.has(id)) : manual,
    handRolls: row.handRolls,
  };
}

/** The stored manual order, read defensively (jsonb): null unless a list of ids. */
export function manualOrderOf(row: EncounterRow): string[] | null {
  const raw: unknown = row.manualOrder;
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((id): id is string => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}

/**
 * Everything `turnOrder` needs from the fight: the stored manual order, the
 * ERIC attributes the service read for tied rows (`EncountersService.ericFor`),
 * and the coin, seeded with the fight and its Combat Turn: the same toss on
 * every read this turn, a fresh one next turn (SR5 p.159).
 */
export function orderOptionsOf(
  row: EncounterRow,
  eric: Readonly<Record<string, EricAttributes>> = {},
): TurnOrderOptions {
  return { manualOrder: manualOrderOf(row), eric, coin: `${row.id}:${row.turn}` };
}

/**
 * The ERIC tie-break off a sheet (SR5 p.159): Edge (the attribute, not what
 * is left of it to spend), and Reaction and Intuition as they stand after
 * cyberware, bioware and magic, the values the character actually tests with.
 */
export function ericOf(sheet: SheetV1): EricAttributes {
  const attrs = deriveCharacter(sheet).attributes;
  return {
    edg: attrs['edg']?.value ?? sheet.attributes.edg.max,
    rea: attrs['rea']?.value ?? sheet.attributes.rea,
    int: attrs['int']?.value ?? sheet.attributes.int,
  };
}

/**
 * Rows whose score another live row shares: the only ones the ERIC chain can
 * matter for, so the only ones worth reading and deriving a sheet for. Most
 * frames have none, and then no sheet is read at all.
 */
export function rowsTiedOnScore(list: readonly Combatant[]): Combatant[] {
  const counts = new Map<number, number>();
  for (const c of list) {
    if (c.initScore > 0) counts.set(c.initScore, (counts.get(c.initScore) ?? 0) + 1);
  }
  return list.filter((c) => c.initScore > 0 && (counts.get(c.initScore) ?? 0) > 1);
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
  /** Holding a Delayed Action (p.161): the table sees someone waiting to act. */
  delayed?: true;
  /** Seized the Initiative this Combat Turn (p.160-161): the spend was said out loud. */
  seized?: true;
  /** True when this row is the viewer's own PC. */
  own: boolean;
  /**
   * The initiative line — how many dice to roll and what to add — on the
   * party's rows (FR4.2): a runner rolling their own initiative from a phone
   * has to be able to read it, and a teammate's is no secret at the table.
   * An NPC's line stays the GM's (FR4.9: presence and condition only).
   */
  initBase?: number;
  initDice?: number;
  condition: Condition;
  /**
   * The token this row drives, when it has one — what lets the table TV put
   * the acting glow and the coarse condition bar on the right figure instead
   * of matching on display name (FR4.10/FR9.20).
   *
   * Only when the table HAS that token (`encounterForViewer`'s
   * `tokensOnTable`): on the active scene and not concealed there. A row is
   * public from the moment it is staged, and nothing re-derives it; a guard
   * staged in the open who then walks into the dark keeps his public row, and
   * his token id on it was the table's way of knowing which of the tokens it
   * would later be sent was him, and that he was still on the map somewhere.
   * The name and the condition stay (the fight has him in it); the link to
   * the map goes until his token is back on it. A hidden combatant was
   * dropped above, token and all.
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
 *
 * `tokensOnTable` is the ids of the tokens the table has right now
 * (`ScenesService.tokensOnTable`: on the active scene, not concealed there).
 * A row names its token (`tokenId`) to a non-GM viewer only when its token
 * is one of them. Left out, no row names its token: the TV then matches rows
 * to figures by name, and a caller that forgot the set costs a glow, never a
 * guard's id.
 */
export function encounterForViewer(
  row: EncounterRow,
  list: Combatant[],
  viewer: Viewer,
  ownerByCombatantId: ReadonlyMap<string, string | null> = new Map(),
  tokensOnTable: ReadonlySet<string> = new Set(),
  eric: Readonly<Record<string, EricAttributes>> = {},
): EncounterView {
  // ONE order for the whole fight, worked out over every row and only then
  // cut down to what this viewer may see. Ordering the visible rows on their
  // own could slot a late joiner differently, and the table would disagree.
  const opts = orderOptionsOf(row, eric);
  const order = turnOrder(list, opts).map((c) => c.id);
  const active = nextActorRules(list, opts)?.id ?? null;
  if (viewer.role === 'gm') {
    return {
      encounter: serializeEncounter(row),
      combatants: list,
      activeCombatantId: active,
      turnOrder: order,
      scope: 'gm',
    };
  }
  const visible = list.filter((c) => {
    if (c.visibility === 'public') return true;
    if (c.visibility === 'gm_owner') return ownerByCombatantId.get(c.id) === viewer.userId;
    return false;
  });
  const visibleIds = new Set(visible.map((c) => c.id));
  const views: PlayerCombatantView[] = visible.map((c) => {
    const own = ownerByCombatantId.get(c.id) === viewer.userId;
    return {
      id: c.id,
      name: c.name,
      source: c.source,
      initScore: c.initScore,
      initKind: c.initKind,
      actedThisPass: c.actedThisPass,
      ...(c.delayed ? { delayed: true as const } : {}),
      ...(c.seized ? { seized: true as const } : {}),
      own,
      ...(own || c.source === 'character' ? { initBase: c.initBase, initDice: c.initDice } : {}),
      condition: conditionOf(c.monitors),
      ...(c.tokenId && tokensOnTable.has(c.tokenId) ? { tokenId: c.tokenId } : {}),
      ...(own ? { monitors: c.monitors } : {}),
      effects: c.effects.map((e) => ({
        id: e.id,
        name: e.name,
        ...(e.note ? { note: e.note } : {}),
      })),
    };
  });
  return {
    encounter: serializeEncounter(row, visibleIds),
    combatants: views,
    activeCombatantId: active !== null && visibleIds.has(active) ? active : null,
    turnOrder: order.filter((id) => visibleIds.has(id)),
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
