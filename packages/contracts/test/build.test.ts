/**
 * The build contract (FR3.9, docs/CHARGEN.md §8.3) and the sheet fields the
 * builder added.
 *
 * What these pin: a complete build survives a save and a reload unchanged;
 * the empty draft an autosave writes on the first tap is legal and fully
 * defaulted, with no list shared between two drafts; the priority shape does
 * not forbid repeats (Sum-to-Ten needs them; the validator is what forbids
 * them under Priority); a sheet stored before the builder existed still
 * parses, and comes back with empty knowledge and a mundane awakening rather
 * than a 500; and the campaign settings default to the experienced level
 * with the street and prime presets one call away.
 */
import { describe, expect, it } from 'vitest';
import {
  AUGMENT_GRADES,
  BUDGET_POOLS,
  BUILD_LIST_MAX,
  BUILD_STATES,
  INITIATION_GRADE_MAX,
  BUILD_STEPS,
  BudgetsSchema,
  BUILD_STALE_CODE,
  BuildApprovalsSchema,
  BuildApproveResultSchema,
  BuildApproveSchema,
  BuildCheckDtoSchema,
  BuildCreateSchema,
  BuildDtoSchema,
  BuildListDtoSchema,
  BuildPatchSchema,
  BuildPrioritiesSchema,
  BuildReturnSchema,
  BuildWritableSchema,
  CHARGEN_LEVEL_PRESETS,
  CREATION_LEVELS,
  CharacterBuildSchema,
  ChargenSettingsSchema,
  ChargenSettingsWriteSchema,
  GM_BUILD_FIELDS,
  IssueSchema,
  KARMA_SPEND_KINDS,
  KNOWLEDGE_CATEGORIES,
  MAX_APPROVAL_DECISIONS,
  MAX_CHARGEN_BOOKS,
  KarmaSpendSchema,
  MAGIC_KINDS,
  PRIORITY_COLUMNS,
  PRIORITY_LEVELS,
  SheetV1Schema,
  chargenSettingsForLevel,
  mergeChargenSettings,
  type CharacterBuildInput,
  type KarmaSpendInput,
} from '../src/index.js';

// Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
// Invented alias, invented gear names; the numbers are shaped like a street
// samurai's but assert nothing about any printed example.
const fullBuild: CharacterBuildInput = {
  v: 1,
  method: 'priority',
  level: 'experienced',
  table: 'sr5',
  priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
  metatype: 'troll',
  special: { edg: 0, mag: 0, res: 0 },
  attributes: { bod: 4, agi: 3, rea: 2, str: 5, wil: 3, log: 2, int: 2, cha: 3 },
  magic: { kind: 'mundane', waived: [] },
  grants: { skills: [], groups: [], spells: [], forms: [] },
  powers: [],
  qualities: [
    {
      name: 'Hard Case',
      ref: { book: 'SR5', page: 72 },
      catalogueId: 'bi_001',
      type: 'positive',
      karma: 14,
      rating: null,
      target: 'str',
      mods: [],
    },
    { name: 'Loud Past', type: 'negative', karma: 7, rating: null, mods: [], note: 'the table knows why' },
  ],
  skills: {
    active: [
      { id: 'automatics', points: 5, spec: null },
      { id: 'exotic-ranged', points: 2, spec: null, target: 'Rivet launcher' },
      { id: 'blades', points: 4, spec: 'Knives' },
    ],
    groups: [{ id: 'athletics', points: 2 }],
    knowledge: [
      { name: 'Barrens Clinics', category: 'street', points: 2, skillPoints: 0, spec: null },
      { name: 'Militia Drill', category: 'professional', points: 3, skillPoints: 1, spec: null },
    ],
    languages: [
      { name: 'English', native: true, points: 0, skillPoints: 0, spec: null },
      { name: 'Cityspeak', native: false, points: 1, skillPoints: 0, spec: null },
    ],
  },
  purchases: [
    {
      list: 'augments',
      kind: 'augmentation',
      name: 'Twitch Weave',
      ref: { book: 'SR5', page: 459 },
      qty: 1,
      rating: 2,
      grade: 'alphaware',
      cost: 26000,
      avail: '10R',
      essence: 0.6,
      item: { name: 'Twitch Weave', essence: 0.6, mods: [] },
    },
    {
      list: 'weapons',
      kind: 'weapon',
      name: 'Brakeman Heavy',
      qty: 1,
      rating: null,
      grade: null,
      cost: 725,
      avail: '4R',
      essence: 0,
      item: { name: 'Brakeman Heavy', skillId: 'pistols', acc: 5, dv: '8P', ap: -1, modes: ['SA'] },
    },
    {
      list: 'armor',
      kind: 'armor',
      name: 'Patched Coat',
      qty: 1,
      rating: null,
      grade: null,
      cost: 1000,
      avail: '4',
      essence: 0,
      item: { name: 'Patched Coat', rating: 9, worn: true },
    },
    {
      list: 'gear',
      kind: 'electronics',
      name: 'Pocket Commlink',
      qty: 2,
      rating: 3,
      grade: null,
      cost: 1000,
      avail: '4',
      essence: 0,
      item: { name: 'Pocket Commlink', qty: 2, rating: 3 },
    },
  ],
  lifestyles: [
    { tier: 'low', name: 'Low (squat above the noodle bar)', months: 3 },
    { tier: 'squatter', name: 'Squatter', months: 1, note: 'the bolt-hole' },
  ],
  karma: {
    toNuyen: 10,
    spends: [
      { kind: 'attribute', id: 'edg', from: 1, to: 2 },
      { kind: 'skill', id: 'perception', from: 1, to: 2 },
      { kind: 'group', id: 'athletics', from: 2, to: 3 },
      { kind: 'knowledge', name: 'Barrens Clinics', category: 'street', from: 2, to: 3 },
      { kind: 'language', name: 'Cityspeak', from: 1, to: 2 },
      { kind: 'specialization', list: 'active', id: 'automatics', spec: 'Assault Rifles' },
      { kind: 'spell', name: 'Glass Lung', category: 'combat' },
      { kind: 'form', name: 'Quiet Door' },
      { kind: 'powerPoint', count: 2 },
      { kind: 'initiation', grade: 1, metamagic: 'Quickening' },
      { kind: 'spirit', type: 'water', services: 4 },
      { kind: 'sprite', type: 'fault', tasks: 3 },
      { kind: 'focus', name: 'Weighted Chain', focusType: 'weapon', force: 2, bondKarma: 6 },
    ],
    contacts: [
      { name: 'Mother Rust', role: 'fixer', connection: 3, loyalty: 2 },
      { name: 'Dr. Paper', role: 'street doc', connection: 2, loyalty: 2, notes: 'owes a favour' },
    ],
  },
  identity: {
    alias: 'Gravelback',
    realName: 'Tobias Venn',
    age: 27,
    sex: 'male',
    background: 'Came up through a dock gang; left when the gang got a sponsor.',
    concept: 'muscle',
  },
  approvals: { 'quality.exceptional-attribute': 'approved', 'gear.restricted': 'denied' },
  notes: 'Check the coat.',
  returnedStep: 7,
  mode: 'free',
  step: 9,
  state: 'returned',
};

