/**
 * The combat action catalogue: what a character can do in an Action Phase,
 * what it costs, what it rolls, and where the book explains it.
 *
 * ## What this is and is not
 *
 * Pure data (DESIGN.md §14, §7.2): ids, action types, numbers and printed
 * pages, with names in our own words where the book's name is not already the
 * term the table uses. Nothing here rolls a die or reads a sheet. The guided
 * roll card (design step 5 onwards) reads an entry to know what to show: the
 * type chip (Free / Simple / Complex / Interrupt), the page, the pool recipe,
 * the limit, the modifiers it may tick, and whether the action opens,
 * answers or soaks an attack.
 *
 * The entries follow the Combat Actions table on p.162 and the write-ups on
 * p.163-168, read off the GM's own core rulebook (printed page = PDF page − 5).
 * A Phase is two Simple Actions or one Complex Action, plus one Free Action
 * (p.163); an Interrupt is paid for in Initiative Score, at once, out of turn
 * (p.167). Reactions — the free defense test, damage resistance, a Perception
 * Test the GM calls for — are not actions at all and carry type `none`.
 *
 * ## The first cut
 *
 * Firearms, melee, the defenses, soak, perception, casting and spell
 * resistance: what the table actually uses. Matrix and rigging actions stay
 * out until someone at the table plays a decker or a rigger (the design's
 * scope note). A GM can still roll anything off the sheet; the catalogue only
 * decides what the guided card knows how to lay out.
 *
 * ## The GM's rulings built in here (2026-09-28)
 *
 * - The free defense test (Reaction + Intuition) is always offered FIRST
 *   against an incoming attack; Full Defense and Dodge follow it.
 * - Dodge is offered against ranged attacks as well as melee. The book reads
 *   both ways — p.188 gives a ranged defender only the free test or Full
 *   Defense, p.191 calls Dodge a melee boost, while p.168 says Dodge answers
 *   "incoming attacks" — and the table takes p.168's reading.
 * - Block and Parry stay melee only: Block needs empty hands against an
 *   unarmed or melee attack, Parry a melee weapon in hand (p.188, 191-192).
 */
import type {
  ActionType,
  ExchangeRole,
  FireModeCode,
  LimitKind,
  Ref,
  SheetWeapon,
  SkillAttr,
} from '@safehouse/contracts';
import { lineRef, skillKey, sr5Page } from '../refs.js';
import {
  situationalFor,
  situationalModifier,
  type AttackKind,
  type ModifierScope,
  type SituationalModifier,
} from './situational.js';

/**
 * Free, Simple, Complex, Interrupt (p.162) — and `none` for a reaction such as
 * the free defense test or soak. The vocabulary lives in the contracts
 * (`ActionTypeSchema`, roll-card.ts), because the guided card carries it to
 * the browser; it is re-exported here so the catalogue reads as one piece.
 * Likewise `ExchangeRole` (an action opens an attack exchange, answers one, or
 * resists its damage) and `FireModeCode`.
 */
export type { ActionType, ExchangeRole, FireModeCode };

/** The order the action types are listed in, as on the p.162 table. */
export const ACTION_TYPES: readonly ActionType[] = ['free', 'simple', 'complex', 'interrupt', 'none'];

/** An attribute a pool can be built from: the skill attributes plus Edge (suppressive fire's Reaction + Edge). */
export type PoolAttr = SkillAttr | 'edg';

/**
 * Where an action's dice come from. The card builder turns this into pool
 * lines off the sheet or the NPC's derived pools; the recipe only says which.
 *
 * - `weapon`: the weapon's skill + Agility, as the sheet derives it.
 * - `skill`: a skill + an attribute. No `skill` means the roller picks one
 *   (Use Skill), and its limit is that skill's own.
 * - `defense`: Reaction + Intuition, plus one more for the active defenses —
 *   Gymnastics (Dodge), Unarmed Combat (Block), the melee weapon's skill
 *   (Parry) or Willpower (Full Defense).
 * - `soak`: Body + armor, with AP applied to the armor (p.169, 173).
 * - `attrs`: attributes only — Composure, resisting a direct spell.
 * - `spell`: Spellcasting + Magic.
 * - `none`: no test.
 */
