/**
 * Generator module (FR10.1–10.3, FR10.5, D13): seeded procedural NPC
 * generation, field-level rerolls, flavor tables, and threat heuristics.
 * Pure and deterministic — no I/O; authoritative dice stay on the server.
 */
export {
  mulberry32,
  hashSeed,
  combineSeed,
  subRng,
  randInt,
  pick,
  weightedPick,
  shuffle,
  type Seed,
} from './prng.js';
export {
  generateNpc,
  generateGruntGroup,
  regenerate,
  type GeneratedNpc,
  type GeneratedGruntGroup,
  type GenerateOptions,
  type RegenerateOptions,
  type RegenerateLocks,
  type LoadoutCatalog,
  type NpcFlavor,
} from './generate.js';
export {
  validitySweep,
  deriveMonitors,
  skillAttrFor,
  clampInt,
  DEFAULT_SKILL_ATTRS,
  ATTR_MIN,
  ATTR_MAX,
  SKILL_MIN,
  SKILL_MAX,
  type MonitorSizes,
  type ValidityResult,
} from './validity.js';
export {
  expectedHits,
  parseDv,
  exchangeEstimate,
  exchangePair,
  type DvCode,
  type ExchangeEstimate,
  type ExchangeSide,
} from './heuristics.js';
export { NAME_TABLE, QUIRK_TABLE, APPEARANCE_TABLE, MOTIVATION_TABLE } from './tables.js';
