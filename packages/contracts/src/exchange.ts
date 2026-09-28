import { z } from 'zod';

/**
 * One attack exchange (SR5 p.173), a card at a time:
 *
 *   awaiting_defense ── defense ──▶ miss or graze ──▶ done
 *                                   hit ──▶ awaiting_soak
 *   awaiting_soak ──── soak ─────▶ awaiting_apply ── the GM applies ──▶ done
 *
 * `cancelled` from any open state and at the turn's end. A direct combat spell
 * skips the soak (p.283). Players get only their own side (`playerCopy`).
 */

const NonNegInt = z.number().int().min(0);

/** `ranged` includes an indirect spell (p.283); `direct-spell` is resisted, never defended. */
export const AttackKindSchema = z.enum(['ranged', 'melee', 'suppressive', 'direct-spell']);
export type AttackKind = z.infer<typeof AttackKindSchema>;

export const DamageTypeSchema = z.enum(['P', 'S']);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const DamageTrackSchema = z.enum(['physical', 'stun']);
export type DamageTrack = z.infer<typeof DamageTrackSchema>;

/** p.173: more hits is a hit, a tie a graze (contact, no damage), fewer a miss. */
export const HitOutcomeSchema = z.enum(['miss', 'graze', 'hit']);
export type HitOutcome = z.infer<typeof HitOutcomeSchema>;

/** Single shot, semi-auto, burst, full auto (p.178-180). */
export const FireModeCodeSchema = z.enum(['SS', 'SA', 'BF', 'FA']);
export type FireModeCode = z.infer<typeof FireModeCodeSchema>;

export const ExchangeStateSchema = z.enum([
  'awaiting_defense',
  'awaiting_soak',
  'awaiting_apply',
  'done',
  'cancelled',
]);
export type ExchangeState = z.infer<typeof ExchangeStateSchema>;

/** The name is carried: a player's copy may not know the row (a hidden NPC has no id there). */
export const ExchangePartySchema = z.object({
  combatantId: z.string().min(1).optional(),
  name: z.string(),
});
export type ExchangeParty = z.infer<typeof ExchangePartySchema>;

/** The sheet's own numbers, so a declaration that differs from the gun shows. */
export const ExchangeWeaponSchema = z.object({
  name: z.string().min(1),
  skillId: z.string().optional(),
  dv: z.string().optional(),
  ap: z.number().int().optional(),
  acc: z.number().int().optional(),
});
export type ExchangeWeapon = z.infer<typeof ExchangeWeaponSchema>;

/** Who declared the attack's facts; the defender's card labels them with it. */
export const DeclaredBySchema = z.object({
  role: z.enum(['gm', 'player']),
  name: z.string(),
});
export type DeclaredBy = z.infer<typeof DeclaredBySchema>;

/** DV before net hits (p.173). A direct combat spell declares 0: its boxes are the net hits (p.283). */
export const DeclaredDvSchema = z.object({
  value: NonNegInt,
  type: DamageTypeSchema,
});
export type DeclaredDv = z.infer<typeof DeclaredDvSchema>;

/** A fact that changes the defense (spread, a called shot); `id` ticks that offer on the defender's card. */
export const DeclaredExtraSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(80),
  value: z.number().int().optional(),
  note: z.string().max(200).optional(),
});
export type DeclaredExtra = z.infer<typeof DeclaredExtraSchema>;

/** The attacker's "tell the GM" block: not judgement calls, so the defender's card arrives with them on. */
export const ExchangeDeclarationSchema = z.object({
  dv: DeclaredDvSchema,
  /** p.169: negative pierces armor. */
  ap: z.number().int().default(0),
  mode: FireModeCodeSchema.optional(),
  rounds: z.number().int().min(1).optional(),
  /** The fire mode's defense penalty (p.180), one less per round short. */
  defenseModifier: z.number().int().max(0).default(0),
  extras: z.array(DeclaredExtraSchema).default([]),
  note: z.string().max(500).optional(),
  by: DeclaredBySchema,
});
export type ExchangeDeclaration = z.infer<typeof ExchangeDeclarationSchema>;
export type ExchangeDeclarationInput = z.input<typeof ExchangeDeclarationSchema>;

/** Hits are after any limit (Dodge brings [Physical], p.188). `noDefense`: unaware, no test (p.189). */
export const ExchangeDefenseSchema = z.object({
  actionId: z.string().min(1),
  rollId: z.string().nullable(),
  hits: NonNegInt,
  offersOn: z.array(z.string()).default([]),
  noDefense: z.literal(true).optional(),
  /** Out of the attack, no test: Hit the Dirt under suppressive fire (p.179-180). */
  avoided: z.literal(true).optional(),
});
export type ExchangeDefense = z.infer<typeof ExchangeDefenseSchema>;

/** Modified DV against AP-modified armor (p.168-169); `type` is after the Stun conversion. */
export const ExchangeDamageSchema = z.object({
  modifiedDv: NonNegInt,
  type: DamageTypeSchema,
  armor: NonNegInt,
  modifiedArmor: NonNegInt,
  convertedToStun: z.boolean(),
});
export type ExchangeDamage = z.infer<typeof ExchangeDamageSchema>;

/** Body + armor, no wound modifier (p.170). */
export const ExchangeSoakSchema = z.object({
  rollId: z.string(),
  hits: NonNegInt,
});
export type ExchangeSoak = z.infer<typeof ExchangeSoakSchema>;

export const ExchangeSchema = z.object({
  id: z.string(),
  encounterId: z.string(),
  /** Closed with this Combat Turn if still open. */
  turn: NonNegInt,
  /** The catalogue action; absent when the GM entered the attack by hand. */
  actionId: z.string().min(1).optional(),
  attack: AttackKindSchema,
  attacker: ExchangePartySchema.optional(),
  target: ExchangePartySchema,
  weapon: ExchangeWeaponSchema.optional(),
  declared: ExchangeDeclarationSchema,
  /** Null: the GM typed the table's hits. Both absent on a target's copy. */
  attackRollId: z.string().nullable().optional(),
  attackHits: NonNegInt.optional(),
  defense: ExchangeDefenseSchema.optional(),
  netHits: z.number().int().optional(),
  outcome: HitOutcomeSchema.optional(),
  damage: ExchangeDamageSchema.optional(),
  soak: ExchangeSoakSchema.optional(),
  boxes: NonNegInt.optional(),
  track: DamageTrackSchema.optional(),
  state: ExchangeStateSchema,
  /** ISO; set once the boxes are on the monitor, cleared by an undo. */
  appliedAt: z.string().optional(),
  createdAt: z.string(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;
export type ExchangeInput = z.input<typeof ExchangeSchema>;