describe('CharacterBuildSchema (FR3.9, CHARGEN §8.3)', () => {
  it('round-trips a complete build (parse is idempotent and survives JSON)', () => {
    const once = CharacterBuildSchema.parse(fullBuild);
    expect(CharacterBuildSchema.parse(once)).toEqual(once);
    expect(CharacterBuildSchema.parse(JSON.parse(JSON.stringify(once)))).toEqual(once);
    // Nothing a player chose is stripped on the way through.
    expect(once).toEqual(fullBuild);
  });

  it('keeps each purchase item typed by the list it lands on', () => {
    const build = CharacterBuildSchema.parse(fullBuild);
    const augment = build.purchases.find((p) => p.list === 'augments');
    expect(augment?.list === 'augments' && augment.item.essence).toBe(0.6);
    const weapon = build.purchases.find((p) => p.list === 'weapons');
    expect(weapon?.list === 'weapons' && weapon.item.skillId).toBe('pistols');
    // A weapon item on the armor list is not an armor item.
    const bad = { ...fullBuild, purchases: [{ ...fullBuild.purchases![1]!, list: 'armor' }] };
    expect(CharacterBuildSchema.safeParse(bad).success).toBe(false);
  });

  it('fills an empty draft with every default (the first autosave)', () => {
    const draft = CharacterBuildSchema.parse({ v: 1 });
    expect(draft).toEqual({
      v: 1,
      method: 'priority',
      level: 'experienced',
      table: 'sr5',
      priorities: { metatype: null, attributes: null, magic: null, skills: null, resources: null },
      metatype: null,
      special: { edg: 0, mag: 0, res: 0 },
      attributes: { bod: 0, agi: 0, rea: 0, str: 0, wil: 0, log: 0, int: 0, cha: 0 },
      magic: { kind: 'mundane' },
      grants: { skills: [], groups: [], spells: [], forms: [] },
      powers: [],
      qualities: [],
      skills: { active: [], groups: [], knowledge: [], languages: [] },
      purchases: [],
      lifestyles: [],
      karma: { toNuyen: 0, spends: [], contacts: [] },
      identity: { alias: '' },
      approvals: {},
      notes: null,
      returnedStep: null,
      mode: 'guided',
      step: 1,
      state: 'draft',
    });
  });

  it('never lets two drafts share a defaulted list', () => {
    const a = CharacterBuildSchema.parse({ v: 1 });
    const b = CharacterBuildSchema.parse({ v: 1 });
    a.skills.active.push({ id: 'pistols', points: 1, spec: null });
    a.grants.spells.push({ name: 'Glass Lung' });
    a.karma.contacts.push({ name: 'x', role: '', connection: 1, loyalty: 1 });
    expect(b.skills.active).toEqual([]);
    expect(b.grants.spells).toEqual([]);
    expect(b.karma.contacts).toEqual([]);
    expect(CharacterBuildSchema.parse({ v: 1 }).skills.active).toEqual([]);
  });

  it('defaults the inside of a partly filled record too', () => {
    const b = CharacterBuildSchema.parse({
      v: 1,
      skills: { active: [{ id: 'sneaking' }], languages: [{ name: 'English', native: true }] },
      karma: { contacts: [{}] },
      priorities: { magic: 'E' },
    });
    expect(b.skills.active[0]).toEqual({ id: 'sneaking', points: 0, spec: null });
    expect(b.skills.groups).toEqual([]);
    expect(b.skills.languages[0]).toEqual({ name: 'English', native: true, points: 0, skillPoints: 0, spec: null });
    expect(b.karma.contacts[0]).toEqual({ name: '', role: '', connection: 1, loyalty: 1 });
    expect(b.priorities).toEqual({ metatype: null, attributes: null, magic: 'E', skills: null, resources: null });
  });

  it('allows repeated priority rows structurally — Sum-to-Ten needs them (RF p.62)', () => {
    const repeated = { metatype: 'C', attributes: 'B', magic: 'C', skills: 'B', resources: 'E' };
    expect(BuildPrioritiesSchema.parse(repeated)).toEqual(repeated);
    const b = CharacterBuildSchema.parse({ v: 1, method: 'sumToTen', priorities: repeated });
    expect(b.method).toBe('sumToTen');
    expect(b.priorities.magic).toBe('C');
    // …but only real rows.
    expect(BuildPrioritiesSchema.safeParse({ metatype: 'F' }).success).toBe(false);
  });

  it('rejects what is structurally wrong, not what is merely unfinished', () => {
    expect(CharacterBuildSchema.safeParse({ v: 2 }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({}).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, method: 'karma' }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, step: 10 }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, step: 0 }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, attributes: { bod: -1 } }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, magic: { kind: 'aspected', aspect: 'alchemy' } }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, karma: { contacts: [{ connection: 13 }] } }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, karma: { contacts: [{ loyalty: 0 }] } }).success).toBe(false);
    expect(CharacterBuildSchema.safeParse({ v: 1, approvals: { x: 'maybe' } }).success).toBe(false);
    // An over-spent or unspent pool is the validator's business, so it parses.
    expect(CharacterBuildSchema.safeParse({ v: 1, attributes: { bod: 40 }, karma: { toNuyen: 99 } }).success).toBe(true);
  });
});

