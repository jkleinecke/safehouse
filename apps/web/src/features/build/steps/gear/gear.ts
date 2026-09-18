/**
 * Step 7 — Gear, the part a node test can call (FR3.9, docs/CHARGEN.md §4.4
 * Step 7, §8.3 purchases and lifestyles).
 *
 * The Gear screen is a shopping trip with a budget, and a first-timer's
 * questions on it are all "what happens if": what does this cost at alphaware,
 * does a second one push Essence past where Magic starts to go, is a troll's
 * lifestyle really double, what is lost if 40,000¥ is left over. Every one of
 * those is the rules engine's to answer — `purchaseCost`, `purchaseEssence`,
 * `purchaseAvailability`, `lifestyleMonthlyCost`, `budgets`, `validate` — so
 * nothing here prices, caps or multiplies anything itself. What lives here is
 * the screen's own reading of those answers, pure so it can be tested as
 * functions (under `renderToStaticMarkup` nothing interactive runs):
 *
 * - the shelves the catalogue is browsed by, the "what most runners need"
 *   checklist — ticked from the engine's own warnings where it has one
 *   (commlink, fake SIN, lifestyle) and from the record's lists where it does
 *   not (armor, a weapon, ammunition, licences) — and the concept card's
 *   shopping list, each pointing at the shelf that sells it;
 * - the updaters a tap applies (`withPurchase`, `withPurchaseChange`,
 *   `withLifestyle` …), each `CharacterBuild → CharacterBuild`, as the step
 *   contract asks;
 * - a line's figures in words — unit price × quantity, Essence at its grade,
 *   Availability with the grade's modifier;
 * - what a candidate change would do before it is made (`quoteCandidate`):
 *   the error it would bring in that this step refuses, over the shell's
 *   `probe`; the errors it would bring in elsewhere, which it allows and
 *   names; and what it moves on the rail (the engine's `budgets` over the
 *   candidate) — so an implant that would take a point of Magic says so, with
 *   the numbers, before the tap.
 *
 * The one design call made here, not in the engine: an introduced *overspend*
 * is allowed and said — nuyen on this step, and whatever an implant's Essence
 * does to another step's pool (an adept's power points, a magician's spell
 * count) — because a player shopping often adds the thing they want first and
 * trims the rest after. A *cap* on this step refuses: Availability, device
 * rating, a grade not sold at creation, the +4 augmentation limit, Essence at
 * 0, Magic burned out, Karma converted past the level's limit.
 *
 * Numbers, ids and page refs only; every sentence is ours (DESIGN.md §14).
 */
