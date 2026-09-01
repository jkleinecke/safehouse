/**
 * Street cluster — the bodies a night in the sprawl is actually made of.
 * Original content (§14): the Fraywire are ours, so are their tier labels.
 */
import { gearSlot, kit } from './gear.js';
import { archetype, type StarterArchetype } from './types.js';

const SPRAWL = { human: 3, ork: 3, elf: 1, dwarf: 1 };
const SPRAWL_HEAVY = { human: 2, ork: 4, troll: 2, dwarf: 1, elf: 1 };

// ---------------------------------------------------------------------------
// Street ganger — the four bodies in the alley
// ---------------------------------------------------------------------------

const FRAY_LOW = [
  gearSlot('primary-weapon', ['Kestrel holdout', 'Weighted pipe', 'Utility blade']),
  gearSlot('armor', ['Sprawl weave hoodie']),
  gearSlot('utility', ['Burner commlink', 'Stim patch']),
];
const FRAY_HIGH = [
  gearSlot('primary-weapon', ['Coilworks machine pistol', 'Cutdown scattergun']),
  gearSlot('sidearm', ['Kestrel holdout', 'Weighted pipe', 'Utility blade']),
  gearSlot('armor', ['Layered street jacket']),
  gearSlot('utility', ['Burner commlink', 'Stim patch'], [1, 2]),
];

export const STREET_GANGER: StarterArchetype = archetype({
  id: 'street-ganger',
  name: 'Fraywire runner (street ganger)',
  summary: 'The four bodies in the alley — a speed bump with something to prove and no plan past the first exchange.',
  roleTags: ['ganger', 'street', 'muscle'],
  statblock: kit({
    weapons: ['Kestrel holdout', 'Coilworks machine pistol', 'Cutdown scattergun', 'Weighted pipe', 'Utility blade'],
    armor: ['Sprawl weave hoodie', 'Layered street jacket'],
    gear: ['Burner commlink', 'Stim patch'],
  }),
  tiers: [
    {
      id: 'street', label: 'Tag-along',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [2, 3], str: [3, 4], wil: [2, 3], log: [1, 3], int: [2, 3], cha: [2, 3] },
      skills: { pistols: [1, 2], clubs: [1, 3], blades: [1, 2], perception: [1, 2], intimidation: [1, 3], sneaking: [1, 2], running: [1, 2] },
      pr: [1, 2], metatypes: SPRAWL, loadout: FRAY_LOW,
    },
    {
      id: 'blooded', label: 'Cut in',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [3, 4], str: [4, 5], wil: [3, 4], log: [2, 3], int: [3, 4], cha: [2, 4] },
      skills: { automatics: [3, 4], longarms: [2, 3], clubs: [3, 4], perception: [2, 3], intimidation: [3, 4], sneaking: [2, 3], running: [2, 3] },
      pr: [2, 3], metatypes: SPRAWL, loadout: FRAY_HIGH,
    },
    {
      id: 'pro', label: 'Runs the corner',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [4, 5], str: [5, 6], wil: [4, 5], log: [3, 4], int: [4, 5], cha: [3, 4] },
      skills: { automatics: [4, 5], longarms: [3, 5], clubs: [4, 5], perception: [3, 4], intimidation: [4, 5], sneaking: [3, 4], leadership: [2, 3] },
      pr: [3, 4], metatypes: SPRAWL_HEAVY, loadout: FRAY_HIGH,
    },
    {
      id: 'elite', label: 'Fraywire prime',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [5, 6], str: [6, 7], wil: [5, 6], log: [3, 5], int: [5, 6], cha: [4, 5] },
      skills: { automatics: [6, 7], longarms: [5, 6], clubs: [5, 6], perception: [5, 6], intimidation: [5, 6], sneaking: [4, 5], leadership: [3, 4] },
      pr: [4, 5], metatypes: SPRAWL_HEAVY, loadout: FRAY_HIGH,
    },
  ],
  persona: {
    traits: ['territorial about three streets nobody else wants', 'brave in a group and nowhere else'],
    voice: 'Fast, loud, all dares and no follow-through until somebody calls one.',
    goals: ['Not be the one who backed down'],
    hooks: ['Will take a bribe if it can be called a toll in front of the others.'],
  },
});

// ---------------------------------------------------------------------------
// Gang lieutenant — the one who calls for backup
// ---------------------------------------------------------------------------

const LT_KIT = [
  gearSlot('primary-weapon', ['Ninebar heavy pistol', 'Brakeline SMG']),
  gearSlot('sidearm', ['Filament knife', 'Weighted pipe']),
  gearSlot('armor', ['Layered street jacket', 'Doorman longcoat']),
  gearSlot('utility', ['Burner commlink', 'Counterfeit ID chip', 'Flash canister', 'Restraint ties'], [1, 2]),
];

