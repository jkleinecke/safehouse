import { z } from 'zod';

/**
 * The attack exchange: one attack, handed from the attacker to the GM (or to
 * the runner it is aimed at), then defended, resisted and applied, a card at a
 * time. The design's pillar 3 — guided rolls, not automation — in data form.
 *
 * ## The shape of an exchange
 *
 * An attack settled with a target opens one. It carries what the attacker
 * DECLARED (the damage, the armor penetration, the defense penalty the fire
 * mode brings, a note), and the attack's hits after its limit. The defender's
 * card reads those facts from here, already filled in and labelled with whoever
 * declared them (the GM's decision of 2026-09-28: declared facts are not
 * judgement calls). Then:
 *
 *   awaiting_defense ── defense settled ──▶ miss or graze ──▶ done
 *                                          hit ──▶ awaiting_soak
 *   awaiting_soak ──── soak settled ─────▶ awaiting_apply
 *   awaiting_apply ─── the GM applies ───▶ done
 *
 * and `cancelled` from any open state (the GM narrated past it, a token went
 * away mid-exchange). A graze is contact without damage (p.173), so it closes
 * the exchange as surely as a miss does. A direct combat spell skips the soak:
 * the target's resistance roll IS its defense, and the boxes are the net hits
 * (p.283) — see `DeclaredDvSchema`.
 *
 * The maths is the rules engine's, one pure step per card (`defensePool`,
 * `resolveHit`, `damageAfterHit`, `soakPool`, `boxesAfterSoak` in
 * @safehouse/rules combat/attack.ts); this file only fixes what gets stored
 * and sent.
 *
 * ## Who sees what
 *
 * The GM's frame carries every open exchange. A player's frame carries only
 * the exchanges their own character started and the ones aimed at them, with
 * the other side's numbers taken OUT, not blanked: the defense, the net hits,
 * the damage, the soak and the boxes are all optional here, so a trimmed
 * exchange still validates. An attacking runner learns hit, graze or miss —
 * never the NPC's dice, armor or boxes (FR4.9, Principle 4). The server does
 * the trimming; nothing in this shape is safe to send to a player as it is.
 *
 * The vocabularies below are shared with the rules engine, which imports them
 * from here, so the catalogue and the contract cannot drift apart.
 */

const NonNegInt = z.number().int().min(0);

/**
 * What kind of attack is coming in, as far as the defender's choices care.
 * `ranged` includes an indirect combat spell, which is defended like a shot
 * (p.283); `direct-spell` is resisted, never defended (p.283); `suppressive`
 * is avoided with its own Reaction + Edge test (p.179). The rules engine's
 * catalogue decides which defenses answer which kind (`defenseOptions`).
 */
export const AttackKindSchema = z.enum(['ranged', 'melee', 'suppressive', 'direct-spell']);
export type AttackKind = z.infer<typeof AttackKindSchema>;

/** Physical or Stun, as the damage code writes it (`8P`, `6S`). */
export const DamageTypeSchema = z.enum(['P', 'S']);
export type DamageType = z.infer<typeof DamageTypeSchema>;

/** Which condition monitor the boxes land on. */
export const DamageTrackSchema = z.enum(['physical', 'stun']);
export type DamageTrack = z.infer<typeof DamageTrackSchema>;

/**
 * How the attack came out (p.173): more attack hits than defense hits is a
 * hit; a tie is a grazing hit — contact, but no damage; fewer is a miss. The
 * engine reads a tie at no hits each as a miss, since an attack with no hits
 * never touched anyone.
 */
export const HitOutcomeSchema = z.enum(['miss', 'graze', 'hit']);
export type HitOutcome = z.infer<typeof HitOutcomeSchema>;

/**
 * The firing modes a weapon can list (p.178-180): single shot,
 * semi-automatic, burst fire, full auto. The sheet's own mode strings are free
 * text ('SA/BF'); this is the code an exchange records once the attacker has
 * picked one.
 */
export const FireModeCodeSchema = z.enum(['SS', 'SA', 'BF', 'FA']);
export type FireModeCode = z.infer<typeof FireModeCodeSchema>;

/** Where an exchange stands (see the diagram in the header). */
export const ExchangeStateSchema = z.enum([
  'awaiting_defense',
  'awaiting_soak',
  'awaiting_apply',
  'done',
  'cancelled',
]);
export type ExchangeState = z.infer<typeof ExchangeStateSchema>;

/**
 * One side of the exchange: the tracker row, and the name to print on the
 * banner and in the log. The name is carried rather than looked up because a
 * player's frame may not hold the other row at all (a hidden NPC), and the
 * server can then put a vaguer name here without the banner going blank.
 */
export const ExchangePartySchema = z.object({
  combatantId: z.string().min(1),
  name: z.string(),
});
export type ExchangeParty = z.infer<typeof ExchangePartySchema>;

/**
 * What the attack was made with, as the sheet has it — the weapon's name for
 * the banner and the log, and the sheet's own numbers, so the GM can see at a
 * glance where a declaration differs from the gun (special ammunition, a
 * house call). Absent for an attack with no weapon on the sheet (a spell).
 */
export const ExchangeWeaponSchema = z.object({
  name: z.string().min(1),
  skillId: z.string().optional(),
  /** The sheet's damage code as written, e.g. '8P' or '(STR+2)P'. */
  dv: z.string().optional(),
  ap: z.number().int().optional(),
  acc: z.number().int().optional(),
});
export type ExchangeWeapon = z.infer<typeof ExchangeWeaponSchema>;

/**
 * Who made the declaration: the GM (an NPC's attack, or a GM's correction to
 * a runner's) or the player. The defender's card labels each declared fact
 * with it — "from Ari's attack".
 */
