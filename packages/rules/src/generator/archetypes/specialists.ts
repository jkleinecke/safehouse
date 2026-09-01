/**
 * Specialists cluster — the named problems: the shot from the roof, the clinic
 * that patches the opposition back up, and the broker who sold the run.
 * Original content (§14).
 */
import { gearSlot, kit } from './gear.js';
import { archetype, type StarterArchetype } from './types.js';

const MIXED = { human: 4, elf: 2, ork: 2, dwarf: 1 };

// ---------------------------------------------------------------------------
// Contract shooter — the encounter that starts before anyone sees a body
// ---------------------------------------------------------------------------

const SHOOTER_KIT = [
  gearSlot('primary-weapon', ['Longwatch marksman rifle']),
  gearSlot('sidearm', ['Meridian light pistol', 'Ninebar heavy pistol', 'Filament knife']),
  gearSlot('armor', ['Sprawl weave hoodie', 'Wrapped fighting vest']),
  gearSlot('utility', ['Spotting scope', 'Ghillie wrap', 'Burner commlink', 'Low-light goggles'], [2, 3]),
];

export const CONTRACT_SHOOTER: StarterArchetype = archetype({
  id: 'contract-shooter',
  name: 'Contract shooter',
  summary: 'One shot from a roofline four hundred metres out — the encounter that has already started when the party notices.',
  roleTags: ['sniper', 'muscle', 'street'],
  statblock: kit({
    weapons: ['Longwatch marksman rifle', 'Meridian light pistol', 'Ninebar heavy pistol', 'Filament knife'],
    armor: ['Sprawl weave hoodie', 'Wrapped fighting vest'],
    gear: ['Spotting scope', 'Ghillie wrap', 'Burner commlink', 'Low-light goggles'],
  }),
  tiers: [
    {
      id: 'street', label: 'Amateur hour',
      attrs: { bod: [3, 4], agi: [4, 5], rea: [3, 4], str: [3, 4], wil: [3, 4], log: [3, 4], int: [3, 5], cha: [2, 3] },
      skills: { longarms: [3, 4], pistols: [2, 3], sneaking: [2, 4], perception: [3, 4], navigation: [1, 3], survival: [1, 2] },
      pr: [1, 2], metatypes: MIXED, loadout: SHOOTER_KIT,
    },
    {
      id: 'blooded', label: 'Paid work',
      attrs: { bod: [4, 5], agi: [5, 6], rea: [4, 5], str: [4, 5], wil: [4, 5], log: [4, 5], int: [4, 6], cha: [2, 4] },
      skills: { longarms: [5, 6], pistols: [3, 4], sneaking: [4, 5], perception: [4, 5], navigation: [3, 4], survival: [2, 4], gymnastics: [2, 3] },
      pr: [2, 3], metatypes: MIXED, loadout: SHOOTER_KIT,
    },
    {
      id: 'pro', label: 'Career shooter',
      attrs: { bod: [5, 6], agi: [6, 7], rea: [5, 6], str: [4, 6], wil: [5, 6], log: [5, 6], int: [6, 7], cha: [3, 5] },
      skills: { longarms: [6, 7], pistols: [4, 5], sneaking: [5, 6], perception: [5, 6], navigation: [4, 5], survival: [3, 5], gymnastics: [3, 4] },
      pr: [3, 4], metatypes: MIXED, loadout: SHOOTER_KIT,
      augments: ['Gun-sight link', 'Magnifying optics'],
    },
    {
      id: 'elite', label: 'Named price',
      attrs: { bod: [6, 7], agi: [7, 8], rea: [6, 7], str: [5, 6], wil: [6, 7], log: [6, 7], int: [7, 8], cha: [4, 5] },
      skills: { longarms: [7, 8], pistols: [5, 6], sneaking: [6, 7], perception: [6, 7], navigation: [5, 6], survival: [4, 6], gymnastics: [4, 5] },
      pr: [5, 6], metatypes: MIXED, loadout: SHOOTER_KIT,
      augments: ['Gun-sight link', 'Magnifying optics', 'Reflex trigger, tuned'],
    },
  ],
  persona: {
    traits: ['arrives a day early and leaves the same minute', 'has never met the client'],
    voice: 'Barely speaks. When they do it is a number or a time.',
    goals: ['Take the shot from a position with two ways off it'],
    hooks: ['Will abandon a contract the instant the position is compromised — and will not warn the employer.'],
  },
});

