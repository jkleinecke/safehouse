/**
 * The starter library's gear catalog — ORIGINAL RECORDS (§14/G6).
 *
 * Every name here is ours. The numbers are plausible cyberpunk hardware in the
 * shape SR5 mechanics expect (Accuracy, DV code, AP, fire modes, a range-table
 * key) so the engine can build weapon pools and soak from them, but none of it
 * is transcribed from a published book and **no record carries a `ref`** —
 * we do not cite pages we have not verified.
 *
 * Loadout slot options resolve against these records exactly the way the
 * server's `catalogOf` resolves a GM's own template statblock (FR10.1).
 */
import type { LoadoutSlot, RangeTables, SheetV1Input } from '@safehouse/contracts';
import { toRange, type Span } from './types.js';

type Weapon = NonNullable<SheetV1Input['weapons']>[number];
type Armor = NonNullable<SheetV1Input['armor']>[number];
type Gear = NonNullable<SheetV1Input['gear']>[number];
type Spell = NonNullable<SheetV1Input['spells']>[number];
type Power = NonNullable<SheetV1Input['powers']>[number];

/**
 * Band edges in metres — [short, medium, long, extreme] — for the categories
 * this library's weapons use. User-entered data in the same sense as the
 * demo campaign's tables: the GM can retune any row in the sheet editor.
 */
