/**
 * Combat module (FR4.2–4.7, FR10.8–10.9, §10.2): the initiative-pass combat
 * turn, interrupts, damage/wound propagation, the attack exchange as pure
 * steps (and the one-click chain that composes them), recoil,
 * morale, grunt-group helpers, and the two catalogues the guided roll cards
 * read — combat actions and situational modifiers, each entry with its page.
 * Pure functions and data — no I/O, no mutation.
 *
 * Explicit re-exports keep the package surface deliberate (and avoid name
 * collisions with sibling modules under the root barrel).
 */
export {
  MAX_INIT_DICE,
  rollInitiative,
  compareInitiative,
  turnOrder,
  nextActor,
  delayedRows,
  moveInOrder,
  actNowOrder,
  seizeInitiative,
  markActed,
  advancePass,
  anyActiveScores,
  beginTurn,
  DEFAULT_INTERRUPTS,
  canInterrupt,
  applyInterrupt,
  type InitiativeRollDetail,
  type RollInitiativeOptions,
  type InterruptAction,
  type EricAttributes,
  type TurnOrderOptions,
  type SeizeInitiativeOutcome,
} from './initiative.js';
export {
  computeWoundModifier,
  applyDamage,
  damageCombatant,
  healDamage,
  type DamageTrack,
  type DamageOptions,
  type DamageResult,
} from './damage.js';
export {
  parseDamageCode,
  defensePool,
  resolveHit,
  armorAfterAp,
  damageAfterHit,
  soakPool,
  boxesAfterSoak,
  resolveAttackChain,
  type DamageType,
  type ParsedDamageCode,
  type CombatActor,
  type ActiveDefenseId,
  type ActiveDefense,
  type DefenseOptions,
  type DefensePool,
  type HitOutcome,
  type HitResult,
  type HitDamage,
  type DamageAfterHitInput,
  type SoakOptions,
  type SoakPool,
  type AttackChainOptions,
  type AttackChainResult,
} from './attack.js';
export {
  bulletsForMode,
  recoilCompensation,
  recoilLine,
  recoilPenalty,
  type RecoilLineOptions,
} from './recoil.js';
export {
  checkMorale,
  moraleReport,
  DEFAULT_MORALE_WEIGHTS,
  type MoraleSuggestion,
  type MoraleTriggers,
  type MoraleWeights,
  type MoraleReport,
} from './morale.js';
export {
  createGruntGroup,
  tickGruntDamage,
  gruntCasualties,
  activeGruntMembers,
  spendGroupEdge,
  gruntMoraleTriggers,
  type GruntGroupInit,
} from './grunts.js';
export { rollCombatPool } from './roll.js';
export {
  ACTION_TYPES,
  COMBAT_ACTIONS,
  FIRE_MODE_ACTIONS,
  FIRE_MODE_CODES,
  attackActionsFor,
  combatAction,
  defenseModifierFor,
  defenseOptions,
  directSpellResistance,
  fireActionsFor,
  fireModesOf,
  isMeleeSkill,
  offersFor,
  type ActionType,
  type CombatAction,
  type ExchangeRole,
  type FireModeCode,
  type PoolAttr,
  type PoolRecipe,
} from './actions.js';
export {
  PERCEPTION_THRESHOLDS,
  SITUATIONAL_MODIFIERS,
  situationalFor,
  situationalModifier,
  type AttackKind,
  type EnvColumn,
  type ModifierAuto,
  type ModifierGroup,
  type ModifierScope,
  type ModifierValue,
  type PerUnit,
  type SituationalModifier,
} from './situational.js';
