/**
 * One attack exchange, in the steps the book resolves it (SR5 p.173, the
 * "DADA" sequence): the attack roll, the defense roll, net hits, the damage
 * code against the armor, the damage resistance roll, boxes.
 *
 * ## Two ways to use it
 *
 * The guided flow in Play mode walks an exchange one card at a time — the
 * attacker rolls, then the defender picks a defense and rolls, then the
 * defender soaks — often with the table's own dice, so each step has to be
 * callable on its own with numbers someone typed in:
 *
 * - `defensePool` — Reaction + Intuition, plus Full Defense's Willpower and
 *   one of Dodge, Block or Parry, with the [Physical] limit those bring.
 * - `resolveHit` — attack hits against defense hits: hit, graze or miss.
 * - `damageAfterHit` — the modified DV against the AP-modified armor, and
 *   whether the damage stays Physical.
 * - `soakPool` — Body plus the AP-modified armor, with no wound modifiers.
 * - `boxesAfterSoak` — what gets past the soak, and on which track.
 *
 * `resolveAttackChain` is the one-click version the GM's ResolveChainDialog
 * uses: it composes the same steps, rolling each pool itself unless the
 * server hands it pre-rolled dice.
 *
 * Every rule here was read off the GM's own core rulebook (printed page =
 * PDF page − 5), and the tests walk the book's own worked examples (p.170,
 * 174, 191).
 */
import type {
  CombatantMonitors,
  LimitRef,
  ProvenanceEntry,
  RollResult,
  SheetWeapon,
} from '@safehouse/contracts';
import { lineRef } from '../refs.js';
import { combatAction } from './actions.js';
import { poolTotal, rollCombatPool } from './roll.js';
import {
  applyDamage,
  computeWoundModifier,
  type DamageResult,
  type DamageTrack,
} from './damage.js';

export type DamageType = 'P' | 'S';

/** A parsed user-entered damage code such as '8P', '10S(e)', '(STR+2)P'. */
export interface ParsedDamageCode {
  value: number;
  type: DamageType;
  /** Trailing tag like '(e)' or '(f)' — carried through for the card, not interpreted. */
  tag?: string;
  raw: string;
}

/**
 * Parse a damage code. Supports plain codes ('8P', '10S(e)') and STR-based
 * melee codes ('(STR+2)P', 'STR-1S') given the attacker's STR. Returns null
 * when unreadable — the chain then asks for manual entry (Principle 5).
 */
export function parseDamageCode(dv: string, str = 0): ParsedDamageCode | null {
  const raw = dv.trim();
  let m = /^(\d+)\s*([PS])\s*(\(.+\))?$/i.exec(raw);
  if (m && m[1] && m[2]) {
    return {
      value: Number.parseInt(m[1], 10),
      type: m[2].toUpperCase() as DamageType,
      ...(m[3] ? { tag: m[3] } : {}),
      raw,
    };
  }
  m = /^\(?\s*STR\s*([+-]\s*\d+)?\s*\)?\s*([PS])\s*(\(.+\))?$/i.exec(raw);
  if (m && m[2]) {
    const bump = m[1] ? Number.parseInt(m[1].replace(/\s+/g, ''), 10) : 0;
    return {
      value: Math.max(0, str + bump),
      type: m[2].toUpperCase() as DamageType,
      ...(m[3] ? { tag: m[3] } : {}),
      raw,
    };
  }
  return null;
}

/**
 * A participant in an attack chain. Deliberately independent of
 * `deriveCharacter` output: the caller supplies the already-derived numbers
 * (pools carry provenance upstream; here we take the totals plus the handful
 * of attributes the chain formulas need).
 */