export const GANG_LIEUTENANT: StarterArchetype = archetype({
  id: 'gang-lieutenant',
  name: 'Gang lieutenant',
  summary: 'The one who calls for backup and decides whether the crew runs — drop them and the fight ends early.',
  roleTags: ['lieutenant', 'ganger', 'leader', 'face'],
  statblock: kit({
    weapons: ['Ninebar heavy pistol', 'Brakeline SMG', 'Filament knife', 'Weighted pipe', 'Flash canister'],
    armor: ['Layered street jacket', 'Doorman longcoat'],
    gear: ['Burner commlink', 'Counterfeit ID chip', 'Restraint ties', 'Stim patch'],
  }),
  tiers: [
    {
      id: 'street', label: 'Corner boss',
      attrs: { bod: [4, 5], agi: [3, 5], rea: [3, 4], str: [4, 5], wil: [3, 4], log: [2, 3], int: [3, 4], cha: [3, 4] },
      skills: { pistols: [2, 3], clubs: [2, 3], intimidation: [3, 4], leadership: [2, 3], perception: [2, 3], negotiation: [1, 3] },
      pr: [2, 3], metatypes: SPRAWL, loadout: LT_KIT,
    },
    {
      id: 'blooded', label: 'Crew lieutenant',
      attrs: { bod: [5, 6], agi: [4, 5], rea: [4, 5], str: [5, 6], wil: [4, 5], log: [3, 4], int: [4, 5], cha: [4, 5] },
      skills: { pistols: [4, 5], automatics: [3, 4], clubs: [3, 4], intimidation: [4, 5], leadership: [3, 4], perception: [3, 4], negotiation: [3, 4] },
      pr: [3, 4], metatypes: SPRAWL, loadout: LT_KIT,
    },
    {
      id: 'pro', label: 'Set leader',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [5, 6], log: [3, 5], int: [5, 6], cha: [5, 6] },
      skills: { pistols: [5, 6], automatics: [4, 6], clubs: [4, 5], intimidation: [5, 6], leadership: [5, 6], perception: [4, 5], negotiation: [4, 5] },
      pr: [4, 5], metatypes: SPRAWL_HEAVY, loadout: LT_KIT,
    },
    {
      id: 'elite', label: 'Warlord',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [6, 7], wil: [6, 7], log: [4, 5], int: [6, 7], cha: [6, 7] },
      skills: { pistols: [6, 7], automatics: [6, 7], clubs: [5, 6], intimidation: [6, 7], leadership: [6, 7], perception: [5, 6], negotiation: [5, 6] },
      pr: [5, 6], metatypes: SPRAWL_HEAVY, loadout: LT_KIT,
    },
  ],
  persona: {
    traits: ['runs the set like a shift, not a gang', 'counts the exits before the faces'],
    voice: 'Low and unhurried. Answers questions with questions, never uses a name twice.',
    goals: ['Come out of tonight still holding the block'],
    hooks: ['Will trade a body for a clean exit, and will not say so where the crew can hear.'],
  },
});

// ---------------------------------------------------------------------------
// Door heavy — the fight you can still talk your way out of
// ---------------------------------------------------------------------------

const DOOR_KIT = [
  gearSlot('primary-weapon', ['Telescoping baton', 'Jolt gloves', 'Riot shock stick']),
  gearSlot('sidearm', ['Kestrel holdout']),
  gearSlot('armor', ['Padded club coat', 'Doorman longcoat']),
  gearSlot('utility', ['Duty commlink', 'Scanner wand', 'Restraint ties'], [1, 2]),
];

