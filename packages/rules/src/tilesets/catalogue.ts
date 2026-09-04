/**
 * The default tilesets. Six sets covering the places a Shadowrun table
 * actually spends its evenings.
 *
 * All original: names, palettes and patterns are ours (§14).
 *
 * ## Why these palettes look the way they do
 *
 * The first cut of this catalogue was unusable at the table and the reason was
 * measurable, not aesthetic: 87% of its swatches sat under 25% saturation and
 * 72% inside a single seventeen-point lightness band. Six sets of near-black
 * grey, distinguished only by scratch patterns that vanish at table zoom.
 *
 * So each set owns a hue family, a wide lightness range, and a light source
 * (`emissive` — colour a tile GIVES OFF). That last one is the biggest
 * differentiator at distance and the reason the sets no longer blur together.
 *
 * ## The four tools
 *
 * Every tile declares a `category`, which is the tool that offers it and so
 * the layer it lands on: **ground** (what the square is made of), **building**
 * (walls, windows, doors), **interior** (furniture) and **decoration** (props).
 *
 * `placement` is what lets a single click land the right one. A tree says it
 * belongs `on: ['grass', 'dirt']`; a hydrant says pavement; a window says
 * `inWall`. The scorer in `place.ts` reads exactly that, so adding a tile
 * teaches the tool about it — there is no separate table to keep in step.
 *
 * `height` still pays twice: it extrudes the isometric silhouette AND drives
 * cover and sight (`TILE_HEIGHTS`), so a thing that looks waist-high is
 * waist-high to the rules.
 */
import { TILE_HEIGHTS, type Tileset } from './types.js';

const { WAIST, FULL } = TILE_HEIGHTS;

/** Windows and doors are holes cut into a wall, never free-standing. */
const CUT = { inWall: true } as const;