export type PoolRecipe =
  | { from: 'weapon' }
  | { from: 'skill'; skill?: string; attr?: PoolAttr }
  | { from: 'defense'; plus?: 'gymnastics' | 'unarmed-combat' | 'weaponSkill' | 'wil' }
  | { from: 'soak' }
  | { from: 'attrs'; attrs: readonly PoolAttr[] }
  | { from: 'spell' }
  | { from: 'none' };

export interface CombatAction {
  id: string;
  /** The book's name for the action where it has one; otherwise ours. */
  name: string;
  type: ActionType;
  /** Where the action itself is explained. */
  ref: Ref;
  /** Other pages worth a look: the rules section behind it, the table its numbers sit in. */
  refs?: readonly Ref[];
  /** Initiative Score an Interrupt costs, paid at once (p.167-168). */
  initCost?: number;
  pool: PoolRecipe;
  /**
   * The limit kind, or null when the test has none (the defense test, soak,
   * attribute-only tests). An unarmed attack uses Physical rather than
   * Accuracy even with a weapon strapped on (p.168); the card builder reads
   * that off the weapon's skill.
   */
  limit: LimitKind | null;
  /** Rounds a firing action uses (the Firing Mode Table, p.180). */
  rounds?: number;
  /** What the fire mode does to the target's defense (p.180); 0 for a single shot. */
  defenseModifier?: number;
  /**
   * The situational modifier ids the card shows for this action, in order —
   * the engine's own lines (`auto`) arriving filled in, the rest as tick
   * boxes (see `situational.ts`).
   */
  offers: readonly string[];
  /** Needs a target picked before the card can be built. */
  needsTarget?: true;
  exchange?: ExchangeRole;
  /** For an attack: what kind the defender is answering. */
  attack?: AttackKind;
  /** For a defense: the kinds of attack it may answer. */
  against?: readonly AttackKind[];
  /** For a defense: the kinds of attack it takes the defender out of, no test (Hit the Dirt, p.179-180). */
  avoids?: readonly AttackKind[];
  /** For a defense bought with an Interrupt: one test (Dodge, Block, Parry) or the whole Combat Turn (Full Defense). */
  lasts?: 'test' | 'turn';
}

// ---------------------------------------------------------------------------
// What each kind of test may be offered
// ---------------------------------------------------------------------------

const idsIn = (...scopes: ModifierScope[]): string[] => situationalFor(scopes).map((m) => m.id);
const without = (ids: readonly string[], ...drop: string[]): string[] => ids.filter((id) => !drop.includes(id));

/** A shot: the ranged table, anything on an action, and anything on any test. */
const RANGED = idsIn('attack.ranged', 'action', 'all');
/** Throwing and bows do not recoil; suppressive fire ignores it (p.179). */
const RANGED_NO_RECOIL = without(RANGED, 'recoil');
/**
 * A melee attack made running is a charge: the charge's own +2 stands in for
 * running's −2, which the charger ignores (p.186-187).
 */
const MELEE = without(idsIn('attack.melee', 'action', 'all'), 'attacker_running');
const DEFENSE = idsIn('defense', 'all');
/** Damage resistance takes no wound modifier (p.170). */
const SOAK = without(idsIn('soak', 'all'), 'wounds');
const PERCEPTION = idsIn('perception', 'action', 'all');
/** Casting by sight is subject to visibility (p.281). */
const CAST = [...idsIn('action', 'all'), 'environment_sight'];
const SKILL = idsIn('action', 'all');
/** Running's −2 is on every action but the Sprint itself (p.162). */
const SPRINT = without(SKILL, 'attacker_running');
/** Neither is resisting a direct combat spell (p.170). */
const RESIST_SPELL = without(idsIn('all'), 'wounds');
const ANY_TEST = idsIn('all');
const NONE: readonly string[] = [];

// ---------------------------------------------------------------------------
// Pages used more than once
// ---------------------------------------------------------------------------

const FIRE_SIMPLE = sr5Page(165, 'Fire Semi-Auto, Single-Shot, Burst Fire or Full-Auto');
const FIRE_BURSTS = sr5Page(167, 'Fire Long Burst or Semi-Auto Burst');
const FIRE_MODES = lineRef('fireModes'); // p.180
const DEFENDING = lineRef('defense'); // p.188

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Every action the guided cards know, grouped by type in the p.162 table's
 * order. Interrupts keep the order the tracker's menu has always shown them in.
 */
