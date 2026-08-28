import type {
  CombatantMonitors,
  LimitRef,
  ProvenanceEntry,
  RollResult,
  SheetWeapon,
} from '@safehouse/contracts';
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
  /** Wound modifier (negative). Derived from `monitors` when omitted. */
  woundModifier?: number;
  /** When present, the chain can apply the resulting boxes (FR4.5). */
  monitors?: CombatantMonitors;
}

export interface AttackChainOptions {
  /** Override the attack dice pool entirely (otherwise `attacker.attackPool`). */
  attackPool?: number;
  /** Situational entries for the attack: range, environment, recoil, … (negative values subtract). */
  attackModifiers?: ProvenanceEntry[];
  /** Situational entries for the defense roll. */
  defenseModifiers?: ProvenanceEntry[];
  /** Situational entries for the soak roll. */
  soakModifiers?: ProvenanceEntry[];
  /** Defender is on Full Defense: +WIL to the defense pool (score cost applied separately via applyInterrupt). */
  fullDefense?: boolean;
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
  defense: { pool: number; breakdown: ProvenanceEntry[]; fullDefense: boolean; roll: RollResult };
  /** Attacker's limited hits minus defender's hits (ties go to the defender). */
  netHits: number;
  outcome: 'miss' | 'hit';
  damage?: {
    base: ParsedDamageCode;
    /** base DV + net hits. */
    modifiedDv: number;
    ap: number;
    armor: number;
    /** max(0, armor + AP). */
    modifiedArmor: number;
    /** Final damage type after the DV-vs-armor comparison (§10.2). */
    type: DamageType;
    convertedToStun: boolean;
  };
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
  /** Human-readable annotations for the card (tie, conversion, soak-out, …). */
  notes: string[];
}

function woundEntry(actor: CombatActor): ProvenanceEntry | null {
  const wm =
    actor.woundModifier ?? (actor.monitors ? computeWoundModifier(actor.monitors) : 0);
  return wm !== 0 ? { label: 'Wounds', value: wm, source: 'wound' } : null;
}

/**
 * Resolve a full SR5 attack exchange (FR10.8, §10.2): attack roll (accuracy
 * limit, situational mods passed in) vs defense (REA + INT, full-defense
 * variant) → net hits → DV + net hits vs soak (BOD + armor − AP; if modified
 * DV ≤ modified armor the damage becomes Stun) → boxes to the right monitor.
 * Every intermediate value is returned for the GM-overridable card UI.
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

  // 2. Defense roll: REA + INT (+ WIL on Full Defense). No limit on defense.
  const fullDefense = opts.fullDefense ?? false;
  const defenseBreakdown: ProvenanceEntry[] = [
    { label: 'REA', value: defender.attributes.rea },
    { label: 'INT', value: defender.attributes.int },
  ];
  if (fullDefense) {
    defenseBreakdown.push({ label: 'WIL (Full Defense)', value: defender.attributes.wil ?? 0 });
  }
  const defenderWounds = woundEntry(defender);
  if (defenderWounds) defenseBreakdown.push(defenderWounds);
  defenseBreakdown.push(...(opts.defenseModifiers ?? []));
  const defensePool = poolTotal(defenseBreakdown);
  const defenseRoll = opts.rolls?.defense ?? rollCombatPool(defensePool, rng);

  // 3. Net hits.
  const netHits = attackRoll.limitedHits - defenseRoll.hits;
  const base: AttackChainResult = {
    attack: {
      pool: attackPool,
      breakdown: attackBreakdown,
      ...(limit ? { limit } : {}),
      roll: attackRoll,
    },
    defense: { pool: defensePool, breakdown: defenseBreakdown, fullDefense, roll: defenseRoll },
    netHits,
    outcome: netHits > 0 ? 'hit' : 'miss',
    notes,
  };
  if (netHits <= 0) {
    notes.push(netHits === 0 ? 'Tie — the defense holds.' : 'Attack missed.');
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
  const armor = defender.armor ?? 0;
  const modifiedArmor = Math.max(0, armor + ap);
  const modifiedDv = parsed.value + netHits;
  const convertedToStun = parsed.type === 'P' && modifiedDv <= modifiedArmor;
  const type: DamageType = convertedToStun ? 'S' : parsed.type;
  if (convertedToStun) notes.push('Modified DV did not beat armor — damage becomes Stun.');

  // 5. Soak: BOD + modified armor. Wound modifiers do not reduce the soak
  //    roll by default (GM-editable via soakModifiers).
  const soakBreakdown: ProvenanceEntry[] = [
    { label: 'BOD', value: defender.attributes.bod },
    { label: 'Armor', value: armor },
    ...(ap !== 0 ? [{ label: 'AP', value: ap }] : []),
    ...(opts.soakModifiers ?? []),
  ];
  const soakPool = poolTotal(soakBreakdown);
  const soakRoll = opts.rolls?.soak ?? rollCombatPool(soakPool, rng);
  const boxes = Math.max(0, modifiedDv - soakRoll.hits);
  const track: DamageTrack = type === 'P' ? 'physical' : 'stun';
  if (boxes === 0) notes.push('Fully soaked — no boxes.');

  const result: AttackChainResult = {
    ...base,
    damage: { base: parsed, modifiedDv, ap, armor, modifiedArmor, type, convertedToStun },
    soak: { pool: soakPool, breakdown: soakBreakdown, roll: soakRoll, boxes, track },
  };

  // 6. Apply to the right monitor (FR4.5) when we can.
  if (boxes > 0 && defender.monitors && (opts.apply ?? true)) {
    result.applied = applyDamage(defender.monitors, boxes, track, {
      ...(opts.painTolerance !== undefined ? { painTolerance: opts.painTolerance } : {}),
    });
  }
  return result;
}