export const STARTER_RANGE_TABLES: RangeTables = {
  holdout: [4, 8, 12, 16],
  light_pistol: [5, 15, 30, 50],
  heavy_pistol: [5, 20, 40, 60],
  machine_pistol: [8, 16, 24, 40],
  smg: [10, 40, 80, 150],
  shotgun: [10, 20, 40, 70],
  carbine: [25, 150, 350, 550],
  marksman: [50, 350, 800, 1500],
  taser: [5, 10, 15, 20],
  thrown: [8, 16, 24, 40],
};

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export const STARTER_WEAPONS = {
  'Kestrel holdout': {
    name: 'Kestrel holdout', skillId: 'pistols', acc: 4, dv: '6P', ap: 0, modes: ['SA'],
    rangeCat: 'holdout', ammo: { cap: 6, current: 6 },
    note: 'Palm-sized, printed frame, no serial. Everyone who says they are unarmed has one.',
  },
  'Meridian light pistol': {
    name: 'Meridian light pistol', skillId: 'pistols', acc: 6, dv: '6P', ap: 0, modes: ['SA'],
    rangeCat: 'light_pistol', ammo: { cap: 16, current: 16 }, recoilComp: 1,
    note: 'Cheap, accurate, and sold three to a case out of the back of a van.',
  },
  'Vantage service pistol': {
    name: 'Vantage service pistol', skillId: 'pistols', acc: 5, dv: '7P', ap: -1, modes: ['SA'],
    rangeCat: 'heavy_pistol', ammo: { cap: 15, current: 15 }, recoilComp: 1,
    note: 'Issued by the thousand to badge-carriers. Reliable, traceable, and everywhere.',
  },
  'Ninebar heavy pistol': {
    name: 'Ninebar heavy pistol', skillId: 'pistols', acc: 5, dv: '8P', ap: -1, modes: ['SA'],
    rangeCat: 'heavy_pistol', ammo: { cap: 12, current: 12 },
    note: 'Heavy, loud, and unsubtle — the pistol you carry to end an argument.',
  },
  'Coilworks machine pistol': {
    name: 'Coilworks machine pistol', skillId: 'automatics', acc: 4, dv: '7P', ap: 0, modes: ['SA', 'BF'],
    rangeCat: 'machine_pistol', ammo: { cap: 32, current: 32 }, recoilComp: 1,
    note: 'Sprays, jams, and fits under a jacket. The gang tax of the sprawl.',
  },
  'Brakeline SMG': {
    name: 'Brakeline SMG', skillId: 'automatics', acc: 5, dv: '8P', ap: -1, modes: ['SA', 'BF', 'FA'],
    rangeCat: 'smg', ammo: { cap: 32, current: 32 }, recoilComp: 2,
    note: 'Folding stock, foregrip, and enough compensation to make full auto mean something.',
  },
  'Halloway carbine': {
    name: 'Halloway carbine', skillId: 'automatics', acc: 5, dv: '9P', ap: -2, modes: ['SA', 'BF', 'FA'],
    rangeCat: 'carbine', ammo: { cap: 30, current: 30 }, recoilComp: 2,
    note: 'What a corporate response team steps out of the lift holding.',
  },
  'Tannery riot gun': {
    name: 'Tannery riot gun', skillId: 'longarms', acc: 4, dv: '9S', ap: 0, modes: ['SS', 'SA'],
    rangeCat: 'shotgun', ammo: { cap: 6, current: 6 },
    note: 'Loaded with beanbag and gas. Policy says take them alive; policy changes.',
  },
  'Cutdown scattergun': {
    name: 'Cutdown scattergun', skillId: 'longarms', acc: 4, dv: '10P', ap: 0, modes: ['SS', 'SA'],
    rangeCat: 'shotgun', ammo: { cap: 5, current: 5 },
    note: 'A bird gun that lost half its barrel in somebody’s kitchen. Ruinous inside ten metres.',
  },
  'Longwatch marksman rifle': {
    name: 'Longwatch marksman rifle', skillId: 'longarms', acc: 7, dv: '12P', ap: -4, modes: ['SS', 'SA'],
    rangeCat: 'marksman', ammo: { cap: 6, current: 6 }, recoilComp: 2,
    note: 'Bolt gun on a bipod. The encounter begins before anyone knows there is one.',
  },
  'Kite mount autogun': {
    name: 'Kite mount autogun', skillId: 'gunnery', acc: 5, dv: '8P', ap: -1, modes: ['SA', 'BF', 'FA'],
    rangeCat: 'smg', ammo: { cap: 100, current: 100 }, recoilComp: 4,
    note: 'Belt-fed and hard-mounted under a rotor drone. It does not flinch and it does not tire.',
  },
  'Stunwire taser': {
    name: 'Stunwire taser', skillId: 'pistols', acc: 5, dv: '9S(e)', ap: -5, modes: ['SS'],
    rangeCat: 'taser', ammo: { cap: 4, current: 4 },
    note: 'Two darts and a battery. The non-lethal option that still puts people on the floor.',
  },
  'Flash canister': {
    name: 'Flash canister', skillId: 'throwing-weapons', acc: 4, dv: '10S(f)', ap: -3, modes: ['SS'],
    rangeCat: 'thrown',
    note: 'Bounces once, then takes the room off the board for a pass.',
  },
  'Weighted pipe': {
    name: 'Weighted pipe', skillId: 'clubs', acc: 4, dv: '6P', ap: 0, modes: [],
    note: 'Free, deniable, and lying in every alley in the district.',
  },
  'Telescoping baton': {
    name: 'Telescoping baton', skillId: 'clubs', acc: 5, dv: '5P', ap: 0, modes: [],
    note: 'Snaps out one-handed. On the belt of everyone who is paid to stand somewhere.',
  },
  'Riot shock stick': {
    name: 'Riot shock stick', skillId: 'clubs', acc: 5, dv: '9S(e)', ap: -5, modes: [],
    note: 'A baton with a capacitor in the grip. Ends fights without ending careers.',
  },
  'Under-bar bat': {
    name: 'Under-bar bat', skillId: 'clubs', acc: 4, dv: '5P', ap: 0, modes: [],
    note: 'Kept next to the ice scoop since long before tonight.',
  },
  'Utility blade': {
    name: 'Utility blade', skillId: 'blades', acc: 5, dv: '4P', ap: 0, modes: [],
    note: 'A work knife. Nobody gets arrested for one and everybody has one.',
  },
  'Filament knife': {
    name: 'Filament knife', skillId: 'blades', acc: 6, dv: '6P', ap: -3, modes: [],
    note: 'Edge one molecule wide, sheath twice the price of the blade.',
  },
  'Jolt gloves': {
    name: 'Jolt gloves', skillId: 'unarmed-combat', acc: 5, dv: '8S(e)', ap: -5, modes: [],
    note: 'Padded knuckles, a charge pack at the wrist, and a very short argument.',
  },
  'Strike wraps': {
    name: 'Strike wraps', skillId: 'unarmed-combat', acc: 6, dv: '8P', ap: -2, modes: [],
    note: 'Just hands and tape. The numbers are what the table sees when they connect.',
  },
} satisfies Record<string, Weapon>;

export type WeaponName = keyof typeof STARTER_WEAPONS;

// ---------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------

export const STARTER_ARMOR = {
  'Service apron': { name: 'Service apron', rating: 1, worn: true, note: 'Canvas. Stops spilled beer.' },
  'Padded club coat': { name: 'Padded club coat', rating: 5, worn: true },
  'Sprawl weave hoodie': { name: 'Sprawl weave hoodie', rating: 6, worn: true },
  'Lined clinic smock': { name: 'Lined clinic smock', rating: 6, worn: true },
  'Layered street jacket': { name: 'Layered street jacket', rating: 8, worn: true },
  'Wrapped fighting vest': { name: 'Wrapped fighting vest', rating: 8, worn: true },
  'Rigger flight jacket': { name: 'Rigger flight jacket', rating: 8, worn: true },
  'Doorman longcoat': { name: 'Doorman longcoat', rating: 9, worn: true },
  'Broker lined coat': { name: 'Broker lined coat', rating: 9, worn: true },
  'Warded duster': { name: 'Warded duster', rating: 9, worn: true, note: 'Stitched with the caster’s own charms; the armor is ordinary.' },
  'Security duty vest': { name: 'Security duty vest', rating: 9, worn: true },
  'Patrol carrier rig': { name: 'Patrol carrier rig', rating: 10, worn: true },
  'Tailored ballistic suit': { name: 'Tailored ballistic suit', rating: 11, worn: true, note: 'Cut so the client is not embarrassed to stand next to it.' },
  'Response hardshell': { name: 'Response hardshell', rating: 13, worn: true },
} satisfies Record<string, Armor>;

