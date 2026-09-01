/**
 * Uniforms cluster — the people whose job is to be there when the party is.
 * Original content (§14): names, kit and tier labels are all ours.
 */
import { gearSlot, kit } from './gear.js';
import { archetype, type StarterArchetype } from './types.js';

const CORP = { human: 5, elf: 2, ork: 2, dwarf: 1 };
const CORP_HEAVY = { human: 4, ork: 3, dwarf: 2, elf: 1, troll: 1 };

// ---------------------------------------------------------------------------
// Corporate security guard — the one who notices you and tells someone else
// ---------------------------------------------------------------------------

const GUARD_LOW = [
  gearSlot('primary-weapon', ['Vantage service pistol', 'Telescoping baton']),
  gearSlot('armor', ['Security duty vest']),
  gearSlot('utility', ['Duty commlink', 'Body cam', 'Scanner wand'], [1, 2]),
];
const GUARD_HIGH = [
  gearSlot('primary-weapon', ['Halloway carbine', 'Brakeline SMG', 'Tannery riot gun']),
  gearSlot('sidearm', ['Vantage service pistol', 'Riot shock stick']),
  gearSlot('armor', ['Patrol carrier rig', 'Response hardshell']),
  gearSlot('utility', ['Duty commlink', 'Body cam', 'Low-light goggles', 'Restraint ties'], [1, 2]),
];

export const CORP_GUARD: StarterArchetype = archetype({
  id: 'corp-guard',
  name: 'Corporate security guard',
  summary: 'Badge, camera and a radio — the one whose actual job is to notice the party and tell someone worse.',
  roleTags: ['security', 'guard', 'muscle'],
  statblock: kit({
    weapons: ['Vantage service pistol', 'Telescoping baton', 'Riot shock stick', 'Brakeline SMG', 'Halloway carbine', 'Tannery riot gun'],
    armor: ['Security duty vest', 'Patrol carrier rig', 'Response hardshell'],
    gear: ['Duty commlink', 'Body cam', 'Scanner wand', 'Low-light goggles', 'Restraint ties'],
  }),
  tiers: [
    {
      id: 'street', label: 'Lobby watch',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [3, 4], wil: [3, 4], log: [2, 4], int: [3, 4], cha: [2, 4] },
      skills: { pistols: [2, 3], clubs: [1, 3], perception: [2, 4], etiquette: [1, 3], intimidation: [1, 3], computer: [1, 2] },
      pr: [1, 2], metatypes: CORP, loadout: GUARD_LOW,
    },
    {
      id: 'blooded', label: 'Post standing',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [4, 5], wil: [4, 5], log: [3, 4], int: [4, 5], cha: [3, 4] },
      skills: { pistols: [3, 4], automatics: [3, 4], clubs: [3, 4], perception: [3, 5], etiquette: [2, 3], intimidation: [3, 4], computer: [2, 3] },
      pr: [2, 3], metatypes: CORP, loadout: GUARD_HIGH,
    },
    {
      id: 'pro', label: 'Shift lead',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [4, 6], log: [4, 5], int: [5, 6], cha: [4, 5] },
      skills: { pistols: [4, 5], automatics: [4, 6], clubs: [3, 5], perception: [4, 6], etiquette: [3, 4], intimidation: [4, 5], leadership: [3, 4], computer: [3, 4] },
      pr: [3, 4], metatypes: CORP_HEAVY, loadout: GUARD_HIGH,
    },
    {
      id: 'elite', label: 'Site response team',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [6, 7], wil: [5, 7], log: [4, 6], int: [6, 7], cha: [4, 5] },
      skills: { pistols: [5, 6], automatics: [6, 7], clubs: [4, 6], perception: [5, 7], etiquette: [3, 4], intimidation: [5, 6], leadership: [4, 5], gymnastics: [4, 5] },
      pr: [4, 5], metatypes: CORP_HEAVY, loadout: GUARD_HIGH,
    },
  ],
  persona: {
    traits: ['follows the post order to the letter', 'will not leave the desk unmanned for anything'],
    voice: 'Bored courtesy over a script, one notch away from a raised radio.',
    goals: ['Log the incident and be somewhere else when it escalates'],
    hooks: ['Underpaid and knows it — a plausible reason to look the other way is cheaper than a fight.'],
  },
});

// ---------------------------------------------------------------------------
// Close-protection operator — the suit standing half a step behind
// ---------------------------------------------------------------------------

const CP_KIT = [
  gearSlot('primary-weapon', ['Halloway carbine', 'Brakeline SMG', 'Ninebar heavy pistol']),
  gearSlot('sidearm', ['Vantage service pistol', 'Filament knife']),
  gearSlot('armor', ['Tailored ballistic suit', 'Response hardshell']),
  gearSlot('utility', ['Duty commlink', 'Low-light goggles', 'Trauma patch', 'Flash canister'], [1, 2]),
];