import {
  AUGMENT_GRADES,
  LIFESTYLE_TIERS,
  type AugmentGrade,
  type BudgetPool,
  type Budgets,
  type BuildLifestyle,
  type BuildPurchase,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
  type LifestyleTier,
  type PriorityLevel,
  type PurchaseList,
  type Ref,
} from '@safehouse/contracts';
import {
  CREATION_GRADE_REF,
  IMPLANT_GRADES,
  LIFESTYLES,
  LIFESTYLE_METATYPE_REF,
  QUALITY_RULE_BY_ID,
  budgets as engineBudgets,
  catalogueWareFigures,
  conceptPreset,
  effectiveTables,
  issueRule,
  lifestyleMonthlyCost,
  purchaseAvailability,
  purchaseCost,
  purchaseEssence,
  startingLifestyle,
  validate,
  type ConceptGearKind,
  type QualityEffects,
} from '@safehouse/rules';
import type { CatalogueKind } from '../../../sheet/catalogue/api.js';
import { customHit, type CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import type { BuildProbe, BuildProber } from '../../analysis.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { hitRatingRange, hitToPurchase, purchaseListFor } from '../../kit/index.js';
import { formatNuyen } from '../../lib.js';

/** This step's number, for telling its own errors from another step's. */
export const GEAR_STEP = 7;

// ---------------------------------------------------------------------------
// Shelves: how the catalogue is browsed
// ---------------------------------------------------------------------------

export type ShelfId = 'weapons' | 'ammo' | 'armor' | 'ware' | 'electronics' | 'identity' | 'vehicles' | 'programs' | 'gear';

export interface Shelf {
  id: ShelfId;
  /** The catalogue kind the shelf browses. */
  kind: CatalogueKind;
  /** What its rows are called, in the picker's count line and search label. */
  label: string;
  /** What the search box opens with; empty browses the whole kind. */
  query: string;
}

/**
 * The shelves, in the order a runner usually shops. Fake SINs and licences
 * are ordinary gear rows in the catalogue (their table prints no device or
 * armor column), so their shelf is the gear kind opened on the one word both
 * kinds of row share.
 */
export const GEAR_SHELVES: readonly Shelf[] = [
  { id: 'weapons', kind: 'weapon', label: 'weapons', query: '' },
  { id: 'ammo', kind: 'ammo', label: 'ammunition', query: '' },
  { id: 'armor', kind: 'armor', label: 'armor', query: '' },
  { id: 'ware', kind: 'augmentation', label: 'cyberware & bioware', query: '' },
  { id: 'electronics', kind: 'electronics', label: 'commlinks & decks', query: '' },
  { id: 'identity', kind: 'gear', label: 'fake SINs & licences', query: 'fake' },
  { id: 'vehicles', kind: 'vehicle', label: 'vehicles & drones', query: '' },
  { id: 'programs', kind: 'program', label: 'programs', query: '' },
  { id: 'gear', kind: 'gear', label: 'other gear', query: '' },
];

export function shelfOf(id: ShelfId): Shelf {
  return GEAR_SHELVES.find((s) => s.id === id) ?? GEAR_SHELVES[0]!;
}

/** The kinds a hand-written purchase may be: every kind bought with nuyen. */
export const CUSTOM_KINDS: readonly CatalogueKind[] = ['weapon', 'ammo', 'armor', 'augmentation', 'electronics', 'vehicle', 'program', 'gear'];

// ---------------------------------------------------------------------------
// "What most runners need", and what the concept card suggested
// ---------------------------------------------------------------------------

export type ChecklistKey = 'commlink' | 'fakeSin' | 'licences' | 'armor' | 'weapon' | 'ammo' | 'lifestyle';

export interface ChecklistRow {
  key: ChecklistKey;
  label: string;
  done: boolean;
  /** The shelf that sells it; null for the lifestyle, which is chosen below the purchases. */
  shelf: ShelfId | null;
}

/** The engine's warning for each line it checks itself; a line is ticked while its warning is absent. */
const MISSING_CODE: Readonly<Partial<Record<ChecklistKey, string>>> = {
  commlink: 'commlink-missing',
  fakeSin: 'fake-sin-missing',
  lifestyle: 'lifestyle-missing',
};

/** Codes the checklist already says, so the step's own issue list does not say them twice. */
export const CHECKLIST_CODES: ReadonlySet<string> = new Set(Object.values(MISSING_CODE));

/**
 * The p. 94 list, ticked from what the build holds. Commlink, fake SIN and
 * lifestyle are the validator's own checks (`issues` is the step's); armor,
 * a weapon, ammunition and licences are read off the lists the purchases
 * landed on and the kind or name they carry.
 */
export function runnerChecklist(
  build: Pick<CharacterBuild, 'purchases' | 'lifestyles'>,
  issues: readonly Pick<Issue, 'code'>[],
): ChecklistRow[] {
  const missing = (key: ChecklistKey) => issues.some((i) => i.code === MISSING_CODE[key]);
  const any = (test: (p: BuildPurchase) => boolean) => build.purchases.some(test);
  return [
    { key: 'commlink', label: 'a commlink', done: !missing('commlink'), shelf: 'electronics' },
    { key: 'fakeSin', label: 'a fake SIN', done: !missing('fakeSin'), shelf: 'identity' },
    { key: 'licences', label: 'licences for what the SIN carries', done: any((p) => /licen[cs]e/i.test(p.name)), shelf: 'identity' },
    { key: 'armor', label: 'armor', done: any((p) => p.list === 'armor'), shelf: 'armor' },
    { key: 'weapon', label: 'a weapon', done: any((p) => p.list === 'weapons'), shelf: 'weapons' },
    { key: 'ammo', label: 'ammunition', done: any((p) => p.kind === 'ammo' || /\bammo|\brounds?\b/i.test(p.name)), shelf: 'ammo' },
    { key: 'lifestyle', label: 'a lifestyle', done: !missing('lifestyle'), shelf: null },
  ];
}

/** Which shelf sells each kind of thing a concept card asks for. */
const CONCEPT_SHELF: Readonly<Record<ConceptGearKind, ShelfId>> = {
  weapon: 'weapons',
  ammo: 'ammo',
  armor: 'armor',
  augment: 'ware',
  commlink: 'electronics',
  cyberdeck: 'electronics',
  rcc: 'electronics',
  drone: 'vehicles',
  vehicle: 'vehicles',
  electronics: 'electronics',
  identity: 'identity',
  tools: 'gear',
  medical: 'gear',
  magical: 'gear',
  gear: 'gear',
};

export interface ConceptSuggestion {
  /** The card's words for the thing ("heavy pistol"), never an item's name. */
  hint: string;
  qty: number;
  shelf: ShelfId;
}

/**
 * The shopping list the build's concept card suggests (§4.4 "a suggested
 * spend for every later step"), each pointing at its shelf. Empty for a
 * build with no card, or the blank card.
 */
export function conceptSuggestions(build: Pick<CharacterBuild, 'identity'>): { title: string; items: ConceptSuggestion[] } | null {
  const id = build.identity.concept;
  const preset = id ? conceptPreset(id) : null;
  if (!preset?.spend || preset.spend.gear.length === 0) return null;
  return {
    title: preset.title,
    items: preset.spend.gear.map((slot) => ({ hint: slot.hint, qty: slot.qty ?? 1, shelf: CONCEPT_SHELF[slot.kind] })),
  };
}

// ---------------------------------------------------------------------------
// Implant grades
// ---------------------------------------------------------------------------

export interface GradeOption {
  grade: AugmentGrade;
  /** "alphaware" — the grade's own word. */
  label: string;
  /** What it does to the list figures, in numbers. */
  detail: string;
  atCreation: boolean;
  /** "not at creation" with the page, for a grade a new runner cannot buy. */
  refusal: Refusal | null;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Every grade, the ones a new runner may buy first (standard, alphaware, used), from the grade table. */
export function gradeOptions(): GradeOption[] {
  const rows = AUGMENT_GRADES.map((grade) => IMPLANT_GRADES[grade]);
  return [...rows.filter((r) => r.atCreation), ...rows.filter((r) => !r.atCreation)].map((row) => ({
    grade: row.id,
    label: row.id,
    detail:
      row.id === 'standard'
        ? 'list Essence, price and Availability'
        : `Essence ×${row.essence} · price ×${row.cost} · Availability ${signed(row.availability)}`,
    atCreation: row.atCreation,
    refusal: row.atCreation ? null : { reason: 'not at creation', ref: CREATION_GRADE_REF },
  }));
}

// ---------------------------------------------------------------------------
// A purchase line in words
// ---------------------------------------------------------------------------

export interface LineFigures {
  /** One unit at its grade. */
  unit: number;
  /** Unit × grade × quantity (`purchaseCost`). */
  total: number;
  /** Essence the whole line costs at its grade (`purchaseEssence`); 0 off the augments list. */
  essence: number;
  /** "Availability 6R", or why no number can be read; null when none is printed. */
  availability: string | null;
}

/** Essence written the way the sheet writes it: up to four places, no trailing zeros. */
export function formatEssence(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

/** A purchase's Availability with its grade applied, in words. */
export function availabilityWords(p: BuildPurchase): string | null {
  const a = purchaseAvailability(p);
  switch (a.status) {
    case 'none':
      return null;
    case 'ok':
      return `Availability ${a.value}${a.legality ?? ''}`;
    case 'needsRating':
      return `Availability ${p.avail ?? ''}, needs a rating`;
    case 'relative':
      return `Availability ${p.avail ?? ''}, added to what it mounts on`;
    default:
      return `Availability ${p.avail ?? ''}`;
  }
}

export function lineFigures(p: BuildPurchase, effects?: Pick<QualityEffects, 'sensitiveSystem'>): LineFigures {
  return {
    unit: purchaseCost({ ...p, qty: 1 }),
    total: purchaseCost(p),
    essence: purchaseEssence(p, effects),
    availability: availabilityWords(p),
  };
}

/** "12,000¥" for one, "2,500¥ × 4 = 10,000¥" for several. */
export function priceWords(figures: Pick<LineFigures, 'unit' | 'total'>, qty: number): string {
  return qty > 1 ? `${formatNuyen(figures.unit)} × ${qty} = ${formatNuyen(figures.total)}` : formatNuyen(figures.total);
}

/** Everything a bought line shows under its name, in reading order. */
export function lineWords(p: BuildPurchase, effects?: Pick<QualityEffects, 'sensitiveSystem'>): string[] {
  const f = lineFigures(p, effects);
  return [
    priceWords(f, p.qty),
    ...(p.list === 'augments' && p.grade && p.grade !== 'standard' ? [p.grade] : []),
    ...(p.list === 'augments' ? [`Essence ${formatEssence(f.essence)}`] : []),
    ...(p.rating !== null ? [`rating ${p.rating}`] : []),
    ...(p.deviceRating !== undefined ? [`device rating ${p.deviceRating}`] : []),
    ...(f.availability ? [f.availability] : []),
  ];
}

// ---------------------------------------------------------------------------
// Purchases grouped by list
// ---------------------------------------------------------------------------

export const LIST_ORDER: readonly PurchaseList[] = ['weapons', 'armor', 'augments', 'gear'];

export const LIST_TITLE: Readonly<Record<PurchaseList, string>> = {
  weapons: 'Weapons',
  armor: 'Armor',
  augments: 'Cyberware & bioware',
  gear: 'Gear, electronics & the rest',
};

export interface PurchaseGroup {
  list: PurchaseList;
  title: string;
  lines: Array<{ purchase: BuildPurchase; index: number }>;
  /** Nuyen the group costs. */
  subtotal: number;
  /** Essence the group costs (augments only; 0 elsewhere). */
  essence: number;
}

/** The purchases by list, in `LIST_ORDER`, each line keeping its index in the record. Empty lists are left out. */
export function groupPurchases(purchases: readonly BuildPurchase[], effects?: Pick<QualityEffects, 'sensitiveSystem'>): PurchaseGroup[] {
  return LIST_ORDER.flatMap((list) => {
    const lines = purchases.map((purchase, index) => ({ purchase, index })).filter((l) => l.purchase.list === list);
    if (lines.length === 0) return [];
    let subtotal = 0;
    let essence = 0;
    for (const { purchase } of lines) {
      subtotal += purchaseCost(purchase);
      essence += purchaseEssence(purchase, effects);
    }
    return [{ list, title: LIST_TITLE[list], lines, subtotal, essence: Math.round(essence * 10_000) / 10_000 }];
  });
}

/** "Subtotal 14,500¥" and, for 'ware, "Essence 1.3". */
export function groupWords(group: PurchaseGroup): string {
  const essence = group.list === 'augments' ? ` · Essence ${formatEssence(group.essence)}` : '';
  return `${group.lines.length} ${group.lines.length === 1 ? 'line' : 'lines'} · ${formatNuyen(group.subtotal)}${essence}`;
}

/** The purchase index an issue's path points into ("purchases.3.avail" → 3), or null. */
export function lineIndexOf(path: string | undefined): number | null {
  const m = /^purchases\.(\d+)(?:\.|$)/.exec(path ?? '');
  return m ? Number(m[1]) : null;
}

/** The issues filed on one purchase line. */
export function issuesForLine(issues: readonly Issue[], index: number): Issue[] {
  return issues.filter((i) => lineIndexOf(i.path) === index);
}

/** The nuyen pool's own findings, which the nuyen panel states beside the pool. */
export const NUYEN_CODES: ReadonlySet<string> = new Set(['nuyen-overspent', 'karma-to-nuyen-over', 'nuyen-carry-lost']);

/**
 * The step's issues that belong to no single line, less what the screen
 * already says elsewhere: the checklist's three warnings and the nuyen
 * panel's own.
 */
export function stepWideIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => lineIndexOf(i.path) === null && !CHECKLIST_CODES.has(i.code) && !NUYEN_CODES.has(i.code));
}

export interface LineApproval {
  /** The approval issue as the engine raises it before any decision. */
  issue: Issue;
  decision: 'approved' | 'denied' | null;
}

/**
 * The GM's approval issues per line as the engine raises them before any
 * decision — so a decided line can still show what was decided, and a GM in
 * review can decide an undecided one. One `validate` over the record with its
 * approvals set aside; empty (and no validate) when nothing is bought.
 */
export function approvalsByLine(build: CharacterBuild, settings: ChargenSettings): Map<number, LineApproval[]> {
  const out = new Map<number, LineApproval[]>();
  if (build.purchases.length === 0) return out;
  for (const issue of validate({ ...build, approvals: {} }, settings)) {
    if (issue.severity !== 'approval') continue;
    const index = lineIndexOf(issue.path);
    if (index === null) continue;
    const decision = build.approvals[issue.code] ?? null;
    out.set(index, [...(out.get(index) ?? []), { issue, decision }]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Updaters (pure CharacterBuild → CharacterBuild)
// ---------------------------------------------------------------------------

export function withPurchase(build: CharacterBuild, purchase: BuildPurchase): CharacterBuild {
  return { ...build, purchases: [...build.purchases, purchase] };
}

export function withoutPurchase(build: CharacterBuild, index: number): CharacterBuild {
  if (index < 0 || index >= build.purchases.length) return build;
  return { ...build, purchases: build.purchases.filter((_, i) => i !== index) };
}

export interface PurchaseChange {
  qty?: number;
  /** 'Ware only; ignored on any other list. */
  grade?: AugmentGrade;
  /** Unit price at list, before the grade. */
  cost?: number;
}

/** One line's quantity, grade or unit price changed; everything else about it kept. */
export function withPurchaseChange(build: CharacterBuild, index: number, change: PurchaseChange): CharacterBuild {
  const line = build.purchases[index];
  if (!line) return build;
  const next = {
    ...line,
    ...(change.qty !== undefined ? { qty: Math.max(1, Math.round(change.qty)) } : {}),
    ...(change.cost !== undefined ? { cost: Math.max(0, Math.round(change.cost)) } : {}),
    ...(change.grade !== undefined && line.list === 'augments' ? { grade: change.grade } : {}),
  } as BuildPurchase;
  return { ...build, purchases: build.purchases.map((p, i) => (i === index ? next : p)) };
}

/** Our names for the tiers, as a new line is first named (the record's `name`). */
export const LIFESTYLE_LABEL: Readonly<Record<LifestyleTier, string>> = {
  street: 'Street',
  squatter: 'Squatter',
  low: 'Low',
  middle: 'Middle',
  high: 'High',
  luxury: 'Luxury',
};

export function withLifestyle(build: CharacterBuild, tier: LifestyleTier): CharacterBuild {
  const line: BuildLifestyle = { tier, name: LIFESTYLE_LABEL[tier], months: 1 };
  return { ...build, lifestyles: [...build.lifestyles, line] };
}

export function withoutLifestyle(build: CharacterBuild, index: number): CharacterBuild {
  if (index < 0 || index >= build.lifestyles.length) return build;
  return { ...build, lifestyles: build.lifestyles.filter((_, i) => i !== index) };
}

function withLifestyleLine(build: CharacterBuild, index: number, change: (l: BuildLifestyle) => BuildLifestyle): CharacterBuild {
  const line = build.lifestyles[index];
  if (!line) return build;
  const next = change(line);
  return next === line ? build : { ...build, lifestyles: build.lifestyles.map((l, i) => (i === index ? next : l)) };
}

export function withLifestyleMonths(build: CharacterBuild, index: number, months: number): CharacterBuild {
  return withLifestyleLine(build, index, (l) => ({ ...l, months: Math.max(1, Math.round(months)) }));
}

/** A lifestyle moved to another tier; a line still named after its old tier takes the new tier's name. */
export function withLifestyleTier(build: CharacterBuild, index: number, tier: LifestyleTier): CharacterBuild {
  return withLifestyleLine(build, index, (l) =>
    l.tier === tier ? l : { ...l, tier, name: l.name === LIFESTYLE_LABEL[l.tier] ? LIFESTYLE_LABEL[tier] : l.name },
  );
}

/** A lifestyle renamed ("Low (safehouse)"); an empty name falls back to the tier's, since a line must be called something. */
export function withLifestyleName(build: CharacterBuild, index: number, name: string): CharacterBuild {
  return withLifestyleLine(build, index, (l) => ({ ...l, name: name.trim() ? name.slice(0, 120) : LIFESTYLE_LABEL[l.tier] }));
}

export function withKarmaToNuyen(build: CharacterBuild, karma: number): CharacterBuild {
  return { ...build, karma: { ...build.karma, toNuyen: Math.max(0, Math.round(karma)) } };
}

// ---------------------------------------------------------------------------
// Nuyen: where it comes from, what carries, converting Karma
// ---------------------------------------------------------------------------

export interface NuyenSummary {
  pool: BudgetPool;
  /** The Resources priority, when chosen. */
  resourcesLevel: PriorityLevel | null;
  /** What the Resources row gives at this level. */
  fromResources: number;
  /** What converted Karma gives. */
  fromKarma: number;
  /** The campaign's carry-over cap. */
  carryCap: number;
  carried: number;
  lost: number;
}

/** The nuyen pool taken apart: the engine's pool, less what conversion added, is what Resources gave. */
export function nuyenSummary(build: CharacterBuild, settings: ChargenSettings, budgets: Budgets): NuyenSummary {
  const perKarma = effectiveTables(build, settings).preset.nuyenPerKarma;
  const pool = budgets.pools.nuyen;
  const fromKarma = build.karma.toNuyen * perKarma;
  return {
    pool,
    resourcesLevel: build.priorities.resources,
    fromResources: Math.max(0, pool.available - fromKarma),
    fromKarma,
    carryCap: settings.nuyenCarry,
    carried: budgets.preview?.nuyenCarried ?? 0,
    lost: budgets.preview?.nuyenLost ?? 0,
  };
}

/** "Resources D gives 50,000¥, and 2 Karma converted gives 4,000¥." */
export function nuyenSourceWords(s: NuyenSummary, karma: number): string {
  const resources = s.resourcesLevel
    ? `Resources ${s.resourcesLevel} gives ${formatNuyen(s.fromResources)}`
    : 'No Resources priority is chosen yet';
  const converted = karma > 0 ? `, and ${karma} Karma converted gives ${formatNuyen(s.fromKarma)}` : '';
  return `${resources}${converted}.`;
}

/** "Up to 5,000¥ carries into play; the other 441,000¥ is lost." — or all of it, when it fits. */
export function carryWords(s: NuyenSummary): string {
  if (s.lost > 0) return `Up to ${formatNuyen(s.carryCap)} carries into play; the other ${formatNuyen(s.lost)} is lost.`;
  return `All ${formatNuyen(s.carried)} left carries into play (up to ${formatNuyen(s.carryCap)} may).`;
}

export interface KarmaConversion {
  value: number;
  /** The level's most (10 experienced, 5 street, 25 prime). */
  max: number;
  perKarma: number;
  ref: Ref;
}

export function karmaConversion(build: CharacterBuild, settings: ChargenSettings): KarmaConversion {
  const preset = effectiveTables(build, settings).preset;
  return {
    value: build.karma.toNuyen,
    max: preset.karmaToNuyenMax,
    perKarma: preset.nuyenPerKarma,
    ref: issueRule('karma-to-nuyen-over')?.ref ?? { book: 'SR5', page: 94 },
  };
}

// ---------------------------------------------------------------------------
// Lifestyles
// ---------------------------------------------------------------------------

export interface LifestyleLine {
  index: number;
  lifestyle: BuildLifestyle;
  /** The tier's listed monthly cost. */
  listed: number;
  /** This runner's monthly cost, metatype and Dependents applied (`lifestyleMonthlyCost`). */
  monthly: number;
  total: number;
}

export function lifestyleLines(
  build: Pick<CharacterBuild, 'lifestyles'>,
  lifestyleMultiplier: number,
  dependentsMultiplier: number,
): LifestyleLine[] {
  return build.lifestyles.map((lifestyle, index) => {
    const monthly = lifestyleMonthlyCost(lifestyle, lifestyleMultiplier, dependentsMultiplier);
    return { index, lifestyle, listed: LIFESTYLES[lifestyle.tier].monthly, monthly, total: monthly * lifestyle.months };
  });
}

/** "2,000¥ a month × 3 = 6,000¥". */
export function lifestyleWords(line: LifestyleLine): string {
  const month = `${formatNuyen(line.monthly)} a month`;
  return line.lifestyle.months > 1 ? `${month} × ${line.lifestyle.months} = ${formatNuyen(line.total)}` : month;
}

const percent = (multiplier: number): string => `+${Math.round((multiplier - 1) * 100)}%`;

/** Why this runner's lifestyles cost more than listed, each with its page. */
export function lifestyleSurcharges(lifestyleMultiplier: number, dependentsMultiplier: number): Array<{ text: string; ref: Ref }> {
  return [
    ...(lifestyleMultiplier !== 1
      ? [{ text: `This metatype pays ${percent(lifestyleMultiplier)} on every lifestyle.`, ref: LIFESTYLE_METATYPE_REF }]
      : []),
    ...(dependentsMultiplier !== 1
      ? [{ text: `Dependents add ${percent(dependentsMultiplier)}.`, ref: QUALITY_RULE_BY_ID.dependents.ref }]
      : []),
  ];
}

export interface TierOption {
  tier: LifestyleTier;
  label: string;
  /** What this runner would pay a month, surcharges applied. */
  monthly: number;
  /** "3D6 × 60¥". */
  dice: string;
}

/** Every tier as the "add a lifestyle" buttons read it, priced for this runner. */
export function tierOptions(lifestyleMultiplier: number, dependentsMultiplier: number): TierOption[] {
  return LIFESTYLE_TIERS.map((tier) => {
    const row = LIFESTYLES[tier];
    return {
      tier,
      label: LIFESTYLE_LABEL[tier],
      monthly: lifestyleMonthlyCost({ tier, name: LIFESTYLE_LABEL[tier], months: 1 }, lifestyleMultiplier, dependentsMultiplier),
      dice: `${row.startingDice}D6 × ${formatNuyen(row.startingMultiplier)}`,
    };
  });
}

/** The starting-nuyen roll the dearest lifestyle sets, in words, with its page; null with no lifestyle. */
export function startingNuyenWords(build: CharacterBuild, budgets: Budgets): { text: string; ref: Ref } | null {
  const roll = budgets.preview?.startingNuyen;
  const tier = startingLifestyle(build);
  if (!roll || !tier) return null;
  return {
    text: `When the GM approves the runner, ${roll.dice}D6 × ${formatNuyen(roll.multiplier)} is rolled for starting nuyen (the ${LIFESTYLE_LABEL[tier]} lifestyle sets the dice) and added to what carries over.`,
    ref: LIFESTYLES[tier].ref,
  };
}

// ---------------------------------------------------------------------------
// Before the tap: refusals, consequences, and what a change moves
// ---------------------------------------------------------------------------

/** Introduced errors on this step a player may make and see red, rather than be refused. */
export const ALLOWED_INTRODUCED: ReadonlySet<string> = new Set(['nuyen-overspent']);

/** The first error a candidate change would bring in that this step refuses (a cap), as a refusal. */
export function refusalFrom(probe: BuildProbe): Refusal | null {
  const issue = probe.introduced.find((i) => i.step === GEAR_STEP && !ALLOWED_INTRODUCED.has(i.code));
  return issue ? { reason: issue.message, ref: issue.ref } : null;
}

/** The errors a candidate would bring in on other steps: allowed, and named before the tap. */
export function consequencesFrom(probe: BuildProbe): Issue[] {
  return probe.introduced.filter((i) => i.step !== GEAR_STEP);
}

export interface Shift {
  before: number;
  after: number;
}

export interface ChangePreview {
  nuyen: Shift;
  essence: Shift;
  /** Present when the build has a Magic rating the engine counts. */
  magic: Shift | null;
  resonance: Shift | null;
}

/** What a candidate moves on the rail: the engine's budgets before (the shell's) and after. */
export function previewChange(current: Budgets, candidate: CharacterBuild, settings: ChargenSettings): ChangePreview {
  const after = engineBudgets(candidate, settings);
  const shift = (a: number | undefined, b: number | undefined): Shift | null =>
    a === undefined || b === undefined ? null : { before: a, after: b };
  return {
    nuyen: { before: current.pools.nuyen.remaining, after: after.pools.nuyen.remaining },
    essence: { before: current.preview?.essence ?? 6, after: after.preview?.essence ?? 6 },
    magic: shift(current.preview?.magic, after.preview?.magic),
    resonance: shift(current.preview?.resonance, after.preview?.resonance),
  };
}

/** What moves on the rail besides nuyen (the price says that): "Essence 6 → 4.8", "Magic 6 → 4". Empty when nothing does. */
export function shiftWords(change: ChangePreview): string[] {
  const words: string[] = [];
  const say = (label: string, shift: Shift | null, format: (n: number) => string = String) => {
    if (shift && shift.after !== shift.before) words.push(`${label} ${format(shift.before)} → ${format(shift.after)}`);
  };
  say('Essence', change.essence, formatEssence);
  say('Magic', change.magic);
  say('Resonance', change.resonance);
  return words;
}

export interface AttributeLoss {
  attribute: 'Magic' | 'Resonance';
  before: number;
  after: number;
  text: string;
  ref: Ref;
}

/**
 * The warning before Essence takes a point of Magic or Resonance: "This takes
 * Magic from 6 to 5.", with the page. Null when neither moves down.
 */
export function attributeLoss(change: ChangePreview): AttributeLoss | null {
  const ref = issueRule('magic-reduced-by-essence')?.ref ?? CREATION_GRADE_REF;
  for (const [attribute, shift] of [
    ['Magic', change.magic],
    ['Resonance', change.resonance],
  ] as const) {
    if (!shift || shift.after >= shift.before) continue;
    return {
      attribute,
      before: shift.before,
      after: shift.after,
      text: `This takes ${attribute} from ${shift.before} to ${shift.after}: every point of Essence lost, or part of one, costs a point of ${attribute}.`,
      ref,
    };
  }
  return null;
}

export interface CandidateQuote {
  /** The cap this change would break, in the engine's words; null when it may be made. */
  refusal: Refusal | null;
  /** What it would break on other steps, allowed and named. */
  consequences: Issue[];
  change: ChangePreview;
  loss: AttributeLoss | null;
}

export interface QuoteContext {
  build: CharacterBuild;
  settings: ChargenSettings;
  budgets: Budgets;
  probe: BuildProber;
}

/** Everything worth saying about a candidate record before it replaces the build. `key` caches the probe for this draft. */
export function quoteCandidate(candidate: CharacterBuild, key: string, ctx: QuoteContext): CandidateQuote {
  const probe = ctx.probe(() => candidate, key);
  const change = previewChange(ctx.budgets, candidate, ctx.settings);
  return { refusal: refusalFrom(probe), consequences: consequencesFrom(probe), change, loss: attributeLoss(change) };
}

// ---------------------------------------------------------------------------
// A row being added
// ---------------------------------------------------------------------------

/** What the add panel asks: only what the book needs. */
export interface PurchaseDraft {
  qty: number;
  /** For a rated row; null otherwise. */
  rating: number | null;
  /** For 'ware; null otherwise. */
  grade: AugmentGrade | null;
  /** A unit price typed for a row that prints none this can read; null keeps the list price. */
  price: number | null;
}

/** A fresh draft for a picked row: one, at the lowest rating, standard grade for 'ware. */
export function initialDraft(hit: CatalogueHit): PurchaseDraft {
  const range = hitRatingRange(hit);
  return {
    qty: 1,
    rating: range ? range.min : null,
    grade: purchaseListFor(hit.kind) === 'augments' ? 'standard' : null,
    price: null,
  };
}

/** The line a draft would add, or why it cannot be made. */
export function draftPurchase(hit: CatalogueHit, draft: PurchaseDraft): { purchase: BuildPurchase | null; error: string | null } {
  try {
    return {
      purchase: hitToPurchase(hit, {
        qty: draft.qty,
        rating: draft.rating,
        grade: draft.grade,
        ...(draft.price !== null ? { cost: draft.price } : {}),
      }),
      error: null,
    };
  } catch {
    return { purchase: null, error: `${hit.name || 'This row'} cannot be made into a purchase as it stands; write it in by hand instead.` };
  }
}

/** A probe key for a draft: the row and every choice, so a changed choice validates afresh. */
export function draftKey(hit: CatalogueHit, draft: PurchaseDraft): string {
  return `gear:add:${hit.id}:${hit.name}:${hit.cost ?? ''}:${hit.avail ?? ''}:${draft.qty}:${draft.rating ?? ''}:${draft.grade ?? ''}:${draft.price ?? ''}`;
}

/** Only the cap a draft would break (no rail preview): for the choices beside the one on screen. */
export function draftRefusal(hit: CatalogueHit, draft: PurchaseDraft, ctx: Pick<QuoteContext, 'build' | 'probe'>): Refusal | null {
  const { purchase } = draftPurchase(hit, draft);
  if (!purchase) return null;
  const candidate = withPurchase(ctx.build, purchase);
  return refusalFrom(ctx.probe(() => candidate, draftKey(hit, draft)));
}

/** Whether the row prints no price the engine can read at this rating, so one must be typed. */
export function priceMissing(hit: CatalogueHit, draft: Pick<PurchaseDraft, 'rating' | 'price'>): boolean {
  return draft.price === null && catalogueWareFigures(hit, { rating: draft.rating }).cost === null;
}

export interface DraftQuote {
  purchase: BuildPurchase | null;
  error: string | null;
  cost: number;
  essence: number;
  availability: string | null;
  /** The engine's warnings and approvals on the new line ("… is Restricted; the GM decides."). */
  notes: Issue[];
  quote: CandidateQuote | null;
  /** The row prints no price this can read, and none was typed. */
  priceMissing: boolean;
}

/** Everything the add panel says about a draft, asked of the engine over the build with the line added. */
export function quoteDraft(hit: CatalogueHit, draft: PurchaseDraft, ctx: QuoteContext): DraftQuote {
  const { purchase, error } = draftPurchase(hit, draft);
  const missing = priceMissing(hit, draft);
  if (!purchase) {
    return { purchase: null, error, cost: 0, essence: 0, availability: null, notes: [], quote: null, priceMissing: missing };
  }
  const candidate = withPurchase(ctx.build, purchase);
  const index = candidate.purchases.length - 1;
  const notes = validate(candidate, ctx.settings).filter((i) => i.severity !== 'error' && lineIndexOf(i.path) === index);
  return {
    purchase,
    error: null,
    cost: purchaseCost(purchase),
    essence: purchaseEssence(purchase),
    availability: availabilityWords(purchase),
    notes,
    quote: quoteCandidate(candidate, draftKey(hit, draft), ctx),
    priceMissing: missing,
  };
}

/** What a quote puts on the add button: the price, and the Magic it costs when it costs any. */
export function addLabel(name: string, quote: Pick<DraftQuote, 'cost'> & { quote: Pick<CandidateQuote, 'loss'> | null }): string {
  const loss = quote.quote?.loss;
  const tail = loss ? `, and lose ${loss.before - loss.after} ${loss.attribute}` : '';
  return `add ${name} for ${formatNuyen(quote.cost)}${tail}`;
}

// ---------------------------------------------------------------------------
// Writing a purchase by hand
// ---------------------------------------------------------------------------

export interface CustomPurchaseInput {
  kind: CatalogueKind;
  name: string;
  /** Price each, as typed ("2,500"). */
  price: string;
  avail: string;
  /** 'Ware only. */
  essence: string;
  /** 'Ware only: which the heading would say, since Sensitive System tells them apart. */
  ware: 'cyberware' | 'bioware';
  rating: string;
}

export const EMPTY_CUSTOM: CustomPurchaseInput = { kind: 'gear', name: '', price: '', avail: '', essence: '', ware: 'cyberware', rating: '' };

/** A typed number, commas, spaces and the currency sign allowed; null when blank or not a number. */
export function typedNumber(text: string): number | null {
  const t = text.replace(/[,¥\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A hand-written purchase as a catalogue row (`customHit`), so it goes
 * through the same add panel — quantity, grade, the engine's caps — as a row
 * from the books. Null until it has a name.
 */
export function customPurchaseHit(input: CustomPurchaseInput): CatalogueHit | null {
  const name = input.name.trim();
  if (!name) return null;
  const ware = input.kind === 'augmentation';
  const essence = typedNumber(input.essence);
  const rating = typedNumber(input.rating);
  return customHit({
    kind: input.kind,
    name,
    category: ware ? input.ware.toUpperCase() : '',
    stats: {
      ...(ware && essence !== null ? { ESSENCE: String(essence) } : {}),
      ...(rating !== null ? { RATING: String(Math.round(rating)) } : {}),
    },
    avail: input.avail,
    cost: typedNumber(input.price),
  });
}