// ---------------------------------------------------------------------------
// Street doc — the reason the opposition gets back up
// ---------------------------------------------------------------------------

const DOC_KIT = [
  gearSlot('primary-weapon', ['Stunwire taser', 'Meridian light pistol']),
  gearSlot('armor', ['Lined clinic smock', 'Sprawl weave hoodie']),
  gearSlot('kit', ['Field medkit', 'Field surgery roll', 'Trauma patch', 'Stim patch'], [2, 3]),
  gearSlot('utility', ['Burner commlink', 'Counterfeit ID chip']),
];

export const STREET_DOC: StarterArchetype = archetype({
  id: 'street-doc',
  name: 'Street doc',
  summary: 'The reason the opposition gets back up — and the neutral party nobody in the district wants to shoot.',
  roleTags: ['medic', 'face', 'street'],
  statblock: kit({
    weapons: ['Stunwire taser', 'Meridian light pistol'],
    armor: ['Lined clinic smock', 'Sprawl weave hoodie'],
    gear: ['Field medkit', 'Field surgery roll', 'Trauma patch', 'Stim patch', 'Burner commlink', 'Counterfeit ID chip'],
  }),
  tiers: [
    {
      id: 'street', label: 'Back-room hands',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [2, 4], wil: [3, 4], log: [4, 5], int: [3, 5], cha: [3, 4] },
      skills: { 'first-aid': [3, 4], medicine: [2, 4], perception: [2, 4], negotiation: [2, 3], pistols: [1, 2], biotechnology: [1, 3] },
      pr: [1, 2], metatypes: MIXED, loadout: DOC_KIT,
    },
    {
      id: 'blooded', label: 'Clinic doc',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [3, 5], wil: [4, 5], log: [5, 6], int: [4, 6], cha: [4, 5] },
      skills: { 'first-aid': [5, 6], medicine: [4, 5], perception: [3, 5], negotiation: [3, 4], pistols: [2, 3], biotechnology: [3, 4], cybertechnology: [2, 4] },
      pr: [2, 3], metatypes: MIXED, loadout: DOC_KIT,
    },
    {
      id: 'pro', label: 'Ward doc',
      attrs: { bod: [4, 6], agi: [5, 6], rea: [5, 6], str: [4, 5], wil: [5, 6], log: [6, 7], int: [5, 7], cha: [5, 6] },
      skills: { 'first-aid': [6, 7], medicine: [5, 6], perception: [4, 6], negotiation: [4, 5], pistols: [3, 4], biotechnology: [4, 5], cybertechnology: [4, 5] },
      pr: [3, 4], metatypes: MIXED, loadout: DOC_KIT,
    },
    {
      id: 'elite', label: 'Surgeon of record',
      attrs: { bod: [5, 6], agi: [6, 7], rea: [6, 7], str: [4, 6], wil: [6, 7], log: [7, 8], int: [6, 8], cha: [6, 7] },
      skills: { 'first-aid': [7, 8], medicine: [6, 7], perception: [5, 7], negotiation: [5, 6], pistols: [4, 5], biotechnology: [5, 6], cybertechnology: [5, 6] },
      pr: [4, 5], metatypes: MIXED, loadout: DOC_KIT,
    },
  ],
  persona: {
    traits: ['treats whoever is bleeding hardest, no questions either way', 'keeps a ledger of favours, not money'],
    voice: 'Brisk, unsentimental, and interrupts anyone who starts explaining.',
    goals: ['Keep the clinic neutral ground for one more month'],
    hooks: ['Every side in the district owes them; nobody wants to be the one who broke that.'],
  },
});

