/**
 * The goldens: the core book's three worked characters, built step by step
 * through the engine (FR3.9, docs/CHARGEN.md §5 P1, §8.7).
 *
 * The creation chapter (SR5 pp. 62–110) follows three players through every
 * step — a human technomancer on D/C/B/E/A, a troll street samurai on
 * B/A/E/C/D, an elf mystic adept on D/B/A/C/E — and prints the numbers each
 * step leaves them with. This file re-enters those decisions as
 * `CharacterBuild`s under invented aliases (Relay, Bulwark, Undertow), with
 * invented names for every proper noun — spells, forms, gear, contacts,
 * knowledge, the mentor, the qualities the engine does not key on — and the
 * book's numbers kept: points, ratings, Karma, prices, dice. Then it asserts
 * what the rules make of them at each of the walkthrough's steps (§4.4
 * numbering: 3 metatype and attributes, 4 magic, 5 qualities, 6 skills,
 * 7 gear, 8 Karma), what `validate` and the walkthrough's gating say, and
 * that the compiled sheet parses and derives to the chapter's final
 * calculations.
 *
 * Gear is entered as the printed prices lumped into a handful of lines, and
 * only what reaches play is asserted: the carry-over and the starting-nuyen
 * roll with fixed dice.
 *
 * ## Where the book disagrees with itself (§8.7: the rules, not the misprints)
 *
 * Relay, the technomancer:
 * - Takes the Run Faster printing. p. 70 grants two rating-4 Resonance skills
 *   and 2 complex forms, which is RF p. 63's row B; core p. 65 wants three
 *   skills and 4 forms, and on it the example leaves one skill and two forms
 *   unclaimed (asserted).
 * - Dependents at 6 Karma raises lifestyle costs 20% (p. 80); the gear table
 *   (p. 96) prices the lifestyles without it: 72,000 + 7,200, not 60,000 +
 *   6,000.
 * - Four ammunition lines on p. 96 charge the per-ten-rounds price of p. 433
 *   for every round: taser darts 5,000 (list 500), explosive 40,000 (4,000),
 *   stick-n-shock 6,400 (640), APDS 36,000 (3,600). They go in at list. At
 *   the printed prices the Dependents surcharge overspends by 3,415¥
 *   (asserted).
 * - The carry-over is the 5,000¥ cap, never the printed 4,995. The 39 printed
 *   lines add to 440,215¥ (the printed "Total 425,005" does not add up),
 *   which leaves 9,785 even at the example's own prices (asserted); at list
 *   with Dependents 75,245 is left. Starting nuyen is 4D6 × 100 + 5,000 =
 *   7,200 on the 22 that makes the book's 7,195.
 * - Middle lifestyle for 12 months (the p. 96 gear table), not the 5 of the
 *   p. 108 sheet.
 * - Living persona by the p. 101 table is Attack CHA 3, Sleaze INT 4, Data
 *   Processing LOG 4, Firewall WIL 3, Device Rating RES 6, and VR initiative
 *   DP 4 + INT 4 = 8. p. 102 prints 5 / 6 / 6 / 5 / 6 and 10 — two over on
 *   each of the four mental attributes.
 *
 * Bulwark, the samurai:
 * - 25 Karma after qualities, less 10 converted, is 15 — p. 97 says so, and
 *   p. 99 starts Step Seven with 16. The raises cost 4 + 4 + 6 = 14, the
 *   last language raise (2) does not fit, and he carries 1 — the figure the
 *   advancement example gives him on p. 106. Buying it overspends by 1
 *   (asserted).
 * - Social limit ⌈(CHA 3 × 2 + WIL 4 + ⌈ESS 4.9⌉ 5) / 3⌉ = 5 (the p. 110
 *   sheet), not p. 102's 6. Overflow 9 + 1 for Will to Live = 10, p. 102's
 *   "9 (10)".
 * - The 20 printed gear lines add to 67,190¥, leaving 2,810, not the printed
 *   2,785 (items plus carry-over make 69,975, not the printed 70,000).
 *   Starting nuyen 3D6 × 60 + 2,810 = 3,530 on the 12 that makes 3,505.
 * - Trolls pay double for lifestyle only (p. 66, p. 97, p. 420); p. 67's
 *   "+50% gear and Lifestyle" is not applied.
 * - Exceptional Attribute is picked in the book's Step One (p. 64), but the
 *   walkthrough takes qualities at step 5: until then STR 11 is one over its
 *   natural maximum of 10. The quality that allows it is step 5's, so the
 *   issue is filed there and guided Next stays open from step 3 to step 5,
 *   where taking the quality settles it (asserted).
 *
 * Undertow, the mystic adept:
 * - The five powers of p. 70 cost .25 + .5 + .5 + .5 + .5 = 2.25 PP by
 *   pp. 309–311 (the voice power is 0.5 PP per level; the example writes
 *   .25). This golden buys all five at the powers chapter's prices and
 *   expects the over-spend; without the voice power it is 1.75 of 2 PP
 *   (asserted).
 * - Assensing is only for characters who can astrally perceive (p. 142),
 *   which for a mystic adept means the Astral Perception power (p. 69). She
 *   takes Assensing 3 without it, and carries that error.
 * - 10 Karma buys 2 power points (p. 70), not the 5 of the p. 110 sheet.
 * - Starting nuyen 2,225 − 1,640 = 585 = 60 × 9.75: no roll of 3D6 gives it.
 *   Asserted with fixed dice instead: 10 → 2,240, 9 → 2,180.
 * - Spirits keep the 4 services each of p. 99 (8 Karma), not p. 110's 3.
 * - Social limit ⌈(CHA 6 × 2 + WIL 4 + ESS 6) / 3⌉ = 8, and 9 with her limit
 *   power — p. 102's "8 (9)". The voice power's +1 holds only while it is in
 *   use and is not on the sheet.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import {
  BudgetsSchema,
  CharacterBuildSchema,
  DerivedCharacterSchema,
  SheetV1Schema,
  chargenSettingsForLevel,
  type BuildPurchaseInput,
  type CharacterBuild,
  type CharacterBuildInput,
  type ChargenSettings,
  type Issue,
  type Modifier,
} from '@safehouse/contracts';
import {
  budgets,
  compileBuild,
  deriveCharacter,
  ratings,
  rollDice,
  stepStatus,
  tallyBuild,
  validate,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPERIENCED: ChargenSettings = chargenSettingsForLevel('experienced');
const EXPERIENCED_RF: ChargenSettings = chargenSettingsForLevel('experienced', { table: 'rf' });
const SR5 = (page: number) => ({ book: 'SR5', page });

let modId = 0;
const mod = (target: string, value: number, kind: Modifier['source']['kind']): Modifier => ({
  id: `golden-${modId++}`,
  source: { kind },
  target,
  op: 'add',
  value,
  active: true,
});

const make = (input: Omit<CharacterBuildInput, 'v'>): CharacterBuild => CharacterBuildSchema.parse({ v: 1, ...input });

/** A copy of `base` with `change` applied, re-parsed so defaults fill in. */
function vary(base: CharacterBuild, change: (b: CharacterBuild) => void): CharacterBuild {
  const copy = structuredClone(base);
  change(copy);
  return CharacterBuildSchema.parse(copy);
}

