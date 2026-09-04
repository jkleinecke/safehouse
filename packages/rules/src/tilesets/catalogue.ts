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
    { id: 'stairup', name: 'Steel stair up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#5f6771', '#8f98a3'], footprint: 'stair', height: WAIST, connects: 'up', hint: 'Up to the catwalk.' },
    { id: 'stairdown', name: 'Steel stair down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#4a515a', '#767e89'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Poured concrete', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#6a7078', '#7d848d'] },
    { id: 'stain', name: 'Oil-stained slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#4a4f57', '#3a3e45'], hint: 'Same footing, worse-looking footing.' },
    { id: 'grate', name: 'Drain grating', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#495059', '#8b939d'] },
    { id: 'lamp', name: 'Sodium lamp pool', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#7d7461', '#9a8b68'], emissive: '#ffb545', hint: 'Lit ground — anyone standing here is visible.' },

    { id: 'wall', name: 'Corrugated wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#39414c', '#4d5765'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Wire-glass window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#5c7f8c', '#9fd0dd'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Light gets in; so does a sightline.' },
    { id: 'door', name: 'Roller door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7a5f34', '#a3803f'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'crates', name: 'Pallet stack', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8a6a3c', '#a8834f'], height: WAIST, hint: 'Cover, and a place to hide the crate that matters.' },
    { id: 'rail', name: 'Catwalk railing', kind: 'feature', category: 'interior', pattern: 'grating', colors: ['#5c646e', '#9aa3ae'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Stops a body, not a sightline.' },
    { id: 'barrel', name: 'Fuel drum', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6a5a2e', '#8a7638'], footprint: 'round', height: WAIST },
    { id: 'puddle', name: 'Oil slick', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#2f3238', '#43484f'], placement: { on: ['floor', 'stain'] } },
  ],
};

export const CORP_INTERIOR: Tileset = {
  id: 'corp',
  name: 'Corporate interior',
  blurb: 'Pale carpet, glass and polite lighting. Lobbies, offices, server rooms.',
  tiles: [
    { id: 'stairup', name: 'Fire stair up', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#9aa5b2', '#b9c3ce'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Fire stair down', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#7f8b98', '#9daab7'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'carpet', name: 'Executive carpet', kind: 'floor', category: 'ground', pattern: 'carpet', colors: ['#8d97a4', '#9fa9b6'] },
    { id: 'lobby', name: 'Polished lobby', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#b3bcc7', '#c8d0da'], hint: 'Bright, hard, and it echoes.' },
    { id: 'raised', name: 'Raised server floor', kind: 'floor', category: 'ground', pattern: 'hatch', colors: ['#5f7482', '#7fa0b2'], emissive: '#39d7f0', hint: 'Cable runs underneath — a decker will ask.' },

    { id: 'wall', name: 'Partition wall', kind: 'wall', category: 'building', pattern: 'solid', colors: ['#dfe5ec', '#c2cad4'], footprint: 'wall', height: FULL },
    { id: 'glass', name: 'Glass partition', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#69b6cc', '#a8e2f2'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Blocks the body, not the view — or the shot.' },
    { id: 'door', name: 'Maglocked door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#4d7f96', '#7fb8cf'], emissive: '#39d7f0', footprint: 'wall', height: FULL, placement: CUT },

    { id: 'desk', name: 'Workstation', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6e7885', '#8b96a4'], height: WAIST, placement: { againstWall: true } },
    { id: 'terminal', name: 'Terminal', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#3f5a68', '#5f8ea3'], emissive: '#39d7f0', footprint: 'post', height: WAIST, placement: { againstWall: true }, hint: 'A matrix access point, and something to hack from.' },
    { id: 'bench', name: 'Reception bench', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7c8797', '#95a1b1'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'chair', name: 'Chair', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#5b6572', '#727d8c'], footprint: 'post', height: WAIST },
    { id: 'fountain', name: 'Atrium fountain', kind: 'feature', category: 'interior', pattern: 'water', colors: ['#4a7f96', '#8fcfe2'], emissive: '#5fd8f0', footprint: 'round', height: WAIST, hint: 'Wants room around it — and it covers a conversation.' },
    { id: 'plant', name: 'Lobby planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#3f6b46', '#5e9a63'], footprint: 'canopy', height: WAIST, placement: { on: ['carpet', 'lobby'] } },
  ],
};

export const SPRAWL_STREET: Tileset = {
  id: 'sprawl',
  name: 'Sprawl street',
  blurb: 'Wet asphalt under hot neon. Chases, meets and ambushes.',
  tiles: [
    { id: 'stairup', name: 'Stoop up', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#7b7472', '#918a87'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Basement steps', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#5d5654', '#736c69'], footprint: 'stair', height: WAIST, connects: 'down', hint: 'Down to whatever is under the shop.' },
    { id: 'road', name: 'Cracked asphalt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#3e3a3c', '#4c4749'] },
    { id: 'walk', name: 'Pavement', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#736c6b', '#877f7d'] },
    { id: 'grass', name: 'Verge grass', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#415c37', '#557547'], hint: 'What passes for a park out here.' },
    { id: 'puddle', name: 'Standing water', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#334a58', '#5b8ba6'], emissive: '#ff3fa4', hint: 'Reflects the neon. Makes noise.' },
    { id: 'neon', name: 'Neon spill', kind: 'floor', category: 'ground', pattern: 'solid', colors: ['#5b3350', '#7d4570'], emissive: '#ff3fa4', hint: 'Lit ground, and it colours everyone standing in it.' },

    { id: 'wall', name: 'Shopfront', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#6b4a3e', '#835c4c'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Shop window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#7a6a52', '#c8b483'], emissive: '#ffd27a', footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'shutter', name: 'Security shutter', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#4a4a52', '#666670'], footprint: 'wall', height: FULL, placement: CUT },
    { id: 'door', name: 'Street door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#7a5636', '#9c7047'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'car', name: 'Parked car', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#48566b', '#63758f'], height: WAIST, hint: 'Cover until someone shoots the tank.' },
    { id: 'streetbench', name: 'Street bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#6a5340', '#856a52'], height: WAIST, footprint: 'wall', placement: { againstWall: true, on: ['walk', 'grass'] } },

    { id: 'tree', name: 'Street tree', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#3c5c33', '#5c8a45'], footprint: 'canopy', height: FULL, blocksSight: false, placement: { on: ['grass', 'walk'] }, hint: 'Breaks up a sightline without stopping it.' },
    { id: 'planter', name: 'Concrete planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#6b6a5e', '#4f7a44'], footprint: 'round', height: WAIST, placement: { on: ['walk', 'grass'] } },
    { id: 'hydrant', name: 'Fire hydrant', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8e3b32', '#b45448'], footprint: 'post', height: WAIST, placement: { on: ['walk'] } },
    { id: 'drain', name: 'Storm drain', kind: 'feature', category: 'decoration', pattern: 'grating', colors: ['#33312f', '#57534e'], placement: { on: ['road'] } },
    { id: 'oilstain', name: 'Oil stain', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#302d2e', '#403b3c'], placement: { on: ['road'] } },
    { id: 'trash', name: 'Refuse pile', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#4a4038', '#5f5245'], footprint: 'round', height: WAIST, placement: { on: ['road', 'walk'] } },
  ],
};

export const MAINTENANCE: Tileset = {
  id: 'maintenance',
  name: 'Maintenance & sewers',
  blurb: 'Damp green concrete and access hatches. The way in nobody watches.',
  tiles: [
    { id: 'stairup', name: 'Access ladder up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#5c6b5d', '#8ba08d'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Access ladder down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#47543f', '#6f8168'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'duct', name: 'Duct floor', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#5b6b5c', '#6d806e'] },
    { id: 'walkway', name: 'Grated walkway', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#4a5a4d', '#879a89'] },
    { id: 'sludge', name: 'Sludge channel', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#394a32', '#5c7a4a'], hint: 'Difficult going, and it will be on your boots later.' },
    { id: 'warn', name: 'Warning light', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#6d6448', '#8a7c52'], emissive: '#ffc23d', hint: 'Something down here is running.' },

    { id: 'wall', name: 'Pipe wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#3f4c40', '#586b5a'], footprint: 'wall', height: FULL },
    { id: 'vent', name: 'Vent grille', kind: 'wall', category: 'building', pattern: 'grating', colors: ['#47563f', '#7d9070'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'You can see through it. A face can fit if it has to.' },
    { id: 'hatch', name: 'Access hatch', kind: 'door', category: 'building', pattern: 'hatch', colors: ['#5e6a5f', '#93a394'], footprint: 'wall', height: FULL, placement: CUT, hint: 'Sight passes when it is open.' },

    { id: 'valve', name: 'Valve cluster', kind: 'feature', category: 'interior', pattern: 'hatch', colors: ['#6a7161', '#8d9781'], footprint: 'post', height: WAIST, placement: { againstWall: true } },
    { id: 'pipes', name: 'Pipe run', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#57604d', '#727c63'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'moss', name: 'Damp bloom', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#3b5236', '#4f6b43'], placement: { on: ['duct', 'sludge'] } },
  ],
};

export const BARRENS: Tileset = {
  id: 'barrens',
  name: 'Barrens ruins',
  blurb: 'Rust, burnt brick and firelight. Gang ground.',
  tiles: [
    { id: 'stairup', name: 'Broken stair up', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#7c6a58', '#94806a'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar steps', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#5d4f43', '#756455'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'dirt', name: 'Packed dirt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#7a6144', '#8d7150'] },
    { id: 'rubble', name: 'Rubble', kind: 'floor', category: 'ground', pattern: 'rubble', colors: ['#63564a', '#7a6b5c'], hint: 'Rough going, and it crunches.' },
    { id: 'slab', name: 'Broken slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#6d655d', '#80776e'] },
    { id: 'weeds', name: 'Weed patch', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#5a6338', '#727a45'] },

    { id: 'wall', name: 'Burnt brick', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#7b3f2c', '#96513a'], footprint: 'wall', height: FULL },
    { id: 'gap', name: 'Blown-out window', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#5e3325', '#7a4331'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'No glass left in it. Shoot through it.' },
    { id: 'doorway', name: 'Empty doorway', kind: 'door', category: 'building', pattern: 'brick', colors: ['#4e2c20', '#6b3c2b'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },

    { id: 'halfwall', name: 'Collapsed wall', kind: 'feature', category: 'interior', pattern: 'brick', colors: ['#8a5a40', '#a06d4e'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Waist high — cover, not concealment.' },
    { id: 'fire', name: 'Barrel fire', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#a2521f', '#d97a2b'], emissive: '#ff8324', footprint: 'round', height: WAIST, hint: 'A light source: everyone near it is visible.' },
    { id: 'scrub', name: 'Scrub bush', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#4c5a30', '#63753c'], footprint: 'canopy', height: WAIST, placement: { on: ['dirt', 'weeds'] } },
    { id: 'wreck', name: 'Burnt-out wreck', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#4a3a34', '#5f4a41'], footprint: 'round', height: WAIST, placement: { on: ['dirt', 'slab', 'rubble'] } },
  ],
};

export const CLUB: Tileset = {
  id: 'club',
  name: 'Club & bar',
  blurb: 'Violet dark, sticky floors and a back room. Where the meet actually happens.',
  tiles: [
    { id: 'stairup', name: 'Mezzanine stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#5e4076', '#7a5595'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#42304f', '#584066'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Dance floor', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#4c3566', '#5f437e'], emissive: '#b34dff', hint: 'Lit from below, and it moves.' },
    { id: 'bar', name: 'Bar decking', kind: 'floor', category: 'ground', pattern: 'planks', colors: ['#5c4033', '#71503f'] },
    { id: 'quiet', name: 'Back-room floor', kind: 'floor', category: 'ground', pattern: 'carpet', colors: ['#3b2f47', '#4a3b59'], hint: 'Out of the noise. This is where the job gets described.' },

    { id: 'wall', name: 'Padded wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#33244a', '#45325f'], footprint: 'wall', height: FULL },
    { id: 'hatchwin', name: 'Serving hatch', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#5a3f6e', '#7d5b95'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'door', name: 'Back-room door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#54306e', '#6f4193'], emissive: '#b34dff', footprint: 'wall', height: FULL, placement: CUT },

    { id: 'counter', name: 'Bar counter', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a4f2e', '#9c663c'], emissive: '#39d7f0', footprint: 'wall', height: WAIST, placement: { againstWall: true } },
    { id: 'booth', name: 'Booth', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#6d3a55', '#8a4a6b'], height: WAIST, placement: { againstWall: true }, hint: 'Sit here for the quiet conversation.' },
    { id: 'stool', name: 'Bar stool', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#5d3f4e', '#77505f'], footprint: 'post', height: WAIST },
    { id: 'speaker', name: 'Speaker stack', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#2b2338', '#3d3050'], footprint: 'post', height: FULL, placement: { againstWall: true }, hint: 'Loud enough that nobody hears the fight start.' },
    { id: 'glassware', name: 'Broken glass', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#4a3f5c', '#6a5c80'], placement: { on: ['floor', 'bar'] } },
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