export const CLOSE_PROTECTION: StarterArchetype = archetype({
  id: 'corp-close-protection',
  name: 'Close-protection operator',
  summary: 'The suit half a step behind the executive — armored, fast, and paid to end the exchange in one action.',
  roleTags: ['security', 'bodyguard', 'muscle'],
  statblock: kit({
    weapons: ['Halloway carbine', 'Brakeline SMG', 'Ninebar heavy pistol', 'Vantage service pistol', 'Filament knife', 'Flash canister'],
    armor: ['Tailored ballistic suit', 'Response hardshell'],
    gear: ['Duty commlink', 'Low-light goggles', 'Trauma patch'],
  }),
  tiers: [
    {
      id: 'street', label: 'Detail junior',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [4, 5], wil: [4, 5], log: [3, 4], int: [4, 5], cha: [3, 4] },
      skills: { pistols: [3, 4], automatics: [3, 4], 'unarmed-combat': [3, 4], perception: [3, 4], gymnastics: [2, 3], etiquette: [2, 3] },
      pr: [2, 3], metatypes: CORP, loadout: CP_KIT,
    },
    {
      id: 'blooded', label: 'On the detail',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [5, 6], log: [4, 5], int: [5, 6], cha: [3, 5] },
      skills: { pistols: [4, 5], automatics: [4, 5], 'unarmed-combat': [4, 5], perception: [4, 5], gymnastics: [3, 4], etiquette: [3, 4], 'first-aid': [2, 3] },
      pr: [3, 4], metatypes: CORP, loadout: CP_KIT,
    },
    {
      id: 'pro', label: 'Detail lead',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [5, 7], wil: [5, 6], log: [4, 6], int: [6, 7], cha: [4, 5] },
      skills: { pistols: [5, 6], automatics: [5, 6], 'unarmed-combat': [5, 6], perception: [5, 6], gymnastics: [4, 5], etiquette: [3, 5], 'first-aid': [3, 4], leadership: [3, 5] },
      pr: [4, 5], metatypes: CORP_HEAVY, loadout: CP_KIT,
    },
    {
      id: 'elite', label: 'Principal’s shadow',
      attrs: { bod: [7, 8], agi: [6, 7], rea: [7, 8], str: [6, 7], wil: [6, 7], log: [5, 6], int: [6, 7], cha: [5, 6] },
      skills: { pistols: [6, 7], automatics: [6, 8], 'unarmed-combat': [6, 7], perception: [6, 7], gymnastics: [5, 6], etiquette: [4, 5], 'first-aid': [4, 5], leadership: [4, 6] },
      pr: [5, 6], metatypes: CORP_HEAVY, loadout: CP_KIT,
      augments: ['Reflex trigger, tuned', 'Gun-sight link', 'Dermal weave'],
    },
  ],
  persona: {
    traits: ['looks at hands, never at faces', 'moves the principal before drawing'],
    voice: 'Almost no words at all. One warning, delivered once, and then nothing.',
    goals: ['Get the principal into the car'],
    hooks: ['Contractually loyal, not personally — the principal knows it and so does the operator.'],
  },
});

// ---------------------------------------------------------------------------
// City patrol officer — the one with the whole grid on the radio behind them
// ---------------------------------------------------------------------------

const PATROL_KIT = [
  gearSlot('primary-weapon', ['Vantage service pistol', 'Tannery riot gun', 'Stunwire taser']),
  gearSlot('sidearm', ['Telescoping baton', 'Riot shock stick']),
  gearSlot('armor', ['Patrol carrier rig', 'Security duty vest']),
  gearSlot('utility', ['Duty commlink', 'Body cam', 'Restraint ties', 'Smoke canister'], [1, 3]),
];

export const PATROL_OFFICER: StarterArchetype = archetype({
  id: 'patrol-officer',
  name: 'City patrol officer',
  summary: 'Two out of a cruiser doing a walk-through — nonlethal first, and every other unit in the district behind them.',
  roleTags: ['security', 'patrol', 'street'],
  statblock: kit({
    weapons: ['Vantage service pistol', 'Tannery riot gun', 'Stunwire taser', 'Telescoping baton', 'Riot shock stick'],
    armor: ['Patrol carrier rig', 'Security duty vest'],
    gear: ['Duty commlink', 'Body cam', 'Restraint ties', 'Smoke canister'],
  }),
  tiers: [
    {
      id: 'street', label: 'Rookie',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 5], str: [3, 4], wil: [3, 4], log: [3, 4], int: [3, 4], cha: [3, 4] },
      skills: { pistols: [2, 4], clubs: [2, 3], longarms: [1, 3], perception: [2, 4], intimidation: [2, 3], etiquette: [2, 3], 'first-aid': [1, 3] },
      pr: [1, 2], metatypes: CORP, loadout: PATROL_KIT,
    },
    {
      id: 'blooded', label: 'On patrol',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 6], str: [4, 5], wil: [4, 5], log: [3, 5], int: [4, 5], cha: [3, 5] },
      skills: { pistols: [4, 5], clubs: [3, 4], longarms: [3, 4], perception: [3, 5], intimidation: [3, 4], etiquette: [3, 4], 'first-aid': [2, 3], 'pilot-ground-craft': [2, 3] },
      pr: [2, 3], metatypes: CORP, loadout: PATROL_KIT,
    },
    {
      id: 'pro', label: 'Senior patrol',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [5, 6], log: [4, 5], int: [5, 6], cha: [4, 6] },
      skills: { pistols: [5, 6], clubs: [4, 5], longarms: [4, 5], perception: [4, 6], intimidation: [4, 5], etiquette: [3, 5], 'first-aid': [3, 4], 'pilot-ground-craft': [3, 4], leadership: [3, 4] },
      pr: [3, 4], metatypes: CORP_HEAVY, loadout: PATROL_KIT,
    },
    {
      id: 'elite', label: 'Tactical response',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [6, 7], wil: [6, 7], log: [4, 6], int: [6, 7], cha: [4, 6] },
      skills: { pistols: [6, 7], clubs: [5, 6], longarms: [6, 7], perception: [5, 7], intimidation: [5, 6], etiquette: [3, 5], 'first-aid': [4, 5], gymnastics: [4, 5], leadership: [4, 5] },
      pr: [4, 5], metatypes: CORP_HEAVY, loadout: PATROL_KIT,
    },
  ],
  persona: {
    traits: ['narrates every action for the body cam', 'more afraid of the report than of the party'],
    voice: 'Procedural. Everything phrased as an instruction that has already been given once.',
    goals: ['Contain it until the second unit arrives'],
    hooks: ['Will de-escalate at almost any cost; the escalation comes from whoever answers the radio.'],
  },
});