describe('KarmaSpendSchema (SR5 p.98–99, p.107)', () => {
  it('parses every spend kind, discriminated by kind', () => {
    const spends = CharacterBuildSchema.parse(fullBuild).karma.spends;
    expect(spends.map((s) => s.kind)).toEqual([...KARMA_SPEND_KINDS]);
    for (const s of spends) expect(KarmaSpendSchema.parse(s)).toEqual(s);
  });

  it('knows exactly the kinds KARMA_SPEND_KINDS lists', () => {
    const union = KarmaSpendSchema.options.map((o) => o.shape.kind.value).sort();
    expect(union).toEqual([...KARMA_SPEND_KINDS].sort());
  });

  it('defaults a specialisation to an active skill', () => {
    const s = KarmaSpendSchema.parse({ kind: 'specialization', id: 'blades', spec: 'Knives' } satisfies KarmaSpendInput);
    expect(s).toEqual({ kind: 'specialization', list: 'active', id: 'blades', spec: 'Knives' });
  });

  it('keeps what the sheet rolls off a spell or a form: drain, fading, target and the printed note', () => {
    const spell = KarmaSpendSchema.parse({ kind: 'spell', name: 'Static Lash', category: 'combat', drain: 'F-3', note: 'type P · range LOS' });
    expect(spell).toEqual({ kind: 'spell', name: 'Static Lash', category: 'combat', drain: 'F-3', note: 'type P · range LOS' });
    const form = KarmaSpendSchema.parse({ kind: 'form', name: 'Soft Echo', fading: 'L+1', target: 'Device' });
    expect(form).toMatchObject({ fading: 'L+1', target: 'Device' });
    // Picks saved before these fields existed still parse.
    expect(CharacterBuildSchema.parse({ v: 1, grants: { spells: [{ name: 'Old Pick' }] } }).grants.spells).toEqual([{ name: 'Old Pick' }]);
    expect(KarmaSpendSchema.safeParse({ kind: 'spell', name: 'Long', drain: 'x'.repeat(41) }).success).toBe(false);
  });

  it('rejects unknown kinds and a spend missing its own fields', () => {
    expect(KarmaSpendSchema.safeParse({ kind: 'submersion', grade: 1 }).success).toBe(false);
    // Initiation IS a kind now (§8.5 Step 7, prime runners only), and its
    // grade starts at 1 and stops at the record's bound.
    expect(KarmaSpendSchema.safeParse({ kind: 'initiation', grade: 1 }).success).toBe(true);
    expect(KarmaSpendSchema.safeParse({ kind: 'initiation', grade: 0 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'initiation', grade: INITIATION_GRADE_MAX + 1 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'attribute', id: 'luck', from: 1, to: 2 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'spirit', type: 'fire' }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'powerPoint', count: 0 }).success).toBe(false);
  });
});

