/**
 * Ten more places (the second catalogue): where a campaign spends the
 * evenings that are not a heist. Homes of two kinds, three places to eat,
 * a plaza, a park, a marina, the country and the lake.
 *
 * All original: names, palettes and patterns are ours (§14). Every set is
 * held to `style.ts` by `style.test.ts` — the same near-black, warm-light
 * rules as the first six — and speaks the same slots (`slots.ts`), so a
 * scene switches between any two sets without losing a door.
 *
 * ## Authoring notes
 *
 * - Ids never reuse `wall`, `door` or `floor`: those three collide across the
 *   first six sets on purpose and the tests pin exactly which sets share
 *   them. A new set names its parts for what they are.
 * - Order within a category is the slot order (new tiles go at the END).
 * - The polished tier (`style.ts` AFFLUENCE) is opt-in per set: the condo
 *   tower and the dining room are pale and nearly grey, and the tests know
 *   which sets those are.
 * - Water is cool. A set that is mostly water would be a cool set, and the
 *   catalogue allows roughly one room in five to run cool; these keep the
 *   water to a few tiles against warm wood, sand and stone, so each still
 *   reads as one warm place with cold water in it.
 */
import { TILE_HEIGHTS, type Tileset } from './types.js';

const { WAIST, FULL } = TILE_HEIGHTS;

/** Windows and doors are holes cut into a wall, never free-standing. */
const CUT = { inWall: true } as const;