export const DOOR_HEAVY: StarterArchetype = archetype({
  id: 'door-heavy',
  name: 'Door heavy (bouncer)',
  summary: 'Stops the run at the rope — the encounter the party can still solve with a name, a bribe or a lie.',
  roleTags: ['muscle', 'security', 'street'],
  statblock: kit({
    weapons: ['Telescoping baton', 'Jolt gloves', 'Riot shock stick', 'Kestrel holdout'],
    armor: ['Padded club coat', 'Doorman longcoat'],
    gear: ['Duty commlink', 'Scanner wand', 'Restraint ties'],
  }),
  tiers: [
    {
      id: 'street', label: 'New on the door',
      attrs: { bod: [4, 5], agi: [3, 4], rea: [3, 4], str: [4, 6], wil: [3, 4], log: [2, 3], int: [2, 4], cha: [2, 4] },
      skills: { 'unarmed-combat': [2, 3], clubs: [1, 3], intimidation: [2, 4], perception: [2, 3], etiquette: [1, 2] },
      pr: [1, 2], metatypes: SPRAWL_HEAVY, loadout: DOOR_KIT,
    },
    {
      id: 'blooded', label: 'On the door',
      attrs: { bod: [5, 6], agi: [4, 5], rea: [4, 5], str: [5, 7], wil: [4, 5], log: [2, 4], int: [3, 5], cha: [3, 4] },
      skills: { 'unarmed-combat': [4, 5], clubs: [3, 4], intimidation: [4, 5], perception: [3, 4], etiquette: [2, 3], pistols: [2, 3] },
      pr: [2, 3], metatypes: SPRAWL_HEAVY, loadout: DOOR_KIT,
    },
    {
      id: 'pro', label: 'Head of door',
      attrs: { bod: [6, 7], agi: [5, 6], rea: [5, 6], str: [6, 7], wil: [5, 6], log: [3, 4], int: [4, 5], cha: [4, 5] },
      skills: { 'unarmed-combat': [5, 6], clubs: [4, 5], intimidation: [5, 6], perception: [4, 5], etiquette: [3, 4], pistols: [3, 4], leadership: [2, 4] },
      pr: [3, 4], metatypes: SPRAWL_HEAVY, loadout: DOOR_KIT,
    },
    {
      id: 'elite', label: 'House muscle',
      attrs: { bod: [7, 8], agi: [6, 7], rea: [6, 7], str: [7, 8], wil: [6, 7], log: [4, 5], int: [5, 6], cha: [5, 6] },
      skills: { 'unarmed-combat': [6, 7], clubs: [6, 7], intimidation: [6, 7], perception: [5, 6], etiquette: [4, 5], pistols: [4, 5], leadership: [3, 5] },
      pr: [4, 5], metatypes: SPRAWL_HEAVY, loadout: DOOR_KIT,
    },
  ],
  persona: {
    traits: ['remembers every face that has ever been thrown out', 'would rather be bored'],
    voice: 'Flat, polite, and entirely uninterested in the reason.',
    goals: ['Get to the end of the shift without paperwork'],
    hooks: ['Can be bought — not with money, with the promise that it happens outside.'],
  },
});

// ---------------------------------------------------------------------------
// Wired enforcer — somebody paid for the reflexes
// ---------------------------------------------------------------------------

const ENFORCER_KIT = [
  gearSlot('primary-weapon', ['Ninebar heavy pistol', 'Brakeline SMG']),
  gearSlot('melee', ['Filament knife', 'Jolt gloves']),
  gearSlot('armor', ['Wrapped fighting vest', 'Layered street jacket', 'Tailored ballistic suit']),
  gearSlot('utility', ['Burner commlink', 'Stim patch', 'Trauma patch', 'Low-light goggles'], [1, 2]),
];

export const WIRED_ENFORCER: StarterArchetype = archetype({
  id: 'wired-enforcer',
  name: 'Wired enforcer',
  summary: 'The single body that turns a mugging into a real fight — fast enough to act twice before the party acts once.',
  roleTags: ['muscle', 'street', 'augmented'],
  statblock: kit({
    weapons: ['Ninebar heavy pistol', 'Brakeline SMG', 'Filament knife', 'Jolt gloves'],
    armor: ['Wrapped fighting vest', 'Layered street jacket', 'Tailored ballistic suit'],
    gear: ['Burner commlink', 'Stim patch', 'Trauma patch', 'Low-light goggles'],
  }),
  tiers: [
    {
      id: 'street', label: 'Cheap wiring',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [4, 5], wil: [3, 4], log: [2, 3], int: [3, 4], cha: [2, 3] },
      skills: { pistols: [3, 4], blades: [2, 4], 'unarmed-combat': [2, 3], perception: [2, 3], sneaking: [2, 3], intimidation: [2, 3] },
      pr: [2, 3], metatypes: SPRAWL, loadout: ENFORCER_KIT,
      augments: ['Second-hand reflex trigger'],
    },
    {
      id: 'blooded', label: 'Paid up',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [4, 5], log: [3, 4], int: [4, 5], cha: [3, 4] },
      skills: { pistols: [4, 5], automatics: [4, 5], blades: [4, 5], perception: [3, 4], sneaking: [3, 4], intimidation: [3, 4], gymnastics: [2, 3] },
      pr: [3, 4], metatypes: SPRAWL, loadout: ENFORCER_KIT,
      augments: ['Reflex trigger, tuned', 'Dermal weave'],
    },
    {
      id: 'pro', label: 'Company work',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [5, 7], wil: [5, 6], log: [4, 5], int: [5, 6], cha: [4, 5] },
      skills: { pistols: [5, 6], automatics: [5, 6], blades: [5, 6], perception: [4, 5], sneaking: [4, 5], intimidation: [4, 5], gymnastics: [3, 4] },
      pr: [4, 5], metatypes: SPRAWL, loadout: ENFORCER_KIT,
      augments: ['Reflex trigger, tuned', 'Dermal weave', 'Gun-sight link'],
    },
    {
      id: 'elite', label: 'Prime enforcer',
      attrs: { bod: [7, 8], agi: [7, 8], rea: [7, 8], str: [6, 7], wil: [6, 7], log: [5, 6], int: [6, 7], cha: [5, 6] },
      skills: { pistols: [6, 7], automatics: [6, 7], blades: [6, 7], perception: [6, 7], sneaking: [5, 6], intimidation: [5, 6], gymnastics: [5, 6] },
      pr: [5, 6], metatypes: SPRAWL, loadout: ENFORCER_KIT,
      augments: ['Reflex trigger, tuned', 'Weave-laced bones', 'Gun-sight link', 'Muscle graft'],
    },
  ],
  persona: {
    traits: ['does the job in the fewest possible words', 'has never once run'],
    voice: 'Clipped. Speaks in instructions, not threats — the threat is standing there.',
    goals: ['Finish the contract and be paid the same night'],
    hooks: ['Whoever holds the contract can be outbid; the enforcer will say so out loud.'],
  },
});