describe('the build vocabularies', () => {
  it('lists the tuples the plan names, in order', () => {
    expect(BUILD_STATES).toEqual(['draft', 'submitted', 'returned', 'approved']);
    expect(CREATION_LEVELS).toEqual(['street', 'experienced', 'prime']);
    expect(PRIORITY_LEVELS).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(PRIORITY_COLUMNS).toEqual(['metatype', 'attributes', 'magic', 'skills', 'resources']);
    expect(MAGIC_KINDS).toEqual(['mundane', 'magician', 'aspected', 'adept', 'mysticAdept', 'technomancer']);
    expect(AUGMENT_GRADES).toEqual(['standard', 'alphaware', 'betaware', 'deltaware', 'used']);
    expect(KNOWLEDGE_CATEGORIES).toEqual(['academic', 'interests', 'professional', 'street']);
    expect(BUILD_STEPS).toHaveLength(9);
    expect(BUILD_STEPS[0]).toBe('concept');
    expect(BUILD_STEPS[8]).toBe('finish');
  });
});

describe('IssueSchema and BudgetsSchema (CHARGEN §4.2)', () => {
  const pool = (available: number, spent: number) => ({ available, spent, remaining: available - spent });
  const budgets = {
    pools: {
      special: pool(0, 0),
      attributes: pool(24, 24),
      skills: pool(28, 28),
      groups: pool(2, 2),
      knowledge: pool(12, 12),
      karma: pool(25, 31),
      nuyen: pool(70000, 67190),
      contactKarma: pool(9, 9),
      powerPoints: pool(2, 2.25),
      spells: pool(0, 0),
      forms: pool(0, 0),
      foci: pool(0, 0),
    },
  };

  it('carries a page on every issue and a step from the walkthrough', () => {
    const issue = IssueSchema.parse({
      code: 'attributes.two-at-max',
      severity: 'error',
      step: 3,
      message: 'Only one attribute may start at its natural maximum.',
      ref: { book: 'SR5', page: 66 },
      path: 'attributes.str',
    });
    expect(IssueSchema.parse(issue)).toEqual(issue);
    expect(IssueSchema.safeParse({ ...issue, ref: undefined }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...issue, severity: 'info' }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...issue, step: 10 }).success).toBe(false);
  });

  it('holds every pool, lets one go negative, and treats previews as optional', () => {
    const parsed = BudgetsSchema.parse(budgets);
    expect(Object.keys(parsed.pools)).toEqual([...BUDGET_POOLS]);
    expect(parsed.pools.karma.remaining).toBe(-6);
    expect(parsed.pools.powerPoints.remaining).toBe(-0.25);
    const withPreview = BudgetsSchema.parse({
      ...budgets,
      pools: { ...budgets.pools, positiveQualities: pool(25, 14), negativeQualities: pool(25, 7) },
      preview: { essence: 4.9, karmaCarried: 0, nuyenCarried: 2810, startingNuyen: { dice: 3, multiplier: 60 } },
    });
    expect(withPreview.preview?.startingNuyen).toEqual({ dice: 3, multiplier: 60 });
    const { foci: _foci, ...missingOne } = budgets.pools;
    expect(BudgetsSchema.safeParse({ pools: missingOne }).success).toBe(false);
  });

  it('shapes the builds routes (§8.5)', () => {
    const build = CharacterBuildSchema.parse(fullBuild);
    const dto = BuildDtoSchema.parse({
      id: '7d1c1f7e-0000-4000-8000-000000000001',
      campaignId: '7d1c1f7e-0000-4000-8000-000000000002',
      ownerUserId: 'usr_2',
      state: 'returned',
      build,
      notes: 'Check the coat.',
      createdAt: '2076-05-12T20:31:00.000Z',
      updatedAt: '2076-05-12T21:02:00.000Z',
    });
    expect(BuildDtoSchema.parse(dto)).toEqual(dto);

    const sheet = SheetV1Schema.parse({
      v: 1,
      identity: { alias: 'Gravelback', metatype: 'troll' },
      attributes: { bod: 9, agi: 4, rea: 3, str: 10, wil: 4, log: 3, int: 3, cha: 3, edg: { max: 2, current: 2 } },
    });
    const check = BuildCheckDtoSchema.parse({ budgets, issues: [], sheet });
    expect(check.derived).toBeUndefined();
    expect(BuildCheckDtoSchema.parse({ ...check, derived: { anything: true } }).derived).toEqual({ anything: true });

    expect(BuildPatchSchema.safeParse({ build: fullBuild }).success).toBe(true);
    expect(BuildReturnSchema.safeParse({ notes: '', step: 7 }).success).toBe(false);
    expect(BuildReturnSchema.parse({ notes: 'Swap the coat.', step: 7 })).toEqual({ notes: 'Swap the coat.', step: 7 });
    expect(BuildApproveSchema.parse({})).toEqual({});
  });

  it('keeps the GM-owned fields out of a player\'s write: approvals, notes, returned step and state are stripped', () => {
    const selfApproved = { ...fullBuild, approvals: { 'approval-quality-exceptional-attribute-str': 'approved' }, state: 'approved' };
    for (const parsed of [BuildPatchSchema.parse({ build: selfApproved }).build, BuildCreateSchema.parse({ build: selfApproved }).build]) {
      for (const field of GM_BUILD_FIELDS) expect(parsed && field in parsed, field).toBe(false);
      expect(parsed?.identity.alias).toBe('Gravelback');
    }
    expect(Object.keys(BuildWritableSchema.shape).sort()).toEqual(
      Object.keys(CharacterBuildSchema.shape)
        .filter((k) => !(GM_BUILD_FIELDS as readonly string[]).includes(k))
        .sort(),
    );
    expect(BuildCreateSchema.parse({})).toEqual({});
  });

  it('carries Sum to Ten\'s priority points through the check DTO instead of stripping them (RF p.62)', () => {
    const withPoints = { pools: { ...budgets.pools, priorityPoints: pool(10, 10) } };
    expect(BudgetsSchema.parse(withPoints).pools.priorityPoints).toEqual({ available: 10, spent: 10, remaining: 0 });
    expect(BudgetsSchema.parse(budgets).pools.priorityPoints).toBeUndefined();
  });

  it('bounds spirit, sprite and focus spends by the magic store they are approved into', () => {
    expect(KarmaSpendSchema.safeParse({ kind: 'spirit', type: 'x'.repeat(81), services: 1 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'spirit', type: 'water', services: 1000 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'sprite', type: 'x'.repeat(81), tasks: 1 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'focus', name: 'Ring', force: 13, bondKarma: 26 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'focus', name: 'x'.repeat(121), force: 1, bondKarma: 2 }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ kind: 'focus', name: 'Ring', focusType: 'spell', force: 12, bondKarma: 24 }).success).toBe(true);
    // What the focus feeds in play, bounded like the store's focus record.
    const feeds = { kind: 'focus', name: 'Ring', focusType: 'spell', force: 2, bondKarma: 4, sourceKind: 'spell' };
    expect(KarmaSpendSchema.safeParse({ ...feeds, targets: ['pool.skill.spellcasting'] }).success).toBe(true);
    expect(KarmaSpendSchema.safeParse({ ...feeds, targets: Array.from({ length: 13 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ ...feeds, targets: ['x'.repeat(81)] }).success).toBe(false);
    expect(KarmaSpendSchema.safeParse({ ...feeds, sourceKind: 'weapon' }).success).toBe(false);
  });
});

