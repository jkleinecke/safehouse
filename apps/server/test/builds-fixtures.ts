/**
 * Builds for the builder's route tests (FR3.9 P2, docs/CHARGEN.md §8.5).
 *
 * Copied from `packages/rules/test/chargen-fixtures.ts`, not imported: a test
 * file of another package is not part of its published surface, and the
 * server's tests must not break when the engine's own baselines are reshaped.
 * What is here is only what the route tests need:
 *
 * - `cleanBuild` — a mundane runner legal to the last point, no issue of any
 *   severity, two contacts, 3,000¥ carried;
 * - `boundMage` — the same runner as a hermetic magician who binds a spirit
 *   and bonds a spell focus bought as Restricted gear, carrying 3 Karma (one
 *   `approval` issue: the focus's Availability);
 * - `registeringTechnomancer` — the same runner as a technomancer who
 *   registers a sprite and carries 7 Karma;
 * - `troubledSamurai` — a troll street samurai whose Exceptional Attribute and
 *   Restricted 'ware each wait on the GM (approvals, no errors).
 *
 * Every alias, contact and quality label is invented (BUILD_CONVENTIONS hard
 * rule 1); the numbers are the rules'.
 */
import {
  BuildPurchaseSchema,
  CharacterBuildSchema,
  type BuildPurchaseInput,
  type CharacterBuild,
  type CharacterBuildInput,
  type Modifier,
} from '@safehouse/contracts';

let modId = 0;
function mod(target: string, value: number): Modifier {
  return { id: `fixture-${modId++}`, source: { kind: 'cyberware' }, target, op: 'add', value, active: true };
}

function build(input: Omit<CharacterBuildInput, 'v'>): CharacterBuild {
  return CharacterBuildSchema.parse({ v: 1, ...input });
}

/** A copy of `base` with `change` applied, re-parsed so defaults fill in. */
export function vary(base: CharacterBuild, change: (b: CharacterBuild) => void): CharacterBuild {
  const copy = structuredClone(base);
  change(copy);
  return CharacterBuildSchema.parse(copy);
}

const gear = (name: string, cost: number, extra: Partial<BuildPurchaseInput> = {}): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'gear', name, cost, item: { name }, ...extra }) as BuildPurchaseInput;

const commlink = (rating = 3, cost = 1_000): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'electronics', name: 'Commlink', cost, rating, avail: '4', item: { name: 'Commlink', rating } }) as BuildPurchaseInput;

const fakeSin = (cost = 7_500, avail = '9'): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'gear', name: 'Fake SIN', cost, rating: 3, avail, item: { name: 'Fake SIN', rating: 3 } }) as BuildPurchaseInput;

const augment = (
  name: string,
  cost: number,
  essence: number,
  extra: Partial<Extract<BuildPurchaseInput, { list: 'augments' }>> = {},
): BuildPurchaseInput =>
  ({ list: 'augments', kind: 'augmentation', name, cost, essence, item: { name, essence, mods: [] }, ...extra }) as BuildPurchaseInput;

/**
 * A mundane human with every pool spent exactly and nothing to flag.
 * Priorities C/A/E/B/D; 25 Karma − 5 converted − 20 in raises = 0 left;
 * 50,000 + 10,000 − 57,000 = 3,000¥ carried.
 */
