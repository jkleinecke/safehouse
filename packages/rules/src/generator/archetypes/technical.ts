/**
 * Technical cluster — the two NPCs who decide how hard the night is without
 * ever standing in the firing lane: the rigger flying the gun, and the decker
 * who owns the cameras and the maglocks. Original content (§14).
 *
 * NOTE on the engine: SheetV1 has no drone entity and generated NPCs do not
 * carry `matrix`, so the drone and the deck live here as gear records with the
 * drone's weapon rolled on Gunnery. That is honest data the GM can act on.
 * INTEGRATION: when drones/hosts become first-class, promote them from gear.
 */
import { gearSlot, kit } from './gear.js';
import { archetype, type StarterArchetype } from './types.js';

const TECH = { human: 4, elf: 2, dwarf: 2, ork: 1 };

// ---------------------------------------------------------------------------
// Drone rigger — shoot the drone or find the van
// ---------------------------------------------------------------------------

const RIGGER_KIT = [
  gearSlot('primary-weapon', ['Kite mount autogun']),
  gearSlot('sidearm', ['Meridian light pistol', 'Ninebar heavy pistol']),
  gearSlot('armor', ['Rigger flight jacket', 'Sprawl weave hoodie']),
  gearSlot('rig', ['Kite-2 rotor drone', 'Jump-in harness', 'Drone tool roll'], [2, 3]),
  gearSlot('utility', ['Duty commlink', 'Signal jammer'], [1, 2]),
];

export const DRONE_RIGGER: StarterArchetype = archetype({
  id: 'drone-rigger',
  name: 'Drone rigger',
  summary: 'Fights through a rotor drone from two rooms away — shoot the drone, or work out which van it came from.',
  roleTags: ['rigger', 'drone', 'technical'],
  statblock: kit({
    weapons: ['Kite mount autogun', 'Meridian light pistol', 'Ninebar heavy pistol'],
    armor: ['Rigger flight jacket', 'Sprawl weave hoodie'],
    gear: ['Kite-2 rotor drone', 'Jump-in harness', 'Drone tool roll', 'Duty commlink', 'Signal jammer'],
  }),
  tiers: [
    {
      id: 'street', label: 'Hobby flyer',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [4, 5], str: [3, 4], wil: [3, 4], log: [4, 5], int: [3, 5], cha: [2, 4] },
      skills: { gunnery: [2, 4], 'pilot-aircraft': [3, 4], perception: [2, 3], 'automotive-mechanic': [2, 3], pistols: [1, 3], computer: [2, 3] },
      pr: [1, 2], metatypes: TECH, loadout: RIGGER_KIT,
    },
    {
      id: 'blooded', label: 'Working rigger',
      attrs: { bod: [4, 5], agi: [4, 5], rea: [5, 6], str: [3, 5], wil: [4, 5], log: [5, 6], int: [4, 6], cha: [3, 4] },
      skills: { gunnery: [4, 5], 'pilot-aircraft': [4, 5], 'pilot-ground-craft': [3, 4], perception: [3, 4], 'automotive-mechanic': [3, 4], pistols: [2, 3], computer: [3, 4], 'electronic-warfare': [2, 3] },
      pr: [2, 3], metatypes: TECH, loadout: RIGGER_KIT,
    },
    {
      id: 'pro', label: 'Contract rigger',
      attrs: { bod: [4, 6], agi: [5, 6], rea: [6, 7], str: [4, 5], wil: [5, 6], log: [6, 7], int: [5, 7], cha: [4, 5] },
      skills: { gunnery: [5, 6], 'pilot-aircraft': [5, 6], 'pilot-ground-craft': [4, 5], perception: [4, 5], 'automotive-mechanic': [4, 5], pistols: [3, 4], computer: [4, 5], 'electronic-warfare': [4, 5] },
      pr: [3, 4], metatypes: TECH, loadout: RIGGER_KIT,
      augments: ['Second-gen jump harness'],
    },
    {
      id: 'elite', label: 'Jumped-in prime',
      attrs: { bod: [5, 6], agi: [6, 7], rea: [7, 8], str: [4, 6], wil: [6, 7], log: [7, 8], int: [6, 7], cha: [4, 6] },
      skills: { gunnery: [7, 8], 'pilot-aircraft': [6, 7], 'pilot-ground-craft': [5, 6], perception: [5, 6], 'automotive-mechanic': [5, 6], pistols: [4, 5], computer: [5, 6], 'electronic-warfare': [5, 6] },
      pr: [4, 6], metatypes: TECH, loadout: RIGGER_KIT,
      augments: ['Third-gen jump harness', 'Reflex trigger, tuned'],
    },
  ],
  persona: {
    traits: ['talks to the drone out loud', 'has not been in a fistfight since school'],
    voice: 'Distracted, running commentary, half of it addressed to hardware.',
    goals: ['Get the drone home in one piece; the contract is secondary'],
    hooks: ['Losing the drone hurts more than losing the fight — threaten the airframe, not the pilot.'],
  },
});

