/**
 * The situational modifier catalogue: every buff and debuff a guided roll card
 * can offer, as data — an id, a label in our own words, the number, and the
 * page it comes from.
 *
 * ## What this is and is not
 *
 * This is a list of FACTS ABOUT THE BOOK, not rules text (DESIGN.md §14): the
 * labels are short names we wrote, the values are the numbers the tables
 * print, and every entry carries the printed page of the paragraph that
 * explains it, so the ref chip beside a tick box opens the book where the
 * reason is. The pages were read off the GM's own core rulebook (printed page
 * = PDF page − 5), not remembered.
 *
 * ## How a card uses it
 *
 * An action in `actions.ts` lists the ids it `offers`. The card shows each
 * one; what happens next depends on the entry:
 *
 * - An `auto` entry is a line the engine works out itself — the wound
 *   modifier, the scene's environment, recoil, Full Defense's Willpower. The
 *   card shows it already filled in, with its page, and the GM can still
 *   strike it.
 * - A `declared` entry is a fact of the incoming attack — the defense penalty
 *   a burst carries, a shotgun's spread, the attack's AP. It arrives filled in
 *   and labelled with whoever declared the attack (the GM's decision of
 *   2026-09-28: declared facts are not judgement calls).
 * - Everything else is a tick box. The GM ticks what applies before the dice
 *   count is shown; nothing situational is ticked for them.
 *
 * Entries that share a `group` are alternatives — partial or good cover, one
 * choke setting, a running or a sprinting target — so ticking one clears the
 * rest of its group.
 *
 * ## Where the pages come from
 *
 * - Ranged attacks: the Situational Modifiers table (p.176), each row
 *   explained over p.177-178; a moving target's penalty sits with Running
 *   Modifiers (p.162-163); a Delayed Action's −1 is on p.161.
 * - Melee attacks: the Melee Modifiers table and its paragraphs (p.186-187).
 * - Defense: the Defense Modifiers table (p.189), each row explained on
 *   p.188-190; the fire-mode penalties are the Firing Mode Table (p.180).
 * - Soak: Armor Penetration (p.169). Wound modifiers do NOT apply to damage
 *   resistance or to resisting a direct combat spell (p.170) — the soak and
 *   resist actions simply do not offer the wounds line.
 * - Perception: the Perception Test Modifiers table (p.135); thresholds are
 *   the next page (p.136).
 */
import type { AttackKind, ModifierAuto, ModifierGroup, PerUnit, Ref } from '@safehouse/contracts';
import { lineRef, sr5Page } from '../refs.js';
import { COVER_DEFENCE_BONUS } from '../vision/cover.js';

/**
 * Which kind of test a modifier belongs to. `action` is any test made on the
 * actor's own action — an attack, a spell, a skill, an Observe in Detail —
 * and never a defense or a soak; `all` is every test there is.
 */
export type ModifierScope =
  | 'attack.ranged'
  | 'attack.melee'
  | 'defense'
  | 'soak'
  | 'perception'
  | 'action'
  | 'all';

/**
 * The vocabularies a guided card carries to the browser live in the contracts
 * and are re-exported from here, so this catalogue and the card cannot drift
 * apart:
 *
 * - `AttackKind` (exchange.ts): what kind of attack is incoming, as far as the
 *   defender's choices care. `ranged` includes an indirect combat spell, which
 *   is defended like a shot (p.283); `direct-spell` is resisted, never
 *   defended (p.283); `suppressive` is dodged with its own Reaction + Edge test
 *   (p.179).
 * - `ModifierGroup` (roll-card.ts): alternatives — tick one and the rest of
 *   the group clears.
 * - `ModifierAuto` (roll-card.ts): the lines the engine fills in itself (see
 *   the header).
 * - `PerUnit` (roll-card.ts): what a per-unit value counts — Take Aim actions,
 *   points of net Reach, …
 */
export type { AttackKind, ModifierAuto, ModifierGroup, PerUnit };