/** A lumped gear line at the printed price. */
const gear = (name: string, cost: number, extra: Partial<BuildPurchaseInput> = {}): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'gear', name, cost, item: { name }, ...extra }) as BuildPurchaseInput;

const commlink = (name: string, cost: number, rating: number): BuildPurchaseInput =>
  ({ list: 'gear', kind: 'electronics', name, cost, rating, item: { name, rating } }) as BuildPurchaseInput;

/** A fake SIN at Rating × 2,500¥, Availability (Rating × 3)F. */
const fakeSin = (rating: number, qty = 1): BuildPurchaseInput =>
  ({
    list: 'gear',
    kind: 'gear',
    name: 'Fake SIN',
    qty,
    cost: rating * 2_500,
    rating,
    avail: '(Rating x 3)F',
    item: { name: 'Fake SIN', rating },
  }) as BuildPurchaseInput;

const armorJacket = (cost: number): BuildPurchaseInput =>
  ({
    list: 'armor',
    kind: 'armor',
    name: 'Armor jacket',
    cost,
    item: { name: 'Armor jacket', rating: 12, worn: true },
  }) as BuildPurchaseInput;

/** The total of dice that come up exactly as dealt, rolled through the engine's own roller. */
function fixedDice(faces: readonly number[]): number {
  let i = 0;
  const rng = (): number => {
    const face = faces[i++];
    if (face === undefined) throw new Error('fixedDice: more dice rolled than faces dealt');
    return (face - 0.5) / 6;
  };
  return rollDice(faces.length, rng).reduce((sum, face) => sum + face, 0);
}

/**
 * The build as it stood when the walkthrough reached `step`: every decision
 * made on a later step taken out. Step 4 keeps a mystic adept's power
 * points, which the book's example buys there (p. 70).
 */
function upTo(b: CharacterBuild, step: number): CharacterBuild {
  const c = structuredClone(b);
  if (step < 4) {
    c.magic = { kind: 'mundane' };
    c.grants = { skills: [], groups: [], spells: [], forms: [] };
    c.powers = [];
  }
  if (step < 5) c.qualities = [];
  if (step < 6) c.skills = { active: [], groups: [], knowledge: [], languages: [] };
  if (step < 7) {
    c.purchases = [];
    c.lifestyles = [];
    c.karma.toNuyen = 0;
  }
  if (step < 8) {
    c.karma.spends = c.karma.spends.filter((s) => step >= 4 && s.kind === 'powerPoint');
    c.karma.contacts = [];
  }
  return CharacterBuildSchema.parse(c);
}

/** An issue in a line; a gear approval without its fingerprint (the validator tests pin that). */
const brief = (issues: readonly Issue[]): string[] =>
  issues.map((i) => `${i.severity} ${i.code.replace(/^(approval-gear-.+)-[0-9a-z]{6}(?:-\d+)?$/, '$1')} @${i.step}`);
const errorsOf = (b: CharacterBuild, s: ChargenSettings): string[] =>
  brief(validate(b, s).filter((i) => i.severity === 'error'));
/** Errors filed on the steps up to and including `step`. */
const errorsThrough = (b: CharacterBuild, s: ChargenSettings, step: number): string[] =>
  brief(validate(b, s).filter((i) => i.severity === 'error' && i.step <= step));
/** The steps up to and including `step` whose Next is locked. */
const lockedThrough = (b: CharacterBuild, s: ChargenSettings, step: number): number[] =>
  stepStatus(b, s)
    .filter((st) => st.step <= step && !st.complete)
    .map((st) => st.step);
const coreAttributes = (b: CharacterBuild, s: ChargenSettings) => {
  const r = ratings(b, s).attributes;
  return [r.bod, r.agi, r.rea, r.str, r.wil, r.log, r.int, r.cha];
};

// ---------------------------------------------------------------------------
// The builds
// ---------------------------------------------------------------------------

/** The human technomancer (SR5 pp. 64, 67, 70, 86, 91, 96, 99, 102). Settings: `EXPERIENCED_RF`. */
function relay(options: { ammoAsPrinted?: boolean; dependents?: boolean } = {}): CharacterBuild {
  const { ammoAsPrinted = false, dependents = true } = options;
  return make({
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
      forms: [{ name: 'Scrub' }, { name: 'Rewrite' }],
    },
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Pattern Sense', catalogueId: 'quality-pattern-sense', type: 'positive', karma: 5, ref: SR5(72) },
      { name: 'Hardened Mind', catalogueId: 'quality-hardened-mind', type: 'positive', karma: 10, ref: SR5(76) },
      { name: 'Toxin Tolerance', catalogueId: 'quality-toxin-tolerance', type: 'positive', karma: 4, ref: SR5(77) },
      { name: 'Habit (moderate)', catalogueId: 'quality-habit-moderate', type: 'negative', karma: 9, ref: SR5(77) },
      ...(dependents ? [{ name: 'Dependents', catalogueId: 'quality-dependents', type: 'negative' as const, karma: 6, rating: 2, ref: SR5(80) }] : []),
      { name: 'Bias (common)', catalogueId: 'quality-bias-common', type: 'negative', karma: 5, ref: SR5(82) },
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
        { name: 'Chip Pushers', category: 'street', points: 2 },
        { name: 'Megacorp Structure', category: 'street', points: 2 },
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
    // The p. 96 table, lumped: 374,215¥ of gear as printed, 295,555¥ with the
    // ammunition at list (500 + 2,000 + 4,000 + 640 + 3,600 + 500 grenades).
    purchases: [
      gear('Four sidearms', 2_040),
      gear('Holsters, suppressors, spare clips', 1_830),
      gear('Ammunition and grenades', ammoAsPrinted ? 89_900 : 11_240),
      gear('Suit, jacket and clothing armor', 4_150),
      commlink('Commlink with sim module', 5_100, 6),
      gear('Trodes', 70),
      gear('Heavy motorbike', 52_000),
      gear('Ambulance contract, one year', 100_000),
      gear('Jammers', 2_000, { kind: 'electronics' }),
      fakeSin(4, 10),
      gear('Fake licences', 800, { qty: 10, rating: 4 }),
      gear('Optics and audio', 4_475),
      gear('Handheld scanner', 800),
      gear('Medkits and supplies', 3_500),
      gear('Chips', 350),
    ],
    lifestyles: [
      { tier: 'middle', name: 'Middle', months: 12 },
      { tier: 'low', name: 'Low (safehouse)', months: 3 },
    ],
    karma: {
      spends: [
        { kind: 'skill', id: 'cybercombat', from: 0, to: 2 },
        { kind: 'skill', id: 'software', from: 0, to: 2 },
        { kind: 'skill', id: 'electronic-warfare', from: 1, to: 2 },
        { kind: 'form', name: 'Feedback Lance' },
        { kind: 'sprite', type: 'crack', tasks: 3 },
        { kind: 'sprite', type: 'fault', tasks: 3 },
      ],
      contacts: [
        { name: 'Sable', role: 'Cell lieutenant', connection: 2, loyalty: 2 },
        { name: 'Gutter', role: 'Fence', connection: 1, loyalty: 1 },
        { name: 'Pike', role: 'Fixer', connection: 2, loyalty: 1 },
      ],
    },
    identity: { alias: 'Relay', background: 'Heard the grid talking back at nine and never told anyone.' },
  });
}