// ---------------------------------------------------------------------------
// Broker — the scene that is all talking, until it isn't
// ---------------------------------------------------------------------------

const BROKER_KIT = [
  gearSlot('primary-weapon', ['Kestrel holdout', 'Meridian light pistol']),
  gearSlot('armor', ['Broker lined coat', 'Padded club coat']),
  gearSlot('utility', ['Broker commlink', 'Counterfeit ID chip', 'Signal jammer', 'Case notes slate'], [2, 3]),
];

export const BROKER: StarterArchetype = archetype({
  id: 'broker-face',
  name: 'Broker (fixer / face)',
  summary: 'Where the run comes from and who sells the party out — the scene that is all talking, until it isn’t.',
  roleTags: ['face', 'fixer', 'street'],
  statblock: kit({
    weapons: ['Kestrel holdout', 'Meridian light pistol'],
    armor: ['Broker lined coat', 'Padded club coat'],
    gear: ['Broker commlink', 'Counterfeit ID chip', 'Signal jammer', 'Case notes slate'],
  }),
  tiers: [
    {
      id: 'street', label: 'Corner broker',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [2, 4], wil: [3, 4], log: [3, 5], int: [3, 5], cha: [4, 5] },
      skills: { negotiation: [3, 4], con: [3, 4], etiquette: [2, 4], perception: [2, 4], intimidation: [2, 3], pistols: [1, 2], computer: [1, 3] },
      pr: [1, 2], metatypes: { human: 3, elf: 4, ork: 2, dwarf: 1 }, loadout: BROKER_KIT,
    },
    {
      id: 'blooded', label: 'Working fixer',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [3, 5], wil: [4, 5], log: [4, 6], int: [4, 6], cha: [5, 6] },
      skills: { negotiation: [5, 6], con: [4, 5], etiquette: [4, 5], perception: [3, 5], intimidation: [3, 4], pistols: [2, 3], computer: [3, 4], leadership: [2, 4] },
      pr: [2, 3], metatypes: { human: 3, elf: 4, ork: 2, dwarf: 1 }, loadout: BROKER_KIT,
    },
    {
      id: 'pro', label: 'Established fixer',
      attrs: { bod: [4, 6], agi: [5, 6], rea: [5, 6], str: [4, 5], wil: [5, 6], log: [5, 7], int: [5, 7], cha: [6, 7] },
      skills: { negotiation: [6, 7], con: [5, 6], etiquette: [5, 6], perception: [4, 6], intimidation: [4, 5], pistols: [3, 4], computer: [4, 5], leadership: [4, 5] },
      pr: [3, 4], metatypes: { human: 3, elf: 4, ork: 2, dwarf: 1 }, loadout: BROKER_KIT,
    },
    {
      id: 'elite', label: 'Kingmaker',
      attrs: { bod: [5, 6], agi: [6, 7], rea: [6, 7], str: [4, 6], wil: [6, 7], log: [6, 8], int: [6, 8], cha: [7, 8] },
      skills: { negotiation: [7, 8], con: [6, 7], etiquette: [6, 7], perception: [5, 7], intimidation: [5, 6], pistols: [4, 5], computer: [5, 6], leadership: [5, 7] },
      pr: [4, 5], metatypes: { human: 3, elf: 4, ork: 2, dwarf: 1 }, loadout: BROKER_KIT,
    },
  ],
  persona: {
    traits: ['never meets twice in the same room', 'knows the price of everyone at the table'],
    voice: 'Genial, generous with drinks, and steering the conversation the entire time.',
    goals: ['Get paid by both ends of the same job'],
    hooks: ['Sells the party out only when the alternative is being sold out first — and will say so afterwards.'],
  },
});