// ---------------------------------------------------------------------------
// Grid decker — the body in the chair that owns the building
// ---------------------------------------------------------------------------

const DECKER_KIT = [
  gearSlot('deck', ['Slate-4 cyberdeck', 'Signal echo tap']),
  gearSlot('primary-weapon', ['Meridian light pistol', 'Stunwire taser']),
  gearSlot('armor', ['Sprawl weave hoodie', 'Layered street jacket']),
  gearSlot('utility', ['Burner commlink', 'Signal jammer', 'Counterfeit ID chip', 'Low-light goggles'], [1, 3]),
];

export const GRID_DECKER: StarterArchetype = archetype({
  id: 'grid-decker',
  name: 'Grid decker',
  summary: 'Owns the cameras and the maglocks from a chair down the block — the NPC who decides how loud the rest of the night is.',
  roleTags: ['decker', 'technomancer', 'technical'],
  statblock: kit({
    weapons: ['Meridian light pistol', 'Stunwire taser'],
    armor: ['Sprawl weave hoodie', 'Layered street jacket'],
    gear: ['Slate-4 cyberdeck', 'Signal echo tap', 'Burner commlink', 'Signal jammer', 'Counterfeit ID chip', 'Low-light goggles'],
  }),
  tiers: [
    {
      id: 'street', label: 'Script kid',
      attrs: { bod: [3, 4], agi: [3, 4], rea: [3, 4], str: [2, 3], wil: [3, 4], log: [4, 5], int: [3, 5], cha: [2, 4], res: [2, 3] },
      skills: { hacking: [3, 4], computer: [3, 4], cybercombat: [1, 3], 'electronic-warfare': [1, 3], perception: [2, 3], pistols: [1, 2], compiling: [1, 2] },
      pr: [1, 2], metatypes: TECH, loadout: DECKER_KIT,
    },
    {
      id: 'blooded', label: 'Working decker',
      attrs: { bod: [3, 4], agi: [4, 5], rea: [4, 5], str: [3, 4], wil: [4, 5], log: [5, 6], int: [4, 6], cha: [3, 4], res: [3, 4] },
      skills: { hacking: [4, 5], computer: [4, 5], cybercombat: [3, 4], 'electronic-warfare': [3, 4], perception: [3, 4], pistols: [2, 3], compiling: [2, 3], software: [3, 4] },
      pr: [2, 3], metatypes: TECH, loadout: DECKER_KIT,
    },
    {
      id: 'pro', label: 'Contract decker',
      attrs: { bod: [4, 5], agi: [5, 6], rea: [5, 6], str: [3, 5], wil: [5, 6], log: [6, 7], int: [5, 7], cha: [4, 5], res: [4, 5] },
      skills: { hacking: [5, 6], computer: [5, 6], cybercombat: [4, 5], 'electronic-warfare': [4, 5], perception: [4, 5], pistols: [3, 4], compiling: [3, 5], software: [4, 5] },
      pr: [3, 4], metatypes: TECH, loadout: DECKER_KIT,
    },
    {
      id: 'elite', label: 'Prime runner decker',
      attrs: { bod: [4, 6], agi: [6, 7], rea: [6, 7], str: [4, 5], wil: [6, 7], log: [7, 8], int: [6, 8], cha: [5, 6], res: [5, 6] },
      skills: { hacking: [7, 8], computer: [6, 7], cybercombat: [6, 7], 'electronic-warfare': [5, 7], perception: [5, 6], pistols: [4, 5], compiling: [5, 6], software: [5, 6] },
      pr: [4, 6], metatypes: TECH, loadout: DECKER_KIT,
      augments: ['Skull jack', 'Nerve boosters'],
    },
  ],
  persona: {
    traits: ['answers questions two seconds late', 'has already read everyone’s public record'],
    voice: 'Flat, fast, and quoting things back at people that they did not say out loud.',
    goals: ['Own the building before anybody walks into it'],
    hooks: ['Sells access, not loyalty — the same doors open for whoever asks next.'],
  },
});