/** The troll street samurai (SR5 pp. 64, 67, 86, 92, 97, 99, 102, 110). Settings: `EXPERIENCED`. */
function bulwark(options: { lastLanguageRaise?: boolean } = {}): CharacterBuild {
  return make({
    priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
    metatype: 'troll',
    attributes: { bod: 4, agi: 3, rea: 2, str: 6, wil: 3, log: 2, int: 2, cha: 2 },
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Exceptional Attribute', catalogueId: 'quality-exceptional-attribute', type: 'positive', karma: 14, target: 'str', ref: SR5(72) },
      { name: 'Registered Identity', catalogueId: 'quality-registered-identity', type: 'negative', karma: 5, ref: SR5(84) },
      { name: 'Fast Mender', catalogueId: 'quality-fast-mender', type: 'positive', karma: 3, ref: SR5(77) },
      { name: 'Will to Live', catalogueId: 'quality-will-to-live', type: 'positive', karma: 3, rating: 1, ref: SR5(77) },
      { name: 'Loud Reputation', catalogueId: 'quality-loud-reputation', type: 'negative', karma: 7, ref: SR5(79) },
      { name: 'Glitch Magnet', catalogueId: 'quality-glitch-magnet', type: 'negative', karma: 8, rating: 2, ref: SR5(81) },
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
        { name: 'Army Regulations', category: 'professional', points: 3 },
        { name: 'Fixers', category: 'street', points: 1 },
        { name: 'Runner Bars', category: 'street', points: 1 },
        { name: 'Tribal Lands', category: 'professional', points: 2 },
        { name: 'Street Clinics', category: 'street', points: 2 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Lakota', points: 1 },
      ],
    },
    // The p. 97 table, lumped: 55,190¥ of gear and 12,000¥ of lifestyle.
    purchases: [
      gear('Rifle and two pistols', 2_885),
      gear('Sword and knuckles', 1_100),
      armorJacket(2_000),
      {
        list: 'augments',
        kind: 'cyberware',
        name: 'Reflex boosters',
        cost: 26_000,
        essence: 0.6,
        rating: 2,
        grade: 'standard',
        item: { name: 'Reflex boosters', essence: 0.6, mods: [mod('attr.rea', 2, 'cyberware')] },
      } as BuildPurchaseInput,
      {
        list: 'augments',
        kind: 'cyberware',
        name: 'Laced bones',
        cost: 8_000,
        essence: 0.5,
        grade: 'standard',
        item: { name: 'Laced bones', essence: 0.5, mods: [] },
      } as BuildPurchaseInput,
      gear('Ammunition and clips', 1_185),
      gear('Grenades', 800),
      gear('Vision lenses', 1_400),
      fakeSin(4),
      gear('Fake gun licence', 800, { rating: 4 }),
      gear('Credstick', 20),
      commlink('Commlink', 1_000, 3),
    ],
    lifestyles: [{ tier: 'low', name: 'Low', months: 3 }],
    karma: {
      toNuyen: 10,
      spends: [
        { kind: 'skill', id: 'perception', from: 1, to: 2 },
        { kind: 'skill', id: 'heavy-weapons', from: 1, to: 2 },
        { kind: 'skill', id: 'first-aid', from: 2, to: 3 },
        ...(options.lastLanguageRaise ? [{ kind: 'language' as const, name: 'Lakota', from: 1, to: 2 }] : []),
      ],
      contacts: [
        { name: 'Sutures', role: 'Street doc', connection: 3, loyalty: 2 },
        { name: 'Tally', role: 'Fixer', connection: 2, loyalty: 2 },
      ],
    },
    identity: { alias: 'Bulwark', background: 'Mustered out, then found the other side paid on time.' },
  });
}