export const DOCKLANDS: Tileset = {
  id: 'docklands',
  name: 'Docklands warehouse',
  blurb: 'Cold steel and poured concrete under sodium light. The default heist floor.',
  tiles: [
    { id: 'stairup', name: 'Steel stair up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#6b5e44', '#7b6c4e'], footprint: 'stair', height: WAIST, connects: 'up', hint: 'Up to the catwalk.' },
    { id: 'stairdown', name: 'Steel stair down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#574b39', '#675944'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Poured concrete', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#5f5242', '#6f604d'] },
    { id: 'stain', name: 'Oil-stained slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#3b332a', '#4b4135'], hint: 'Same footing, worse-looking footing.' },
    { id: 'grate', name: 'Drain grating', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#534d3d', '#635b49'] },
    { id: 'lamp', name: 'Sodium lamp pool', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#7e6749', '#927755'], emissive: '#ffaf2e', hint: 'Lit ground — anyone standing here is visible.' },

    { id: 'wall', name: 'Corrugated wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#4b4133', '#5b4e3e'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Wire-glass window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#43575b', '#4f666b'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Light gets in; so does a sightline.' },
    { id: 'door', name: 'Roller door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#825539', '#926040'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'crates', name: 'Pallet stack', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#775e3b', '#866a43'], height: WAIST, hint: 'Cover, and a place to hide the crate that matters.' },
    { id: 'rail', name: 'Catwalk railing', kind: 'feature', category: 'interior', pattern: 'grating', colors: ['#635841', '#73664c'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Stops a body, not a sightline.' },
    { id: 'barrel', name: 'Fuel drum', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a613a', '#9a6c41'], footprint: 'round', height: WAIST },
    { id: 'puddle', name: 'Oil slick', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#3f3830', '#4f463c'], placement: { on: ['floor', 'stain'] } },
  ],
};

export const CORP_INTERIOR: Tileset = {
  id: 'corp',
  name: 'Corporate interior',
  blurb: 'Pale carpet, glass and polite lighting. Lobbies, offices, server rooms.',
  tiles: [
    { id: 'stairup', name: 'Fire stair up', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#979287', '#a39d91'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Fire stair down', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#837f76', '#8f8a81'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'carpet', name: 'Executive carpet', kind: 'floor', category: 'ground', pattern: 'carpet', colors: ['#645d56', '#6f6860'] },
    { id: 'lobby', name: 'Polished lobby', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#9e9a8e', '#aaa599'], hint: 'Bright, hard, and it echoes.' },
    { id: 'raised', name: 'Raised server floor', kind: 'floor', category: 'ground', pattern: 'hatch', colors: ['#928b82', '#9d968c'], hint: 'Cable runs underneath — a decker will ask.' },

    { id: 'wall', name: 'Partition wall', kind: 'wall', category: 'building', pattern: 'solid', colors: ['#9d988d', '#a9a398'], footprint: 'wall', height: FULL },
    { id: 'glass', name: 'Glass partition', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#727c81', '#7d878c'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Blocks the body, not the view — or the shot.' },
    { id: 'door', name: 'Maglocked door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#89837a', '#958e84'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'desk', name: 'Workstation', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#726a62', '#7e746c'], height: WAIST, placement: { againstWall: true } },
    { id: 'terminal', name: 'Terminal', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#505a5e', '#5a656a'], emissive: '#58c1db', footprint: 'post', height: WAIST, placement: { againstWall: true }, hint: 'A matrix access point, and something to hack from.' },
    { id: 'bench', name: 'Reception bench', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7b736b', '#867e75'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'chair', name: 'Chair', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#6d665e', '#787168'], footprint: 'post', height: WAIST },
    { id: 'fountain', name: 'Atrium fountain', kind: 'feature', category: 'interior', pattern: 'water', colors: ['#7e888c', '#889397'], emissive: '#e0ce87', footprint: 'round', height: WAIST, hint: 'Wants room around it — and it covers a conversation.' },
    { id: 'plant', name: 'Lobby planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#4e5649', '#586153'], footprint: 'canopy', height: WAIST, placement: { on: ['carpet', 'lobby'] } },
  ],
};

export const SPRAWL_STREET: Tileset = {
  id: 'sprawl',
  name: 'Sprawl street',
  blurb: 'Wet asphalt under hot neon. Chases, meets and ambushes.',
  tiles: [
    { id: 'stairup', name: 'Stoop up', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#675546', '#776251'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Basement steps', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#57493d', '#675648'], footprint: 'stair', height: WAIST, connects: 'down', hint: 'Down to whatever is under the shop.' },
    { id: 'road', name: 'Cracked asphalt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#37312c', '#473f39'] },
    { id: 'walk', name: 'Pavement', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#5f5346', '#6f6152'] },
    { id: 'grass', name: 'Verge grass', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#464b33', '#555b3e'], hint: 'What passes for a park out here.' },
    { id: 'puddle', name: 'Standing water', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#473d35', '#574b40'], hint: 'Reflects the neon. Makes noise.' },
    { id: 'neon', name: 'Neon spill', kind: 'floor', category: 'ground', pattern: 'solid', colors: ['#775442', '#8a624d'], emissive: '#fa7a25', hint: 'Lit ground, and it colours everyone standing in it.' },

    { id: 'wall', name: 'Shopfront', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#4f4036', '#5f4d41'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Shop window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#425557', '#4e6467'], emissive: '#d6c556', footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'shutter', name: 'Security shutter', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#73513e', '#825c46'], footprint: 'wall', height: FULL, placement: CUT },
    { id: 'door', name: 'Street door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#7b5940', '#8a6548'], emissive: '#cc893d', footprint: 'wall', height: FULL, placement: CUT },

    { id: 'car', name: 'Parked car', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#6f5547', '#7e6251'], height: WAIST, hint: 'Cover until someone shoots the tank.' },
    { id: 'streetbench', name: 'Street bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#6b5642', '#7b634c'], height: WAIST, footprint: 'wall', placement: { againstWall: true, on: ['walk', 'grass'] } },

    { id: 'tree', name: 'Street tree', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#555f3f', '#636f49'], footprint: 'canopy', height: FULL, blocksSight: false, placement: { on: ['grass', 'walk'] }, hint: 'Breaks up a sightline without stopping it.' },
    { id: 'planter', name: 'Concrete planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#635545', '#736350'], footprint: 'round', height: WAIST, placement: { on: ['walk', 'grass'] } },
    { id: 'hydrant', name: 'Fire hydrant', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#824337', '#924c3d'], footprint: 'post', height: WAIST, placement: { on: ['walk'] } },
    { id: 'drain', name: 'Storm drain', kind: 'feature', category: 'decoration', pattern: 'grating', colors: ['#3f3831', '#4f463e'], placement: { on: ['road'] } },
    { id: 'sewer', name: 'Sewer grating', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#3b352e', '#4b433b'], hint: 'Somewhere under the street, something is running.' },
    { id: 'oilstain', name: 'Oil stain', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#433b33', '#53483f'], placement: { on: ['road'] } },
    { id: 'trash', name: 'Refuse pile', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#5b4b3c', '#6b5946'], footprint: 'round', height: WAIST, placement: { on: ['road', 'walk'] } },
  ],
};

export const MAINTENANCE: Tileset = {
  id: 'maintenance',
  name: 'Maintenance & sewers',
  blurb: 'Damp green concrete and access hatches. The way in nobody watches.',
  tiles: [
    { id: 'stairup', name: 'Access ladder up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#675d44', '#776c4e'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Access ladder down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#57503b', '#675e46'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'duct', name: 'Duct floor', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#534c3a', '#635b45'] },
    { id: 'walkway', name: 'Grated walkway', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#635945', '#736750'] },
    { id: 'sludge', name: 'Sludge channel', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#37432c', '#445337'], emissive: '#80cc45', hint: 'Difficult going, and it will be on your boots later.' },
    { id: 'warn', name: 'Warning light', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#77453e', '#8a5148'], emissive: '#eb3326', hint: 'Something down here is running.' },

    { id: 'wall', name: 'Pipe wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#4b4536', '#5b5341'], footprint: 'wall', height: FULL },
    { id: 'vent', name: 'Vent grille', kind: 'wall', category: 'building', pattern: 'grating', colors: ['#5f5844', '#6f6650'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'You can see through it. A face can fit if it has to.' },
    { id: 'hatch', name: 'Access hatch', kind: 'door', category: 'building', pattern: 'hatch', colors: ['#6f5740', '#7e6449'], footprint: 'wall', height: FULL, placement: CUT, hint: 'Sight passes when it is open.' },

    { id: 'valve', name: 'Valve cluster', kind: 'feature', category: 'interior', pattern: 'hatch', colors: ['#7e533d', '#8e5d44'], footprint: 'post', height: WAIST, placement: { againstWall: true } },
    { id: 'pipes', name: 'Pipe run', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#736045', '#826e4e'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'moss', name: 'Damp bloom', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#2f3b2a', '#3c4b35'], placement: { on: ['duct', 'sludge'] } },
  ],
};

export const BARRENS: Tileset = {
  id: 'barrens',
  name: 'Barrens ruins',
  blurb: 'Rust, burnt brick and firelight. Gang ground.',
  tiles: [
    { id: 'stairup', name: 'Broken stair up', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#6b4f3c', '#7b5a45'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar steps', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#5b4437', '#6b5040'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'dirt', name: 'Packed dirt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#4b3c30', '#5b483a'] },
    { id: 'ash', name: 'Ash and soot', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#332e29', '#433c36'], hint: 'Something burned here and nobody came.' },
    { id: 'rubble', name: 'Rubble', kind: 'floor', category: 'ground', pattern: 'rubble', colors: ['#5f4c3f', '#6f5849'], hint: 'Rough going, and it crunches.' },
    { id: 'slab', name: 'Broken slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#5b493e', '#6b5649'] },
    { id: 'weeds', name: 'Weed patch', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#484f34', '#565f3f'] },

    { id: 'wall', name: 'Burnt brick', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#573d32', '#67493c'], footprint: 'wall', height: FULL },
    { id: 'gap', name: 'Blown-out window', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#3f322b', '#4f3e36'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'No glass left in it. Shoot through it.' },
    { id: 'doorway', name: 'Empty doorway', kind: 'door', category: 'building', pattern: 'brick', colors: ['#674e40', '#775a4a'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },

    { id: 'halfwall', name: 'Collapsed wall', kind: 'feature', category: 'interior', pattern: 'brick', colors: ['#634739', '#735342'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Waist high — cover, not concealment.' },
    { id: 'fire', name: 'Barrel fire', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7e5238', '#925e40'], emissive: '#ff871f', footprint: 'round', height: WAIST, hint: 'A light source: everyone near it is visible.' },
    { id: 'scrub', name: 'Scrub bush', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#535f3d', '#616f47'], footprint: 'canopy', height: WAIST, placement: { on: ['dirt', 'weeds'] } },
    { id: 'wreck', name: 'Burnt-out wreck', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#734739', '#865343'], emissive: '#d1411d', footprint: 'round', height: WAIST, placement: { on: ['dirt', 'slab', 'rubble'] } },
  ],
};

export const CLUB: Tileset = {
  id: 'club',
  name: 'Club & bar',
  blurb: 'Violet dark, sticky floors and a back room. Where the meet actually happens.',
  tiles: [
    { id: 'stairup', name: 'Mezzanine stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#3a494f', '#46575f'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#2b393f', '#36474f'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Dance floor', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#27343b', '#32424b'], hint: 'Lit from below, and it moves.' },
    { id: 'bar', name: 'Bar decking', kind: 'floor', category: 'ground', pattern: 'planks', colors: ['#7b5e42', '#8a6b4b'] },
    { id: 'quiet', name: 'Back-room floor', kind: 'floor', category: 'ground', pattern: 'carpet', colors: ['#535e63', '#606d73'], hint: 'Out of the noise. This is where the job gets described.' },

    { id: 'wall', name: 'Padded wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#212d33', '#2b3b43'], footprint: 'wall', height: FULL },
    { id: 'hatchwin', name: 'Serving hatch', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#444f57', '#505d67'], emissive: '#c7c35a', footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'door', name: 'Back-room door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#586167', '#667077'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'counter', name: 'Bar counter', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#826449', '#967354'], emissive: '#e6a340', footprint: 'wall', height: WAIST, placement: { againstWall: true } },
    { id: 'booth', name: 'Booth', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#2f3c43', '#3a4b53'], height: WAIST, placement: { againstWall: true }, hint: 'Sit here for the quiet conversation.' },
    { id: 'stool', name: 'Bar stool', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#735742', '#82634c'], footprint: 'post', height: WAIST },
    { id: 'speaker', name: 'Speaker stack', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#36454b', '#44585f'], emissive: '#4bd5eb', footprint: 'post', height: FULL, placement: { againstWall: true }, hint: 'Loud enough that nobody hears the fight start.' },
    { id: 'glassware', name: 'Broken glass', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#49585b', '#55676b'], placement: { on: ['floor', 'bar'] } },
  ],
};

export const TILESETS: readonly Tileset[] = [
  DOCKLANDS,
  CORP_INTERIOR,
  SPRAWL_STREET,
  MAINTENANCE,
  BARRENS,
  CLUB,
];

export function tilesetById(id: string): Tileset | null {
  return TILESETS.find((t) => t.id === id) ?? null;
}

export function tileById(tilesetId: string, tileId: string): Tileset['tiles'][number] | null {
  return tilesetById(tilesetId)?.tiles.find((t) => t.id === tileId) ?? null;
}
