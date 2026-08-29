/**
 * Spirits as first-class engine subjects (FR8.3).
 *
 * A summoned spirit is not a note in the margin: it acts, it soaks, it rolls
 * initiative, and — once it joins an encounter — it is a combatant like any
 * other. So it gets the same treatment every other number in Safehouse gets:
 * its stats are *derived* from Force through `deriveCharacter`, and every
 * value arrives with provenance (Principle 3).
 *
 * **No book data lives here (§14).** The app ships no spirit tables. A spirit
 * is a GM-entered `type` label, a Force, and an optional set of per-attribute
 * offsets the GM typed off their own book. With no offsets every attribute is
 * exactly Force, which is the honest default. What the engine supplies is the
 * *mechanic* — attributes from Force, Essence from Force, monitors and limits
 * and initiative from the attributes — not anyone's stat block.
 */
import type {
  AttributeCode,
  DerivedCharacter,
  Modifier,
  SheetPower,
  SheetV1,
  SheetV1Input,
  SkillAttr,
} from '@safehouse/contracts';
import { ATTRIBUTE_CODES, SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '../derive.js';

export const SPIRIT_FORCE_MIN = 1;
export const SPIRIT_FORCE_MAX = 24;
/** Spirits act more than once per turn; the GM can change it per spirit. */
export const SPIRIT_INIT_DICE_DEFAULT = 2;
/** The engine caps initiative dice at 5d6 (§10.2); the profile agrees. */
export const SPIRIT_INIT_DICE_MAX = 5;

/** Which initiative line the engine reads for a spirit on a given plane. */
export type SpiritPlane = 'physical' | 'astral';

export interface SpiritSkillSpec {
  id: string;
  attr: SkillAttr;
  /** Defaults to Force — spirits use their Force as the skill rating. */
  rating?: number;
  spec?: string | null;
}

export interface SpiritProfile {
  /** Display name; falls back to "<type> spirit (Force N)". */
  name?: string;
  /** GM-entered label ("air", "beasts", "the tunnels" — their words, §14). */
  type: string;
  force: number;
  /**
   * Per-attribute offsets from Force, typed by the GM from their own book.
   * Absent codes mean "exactly Force", which is what an unedited spirit is.
   */
  attributeOffsets?: Partial<Record<AttributeCode, number>>;
  skills?: readonly SpiritSkillSpec[];
  initiativeDice?: number;
  /** Explicit Edge; defaults to ⌈Force/2⌉. */
  edge?: number;
  /** Optional powers the GM typed, each carrying its own modifiers (FR8.5). */
  powers?: readonly SheetPower[];
  notes?: string;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.trunc(n)));

export function clampForce(force: number): number {
  return clamp(Number.isFinite(force) ? force : SPIRIT_FORCE_MIN, SPIRIT_FORCE_MIN, SPIRIT_FORCE_MAX);
}

export function spiritInitDice(profile: Pick<SpiritProfile, 'initiativeDice'>): number {
  return clamp(profile.initiativeDice ?? SPIRIT_INIT_DICE_DEFAULT, 0, SPIRIT_INIT_DICE_MAX);
}

/** Edge for a spirit with none entered: ⌈Force/2⌉, never below 1. */
export function spiritEdge(profile: Pick<SpiritProfile, 'force' | 'edge'>): number {
  const force = clampForce(profile.force);
  if (profile.edge !== undefined) return Math.max(0, Math.trunc(profile.edge));
  return Math.max(1, Math.ceil(force / 2));
}

/** Attribute values: Force plus the GM's offset, never below 1. */
export function spiritAttributes(profile: SpiritProfile): Record<AttributeCode, number> {
  const force = clampForce(profile.force);
  const out = {} as Record<AttributeCode, number>;
  for (const code of ATTRIBUTE_CODES) {
    out[code] = Math.max(1, force + Math.trunc(profile.attributeOffsets?.[code] ?? 0));
  }
  return out;
}