describe('ChargenSettingsSchema (CHARGEN §8.3; SR5 p.64)', () => {
  it('defaults to the experienced level', () => {
    expect(ChargenSettingsSchema.parse({})).toEqual({
      level: 'experienced',
      table: 'sr5',
      maxAvailability: 12,
      maxDeviceRating: 6,
      karmaCarry: 7,
      nuyenCarry: 5000,
      books: [],
      allowSumToTen: false,
      allowMetavariants: false,
      aiDrafts: false,
      uncouthDoublesPriorityPoints: false,
      levelQualityCaps: true,
    });
  });

  it('has a preset for every level: street 10/4, experienced 12/6, prime 15/6', () => {
    expect(Object.keys(CHARGEN_LEVEL_PRESETS).sort()).toEqual([...CREATION_LEVELS].sort());
    const street = chargenSettingsForLevel('street');
    expect(street).toMatchObject({ level: 'street', maxAvailability: 10, maxDeviceRating: 4, karmaCarry: 7, nuyenCarry: 5000 });
    const prime = chargenSettingsForLevel('prime');
    expect(prime).toMatchObject({ level: 'prime', maxAvailability: 15, maxDeviceRating: 6 });
    expect(chargenSettingsForLevel('experienced')).toEqual(ChargenSettingsSchema.parse({}));
  });

  it('lets a GM override a preset without a blank field resetting it', () => {
    const write = ChargenSettingsWriteSchema.parse({ maxAvailability: 11, allowSumToTen: true, books: ['SR5', 'RF'] });
    // The write schema carries no defaults, so an omitted field stays absent.
    expect(write).toEqual({ maxAvailability: 11, allowSumToTen: true, books: ['SR5', 'RF'] });
    const s = chargenSettingsForLevel('street', { ...write, maxDeviceRating: undefined, level: 'prime' });
    expect(s).toMatchObject({ level: 'street', maxAvailability: 11, maxDeviceRating: 4, allowSumToTen: true, books: ['SR5', 'RF'] });
  });

  it('merges a one-toggle write into the current settings without wiping the rest', () => {
    const current = chargenSettingsForLevel('experienced', {
      books: ['SR5', 'RF'],
      allowSumToTen: true,
      aiDrafts: true,
      maxAvailability: 14,
    });
    expect(mergeChargenSettings(current, ChargenSettingsWriteSchema.parse({ levelQualityCaps: false }))).toEqual({
      ...current,
      levelQualityCaps: false,
    });
    // The same level again keeps the GM's own caps.
    expect(mergeChargenSettings(current, { level: 'experienced' })).toEqual(current);
    // A new level resets the four preset caps to its own, unless the write sets one.
    expect(mergeChargenSettings(current, { level: 'street', karmaCarry: 5 })).toEqual({
      ...current,
      level: 'street',
      maxAvailability: 10,
      maxDeviceRating: 4,
      karmaCarry: 5,
      nuyenCarry: 5000,
    });
    expect(mergeChargenSettings(current, { maxDeviceRating: undefined })).toEqual(current);
  });
});

