/**
 * Awakened cluster — the caster who ends an exchange in one action and the
 * adept who crosses the room to do it by hand.
 *
 * Every spell and power name here is ORIGINAL (§14) and every drain code is our
 * own choice. Note the engine's limits: generated NPCs carry the tier's spell
 * *names* (pool = MAG + Spellcasting) and the adept's powers stay on the
 * archetype statblock as GM reference — the adept's edge is dialled into the
 * attribute and skill curves instead of into modifiers.
 * INTEGRATION: when GenTier grows modifier-bearing power records, move them here.
 */
import { gearSlot, kit } from './gear.js';
import { archetype, type StarterArchetype } from './types.js';

const AWAKENED = { human: 4, elf: 3, ork: 1, dwarf: 1, troll: 1 };

const SPELLS = [
  { name: 'Pressure lance', category: 'combat', drain: 'F-3', note: 'A hammer of compressed air. Loud, direct, physical.' },
  { name: 'Nerve stall', category: 'combat', drain: 'F-3', note: 'Drops a body without marking it. The favourite of anyone who still wants to talk.' },
  { name: 'Sight-thief', category: 'illusion', drain: 'F-1', note: 'Takes the caster out of one viewer’s attention entirely.' },
  { name: 'Braced air', category: 'manipulation', drain: 'F-1', note: 'A pane of hardened air across a doorway.' },
  { name: 'Hold fast', category: 'manipulation', drain: 'F-2', note: 'Pins a limb, a door, or a dropped weapon.' },
  { name: 'Knitting hand', category: 'health', drain: 'F-4', note: 'Closes a wound badly and fast.' },
];

const POWERS = [
  { name: 'Quickened step', rating: 2, cost: 1, mods: [], note: 'Reference only — the speed is dialled into the tier’s REA and Gymnastics curves.' },
  { name: 'Hardened strike', rating: 1, cost: 0.5, mods: [], note: 'Reference only — the damage is on the Strike wraps record.' },
  { name: 'Read the room', rating: 3, cost: 0.75, mods: [], note: 'Reference only — folded into the tier’s Perception curve.' },
];

// ---------------------------------------------------------------------------
// Combat mage
// ---------------------------------------------------------------------------

const MAGE_KIT = [
  gearSlot('primary-weapon', ['Meridian light pistol', 'Kestrel holdout']),
  gearSlot('armor', ['Warded duster', 'Sprawl weave hoodie']),
  gearSlot('focus', ['Channeling focus', 'Reagent pouch'], [1, 2]),
  gearSlot('utility', ['Burner commlink', 'Trauma patch']),
];

export const COMBAT_MAGE: StarterArchetype = archetype({
  id: 'combat-mage',
  name: 'Combat mage',
  summary: 'Ends an exchange in one action from behind cover — the reason the party finally learns what counterspelling is for.',
  roleTags: ['mage', 'muscle'],
  statblock: {
    ...kit({
      weapons: ['Meridian light pistol', 'Kestrel holdout'],
      armor: ['Warded duster', 'Sprawl weave hoodie'],
      gear: ['Channeling focus', 'Reagent pouch', 'Burner commlink', 'Trauma patch'],
      spells: SPELLS,
    }),
  },
  tiers: [
    {
      id: 'street', label: 'Talented',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [2, 4], wil: [4, 5], log: [3, 5], int: [3, 5], cha: [3, 4], mag: [3, 4] },
      skills: { spellcasting: [3, 4], counterspelling: [1, 2], assensing: [2, 3], perception: [2, 3], pistols: [1, 2], 'astral-combat': [1, 2] },
      pr: [1, 2], metatypes: AWAKENED, loadout: MAGE_KIT,
      spells: ['Pressure lance', 'Sight-thief'],
    },
    {
      id: 'blooded', label: 'Working caster',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [3, 5], wil: [5, 6], log: [4, 6], int: [4, 6], cha: [4, 5], mag: [4, 5] },
      skills: { spellcasting: [4, 5], counterspelling: [3, 4], summoning: [2, 4], assensing: [3, 4], perception: [3, 4], pistols: [2, 3], 'astral-combat': [2, 3] },
      pr: [2, 3], metatypes: AWAKENED, loadout: MAGE_KIT,
      spells: ['Pressure lance', 'Nerve stall', 'Sight-thief', 'Braced air'],
    },
    {
      id: 'pro', label: 'Combat mage',
      attrs: { bod: [4, 6], agi: [5, 6], rea: [5, 6], str: [4, 5], wil: [6, 7], log: [5, 7], int: [5, 7], cha: [5, 6], mag: [5, 6] },
      skills: { spellcasting: [5, 6], counterspelling: [4, 5], summoning: [4, 5], assensing: [4, 5], perception: [4, 5], pistols: [3, 4], 'astral-combat': [3, 5] },
      pr: [3, 4], metatypes: AWAKENED, loadout: MAGE_KIT,
      spells: ['Pressure lance', 'Nerve stall', 'Sight-thief', 'Braced air', 'Hold fast', 'Knitting hand'],
    },
    {
      id: 'elite', label: 'Prime caster',
      attrs: { bod: [5, 6], agi: [6, 7], rea: [6, 7], str: [4, 6], wil: [7, 8], log: [6, 8], int: [6, 8], cha: [6, 7], mag: [6, 7] },
      skills: { spellcasting: [6, 7], counterspelling: [6, 7], summoning: [5, 6], assensing: [5, 6], perception: [5, 6], pistols: [4, 5], 'astral-combat': [5, 6] },
      pr: [4, 5], metatypes: AWAKENED, loadout: MAGE_KIT,
      spells: ['Pressure lance', 'Nerve stall', 'Sight-thief', 'Braced air', 'Hold fast', 'Knitting hand'],
    },
  ],
  persona: {
    traits: ['spends the first pass looking, not casting', 'treats drain like a budget'],
    voice: 'Precise and a little tired. Explains what is about to happen, once.',
    goals: ['End the fight before it costs anything worth spending'],
    hooks: ['Cares more about the focus around their neck than about the employer.'],
  },
});