export const COMBAT_ACTIONS: readonly CombatAction[] = [
  // --- Free Actions (p.163-164): one per Initiative Pass -------------------
  {
    // Made together with a Fire Weapon, Throw Weapon or Melee Attack.
    id: 'call_shot',
    name: 'Call a Shot',
    type: 'free',
    ref: sr5Page(163, 'Call a Shot'),
    refs: [sr5Page(195, 'Called Shots')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Not while surprised (p.164).
    id: 'drop_prone',
    name: 'Drop Prone',
    type: 'free',
    ref: sr5Page(164, 'Drop Prone'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Past the Walk rate this Combat Turn; a Free Action each pass spent running.
    id: 'run',
    name: 'Run',
    type: 'free',
    ref: sr5Page(164, 'Run'),
    refs: [sr5Page(161, 'Movement'), sr5Page(162, 'Running Modifiers')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Splits the pool across targets or a gun in each hand.
    id: 'multiple_attacks',
    name: 'Multiple Attacks',
    type: 'free',
    ref: sr5Page(164, 'Multiple Attacks'),
    refs: [sr5Page(196, 'Multiple Attacks')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    id: 'speak',
    name: 'Speak, Text or Transmit a Phrase',
    type: 'free',
    ref: sr5Page(164, 'Speak/Text/Transmit Phrase'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },

  // --- Simple Actions (p.164-167): two per Action Phase --------------------
  // Only one of the two may be an attack (p.164).
  {
    id: 'fire_ss',
    name: 'Fire single shot',
    type: 'simple',
    ref: FIRE_SIMPLE,
    refs: [sr5Page(178, 'Single Shot (SS)'), FIRE_MODES],
    rounds: 1,
    defenseModifier: 0,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    id: 'fire_sa',
    name: 'Fire semi-auto',
    type: 'simple',
    ref: FIRE_SIMPLE,
    refs: [sr5Page(178, 'Semi-Automatic (SA)'), FIRE_MODES],
    rounds: 1,
    defenseModifier: 0,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    id: 'fire_bf',
    name: 'Fire burst',
    type: 'simple',
    ref: FIRE_SIMPLE,
    refs: [sr5Page(179, 'Burst Fire'), FIRE_MODES],
    rounds: 3,
    defenseModifier: -2,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // Full-auto as a Simple Action: six rounds (p.165, 179).
    id: 'fire_fa_simple',
    name: 'Fire full-auto (short)',
    type: 'simple',
    ref: FIRE_SIMPLE,
    refs: [sr5Page(179, 'Full-Auto'), FIRE_MODES],
    rounds: 6,
    defenseModifier: -5,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // One arrow from a loaded bow; nocking the next is a Reload (p.165).
    id: 'fire_bow',
    name: 'Fire Bow',
    type: 'simple',
    ref: sr5Page(165, 'Fire Bow'),
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED_NO_RECOIL,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // Knives and shuriken attack like any projectile. A grenade is thrown
    // at a spot instead, on Physical with a threshold of 3 (p.181).
    id: 'throw_weapon',
    name: 'Throw Weapon',
    type: 'simple',
    ref: sr5Page(166, 'Throw Weapon'),
    refs: [sr5Page(181, 'Thrown Weapons')],
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED_NO_RECOIL,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // +1 die or +1 Accuracy on the next shot, up to half Willpower (p.166).
    id: 'take_aim',
    name: 'Take Aim',
    type: 'simple',
    ref: sr5Page(166, 'Take Aim'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Earns the cover bonus on the defense test; not while surprised.
    id: 'take_cover',
    name: 'Take Cover',
    type: 'simple',
    ref: sr5Page(166, 'Take Cover'),
    refs: [lineRef('cover')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // A wounded character needs Body + Willpower (2) to manage it (p.166).
    id: 'stand_up',
    name: 'Stand Up',
    type: 'simple',
    ref: sr5Page(166, 'Stand Up'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    id: 'observe_in_detail',
    name: 'Observe in Detail',
    type: 'simple',
    ref: sr5Page(165, 'Observe in Detail'),
    refs: [lineRef('perception'), lineRef('perceptionThresholds')],
    pool: { from: 'skill', skill: 'perception', attr: 'int' },
    limit: 'mental',
    offers: PERCEPTION,
  },
  {
    id: 'ready_weapon',
    name: 'Ready Weapon',
    type: 'simple',
    ref: sr5Page(165, 'Ready Weapon'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    id: 'remove_clip',
    name: 'Remove Clip',
    type: 'simple',
    ref: sr5Page(166, 'Remove Clip'),
    refs: [sr5Page(163, 'Reloading Weapons')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Only once the old clip is out (p.165).
    id: 'insert_clip',
    name: 'Insert Clip',
    type: 'simple',
    ref: sr5Page(165, 'Insert Clip'),
    refs: [sr5Page(163, 'Reloading Weapons')],
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    id: 'shift_perception',
    name: 'Shift Perception',
    type: 'simple',
    ref: sr5Page(166, 'Shift Perception'),
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
  },
  {
    // Cast Spell as a Simple Action, for +3 Drain (p.165, 281).
    id: 'reckless_spellcasting',
    name: 'Reckless Spellcasting',
    type: 'simple',
    ref: sr5Page(165, 'Reckless Spellcasting'),
    refs: [lineRef('spellcasting')],
    pool: { from: 'spell' },
    limit: 'force',
    offers: CAST,
    needsTarget: true,
    exchange: 'opens',
  },

  // --- Complex Actions (p.167): one per Action Phase -----------------------
  {
    // Three quick semi-auto shots (p.179).
    id: 'fire_sb',
    name: 'Fire semi-auto burst',
    type: 'complex',
    ref: FIRE_BURSTS,
    refs: [sr5Page(179, 'Semi-Automatic Burst'), FIRE_MODES],
    rounds: 3,
    defenseModifier: -2,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // Two bursts back to back (p.179).
    id: 'fire_lb',
    name: 'Fire long burst',
    type: 'complex',
    ref: FIRE_BURSTS,
    refs: [sr5Page(179, 'Long Burst'), FIRE_MODES],
    rounds: 6,
    defenseModifier: -5,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // Full-auto as a Complex Action: ten rounds (p.167, 179).
    id: 'fire_fa_complex',
    name: 'Fire full-auto (long)',
    type: 'complex',
    ref: sr5Page(167, 'Fire Full-Auto Weapon'),
    refs: [sr5Page(179, 'Full-Auto'), FIRE_MODES],
    rounds: 10,
    defenseModifier: -9,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED,
    needsTarget: true,
    exchange: 'opens',
    attack: 'ranged',
  },
  {
    // Twenty rounds into a zone, ignoring recoil (p.179). No single target
    // and no defense modifier: everyone in the zone makes a Reaction + Edge
    // test against the hits (`avoid_suppression`), or goes prone.
    id: 'suppressive',
    name: 'Suppressive Fire',
    type: 'complex',
    ref: sr5Page(179, 'Suppressive Fire'),
    refs: [FIRE_MODES],
    rounds: 20,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: RANGED_NO_RECOIL,
    attack: 'suppressive',
  },
  {
    id: 'melee_attack',
    name: 'Melee Attack',
    type: 'complex',
    ref: sr5Page(167, 'Melee Attack'),
    refs: [lineRef('meleeCombat'), sr5Page(168, 'Accuracy')],
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: MELEE,
    needsTarget: true,
    exchange: 'opens',
    attack: 'melee',
  },
  {
    // The spell decides the kind of attack: a direct combat spell is resisted
    // (`direct-spell`), an indirect one is defended like a shot (`ranged`),
    // and a spell that attacks no one opens nothing (p.283).
    id: 'cast_spell',
    name: 'Cast Spell',
    type: 'complex',
    ref: sr5Page(167, 'Cast Spell'),
    refs: [lineRef('spellcasting'), lineRef('combatSpells')],
    pool: { from: 'spell' },
    limit: 'force',
    offers: CAST,
    needsTarget: true,
    exchange: 'opens',
  },
  {
    // Each hit adds 1 m (dwarf, troll) or 2 m (everyone else) this Combat Turn.
    id: 'sprint',
    name: 'Sprint',
    type: 'complex',
    ref: sr5Page(167, 'Sprint'),
    refs: [sr5Page(162, 'Sprinting')],
    pool: { from: 'skill', skill: 'running', attr: 'str' },
    limit: 'physical',
    offers: SPRINT,
  },
  {
    id: 'use_skill',
    name: 'Use Skill',
    type: 'complex',
    ref: sr5Page(167, 'Use Skill'),
    refs: [lineRef('skills')],
    pool: { from: 'skill' },
    limit: null,
    offers: SKILL,
  },
  {
    id: 'summoning',
    name: 'Summoning',
    type: 'complex',
    ref: sr5Page(167, 'Summoning'),
    refs: [lineRef('summoning')],
    pool: { from: 'skill', skill: 'summoning', attr: 'mag' },
    limit: 'force',
    offers: SKILL,
  },

  // --- Interrupt Actions (p.167-168): paid in Initiative Score, out of turn -
  // Not before the first Action Phase if surprised (p.167). Full Defense
  // stacks with Dodge, Block or Parry (p.188).
  {
    id: 'full_defense',
    name: 'Full Defense',
    type: 'interrupt',
    ref: lineRef('fullDefense'),
    refs: [DEFENDING, sr5Page(191, 'Full Defense')],
    initCost: 10,
    pool: { from: 'defense', plus: 'wil' },
    limit: null,
    offers: DEFENSE,
    exchange: 'defends',
    against: ['ranged', 'melee'],
    lasts: 'turn',
  },
  {
    // Against ranged attacks too — the GM's reading of p.168 (see the header).
    // Bringing a skill in brings the Physical limit with it (p.191).
    id: 'dodge',
    name: 'Dodge',
    type: 'interrupt',
    ref: sr5Page(168, 'Dodge'),
    refs: [DEFENDING, sr5Page(191, 'Dodge')],
    initCost: 5,
    pool: { from: 'defense', plus: 'gymnastics' },
    limit: 'physical',
    offers: DEFENSE,
    exchange: 'defends',
    against: ['ranged', 'melee'],
    lasts: 'test',
  },
  {
    // Empty hands, against an unarmed or melee attack (p.192).
    id: 'block',
    name: 'Block',
    type: 'interrupt',
    ref: sr5Page(168, 'Block'),
    refs: [DEFENDING, sr5Page(192, 'Block')],
    initCost: 5,
    pool: { from: 'defense', plus: 'unarmed-combat' },
    limit: 'physical',
    offers: DEFENSE,
    exchange: 'defends',
    against: ['melee'],
    lasts: 'test',
  },
  {
    // With that kind of melee weapon in hand (p.191-192).
    id: 'parry',
    name: 'Parry',
    type: 'interrupt',
    ref: sr5Page(168, 'Parry'),
    refs: [DEFENDING, sr5Page(191, 'Parry')],
    initCost: 5,
    pool: { from: 'defense', plus: 'weaponSkill' },
    limit: 'physical',
    offers: DEFENSE,
    exchange: 'defends',
    against: ['melee'],
    lasts: 'test',
  },
  {
    // A melee attack, out of turn, on someone slipping past within
    // 1 + Reach metres or breaking off from melee (p.194).
    id: 'intercept',
    name: 'Intercept',
    type: 'interrupt',
    ref: sr5Page(168, 'Intercept'),
    refs: [sr5Page(194, 'Interception')],
    initCost: 5,
    pool: { from: 'weapon' },
    limit: 'accuracy',
    offers: MELEE,
    needsTarget: true,
    exchange: 'opens',
    attack: 'melee',
  },
  {
    // Go prone under suppressive fire when the Free Action is already spent:
    // no Reaction + Edge test, just prone until standing up (p.168, 179-180).
    id: 'hit_the_dirt',
    name: 'Hit the Dirt',
    type: 'interrupt',
    ref: sr5Page(168, 'Hit the Dirt'),
    refs: [sr5Page(179, 'Suppressive Fire')],
    initCost: 5,
    pool: { from: 'none' },
    limit: null,
    offers: NONE,
    exchange: 'defends',
    against: ['suppressive'],
    avoids: ['suppressive'],
  },

  // --- Reactions: tests that are not actions --------------------------------
  {
    // Reaction + Intuition, free, no limit, against any attack the defender
    // knows is coming (p.173, 188). Always the first choice a card offers.
    id: 'defense',
    name: 'Defend',
    type: 'none',
    ref: DEFENDING,
    refs: [sr5Page(173, 'Step 3: Defend')],
    pool: { from: 'defense' },
    limit: null,
    offers: DEFENSE,
    exchange: 'defends',
    against: ['ranged', 'melee'],
  },
  {
    // Body + armor, the armor modified by AP; Body alone when AP takes the
    // armor to 0 (p.169, 173). No wound modifiers (p.170).
    id: 'soak',
    name: 'Resist Damage',
    type: 'none',
    ref: lineRef('soak'),
    refs: [sr5Page(173, 'Step 3: Defend'), sr5Page(170, 'Wound Modifiers')],
    pool: { from: 'soak' },
    limit: null,
    offers: SOAK,
    exchange: 'soaks',
  },
  {
    // A Perception Test the GM calls for; Observe in Detail is the one a
    // player buys with a Simple Action. Opposed by Sneaking when someone
    // hides (p.136).
    id: 'perception',
    name: 'Perception',
    type: 'none',
    ref: lineRef('perception'),
    refs: [lineRef('perceptionThresholds')],
    pool: { from: 'skill', skill: 'perception', attr: 'int' },
    limit: 'mental',
    offers: PERCEPTION,
  },
  {
    // Everyone in the zone rolls Reaction + Edge against the shooter's hits,
    // with the full Edge rating however much is spent, plus Full Defense's
    // dice, and −1 more for each further overlapping zone (p.179-180).
    id: 'avoid_suppression',
    name: 'Dodge suppressive fire',
    type: 'none',
    ref: sr5Page(179, 'Suppressive Fire'),
    refs: [sr5Page(180, 'Suppressive Fire')],
    pool: { from: 'attrs', attrs: ['rea', 'edg'] },
    limit: null,
    offers: ['full_defense', 'previous_defenses', ...ANY_TEST],
    exchange: 'defends',
    against: ['suppressive'],
  },
  {
    // A direct combat spell is opposed by Body (a physical spell) or
    // Willpower (a mana spell), and nothing resists the damage after (p.283).
    id: 'resist_direct_physical',
    name: 'Resist a physical direct spell',
    type: 'none',
    ref: lineRef('combatSpells'),
    pool: { from: 'attrs', attrs: ['bod'] },
    limit: null,
    offers: RESIST_SPELL,
    exchange: 'defends',
    against: ['direct-spell'],
  },
  {
    id: 'resist_direct_mana',
    name: 'Resist a mana direct spell',
    type: 'none',
    ref: lineRef('combatSpells'),
    pool: { from: 'attrs', attrs: ['wil'] },
    limit: null,
    offers: RESIST_SPELL,
    exchange: 'defends',
    against: ['direct-spell'],
  },
  {
    // Willpower + Charisma against a threshold the GM sets (p.152).
    id: 'composure',
    name: 'Composure',
    type: 'none',
    ref: sr5Page(152, 'Composure (CHA + WIL)'),
    pool: { from: 'attrs', attrs: ['wil', 'cha'] },
    limit: null,
    offers: ANY_TEST,
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_ID: ReadonlyMap<string, CombatAction> = new Map(COMBAT_ACTIONS.map((a) => [a.id, a] as const));

/** One action by id, or undefined for an id the catalogue does not know. */
export function combatAction(id: string): CombatAction | undefined {
  return BY_ID.get(id);
}

/**
 * The modifiers a card shows for an action, as catalogue entries in the
 * action's order. With `against`, the ones that only count against another
 * kind of attack drop out — the fire mode's penalty is no part of a Parry.
 */
export function offersFor(action: CombatAction | string, against?: AttackKind): SituationalModifier[] {
  const a = typeof action === 'string' ? combatAction(action) : action;
  if (!a) return [];
  const out: SituationalModifier[] = [];
  for (const id of a.offers) {
    const m = situationalModifier(id);
    if (!m) continue;
    if (against !== undefined && m.against !== undefined && !m.against.includes(against)) continue;
    out.push(m);
  }
  return out;
}

/**
 * What a defender may answer an incoming attack with, in the order a card
 * lists them: the free reactions first — the Reaction + Intuition test before
 * anything that costs Initiative, per the GM's ruling — then the Interrupts
 * in catalogue order (Full Defense, Dodge, Block, Parry, Hit the Dirt).
 *
 * - `ranged`: Defend, Full Defense, Dodge.
 * - `melee`: Defend, Full Defense, Dodge, Block, Parry.
 * - `suppressive`: the Reaction + Edge test, or Hit the Dirt.
 * - `direct-spell`: the Body and the Willpower resistance; the spell's type
 *   picks one (`directSpellResistance`).
 */
export function defenseOptions(kind: AttackKind): CombatAction[] {
  const answers = COMBAT_ACTIONS.filter((a) => a.exchange === 'defends' && a.against?.includes(kind));
  return [...answers.filter((a) => a.type === 'none'), ...answers.filter((a) => a.type !== 'none')];
}

/** The resistance test against a direct combat spell of this type (p.283). */
export function directSpellResistance(spellType: 'physical' | 'mana'): CombatAction {
  return BY_ID.get(spellType === 'physical' ? 'resist_direct_physical' : 'resist_direct_mana')!;
}

/**
 * The defense modifier a firing action imposes, less one for every round the
 * gun is short (p.180: a complex full-auto burst with 7 rounds left is −6, a
 * long burst that empties the last 5 is −4). Never better than 0. Without a
 * count of what is loaded, the full modifier stands.
 */
export function defenseModifierFor(action: CombatAction, roundsLoaded?: number): number {
  const full = action.defenseModifier ?? 0;
  if (full >= 0 || action.rounds === undefined || roundsLoaded === undefined) return full;
  const short = Math.max(0, action.rounds - Math.max(0, Math.floor(roundsLoaded)));
  return Math.min(0, full + short);
}

// ---------------------------------------------------------------------------
// The sheet's fire modes → actions
// ---------------------------------------------------------------------------

/**
 * The fire modes a weapon's stat line lists (p.178-179). `FireModeCode` is the
 * contracts' (`FireModeCodeSchema`, exchange.ts), since an exchange records
 * the mode; `FIRE_MODE_ACTIONS` below is keyed by it, so a code added there
 * without its actions here fails to compile.
 */
export const FIRE_MODE_CODES = ['SS', 'SA', 'BF', 'FA'] as const satisfies readonly FireModeCode[];

/**
 * What each fire mode lets the shooter do (p.162, 165-167, 179):
 *
 * - SS: a single shot.
 * - SA: a single shot, or three as a Semi-Auto Burst (Complex).
 * - BF: a burst (Simple), or a Long Burst (Complex).
 * - FA: six rounds (Simple), ten (Complex), or Suppressive Fire.
 */
export const FIRE_MODE_ACTIONS: Readonly<Record<FireModeCode, readonly string[]>> = {
  SS: ['fire_ss'],
  SA: ['fire_sa', 'fire_sb'],
  BF: ['fire_bf', 'fire_lb'],
  FA: ['fire_fa_simple', 'fire_fa_complex', 'suppressive'],
};

/**
 * Read the sheet's mode strings. They are typed by hand, so `['SA', 'BF']`,
 * `['SA/BF/FA']` and `['sa, bf']` all read the same; anything that is not
 * one of the four codes is ignored. Returned once each, in book order.
 */
export function fireModesOf(modes: readonly string[]): FireModeCode[] {
  const seen = new Set<string>();
  for (const entry of modes) {
    for (const token of entry.split(/[\s,/|;]+/)) seen.add(token.trim().toUpperCase());
  }
  return FIRE_MODE_CODES.filter((code) => seen.has(code));
}

/** The firing actions a weapon's modes allow, in catalogue order. */
export function fireActionsFor(modes: readonly string[]): CombatAction[] {
  const ids = new Set(fireModesOf(modes).flatMap((code) => FIRE_MODE_ACTIONS[code]));
  return COMBAT_ACTIONS.filter((a) => ids.has(a.id));
}

/** The melee skills: the Combat Active Skills that do not shoot or throw. */
const MELEE_SKILLS: ReadonlySet<string> = new Set(['blades', 'clubs', 'unarmed-combat']);

/** True for a melee weapon's skill: Blades, Clubs, Unarmed Combat, an exotic melee weapon. */
export function isMeleeSkill(skillId: string): boolean {
  const key = skillKey(skillId).split('::')[0] ?? '';
  return MELEE_SKILLS.has(key) || key.startsWith('exotic-melee');
}

/**
 * The attack actions a sheet weapon offers: Melee Attack for a melee skill,
 * Throw Weapon for a thrown one, Fire Bow for a bow, and otherwise the firing
 * actions its modes allow. A gun with no modes typed in offers nothing — the
 * card cannot guess its mode, and the sheet should say.
 */
export function attackActionsFor(weapon: Pick<SheetWeapon, 'skillId' | 'modes'>): CombatAction[] {
  const key = skillKey(weapon.skillId).split('::')[0] ?? '';
  const one = (id: string): CombatAction[] => [BY_ID.get(id)!];
  if (isMeleeSkill(weapon.skillId)) return one('melee_attack');
  if (key === 'throwing-weapons') return one('throw_weapon');
  if (key === 'archery') return one('fire_bow');
  return fireActionsFor(weapon.modes);
}