export function cleanBuild(): CharacterBuild {
  return build({
    priorities: { metatype: 'C', attributes: 'A', magic: 'E', skills: 'B', resources: 'D' },
    metatype: 'human',
    special: { edg: 5 },
    attributes: { bod: 5, agi: 4, rea: 4, str: 3, wil: 3, log: 1, int: 2, cha: 2 },
    skills: {
      groups: [
        { id: 'firearms', points: 3 },
        { id: 'athletics', points: 2 },
      ],
      active: [
        { id: 'blades', points: 4, spec: 'Knives' },
        { id: 'perception', points: 4 },
        { id: 'sneaking', points: 4 },
        { id: 'pilot-ground-craft', points: 3 },
        { id: 'first-aid', points: 3 },
        { id: 'etiquette', points: 3 },
        { id: 'intimidation', points: 3 },
        { id: 'unarmed-combat', points: 4 },
        { id: 'computer', points: 2 },
        { id: 'heavy-weapons', points: 3 },
        { id: 'locksmith', points: 2 },
      ],
      knowledge: [
        { name: 'Safehouses', category: 'street', points: 3 },
        { name: 'Corp Security', category: 'professional', points: 3 },
        { name: 'Bike Racing', category: 'interests', points: 2 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Spanish', points: 2 },
      ],
    },
    purchases: [
      commlink(3, 1_000),
      fakeSin(7_500, '9'),
      { list: 'armor', kind: 'armor', name: 'Armor Jacket', cost: 1_000, avail: '2', item: { name: 'Armor Jacket', rating: 12, worn: true } },
      gear('Kit', 45_500),
    ],
    lifestyles: [{ tier: 'low', name: 'Low', months: 1 }],
    karma: {
      toNuyen: 5,
      spends: [
        { kind: 'skill', id: 'blades', from: 4, to: 5 },
        { kind: 'skill', id: 'perception', from: 4, to: 5 },
      ],
      contacts: [
        { name: 'Moss', role: 'Fixer', connection: 3, loyalty: 2 },
        { name: 'Wren', role: 'Street doc', connection: 2, loyalty: 2, notes: 'Owes nobody, charges everybody.' },
      ],
    },
    identity: { alias: 'Cinder', background: 'Fixed bikes for a gang until the gang stopped paying.' },
  });
}

const fiveSpells = [
  { name: 'Flash', category: 'combat' },
  { name: 'Hush', category: 'illusion' },
  { name: 'Knit', category: 'health' },
  { name: 'Seek', category: 'detection' },
  { name: 'Lift', category: 'manipulation' },
];

/**
 * The clean build as a hermetic magician at Magic C (Magic 3, five spells)
 * who binds an air spirit (3 services, 3 Karma) and bonds a Force 2 spell
 * focus (4 Karma; 8,000¥ of the kit lump, 6R) in place of the Perception
 * raise — 20 − 10 − 3 − 4 = 3 Karma carried.
 */
export function boundMage(): CharacterBuild {
  return vary(cleanBuild(), (b) => {
    b.identity.alias = 'Gutterlight';
    b.priorities.metatype = 'E';
    b.priorities.magic = 'C';
    b.special = { edg: 1, mag: 0, res: 0 };
    b.magic = { kind: 'magician', tradition: 'hermetic' };
    b.grants.spells = fiveSpells.map((s) => ({ ...s }));
    b.skills.active = b.skills.active.map((s) => (s.id === 'heavy-weapons' ? { ...s, id: 'spellcasting' } : s));
    b.purchases = [
      ...b.purchases.filter((p) => p.name !== 'Kit'),
      BuildPurchaseSchema.parse(gear('Kit', 37_500)),
      BuildPurchaseSchema.parse(
        gear('Spell Focus', 8_000, { rating: 2, avail: '6R', item: { name: 'Spell Focus', rating: 2, note: 'Etched copper ring' } }),
      ),
    ];
    b.karma.spends = [
      { kind: 'skill', id: 'blades', from: 4, to: 5 },
      { kind: 'spirit', type: 'air', services: 3 },
      { kind: 'focus', name: 'Spell Focus', focusType: 'spell', force: 2, bondKarma: 4, sourceKind: 'spell', targets: ['spellcasting'] },
    ];
  });
}

/**
 * The clean build as a technomancer at Resonance C who registers a crack
 * sprite (3 tasks, 3 Karma) in place of the Perception raise —
 * 20 − 10 − 3 = 7 Karma carried, the most that carries.
 */
export function registeringTechnomancer(): CharacterBuild {
  return vary(cleanBuild(), (b) => {
    b.identity.alias = 'Quiet Carrier';
    b.priorities.metatype = 'E';
    b.priorities.magic = 'C';
    b.special = { edg: 1, mag: 0, res: 0 };
    b.magic = { kind: 'technomancer' };
    b.grants.skills = [
      { id: 'compiling', rating: 2 },
      { id: 'decompiling', rating: 2 },
      { id: 'registering', rating: 2 },
    ];
    b.grants.forms = [{ name: 'Hush Packet' }, { name: 'Loop' }, { name: 'Mirror' }];
    b.karma.spends = [
      { kind: 'skill', id: 'blades', from: 4, to: 5 },
      { kind: 'sprite', type: 'crack', tasks: 3 },
    ];
  });
}

/** The troll street samurai: legal, with Exceptional Attribute and Restricted 'ware waiting on the GM. */
export function troubledSamurai(): CharacterBuild {
  return build({
    priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
    metatype: 'troll',
    attributes: { bod: 4, agi: 3, rea: 2, str: 6, wil: 3, log: 2, int: 2, cha: 2 },
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Exceptional Attribute', catalogueId: 'quality-exceptional-attribute', type: 'positive', karma: 14, target: 'str' },
      { name: 'Registered Identity', catalogueId: 'quality-registered-identity', type: 'negative', karma: 5 },
      { name: 'Fast Mender', catalogueId: 'quality-fast-mender', type: 'positive', karma: 3 },
      { name: 'Will to Live', catalogueId: 'quality-will-to-live', type: 'positive', karma: 3, rating: 1 },
      { name: 'Loud Reputation', catalogueId: 'quality-loud-reputation', type: 'negative', karma: 7 },
      { name: 'Glitch Magnet', catalogueId: 'quality-glitch-magnet', type: 'negative', karma: 8, rating: 2 },
    ],
    skills: {
      groups: [{ id: 'athletics', points: 2 }],
      active: [
        { id: 'automatics', points: 5 },
        { id: 'blades', points: 4 },
        { id: 'computer', points: 1 },
        { id: 'first-aid', points: 2 },
        { id: 'heavy-weapons', points: 1 },
        { id: 'longarms', points: 3 },
        { id: 'perception', points: 1 },
        { id: 'pilot-ground-craft', points: 2 },
        { id: 'pistols', points: 2 },
        { id: 'throwing-weapons', points: 2 },
        { id: 'unarmed-combat', points: 5 },
      ],
      knowledge: [
        { name: 'Home Sprawl', category: 'professional', points: 2 },
        { name: 'Military Regulations', category: 'professional', points: 3 },
        { name: 'Fixers', category: 'street', points: 1 },
        { name: 'Runner Bars', category: 'street', points: 1 },
        { name: 'Tribal Lands', category: 'professional', points: 2 },
        { name: 'Street Clinics', category: 'street', points: 2 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Dakota', points: 1 },
      ],
    },
    purchases: [
      augment('Twitch Weave', 26_000, 0.6, {
        rating: 2,
        avail: '10R',
        item: { name: 'Twitch Weave', essence: 0.6, mods: [mod('attr.rea', 2)] },
      }),
      augment('Polymer Frame', 8_000, 0.5, { avail: '8R' }),
      commlink(3, 1_000),
      fakeSin(7_500, '(Rating x 3)F'),
      {
        list: 'weapons',
        kind: 'weapon',
        name: 'Heavy Pistol',
        cost: 725,
        avail: '4',
        item: { name: 'Heavy Pistol', skillId: 'pistols', acc: 5, dv: '8P', ap: -1 },
      },
      { list: 'armor', kind: 'armor', name: 'Armor Jacket', cost: 1_000, avail: '2', item: { name: 'Armor Jacket', rating: 12, worn: true } },
      gear('Ammo and tools', 10_965),
    ],
    lifestyles: [{ tier: 'low', name: 'Low', months: 3 }],
    karma: {
      toNuyen: 10,
      spends: [
        { kind: 'skill', id: 'perception', from: 1, to: 2 },
        { kind: 'skill', id: 'heavy-weapons', from: 1, to: 2 },
        { kind: 'skill', id: 'first-aid', from: 2, to: 3 },
      ],
      contacts: [
        { name: 'Stitch', role: 'Street doc', connection: 3, loyalty: 2 },
        { name: 'Ledger', role: 'Fixer', connection: 2, loyalty: 2 },
      ],
    },
    identity: { alias: 'Breakwater', background: 'Discharged, then discovered the pay was better on the other side.' },
  });
}