/** The elf mystic adept (SR5 pp. 64, 67, 70, 86, 92, 97, 99–100, 102). Settings: `EXPERIENCED`. */
function undertow(options: { voicePower?: boolean } = {}): CharacterBuild {
  const { voicePower = true } = options;
  const spell = (name: string, category: string) => ({ name, category });
  return make({
    priorities: { metatype: 'D', attributes: 'B', magic: 'A', skills: 'C', resources: 'E' },
    metatype: 'elf',
    attributes: { bod: 2, agi: 4, rea: 2, str: 1, wil: 3, log: 2, int: 3, cha: 3 },
    magic: { kind: 'mysticAdept', tradition: 'shamanic', mentor: 'The Deep' },
    grants: {
      skills: [
        { id: 'spellcasting', rating: 5 },
        { id: 'counterspelling', rating: 5 },
      ],
      spells: [
        spell('Lie Sniffer', 'detection'),
        spell('Knockback', 'combat'),
        spell('Distant Ear', 'detection'),
        spell('Thump', 'combat'),
        spell('Close Wound', 'health'),
        spell('Vanish', 'illusion'),
        spell('Nudge', 'manipulation'),
        spell('Arc Strike', 'combat'),
        spell('Thought Dig', 'detection'),
        spell('Blackout Burst', 'combat'),
      ],
    },
    // p. 70's five powers at the powers chapter's prices (pp. 309–311).
    powers: [
      { name: 'Steady Aim', cost: 0.25, target: 'automatics', ref: SR5(309) },
      { name: 'Honed Skill', cost: 0.5, target: 'pistols', ref: SR5(309), mods: [mod('pool.skill.pistols', 1, 'power')] },
      { name: 'Poise', cost: 0.5, target: 'social', ref: SR5(309), mods: [mod('limit.social', 1, 'power')] },
      { name: 'Ward Skin', cost: 0.5, ref: SR5(310), mods: [mod('armor', 1, 'power')] },
      ...(voicePower ? [{ name: 'Commanding Voice', cost: 0.5, ref: SR5(311) }] : []),
    ],
    // Picked from the books (a catalogue id each): nothing here is a hand-written line for the GM.
    qualities: [
      { name: 'Focused Concentration', catalogueId: 'quality-focused-concentration', type: 'positive', karma: 8, rating: 2, ref: SR5(74) },
      { name: 'Mentor Spirit', catalogueId: 'quality-mentor-spirit', type: 'positive', karma: 5, ref: SR5(76) },
      { name: 'Sworn Code', catalogueId: 'quality-sworn-code', type: 'negative', karma: 15, ref: SR5(79) },
      { name: 'Distinctive Style', catalogueId: 'quality-distinctive-style', type: 'negative', karma: 5, ref: SR5(80) },
      { name: 'Habit (mild)', catalogueId: 'quality-habit-mild', type: 'negative', karma: 4, ref: SR5(77) },
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
        { name: 'Patrol Tactics', category: 'street', points: 2 },
        { name: 'Syndicates', category: 'street', points: 1 },
        { name: 'Corner Dealers', category: 'street', points: 2 },
        { name: 'Gang Colours', category: 'street', points: 3 },
        { name: 'Gang Politics', category: 'street', points: 3 },
      ],
      languages: [
        { name: 'English', native: true },
        { name: 'Cantonese', points: 2 },
      ],
    },
    // The p. 97 table, lumped: 20,360¥ of gear and 4,000¥ of lifestyle.
    purchases: [
      gear('Three sidearms', 1_440),
      armorJacket(1_000),
      commlink('Commlink', 1_000, 3),
      gear('Motorbike', 5_000),
      gear('Habit supply', 75),
      fakeSin(3),
      gear('Fake licences', 2_000),
      gear('Ammunition', 575),
      gear('Lock tools and welder', 1_750),
      gear('Credstick', 20),
    ],
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
        { name: 'Rook', role: 'Gang lieutenant', connection: 3, loyalty: 3 },
        { name: 'Kestrel', role: 'Gang member', connection: 1, loyalty: 2 },
        { name: 'Sweets', role: 'Dealer', connection: 1, loyalty: 1 },
        { name: 'Madame Oriel', role: 'Talisman seller', connection: 2, loyalty: 1 },
        { name: 'Stitchwork', role: 'Street doc', connection: 3, loyalty: 1 },
      ],
    },
    identity: { alias: 'Undertow', background: 'Rode with a gang until the tide started answering her.' },
  });
}

// ---------------------------------------------------------------------------
// Relay — the human technomancer
// ---------------------------------------------------------------------------