export const DeclaredBySchema = z.object({
  role: z.enum(['gm', 'player']),
  name: z.string(),
});
export type DeclaredBy = z.infer<typeof DeclaredBySchema>;

/**
 * The attack's Damage Value and type before net hits are added (p.173). A
 * direct combat spell declares 0: its boxes are its net hits and nothing
 * else, and the target does not resist them (p.283), so 0 + net hits with no
 * soak comes out right without a special case.
 */
export const DeclaredDvSchema = z.object({
  value: NonNegInt,
  type: DamageTypeSchema,
});
export type DeclaredDv = z.infer<typeof DeclaredDvSchema>;

/**
 * Anything else the attacker tells the defender that changes the defense: a
 * shotgun's spread, a called shot's effect. `id` is the situational modifier
 * it stands for when there is one (e.g. `spread_medium`), so the defender's
 * card can arrive with that offer ticked; `value` is the dice it is worth.
 */
export const DeclaredExtraSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(80),
  value: z.number().int().optional(),
  note: z.string().max(200).optional(),
});
export type DeclaredExtra = z.infer<typeof DeclaredExtraSchema>;

/**
 * The facts of the attack the defender answers — the "tell the GM" block on
 * the attacker's card, filled in from the weapon and the fire mode, and
 * editable by the attacker before the dice (special ammunition changes AP and
 * DV). None of it is a judgement call, which is why the defender's card
 * arrives with it applied.
 */
export const ExchangeDeclarationSchema = z.object({
  dv: DeclaredDvSchema,
  /** Armor Penetration (p.169): negative pierces the armor, positive adds to it. */
  ap: z.number().int().default(0),
  /** The fire mode used, for a firearm. */
  mode: FireModeCodeSchema.optional(),
  /** Rounds the action fired (p.180). */
  rounds: z.number().int().min(1).optional(),
  /**
   * What the fire mode does to the defense test (p.180): −2 for a burst, −5
   * for a long burst or a Simple full-auto, −9 for a Complex full-auto, one
   * less for each round short. 0 for a single shot and for anything that is
   * not a firearm.
   */
  defenseModifier: z.number().int().max(0).default(0),
  extras: z.array(DeclaredExtraSchema).default([]),
  note: z.string().max(500).optional(),
  by: DeclaredBySchema,
});
export type ExchangeDeclaration = z.infer<typeof ExchangeDeclarationSchema>;
export type ExchangeDeclarationInput = z.input<typeof ExchangeDeclarationSchema>;

/**
 * The defender's answer: which action they took (`defense`, `full_defense`,
 * `dodge`, `block`, `parry`, or a spell resistance — the catalogue's ids), the
 * roll it made and its hits AFTER any limit (Dodge, Block and Parry bring
 * [Physical], p.188), and the offers that were ticked, so the log can say why
 * the pool was what it was.
 *
 * `noDefense` is the "unaware" switch (p.189): no test at all, the attack
 * becomes a Success Test, `hits` is 0 and there is no roll.
 */
export const ExchangeDefenseSchema = z.object({
  actionId: z.string().min(1),
  rollId: z.string().nullable(),
  hits: NonNegInt,
  offersOn: z.array(z.string()).default([]),
  noDefense: z.literal(true).optional(),
});
export type ExchangeDefense = z.infer<typeof ExchangeDefenseSchema>;

/**
 * The damage a hit brings, before the soak (p.168-169, 173): the modified DV
 * (declared DV + net hits), the armor and the armor after AP (never below 0),
 * and whether Physical became Stun because the modified DV was lower than the
 * modified armor. `type` is the type AFTER that conversion.
 */
export const ExchangeDamageSchema = z.object({
  modifiedDv: NonNegInt,
  type: DamageTypeSchema,
  armor: NonNegInt,
  modifiedArmor: NonNegInt,
  convertedToStun: z.boolean(),
});
export type ExchangeDamage = z.infer<typeof ExchangeDamageSchema>;

/** The damage resistance roll (Body + armor, no wound modifier, p.170) and its hits. */
export const ExchangeSoakSchema = z.object({
  rollId: z.string(),
  hits: NonNegInt,
});
export type ExchangeSoak = z.infer<typeof ExchangeSoakSchema>;

/** One attack exchange (see the header). */
export const ExchangeSchema = z.object({
  id: z.string(),
  encounterId: z.string(),
  /**
   * The Combat Turn it was opened in. An exchange still open when the turn
   * ends is closed with it, so a stale banner never outlives its fight turn.
   */
  turn: NonNegInt,
  /** The catalogue action that opened it: `fire_sa`, `melee_attack`, `cast_spell`, … */
  actionId: z.string().min(1),
  /** What the defender is answering, which decides the defenses on offer. */
  attack: AttackKindSchema,
  attacker: ExchangePartySchema,
  target: ExchangePartySchema,
  weapon: ExchangeWeaponSchema.optional(),
  declared: ExchangeDeclarationSchema,
  /**
   * The attack roll — app dice or table dice, both leave a record — and its
   * hits after the limit (a weapon's Accuracy, p.168).
   */
  attackRollId: z.string(),
  attackHits: NonNegInt,
  defense: ExchangeDefenseSchema.optional(),
  /** Attack hits less defense hits, as the engine reports it; negative on a clear miss. */
  netHits: z.number().int().optional(),
  outcome: HitOutcomeSchema.optional(),
  damage: ExchangeDamageSchema.optional(),
  soak: ExchangeSoakSchema.optional(),
  /** Boxes to apply once the soak is in, and the monitor they land on. */
  boxes: NonNegInt.optional(),
  track: DamageTrackSchema.optional(),
  state: ExchangeStateSchema,
  /** ISO timestamp. */
  createdAt: z.string(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;
export type ExchangeInput = z.input<typeof ExchangeSchema>;