describe('SheetV1Schema: the builder additions are additive (CHARGEN §8.3)', () => {
  // A character exactly as stored before the builder: `{ ...SheetV1, play }`
  // JSON, no knowledge, languages or awakening, no grades or targets.
  const storedBeforeBuilder = JSON.parse(`{
    "v": 1,
    "identity": { "alias": "Lamplighter", "metatype": "elf", "portraitId": null, "notes": "old runner" },
    "attributes": { "bod": 3, "agi": 5, "rea": 4, "str": 2, "wil": 5, "log": 4, "int": 5, "cha": 4,
                    "edg": { "max": 3, "current": 2 }, "ess": 6, "mag": 5, "res": 0 },
    "skills": [{ "id": "spellcasting", "rating": 5, "attr": "mag", "spec": null, "group": null }],
    "qualities": [{ "name": "Quiet Hands", "mods": [] }],
    "augments": [{ "name": "Datajack", "essence": 0.1, "mods": [] }],
    "weapons": [], "armor": [], "spells": [{ "name": "Glass Lung" }], "powers": [], "complexForms": [],
    "matrix": {}, "gear": [], "lifestyles": [], "rangeTables": {}, "overrides": [],
    "play": { "monitors": { "physical": 0, "stun": 2, "overflow": 0 } }
  }`);

  it('parses a pre-change sheet and fills the new fields with their empty shapes', () => {
    const sheet = SheetV1Schema.parse(storedBeforeBuilder);
    expect(sheet.knowledge).toEqual([]);
    expect(sheet.languages).toEqual([]);
    expect(sheet.awakening).toEqual({ kind: 'mundane', aspect: null, tradition: null, drain: null, mentor: null, powerPoints: 0, grade: 0 });
    expect(sheet.skills[0]?.target).toBeUndefined();
    expect(sheet.augments[0]?.grade).toBeUndefined();
    expect(sheet.qualities[0]?.type).toBeUndefined();
    expect(sheet.identity.realName).toBeUndefined();
    // Still stripped: play state is parsed separately on the server.
    expect('play' in sheet).toBe(false);
    expect(SheetV1Schema.parse(sheet)).toEqual(sheet);
  });

  it('never shares the defaulted awakening between two sheets', () => {
    const a = SheetV1Schema.parse(storedBeforeBuilder);
    const b = SheetV1Schema.parse(storedBeforeBuilder);
    a.awakening.kind = 'adept';
    expect(b.awakening.kind).toBe('mundane');
  });

  it('round-trips a sheet the builder compiled, with every new field set', () => {
    const compiled = {
      ...storedBeforeBuilder,
      identity: { ...storedBeforeBuilder.identity, realName: 'Iris Kalt', age: 31, sex: 'female' },
      skills: [
        { id: 'spellcasting', rating: 5, attr: 'mag' },
        { id: 'exotic-melee', rating: 3, attr: 'agi', target: 'Whip-wire' },
      ],
      knowledge: [{ name: 'Talismongers', category: 'street', rating: 3, spec: 'Fetishes' }],
      languages: [
        { name: 'English', rating: 0, native: true },
        { name: 'Cityspeak', rating: 2, native: false, spec: null },
      ],
      augments: [{ name: 'Datajack', essence: 0.08, mods: [], grade: 'alphaware', rating: 1 }],
      qualities: [{ name: 'Quiet Hands', mods: [], type: 'positive', karma: 6, rating: 2 }],
      awakening: { kind: 'aspected', aspect: 'sorcery', tradition: 'hermetic', drain: ['wil', 'log'], mentor: null, powerPoints: 0 },
    };
    const once = SheetV1Schema.parse(compiled);
    expect(SheetV1Schema.parse(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(once.languages[0]).toEqual({ name: 'English', rating: 0, native: true });
    expect(once.awakening.drain).toEqual(['wil', 'log']);
    expect(SheetV1Schema.safeParse({ ...compiled, knowledge: [{ name: 'X', category: 'trivia', rating: 1 }] }).success).toBe(false);
    expect(SheetV1Schema.safeParse({ ...compiled, augments: [{ name: 'X', grade: 'gammaware' }] }).success).toBe(false);
    expect(SheetV1Schema.safeParse({ ...compiled, awakening: { kind: 'sorcerer' } }).success).toBe(false);
  });

  it('fills a partial awakening block field by field', () => {
    const sheet = SheetV1Schema.parse({ ...storedBeforeBuilder, awakening: { kind: 'adept', powerPoints: 5 } });
    expect(sheet.awakening).toEqual({ kind: 'adept', aspect: null, tradition: null, drain: null, mentor: null, powerPoints: 5, grade: 0 });
  });
});

describe('the GM writes are bounded, and the list carries unreadable rows as stubs (CHARGEN §8.5)', () => {
  const decisions = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`approval-invented-${i}`, 'approved']));

  it("caps the decisions a return or an approval carries, and a code's length", () => {
    for (const schema of [BuildApproveSchema, BuildReturnSchema]) {
      const base = schema === BuildReturnSchema ? { notes: 'A note.' } : {};
      expect(schema.safeParse({ ...base, approvals: decisions(MAX_APPROVAL_DECISIONS) }).success).toBe(true);
      expect(schema.safeParse({ ...base, approvals: decisions(MAX_APPROVAL_DECISIONS + 1) }).success).toBe(false);
      expect(schema.safeParse({ ...base, approvals: { ['x'.repeat(201)]: 'approved' } }).success).toBe(false);
      expect(schema.safeParse({ ...base, approvals: { '': 'denied' } }).success).toBe(false);
    }
  });

  it("caps the books a campaign's creation may name", () => {
    const books = (n: number) => Array.from({ length: n }, (_, i) => `B${i}`);
    expect(ChargenSettingsSchema.safeParse({ books: books(MAX_CHARGEN_BOOKS) }).success).toBe(true);
    expect(ChargenSettingsSchema.safeParse({ books: books(MAX_CHARGEN_BOOKS + 1) }).success).toBe(false);
    expect(ChargenSettingsWriteSchema.safeParse({ books: books(MAX_CHARGEN_BOOKS + 1) }).success).toBe(false);
  });

  it('lists a flagged stub beside readable builds', () => {
    const at = '2026-09-14T00:00:00.000Z';
    const stub = { id: 'b2', campaignId: 'c1', ownerUserId: 'u1', state: 'draft', notes: null, characterId: null, unreadable: true, createdAt: at, updatedAt: at };
    const readable = { id: 'b1', campaignId: 'c1', ownerUserId: 'u1', state: 'draft', build: { v: 1 }, notes: null, createdAt: at, updatedAt: at };
    const list = BuildListDtoSchema.parse({ campaignId: 'c1', builds: [readable, stub] });
    expect(list.builds[1]).toEqual(stub);
    expect(BuildListDtoSchema.safeParse({ campaignId: 'c1', builds: [{ ...stub, unreadable: false }] }).success).toBe(false);
  });
});