// ---------------------------------------------------------------------------
// Combat adept
// ---------------------------------------------------------------------------

const ADEPT_KIT = [
  gearSlot('primary-weapon', ['Strike wraps']),
  gearSlot('sidearm', ['Filament knife', 'Meridian light pistol']),
  gearSlot('armor', ['Wrapped fighting vest', 'Sprawl weave hoodie']),
  gearSlot('utility', ['Burner commlink', 'Stim patch', 'Low-light goggles'], [1, 2]),
];

export const COMBAT_ADEPT: StarterArchetype = archetype({
  id: 'combat-adept',
  name: 'Combat adept',
  summary: 'Crosses the room in one action and hits like a truck — nothing to counterspell, nothing to shoot down first.',
  roleTags: ['adept', 'muscle'],
  statblock: {
    ...kit({
      weapons: ['Strike wraps', 'Filament knife', 'Meridian light pistol'],
      armor: ['Wrapped fighting vest', 'Sprawl weave hoodie'],
      gear: ['Burner commlink', 'Stim patch', 'Low-light goggles'],
      powers: POWERS,
    }),
  },
  tiers: [
    {
      id: 'street', label: 'Awakened brawler',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [4, 5], str: [4, 5], wil: [4, 5], log: [2, 4], int: [4, 5], cha: [2, 4], mag: [3, 4] },
      skills: { 'unarmed-combat': [3, 4], blades: [2, 3], gymnastics: [3, 4], perception: [3, 4], sneaking: [2, 3], intimidation: [1, 3] },
      pr: [2, 3], metatypes: AWAKENED, loadout: ADEPT_KIT,
    },
    {
      id: 'blooded', label: 'Blooded adept',
      attrs: { bod: [5, 6], agi: [5, 6], rea: [5, 6], str: [5, 6], wil: [5, 6], log: [3, 4], int: [5, 6], cha: [3, 4], mag: [4, 5] },
      skills: { 'unarmed-combat': [5, 6], blades: [4, 5], gymnastics: [4, 5], perception: [4, 5], sneaking: [3, 4], pistols: [2, 3] },
      pr: [3, 4], metatypes: AWAKENED, loadout: ADEPT_KIT,
    },
    {
      id: 'pro', label: 'Path adept',
      attrs: { bod: [6, 7], agi: [6, 7], rea: [6, 7], str: [6, 7], wil: [6, 7], log: [4, 5], int: [6, 7], cha: [4, 5], mag: [5, 6] },
      skills: { 'unarmed-combat': [6, 7], blades: [5, 6], gymnastics: [5, 6], perception: [5, 6], sneaking: [4, 5], pistols: [3, 4] },
      pr: [4, 5], metatypes: AWAKENED, loadout: ADEPT_KIT,
    },
    {
      id: 'elite', label: 'Prime adept',
      attrs: { bod: [7, 8], agi: [7, 8], rea: [7, 8], str: [7, 8], wil: [7, 8], log: [5, 6], int: [6, 7], cha: [5, 6], mag: [6, 7] },
      skills: { 'unarmed-combat': [7, 8], blades: [6, 7], gymnastics: [6, 7], perception: [6, 7], sneaking: [5, 6], pistols: [4, 5] },
      pr: [5, 6], metatypes: AWAKENED, loadout: ADEPT_KIT,
    },
  ],
  persona: {
    traits: ['picks one person in the room and does not look at anyone else', 'never draws the pistol'],
    voice: 'Calm, quiet, and completely unbothered by being outnumbered.',
    goals: ['Finish it inside three passes'],
    hooks: ['Fights for the discipline, not the money — an insult buys more than a bribe does.'],
  },
});