describe('golden: the human technomancer, D/C/B/E/A on the Run Faster printing (SR5 p.64–102, RF p.63)', () => {
  const s = EXPERIENCED_RF;
  const b = relay();
  const t = tallyBuild(b, s);
  const { pools, preview } = budgets(b, s);
  const karmaAt = (step: number): number => tallyBuild(upTo(b, step), s).karmaRemaining;

  it('step 3 (p.67): D gives a human 3 special points — Resonance 2, Edge 2 → 3; C gives 16 attribute points, all spent', () => {
    expect(pools.special).toEqual({ available: 3, spent: 3, remaining: 0 });
    expect(pools.attributes).toEqual({ available: 16, spent: 16, remaining: 0 });
    expect(coreAttributes(b, s).map((a) => [a.base, a.points, a.rating])).toEqual([
      [1, 2, 3],
      [1, 1, 2],
      [1, 1, 2],
      [1, 2, 3],
      [1, 2, 3],
      [1, 3, 4],
      [1, 3, 4],
      [1, 2, 3],
    ]);
    expect(t.ratings.attributes.edg).toMatchObject({ base: 2, points: 1, rating: 3, max: 7 });
    // Before the Resonance column is chosen the rating is the points alone: p.67's "0/6 2 2".
    expect(ratings(upTo(b, 3), s).attributes.res).toMatchObject({ base: 0, points: 2, rating: 2, max: 6 });
    expect(karmaAt(3)).toBe(25);
  });

  it('step 4 (p.70): B gives Resonance 4 + 2 = 6, two rating-4 Resonance skills and 2 complex forms (RF p.63)', () => {
    expect(t.tables.magicOption).toMatchObject({
      kind: 'technomancer',
      rating: 4,
      skills: { count: 2, rating: 4, pool: { kind: 'category', category: 'resonance' } },
      forms: 2,
    });
    expect(t.ratings.attributes.res).toMatchObject({ base: 4, points: 2, rating: 6 });
    expect(preview?.resonance).toBe(6);
    expect(t.ratings.skills.filter((k) => k.grant > 0).map((k) => [k.id, k.rating])).toEqual([
      ['compiling', 4],
      ['registering', 4],
    ]);
    // The 2 granted forms and the one bought on step 8, against Resonance × 2 (p.98).
    expect(pools.forms).toEqual({ available: 12, spent: 3, remaining: 9 });
    expect(karmaAt(4)).toBe(25);
  });

  it('step 4 on the core printing: the same row wants three skills and four forms, so one skill and two forms go unclaimed (SR5 p.65)', () => {
    const core = vary(b, (x) => void (x.table = 'sr5'));
    expect(errorsOf(core, EXPERIENCED)).toEqual(['error grant-skills-unfilled @4', 'error grant-forms-unfilled @4']);
  });

  it('step 5 (p.86): 19 Karma of positive qualities and 20 of negative take 25 Karma to 26', () => {
    expect([t.positiveKarma, t.negativeKarma]).toEqual([19, 20]);
    expect(pools.positiveQualities).toEqual({ available: 25, spent: 19, remaining: 6 });
    expect(pools.negativeQualities).toEqual({ available: 25, spent: 20, remaining: 5 });
    expect(t.effects.dependentsMultiplier).toBe(1.2);
    expect(karmaAt(5)).toBe(26);
  });

  it('step 6 (p.91): E gives 18 skill points and no group points; (INT 4 + LOG 4) × 2 = 16 knowledge points', () => {
    expect(pools.skills).toEqual({ available: 18, spent: 18, remaining: 0 });
    expect(pools.groups).toEqual({ available: 0, spent: 0, remaining: 0 });
    expect(pools.knowledge).toEqual({ available: 16, spent: 16, remaining: 0 });
    expect(t.ratings.languages.map((l) => [l.name, l.native, l.rating])).toEqual([
      ['English', true, 0],
      ['Japanese', false, 1],
    ]);
    expect(karmaAt(6)).toBe(26);
  });

  it('step 7 (p.96): A gives 450,000¥; Dependents makes the lifestyles 72,000 + 7,200 (p.80); 5,000¥ carries, 70,245¥ is lost', () => {
    expect(compileBuild(b, s).sheet.lifestyles).toEqual([
      { name: 'Middle', costPerMonth: 6_000 },
      { name: 'Low (safehouse)', costPerMonth: 2_400 },
    ]);
    expect(pools.nuyen).toEqual({ available: 450_000, spent: 374_755, remaining: 75_245 });
    expect(preview).toMatchObject({ nuyenCarried: 5_000, nuyenLost: 70_245, startingNuyen: { dice: 4, multiplier: 100 } });
    expect(karmaAt(7)).toBe(26);
  });

  it("step 7: the printed 4,995¥ carry-over is out of reach — the example's own prices leave 9,785, and with Dependents they overspend by 3,415", () => {
    const asPrinted = relay({ ammoAsPrinted: true, dependents: false });
    expect(budgets(asPrinted, s).pools.nuyen).toEqual({ available: 450_000, spent: 440_215, remaining: 9_785 });
    expect(budgets(asPrinted, s).preview?.nuyenCarried).toBe(5_000);
    const withDependents = relay({ ammoAsPrinted: true });
    expect(tallyBuild(withDependents, s).nuyenRemaining).toBe(-3_415);
    expect(errorsOf(withDependents, s)).toEqual(['error nuyen-overspent @7']);
  });

  it('step 8 (p.99): 26 Karma buys Cybercombat 2 and Software 2 (6 each), Electronic Warfare 1 → 2 (4), a form (4), two sprites of 3 tasks (3 each)', () => {
    expect(t.spendCosts).toEqual([6, 6, 4, 4, 3, 3]);
    expect(pools.karma).toEqual({ available: 45, spent: 45, remaining: 0 });
    expect(karmaAt(8)).toBe(0);
    expect(preview).toMatchObject({ karmaCarried: 0, karmaLost: 0 });
    expect(t.ratings.skills.filter((k) => k.karma > 0).map((k) => [k.id, k.creation, k.rating])).toEqual([
      ['electronic-warfare', 1, 2],
      ['cybercombat', 0, 2],
      ['software', 0, 2],
    ]);
    // Sprites register at Level = Resonance 6 (p.98).
    expect(compileBuild(b, s).sprites).toEqual([
      { spriteType: 'crack', level: 6, tasks: 3, registered: true },
      { spriteType: 'fault', level: 6, tasks: 3, registered: true },
    ]);
    // Charisma 3 × 3 = 9 contact Karma: 4 + 2 + 3.
    expect(pools.contactKarma).toEqual({ available: 9, spent: 9, remaining: 0 });
    expect(t.contactKarma).toEqual([4, 2, 3]);
  });

  it('opens play with 0 Karma and 4D6 × 100 + 5,000¥: 7,200¥ on the 22 that gives the book 7,195 (p.95–96)', () => {
    const roll = fixedDice([6, 5, 6, 5]);
    expect(roll).toBe(22);
    expect(compileBuild(b, s, { startingNuyenRoll: roll }).opening).toEqual({
      karma: 0,
      nuyenCarry: 5_000,
      startingNuyen: { dice: 4, multiplier: 100, total: 7_200 },
    });
  });

  it('final calculations (p.101–102): initiative 6 + 1D6, VR 8 + 3D6 and 8 + 4D6, limits 5-4-5, monitors 10-10-3, Essence 6, movement 4/8', () => {
    const d = deriveCharacter(compileBuild(b, s).sheet);
    expect([d.initiative.physical.base.value, d.initiative.physical.dice.value]).toEqual([6, 1]);
    expect([d.initiative.vrCold.base.value, d.initiative.vrCold.dice.value]).toEqual([8, 3]);
    expect([d.initiative.vrHot.base.value, d.initiative.vrHot.dice.value]).toEqual([8, 4]);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 4, 5]);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([10, 10, 3]);
    expect([d.attributes['ess']?.value, d.attributes['res']?.value]).toEqual([6, 6]);
    expect([d.movement.walk.value, d.movement.run.value]).toEqual([4, 8]);
  });

  it('living persona by the p.101 table: Attack 3, Sleaze 4, Data Processing 4, Firewall 3, Device Rating 6 (p.102 prints 5/6/6/5/6)', () => {
    const persona = deriveCharacter(compileBuild(b, s).sheet).livingPersona;
    expect(persona && Object.fromEntries(Object.entries(persona).map(([k, v]) => [k, v.value]))).toEqual({
      attack: 3,
      sleaze: 4,
      dataProcessing: 4,
      firewall: 3,
      deviceRating: 6,
    });
  });

  it('validates with no errors: the lost nuyen warns, the forbidden SINs wait on the GM, and every step is complete', () => {
    expect(brief(validate(b, s))).toEqual(['warning nuyen-carry-lost @7', 'approval approval-gear-fake-sin @7']);
    expect(lockedThrough(b, s, 9)).toEqual([]);
  });

  it("walks the steps in the book's order with nothing locked on any step already reached", () => {
    for (let step = 3; step <= 8; step++) {
      expect(errorsThrough(upTo(b, step), s, step), `step ${step}`).toEqual([]);
      expect(lockedThrough(upTo(b, step), s, step), `step ${step}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Bulwark — the troll street samurai
// ---------------------------------------------------------------------------

describe('golden: the troll street samurai, B/A/E/C/D (SR5 p.64–110)', () => {
  const s = EXPERIENCED;
  const b = bulwark();
  const t = tallyBuild(b, s);
  const { pools, preview } = budgets(b, s);
  const karmaAt = (step: number): number => tallyBuild(upTo(b, step), s).karmaRemaining;

  it('step 3 (p.67): B gives a troll no special points; A gives 24 attribute points; STR 5 + 6 = 11 against Exceptional Attribute\'s 11', () => {
    expect(pools.special).toEqual({ available: 0, spent: 0, remaining: 0 });
    expect(pools.attributes).toEqual({ available: 24, spent: 24, remaining: 0 });
    expect(coreAttributes(b, s).map((a) => [a.base, a.points, a.rating])).toEqual([
      [5, 4, 9],
      [1, 3, 4],
      [1, 2, 3],
      [5, 6, 11],
      [1, 3, 4],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    // Exceptional Attribute lifts Strength's maximum by one (p.72); no other attribute is at its maximum.
    expect(t.ratings.attributes.str).toMatchObject({ max: 11, tableMax: 10 });
    expect(coreAttributes(b, s).filter((a) => a.rating >= a.tableMax).map((a) => a.id)).toEqual(['str']);
    expect(t.ratings.attributes.edg).toMatchObject({ base: 1, points: 0, rating: 1 });
    expect(karmaAt(3)).toBe(25);
  });

  it("step 3 before step 5: STR 11 waits on the Exceptional Attribute step 5 takes, so a guided walk is never locked out of the step that fixes it (SR5 p.64, p.66, p.72)", () => {
    // At step 3 the one point over is filed where the quality is taken.
    expect(validate(upTo(b, 3), s).filter((i) => i.code === 'attribute-over-max')).toMatchObject([
      { severity: 'error', step: 5, path: 'qualities', ref: { book: 'SR5', page: 72 } },
    ]);
    // Guided, in the book's order: Next opens on step 3 and on step 4 with the build as it stood there…
    for (const step of [3, 4]) {
      expect(errorsThrough(upTo(b, step), s, step), `step ${step}`).toEqual([]);
      expect(lockedThrough(upTo(b, step), s, step), `step ${step}`).toEqual([]);
    }
    // …step 5 is where it waits until the quality is in…
    expect(lockedThrough(upTo(b, 4), s, 5)).toEqual([5]);
    // …and taking it settles the step.
    expect(errorsThrough(upTo(b, 5), s, 5)).toEqual([]);
    expect(lockedThrough(upTo(b, 5), s, 5)).toEqual([]);
  });

  it('step 3 before step 5, a point moved from Strength to Body: two at their maximum wait on the same quality, so the guided walk is not locked either (SR5 p.66, p.72)', () => {
    const moved = vary(b, (c) => {
      c.attributes.str -= 1;
      c.attributes.bod += 1;
    });
    expect(coreAttributes(upTo(moved, 3), s).filter((a) => a.rating >= a.tableMax).map((a) => a.id)).toEqual(['bod', 'str']);
    expect(validate(upTo(moved, 3), s).filter((i) => i.code === 'attribute-max-more-than-one')).toMatchObject([
      { severity: 'error', step: 5, path: 'qualities', ref: { book: 'SR5', page: 72 } },
    ]);
    for (const step of [3, 4]) {
      expect(errorsThrough(upTo(moved, step), s, step), `step ${step}`).toEqual([]);
      expect(lockedThrough(upTo(moved, step), s, step), `step ${step}`).toEqual([]);
    }
    expect(lockedThrough(upTo(moved, 4), s, 5)).toEqual([5]);
    expect(errorsThrough(upTo(moved, 5), s, 5)).toEqual([]);
    expect(lockedThrough(upTo(moved, 5), s, 5)).toEqual([]);
  });

  it('step 4 (p.70): priority E — nothing to choose, and the walkthrough skips the step', () => {
    expect(t.tables.magicOption).toBeNull();
    expect(t.tables.rows.magic?.magic).toEqual([]);
    expect(stepStatus(b, s)[3]).toMatchObject({ name: 'magic', skipped: true, complete: true });
    expect(karmaAt(4)).toBe(25);
  });

  it('step 5 (p.86): 20 Karma of positive qualities and 20 of negative leave 25', () => {
    expect([t.positiveKarma, t.negativeKarma]).toEqual([20, 20]);
    expect(pools.positiveQualities).toEqual({ available: 25, spent: 20, remaining: 5 });
    expect(pools.negativeQualities).toEqual({ available: 25, spent: 20, remaining: 5 });
    expect([t.effects.exceptionalAttribute, t.effects.willToLive]).toEqual(['str', 1]);
    expect(karmaAt(5)).toBe(25);
  });

  it('step 6 (p.92): C gives 28 skill points and 2 group points; (INT 3 + LOG 3) × 2 = 12 knowledge points', () => {
    expect(pools.skills).toEqual({ available: 28, spent: 28, remaining: 0 });
    expect(pools.groups).toEqual({ available: 2, spent: 2, remaining: 0 });
    expect(pools.knowledge).toEqual({ available: 12, spent: 12, remaining: 0 });
    expect(t.ratings.groups.map((g) => [g.id, g.rating])).toEqual([['athletics', 2]]);
    expect(karmaAt(6)).toBe(25);
  });

  it('step 7 (p.97): 50,000¥ and 10 Karma converted make 70,000; Low at double cost; 2,810¥ carries and 15 Karma is left', () => {
    expect(pools.nuyen).toEqual({ available: 70_000, spent: 67_190, remaining: 2_810 });
    expect(compileBuild(b, s).sheet.lifestyles).toEqual([{ name: 'Low', costPerMonth: 4_000 }]);
    expect(preview).toMatchObject({
      essence: 4.9,
      lifestyleMultiplier: 2,
      nuyenCarried: 2_810,
      nuyenLost: 0,
      startingNuyen: { dice: 3, multiplier: 60 },
    });
    expect(karmaAt(7)).toBe(15);
  });

  it('step 8 (p.99): Perception 1 → 2 (4), Heavy Weapons 1 → 2 (4), First Aid 2 → 3 (6) leave 1 Karma, which carries (p.106)', () => {
    expect(t.spendCosts).toEqual([4, 4, 6]);
    expect(pools.karma).toEqual({ available: 45, spent: 44, remaining: 1 });
    expect(karmaAt(8)).toBe(1);
    expect(preview?.karmaCarried).toBe(1);
    // Charisma 3 × 3 = 9 contact Karma: 5 + 4.
    expect(pools.contactKarma).toEqual({ available: 9, spent: 9, remaining: 0 });
    expect(t.contactKarma).toEqual([5, 4]);
  });

  it("step 8: the example's last language raise (1 → 2 for 2 Karma) is one more than 15 − 14 leaves", () => {
    const over = bulwark({ lastLanguageRaise: true });
    expect(tallyBuild(over, s).karmaRemaining).toBe(-1);
    expect(errorsOf(over, s)).toEqual(['error karma-overspent @8']);
  });

  it('opens play with 1 Karma and 3D6 × 60 + 2,810¥: 3,530¥ on the 12 that gives the book 3,505 (p.95, p.97)', () => {
    expect(compileBuild(b, s, { startingNuyenRoll: fixedDice([4, 4, 4]) }).opening).toEqual({
      karma: 1,
      nuyenCarry: 2_810,
      startingNuyen: { dice: 3, multiplier: 60, total: 3_530 },
    });
  });

  it('final calculations (p.101–102, p.110): initiative 6 (8) + 1D6, limits 5-12-5, monitors 13-10-10, Essence 4.9, movement 8/16', () => {
    const { sheet } = compileBuild(b, s);
    const d = deriveCharacter(sheet);
    expect([sheet.attributes.rea, d.attributes['rea']?.value]).toEqual([3, 5]);
    expect(sheet.attributes.rea + sheet.attributes.int).toBe(6);
    expect([d.initiative.physical.base.value, d.initiative.physical.dice.value]).toEqual([8, 1]);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 12, 5]);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([13, 10, 10]);
    expect(d.attributes['ess']?.value).toBeCloseTo(4.9, 10);
    expect([d.movement.walk.value, d.movement.run.value]).toEqual([8, 16]);
    expect(d.livingPersona).toBeNull();
    // A troll's dermal armor over the jacket (p.66): 12 + 1.
    expect(d.pools['armor']?.total).toBe(13);
  });

  it('validates with no errors: Exceptional Attribute and the forbidden SIN wait on the GM, and every step is complete', () => {
    expect(brief(validate(b, s))).toEqual([
      'approval approval-quality-exceptional-attribute-str @5',
      'approval approval-gear-fake-sin @7',
    ]);
    expect(lockedThrough(b, s, 9)).toEqual([]);
    for (let step = 5; step <= 8; step++) expect(lockedThrough(upTo(b, step), s, step), `step ${step}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Undertow — the elf mystic adept
// ---------------------------------------------------------------------------

describe('golden: the elf mystic adept, D/B/A/C/E (SR5 p.64–102)', () => {
  const s = EXPERIENCED;
  const b = undertow();
  const t = tallyBuild(b, s);
  const { pools, preview } = budgets(b, s);
  const karmaAt = (step: number): number => tallyBuild(upTo(b, step), s).karmaRemaining;

  it('step 3 (p.67): D gives an elf no special points; B gives 20 attribute points; none at its maximum', () => {
    expect(pools.special).toEqual({ available: 0, spent: 0, remaining: 0 });
    expect(pools.attributes).toEqual({ available: 20, spent: 20, remaining: 0 });
    expect(coreAttributes(b, s).map((a) => [a.base, a.points, a.rating, a.max])).toEqual([
      [1, 2, 3, 6],
      [2, 4, 6, 7],
      [1, 2, 3, 6],
      [1, 1, 2, 6],
      [1, 3, 4, 6],
      [1, 2, 3, 6],
      [1, 3, 4, 6],
      [3, 3, 6, 8],
    ]);
    expect(t.ratings.attributes.edg).toMatchObject({ base: 1, points: 0, rating: 1 });
    expect(karmaAt(3)).toBe(25);
  });

  it('step 4 (p.70): A gives Magic 6, two rating-5 magical skills and 10 spells; 10 Karma buys 2 power points', () => {
    expect(t.tables.magicOption).toMatchObject({
      kind: 'mysticAdept',
      rating: 6,
      skills: { count: 2, rating: 5, pool: { kind: 'category', category: 'magical' } },
      formulae: 10,
    });
    expect(t.ratings.attributes.mag).toMatchObject({ base: 6, points: 0, rating: 6 });
    expect(preview?.magic).toBe(6);
    expect(t.ratings.skills.filter((k) => k.grant > 0).map((k) => [k.id, k.rating])).toEqual([
      ['spellcasting', 5],
      ['counterspelling', 5],
    ]);
    expect(pools.spells).toEqual({ available: 12, spent: 10, remaining: 2 });
    expect(t.spendCosts[0]).toBe(10);
    expect(karmaAt(4)).toBe(15);
  });

  it('step 4: the five powers cost 2.25 of the 2 power points by pp.309–311; without the voice power, 1.75', () => {
    expect(pools.powerPoints).toEqual({ available: 2, spent: 2.25, remaining: -0.25 });
    expect(budgets(undertow({ voicePower: false }), s).pools.powerPoints).toEqual({ available: 2, spent: 1.75, remaining: 0.25 });
  });

  it('step 5 (p.86): 13 Karma of positive qualities — the power points are not a quality — and 24 of negative leave 26', () => {
    expect([t.positiveKarma, t.negativeKarma]).toEqual([13, 24]);
    expect(pools.positiveQualities).toEqual({ available: 25, spent: 13, remaining: 12 });
    expect(pools.negativeQualities).toEqual({ available: 25, spent: 24, remaining: 1 });
    expect(karmaAt(5)).toBe(26);
  });

  it('step 6 (p.92): C gives 28 skill points and 2 group points; (INT 4 + LOG 3) × 2 = 14 knowledge points', () => {
    expect(pools.skills).toEqual({ available: 28, spent: 28, remaining: 0 });
    expect(pools.groups).toEqual({ available: 2, spent: 2, remaining: 0 });
    expect(pools.knowledge).toEqual({ available: 14, spent: 14, remaining: 0 });
    expect(t.ratings.groups.map((g) => [g.id, g.rating])).toEqual([['conjuring', 2]]);
    expect(karmaAt(6)).toBe(26);
  });

  it('step 7 (p.97): 6,000¥ and 10 Karma converted make 26,000; 1,640¥ carries and 16 Karma is left', () => {
    expect(pools.nuyen).toEqual({ available: 26_000, spent: 24_360, remaining: 1_640 });
    expect(preview).toMatchObject({ nuyenCarried: 1_640, nuyenLost: 0, startingNuyen: { dice: 3, multiplier: 60 } });
    expect(karmaAt(7)).toBe(16);
  });

  it('step 8 (p.99–100): Etiquette 2 → 3 (6) and two bound spirits of 4 services (8) leave 2 Karma, carried; 18 contact Karma', () => {
    expect(t.spendCosts).toEqual([10, 6, 4, 4]);
    expect(pools.karma).toEqual({ available: 49, spent: 47, remaining: 2 });
    expect(karmaAt(8)).toBe(2);
    expect(preview?.karmaCarried).toBe(2);
    // Bound at Force = Magic 6 (p.98).
    expect(compileBuild(b, s).spirits).toEqual([
      { spiritType: 'water', force: 6, services: 4, bound: true },
      { spiritType: 'beasts', force: 6, services: 4, bound: true },
    ]);
    // Charisma 6 × 3 = 18 contact Karma: 6 + 3 + 2 + 3 + 4.
    expect(pools.contactKarma).toEqual({ available: 18, spent: 18, remaining: 0 });
    expect(t.contactKarma).toEqual([6, 3, 2, 3, 4]);
  });

  it('opens play with 2 Karma and 3D6 × 60 + 1,640¥ — the printed 2,225 needs 9.75 on the dice; 10 gives 2,240 and 9 gives 2,180', () => {
    expect(compileBuild(b, s, { startingNuyenRoll: fixedDice([3, 3, 4]) }).opening).toEqual({
      karma: 2,
      nuyenCarry: 1_640,
      startingNuyen: { dice: 3, multiplier: 60, total: 2_240 },
    });
    expect(compileBuild(b, s, { startingNuyenRoll: fixedDice([3, 3, 3]) }).opening.startingNuyen.total).toBe(2_180);
  });

  it('final calculations (p.101–102): initiative 7 + 1D6, astral 8 + 2D6, limits 5-4-8 (9), monitors 10-10-3, Essence 6, movement 12/24 (p.110)', () => {
    const { sheet, awakening } = compileBuild(b, s);
    const d = deriveCharacter(sheet);
    expect([d.initiative.physical.base.value, d.initiative.physical.dice.value]).toEqual([7, 1]);
    expect([d.initiative.astral.base.value, d.initiative.astral.dice.value]).toEqual([8, 2]);
    expect([d.limits.mental.value, d.limits.physical.value, d.limits.social.value]).toEqual([5, 4, 9]);
    const natural = d.limits.social.breakdown.filter((e) => e.source !== 'power').reduce((sum, e) => sum + e.value, 0);
    expect(natural).toBe(8);
    expect([d.monitors.physical.value, d.monitors.stun.value, d.monitors.overflow.value]).toEqual([10, 10, 3]);
    expect([d.attributes['ess']?.value, d.attributes['mag']?.value]).toEqual([6, 6]);
    expect([d.movement.walk.value, d.movement.run.value]).toEqual([12, 24]);
    expect(d.livingPersona).toBeNull();
    expect(awakening).toMatchObject({ kind: 'mysticAdept', tradition: 'shamanic', drain: ['cha', 'wil'], powerPoints: 2 });
  });

  it('validates with exactly the two documented errors — the over-spent power points and Assensing without astral perception', () => {
    expect(brief(validate(b, s))).toEqual([
      'error power-points-over @4',
      'error assensing-needs-astral @6',
      'approval approval-gear-fake-sin @7',
    ]);
    expect(lockedThrough(b, s, 9)).toEqual([4, 6, 9]);
    expect(errorsOf(undertow({ voicePower: false }), s)).toEqual(['error assensing-needs-astral @6']);
  });

  it("walks the steps in the book's order, each documented error appearing on the step that makes it", () => {
    expect(errorsThrough(upTo(b, 3), s, 3)).toEqual([]);
    for (const step of [4, 5]) expect(errorsThrough(upTo(b, step), s, step), `step ${step}`).toEqual(['error power-points-over @4']);
    for (const step of [6, 7, 8]) {
      expect(errorsThrough(upTo(b, step), s, step), `step ${step}`).toEqual([
        'error power-points-over @4',
        'error assensing-needs-astral @6',
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// All three
// ---------------------------------------------------------------------------

describe('goldens: what every worked character compiles to', () => {
  const all: readonly [string, CharacterBuild, ChargenSettings][] = [
    ['technomancer', relay(), EXPERIENCED_RF],
    ['samurai', bulwark(), EXPERIENCED],
    ['mystic adept', undertow(), EXPERIENCED],
  ];

  it('each compiles to a sheet SheetV1Schema accepts unchanged, derives to a DerivedCharacterSchema, and budgets to a BudgetsSchema', () => {
    for (const [name, b, s] of all) {
      const { sheet, issues } = compileBuild(b, s);
      expect(SheetV1Schema.parse(sheet), name).toEqual(sheet);
      const derived = deriveCharacter(sheet);
      expect(DerivedCharacterSchema.parse(derived), name).toEqual(derived);
      const budget = budgets(b, s);
      expect(BudgetsSchema.parse(budget), name).toEqual(budget);
      expect(issues, name).toEqual(validate(b, s));
    }
  });

  it('each sheet carries the ratings the build adds up to, Karma raises applied', () => {
    for (const [name, b, s] of all) {
      const { sheet } = compileBuild(b, s);
      const r = ratings(b, s);
      for (const code of ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const) {
        expect(sheet.attributes[code], `${name} ${code}`).toBe(r.attributes[code].rating);
      }
      expect([sheet.attributes.edg.max, sheet.attributes.mag, sheet.attributes.res], name).toEqual([
        r.attributes.edg.rating,
        r.attributes.mag.rating,
        r.attributes.res.rating,
      ]);
      const rated = Object.fromEntries(r.skills.filter((k) => k.rating > 0).map((k) => [k.id, k.rating]));
      expect(Object.fromEntries(sheet.skills.map((k) => [k.id, k.rating])), name).toEqual(rated);
      expect(sheet.knowledge.map((k) => [k.name, k.rating]), name).toEqual(r.knowledge.map((k) => [k.name, k.rating]));
    }
  });
});

// ---------------------------------------------------------------------------
// Regressions the goldens found
// ---------------------------------------------------------------------------

describe('regressions the goldens found', () => {
  it("special points put on Resonance before the Resonance column is chosen are step 4's to settle, not step 3's (SR5 p.67, p.70)", () => {
    const early = upTo(relay(), 3);
    expect(validate(early, EXPERIENCED_RF).find((i) => i.code === 'special-points-no-resonance')).toMatchObject({
      severity: 'error',
      step: 4,
      path: 'special.res',
    });
    const status = stepStatus(early, EXPERIENCED_RF);
    expect(status[2]).toMatchObject({ name: 'metatype', complete: true });
    expect(status[3]).toMatchObject({ name: 'magic', complete: false });
    // Choosing the type settles it.
    expect(validate(upTo(relay(), 4), EXPERIENCED_RF).some((i) => i.code === 'special-points-no-resonance')).toBe(false);
  });

  it("special points on Magic or Resonance stay step 3's when the Magic row offers nothing that would use them", () => {
    const mundaneRow = vary(upTo(relay(), 3), (x) => {
      x.priorities.magic = 'E';
      x.priorities.skills = 'B';
      x.special = { edg: 1, mag: 1, res: 1 };
    });
    expect(
      validate(mundaneRow, EXPERIENCED_RF)
        .filter((i) => i.code.startsWith('special-points-no-'))
        .map((i) => [i.code, i.step]),
    ).toEqual([
      ['special-points-no-magic', 3],
      ['special-points-no-resonance', 3],
    ]);
    // A row that offers Magic leaves the magic-using type to step 4.
    const magicRow = vary(upTo(relay(), 3), (x) => void (x.special = { edg: 2, mag: 1, res: 0 }));
    expect(validate(magicRow, EXPERIENCED_RF).find((i) => i.code === 'special-points-no-magic')?.step).toBe(4);
  });
});
