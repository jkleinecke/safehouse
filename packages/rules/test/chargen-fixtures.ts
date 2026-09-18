/**
 * Builds for the character-creation engine's tests (FR3.9, docs/CHARGEN.md
 * §5 P1, §8.7).
 *
 * Two kinds. The **worked-character shapes** re-enter the decisions of the
 * core book's three worked characters — a human technomancer (D/C/B/E/A), a
 * troll street samurai (B/A/E/C/D), an elf mystic adept (D/B/A/C/E) — with
 * invented aliases and invented names for everything that is not a rule the
 * engine reads. Their points, qualities, skills, Karma and contacts are the
 * book's, and so is their gear's total at list price (295,555¥ / 55,190¥ /
 * 20,360¥, the figures `chargen-goldens.test.ts` itemises): the lines a rule
 * reads — commlink, fake SIN, 'ware — are entered, and the rest is one lump
 * that brings the list to that total. It is never sized from what the engine
 * says is left, so the nuyen these fixtures carry is worked out by the rules
 * in the tests that assert it. Where the book disagrees with itself they
 * follow the rules and say so (§8.7):
 *
 * - The technomancer uses the Run Faster printing (`table: 'rf'`), which is
 *   what the example follows. Dependents' lifestyle surcharge (p. 80) is
 *   applied, which the example forgets.
 * - The samurai has 15 Karma after converting 10, not the 16 the next step
 *   starts with, so he skips the last knowledge raise and carries 1 Karma —
 *   the figure the advancement example later gives him. His Social limit is 5.
 * - The mystic adept's powers cost 2.25 PP by the powers chapter; this golden
 *   leaves the 0.5 PP voice power out (1.75 of 2 PP) and keeps the example's
 *   Assensing, which the rules do not allow her without Astral Perception —
 *   so she is expected to carry exactly that one error.
 *
 * The **clean** builds are the validator tests' baselines: legal to the last
 * point, no issue of any severity, so each rule's test changes one thing and
 * sees one rule fire.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import {
  CharacterBuildSchema,
  chargenSettingsForLevel,
  type BuildPurchaseInput,
  type CharacterBuild,
  type CharacterBuildInput,
  type ChargenSettings,
  type ChargenSettingsWrite,
  type Modifier,
} from '@safehouse/contracts';

export const EXPERIENCED: ChargenSettings = chargenSettingsForLevel('experienced');
export const EXPERIENCED_RF: ChargenSettings = chargenSettingsForLevel('experienced', { table: 'rf' });

export function settings(overrides: ChargenSettingsWrite = {}): ChargenSettings {
  return chargenSettingsForLevel(overrides.level ?? 'experienced', overrides);
}

let modId = 0;
export function mod(target: string, value: number, kind: Modifier['source']['kind'] = 'cyberware'): Modifier {
  return { id: `fixture-${modId++}`, source: { kind }, target, op: 'add', value, active: true };
}

export function build(input: Omit<CharacterBuildInput, 'v'>): CharacterBuild {
  return CharacterBuildSchema.parse({ v: 1, ...input });
}

/** A copy of `base` with `change` applied, re-parsed so defaults fill in. */
export function vary(base: CharacterBuild, change: (b: CharacterBuild) => void): CharacterBuild {
  const copy = structuredClone(base);
  change(copy);
  return CharacterBuildSchema.parse(copy);
}

export const gear = (name: string, cost: number, extra: Partial<BuildPurchaseInput> = {}): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'gear', name, cost, item: { name }, ...extra }) as BuildPurchaseInput;

export const commlink = (rating = 3, cost = 1_000): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'electronics', name: 'Commlink', cost, rating, avail: '4', item: { name: 'Commlink', rating } }) as BuildPurchaseInput;

export const fakeSin = (cost = 7_500, avail = '9'): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'gear', name: 'Fake SIN', cost, rating: 3, avail, item: { name: 'Fake SIN', rating: 3 } }) as BuildPurchaseInput;

export const augment = (
  name: string,
  cost: number,
  essence: number,
  extra: Partial<Extract<BuildPurchaseInput, { list: 'augments' }>> = {},
): BuildPurchaseInput =>
  ({
    list: 'augments',
    kind: 'augmentation',
    name,
    cost,
    essence,
    item: { name, essence, mods: [] },
    ...extra,
  }) as BuildPurchaseInput;

// ---------------------------------------------------------------------------
// Worked-character shapes (the goldens proper are chargen-goldens.test.ts)
// ---------------------------------------------------------------------------