describe('the route shapes the web and the server share (CHARGEN §8.5)', () => {
  const at = '2026-09-14T00:00:00.000Z';
  const row = { id: 'b1', campaignId: 'c1', ownerUserId: 'u1', state: 'draft', build: { v: 1 }, notes: null, createdAt: at, updatedAt: at };

  it('starts a draft from nothing, an alias, a concept card, or for someone else at the table', () => {
    expect(BuildCreateSchema.parse({})).toEqual({});
    const owner = '7d1c1f7e-0000-4000-8000-000000000003';
    expect(BuildCreateSchema.parse({ alias: 'Gravelback', conceptId: 'muscle', ownerUserId: owner })).toEqual({
      alias: 'Gravelback',
      conceptId: 'muscle',
      ownerUserId: owner,
    });
    expect(BuildCreateSchema.safeParse({ ownerUserId: 'not-a-user' }).success).toBe(false);
    expect(BuildCreateSchema.safeParse({ conceptId: '' }).success).toBe(false);
    expect(BuildCreateSchema.safeParse({ alias: 'x'.repeat(201) }).success).toBe(false);
  });

  it('names the character an approval made, and reads an older row without one as none', () => {
    expect(BuildDtoSchema.parse(row).characterId).toBeNull();
    expect(BuildDtoSchema.parse({ ...row, characterId: 'ch1' }).characterId).toBe('ch1');
  });

  it('carries an optional precondition on an autosave, and names the refusal', () => {
    const build = BuildDtoSchema.parse(row).build;
    expect(BuildPatchSchema.parse({ build }).baseUpdatedAt).toBeUndefined();
    expect(BuildPatchSchema.parse({ build, baseUpdatedAt: at }).baseUpdatedAt).toBe(at);
    expect(BuildPatchSchema.safeParse({ build, baseUpdatedAt: 'yesterday-ish' }).success).toBe(false);
    expect(BUILD_STALE_CODE).toBe('build_stale');
  });

  it('takes decisions back with null, and refuses an empty or oversized batch', () => {
    expect(BuildApprovalsSchema.parse({ approvals: { 'approval-invented': 'approved', 'approval-other': null } }).approvals).toEqual({
      'approval-invented': 'approved',
      'approval-other': null,
    });
    expect(BuildApprovalsSchema.safeParse({ approvals: {} }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: MAX_APPROVAL_DECISIONS + 1 }, (_, i) => [`approval-${i}`, 'denied']));
    expect(BuildApprovalsSchema.safeParse({ approvals: many }).success).toBe(false);
  });

  it('shapes what approval answers: the row, the character, the opening and the roll', () => {
    const result = BuildApproveResultSchema.parse({
      build: { ...row, state: 'approved', characterId: 'ch1' },
      character: { id: 'ch1', name: 'Gravelback', sheet: {} },
      revision: 1,
      opening: { karma: 5, nuyenCarry: 2000, startingNuyen: { dice: 3, multiplier: 60, total: 5000 } },
      roll: { id: 'r1', faces: [3, 4, 5], sum: 12, multiplier: 60, nuyen: 720 },
    });
    expect(result.character).toMatchObject({ id: 'ch1', name: 'Gravelback' });
    expect(result.build.characterId).toBe('ch1');
    expect(BuildApproveResultSchema.safeParse({ ...result, roll: { id: 'r1' } }).success).toBe(false);
  });
});