export interface CombatActor {
  name?: string;
  /** BOD (soak), REA + INT (defense); STR feeds melee DV, WIL full defense. */
  attributes: { bod: number; rea: number; int: number; str?: number; wil?: number };
  /** Attribute + skill (+ gear) dice for the attack, before situational mods. */
  attackPool?: number;
  /** Worn armor rating (modified armor value before AP). */
  armor?: number;
  /**
   * The Physical limit, as the sheet derives it (qualities and augmentations
   * included). Dodge, Block and Parry bring a skill into the defense test and
   * this limit with it (p.188, 191). Left out, it is worked out from STR, BOD
   * and REA the way the sheet does before any modifiers; with no STR either,
   * the active defense rolls without a limit.
   */
  physicalLimit?: number;
  /** Wound modifier (negative). Derived from `monitors` when omitted. */
  woundModifier?: number;
  /** When present, the chain can apply the resulting boxes (FR4.5). */
  monitors?: CombatantMonitors;
}

function woundEntry(actor: Pick<CombatActor, 'woundModifier' | 'monitors'>): ProvenanceEntry | null {
  const wm =
    actor.woundModifier ?? (actor.monitors ? computeWoundModifier(actor.monitors) : 0);
  return wm !== 0 ? { label: 'Wounds', value: wm, source: 'wound', ref: lineRef('wounds') } : null;
}

/** The actor's Physical limit: the sheet's when given, else ⌈(STR×2 + BOD + REA) / 3⌉, else unknown. */
function physicalLimitOf(actor: Pick<CombatActor, 'attributes' | 'physicalLimit'>): number | undefined {
  if (actor.physicalLimit !== undefined) return actor.physicalLimit;
  const { str, bod, rea } = actor.attributes;
  return str === undefined ? undefined : Math.ceil((str * 2 + bod + rea) / 3);
}

// ---------------------------------------------------------------------------
// Step 3A: the defense test (p.173, 188-192)
// ---------------------------------------------------------------------------

/** The Interrupts that add a skill to one defense test (p.168, 188). */
export type ActiveDefenseId = 'dodge' | 'block' | 'parry';

/**
 * Dodge, Block or Parry on this one defense test (p.168, 188, 191-192): the
 * skill it adds and that skill's rating on the defender's sheet. Each costs
 * 5 Initiative Score, which the caller charges (`applyInterrupt`); the pool
 * only needs the dice.
 */
export interface ActiveDefense {
  id: ActiveDefenseId;
  /** Gymnastics for a Dodge, Unarmed Combat for a Block, the melee weapon's skill for a Parry. */
  rating: number;
  /**
   * The skill's name on the receipt line. Worth giving for a Parry, where it
   * is the weapon's own skill ('Blades (Parry)'); Dodge and Block name theirs.
   */
  skill?: string;
}

const ACTIVE_DEFENSE_SKILL: Readonly<Record<ActiveDefenseId, string>> = {
  dodge: 'Gymnastics',
  block: 'Unarmed Combat',
  parry: 'Melee weapon skill',
};

export interface DefenseOptions {
  /**
   * The defender is on Full Defense: +WIL on every defense test for the rest
   * of the Combat Turn (p.168). It stacks with a Dodge, Block or Parry
   * (p.188). The 10-point Initiative cost is charged separately.
   */
  fullDefense?: boolean;
  /** Dodge, Block or Parry on this test. */
  active?: ActiveDefense;
  /**
   * The situational lines the GM ticked: cover, the fire mode's penalty,
   * previous defenses, reach, prone and the rest (p.189-190). Negative values
   * subtract. Wounds are not among them — the defender's own wound line is
   * added here (p.189, "Defender wounded").
   */
  modifiers?: ProvenanceEntry[];
}

/** A defense pool with its receipt, ready to roll or to count the table's dice against. */
export interface DefensePool {
  pool: number;
  breakdown: ProvenanceEntry[];
  /**
   * [Physical] once Dodge, Block or Parry brings a skill in (p.188; p.191:
   * a skill in the test brings a limit with it). The plain test and Full
   * Defense alone are attributes only and have none (p.47, 173).
   */
  limit?: LimitRef;
  fullDefense: boolean;
  active?: ActiveDefenseId;
}