/**
 * A modifier's number. A plain number is dice (or Accuracy, see `target`); a
 * per-unit value is multiplied by a count the card asks for or the engine
 * knows; `null` means there is no fixed number — the engine computes it
 * (`auto`), or the entry replaces the test altogether (`noDefense`).
 */
export type ModifierValue = number | { per: number; unit: PerUnit } | null;

/** The columns of the Environmental Modifiers table (p.175). Glare shares the light column. */
export type EnvColumn = 'visibility' | 'light' | 'wind' | 'range';

export interface SituationalModifier {
  id: string;
  /** A short name in our own words — never the book's text. */
  label: string;
  /** Which tests it can apply to (see `ModifierScope`). */
  applies: readonly ModifierScope[];
  value: ModifierValue;
  /** What it changes: the dice pool unless this says the limit (Take Aim's +1 Accuracy). */
  target?: 'limit';
  /** Where the book explains it. */
  ref: Ref;
  /** Other pages worth a look — the table the number sits in, the action behind it. */
  refs?: readonly Ref[];
  group?: ModifierGroup;
  auto?: ModifierAuto;
  /** A fact of the incoming attack: arrives filled in, labelled with who declared it. */
  declared?: true;
  /** Only against these kinds of attack; any attack when absent. */
  against?: readonly AttackKind[];
  /** For an environment line: which columns of the p.175 table it reads. */
  columns?: readonly EnvColumn[];
  /** Ticking it means there is no defense test at all: the attack becomes a Success Test (p.189). */
  noDefense?: true;
}

// ---------------------------------------------------------------------------
// Pages used more than once
// ---------------------------------------------------------------------------

const RANGED_TABLE = lineRef('situational'); // p.176
const MELEE_TABLE = sr5Page(187, 'Melee Modifiers');
const DEFENSE_TABLE = lineRef('defenseModifiers'); // p.189
const CALLED_SHOTS = sr5Page(195, 'Called Shots');
const RUNNING_MODIFIERS = sr5Page(162, 'Running Modifiers');
const PERCEPTION_TABLE = sr5Page(135, 'Perception Test Modifiers');

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Every situational modifier the guided cards know, grouped by the table it
 * comes from. Order within a group is the order a card lists them in.
 */