describe('every list in the record has a wall (§8.3)', () => {
  /**
   * None of them had one, and the body limit is 1 MiB: a single PATCH could
   * store eleven thousand Karma spends, and every engine pass over that
   * record then took seconds while holding the table's one database
   * connection. The caps are far above any legal build and far below that.
   */
  const spend = (i: number) => ({ kind: 'knowledge' as const, name: `Topic ${i}`, from: 0, to: 1 });
  const times = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

  it('refuses a record with more Karma spends than a creation Karma pool could ever pay for', () => {
    const at = CharacterBuildSchema.safeParse({ v: 1, karma: { spends: times(BUILD_LIST_MAX.karmaSpends, spend) } });
    expect(at.success).toBe(true);
    const over = CharacterBuildSchema.safeParse({ v: 1, karma: { spends: times(BUILD_LIST_MAX.karmaSpends + 1, spend) } });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(['karma', 'spends']);
  });

  it('bounds every other list too, so no one of them is the way through', () => {
    const cases: Array<[keyof typeof BUILD_LIST_MAX, (n: number) => Record<string, unknown>]> = [
      ['contacts', (n) => ({ karma: { contacts: times(n, (i) => ({ name: `Fixer ${i}` })) } })],
      ['powers', (n) => ({ powers: times(n, (i) => ({ name: `Poise ${i}`, cost: 0.25 })) })],
      ['qualities', (n) => ({ qualities: times(n, (i) => ({ name: `Trait ${i}`, type: 'positive', karma: 1 })) })],
      ['purchases', (n) => ({ purchases: times(n, (i) => ({ kind: 'gear', name: `Widget ${i}`, list: 'gear', cost: 10, item: { name: `Widget ${i}` } })) })],
      ['lifestyles', (n) => ({ lifestyles: times(n, (i) => ({ tier: 'low', name: `Bolthole ${i}`, months: 1 })) })],
      ['grants', (n) => ({ grants: { spells: times(n, (i) => ({ name: `Glimmer ${i}` })) } })],
      ['activeSkills', (n) => ({ skills: { active: times(n, (i) => ({ id: `skill-${i}`, points: 1 })) } })],
      ['skillGroups', (n) => ({ skills: { groups: times(n, (i) => ({ id: `group-${i}`, points: 1 })) } })],
      ['knowledge', (n) => ({ skills: { knowledge: times(n, (i) => ({ name: `Lore ${i}`, category: 'street' })) } })],
      ['languages', (n) => ({ skills: { languages: times(n, (i) => ({ name: `Tongue ${i}` })) } })],
    ];
    for (const [key, make] of cases) {
      const max = BUILD_LIST_MAX[key];
      expect(CharacterBuildSchema.safeParse({ v: 1, ...make(max) }).success, `${key} at ${max}`).toBe(true);
      expect(CharacterBuildSchema.safeParse({ v: 1, ...make(max + 1) }).success, `${key} over ${max}`).toBe(false);
    }
  });

  it('keeps the writable half bounded as well, which is what a PATCH is parsed with', () => {
    const over = { v: 1, karma: { spends: times(BUILD_LIST_MAX.karmaSpends + 1, spend) } };
    expect(BuildWritableSchema.safeParse(over).success).toBe(false);
    // And so the stored row of an over-long build no longer reads, which is
    // the same fate as any row from before a schema tightened: a flagged stub.
    expect(BuildPatchSchema.safeParse({ build: over }).success).toBe(false);
  });
});