/** The human technomancer (core p. 64–102 example, re-entered; gear lumped). Settings: `EXPERIENCED_RF`. */
export function goldenTechnomancer(): CharacterBuild {
  return build({
    level: 'experienced',
    table: 'rf',
    priorities: { metatype: 'D', attributes: 'C', magic: 'B', skills: 'E', resources: 'A' },
    metatype: 'human',
    special: { edg: 1, mag: 0, res: 2 },
    attributes: { bod: 2, agi: 1, rea: 1, str: 2, wil: 2, log: 3, int: 3, cha: 2 },
    magic: { kind: 'technomancer' },
    grants: {
      skills: [
        { id: 'compiling', rating: 4 },
        { id: 'registering', rating: 4 },
      ],
      forms: [{ name: 'Quiet Hands' }, { name: 'Patch Note' }],
    },
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Sharp Recall', catalogueId: 'quality-sharp-recall', type: 'positive', karma: 5 },
      { name: 'Wired Calm', catalogueId: 'quality-wired-calm', type: 'positive', karma: 10 },
      { name: 'Clean Liver', catalogueId: 'quality-clean-liver', type: 'positive', karma: 4 },
      { name: 'Habit (moderate)', catalogueId: 'quality-habit-moderate', type: 'negative', karma: 9 },
      { name: 'Dependents', catalogueId: 'quality-dependents', type: 'negative', karma: 6, rating: 2 },
      { name: 'Grudge', catalogueId: 'quality-grudge', type: 'negative', karma: 5 },
    ],
    skills: {
      active: [
        { id: 'automatics', points: 2 },
        { id: 'computer', points: 3 },
        { id: 'electronic-warfare', points: 1 },
        { id: 'forgery', points: 2 },
        { id: 'hacking', points: 5 },
        { id: 'hardware', points: 1 },
        { id: 'perception', points: 2 },
        { id: 'pistols', points: 2 },
      ],
      knowledge: [
        { name: 'Chip Dealers', category: 'street', points: 2 },
        { name: 'Megacorps', category: 'street', points: 2 },
        { name: 'Grid Crews', category: 'street', points: 2 },
        { name: 'Fixers', category: 'street', points: 1 },
        { name: 'Local Emergents', category: 'street', points: 2 },
        { name: 'Host Security', category: 'interests', points: 2 },
        { name: 'Johnsons', category: 'street', points: 1 },
        { name: 'Operating Systems', category: 'interests', points: 2 },
        { name: 'Anarchist Cells', category: 'street', points: 1 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Japanese', points: 1 },
      ],
    },
    // 450,000 − lifestyles 79,200 (Dependents +20%) − gear 295,555 = 75,245: 5,000 carried, 70,245 lost.
    purchases: [commlink(6, 5_000), fakeSin(10_000, '(Rating x 3)F'), gear('Assorted kit', 280_555)],
    lifestyles: [
      { tier: 'middle', name: 'Middle', months: 12 },
      { tier: 'low', name: 'Low (safehouse)', months: 3 },
    ],
    karma: {
      spends: [
        { kind: 'skill', id: 'cybercombat', from: 0, to: 2 },
        { kind: 'skill', id: 'software', from: 0, to: 2 },
        { kind: 'skill', id: 'electronic-warfare', from: 1, to: 2 },
        { kind: 'form', name: 'Static Spike' },
        { kind: 'sprite', type: 'crack', tasks: 3 },
        { kind: 'sprite', type: 'fault', tasks: 3 },
      ],
      contacts: [
        { name: 'Vex', role: 'Cell lieutenant', connection: 2, loyalty: 2 },
        { name: 'Tallow', role: 'Fence', connection: 1, loyalty: 1 },
        { name: 'Marrow', role: 'Fixer', connection: 2, loyalty: 1 },
      ],
    },
    identity: { alias: 'Lattice', background: 'Heard the grid hum before anyone taught him the words.' },
  });
}