/**
 * The extra initiative dice a spirit's form buys, as ordinary pipeline
 * modifiers so the provenance says where they came from. The engine's baseline
 * is 1d6 on the meat lines and 2d6 astral, so the deltas differ per line.
 */
export function spiritInitiativeModifiers(profile: SpiritProfile): Modifier[] {
  const dice = spiritInitDice(profile);
  const note = `${profile.type} spirit — ${dice}d6 initiative`;
  const lines: Array<{ id: string; target: string; delta: number }> = [
    { id: 'spirit.init.physical', target: 'initiative.dice', delta: dice - 1 },
    { id: 'spirit.init.astral', target: 'initiative.astral.dice', delta: dice - 2 },
  ];
  return lines
    .filter((l) => l.delta !== 0)
    .map((l) => ({
      id: l.id,
      source: { kind: 'power' as const, ref: 'spirit form' },
      target: l.target,
      op: 'add' as const,
      value: l.delta,
      active: true,
      note,
    }));
}

/** Display name a spirit falls back to when the GM typed none. */
export function spiritDisplayName(profile: SpiritProfile): string {
  const named = profile.name?.trim();
  if (named) return named;
  return `${profile.type} spirit (Force ${clampForce(profile.force)})`;
}

/**
 * A spirit as a `SheetV1` — the shape every other subject in the system uses,
 * which is what lets a spirit reach `addCombatant`, the tracker, the damage
 * path and the roll log with no special cases anywhere downstream.
 */
export function spiritSheet(profile: SpiritProfile): SheetV1 {
  const force = clampForce(profile.force);
  const attrs = spiritAttributes(profile);
  const edge = spiritEdge(profile);
  const initMods = spiritInitiativeModifiers(profile);
  const powers: SheetPower[] = [
    {
      name: `Spirit form (Force ${force})`,
      mods: initMods,
      note: `${profile.type} spirit, summoned at Force ${force}`,
    },
    ...(profile.powers ?? []).map((p) => ({ ...p, mods: [...p.mods] })),
  ];
  const input: SheetV1Input = {
    v: 1,
    identity: {
      alias: spiritDisplayName(profile),
      metatype: 'spirit',
      portraitId: null,
      notes: profile.notes ?? `Force ${force} ${profile.type} spirit`,
    },
    attributes: {
      ...attrs,
      edg: { max: edge, current: edge },
      // A spirit's Essence tracks its Force (§10.2 mechanic, not a stat block).
      ess: force,
      mag: force,
      res: 0,
    },
    skills: (profile.skills ?? []).map((s) => ({
      id: s.id,
      attr: s.attr,
      rating: Math.max(0, Math.trunc(s.rating ?? force)),
      ...(s.spec ? { spec: s.spec } : {}),
    })),
    powers,
  };
  return SheetV1Schema.parse(input);
}

/** Full derived spirit — pools, limits, monitors, initiative, all with provenance. */
export function deriveSpirit(profile: SpiritProfile, situational?: Modifier[]): DerivedCharacter {
  return deriveCharacter(spiritSheet(profile), situational ? { situational } : undefined);
}

export interface SpiritInitiative {
  plane: SpiritPlane;
  base: number;
  dice: number;
  breakdown: DerivedCharacter['initiative']['physical']['base']['breakdown'];
  diceBreakdown: DerivedCharacter['initiative']['physical']['dice']['breakdown'];
}

/** The initiative line a spirit brings to the tracker, with its receipt. */
export function spiritInitiative(
  profile: SpiritProfile,
  plane: SpiritPlane = 'physical',
): SpiritInitiative {
  const derived = deriveSpirit(profile);
  const line = derived.initiative[plane];
  return {
    plane,
    base: line.base.value,
    dice: line.dice.value,
    breakdown: line.base.breakdown,
    diceBreakdown: line.dice.breakdown,
  };
}