export const SITUATIONAL_MODIFIERS: readonly SituationalModifier[] = [
  // --- lines the engine fills in, on many kinds of test -------------------
  {
    // Attacker wounded (p.176), defender wounded (p.189), and every other
    // test — except damage resistance and resisting a direct combat spell
    // (p.170), which is why soak and the resist actions never offer it.
    id: 'wounds',
    label: 'Wounds',
    applies: ['all'],
    value: null,
    auto: 'wounds',
    ref: lineRef('wounds'),
    refs: [sr5Page(170, 'Wound Modifiers')],
  },
  {
    // −2 dice per spell held, on all tests (p.282).
    id: 'sustaining',
    label: 'Sustaining spells',
    applies: ['all'],
    value: { per: -2, unit: 'spell' },
    auto: 'sustaining',
    ref: lineRef('sustaining'),
  },
  {
    // A Delayed Action that cuts in takes −1 on whatever it does (p.161).
    id: 'delayed_action',
    label: 'Acting on a delayed action',
    applies: ['action'],
    value: -1,
    ref: lineRef('delaying'),
  },
  {
    // The whole Environmental Modifiers table: the single worst row across
    // visibility, light/glare, wind and range, bumped one row when two
    // conditions tie at the worst (p.175, with p.173's "Range is an
    // environmental modifier"). Range belongs INSIDE this line, not on top of
    // it — `environmentLookup` (env.ts) computes it, `columns` included.
    id: 'environment',
    label: 'Environment',
    applies: ['attack.ranged'],
    value: null,
    auto: 'environment',
    columns: ['visibility', 'light', 'wind', 'range'],
    ref: lineRef('environment'),
    refs: [sr5Page(173, 'Environmental Modifiers'), sr5Page(176, 'Environmental Modifiers (examples)')],
  },
  {
    // Melee reads only the light and visibility columns (p.187), and so do
    // Perception Tests by sight (p.135) and spells cast by visual targeting
    // (p.281). Same lookup, fewer columns.
    id: 'environment_sight',
    label: 'Environment (light and visibility)',
    applies: ['attack.melee', 'perception'],
    value: null,
    auto: 'environment',
    columns: ['visibility', 'light'],
    ref: MELEE_TABLE,
    refs: [lineRef('environment'), lineRef('perception'), lineRef('spellcasting')],
  },

  // --- ranged attack: Situational Modifiers table (p.176) -----------------
  {
    // One free point, STR ÷ 3 rounded up and the gun's compensation, less the
    // rounds about to fly, carried from shot to shot (p.175).
    id: 'recoil',
    label: 'Recoil',
    applies: ['attack.ranged'],
    value: null,
    auto: 'recoil',
    ref: lineRef('recoil'),
  },
  {
    // Each Take Aim is +1 die OR +1 Accuracy, the player's pick each time,
    // cumulative up to half Willpower rounded up, and lost to any other
    // action first (p.166). Two entries, not a group: a character who aimed
    // twice may take one of each.
    id: 'aim_dice',
    label: 'Took aim: +1 die each',
    applies: ['attack.ranged'],
    value: { per: 1, unit: 'aim' },
    ref: sr5Page(178, 'Previously Aimed with Take Aim'),
    refs: [sr5Page(166, 'Take Aim'), RANGED_TABLE],
  },
  {
    id: 'aim_accuracy',
    label: 'Took aim: +1 Accuracy each',
    applies: ['attack.ranged'],
    value: { per: 1, unit: 'aim' },
    target: 'limit',
    ref: sr5Page(178, 'Previously Aimed with Take Aim'),
    refs: [sr5Page(166, 'Take Aim'), RANGED_TABLE],
  },
  {
    id: 'smartgun_gear',
    label: 'Wireless smartgun (external gear)',
    applies: ['attack.ranged'],
    value: 1,
    group: 'smartgun',
    ref: sr5Page(178, 'Wireless Smartgun'),
    refs: [RANGED_TABLE],
  },
  {
    id: 'smartgun_implant',
    label: 'Wireless smartgun (implanted)',
    applies: ['attack.ranged'],
    value: 2,
    group: 'smartgun',
    ref: sr5Page(178, 'Wireless Smartgun'),
    refs: [RANGED_TABLE],
  },
  {
    // Also needs the Call a Shot Free Action (p.163).
    id: 'called_shot',
    label: 'Called shot',
    applies: ['attack.ranged'],
    value: -4,
    ref: CALLED_SHOTS,
    refs: [sr5Page(178, 'Called Shot'), RANGED_TABLE],
  },
  {
    // Running costs −2 on EVERY action taken while running, not only a shot
    // (p.162: all actions but a Sprint); the ranged table repeats it for the
    // shot (p.176, 178). So it rides on `action` too, and a spell, a skill or
    // an Observe in Detail made on the run can tick it. Two actions leave it
    // out (actions.ts): Sprint, which the rule excepts, and a melee attack,
    // where running in makes a charge and the charge ignores this −2 (p.186).
    id: 'attacker_running',
    label: 'Running this turn',
    applies: ['attack.ranged', 'action'],
    value: -2,
    ref: RUNNING_MODIFIERS,
    refs: [sr5Page(178, 'Attacker Running'), RANGED_TABLE],
  },
  {
    // Also on the whole pool when firing two guns at once (p.178).
    id: 'off_hand',
    label: 'Off-hand weapon, or two at once',
    applies: ['attack.ranged'],
    value: -2,
    ref: sr5Page(178, 'Attacker Using Off-Hand Weapon'),
    refs: [RANGED_TABLE],
  },
  {
    // The same as Total Darkness and not added to it (p.178).
    id: 'blind_fire',
    label: 'Blind fire',
    applies: ['attack.ranged'],
    value: -6,
    ref: sr5Page(178, 'Blind Fire'),
    refs: [RANGED_TABLE],
  },
  {
    id: 'attacker_in_melee',
    label: 'Shooter is in melee',
    applies: ['attack.ranged'],
    value: -3,
    ref: sr5Page(177, 'Attacker in Melee Combat'),
    refs: [RANGED_TABLE],
  },
  {
    id: 'attacker_in_vehicle',
    label: 'Shooting from a moving vehicle',
    applies: ['attack.ranged'],
    value: -2,
    ref: sr5Page(177, 'Attacker Firing from a Moving Vehicle'),
    refs: [RANGED_TABLE],
  },
  {
    id: 'imaging_from_cover',
    label: 'Shooting around cover by camera',
    applies: ['attack.ranged'],
    value: -3,
    ref: sr5Page(177, 'Attacker Firing from Cover with Imaging Device'),
    refs: [RANGED_TABLE],
  },
  {
    id: 'target_running',
    label: 'Target is running',
    applies: ['attack.ranged'],
    value: -2,
    group: 'targetMoving',
    ref: RUNNING_MODIFIERS,
  },
  {
    // The sentence runs over the page break onto p.163.
    id: 'target_sprinting',
    label: 'Target is sprinting',
    applies: ['attack.ranged'],
    value: -4,
    group: 'targetMoving',
    ref: sr5Page(163, 'Running Modifiers'),
    refs: [RUNNING_MODIFIERS],
  },

  // --- melee attack: Melee Modifiers table (p.187) ------------------------
  {
    // The charger also ignores the usual −2 for running (p.186).
    id: 'charging',
    label: 'Charging in',
    applies: ['attack.melee'],
    value: 2,
    ref: sr5Page(186, 'Attacker Making Charging Attack'),
    refs: [MELEE_TABLE],
  },
  {
    id: 'attacker_prone',
    label: 'Attacker is prone',
    applies: ['attack.melee'],
    value: -1,
    ref: MELEE_TABLE,
  },
  {
    id: 'melee_called_shot',
    label: 'Called shot',
    applies: ['attack.melee'],
    value: -4,
    ref: CALLED_SHOTS,
    refs: [MELEE_TABLE],
  },
  {
    id: 'superior_position',
    label: 'Superior position',
    applies: ['attack.melee'],
    value: 2,
    ref: MELEE_TABLE,
  },
  {
    id: 'melee_off_hand',
    label: 'Off-hand weapon',
    applies: ['attack.melee'],
    value: -2,
    ref: MELEE_TABLE,
  },
  {
    // One bonus however many friends; Melee Teamwork is the other option (p.188).
    id: 'friends_in_melee',
    label: 'Friends in the melee',
    applies: ['attack.melee'],
    value: 1,
    ref: MELEE_TABLE,
  },
  {
    id: 'opponent_prone',
    label: 'Opponent is prone',
    applies: ['attack.melee'],
    value: 1,
    ref: MELEE_TABLE,
  },
  {
    // A touch-only attack also wins ties (p.187).
    id: 'touch_only',
    label: 'Touch-only attack',
    applies: ['attack.melee'],
    value: 2,
    ref: MELEE_TABLE,
  },

  // --- defense: Defense Modifiers table (p.189) ---------------------------
  {
    // Burst −2, long burst or simple full-auto −5, complex full-auto −9,
    // less one for each bullet short (p.180). The number rides on the
    // attacker's action (`defenseModifier`), so this line only names it.
    id: 'fire_mode',
    label: 'Fire mode',
    applies: ['defense'],
    value: null,
    auto: 'fireMode',
    declared: true,
    against: ['ranged'],
    ref: lineRef('fireModes'),
    refs: [sr5Page(190, 'Attacker Firing Burst, Long Burst or Full Auto'), DEFENSE_TABLE],
  },
  {
    // The choke setting the attacker chose (p.180-181); the defender's
    // penalty is the same at every range.
    id: 'spread_narrow',
    label: 'Shotgun, narrow spread',
    applies: ['defense'],
    value: -1,
    group: 'spread',
    declared: true,
    against: ['ranged'],
    ref: sr5Page(189, 'Firing Flechette on Narrow Spread'),
    refs: [sr5Page(180, 'Choke Settings')],
  },
  {
    id: 'spread_medium',
    label: 'Shotgun, medium spread',
    applies: ['defense'],
    value: -3,
    group: 'spread',
    declared: true,
    against: ['ranged'],
    ref: sr5Page(189, 'Firing Flechette on Medium Spread'),
    refs: [sr5Page(180, 'Choke Settings')],
  },
  {
    id: 'spread_wide',
    label: 'Shotgun, wide spread',
    applies: ['defense'],
    value: -5,
    group: 'spread',
    declared: true,
    against: ['ranged'],
    ref: sr5Page(189, 'Firing Flechette on Wide Spread'),
    refs: [sr5Page(181, 'Wide Spread')],
  },
  {
    // Going on Full Defense adds Willpower to every defense test for the
    // rest of the Combat Turn, on top of Dodge, Block or Parry (p.168, 188),
    // and to the Reaction + Edge test against suppressive fire (p.179).
    id: 'full_defense',
    label: 'Full Defense (+WIL)',
    applies: ['defense'],
    value: null,
    auto: 'fullDefense',
    ref: lineRef('fullDefense'),
    refs: [sr5Page(191, 'Full Defense')],
  },
  {
    // −1 for each defense already rolled since the defender's last Action
    // Phase (p.189); the count resets when the defender acts.
    id: 'previous_defenses',
    label: 'Already defended since last action',
    applies: ['defense'],
    value: { per: -1, unit: 'defense' },
    auto: 'previousDefenses',
    ref: sr5Page(189, 'Defender Has Defended Against Previous Attacks'),
  },
  {
    // Cover helps the defender: good is more than half the body hidden,
    // partial a quarter to a half (p.190). Good cover counts against any
    // attack; partial against ranged attacks and indirect spells. The
    // numbers are the map's own cover table, so the two can never disagree.
    id: 'cover_good',
    label: 'Good cover',
    applies: ['defense'],
    value: COVER_DEFENCE_BONUS.good,
    group: 'cover',
    ref: lineRef('cover'),
    refs: [DEFENSE_TABLE],
  },
  {
    id: 'cover_partial',
    label: 'Partial cover',
    applies: ['defense'],
    value: COVER_DEFENCE_BONUS.partial,
    group: 'cover',
    against: ['ranged'],
    ref: lineRef('cover'),
    refs: [DEFENSE_TABLE],
  },
  {
    // Against a shot only when the shooter is within 5 m (p.189).
    id: 'defender_prone',
    label: 'Defender is prone (melee, or a shot from 5 m)',
    applies: ['defense'],
    value: -2,
    against: ['melee', 'ranged'],
    ref: sr5Page(189, 'Defender Prone'),
  },
  {
    id: 'defender_running',
    label: 'Defender is running',
    applies: ['defense'],
    value: 2,
    ref: sr5Page(190, 'Defender Running'),
    refs: [DEFENSE_TABLE],
  },
  {
    id: 'defender_in_melee',
    label: 'Defender is in melee (against a shot)',
    applies: ['defense'],
    value: -3,
    against: ['ranged'],
    ref: sr5Page(190, 'Defender in Melee Target of Ranged Attack'),
    refs: [DEFENSE_TABLE],
  },
  {
    // Blasts, grenades, rockets, area spells (p.190).
    id: 'area_effect',
    label: 'Area-effect attack',
    applies: ['defense'],
    value: -2,
    against: ['ranged'],
    ref: sr5Page(190, 'Targeted by an Area-Effect Attack'),
    refs: [DEFENSE_TABLE],
  },
  {
    id: 'in_vehicle',
    label: 'Defender inside a moving vehicle',
    applies: ['defense'],
    value: 3,
    ref: sr5Page(188, 'Defender Inside a Moving Vehicle'),
    refs: [DEFENSE_TABLE],
  },
  {
    // The net Reach difference counts against whoever is shorter (p.186, 189).
    id: 'attacker_reach',
    label: 'Attacker has the longer reach',
    applies: ['defense'],
    value: { per: -1, unit: 'reach' },
    group: 'reach',
    against: ['melee'],
    ref: DEFENSE_TABLE,
    refs: [sr5Page(186, 'Reach')],
  },
  {
    id: 'defender_reach',
    label: 'Defender has the longer reach',
    applies: ['defense'],
    value: { per: 1, unit: 'reach' },
    group: 'reach',
    against: ['melee'],
    ref: DEFENSE_TABLE,
    refs: [sr5Page(186, 'Reach')],
  },
  {
    // Only with a Delayed Action held for the charge (p.189).
    id: 'receiving_charge',
    label: 'Met the charge with a held action',
    applies: ['defense'],
    value: 1,
    against: ['melee'],
    ref: DEFENSE_TABLE,
  },
  {
    // Didn't see it coming: no defense test at all, the attack is a plain
    // Success Test. Not for someone already in the fight; behind cover, the
    // cover alone makes the defense pool (p.189).
    id: 'unaware',
    label: 'Defender is unaware of the attack',
    applies: ['defense'],
    value: null,
    noDefense: true,
    ref: sr5Page(189, 'Defender Unaware of Attack'),
    refs: [sr5Page(192, 'Surprise')],
  },

  // --- soak ---------------------------------------------------------------
  {
    // What the attack's AP does to the armor: nothing on someone wearing
    // none, and never below zero — Body alone then (p.169).
    id: 'ap',
    label: 'Armor penetration',
    applies: ['soak'],
    value: null,
    auto: 'ap',
    declared: true,
    ref: lineRef('armorPenetration'),
    refs: [sr5Page(173, 'Step 3: Defend')],
  },

  // --- perception: Perception Test Modifiers table (p.135) ----------------
  {
    id: 'perceiver_distracted',
    label: 'Distracted',
    applies: ['perception'],
    value: -2,
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'looking_for_it',
    label: 'Looking or listening for it',
    applies: ['perception'],
    value: 3,
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'not_nearby',
    label: 'Not in the immediate area',
    applies: ['perception'],
    value: -2,
    group: 'distance',
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'far_away',
    label: 'Far away',
    applies: ['perception'],
    value: -3,
    group: 'distance',
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'stands_out',
    label: 'Stands out',
    applies: ['perception'],
    value: 2,
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'interference',
    label: 'Sight, sound or smell interfered with',
    applies: ['perception'],
    value: -2,
    ref: PERCEPTION_TABLE,
  },
  {
    id: 'sense_enhancement',
    label: 'Active sense enhancement (+rating)',
    applies: ['perception'],
    value: { per: 1, unit: 'rating' },
    ref: PERCEPTION_TABLE,
  },
];

