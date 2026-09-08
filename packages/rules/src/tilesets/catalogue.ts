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
    { id: 'stairup', name: 'Steel stair up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#8b7a58', '#a08c65'], footprint: 'stair', height: WAIST, connects: 'up', hint: 'Up to the catwalk.' },
    { id: 'stairdown', name: 'Steel stair down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#71624a', '#867458'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Poured concrete', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#7c6b56', '#907d64'] },
    { id: 'stain', name: 'Oil-stained slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#4d4237', '#625545'], hint: 'Same footing, worse-looking footing.' },
    { id: 'grate', name: 'Drain grating', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#6c644f', '#81765f'] },
    { id: 'lamp', name: 'Sodium lamp pool', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#a4865f', '#a4855f'], emissive: '#ffaf2e', hint: 'Lit ground — anyone standing here is visible.' },

    { id: 'wall', name: 'Corrugated wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#625542', '#766551'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Wire-glass window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#577176', '#67858b'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Light gets in; so does a sightline.' },
    { id: 'door', name: 'Roller door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#a46b48', '#a46c48'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'crates', name: 'Pallet stack', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#9b7a4d', '#a48152'], height: WAIST, hint: 'Cover, and a place to hide the crate that matters.' },
    { id: 'rail', name: 'Catwalk railing', kind: 'feature', category: 'interior', pattern: 'grating', colors: ['#817255', '#968563'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Stops a body, not a sightline.' },
    { id: 'barrel', name: 'Fuel drum', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#a47445', '#a47345'], footprint: 'round', height: WAIST },
    { id: 'puddle', name: 'Oil slick', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#52493e', '#675b4e'], placement: { on: ['floor', 'stain'] } },

    { id: 'catwalk', name: 'Steel mesh', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#6a5f4c', '#7a6e58'], hint: 'Catwalk decking — you can see the floor through it.' },
    { id: 'chainlink', name: 'Chain-link fence', kind: 'wall', category: 'building', pattern: 'grating', colors: ['#75705c', '#857f69'], footprint: 'wall', height: FULL, blocksSight: false, hint: 'Stops a body, not a bullet or a look.' },
    { id: 'shelving', name: 'Racking', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6e5c46', '#7f6b52'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Cover, and things fall off it.' },
    { id: 'container', name: 'Shipping container', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a5340', '#8a5f49'], height: FULL, hint: 'Nobody sees past it. Paint a row for a maze.' },
    { id: 'forklift', name: 'Forklift', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#8a7a3e', '#9b8a48'], height: WAIST, hint: 'Cover with an engine in it.' },
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
    { id: 'lobby', name: 'Polished lobby', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#9e9a8e', '#a49f94'], hint: 'Bright, hard, and it echoes.', sheen: '#f2dfa8' },
    { id: 'raised', name: 'Raised server floor', kind: 'floor', category: 'ground', pattern: 'hatch', colors: ['#928b82', '#9d968c'], hint: 'Cable runs underneath — a decker will ask.' },

    { id: 'wall', name: 'Partition wall', kind: 'wall', category: 'building', pattern: 'solid', colors: ['#9d988d', '#a49e93'], footprint: 'wall', height: FULL },
    { id: 'glass', name: 'Glass partition', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#727c81', '#7d878c'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Blocks the body, not the view — or the shot.' },
    { id: 'door', name: 'Maglocked door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#89837a', '#958e84'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'desk', name: 'Workstation', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#726a62', '#7e746c'], height: WAIST, placement: { againstWall: true } },
    { id: 'terminal', name: 'Terminal', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#505a5e', '#5a656a'], emissive: '#58c1db', footprint: 'post', height: WAIST, placement: { againstWall: true }, hint: 'A matrix access point, and something to hack from.' },
    { id: 'bench', name: 'Reception bench', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7b736b', '#867e75'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'chair', name: 'Chair', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#6d665e', '#787168'], footprint: 'post', height: WAIST },
    { id: 'fountain', name: 'Atrium fountain', kind: 'feature', category: 'interior', pattern: 'water', colors: ['#7e888c', '#889397'], emissive: '#e0ce87', footprint: 'round', height: WAIST, hint: 'Wants room around it — and it covers a conversation.' },
    { id: 'plant', name: 'Lobby planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#4e5649', '#586153'], footprint: 'canopy', height: WAIST, placement: { on: ['carpet', 'lobby'] } },

    { id: 'hall', name: 'Corridor tile', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#8d8a80', '#99968c'], hint: 'The bit between the rooms. Cameras live here.' },
    { id: 'glassdoor', name: 'Glass door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7b8489', '#868f94'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'Blocks the body, shows the lobby.' },
    { id: 'table', name: 'Meeting table', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#8e877c', '#9a9388'], height: WAIST, hint: 'Cover, if you flip it.' },
    { id: 'sofa', name: 'Reception sofa', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7a746d', '#86807a'], footprint: 'wall', height: WAIST, placement: { againstWall: true } },
    { id: 'rack', name: 'Server rack', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6b7276', '#767d81'], emissive: '#e6c46a', footprint: 'wall', height: FULL, placement: { againstWall: true }, hint: 'Full height, humming, and what the run is probably about.' },
  ],
};

export const SPRAWL_STREET: Tileset = {
  id: 'sprawl',
  name: 'Sprawl street',
  blurb: 'Wet asphalt under hot neon. Chases, meets and ambushes.',
  tiles: [
    { id: 'stairup', name: 'Stoop up', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#866f5b', '#9b7f69'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Basement steps', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#715f4f', '#86705e'], footprint: 'stair', height: WAIST, connects: 'down', hint: 'Down to whatever is under the shop.' },
    { id: 'road', name: 'Cracked asphalt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#484039', '#5c524a'] },
    { id: 'walk', name: 'Pavement', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#7c6c5b', '#907e6b'] },
    { id: 'grass', name: 'Verge grass', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#5b6242', '#6e7651'], hint: 'What passes for a park out here.' },
    { id: 'puddle', name: 'Standing water', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#5c4f45', '#716253'], hint: 'Reflects the neon. Makes noise.', sheen: '#e04fb8' },
    { id: 'neon', name: 'Neon spill', kind: 'floor', category: 'ground', pattern: 'solid', colors: ['#9b6d56', '#a4755b'], emissive: '#f531b4', hint: 'Lit ground, and it colours everyone standing in it.' },

    { id: 'wall', name: 'Shopfront', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#675346', '#7c6455'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Shop window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#566e71', '#658286'], emissive: '#d6c556', footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'shutter', name: 'Security shutter', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#966951', '#a47458'], footprint: 'wall', height: FULL, placement: CUT },
    { id: 'door', name: 'Street door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#a07453', '#a47855'], emissive: '#cc893d', footprint: 'wall', height: FULL, placement: CUT },

    { id: 'car', name: 'Parked car', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#906f5c', '#a47f69'], height: WAIST, hint: 'Cover until someone shoots the tank.' },
    { id: 'streetbench', name: 'Street bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8b7056', '#a08163'], height: WAIST, footprint: 'wall', placement: { againstWall: true, on: ['walk', 'grass'] } },

    { id: 'tree', name: 'Street tree', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#6e7c52', '#81905f'], footprint: 'canopy', height: FULL, blocksSight: false, placement: { on: ['grass', 'walk'] }, hint: 'Breaks up a sightline without stopping it.' },
    { id: 'planter', name: 'Concrete planter', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#816f5a', '#968168'], footprint: 'round', height: WAIST, placement: { on: ['walk', 'grass'] } },
    { id: 'sign', name: 'Neon sign', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#675244', '#7c6352'], emissive: '#25d9f5', footprint: 'wall', height: FULL, placement: CUT, hint: 'A tube, a transformer and a landlord who stopped asking.' },
    { id: 'hydrant', name: 'Fire hydrant', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#a45445', '#a45544'], footprint: 'post', height: WAIST, placement: { on: ['walk'] } },
    { id: 'drain', name: 'Storm drain', kind: 'feature', category: 'decoration', pattern: 'grating', colors: ['#524940', '#675b51'], placement: { on: ['road'] } },
    { id: 'sewer', name: 'Sewer grating', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#4d453c', '#62574d'], hint: 'Somewhere under the street, something is running.' },
    { id: 'oilstain', name: 'Oil stain', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#574d42', '#6c5e52'], placement: { on: ['road'] } },
    { id: 'trash', name: 'Refuse pile', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#76624e', '#8b745b'], footprint: 'round', height: WAIST, placement: { on: ['road', 'walk'] } },

    { id: 'alley', name: 'Alley concrete', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#4a4139', '#584d44'], hint: 'Behind the shops. Nobody looks down here.' },
    { id: 'van', name: 'Delivery van', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#6d6558', '#7b7264'], height: WAIST, hint: 'Cover, and a way out if the keys are in it.' },
    { id: 'dumpster', name: 'Dumpster', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#5f6a3e', '#6c7847'], height: WAIST, placement: { on: ['road', 'walk', 'alley'] }, hint: 'Cover that smells.' },
    { id: 'bollard', name: 'Bollard', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7c6448', '#8b7052'], footprint: 'post', height: WAIST, placement: { on: ['walk'] } },
  ],
};

export const MAINTENANCE: Tileset = {
  id: 'maintenance',
  name: 'Maintenance & sewers',
  blurb: 'Damp green concrete and access hatches. The way in nobody watches.',
  tiles: [
    { id: 'stairup', name: 'Access ladder up', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#867958', '#9b8c65'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Access ladder down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#71684d', '#867a5b'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'duct', name: 'Duct floor', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#6c634b', '#81765a'] },
    { id: 'walkway', name: 'Grated walkway', kind: 'floor', category: 'ground', pattern: 'grating', colors: ['#81745a', '#968668'] },
    { id: 'sludge', name: 'Sludge channel', kind: 'floor', category: 'ground', pattern: 'water', colors: ['#485739', '#586c48'], emissive: '#80cc45', hint: 'Difficult going, and it will be on your boots later.' },
    { id: 'warn', name: 'Warning light', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#9b5a51', '#a46055'], emissive: '#eb3326', hint: 'Something down here is running.' },

    { id: 'wall', name: 'Pipe wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#625a46', '#766c55'], footprint: 'wall', height: FULL },
    { id: 'vent', name: 'Vent grille', kind: 'wall', category: 'building', pattern: 'grating', colors: ['#7c7258', '#908568'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'You can see through it. A face can fit if it has to.' },
    { id: 'hatch', name: 'Access hatch', kind: 'door', category: 'building', pattern: 'hatch', colors: ['#907153', '#a4825f'], footprint: 'wall', height: FULL, placement: CUT, hint: 'Sight passes when it is open.' },

    { id: 'valve', name: 'Valve cluster', kind: 'feature', category: 'interior', pattern: 'hatch', colors: ['#a46c4f', '#a46c4e'], footprint: 'post', height: WAIST, placement: { againstWall: true } },
    { id: 'pipes', name: 'Pipe run', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#967d5a', '#a48a62'], height: WAIST, footprint: 'wall', placement: { againstWall: true } },
    { id: 'moss', name: 'Damp bloom', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#3d4d37', '#4e6245'], placement: { on: ['duct', 'sludge'] } },

    { id: 'tray', name: 'Cable-tray floor', kind: 'floor', category: 'ground', pattern: 'panel', colors: ['#5c5440', '#6a614a'], hint: 'Trip hazard, and a decker will ask where it goes.' },
    { id: 'tank', name: 'Storage tank', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6f6448', '#7e7253'], footprint: 'round', height: FULL, hint: 'Full height. Do not shoot it.' },
    { id: 'generator', name: 'Generator', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a5f41', '#8a6c4a'], emissive: '#ffb347', height: WAIST, hint: 'Loud, warm, and the only light down here.' },
    { id: 'pump', name: 'Pump housing', kind: 'feature', category: 'interior', pattern: 'hatch', colors: ['#6e5c45', '#7d6a50'], footprint: 'post', height: WAIST, placement: { againstWall: true } },
  ],
};

export const BARRENS: Tileset = {
  id: 'barrens',
  name: 'Barrens ruins',
  blurb: 'Rust, burnt brick and firelight. Gang ground.',
  tiles: [
    { id: 'stairup', name: 'Broken stair up', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#8b674e', '#a0755a'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar steps', kind: 'feature', category: 'stairs', pattern: 'rubble', colors: ['#765848', '#8b6853'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'dirt', name: 'Packed dirt', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#624e3e', '#765e4b'] },
    { id: 'ash', name: 'Ash and soot', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#423c35', '#574e46'], hint: 'Something burned here and nobody came.' },
    { id: 'rubble', name: 'Rubble', kind: 'floor', category: 'ground', pattern: 'rubble', colors: ['#7c6352', '#90725f'], hint: 'Rough going, and it crunches.' },
    { id: 'slab', name: 'Broken slab', kind: 'floor', category: 'ground', pattern: 'concrete', colors: ['#765f51', '#8b705f'] },
    { id: 'weeds', name: 'Weed patch', kind: 'floor', category: 'ground', pattern: 'gravel', colors: ['#5e6744', '#707c52'] },

    { id: 'wall', name: 'Burnt brick', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#714f41', '#865f4e'], footprint: 'wall', height: FULL },
    { id: 'gap', name: 'Blown-out window', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#524138', '#675146'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT, hint: 'No glass left in it. Shoot through it.' },
    { id: 'doorway', name: 'Empty doorway', kind: 'door', category: 'building', pattern: 'brick', colors: ['#866553', '#9b7560'], footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },

    { id: 'halfwall', name: 'Collapsed wall', kind: 'feature', category: 'interior', pattern: 'brick', colors: ['#815c4a', '#966c56'], footprint: 'wall', height: WAIST, placement: { againstWall: true }, hint: 'Waist high — cover, not concealment.' },
    { id: 'fire', name: 'Barrel fire', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#a46b49', '#a46a48'], emissive: '#ff871f', footprint: 'round', height: WAIST, hint: 'A light source: everyone near it is visible.' },
    { id: 'scrub', name: 'Scrub bush', kind: 'feature', category: 'decoration', pattern: 'gravel', colors: ['#6c7c4f', '#7e905c'], footprint: 'canopy', height: WAIST, placement: { on: ['dirt', 'weeds'] } },
    { id: 'wreck', name: 'Burnt-out wreck', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#965c4a', '#a46652'], emissive: '#d1411d', footprint: 'round', height: WAIST, placement: { on: ['dirt', 'slab', 'rubble'] } },

    { id: 'shanty', name: 'Shanty wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6b4e3f', '#7a5a49'], footprint: 'wall', height: FULL, hint: 'Corrugated sheet. Stops a look, not a round.' },
    { id: 'heap', name: 'Rubble heap', kind: 'feature', category: 'interior', pattern: 'rubble', colors: ['#7a5c4a', '#8a6a56'], height: WAIST, hint: 'Cover, and it shifts underfoot.' },
    { id: 'tyres', name: 'Tyre pile', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#4f4740', '#5d554c'], footprint: 'round', height: WAIST, placement: { on: ['dirt', 'slab', 'ash'] } },
    { id: 'mattress', name: 'Mattress', kind: 'feature', category: 'decoration', pattern: 'carpet', colors: ['#6f6553', '#7d735f'], placement: { on: ['dirt', 'slab', 'ash'] }, hint: 'Somebody sleeps here. Maybe still.' },
  ],
};

export const CLUB: Tileset = {
  id: 'club',
  name: 'Club & bar',
  blurb: 'Violet dark, sticky floors and a back room. Where the meet actually happens.',
  tiles: [
    { id: 'stairup', name: 'Mezzanine stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#4b5f67', '#5b717c'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar stair', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#384a52', '#465c67'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'floor', name: 'Dance floor', kind: 'floor', category: 'ground', pattern: 'tile', colors: ['#33444d', '#415662'], hint: 'Lit from below, and it moves.', sheen: '#b83cff' },
    { id: 'bar', name: 'Bar decking', kind: 'floor', category: 'ground', pattern: 'planks', colors: ['#a07a56', '#a47f59'] },
    { id: 'quiet', name: 'Back-room floor', kind: 'floor', category: 'ground', pattern: 'carpet', colors: ['#6c7a81', '#7d8e96'], hint: 'Out of the noise. This is where the job gets described.' },

    { id: 'wall', name: 'Padded wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#2b3b42', '#384d57'], footprint: 'wall', height: FULL },
    { id: 'hatchwin', name: 'Serving hatch', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#586771', '#687986'], emissive: '#c7c35a', footprint: 'wall', height: FULL, blocksSight: false, placement: CUT },
    { id: 'door', name: 'Back-room door', kind: 'door', category: 'building', pattern: 'solid', colors: ['#727e86', '#85929b'], footprint: 'wall', height: FULL, placement: CUT },

    { id: 'sign', name: 'Neon sign', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#42555c', '#526771'], emissive: '#fa25ac', footprint: 'wall', height: FULL, placement: CUT, hint: 'Pink, and the only thing outside that says the place is open.' },
    { id: 'counter', name: 'Bar counter', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#a47e5c', '#a47d5c'], emissive: '#e6a340', footprint: 'wall', height: WAIST, placement: { againstWall: true } },
    { id: 'booth', name: 'Booth', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#3d4e57', '#4b626c'], height: WAIST, placement: { againstWall: true }, hint: 'Sit here for the quiet conversation.' },
    { id: 'stool', name: 'Bar stool', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#967156', '#a47c60'], footprint: 'post', height: WAIST },
    { id: 'speaker', name: 'Speaker stack', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#465a62', '#58727c'], emissive: '#4bd5eb', footprint: 'post', height: FULL, placement: { againstWall: true }, hint: 'Loud enough that nobody hears the fight start.' },
    { id: 'glassware', name: 'Broken glass', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#5f7276', '#6f868b'], placement: { on: ['floor', 'bar'] } },

    { id: 'stage', name: 'Stage', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#7a5f43', '#8a6c4c'], height: WAIST, hint: 'Raised. Whoever is on it has cover from the floor and none from the mezzanine.' },
    { id: 'djbooth', name: 'DJ booth', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#3e5058', '#4b6068'], height: WAIST, placement: { againstWall: true } },
    { id: 'rope', name: 'Velvet rope', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#3f5560', '#4c6470'], footprint: 'wall', height: WAIST, blocksSight: false, hint: 'Stops nobody who matters.' },
    { id: 'cocktail', name: 'Cocktail table', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#3a4a52', '#475a63'], footprint: 'round', height: WAIST },
    { id: 'backbar', name: 'Back bar', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#5a4a3a', '#685644'], footprint: 'wall', height: FULL, placement: { againstWall: true }, hint: 'Bottles, mirror, and the shotgun under it.' },
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
