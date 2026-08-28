/**
 * Validity pass for generated statblocks (D13: every number engine-validated).
 * Metatype-agnostic sanity bounds: attributes 1..12, skills 0..12, monitors
 * derivable. Corrections are recorded, never silent (Principle 3).
 */
import type { SheetV1, SkillAttr } from '@safehouse/contracts';
import { ATTRIBUTE_CODES } from '@safehouse/contracts';

export const ATTR_MIN = 1;
export const ATTR_MAX = 12;
export const SKILL_MIN = 0;
export const SKILL_MAX = 12;

/** Monitor sizes derivable from attributes (§10.2): 8 + ceil(attr / 2). */
export interface MonitorSizes {
  physical: number;
  stun: number;
  overflow: number;
}

export function deriveMonitors(bod: number, wil: number): MonitorSizes {
  return {
    physical: 8 + Math.ceil(bod / 2),
    stun: 8 + Math.ceil(wil / 2),
    overflow: bod,
  };
}

export interface ValidityResult {
  ok: boolean;
  /** Human-readable corrections applied (empty when nothing was clamped). */
  corrections: string[];
  sheet: SheetV1;
  monitors: MonitorSizes;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Clamp a generated sheet into legal bounds and confirm monitors derive.
 * Returns a corrected copy plus the list of corrections made; `ok` is true
 * when the input was already valid.
 */
export function validitySweep(sheet: SheetV1): ValidityResult {
  const corrections: string[] = [];
  const attributes = { ...sheet.attributes };

  for (const code of ATTRIBUTE_CODES) {
    const raw = attributes[code];
    const fixed = clampInt(raw, ATTR_MIN, ATTR_MAX);
    if (fixed !== raw) {
      corrections.push(`attr.${code}: ${raw} → ${fixed} (bounds ${ATTR_MIN}..${ATTR_MAX})`);
      attributes[code] = fixed;
    }
  }
  const edgMax = clampInt(sheet.attributes.edg.max, ATTR_MIN, ATTR_MAX);
  if (edgMax !== sheet.attributes.edg.max) {
    corrections.push(`attr.edg.max: ${sheet.attributes.edg.max} → ${edgMax}`);
  }
  const edgCurrent = clampInt(sheet.attributes.edg.current, 0, edgMax);
  if (edgCurrent !== sheet.attributes.edg.current) {
    corrections.push(`attr.edg.current: ${sheet.attributes.edg.current} → ${edgCurrent}`);
  }
  attributes.edg = { max: edgMax, current: edgCurrent };

  const skills = sheet.skills.map((skill) => {
    const fixed = clampInt(skill.rating, SKILL_MIN, SKILL_MAX);
    if (fixed !== skill.rating) {
      corrections.push(`skill.${skill.id}: ${skill.rating} → ${fixed} (bounds ${SKILL_MIN}..${SKILL_MAX})`);
      return { ...skill, rating: fixed };
    }
    return skill;
  });

  const monitors = deriveMonitors(attributes.bod, attributes.wil);
  if (!Number.isFinite(monitors.physical) || monitors.physical < 9 || monitors.stun < 9) {
    // Unreachable after clamping (bod/wil ≥ 1 → monitors ≥ 9) — belt and braces.
    throw new Error('generator.validitySweep: monitors not derivable after clamping');
  }

  return {
    ok: corrections.length === 0,
    corrections,
    sheet: { ...sheet, attributes, skills },
    monitors,
  };
}

/**
 * Default skill → linked attribute mapping for common SR5 active skill ids
 * (lowercase, hyphenated). Templates may use any id; unknown ids fall back
 * to 'agi'. Mechanics knowledge, not book text (§14).
 */
export const DEFAULT_SKILL_ATTRS: Readonly<Record<string, SkillAttr>> = {
  // Combat
  archery: 'agi',
  automatics: 'agi',
  blades: 'agi',
  clubs: 'agi',
  'exotic-melee': 'agi',
  'exotic-ranged': 'agi',
  'heavy-weapons': 'agi',
  longarms: 'agi',
  pistols: 'agi',
  'throwing-weapons': 'agi',
  'unarmed-combat': 'agi',
  gunnery: 'agi',
  // Physical
  'escape-artist': 'agi',
  gymnastics: 'agi',
  locksmith: 'agi',
  palming: 'agi',
  sneaking: 'agi',
  'free-fall': 'bod',
  diving: 'bod',
  running: 'str',
  swimming: 'str',
  // Vehicle
  'pilot-ground-craft': 'rea',
  'pilot-aircraft': 'rea',
  'pilot-watercraft': 'rea',
  'pilot-walker': 'rea',
  'pilot-exotic-vehicle': 'rea',
  // Social
  con: 'cha',
  etiquette: 'cha',
  impersonation: 'cha',
  instruction: 'cha',
  intimidation: 'cha',
  leadership: 'cha',
  negotiation: 'cha',
  performance: 'cha',
  'animal-handling': 'cha',
  // Technical / knowledge-adjacent actives
  'aeronautics-mechanic': 'log',
  'automotive-mechanic': 'log',
  'industrial-mechanic': 'log',
  'nautical-mechanic': 'log',
  armorer: 'log',
  biotechnology: 'log',
  chemistry: 'log',
  computer: 'log',
  cybercombat: 'log',
  cybertechnology: 'log',
  demolitions: 'log',
  'electronic-warfare': 'log',
  'first-aid': 'log',
  forgery: 'log',
  hacking: 'log',
  hardware: 'log',
  medicine: 'log',
  software: 'log',
  // Perception / awareness
  perception: 'int',
  disguise: 'int',
  navigation: 'int',
  tracking: 'int',
  artisan: 'int',
  assensing: 'int',
  'arcana': 'log',
  // Willpower-linked
  'astral-combat': 'wil',
  survival: 'wil',
  // Magic
  alchemy: 'mag',
  banishing: 'mag',
  binding: 'mag',
  counterspelling: 'mag',
  'ritual-spellcasting': 'mag',
  spellcasting: 'mag',
  summoning: 'mag',
  // Resonance
  compiling: 'res',
  decompiling: 'res',
  registering: 'res',
};

export function skillAttrFor(skillId: string): SkillAttr {
  return DEFAULT_SKILL_ATTRS[skillId.toLowerCase()] ?? 'agi';
}