/**
 * How hard a thing is to notice (p.136): the threshold for a Perception Test.
 * The labels are ours; the table's own examples stay in the book.
 */
export const PERCEPTION_THRESHOLDS: readonly { id: string; label: string; threshold: number; ref: Ref }[] = [
  { id: 'obvious', label: 'Obvious, large or loud', threshold: 1, ref: lineRef('perceptionThresholds') },
  { id: 'normal', label: 'Ordinary', threshold: 2, ref: lineRef('perceptionThresholds') },
  { id: 'obscured', label: 'Obscured, small or muffled', threshold: 3, ref: lineRef('perceptionThresholds') },
  { id: 'hidden', label: 'Hidden, tiny or silent', threshold: 4, ref: lineRef('perceptionThresholds') },
];

const BY_ID: ReadonlyMap<string, SituationalModifier> = new Map(
  SITUATIONAL_MODIFIERS.map((m) => [m.id, m] as const),
);

/** One catalogue entry by id, or undefined for an id this catalogue does not know. */
export function situationalModifier(id: string): SituationalModifier | undefined {
  return BY_ID.get(id);
}

/**
 * The entries for some kinds of test, in catalogue order. With `against`, the
 * ones that only count against another kind of attack are left out — a
 * shotgun's spread is no concern of a man blocking a punch.
 */
export function situationalFor(
  scopes: readonly ModifierScope[],
  against?: AttackKind,
): SituationalModifier[] {
  return SITUATIONAL_MODIFIERS.filter(
    (m) =>
      m.applies.some((s) => scopes.includes(s)) &&
      (against === undefined || m.against === undefined || m.against.includes(against)),
  );
}