export const TENEMENT: Tileset = {
  id: 'tenement',
  name: 'Tenement block',
  blurb: 'Cracked plaster, a landing that smells of soup, a door that never latches. Where the runners actually live.',
  tiles: [
    { id: 'stairup', name: 'Stairwell up', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#7f6f5c', '#8f7d68'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Stairwell down', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#6b5d4d', '#7a6a57'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'lino', name: 'Hallway lino', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#6f6350', '#7d705b'], hint: 'The landing. Scuffed to the pattern.' },
    { id: 'carpet', name: 'Apartment carpet', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#6e5646', '#7b6252'] },
    { id: 'kitchen', name: 'Kitchen vinyl', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#7e7358', '#8b8064'] },
    { id: 'bathroom', name: 'Bathroom tile', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#7a8078', '#888e86'], hint: 'The one cold floor in the flat.' },
    { id: 'landing', name: 'Bare concrete', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'concrete', colors: ['#615647', '#6e6252'] },
    { id: 'lamp', name: 'Bulb light pool', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#8c7454', '#957c5a'], emissive: '#ffb648', hint: 'One bare bulb per room. Paint two cells.' },

    { id: 'plaster', name: 'Plaster wall', kind: 'wall', category: 'building', pattern: 'concrete', colors: ['#7d705d', '#8c7e69'], footprint: 'wall', height: FULL },
    { id: 'sash', name: 'Sash window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6b7f84', '#7a9096'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'wireglass' },
    { id: 'aptdoor', name: 'Apartment door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#8a6547', '#946f4f'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door', hint: 'Three locks, none of them good.' },
    { id: 'firedoor', name: 'Fire door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#8d5f4a', '#976850'], footprint: 'wall', height: FULL, placement: CUT, cut: 'maglock' },
    { id: 'partition', name: 'Stud partition', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#847660', '#92846c'], footprint: 'wall', height: FULL, hint: 'Thin enough to hear through, thick enough to stop a look.' },

    { id: 'bed', name: 'Bed', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7a6a5a', '#867666'], height: WAIST, prop: 'bed', placement: { againstWall: true } },
    { id: 'sofa', name: 'Sagging sofa', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7c5f4c', '#886a55'], height: WAIST, prop: 'sofa', placement: { againstWall: true } },
    { id: 'table', name: 'Kitchen table', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8b7351', '#987f5a'], height: WAIST, prop: 'table' },
    { id: 'chair', name: 'Kitchen chair', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#836c4d', '#8f7756'], footprint: 'post', height: WAIST, prop: 'chair' },
    { id: 'counter', name: 'Kitchen counter', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7f7461', '#8c806b'], height: WAIST, prop: 'counter', placement: { againstWall: true } },
    { id: 'stove', name: 'Cooker', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a756d', '#878278'], height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'fridge', name: 'Fridge', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8b877c', '#979387'], height: FULL, prop: 'fridge', placement: { againstWall: true } },
    { id: 'sink', name: 'Sink', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#84807a', '#918d86'], height: WAIST, prop: 'sink', placement: { againstWall: true } },
    { id: 'shelves', name: 'Bookshelf', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#7d6449', '#896f51'], height: FULL, prop: 'bookshelf', placement: { againstWall: true } },
    { id: 'trid', name: 'Trid set', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#5f6367', '#6b7074'], emissive: '#5fc8e0', height: WAIST, prop: 'tv', placement: { againstWall: true }, hint: 'Left on. Always left on.' },
    { id: 'lockers', name: 'Hall lockers', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a6f5d', '#877b67'], height: FULL, prop: 'locker', placement: { againstWall: true } },

    { id: 'plant', name: 'Dying plant', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#5d6146', '#696d50'], footprint: 'round', height: WAIST, prop: 'plant' },
    { id: 'bin', name: 'Kitchen bin', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6a5b', '#7b7665'], footprint: 'post', height: WAIST, prop: 'bin' },
    { id: 'boxes', name: 'Moving boxes', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#96794f', '#a08356'], height: WAIST, prop: 'crates', hint: 'Never unpacked.' },
    { id: 'mattress', name: 'Floor mattress', kind: 'feature', category: 'decoration', pattern: 'carpet', colors: ['#847767', '#918472'], prop: 'mattress', placement: { on: ['carpet', 'landing'] } },
    { id: 'laundry', name: 'Laundry pile', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#7d7368', '#8a8073'], footprint: 'round', height: WAIST, prop: 'trash' },
    { id: 'heater', name: 'Space heater', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#8a5b48', '#95654f'], emissive: '#ff8a3c', footprint: 'post', height: WAIST, prop: 'lantern', placement: { againstWall: true } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Street', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4a4238', '#584f44'] },
    { id: 'sidewalk', name: 'Sidewalk', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#7a6f5d', '#877b67'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8a7f6c', '#978b77'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Bare bulb', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6350', '#7d705b'], emissive: '#ffb648', footprint: 'post', prop: 'pendant', placement: { on: ['lino', 'carpet', 'kitchen', 'bathroom', 'landing', 'lamp'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

export const CONDO: Tileset = {
  id: 'condo',
  name: 'Condo tower',
  blurb: 'Pale floors, a doorman, a view. The client\'s flat, or the one the team is robbing.',
  tiles: [
    { id: 'stairup', name: 'Service stair up', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#8f8b84', '#99958e'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Service stair down', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#7a7b7f', '#85868a'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'lobbyfloor', name: 'Lobby marble', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'marble', colors: ['#a09a8f', '#a9a398'], sheen: '#e0ce87', hint: 'Somebody polishes this at 04:00.' },
    { id: 'hallcarpet', name: 'Corridor carpet', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#7c7d81', '#87888c'] },
    { id: 'oak', name: 'Engineered oak', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#978e82', '#a1988c'] },
    { id: 'bathtile', name: 'Bathroom stone', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#93938f', '#9d9d99'] },
    { id: 'balcony', name: 'Balcony deck', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#77787c', '#828387'], hint: 'Forty floors up. Rope work starts here.' },
    { id: 'downlight', name: 'Downlight pool', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#9a9488', '#a49e92'], emissive: '#e6d58a' },

    { id: 'drywall', name: 'Painted wall', kind: 'wall', category: 'building', pattern: 'solid', colors: ['#9d9990', '#a7a39a'], footprint: 'wall', height: FULL },
    { id: 'pane', name: 'Floor-to-ceiling glass', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#8a9498', '#949ea2'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'glass' },
    { id: 'unitdoor', name: 'Unit door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7e7f83', '#898a8e'], footprint: 'wall', height: FULL, placement: CUT, cut: 'maglock' },
    { id: 'balconyrail', name: 'Balcony railing', kind: 'feature', category: 'building', pattern: 'panel', colors: ['#767779', '#818284'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'railing' },
    { id: 'lobbydoor', name: 'Lobby doors', kind: 'door', category: 'building', pattern: 'panel', colors: ['#8f959a', '#999fa4'], footprint: 'wall', height: FULL, placement: CUT, cut: 'glassdoor' },

    { id: 'bed', name: 'Platform bed', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#928d85', '#9c978f'], height: WAIST, prop: 'bed', placement: { againstWall: true } },
    { id: 'sofa', name: 'Sectional sofa', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#8a8882', '#94928c'], height: WAIST, prop: 'sofa' },
    { id: 'dining', name: 'Dining table', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7d7e82', '#88898d'], height: WAIST, prop: 'table' },
    { id: 'chair', name: 'Dining chair', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#76777b', '#818286'], footprint: 'post', height: WAIST, prop: 'chair' },
    { id: 'island', name: 'Kitchen island', kind: 'feature', category: 'interior', pattern: 'marble', colors: ['#9a978f', '#a4a199'], height: WAIST, prop: 'counter' },
    { id: 'range', name: 'Induction range', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7b7c7e', '#868789'], height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'fridge', name: 'Smart fridge', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#929290', '#9c9c9a'], height: FULL, prop: 'fridge', placement: { againstWall: true } },
    { id: 'wallscreen', name: 'Wall screen', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6f7376', '#7a7e81'], emissive: '#5fc8e0', height: WAIST, prop: 'tv', placement: { againstWall: true } },
    { id: 'desk', name: 'Home office desk', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8d8a83', '#97948d'], height: WAIST, prop: 'desk', placement: { againstWall: true } },
    { id: 'reception', name: 'Concierge desk', kind: 'feature', category: 'interior', pattern: 'marble', colors: ['#9b968c', '#a5a096'], height: WAIST, prop: 'bar', placement: { againstWall: true }, hint: 'The doorman knows every face. That is the problem.' },
    { id: 'column', name: 'Lobby column', kind: 'feature', category: 'interior', pattern: 'marble', colors: ['#9f9b94', '#a8a49d'], footprint: 'post', height: FULL, prop: 'column' },
    { id: 'wardrobe', name: 'Wardrobe', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7f8084', '#8a8b8f'], height: FULL, prop: 'locker', placement: { againstWall: true } },

    { id: 'planter', name: 'Lobby planter', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8e8c86', '#98968f'], footprint: 'round', height: WAIST, prop: 'planter' },
    { id: 'plant', name: 'Fiddle-leaf fig', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#7d817a', '#888c85'], footprint: 'canopy', height: FULL, prop: 'plant' },
    { id: 'statue', name: 'Lobby sculpture', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8c8a85', '#96948f'], footprint: 'post', height: FULL, prop: 'statue' },
    { id: 'bin', name: 'Brushed-steel bin', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#858689', '#8f9093'], footprint: 'post', height: WAIST, prop: 'bin' },
    { id: 'lamp', name: 'Floor lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#918c83', '#9b968d'], emissive: '#e6d58a', footprint: 'post', height: FULL, prop: 'lamppost' },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Street', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4f4f52', '#5c5c60'] },
    { id: 'sidewalk', name: 'Sidewalk', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'tile', colors: ['#8e8a82', '#99958d'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#9c9992', '#a4a19a'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Pendant lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a857c', '#958f86'], emissive: '#e6d58a', footprint: 'post', prop: 'pendant', placement: { on: ['lobbyfloor', 'hallcarpet', 'oak', 'bathtile', 'downlight'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

export const CAFE: Tileset = {
  id: 'cafe',
  name: 'Corner café',
  blurb: 'Soy-caf, cracked leather booths, a menu board nobody reads. Where the meet happens when the Johnson is cheap.',
  tiles: [
    { id: 'stairup', name: 'Back stair up', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#7f6448', '#8c6f50'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar stair down', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#6b543c', '#775e44'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'boards', name: 'Worn floorboards', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#7e6448', '#8b6f50'] },
    { id: 'chequer', name: 'Chequer tile', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#726a5c', '#7f7666'], hint: 'Two colours, once.' },
    { id: 'kitchen', name: 'Kitchen tile', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#7b7462', '#88816e'] },
    { id: 'pavement', name: 'Pavement out front', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#766a5a', '#837665'] },
    { id: 'mat', name: 'Door mat', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#6f5a44', '#7b654c'] },
    { id: 'warmlight', name: 'Pendant light pool', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#8f7452', '#997c58'], emissive: '#ffb648' },

    { id: 'brick', name: 'Bare brick', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#7d5b48', '#8b6650'], footprint: 'wall', height: FULL },
    { id: 'front', name: 'Café window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6f8286', '#7e9398'], emissive: '#dccb6e', footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'shopwindow' },
    { id: 'frontdoor', name: 'Bell door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#8a6a4c', '#957454'], footprint: 'wall', height: FULL, placement: CUT, cut: 'glassdoor' },
    { id: 'hatch', name: 'Kitchen hatch', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#8a7c62', '#97896c'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'serving' },
    { id: 'backdoor', name: 'Alley door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7a6b58', '#867661'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },

    { id: 'counter', name: 'Service counter', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#846648', '#907050'], height: WAIST, prop: 'bar', placement: { againstWall: true } },
    { id: 'espresso', name: 'Espresso machine', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7b6f66', '#877a70'], emissive: '#ffb648', height: WAIST, prop: 'vending', placement: { againstWall: true }, hint: 'Hisses. Everyone waits for it.' },
    { id: 'booth', name: 'Leather booth', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7a4f3f', '#865846'], height: WAIST, prop: 'booth', placement: { againstWall: true } },
    { id: 'table', name: 'Café table', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8a6d4d', '#957756'], height: WAIST, prop: 'cocktail' },
    { id: 'chair', name: 'Bentwood chair', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#7f6246', '#8b6c4e'], footprint: 'post', height: WAIST, prop: 'chair' },
    { id: 'stool', name: 'Counter stool', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7a5844', '#86614b'], footprint: 'post', height: WAIST, prop: 'stool' },
    { id: 'pastry', name: 'Pastry case', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8a8072', '#968c7c'], emissive: '#e6d58a', height: WAIST, prop: 'vending', placement: { againstWall: true } },
    { id: 'range', name: 'Flat-top grill', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#77706a', '#837c75'], height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'fridge', name: 'Drinks fridge', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7f8280', '#8b8e8c'], height: FULL, prop: 'fridge', placement: { againstWall: true } },
    { id: 'sink', name: 'Wash-up sink', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#84807a', '#918d86'], height: WAIST, prop: 'sink', placement: { againstWall: true } },

    { id: 'menu', name: 'Menu board', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5f5346', '#6b5e50'], footprint: 'post', height: FULL, prop: 'menu', placement: { againstWall: true } },
    { id: 'umbrella', name: 'Pavement umbrella', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8d5f45', '#97684c'], footprint: 'canopy', height: FULL, prop: 'umbrella', placement: { on: ['pavement'] } },
    { id: 'planter', name: 'Herb planter', kind: 'feature', category: 'decoration', pattern: 'dirt', colors: ['#7f6b52', '#8b765a'], footprint: 'round', height: WAIST, prop: 'planter', placement: { on: ['pavement'] } },
    { id: 'bin', name: 'Bus tub', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6d6a60', '#79766a'], footprint: 'post', height: WAIST, prop: 'bin' },
    { id: 'bike', name: 'Delivery bike', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6e6558', '#7a7062'], height: WAIST, prop: 'bike', placement: { on: ['pavement'] } },
    { id: 'plant', name: 'Window plant', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#5f6a49', '#6b7653'], footprint: 'round', height: WAIST, prop: 'plant' },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Street', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4d443a', '#5a5045'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#877b69', '#948775'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Pendant lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7e6448', '#8b6f50'], emissive: '#ffb648', footprint: 'post', prop: 'pendant', placement: { on: ['boards', 'chequer', 'kitchen', 'mat', 'warmlight'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

export const RESTAURANT: Tileset = {
  id: 'restaurant',
  name: 'Fine dining',
  blurb: 'White linen, low light, a maître d\' who remembers you. The meet with the Johnson who can afford it.',
  tiles: [
    { id: 'stairup', name: 'Mezzanine stair up', kind: 'feature', category: 'stairs', pattern: 'carpet', colors: ['#8c8983', '#96938d'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar stair down', kind: 'feature', category: 'stairs', pattern: 'tile', colors: ['#6f7074', '#7a7b7f'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'marble', name: 'Marble floor', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'marble', colors: ['#96938c', '#a09d96'], sheen: '#e0ce87' },
    { id: 'dining', name: 'Dining-room carpet', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#6e6f73', '#797a7e'] },
    { id: 'parquet', name: 'Parquet', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#8d8478', '#978e82'] },
    { id: 'kitchen', name: 'Kitchen tile', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#8c8c88', '#969692'] },
    { id: 'terrace', name: 'Terrace stone', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'tile', colors: ['#8a8780', '#94918a'] },
    { id: 'candle', name: 'Candlelight pool', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'carpet', colors: ['#8f8a82', '#99948c'], emissive: '#ffb648', hint: 'Paint one cell per table.' },

    { id: 'panelling', name: 'Wood panelling', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#67686c', '#727377'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Picture window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#84898c', '#8e9396'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'glass' },
    { id: 'frontdoor', name: 'Brass-handled door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7a7b7f', '#85868a'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },
    { id: 'swing', name: 'Kitchen swing door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#85868a', '#8f9094'], footprint: 'wall', height: FULL, placement: CUT, cut: 'porthole' },
    { id: 'screen', name: 'Privacy screen', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#7b7c80', '#86878b'], footprint: 'wall', height: FULL, blocksSight: true, hint: 'The booth the Johnson asks for.' },

    { id: 'table', name: 'Linen table', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#9b9891', '#a5a29b'], height: WAIST, prop: 'table' },
    { id: 'round', name: 'Round table', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#98958e', '#a29f98'], height: WAIST, prop: 'cocktail' },
    { id: 'chair', name: 'Upholstered chair', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#717276', '#7c7d81'], footprint: 'post', height: WAIST, prop: 'chair' },
    { id: 'booth', name: 'Velvet booth', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#6e6e72', '#79797d'], height: WAIST, prop: 'booth', placement: { againstWall: true } },
    { id: 'bar', name: 'Marble bar', kind: 'feature', category: 'interior', pattern: 'marble', colors: ['#908d86', '#9a978f'], height: WAIST, prop: 'bar', placement: { againstWall: true } },
    { id: 'host', name: 'Host stand', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#747578', '#7f8083'], footprint: 'post', height: WAIST, prop: 'terminal' },
    { id: 'winerack', name: 'Wine wall', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6a6a6e', '#757579'], height: FULL, prop: 'bookshelf', placement: { againstWall: true } },
    { id: 'pass', name: 'Kitchen pass', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#918f88', '#9b9992'], height: WAIST, prop: 'counter', placement: { againstWall: true } },
    { id: 'range', name: 'Range', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7d7e80', '#88898b'], height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'walkin', name: 'Walk-in fridge', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8c8c89', '#969693'], height: FULL, prop: 'fridge', placement: { againstWall: true } },
    { id: 'column', name: 'Fluted column', kind: 'feature', category: 'interior', pattern: 'marble', colors: ['#97948c', '#a19e96'], footprint: 'post', height: FULL, prop: 'column' },

    { id: 'chandelier', name: 'Chandelier', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a857c', '#958f86'], emissive: '#e6d58a', footprint: 'post', height: FULL, prop: 'chandelier', hint: 'Hangs over the room; the pool is on the floor beneath it.' },
    { id: 'sculpture', name: 'Bronze', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7f7b74', '#89857e'], footprint: 'post', height: FULL, prop: 'statue' },
    { id: 'palm', name: 'Potted palm', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#797c74', '#84877f'], footprint: 'canopy', height: FULL, prop: 'plant' },
    { id: 'planter', name: 'Terrace planter', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#87847d', '#928f88'], footprint: 'round', height: WAIST, prop: 'planter', placement: { on: ['terrace'] } },
    { id: 'umbrella', name: 'Terrace umbrella', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8e8b85', '#99968f'], footprint: 'canopy', height: FULL, prop: 'umbrella', placement: { on: ['terrace'] } },
    { id: 'lamp', name: 'Terrace lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7b7770', '#86827b'], emissive: '#ffb648', footprint: 'post', height: FULL, prop: 'lamppost', placement: { on: ['terrace'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Street', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4e4b46', '#5b5853'] },
    { id: 'sidewalk', name: 'Sidewalk', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'tile', colors: ['#86837c', '#908d86'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#9a978f', '#a4a199'], hint: 'A one-square row between the street and the sidewalk.' },
  ],
};

export const TAKEOUT: Tileset = {
  id: 'takeout',
  name: 'Noodle counter',
  blurb: 'Steam, grease and a sign that buzzes. Six stools, one cook, and the best place in the district to be forgotten.',
  tiles: [
    { id: 'stairup', name: 'Flat above, stair up', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#7a6a55', '#87765f'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Store below, stair down', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#675a48', '#736450'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'greasetile', name: 'Grease-dulled tile', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#77694f', '#847559'] },
    { id: 'kitchenfloor', name: 'Kitchen tread plate', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'hatch', colors: ['#6c6252', '#786d5c'] },
    { id: 'pavement', name: 'Wet pavement', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#5d5348', '#6a5f52'], sheen: '#ff8a3c' },
    { id: 'alley', name: 'Back alley', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4f4840', '#5c544b'] },
    { id: 'signspill', name: 'Sign spill', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8a5f48', '#95684f'], emissive: '#ff5a3c', hint: 'The red of the sign on the pavement. Two cells.' },

    { id: 'tin', name: 'Tin-clad wall', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#786a55', '#85765f'], footprint: 'wall', height: FULL },
    { id: 'servingwindow', name: 'Serving window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#8a7a5c', '#978766'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'serving' },
    { id: 'sidedoor', name: 'Side door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#7f6a52', '#8b755a'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },
    { id: 'shutter', name: 'Night shutter', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#8a6d4f', '#967757'], footprint: 'wall', height: FULL, placement: CUT, cut: 'shutter' },
    { id: 'sign', name: 'Buzzing sign', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6f5c4c', '#7c6754'], emissive: '#ff5a3c', footprint: 'wall', height: FULL, placement: CUT, cut: 'sign' },

    { id: 'counter', name: 'Serving counter', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#87775a', '#948363'], height: WAIST, prop: 'bar' },
    { id: 'stool', name: 'Bolted stool', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7c5d47', '#88664e'], footprint: 'post', height: WAIST, prop: 'stool' },
    { id: 'wok', name: 'Wok range', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6f6a62', '#7b766d'], emissive: '#ffb648', height: WAIST, prop: 'stove', placement: { againstWall: true }, hint: 'The one thing here that is always hot.' },
    { id: 'fryer', name: 'Fryer', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a756c', '#868177'], height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'fridge', name: 'Upright fridge', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#80827f', '#8c8e8b'], height: FULL, prop: 'fridge', placement: { againstWall: true } },
    { id: 'prep', name: 'Prep bench', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8b8a84', '#96958f'], height: WAIST, prop: 'counter', placement: { againstWall: true } },
    { id: 'sink', name: 'Double sink', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#83817b', '#908e88'], height: WAIST, prop: 'sink', placement: { againstWall: true } },
    { id: 'vending', name: 'Drinks machine', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6f6a5f', '#7b7669'], height: FULL, prop: 'vending', placement: { againstWall: true } },
    { id: 'shelfrack', name: 'Dry-goods rack', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a6c52', '#87775b'], height: FULL, prop: 'bookshelf', placement: { againstWall: true } },

    { id: 'menu', name: 'Menu board', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5c5044', '#68594c'], footprint: 'post', height: FULL, prop: 'menu', placement: { againstWall: true } },
    { id: 'crates', name: 'Produce crates', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#93774d', '#9e8154'], height: WAIST, prop: 'crates' },
    { id: 'bins', name: 'Grease bins', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5f5a48', '#6b6551'], footprint: 'round', height: WAIST, prop: 'barrel', placement: { on: ['alley', 'pavement'] } },
    { id: 'dumpster', name: 'Alley dumpster', kind: 'feature', category: 'decoration', pattern: 'panel', colors: ['#5f6a3e', '#6c7847'], height: WAIST, prop: 'dumpster', placement: { on: ['alley'] } },
    { id: 'bike', name: 'Delivery scooter', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a5a45', '#96634c'], height: WAIST, prop: 'bike', placement: { on: ['pavement', 'alley'] } },
    { id: 'gaslamp', name: 'Gas bottles', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7d7461', '#89806b'], footprint: 'round', height: WAIST, prop: 'barrel', placement: { on: ['alley'] } },
    { id: 'lantern', name: 'Paper lantern', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8d5c47', '#98654e'], emissive: '#ffb648', footprint: 'post', height: FULL, prop: 'lantern' },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Street', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#433d36', '#504941'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#71665a', '#7e7266'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Strip light', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#77694f', '#847559'], emissive: '#ffb648', footprint: 'post', prop: 'pendant', placement: { on: ['greasetile', 'kitchenfloor'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

export const PLAZA: Tileset = {
  id: 'plaza',
  name: 'Civic plaza',
  blurb: 'Setts, a fountain, a statue of someone the corp bought. Crowds by day, one patrol by night.',
  tiles: [
    { id: 'stairup', name: 'Plaza steps up', kind: 'feature', category: 'stairs', pattern: 'cobble', colors: ['#7f735f', '#8c7f69'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Metro steps down', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#6a6052', '#77695a'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'setts', name: 'Granite setts', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'cobble', colors: ['#766c5c', '#837866'], shore: 'quay' },
    { id: 'paving', name: 'Paving slabs', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'tile', colors: ['#82796a', '#8f8574'], shore: 'quay' },
    { id: 'lawn', name: 'Clipped lawn', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'grass', colors: ['#5c6a42', '#68774b'] },
    { id: 'basin', name: 'Fountain basin', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#4a6064', '#576f74'], liquid: 'shallow', hint: 'Knee-deep. Reflects the lamps.' },
    { id: 'road', name: 'Plaza road', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#52493f', '#5f554a'], shore: 'quay' },
    { id: 'lamppool', name: 'Lamp pool', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'cobble', colors: ['#8f7d5e', '#9a8766'], emissive: '#ffb648', shore: 'quay' },

    { id: 'facade', name: 'Civic facade', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#7f7263', '#8c7f6e'], footprint: 'wall', height: FULL },
    { id: 'glazing', name: 'Ground-floor glazing', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#7c8b8f', '#8a999d'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'shopwindow' },
    { id: 'entrance', name: 'Revolving door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#8a9094', '#94999d'], footprint: 'wall', height: FULL, placement: CUT, cut: 'glassdoor' },
    { id: 'balustrade', name: 'Stone balustrade', kind: 'feature', category: 'building', pattern: 'tile', colors: ['#8b8171', '#978d7c'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'railing' },
    { id: 'hoarding', name: 'Ad hoarding', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6f6557', '#7c7160'], emissive: '#dccb6e', footprint: 'wall', height: FULL, placement: CUT, cut: 'sign' },

    { id: 'bench', name: 'Public bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#846a4c', '#907454'], height: WAIST, prop: 'bench' },
    { id: 'kiosk', name: 'Coffee kiosk', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7f6c55', '#8c775e'], height: FULL, prop: 'vending', hint: 'Sells caf, sees everything.' },
    { id: 'planterbox', name: 'Planter box', kind: 'feature', category: 'interior', pattern: 'concrete', colors: ['#7d7263', '#8a7e6e'], height: WAIST, prop: 'planter' },
    { id: 'hedge', name: 'Box hedge', kind: 'feature', category: 'interior', pattern: 'grass', colors: ['#4f5d3c', '#5a6944'], height: WAIST, prop: 'hedge', blocksSight: false },
    { id: 'jersey', name: 'Security barrier', kind: 'feature', category: 'interior', pattern: 'concrete', colors: ['#7e7466', '#8b8171'], footprint: 'wall', height: WAIST },
    { id: 'car', name: 'Parked sedan', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#6b6258', '#776d62'], height: WAIST, prop: 'car', placement: { on: ['road'] } },
    { id: 'pillar', name: 'Colonnade pillar', kind: 'feature', category: 'interior', pattern: 'tile', colors: ['#8a8072', '#968c7d'], footprint: 'post', height: FULL, prop: 'column' },

    { id: 'fountain', name: 'Fountain', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#5f7276', '#6c8085'], emissive: '#e0ce87', footprint: 'round', height: WAIST, prop: 'fountain', placement: { on: ['basin', 'setts'] } },
    { id: 'statue', name: 'Founder\'s statue', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6a5c', '#7c7666'], footprint: 'post', height: FULL, prop: 'statue' },
    { id: 'tree', name: 'Plane tree', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#5f6e4a', '#6b7b53'], footprint: 'canopy', height: FULL, prop: 'tree', placement: { on: ['lawn', 'setts'] } },
    { id: 'lamppost', name: 'Plaza lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6659', '#7c7264'], emissive: '#ffb648', footprint: 'post', height: FULL, prop: 'lamppost' },
    { id: 'bollard', name: 'Bollard', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7a6b55', '#87775e'], footprint: 'post', height: WAIST, prop: 'bollard' },
    { id: 'bin', name: 'Litter bin', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#66604f', '#726b58'], footprint: 'post', height: WAIST, prop: 'bin' },
    { id: 'flag', name: 'Flagpole', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a4f42', '#955748'], footprint: 'post', height: FULL, prop: 'flag' },
    { id: 'bikes', name: 'Bike rack', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6c6459', '#786f63'], height: WAIST, prop: 'bike', placement: { on: ['paving', 'setts'] } },
    { id: 'drain', name: 'Drain', kind: 'feature', category: 'decoration', pattern: 'grating', colors: ['#564d42', '#635a4e'], placement: { on: ['setts', 'road'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8d8474', '#9a9080'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Kiosk lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#766c5c', '#837866'], emissive: '#ffb648', footprint: 'post', prop: 'pendant', placement: { on: ['paving'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
    { id: 'kioskfloor', name: 'Kiosk floor', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'tile', colors: ['#7d7466', '#8a8172'], hint: 'Inside the kiosks and the shops around the square.' },
  ],
};

export const PARK: Tileset = {
  id: 'park',
  name: 'City park',
  blurb: 'Grass that survives the rain, a pond, a bandstand nobody plays. Meets in daylight and bodies at night.',
  tiles: [
    { id: 'stairup', name: 'Bandstand steps up', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#7f6a4c', '#8b7554'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Underpass steps down', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#6a6052', '#77695a'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'grass', name: 'Park grass', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'grass', colors: ['#5b6a42', '#67774b'] },
    { id: 'path', name: 'Gravel path', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#7f7461', '#8c806b'] },
    { id: 'dirt', name: 'Worn earth', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'dirt', colors: ['#6f5f48', '#7c6a51'] },
    { id: 'pond', name: 'Pond', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#465c5c', '#536b6c'], liquid: 'deep', hint: 'Deeper than it looks, and the bottom is soft.' },
    { id: 'reeds', name: 'Pond margin', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'reeds', colors: ['#5a6a4a', '#667753'], liquid: 'shallow' },
    { id: 'deck', name: 'Bandstand deck', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#83694a', '#8f7352'], shore: 'pier' },
    { id: 'lamppool', name: 'Path lamp pool', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#907d5e', '#9b8766'], emissive: '#ffb648' },
    { id: 'pierwall', name: 'Pier wall', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#7a6448', '#866e50'], shore: 'pier', hint: 'A boardwalk over the pond: paint it along the water and it stands on posts, with a timber wall down to the surface.' },
    { id: 'beach', name: 'Beach front', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'sand', colors: ['#8a7c62', '#97886c'], shore: 'beach', hint: 'Sand running under the water where the ducks get fed. Wet at the edge, a line of foam.' },
    { id: 'shallows', name: 'Shallow water', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#4f6560', '#5c736d'], liquid: 'shallow', hint: 'Ankle-deep over mud. Paint it round the pond and the bottom shows through.' },

    { id: 'railings', name: 'Park railings', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#5f5a4b', '#6b6554'], footprint: 'wall', height: FULL, blocksSight: false, cut: 'railing', placement: CUT },
    { id: 'gate', name: 'Park gate', kind: 'door', category: 'building', pattern: 'panel', colors: ['#6a6353', '#76705c'], footprint: 'wall', height: FULL, placement: CUT, cut: 'gap' },
    { id: 'shelter', name: 'Shelter wall', kind: 'wall', category: 'building', pattern: 'brick', colors: ['#7a6656', '#87715f'], footprint: 'wall', height: FULL },
    { id: 'picket', name: 'Picket fence', kind: 'feature', category: 'building', pattern: 'planks', colors: ['#8a7a5c', '#978766'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'picket' },
    { id: 'lodgedoor', name: 'Lodge door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#826548', '#8e6f50'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },

    { id: 'bench', name: 'Park bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#846a4c', '#907454'], height: WAIST, prop: 'bench', placement: { on: ['path', 'grass'] } },
    { id: 'picnic', name: 'Picnic table', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8a7050', '#967a58'], height: WAIST, prop: 'picnic', placement: { on: ['grass'] } },
    { id: 'hedge', name: 'Hedge', kind: 'feature', category: 'interior', pattern: 'grass', colors: ['#4d5c3a', '#586842'], height: WAIST, prop: 'hedge', blocksSight: false },
    { id: 'swing', name: 'Swings', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7b6b56', '#87765f'], height: FULL, prop: 'swing', blocksSight: false, placement: { on: ['dirt', 'grass'] } },
    { id: 'kiosk', name: 'Ice-cream kiosk', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8b7458', '#977f60'], height: FULL, prop: 'vending', placement: { on: ['path'] } },
    { id: 'statue', name: 'Memorial', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#726c5e', '#7f7868'], footprint: 'post', height: FULL, prop: 'statue' },

    { id: 'tree', name: 'Oak', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#5c6c46', '#68794f'], footprint: 'canopy', height: FULL, prop: 'tree', placement: { on: ['grass', 'dirt'] } },
    { id: 'birch', name: 'Birch', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#6a7a4e', '#768857'], footprint: 'canopy', height: FULL, prop: 'tree', placement: { on: ['grass'] } },
    { id: 'bush', name: 'Rhododendron', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#54633f', '#606f47'], footprint: 'round', height: WAIST, prop: 'bush', placement: { on: ['grass', 'dirt'] } },
    { id: 'rocks', name: 'Boulders', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#77705f', '#847c6a'], footprint: 'round', height: WAIST, prop: 'rocks', placement: { on: ['grass', 'dirt', 'reeds'] } },
    { id: 'lamppost', name: 'Path lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6a6254', '#76705f'], emissive: '#e6d58a', footprint: 'post', height: FULL, prop: 'lamppost', placement: { on: ['path'] } },
    { id: 'bin', name: 'Park bin', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5f6549', '#6b7152'], footprint: 'post', height: WAIST, prop: 'bin', placement: { on: ['path'] } },
    { id: 'signpost', name: 'Signpost', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#7f6a4c', '#8b7554'], footprint: 'post', height: FULL, prop: 'signpost', placement: { on: ['path', 'grass'] } },
    { id: 'firepit', name: 'Squatters\' fire', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#6e6250', '#7b6e59'], emissive: '#ff8a3c', footprint: 'round', height: WAIST, prop: 'firepit', placement: { on: ['dirt'] } },
    { id: 'bbq', name: 'Public barbecue', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5d574f', '#69625a'], footprint: 'round', height: WAIST, prop: 'grill', placement: { on: ['grass', 'dirt'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Park road', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4f4a40', '#5c564b'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8a8272', '#978e7d'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Pavilion lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6a6254', '#76705f'], emissive: '#e6d58a', footprint: 'post', prop: 'pendant', placement: { on: ['deck'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
    { id: 'pavilion', name: 'Pavilion floor', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', shore: 'pier', colors: ['#7f664a', '#8b7052'], hint: 'Inside the pavilion, the café, the keeper\'s hut.' },
  ],
};

export const MARINA: Tileset = {
  id: 'marina',
  name: 'Marina & piers',
  blurb: 'Boards over black water, a boathouse, rigging that never stops ticking. Smuggling with a view.',
  tiles: [
    { id: 'stairup', name: 'Gangway up', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#8a7455', '#96805e'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Ladder down', kind: 'feature', category: 'stairs', pattern: 'grating', colors: ['#74654d', '#807056'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'planking', name: 'Pier planking', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#7f6a4e', '#8b7556'], shore: 'pier' },
    { id: 'wetplank', name: 'Wet planking', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#5f5340', '#6a5d48'], sheen: '#ffb648', shore: 'pier', hint: 'Slick. The ruler does not care, but you might.' },
    { id: 'quay', name: 'Concrete quay', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#7a7060', '#877c6b'], shore: 'quay', hint: 'Along the water it drops as a coursed wall with a pale coping.' },
    { id: 'harbour', name: 'Harbour water', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#3e5559', '#4a6368'], liquid: 'deep', hint: 'Cold and deep. Swimming is a test.' },
    { id: 'shallows', name: 'Shallows', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#4f6466', '#5c7274'], liquid: 'shallow' },
    { id: 'slipway', name: 'Slipway', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#6a6759', '#777463'], shore: 'beach', hint: 'A ramp that runs under the water — no wall, so a boat comes straight up it.' },
    { id: 'docklamp', name: 'Dock lamp pool', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#907a58', '#9b8460'], emissive: '#ffb648', shore: 'pier' },
    { id: 'pierwall', name: 'Pier wall', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#6f5c43', '#7b674b'], shore: 'pier', hint: 'The deck edge over the harbour: a timber wall on pilings, a capping beam. Paint it where the boards meet the water.' },
    { id: 'beach', name: 'Beach front', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'sand', colors: ['#7d715c', '#8a7d66'], shore: 'beach', hint: 'Shingle running down under the water. Boats come up here; so does everything the tide brings.' },

    { id: 'shiplap', name: 'Boathouse wall', kind: 'wall', category: 'building', pattern: 'planks', colors: ['#7a6248', '#866c50'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Boathouse window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6a7f84', '#799096'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'wireglass' },
    { id: 'boatdoor', name: 'Boathouse door', kind: 'door', category: 'building', pattern: 'panel', colors: ['#8c6b4a', '#987552'], footprint: 'wall', height: FULL, placement: CUT, cut: 'roller' },
    { id: 'railing', name: 'Pier railing', kind: 'feature', category: 'building', pattern: 'panel', colors: ['#6e6452', '#7b705c'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'railing' },
    { id: 'chainlink', name: 'Yard fence', kind: 'wall', category: 'building', pattern: 'grating', colors: ['#867f68', '#948c74'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'mesh' },

    { id: 'boat', name: 'Cabin cruiser', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#8f8776', '#9b9382'], height: WAIST, prop: 'boat', placement: { on: ['harbour', 'shallows'] } },
    { id: 'skiff', name: 'Skiff', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#7f6a4c', '#8b7554'], height: WAIST, prop: 'canoe', placement: { on: ['harbour', 'shallows', 'slipway', 'beach'] } },
    { id: 'crates', name: 'Cargo crates', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#95784c', '#a08253'], height: WAIST, prop: 'crates' },
    { id: 'fuelpump', name: 'Fuel pump', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#8a5a47', '#96634e'], footprint: 'post', height: WAIST, prop: 'pump' },
    { id: 'winch', name: 'Winch', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7b6f5a', '#877a63'], footprint: 'round', height: WAIST, prop: 'spool' },
    { id: 'bench', name: 'Pier bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#82694b', '#8e7353'], height: WAIST, prop: 'bench', placement: { on: ['planking', 'quay'] } },
    { id: 'container', name: 'Reefer container', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6e6b5a', '#7b7763'], height: FULL, prop: 'container', placement: { on: ['quay'] } },
    { id: 'shed', name: 'Bait shed', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#7c6548', '#886f50'], height: FULL, prop: 'locker', placement: { againstWall: true } },

    { id: 'cleat', name: 'Mooring cleat', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6759', '#7c7363'], placement: { on: ['planking', 'quay'] }, prop: 'cleat' },
    { id: 'buoy', name: 'Channel buoy', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8d4f42', '#985749'], emissive: '#ff5a3c', footprint: 'post', height: WAIST, prop: 'buoy', placement: { on: ['harbour'] } },
    { id: 'barrel', name: 'Fuel drum', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8c6a45', '#97734c'], footprint: 'round', height: WAIST, prop: 'barrel' },
    { id: 'nets', name: 'Heaped nets', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#6d6a54', '#79765d'], footprint: 'round', height: WAIST, prop: 'heap', placement: { on: ['planking', 'quay'] } },
    { id: 'bollard', name: 'Iron bollard', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#5e584c', '#6a6455'], footprint: 'post', height: WAIST, prop: 'bollard', placement: { on: ['quay'] } },
    { id: 'lamppost', name: 'Dock lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6759', '#7c7363'], emissive: '#ffb648', footprint: 'post', height: FULL, prop: 'lamppost', placement: { on: ['planking', 'quay'] } },
    { id: 'lifering', name: 'Life ring post', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8b5646', '#96604d'], footprint: 'post', height: WAIST, prop: 'signpost', placement: { on: ['planking'] } },
    { id: 'puddle', name: 'Spray puddle', kind: 'feature', category: 'decoration', pattern: 'water', colors: ['#5a5b52', '#66675c'], placement: { on: ['quay', 'planking'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Harbour road', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4a4640', '#57524b'] },
    { id: 'sidewalk', name: 'Promenade', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'tile', colors: ['#857b6a', '#918674'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#958b7a', '#a09585'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Cabin lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7f6a4e', '#8b7556'], emissive: '#ffb648', footprint: 'post', prop: 'pendant', placement: { on: ['planking', 'docklamp'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
    { id: 'boathouse', name: 'Boathouse floor', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', shore: 'pier', colors: ['#7a6448', '#866e50'], hint: 'Inside the boathouse and the harbour office.' },
  ],
};

export const COUNTRYSIDE: Tileset = {
  id: 'countryside',
  name: 'Countryside',
  blurb: 'A farm the sprawl forgot: fields, a barn, a track that turns to mud. Where the team goes to ground.',
  tiles: [
    { id: 'stairup', name: 'Hayloft ladder up', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#8a7250', '#967d58'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Cellar steps down', kind: 'feature', category: 'stairs', pattern: 'concrete', colors: ['#6f6353', '#7c6f5c'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'meadow', name: 'Meadow', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'grass', colors: ['#66713f', '#727f48'] },
    { id: 'crops', name: 'Crop rows', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'field', colors: ['#6c5f42', '#78694a'] },
    { id: 'track', name: 'Dirt track', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'dirt', colors: ['#74624a', '#816d52'] },
    { id: 'yard', name: 'Farmyard gravel', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#7f7463', '#8c806e'] },
    { id: 'barnfloor', name: 'Barn boards', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#7b6446', '#876e4e'] },
    { id: 'pond', name: 'Farm pond', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#4c5f56', '#586d63'], liquid: 'deep' },
    { id: 'porchlight', name: 'Porch light pool', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#907a57', '#9b845f'], emissive: '#e6d58a' },

    { id: 'barnwall', name: 'Barn boards wall', kind: 'wall', category: 'building', pattern: 'planks', colors: ['#7e5f45', '#8a694c'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Farmhouse window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6f8286', '#7e9398'], emissive: '#ffb648', footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'wireglass' },
    { id: 'barndoor', name: 'Barn door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#8d6a4a', '#997452'], footprint: 'wall', height: FULL, placement: CUT, cut: 'roller' },
    { id: 'picket', name: 'Post-and-rail fence', kind: 'feature', category: 'building', pattern: 'planks', colors: ['#85735a', '#927e63'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'picket' },
    { id: 'housedoor', name: 'Farmhouse door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#7f6448', '#8b6e50'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },
    { id: 'stone', name: 'Dry-stone wall', kind: 'feature', category: 'building', pattern: 'rubble', colors: ['#7b7364', '#88806f'], footprint: 'wall', height: WAIST },

    { id: 'tractor', name: 'Tractor', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#8a5f42', '#966849'], height: WAIST, prop: 'tractor', placement: { on: ['yard', 'track', 'crops'] } },
    { id: 'haybale', name: 'Hay bale', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#9a8352', '#a48c58'], height: WAIST, prop: 'haybale' },
    { id: 'trough', name: 'Water trough', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#77705f', '#847c69'], height: WAIST, prop: 'trough', placement: { on: ['yard', 'meadow'] } },
    { id: 'well', name: 'Well', kind: 'feature', category: 'interior', pattern: 'rubble', colors: ['#7c7361', '#89806b'], footprint: 'round', height: WAIST, prop: 'well' },
    { id: 'generator', name: 'Diesel generator', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#7a5f41', '#8a6c4a'], height: WAIST, prop: 'generator' },
    { id: 'tank', name: 'Water tank', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#6f6a5a', '#7c7663'], footprint: 'round', height: FULL, prop: 'tank' },
    { id: 'table', name: 'Farmhouse table', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8b7351', '#97805a'], height: WAIST, prop: 'table' },
    { id: 'bed', name: 'Iron bed', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7f7466', '#8b8071'], height: WAIST, prop: 'bed', placement: { againstWall: true } },
    { id: 'stove', name: 'Wood stove', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#5f5750', '#6b635b'], emissive: '#ff8a3c', height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'pickup', name: 'Pickup truck', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#7a6656', '#87715f'], height: WAIST, prop: 'van', placement: { on: ['yard', 'track'] } },

    { id: 'oak', name: 'Field oak', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#5e6c45', '#6a794e'], footprint: 'canopy', height: FULL, prop: 'tree', placement: { on: ['meadow', 'track'] } },
    { id: 'bush', name: 'Bramble', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#56643f', '#627047'], footprint: 'round', height: WAIST, prop: 'bush', placement: { on: ['meadow'] } },
    { id: 'logs', name: 'Log pile', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#836a4c', '#8f7454'], height: WAIST, prop: 'logs', placement: { on: ['yard', 'meadow'] } },
    { id: 'rocks', name: 'Field stones', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#7a7263', '#877f6e'], footprint: 'round', height: WAIST, prop: 'rocks', placement: { on: ['meadow', 'crops'] } },
    { id: 'firepit', name: 'Campfire', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#6e6250', '#7b6e59'], emissive: '#ff8a3c', footprint: 'round', height: WAIST, prop: 'firepit', placement: { on: ['meadow', 'yard'] } },
    { id: 'signpost', name: 'Fingerpost', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#7f6a4c', '#8b7554'], footprint: 'post', height: FULL, prop: 'signpost', placement: { on: ['track'] } },
    { id: 'barrel', name: 'Rain barrel', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#7d6749', '#897151'], footprint: 'round', height: WAIST, prop: 'barrel' },
    { id: 'scarecrow', name: 'Scarecrow', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a7658', '#968161'], footprint: 'post', height: FULL, prop: 'statue', placement: { on: ['crops'] } },
    { id: 'wreck', name: 'Rusting harvester', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8a5f45', '#96684c'], height: WAIST, prop: 'wreck', placement: { on: ['meadow', 'yard'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Country road', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4c463d', '#59524a'] },
    { id: 'sidewalk', name: 'Footpath', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#807561', '#8d816c'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8f8573', '#9c917e'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Farmhouse lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7b6446', '#876e4e'], emissive: '#e6d58a', footprint: 'post', prop: 'pendant', placement: { on: ['barnfloor', 'porchlight'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

export const LAKE: Tileset = {
  id: 'lake',
  name: 'Out on the lake',
  blurb: 'Still water, a jetty, a cabin with one lamp lit. The exchange nobody else can reach without a boat.',
  tiles: [
    { id: 'stairup', name: 'Cabin loft up', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#8a7252', '#967d5a'], footprint: 'stair', height: WAIST, connects: 'up' },
    { id: 'stairdown', name: 'Jetty ladder down', kind: 'feature', category: 'stairs', pattern: 'planks', colors: ['#71603f', '#7d6a47'], footprint: 'stair', height: WAIST, connects: 'down' },
    { id: 'shore', name: 'Shingle shore', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'sand', colors: ['#847660', '#91826a'], shore: 'beach' },
    { id: 'jetty', name: 'Jetty boards', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#7f6a4e', '#8b7556'], shore: 'pier' },
    { id: 'cabinfloor', name: 'Cabin boards', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#846b4a', '#907552'], shore: 'pier' },
    { id: 'deep', name: 'Deep water', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#364e55', '#425c63'], liquid: 'deep', hint: 'Black at night. Anything dropped here is gone.' },
    { id: 'shallow', name: 'Shallows', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'water', colors: ['#4d6266', '#5a7074'], liquid: 'shallow' },
    { id: 'reeds', name: 'Reed bed', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'reeds', colors: ['#5a6748', '#667551'], liquid: 'shallow', hint: 'Cover for a boat, and for whoever is waiting in one.' },
    { id: 'pine', name: 'Pine needles', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'dirt', colors: ['#6a5a45', '#77664d'] },
    { id: 'lamppool', name: 'Lantern pool', kind: 'floor', category: 'ground', setting: 'inside', pattern: 'planks', colors: ['#917a56', '#9c845e'], emissive: '#e6d58a', shore: 'pier' },
    { id: 'pierwall', name: 'Pier wall', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'planks', colors: ['#766347', '#826d4f'], shore: 'pier', hint: 'Where the jetty meets the lake: boards down to the water on round posts.' },
    { id: 'beach', name: 'Beach front', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'sand', colors: ['#8b7d63', '#98896d'], shore: 'beach', hint: 'Pale sand under the shallows. The only way a boat lands quietly.' },

    { id: 'logwall', name: 'Log wall', kind: 'wall', category: 'building', pattern: 'planks', colors: ['#7a5f45', '#86694c'], footprint: 'wall', height: FULL },
    { id: 'window', name: 'Cabin window', kind: 'wall', category: 'building', pattern: 'panel', colors: ['#6f8286', '#7e9398'], footprint: 'wall', height: FULL, placement: CUT, blocksSight: false, cut: 'wireglass' },
    { id: 'cabindoor', name: 'Cabin door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#886647', '#94704f'], footprint: 'wall', height: FULL, placement: CUT, cut: 'door' },
    { id: 'railing', name: 'Jetty railing', kind: 'feature', category: 'building', pattern: 'panel', colors: ['#6e6452', '#7b705c'], footprint: 'wall', height: WAIST, placement: CUT, blocksSight: false, cut: 'railing' },
    { id: 'boathousedoor', name: 'Boathouse door', kind: 'door', category: 'building', pattern: 'planks', colors: ['#7f6448', '#8b6e50'], footprint: 'wall', height: FULL, placement: CUT, cut: 'roller' },

    { id: 'boat', name: 'Launch', kind: 'feature', category: 'interior', pattern: 'solid', colors: ['#8b8271', '#97907d'], height: WAIST, prop: 'boat', placement: { on: ['deep', 'shallow'] } },
    { id: 'canoe', name: 'Canoe', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8a5f45', '#96684c'], height: WAIST, prop: 'canoe', placement: { on: ['deep', 'shallow', 'shore', 'beach'] } },
    { id: 'bed', name: 'Bunk', kind: 'feature', category: 'interior', pattern: 'carpet', colors: ['#7d7062', '#897c6d'], height: WAIST, prop: 'bed', placement: { againstWall: true } },
    { id: 'table', name: 'Cabin table', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#8b7351', '#97805a'], height: WAIST, prop: 'table' },
    { id: 'chair', name: 'Cabin chair', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#836c4d', '#8f7756'], footprint: 'post', height: WAIST, prop: 'chair' },
    { id: 'stove', name: 'Pot-belly stove', kind: 'feature', category: 'interior', pattern: 'panel', colors: ['#5f5750', '#6b635b'], emissive: '#ff8a3c', footprint: 'round', height: WAIST, prop: 'stove', placement: { againstWall: true } },
    { id: 'crates', name: 'Supply crates', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#95784c', '#a08253'], height: WAIST, prop: 'crates' },
    { id: 'bench', name: 'Jetty bench', kind: 'feature', category: 'interior', pattern: 'planks', colors: ['#82694b', '#8e7353'], height: WAIST, prop: 'bench', placement: { on: ['jetty', 'shore'] } },

    { id: 'buoy', name: 'Mooring buoy', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#8d4f42', '#985749'], footprint: 'post', height: WAIST, prop: 'buoy', placement: { on: ['deep', 'shallow'] } },
    { id: 'cleat', name: 'Mooring post', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#6f6553', '#7c705c'], footprint: 'post', height: WAIST, prop: 'bollard', placement: { on: ['jetty'] } },
    { id: 'pinetree', name: 'Pine', kind: 'feature', category: 'decoration', pattern: 'grass', colors: ['#4f5f42', '#5b6b4a'], footprint: 'canopy', height: FULL, prop: 'tree', placement: { on: ['pine', 'shore'] } },
    { id: 'rocks', name: 'Shore rocks', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#756e60', '#827a6b'], footprint: 'round', height: WAIST, prop: 'rocks', placement: { on: ['shore', 'shallow'] } },
    { id: 'firepit', name: 'Fire ring', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#6e6250', '#7b6e59'], emissive: '#ff8a3c', footprint: 'round', height: WAIST, prop: 'firepit', placement: { on: ['shore', 'pine'] } },
    { id: 'lantern', name: 'Jetty lantern', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#7b6b52', '#87765a'], emissive: '#e6d58a', footprint: 'post', height: WAIST, prop: 'lantern', placement: { on: ['jetty', 'cabinfloor'] } },
    { id: 'logs', name: 'Woodpile', kind: 'feature', category: 'decoration', pattern: 'planks', colors: ['#836a4c', '#8f7454'], height: WAIST, prop: 'logs', placement: { on: ['pine', 'shore'] } },
    { id: 'tent', name: 'Tent', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#6f6a4e', '#7b7656'], height: WAIST, prop: 'tent', placement: { on: ['pine', 'shore'] } },
    { id: 'nets', name: 'Drying nets', kind: 'feature', category: 'decoration', pattern: 'rubble', colors: ['#6d6a54', '#79765d'], footprint: 'round', height: WAIST, prop: 'heap', placement: { on: ['jetty', 'shore'] } },
    // Every set has a street, a sidewalk and the kerb between them, and a light for indoors.
    { id: 'street', name: 'Lake road', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'gravel', colors: ['#4a453c', '#575149'] },
    { id: 'sidewalk', name: 'Footpath', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#817661', '#8e826c'] },
    { id: 'curb', name: 'Kerb', kind: 'floor', category: 'ground', setting: 'outside', pattern: 'concrete', colors: ['#8f8572', '#9c917d'], hint: 'A one-square row between the street and the sidewalk.' },
    { id: 'ceilinglight', name: 'Cabin lamp', kind: 'feature', category: 'decoration', pattern: 'solid', colors: ['#846b4a', '#907552'], emissive: '#e6d58a', footprint: 'post', prop: 'pendant', placement: { on: ['cabinfloor', 'lamppool'] }, hint: 'A ceiling light: lights the room from inside. Hangs overhead, so it gives no cover.' },
  ],
};

/** The second catalogue, in the order the palette lists them after the first six. */
export const PLACE_SETS: readonly Tileset[] = [
  TENEMENT,
  CONDO,
  CAFE,
  RESTAURANT,
  TAKEOUT,
  PLAZA,
  PARK,
  MARINA,
  COUNTRYSIDE,
  LAKE,
];