/** The troll street samurai. Settings: `EXPERIENCED`. */
export function goldenSamurai(): CharacterBuild {
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
    // 50,000 + 20,000 − lifestyle 12,000 − gear 55,190 = 2,810 carried.
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

/** The elf mystic adept. Settings: `EXPERIENCED`. */
export function goldenMysticAdept(): CharacterBuild {
  const spell = (name: string, category: string) => ({ name, category });
  return build({
    priorities: { metatype: 'D', attributes: 'B', magic: 'A', skills: 'C', resources: 'E' },
    metatype: 'elf',
    attributes: { bod: 2, agi: 4, rea: 2, str: 1, wil: 3, log: 2, int: 3, cha: 3 },
    magic: { kind: 'mysticAdept', tradition: 'shamanic', mentor: 'The Tide' },
    grants: {
      skills: [
        { id: 'spellcasting', rating: 5 },
        { id: 'counterspelling', rating: 5 },
      ],
      spells: [
        spell('Truth Sense', 'detection'),
        spell('Crackle', 'combat'),
        spell('Far Ear', 'detection'),
        spell('Shove', 'combat'),
        spell('Mend', 'health'),
        spell('Unseen', 'illusion'),
        spell('Sway', 'manipulation'),
        spell('Arc Bolt', 'combat'),
        spell('Mind Read', 'detection'),
        spell('Daze Burst', 'combat'),
      ],
    },
    powers: [
      { name: 'Steady Aim', cost: 0.25, target: 'automatics' },
      { name: 'Honed Skill', cost: 0.5, target: 'pistols', mods: [mod('pool.skill.pistols', 1, 'power')] },
      { name: 'Poise', cost: 0.5, target: 'social', mods: [mod('limit.social', 1, 'power')] },
      { name: 'Ward Skin', cost: 0.5, mods: [mod('armor', 1, 'power')] },
    ],
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Focused Concentration', catalogueId: 'quality-focused-concentration', type: 'positive', karma: 8, rating: 2 },
      { name: 'Mentor Spirit', catalogueId: 'quality-mentor-spirit', type: 'positive', karma: 5 },
      { name: 'Sworn Code', catalogueId: 'quality-sworn-code', type: 'negative', karma: 15 },
      { name: 'Distinctive Style', catalogueId: 'quality-distinctive-style', type: 'negative', karma: 5 },
      { name: 'Habit (mild)', catalogueId: 'quality-habit-mild', type: 'negative', karma: 4 },
    ],
    skills: {
      groups: [{ id: 'conjuring', points: 2 }],
      active: [
        { id: 'assensing', points: 3 },
        { id: 'automatics', points: 4 },
        { id: 'computer', points: 1 },
        { id: 'con', points: 4 },
        { id: 'etiquette', points: 2 },
        { id: 'locksmith', points: 2 },
        { id: 'negotiation', points: 4 },
        { id: 'perception', points: 3 },
        { id: 'pilot-ground-craft', points: 2 },
        { id: 'pistols', points: 3 },
      ],
      knowledge: [
        { name: 'Fixers', category: 'street', points: 1 },
        { name: 'Patrol Tactics', category: 'professional', points: 2 },
        { name: 'Syndicates', category: 'street', points: 1 },
        { name: 'Corner Dealers', category: 'street', points: 2 },
        { name: 'Gang Colors', category: 'street', points: 3 },
        { name: 'Gang Politics', category: 'street', points: 3 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Cantonese', points: 2 },
      ],
    },
    // 6,000 + 20,000 − lifestyle 4,000 − gear 20,360 = 1,640 carried.
    purchases: [commlink(3, 1_000), fakeSin(7_500, '(Rating x 3)F'), gear('Street kit', 11_860)],
    lifestyles: [{ tier: 'low', name: 'Low', months: 2 }],
    karma: {
      toNuyen: 10,
      spends: [
        { kind: 'powerPoint', count: 2 },
        { kind: 'skill', id: 'etiquette', from: 2, to: 3 },
        { kind: 'spirit', type: 'water', services: 4 },
        { kind: 'spirit', type: 'beasts', services: 4 },
      ],
      contacts: [
        { name: 'Harrow', role: 'Gang lieutenant', connection: 3, loyalty: 3 },
        { name: 'Pip', role: 'Gang member', connection: 1, loyalty: 2 },
        { name: 'Sugar', role: 'Dealer', connection: 1, loyalty: 1 },
        { name: 'Old Wick', role: 'Talismonger', connection: 2, loyalty: 1 },
        { name: 'Needles', role: 'Street doc', connection: 3, loyalty: 1 },
      ],
    },
    identity: { alias: 'Tidewater', background: 'Ran with a gang until the sea started answering her.' },
  });
}

// ---------------------------------------------------------------------------
// Clean baselines for the validator
// ---------------------------------------------------------------------------

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
        { name: 'Wren', role: 'Street doc', connection: 2, loyalty: 2 },
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

/** The clean build as a hermetic magician at Magic C (Magic 3, five spells). */
export function cleanMage(): CharacterBuild {
  return vary(cleanBuild(), (b) => {
    b.priorities.metatype = 'E';
    b.priorities.magic = 'C';
    b.special = { edg: 1, mag: 0, res: 0 };
    b.magic = { kind: 'magician', tradition: 'hermetic' };
    b.grants.spells = fiveSpells.map((s) => ({ ...s }));
    b.skills.active = b.skills.active.map((s) => (s.id === 'heavy-weapons' ? { ...s, id: 'spellcasting' } : s));
  });
}

/** The clean build as an adept at Magic C (Magic 4, one rating-2 skill, 4 PP of powers). */
export function cleanAdept(): CharacterBuild {
  return vary(cleanBuild(), (b) => {
    b.priorities.metatype = 'E';
    b.priorities.magic = 'C';
    b.special = { edg: 1, mag: 0, res: 0 };
    b.magic = { kind: 'adept' };
    b.grants.skills = [{ id: 'throwing-weapons', rating: 2 }];
    b.powers = [
      { name: 'Quick Step', cost: 2, levels: 2, mods: [] },
      { name: 'Hard Hands', cost: 2, levels: 1, mods: [] },
    ];
  });
}

/** The clean build as a technomancer on the core printing at Resonance C (three rating-2 skills, three forms). */
export function cleanTechnomancer(): CharacterBuild {
  return vary(cleanBuild(), (b) => {
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
  });
}