/**
 * The defense test's pool (p.173 step 3A, p.188): Reaction + Intuition,
 * free, with no limit. On Full Defense add Willpower (p.168). A Dodge adds
 * Gymnastics, a Block Unarmed Combat and a Parry the melee weapon's skill,
 * each for this one test and each bringing the Physical limit (p.188, 191).
 * Then the defender's wound modifier, then the GM's situational lines.
 *
 * Which defenses a given attack allows is the action catalogue's business
 * (`defenseOptions`): the table lets Dodge answer ranged attacks too, and
 * keeps Block and Parry to melee.
 */
export function defensePool(
  defender: Pick<CombatActor, 'attributes' | 'physicalLimit' | 'woundModifier' | 'monitors'>,
  opts: DefenseOptions = {},
): DefensePool {
  const fullDefense = opts.fullDefense ?? false;
  const breakdown: ProvenanceEntry[] = [
    { label: 'REA', value: defender.attributes.rea },
    { label: 'INT', value: defender.attributes.int },
  ];
  if (fullDefense) {
    breakdown.push({
      label: 'WIL (Full Defense)',
      value: defender.attributes.wil ?? 0,
      ref: lineRef('fullDefense'),
    });
  }
  let limit: LimitRef | undefined;
  const active = opts.active;
  if (active) {
    const action = combatAction(active.id);
    breakdown.push({
      label: `${active.skill ?? ACTIVE_DEFENSE_SKILL[active.id]} (${action?.name ?? active.id})`,
      value: active.rating,
      source: 'skill',
      ...(action ? { ref: action.ref } : {}),
    });
    const physical = physicalLimitOf(defender);
    if (physical !== undefined) limit = { kind: 'physical', value: physical };
  }
  const wounds = woundEntry(defender);
  if (wounds) breakdown.push(wounds);
  breakdown.push(...(opts.modifiers ?? []));
  return {
    pool: poolTotal(breakdown),
    breakdown,
    ...(limit ? { limit } : {}),
    fullDefense,
    ...(active ? { active: active.id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Step 3A, the comparison: hit, graze or miss (p.173)
// ---------------------------------------------------------------------------

/** How an attack came out (p.173). */
export type HitOutcome = 'miss' | 'graze' | 'hit';

export interface HitResult {
  /** Attack hits minus defense hits. Positive only for a hit; 0 for a graze; negative (or 0) for a miss. */
  netHits: number;
  outcome: HitOutcome;
}

/**
 * Compare the attacker's hits with the defender's (p.173 step 3A). Both are
 * counted after their limits — the attack's Accuracy, a Dodge's Physical —
 * because limits apply before an Opposed Test compares hits (p.47).
 *
 * - More hits than the defender: a hit, and the difference is the net hits
 *   added to the DV.
 * - A tie: a grazing hit (p.173). It does no damage, but the attacker makes
 *   contact, so a contact-only attack (a toxin, shock gloves, a touch spell)
 *   still lands. Against a target in cover a tie also means the shot hit the
 *   cover (p.190); what that does to the barrier is the GM's call (p.197).
 * - Fewer: a miss.
 *
 * A tie at nothing apiece is a miss, not a graze. The book does not spell out
 * the zero case; our reading is that a graze is contact, and an attack that
 * scored no hits never reached the target to make any.
 */
export function resolveHit(attackHits: number, defenseHits: number): HitResult {
  const attack = Math.max(0, Math.floor(attackHits));
  const netHits = attack - Math.max(0, Math.floor(defenseHits));
  if (netHits > 0) return { netHits, outcome: 'hit' };
  if (netHits === 0 && attack > 0) return { netHits, outcome: 'graze' };
  return { netHits, outcome: 'miss' };
}

// ---------------------------------------------------------------------------
// Step 3B: modified DV against modified armor (p.168-169, 173)
// ---------------------------------------------------------------------------

/**
 * The armor rating after the attack's AP (p.169). Negative AP lowers it, but
 * never below 0 — armor stripped to nothing leaves Body alone and does not
 * eat into it. Positive AP (a weapon that fares badly against armor) raises
 * it, but only on a target who is wearing some: bare skin stays at 0.
 */
export function armorAfterAp(armor: number, ap: number): number {
  return armor > 0 ? Math.max(0, armor + ap) : 0;
}

/** The damage an attack does once it hits, before the soak. */
export interface HitDamage {
  base: ParsedDamageCode;
  /** Base DV + net hits. */
  modifiedDv: number;
  ap: number;
  armor: number;
  /** The armor after AP (`armorAfterAp`). */
  modifiedArmor: number;
  /** Final damage type after the DV-vs-armor comparison. */
  type: DamageType;
  /** A Physical attack whose modified DV fell short of the modified armor, now Stun. */
  convertedToStun: boolean;
}

export interface DamageAfterHitInput {
  /** The weapon's damage code, parsed (`parseDamageCode`) or declared by hand. */
  base: ParsedDamageCode;
  /** The attack's net hits. Only a hit does damage; anything below 0 counts as 0. */
  netHits: number;
  /** The defender's armor rating before AP. */
  armor: number;
  /** The attack's Armor Penetration (negative lowers armor). */
  ap: number;
}

/**
 * What a hit does before the soak (p.173 step 3B): the net hits add to the
 * DV, AP modifies the armor, and a Physical attack whose modified DV is
 * LESS than the modified armor becomes Stun (p.168). Equal stays Physical —
 * "greater than or equal to" on p.173. A Stun attack stays Stun whatever the
 * armor. Called after a hit; a graze does no damage (p.173).
 */
export function damageAfterHit(input: DamageAfterHitInput): HitDamage {
  const { base, ap } = input;
  const armor = Math.max(0, input.armor);
  const modifiedArmor = armorAfterAp(armor, ap);
  const modifiedDv = base.value + Math.max(0, input.netHits);
  const convertedToStun = base.type === 'P' && modifiedDv < modifiedArmor;
  return {
    base,
    modifiedDv,
    ap,
    armor,
    modifiedArmor,
    type: convertedToStun ? 'S' : base.type,
    convertedToStun,
  };
}

// ---------------------------------------------------------------------------
// Step 3B, the roll: damage resistance (p.169-170, 173)
// ---------------------------------------------------------------------------

export interface SoakOptions {
  /** The attack's Armor Penetration. */
  ap?: number;
  /** Anything the GM adds or takes away. Wound modifiers are never among them (p.170). */
  modifiers?: ProvenanceEntry[];
}

/** A damage resistance pool with its receipt. */
export interface SoakPool {
  pool: number;
  breakdown: ProvenanceEntry[];
  armor: number;
  modifiedArmor: number;
}

/**
 * The damage resistance pool (p.173 step 3B): Body + the AP-modified armor,
 * or Body alone once AP takes the armor to 0 (p.169). The AP line on the
 * receipt is what AP actually did to the armor — nothing on bare skin, and
 * never past zero — so the lines add up to Body + modified armor as the book
 * prints it. No wound modifiers: they apply to every test except the ones
 * that reduce the boxes you are about to take (p.170). No limit either — an
 * attribute plus armor is not a skill test (p.47).
 */
export function soakPool(
  defender: Pick<CombatActor, 'attributes' | 'armor'>,
  opts: SoakOptions = {},
): SoakPool {
  const armor = Math.max(0, defender.armor ?? 0);
  const modifiedArmor = armorAfterAp(armor, opts.ap ?? 0);
  const apApplied = modifiedArmor - armor;
  const breakdown: ProvenanceEntry[] = [
    { label: 'BOD', value: defender.attributes.bod },
    { label: 'Armor', value: armor },
    ...(apApplied !== 0 ? [{ label: 'AP', value: apApplied, ref: lineRef('armorPenetration') }] : []),
    ...(opts.modifiers ?? []),
  ];
  return { pool: poolTotal(breakdown), breakdown, armor, modifiedArmor };
}

/**
 * Boxes left after the soak, and the monitor they go on (p.173 step 4): each
 * soak hit takes one off the modified DV, and a DV brought to 0 or below does
 * nothing.
 */
export function boxesAfterSoak(
  damage: Pick<HitDamage, 'modifiedDv' | 'type'>,
  soakHits: number,
): { boxes: number; track: DamageTrack } {
  return {
    boxes: Math.max(0, damage.modifiedDv - Math.max(0, soakHits)),
    track: damage.type === 'P' ? 'physical' : 'stun',
  };
}

// ---------------------------------------------------------------------------
// The one-click chain (FR10.8)
// ---------------------------------------------------------------------------

export interface AttackChainOptions {
  /** Override the attack dice pool entirely (otherwise `attacker.attackPool`). */
  attackPool?: number;
  /**
   * Situational entries for the attack: the environment (ONE line with the range band folded
   * in — `foldEnvironment`, p.173), recoil, … (negative values subtract).
   */
  attackModifiers?: ProvenanceEntry[];
  /** Situational entries for the defense roll. */
  defenseModifiers?: ProvenanceEntry[];
  /** Situational entries for the soak roll. */
  soakModifiers?: ProvenanceEntry[];
  /** Defender is on Full Defense: +WIL to the defense pool (score cost applied separately via applyInterrupt). */
  fullDefense?: boolean;
  /** Dodge, Block or Parry on this defense: its skill, and the Physical limit (score cost applied separately). */
  activeDefense?: ActiveDefense;
  /** Manual DV when the weapon's code is missing/unparseable, or a GM override. */
  dvOverride?: { value: number; type: DamageType };
  /** GM override for AP (otherwise the weapon's). */
  apOverride?: number;
  /**
   * Pre-rolled results (authoritative server dice or GM overrides, FR10.8
   * "every step overridable"). Any step provided here skips `rng`.
   */
  rolls?: { attack?: RollResult; defense?: RollResult; soak?: RollResult };
  /** Apply resulting boxes to `defender.monitors` (default true when monitors present). */
  apply?: boolean;
  /** Pain-tolerance boxes for the defender's wound recompute. */
  painTolerance?: number;
}

/** Every intermediate step of one resolved SR5 exchange (FR10.8 card UI). */
export interface AttackChainResult {
  attack: { pool: number; breakdown: ProvenanceEntry[]; limit?: LimitRef; roll: RollResult };
  defense: {
    pool: number;
    breakdown: ProvenanceEntry[];
    /** [Physical] when a Dodge, Block or Parry was used. */
    limit?: LimitRef;
    fullDefense: boolean;
    active?: ActiveDefenseId;
    roll: RollResult;
  };
  /** Attacker's limited hits minus defender's hits (after the defense's limit, if any). */
  netHits: number;
  /** Hit, a grazing hit on a tie (no damage, p.173), or a miss. */
  outcome: HitOutcome;
  damage?: HitDamage;
  soak?: {
    pool: number;
    breakdown: ProvenanceEntry[];
    roll: RollResult;
    /** max(0, modified DV − soak hits): boxes to the monitor. */
    boxes: number;
    track: DamageTrack;
  };
  /** Present when `defender.monitors` was given and boxes landed (FR4.5 receipt). */
  applied?: DamageResult;
  /** Human-readable annotations for the card (graze, conversion, soak-out, …). */
  notes: string[];
}

/**
 * Resolve a full SR5 attack exchange (FR10.8, p.173) in one go: attack roll
 * (accuracy limit, situational mods passed in) → `defensePool` and its roll
 * → `resolveHit` → `damageAfterHit` → `soakPool` and its roll →
 * `boxesAfterSoak` → boxes on the right monitor. Every intermediate value is
 * returned for the GM-overridable card UI.
 */
export function resolveAttackChain(
  attacker: CombatActor,
  defender: CombatActor,
  weapon: SheetWeapon,
  rng: () => number = Math.random,
  opts: AttackChainOptions = {},
): AttackChainResult {
  const notes: string[] = [];

  // 1. Attack roll, limited by the weapon's Accuracy.
  const attackBreakdown: ProvenanceEntry[] = [
    { label: `${weapon.name} pool`, value: opts.attackPool ?? attacker.attackPool ?? 0 },
  ];
  const attackerWounds = woundEntry(attacker);
  if (attackerWounds) attackBreakdown.push(attackerWounds);
  attackBreakdown.push(...(opts.attackModifiers ?? []));
  const attackPool = poolTotal(attackBreakdown);
  const limit: LimitRef | undefined =
    weapon.acc !== undefined ? { kind: 'accuracy', value: weapon.acc } : undefined;
  const attackRoll = opts.rolls?.attack ?? rollCombatPool(attackPool, rng, limit);

  // 2. Defense roll: REA + INT (+ WIL on Full Defense, + a Dodge/Block/Parry skill).
  const defense = defensePool(defender, {
    ...(opts.fullDefense !== undefined ? { fullDefense: opts.fullDefense } : {}),
    ...(opts.activeDefense ? { active: opts.activeDefense } : {}),
    ...(opts.defenseModifiers ? { modifiers: opts.defenseModifiers } : {}),
  });
  const defenseRoll = opts.rolls?.defense ?? rollCombatPool(defense.pool, rng, defense.limit);

  // 3. Net hits. The defense's hits count after its limit when it has one;
  //    the plain test has none, so its raw hits are what counts.
  const { netHits, outcome } = resolveHit(
    attackRoll.limitedHits,
    defense.limit ? defenseRoll.limitedHits : defenseRoll.hits,
  );
  const base: AttackChainResult = {
    attack: {
      pool: attackPool,
      breakdown: attackBreakdown,
      ...(limit ? { limit } : {}),
      roll: attackRoll,
    },
    defense: {
      pool: defense.pool,
      breakdown: defense.breakdown,
      ...(defense.limit ? { limit: defense.limit } : {}),
      fullDefense: defense.fullDefense,
      ...(defense.active ? { active: defense.active } : {}),
      roll: defenseRoll,
    },
    netHits,
    outcome,
    notes,
  };
  if (outcome !== 'hit') {
    notes.push(
      outcome === 'graze'
        ? 'Tie — a grazing hit: contact, but no damage (p.173).'
        : 'Attack missed.',
    );
    return base;
  }

  // 4. Modified DV vs modified armor.
  const parsed =
    (opts.dvOverride
      ? { value: opts.dvOverride.value, type: opts.dvOverride.type, raw: weapon.dv ?? '' }
      : null) ?? parseDamageCode(weapon.dv ?? '', attacker.attributes.str ?? 0);
  if (!parsed) {
    notes.push(`Damage code '${weapon.dv ?? ''}' not readable — enter DV manually.`);
    return base;
  }
  const ap = opts.apOverride ?? weapon.ap;
  const damage = damageAfterHit({ base: parsed, netHits, armor: defender.armor ?? 0, ap });
  if (damage.convertedToStun) notes.push('Modified DV fell short of armor — damage becomes Stun.');

  // 5. Soak: BOD + modified armor, no wound modifiers (GM-editable via soakModifiers).
  const soak = soakPool(defender, {
    ap,
    ...(opts.soakModifiers ? { modifiers: opts.soakModifiers } : {}),
  });
  const soakRoll = opts.rolls?.soak ?? rollCombatPool(soak.pool, rng);
  const { boxes, track } = boxesAfterSoak(damage, soakRoll.hits);
  if (boxes === 0) notes.push('Fully soaked — no boxes.');

  const result: AttackChainResult = {
    ...base,
    damage,
    soak: { pool: soak.pool, breakdown: soak.breakdown, roll: soakRoll, boxes, track },
  };

  // 6. Apply to the right monitor (FR4.5) when we can.
  if (boxes > 0 && defender.monitors && (opts.apply ?? true)) {
    result.applied = applyDamage(defender.monitors, boxes, track, {
      ...(opts.painTolerance !== undefined ? { painTolerance: opts.painTolerance } : {}),
    });
  }
  return result;
}