// ---------------------------------------------------------------------------
// Legwork investigator — the fixer's own eyes
// ---------------------------------------------------------------------------

const PI_KIT = [
  gearSlot('primary-weapon', ['Meridian light pistol', 'Ninebar heavy pistol']),
  gearSlot('sidearm', ['Utility blade', 'Telescoping baton']),
  gearSlot('armor', ['Sprawl weave hoodie', 'Broker lined coat']),
  gearSlot('utility', ['Burner commlink', 'Case notes slate', 'Tracking tag', 'Counterfeit ID chip', 'Low-light goggles'], [2, 3]),
];

export const LEGWORK_INVESTIGATOR: StarterArchetype = archetype({
  id: 'legwork-investigator',
  name: 'Legwork investigator (fixer’s muscle)',
  summary: 'Follows people, asks the wrong neighbours, and turns up two scenes after the party forgot about them.',
  roleTags: ['muscle', 'investigator', 'street'],
  statblock: kit({
    weapons: ['Meridian light pistol', 'Ninebar heavy pistol', 'Utility blade', 'Telescoping baton'],
    armor: ['Sprawl weave hoodie', 'Broker lined coat'],
    gear: ['Burner commlink', 'Case notes slate', 'Tracking tag', 'Counterfeit ID chip', 'Low-light goggles'],
  }),
  tiers: [
    {
      id: 'street', label: 'Errand work',
      attrs: { bod: [3, 4], agi: [3, 5], rea: [3, 4], str: [3, 4], wil: [3, 4], log: [3, 4], int: [3, 5], cha: [3, 4] },
      skills: { pistols: [2, 3], sneaking: [2, 4], perception: [3, 4], con: [2, 3], etiquette: [2, 3], tracking: [1, 3], computer: [1, 3] },
      pr: [1, 2], metatypes: CORP, loadout: PI_KIT,
    },
    {
      id: 'blooded', label: 'On retainer',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [4, 5], wil: [4, 5], log: [4, 5], int: [4, 6], cha: [4, 5] },
      skills: { pistols: [3, 4], sneaking: [4, 5], perception: [4, 5], con: [3, 4], etiquette: [3, 4], tracking: [3, 4], computer: [3, 4], negotiation: [2, 3] },
      pr: [2, 3], metatypes: CORP, loadout: PI_KIT,
    },
    {
      id: 'pro', label: 'Trusted hand',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [4, 6], wil: [5, 6], log: [5, 6], int: [5, 7], cha: [5, 6] },
      skills: { pistols: [4, 5], sneaking: [5, 6], perception: [5, 6], con: [4, 5], etiquette: [4, 5], tracking: [4, 5], computer: [4, 5], negotiation: [3, 5] },
      pr: [3, 4], metatypes: CORP, loadout: PI_KIT,
    },
    {
      id: 'elite', label: 'The fixer’s own',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [5, 6], wil: [6, 7], log: [6, 7], int: [6, 8], cha: [6, 7] },
      skills: { pistols: [6, 7], sneaking: [6, 7], perception: [6, 7], con: [5, 6], etiquette: [5, 6], tracking: [5, 6], computer: [5, 6], negotiation: [4, 6] },
      pr: [4, 5], metatypes: CORP, loadout: PI_KIT,
    },
  ],
  persona: {
    traits: ['writes everything down twice', 'asks one question too many on purpose'],
    voice: 'Friendly, patient, and taking notes the whole time.',
    goals: ['File a report that keeps the retainer'],
    hooks: ['Sells the same legwork twice if both buyers are polite about it.'],
  },
});