// ---------------------------------------------------------------------------
// Bar staff — the civilian in the room
// ---------------------------------------------------------------------------

const BAR_KIT = [
  gearSlot('primary-weapon', ['Under-bar bat']),
  gearSlot('armor', ['Service apron', 'Padded club coat']),
  gearSlot('utility', ['Burner commlink', 'Bar float', 'Body cam', 'Trauma patch'], [1, 2]),
];

export const BAR_STAFF: StarterArchetype = archetype({
  id: 'bar-staff',
  name: 'Bar staff (bystander)',
  summary: 'The civilian in the room — what the fight costs when it goes loud, and who saw the party’s faces.',
  roleTags: ['civilian', 'street', 'bystander'],
  statblock: kit({
    weapons: ['Under-bar bat', 'Kestrel holdout'],
    armor: ['Service apron', 'Padded club coat'],
    gear: ['Burner commlink', 'Bar float', 'Body cam', 'Trauma patch'],
  }),
  tiers: [
    {
      id: 'street', label: 'Barback',
      attrs: { bod: [2, 3], agi: [2, 3], rea: [2, 3], str: [2, 4], wil: [2, 3], log: [2, 3], int: [2, 3], cha: [2, 4] },
      skills: { perception: [1, 2], etiquette: [1, 2], clubs: [0, 1], 'first-aid': [0, 1], con: [1, 2] },
      pr: [0, 1], metatypes: { human: 4, elf: 2, ork: 2, dwarf: 1 }, loadout: BAR_KIT,
    },
    {
      id: 'blooded', label: 'Bartender',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [3, 4], wil: [3, 4], log: [3, 4], int: [3, 4], cha: [4, 5] },
      skills: { perception: [3, 4], etiquette: [3, 4], clubs: [1, 2], 'first-aid': [1, 2], con: [2, 3], negotiation: [2, 3] },
      pr: [1, 2], metatypes: { human: 4, elf: 2, ork: 2, dwarf: 1 }, loadout: BAR_KIT,
    },
    {
      id: 'pro', label: 'Night manager',
      attrs: { bod: [4, 5], agi: [3, 5], rea: [3, 5], str: [3, 5], wil: [4, 5], log: [4, 5], int: [4, 5], cha: [5, 6] },
      skills: { perception: [4, 5], etiquette: [4, 5], clubs: [2, 3], 'first-aid': [2, 3], con: [3, 4], negotiation: [4, 5], leadership: [2, 3] },
      pr: [2, 3], metatypes: { human: 4, elf: 2, ork: 2, dwarf: 1 }, loadout: BAR_KIT,
    },
    {
      id: 'elite', label: 'Owner behind the bar',
      attrs: { bod: [5, 6], agi: [4, 5], rea: [4, 5], str: [4, 6], wil: [5, 6], log: [5, 6], int: [5, 6], cha: [6, 7] },
      skills: { perception: [5, 6], etiquette: [5, 6], clubs: [4, 5], 'first-aid': [3, 4], con: [5, 6], negotiation: [5, 6], leadership: [4, 5], pistols: [2, 3] },
      pr: [3, 4], metatypes: { human: 4, elf: 2, ork: 2, dwarf: 1 }, loadout: BAR_KIT,
    },
  ],
  persona: {
    traits: ['knows every regular by drink and none by name', 'ducks first, asks after'],
    voice: 'Warm to customers, flat to everyone else, and always half-listening to the room.',
    goals: ['Get through the night without the windows going in'],
    hooks: ['Will describe the party to the next person who asks, for free, without malice.'],
  },
});