export type ArmorName = keyof typeof STARTER_ARMOR;

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

export const STARTER_GEAR = {
  'Burner commlink': { name: 'Burner commlink', qty: 1, rating: 1 },
  'Duty commlink': { name: 'Duty commlink', qty: 1, rating: 3 },
  'Broker commlink': { name: 'Broker commlink', qty: 1, rating: 5 },
  'Stim patch': { name: 'Stim patch', qty: 1, rating: 2 },
  'Trauma patch': { name: 'Trauma patch', qty: 1, rating: 3 },
  'Field medkit': { name: 'Field medkit', qty: 1, rating: 4 },
  'Field surgery roll': { name: 'Field surgery roll', qty: 1, rating: 3 },
  'Restraint ties': { name: 'Restraint ties', qty: 4 },
  'Low-light goggles': { name: 'Low-light goggles', qty: 1, rating: 2 },
  'Signal jammer': { name: 'Signal jammer', qty: 1, rating: 3 },
  'Smoke canister': { name: 'Smoke canister', qty: 2 },
  'Body cam': { name: 'Body cam', qty: 1, rating: 2, note: 'Records everything, uploads on a schedule somebody else sets.' },
  'Scanner wand': { name: 'Scanner wand', qty: 1, rating: 2 },
  'Spotting scope': { name: 'Spotting scope', qty: 1, rating: 3 },
  'Ghillie wrap': { name: 'Ghillie wrap', qty: 1, rating: 2 },
  'Counterfeit ID chip': { name: 'Counterfeit ID chip', qty: 1, rating: 3 },
  'Case notes slate': { name: 'Case notes slate', qty: 1, rating: 2, note: 'Half of what they know is on this and half is in their head.' },
  'Tracking tag': { name: 'Tracking tag', qty: 3, rating: 3 },
  'Reagent pouch': { name: 'Reagent pouch', qty: 1, rating: 3 },
  'Channeling focus': { name: 'Channeling focus', qty: 1, rating: 3, note: 'Bound, worn, and worth more than the caster’s coat.' },
  'Kite-2 rotor drone': { name: 'Kite-2 rotor drone', qty: 1, rating: 3, note: 'Quadrotor the size of a chair. Carries the gun so the rigger does not have to.' },
  'Jump-in harness': { name: 'Jump-in harness', qty: 1, rating: 2 },
  'Drone tool roll': { name: 'Drone tool roll', qty: 1, rating: 2 },
  'Slate-4 cyberdeck': { name: 'Slate-4 cyberdeck', qty: 1, rating: 4, note: 'Scratched lid, four attribute sliders, and somebody else’s paperwork inside.' },
  'Signal echo tap': { name: 'Signal echo tap', qty: 1, rating: 3, note: 'Passive listener. It is never clear whether the wearer is using it or it is using them.' },
  'Bar float': { name: 'Bar float', qty: 1, note: 'The night takings, in a tin, under the register.' },
} satisfies Record<string, Gear>;

export type GearName = keyof typeof STARTER_GEAR;

/** Anything a loadout slot may name. Typos are a compile error, not a runtime surprise. */
export type CatalogName = WeaponName | ArmorName | GearName;

/** A loadout slot whose options are checked against the catalog above. */
export function gearSlot(name: string, options: readonly CatalogName[], count?: Span): LoadoutSlot {
  return { slot: name, options: [...options], ...(count ? { count: toRange(count) } : {}) };
}

/** Assemble an archetype's own statblock records from catalog names. */
export function kit(sel: {
  weapons?: readonly WeaponName[];
  armor?: readonly ArmorName[];
  gear?: readonly GearName[];
  spells?: readonly Spell[];
  powers?: readonly Power[];
}): Partial<SheetV1Input> {
  return {
    weapons: (sel.weapons ?? []).map((n) => ({ ...STARTER_WEAPONS[n] })),
    armor: (sel.armor ?? []).map((n) => ({ ...STARTER_ARMOR[n] })),
    gear: (sel.gear ?? []).map((n) => ({ ...STARTER_GEAR[n] })),
    ...(sel.spells ? { spells: sel.spells.map((s) => ({ ...s })) } : {}),
    ...(sel.powers ? { powers: sel.powers.map((p) => ({ ...p })) } : {}),
    rangeTables: { ...STARTER_RANGE_TABLES },
  };
}
