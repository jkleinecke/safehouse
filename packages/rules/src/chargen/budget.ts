/**
 * The rail — every pool a build spends from and what is left in it (FR3.9,
 * docs/CHARGEN.md §4.2 `budgets(build)`, §4.4, §8.3 `Budgets`).
 *
 * The book asks a first-timer to keep a spreadsheet (p. 62); this is the
 * spreadsheet. Each pool is `{ available, spent, remaining }`, recomputed
 * from the build's decisions on every change, and `remaining` goes negative
 * rather than clamping so the rail can show *how far* over a pool is.
 *
 * Where the numbers come from:
 *
 * - **Special / attribute / skill / group points** — the priority rows the
 *   build picked (SR5 p. 65; Run Faster's printing when the campaign uses it).
 *   Skill points also pay for knowledge and language ranks bought with them
 *   (`skillPoints`, p. 88) and one point per specialisation (p. 89). With
 *   the `uncouthDoublesPriorityPoints` house rule, Uncouth and Uneducated
 *   double those points too (§8.4); otherwise they double Karma only.
 * - **Knowledge** — (INT + LOG) × 2 on natural ratings (p. 89; 'ware never
 *   counts, p. 95). The pool also shows the skill points diverted into it,
 *   so `remaining` is what the free points still owe.
 * - **Karma** — the level's starting Karma plus negative qualities, less
 *   positive qualities, a metavariant's extra Karma (RF p. 102), every Karma
 *   spend priced by `spendKarma`, Karma converted to nuyen, and any contact
 *   Karma past the free pool.
 * - **Nuyen** — Resources plus conversion (2,000¥ a Karma, p. 94), less
 *   purchases at their grade's cost (p. 451) and lifestyles at the metatype's
 *   multiplier (p. 66) and Dependents' surcharge (p. 80). The two multipliers
 *   are read as surcharges on the listed price and add: a troll with
 *   Dependents 2 pays +100% and +20%, ×2.2.
 * - **Contact Karma** — natural Charisma × 3, × 6 at prime (p. 98, p. 64).
 * - **Power points** — an adept's are Magic after Essence loss (p. 279); a
 *   mystic adept's are the ones bought at 5 Karma (p. 69), no more than that
 *   same Magic.
 * - **Spells / forms / foci** — the creation caps: Magic × 2 spells known,
 *   Resonance × 2 complex forms, Magic × 2 total bonded Force (p. 98). The
 *   spells pool counts spells, and only for a character who may know them (an
 *   adept or an aspected conjurer has none); rituals and preparations are
 *   capped per group by the validator, which the pool would otherwise hide.
 *   Magic and Resonance count only where the build can use them: a mundane's
 *   Karma-bought Magic opens no cap.
 *
 * Sum to Ten's ten priority points (RF p. 62) are `pools.priorityPoints`,
 * present only under that method.
 *
 * Pure — no I/O. Numbers and page refs only (DESIGN.md §14).
 */
import {
  LIFESTYLE_TIERS,
  type BudgetPool,
  type Budgets,
  type BuildLifestyle,
  type BuildPick,
  type BuildPurchase,
  type CharacterBuild,
  type ChargenSettings,
  type KnowledgeCategory,
  type LifestyleTier,
} from '@safehouse/contracts';
import {
  costDoubling,
  doublesGroup,
  doublesKnowledge,
  doublesSkill,
  doublesSpecialization,
  spendKarma,
  type SpendPricing,
} from './advance.js';
import { IMPLANT_GRADES } from './grades.js';
import { LIFESTYLES } from './lifestyles.js';
import { metatypeRow } from './metatypes.js';
import { MAGIC_KIND_TABLE, SUM_TO_TEN } from './priority.js';
import { effectiveTables, qualityEffects, ratings, type BuildRatings, type EffectiveTables, type QualityEffects } from './ratings.js';
import { CREATION_SKILL_RULES, freeKnowledgePoints } from './skills.js';
import { FOCUS_LIMITS } from './foci.js';

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

const BASE_ESSENCE = 6;

/** Nuyen and Essence arithmetic in whole nuyen and ten-thousandths of a point, so 0.1 + 0.2 stays 0.3. */
const nuyen = (n: number): number => Math.round(n);
const essence = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * How far an Availability code could be read:
 * - `ok` — a number came out;
 * - `none` — nothing printed, or a dash;
 * - `relative` — "+2", an accessory's addition to whatever it mounts on
 *   (no slotting model at creation, §7), so there is no number to cap;
 * - `needsRating` — a formula in Rating, Force or Level, on a purchase that
 *   records none;
 * - `unreadable` — anything else ("Varies", two codes in one cell).
 * The last two are the validator's `availability-unreadable`: the cap cannot
 * be checked, and the GM should see that rather than a silent pass.
 */
export type AvailabilityStatus = 'ok' | 'none' | 'relative' | 'needsRating' | 'unreadable';

/** Availability as printed ("12R", "4F", "(Rating × 3)R", "10 + Rating") read against a purchase's rating. */
export interface ParsedAvailability {
  /** The number, or null when `status` is not `ok`. */
  value: number | null;
  /** Restricted, Forbidden, or neither. */
  legality: 'R' | 'F' | null;
  status: AvailabilityStatus;
}

const RATING_WORD = /^(?:rating|force|level)$/i;

/**
 * A formula body — "Rating × 3", "Rating + 8", "10 + Rating", "Rating × 3 + 2",
 * "(Rating)" — with multiplication before addition. `undefined` when the
 * text is not such a formula; `null` when it is one but needs a rating.
 */
function evaluateFormula(body: string, rating: number | null | undefined): number | null | undefined {
  let text = body.trim();
  while (/^\((.*)\)$/.test(text)) text = text.slice(1, -1).trim();
  if (!text) return undefined;
  const terms = text.split('+').map((term) => term.trim());
  let total = 0;
  let needsRating = false;
  let usesRating = false;
  for (const term of terms) {
    const factors = term.split(/[x×*]/i).map((f) => f.trim().replace(/^\((.*)\)$/, '$1').trim());
    let product = 1;
    for (const factor of factors) {
      if (/^\d{1,3}$/.test(factor)) product *= Number(factor);
      else if (RATING_WORD.test(factor)) {
        usesRating = true;
        if (rating == null) needsRating = true;
        else product *= rating;
      } else return undefined;
    }
    total += product;
  }
  if (!usesRating) return total;
  return needsRating ? null : total;
}

/** Footnote marks a printed Availability can trail: asterisks, daggers, section signs, superscript digits. */
const FOOTNOTE_MARKS = /[\s*†‡§¹²³⁰⁴-⁹]+$/u;

/**
 * Reads a printed Availability. Footnote marks after the code are dropped
 * first ("16F†" is 16F). A code that still cannot be read keeps any R or F
 * that stands on its own in it, so a Forbidden line with a note beside its
 * number goes to the GM like any other.
 */
export function parseAvailability(avail: string | null | undefined, rating?: number | null): ParsedAvailability {
  const printed = (avail ?? '').trim();
  if (!printed || /^[—–-]+$/.test(printed)) return { value: null, legality: null, status: 'none' };
  const text = printed.replace(FOOTNOTE_MARKS, '') || printed;
  const legalityOf = (s: string | undefined): 'R' | 'F' | null => {
    const c = (s ?? '').toUpperCase();
    return c === 'R' || c === 'F' ? c : null;
  };
  const relative = /^\+\s*\d{1,3}\s*([RFrf])?$/.exec(text);
  if (relative) return { value: null, legality: legalityOf(relative[1]), status: 'relative' };
  // "12", "12R", "16+" (at least 16), "12R+".
  const plain = /^(\d{1,3})\s*([RFrf])?\s*\+?$/.exec(text);
  if (plain) return { value: Number(plain[1]), legality: legalityOf(plain[2]), status: 'ok' };
  // A formula, its legality letter after a digit, a bracket or a space: "(Rating x 3)R", "Rating x 6R", "10 + Rating".
  const lettered = /^(.*[\d)\s])([RFrf])$/.exec(text);
  const body = lettered ? lettered[1]! : text;
  const legality = lettered ? legalityOf(lettered[2]) : null;
  const value = evaluateFormula(body, rating);
  if (value === undefined) {
    // No number to cap, but a legality letter standing on its own — after a
    // digit, a bracket or a space — still puts the line to the GM:
    // "12F (see text)", "Varies F", "10R or 14F" (the stricter wins).
    const letters = [...text.matchAll(/(?:^|[\d)\s])([RF])(?![a-z])/gi)].map((m) => legalityOf(m[1]));
    return { value: null, legality: letters.includes('F') ? 'F' : letters.includes('R') ? 'R' : null, status: 'unreadable' };
  }
  return value === null ? { value: null, legality, status: 'needsRating' } : { value, legality, status: 'ok' };
}

/** A purchase's Availability with its grade's modifier (alphaware +2, used −4; p. 451). */
export function purchaseAvailability(p: BuildPurchase): ParsedAvailability {
  const parsed = parseAvailability(p.avail, p.rating);
  if (parsed.value === null || p.list !== 'augments' || !p.grade) return parsed;
  return { ...parsed, value: parsed.value + IMPLANT_GRADES[p.grade].availability };
}

/** What a purchase line costs: unit price × grade multiplier × quantity. */
export function purchaseCost(p: BuildPurchase): number {
  const grade = p.list === 'augments' && p.grade ? IMPLANT_GRADES[p.grade].cost : 1;
  return nuyen(p.cost * grade * p.qty);
}

/**
 * The pages whose augment tables are all bioware, for a row whose heading does
 * not say: the core book's bioware section (SR5 pp. 459–461) and Chrome
 * Flesh's bioware tables (CF pp. 109–121).
 */
const BIOWARE_PAGES = [
  { book: 'SR5', from: 459, to: 461 },
  { book: 'CF', from: 109, to: 121 },
] as const;

/** Headings that name bioware, or a bioware sub-table that does not say so (CF p. 117's orthoskin upgrades). */
const BIOWARE_HEADING = /bio|orthoskin/i;
/** Headings that name cyberware. */
const CYBERWARE_HEADING = /cyber|headware|eyeware|earware|bodyware/i;

/**
 * Bioware, as far as a purchase can say (Sensitive System doubles cyberware
 * Essence and bars bioware, p. 83). The catalogue's kind is `augmentation`
 * for cyberware and bioware alike, so the table heading the row sat under
 * (`category`, "BASIC BIOWARE") decides when it names one or the other. A
 * heading that names neither ("ORTHOSKIN UPGRADES" is bioware, "DEVICE" is
 * not) leaves it to a kind or note that names bioware, then a page of bioware
 * tables. Everything else on the augments list is cyberware.
 */
export function isBioware(p: BuildPurchase): boolean {
  if (p.list !== 'augments') return false;
  const heading = p.category?.trim() ?? '';
  if (BIOWARE_HEADING.test(heading)) return true;
  if (CYBERWARE_HEADING.test(heading)) return false;
  if (/bio/i.test(p.kind) || /\bbioware\b/i.test(p.item.note ?? '')) return true;
  const ref = p.ref ?? p.item.ref;
  return !!ref && BIOWARE_PAGES.some((range) => ref.book === range.book && ref.page >= range.from && ref.page <= range.to);
}

/** A Matrix device whose rating is its device rating (the creation cap of 6, p. 94). */
export function isDevice(p: BuildPurchase): boolean {
  return /electronic|commlink|cyberdeck|\bdeck\b|rcc|drone|device/i.test(`${p.kind} ${p.category ?? ''}`);
}

/**
 * A device's rating for the creation cap: the printed Device Rating the
 * purchase recorded, else its Rating, else the "device rating N" the
 * catalogue's stats line leaves in the item's note — the commlink and deck
 * tables print Device Rating in its own column, so a line added straight from
 * the catalogue carries it there and nowhere else.
 */
export function purchaseDeviceRating(p: BuildPurchase): number | null {
  if (p.deviceRating !== undefined) return p.deviceRating;
  if (p.rating !== null) return p.rating;
  const noted = /\bdevice rating\s+(\d{1,2})\b/i.exec(p.item.note ?? '');
  return noted ? Number(noted[1]) : null;
}

/**
 * Who may know which formulae (p. 69, p. 98): magicians and mystic adepts
 * all three groups; an aspected magician only its aspect's — spells and
 * rituals with Sorcery, alchemical preparations with Enchanting, none with
 * Conjuring (and all three until the aspect is chosen, which is its own
 * issue); everyone else none.
 */
export function knowsFormulaGroup(
  magic: Pick<CharacterBuild['magic'], 'kind' | 'aspect'>,
  group: 'spells' | 'rituals' | 'preparations',
): boolean {
  switch (magic.kind) {
    case 'magician':
    case 'mysticAdept':
      return true;
    case 'aspected':
      if (!magic.aspect) return true;
      return magic.aspect === 'sorcery' ? group !== 'preparations' : magic.aspect === 'enchanting' && group === 'preparations';
    default:
      return false;
  }
}

/** Magicians, mystic adepts, and aspected magicians of Sorcery cast spells. */
export function castsSpells(magic: Pick<CharacterBuild['magic'], 'kind' | 'aspect'>): boolean {
  return magic.kind === 'magician' || magic.kind === 'mysticAdept' || (magic.kind === 'aspected' && magic.aspect === 'sorcery');
}

/** Magicians, mystic adepts, and aspected magicians of Conjuring summon and bind. */
export function summonsSpirits(magic: Pick<CharacterBuild['magic'], 'kind' | 'aspect'>): boolean {
  return magic.kind === 'magician' || magic.kind === 'mysticAdept' || (magic.kind === 'aspected' && magic.aspect === 'conjuring');
}

/**
 * Whether a build's Magic rating is one it can use: a magic-using type's, or
 * a metasapient's or shapeshifter's natural Magic (RF p. 102). A mundane or
 * technomancer who raised Magic with Karma has a number, not an attribute —
 * the validator says so, and nothing that keys on Magic counts it.
 */
export function usesMagic(build: Pick<CharacterBuild, 'magic' | 'metatype'>): boolean {
  if (MAGIC_KIND_TABLE[build.magic.kind].attribute === 'mag') return true;
  return (metatypeRow(build.metatype ?? undefined)?.magic.base ?? 0) > 0;
}

/** Whether a build's Resonance rating is one it can use: a technomancer's. */
export function usesResonance(build: Pick<CharacterBuild, 'magic'>): boolean {
  return MAGIC_KIND_TABLE[build.magic.kind].attribute === 'res';
}

/**
 * Essence a purchase costs with its grade applied (and Sensitive System's
 * doubling of cyberware, p. 83): per unit × grade × quantity. A purchase that
 * recorded no per-unit Essence falls back to its item's.
 */
export function purchaseEssence(p: BuildPurchase, effects?: Pick<QualityEffects, 'sensitiveSystem'>): number {
  if (p.list !== 'augments') return 0;
  const unit = p.essence > 0 ? p.essence : p.item.essence;
  const grade = p.grade ? IMPLANT_GRADES[p.grade].essence : 1;
  const sensitive = effects?.sensitiveSystem && !isBioware(p) ? 2 : 1;
  return essence(unit * grade * p.qty * sensitive);
}

/** A lifestyle's monthly cost for this build: listed × (metatype multiplier + Dependents surcharge). */
export function lifestyleMonthlyCost(
  l: BuildLifestyle,
  metatypeMultiplier: number,
  dependentsMultiplier = 1,
): number {
  return nuyen(LIFESTYLES[l.tier].monthly * (metatypeMultiplier + (dependentsMultiplier - 1)));
}

/** The lifestyle whose dice set starting nuyen: the most expensive tier kept (p. 95). */
export function startingLifestyle(build: CharacterBuild): LifestyleTier | null {
  let best: LifestyleTier | null = null;
  for (const l of build.lifestyles) {
    if (best === null || LIFESTYLE_TIERS.indexOf(l.tier) > LIFESTYLE_TIERS.indexOf(best)) best = l.tier;
  }
  return best;
}

/**
 * The purchase each focus bond is bonding, index for index with
 * `karma.spends`: a purchase index, `null` for a bond no purchase answers,
 * `undefined` for a spend that is not a focus. A bond matches a line with its
 * catalogue id or its name, whose rating (the focus's Force) is the bond's
 * Force or unrecorded, and each line answers as many bonds as its quantity.
 * Augments never hold a focus.
 *
 * The pairing is the largest there is, whatever order the bonds were made in:
 * each bond tries the lines at its own Force before the unrated ones, and a
 * bond that finds them all taken asks the bonds holding them to move to
 * another line that answers them (an augmenting path). So a Force 3 bond is
 * never left without a focus because a Force 2 bond made earlier sat on the
 * one unrated line while a Force 2 line stood free.
 */
export function focusPurchaseMatches(build: Pick<CharacterBuild, 'purchases' | 'karma'>): readonly (number | null | undefined)[] {
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const purchases = build.purchases;
  const spends = build.karma.spends;
  const candidates = new Map<number, number[]>();
  spends.forEach((s, i) => {
    if (s.kind !== 'focus') return;
    const answers = (p: BuildPurchase): boolean =>
      p.list !== 'augments' && ((!!s.catalogueId && p.catalogueId === s.catalogueId) || same(p.name, s.name));
    const exact: number[] = [];
    const unrated: number[] = [];
    purchases.forEach((p, at) => {
      if (!answers(p)) return;
      if (p.rating === s.force) exact.push(at);
      else if (p.rating === null) unrated.push(at);
    });
    candidates.set(i, [...exact, ...unrated]);
  });
  // The bonds each line holds, never more than its quantity.
  const held = purchases.map((): number[] => []);
  const place = (bond: number, visited: Set<number>): boolean => {
    for (const at of candidates.get(bond) ?? []) {
      if (visited.has(at)) continue;
      visited.add(at);
      const holders = held[at]!;
      if (holders.length < purchases[at]!.qty) {
        holders.push(bond);
        return true;
      }
      for (let k = 0; k < holders.length; k++) {
        if (place(holders[k]!, visited)) {
          holders[k] = bond;
          return true;
        }
      }
    }
    return false;
  };
  for (const bond of candidates.keys()) place(bond, new Set());
  const lineOf = new Map<number, number>();
  held.forEach((holders, at) => {
    for (const bond of holders) lineOf.set(bond, at);
  });
  return spends.map((s, i) => (s.kind !== 'focus' ? undefined : (lineOf.get(i) ?? null)));
}

/** Which formula group a pick belongs to (p. 98 caps each at Magic × 2). */
export function formulaGroup(pick: Pick<BuildPick, 'category'>): 'spells' | 'rituals' | 'preparations' {
  const c = pick.category ?? '';
  if (/ritual/i.test(c)) return 'rituals';
  if (/prep|alchem/i.test(c)) return 'preparations';
  return 'spells';
}

/** Pricing for a build's Karma spends: its qualities' and metatype's doubling, its knowledge categories. */
export function buildPricing(build: CharacterBuild): SpendPricing {
  // Indexed once rather than searched per spend: this closure is called for
  // every Karma spend, and a linear scan inside it made pricing a build
  // quadratic in its own lists.
  const byName = new Map<string, KnowledgeCategory>();
  for (const k of build.skills.knowledge) {
    const key = k.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, k.category);
  }
  return {
    doubling: costDoubling(build.qualities, build.metatype),
    knowledgeCategory: (name) => byName.get(name.trim().toLowerCase()) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The tally (shared with the validator and the compiler)
// ---------------------------------------------------------------------------

export interface BuildTally {
  tables: EffectiveTables;
  effects: QualityEffects;
  ratings: BuildRatings;
  pricing: SpendPricing;
  pools: Budgets['pools'];
  /** Essence after implants, and what it cost. */
  essence: number;
  essenceLost: number;
  /**
   * Magic and Resonance after Essence loss (p. 95): each fraction lost costs a
   * point. Only a rating the build can use counts (`usesMagic`,
   * `usesResonance`); a mundane's Karma-bought Magic is 0 here.
   */
  magic: number;
  resonance: number;
  positiveKarma: number;
  negativeKarma: number;
  metatypeKarma: number;
  /** Karma each spend cost, index for index with `karma.spends`. */
  spendCosts: readonly number[];
  contactKarma: readonly number[];
  lifestyleMultiplier: number;
  formulae: Readonly<Record<'spells' | 'rituals' | 'preparations', number>>;
  forms: number;
  fociForce: number;
  karmaRemaining: number;
  nuyenRemaining: number;
}

const pool = (available: number, spent: number): BudgetPool => ({
  available: essence(available),
  spent: essence(spent),
  remaining: essence(available - spent),
});

/** Everything the rail, the validator and the compiler read, computed once. */
export function tallyBuild(build: CharacterBuild, settings: ChargenSettings): BuildTally {
  const tables = effectiveTables(build, settings);
  const effects = qualityEffects(build);
  const rated = ratings(build, settings);
  const pricing = buildPricing(build);
  const { preset, rows } = tables;
  const a = rated.attributes;
  const kindRow = MAGIC_KIND_TABLE[build.magic.kind];
  const doublePoints = settings.uncouthDoublesPriorityPoints;
  const x2 = (doubled: boolean): number => (doublePoints && doubled ? 2 : 1);

  // Essence and what it takes from Magic/Resonance (derive's own rounding).
  let essenceLost = 0;
  for (const p of build.purchases) essenceLost += purchaseEssence(p, effects);
  essenceLost = essence(essenceLost);
  const loss = essenceLost > 0 ? Math.ceil(essenceLost - 1e-9) : 0;
  const magicRating = usesMagic(build) ? a.mag.rating : 0;
  const resonanceRating = usesResonance(build) ? a.res.rating : 0;
  const magic = Math.max(0, magicRating - (magicRating > 0 ? loss : 0));
  const resonance = Math.max(0, resonanceRating - (resonanceRating > 0 ? loss : 0));

  // Special and attribute points.
  const special = pool(tables.metatypeCell?.special ?? 0, build.special.edg + build.special.mag + build.special.res);
  const attributeSpent = Object.values(build.attributes).reduce((s, n) => s + n, 0);
  const attributes = pool(rows.attributes?.attributes ?? 0, attributeSpent);

  // Skill, group and knowledge points.
  let skillSpent = 0;
  for (const entry of build.skills.active) {
    skillSpent += entry.points * x2(doublesSkill(pricing.doubling, entry.id));
    if (entry.spec && entry.spec.trim()) {
      const doubled = doublesSpecialization(pricing.doubling, { list: 'active', id: entry.id });
      skillSpent += CREATION_SKILL_RULES.specializationPoints * x2(doubled);
    }
  }
  let groupSpent = 0;
  for (const entry of build.skills.groups) groupSpent += entry.points * x2(doublesGroup(pricing.doubling, entry.id));
  let knowledgeSpent = 0;
  let diverted = 0;
  for (const k of build.skills.knowledge) {
    const doubled = doublesKnowledge(pricing.doubling, k.category);
    knowledgeSpent += k.points * x2(doubled);
    diverted += k.skillPoints * x2(doubled);
    if (k.spec && k.spec.trim()) {
      if (k.points > 0 || k.skillPoints === 0) knowledgeSpent += CREATION_SKILL_RULES.specializationPoints;
      else diverted += CREATION_SKILL_RULES.specializationPoints;
    }
  }
  for (const l of build.skills.languages) {
    knowledgeSpent += l.points;
    diverted += l.skillPoints;
    if (l.spec && l.spec.trim()) {
      if (l.points > 0 || l.skillPoints === 0) knowledgeSpent += CREATION_SKILL_RULES.specializationPoints;
      else diverted += CREATION_SKILL_RULES.specializationPoints;
    }
  }
  const skills = pool(rows.skills?.skills.points ?? 0, skillSpent + diverted);
  const groups = pool(rows.skills?.skills.groupPoints ?? 0, groupSpent);
  const freeKnowledge = freeKnowledgePoints(a.int.rating, a.log.rating);
  const knowledge = pool(freeKnowledge + diverted, knowledgeSpent + diverted);

  // Qualities.
  let positiveKarma = 0;
  let negativeKarma = 0;
  for (const q of build.qualities) {
    if (q.type === 'positive') positiveKarma += q.karma;
    else negativeKarma += q.karma;
  }
  const metatypeKarma = tables.metatypeCell?.karma ?? 0;

  // Contacts.
  const contactKarma = build.karma.contacts.map((c) => c.connection + c.loyalty);
  const contactSpent = contactKarma.reduce((s, n) => s + n, 0);
  const contactAvailable = a.cha.rating * preset.contactKarmaPerCharisma;
  const contactOverflow = Math.max(0, contactSpent - contactAvailable);

  // Karma.
  const spendCosts = build.karma.spends.map((s) => spendKarma(s, pricing));
  const spendTotal = spendCosts.reduce((s, n) => s + n, 0);
  const karmaAvailable = preset.karma + negativeKarma;
  const karmaSpent = positiveKarma + metatypeKarma + spendTotal + build.karma.toNuyen + contactOverflow;

  // Nuyen.
  const lifestyleMultiplier = tables.metatype?.lifestyleMultiplier ?? 1;
  let nuyenSpent = 0;
  for (const p of build.purchases) nuyenSpent += purchaseCost(p);
  for (const l of build.lifestyles) {
    nuyenSpent += lifestyleMonthlyCost(l, lifestyleMultiplier, effects.dependentsMultiplier) * l.months;
  }
  const nuyenAvailable =
    (rows.resources?.resources[tables.level] ?? 0) + build.karma.toNuyen * preset.nuyenPerKarma;

  // Power points: an adept's are Magic; a mystic adept's are the ones bought,
  // never more than Magic once Essence loss has taken its points (p. 69, p. 279).
  const ppBought = build.karma.spends.reduce((s, sp) => s + (sp.kind === 'powerPoint' ? sp.count : 0), 0);
  const ppAvailable =
    kindRow.powerPoints === 'free' ? magic : kindRow.powerPoints === 'karma' ? Math.min(ppBought, magic) : 0;
  const ppSpent = build.powers.reduce((s, p) => s + p.cost, 0);

  // Formulae, forms, foci.
  const formulae = { spells: 0, rituals: 0, preparations: 0 };
  for (const pick of build.grants.spells) formulae[formulaGroup(pick)] += 1;
  for (const s of build.karma.spends) if (s.kind === 'spell') formulae[formulaGroup(s)] += 1;
  const forms = build.grants.forms.length + build.karma.spends.filter((s) => s.kind === 'form').length;
  const fociForce = build.karma.spends.reduce((s, sp) => s + (sp.kind === 'focus' ? sp.force : 0), 0);
  const perRating = kindRow.knownPerRating;

  const pools: Budgets['pools'] = {
    special,
    attributes,
    skills,
    groups,
    knowledge,
    karma: pool(karmaAvailable, karmaSpent),
    nuyen: pool(nuyenAvailable, nuyenSpent),
    contactKarma: pool(contactAvailable, contactSpent),
    powerPoints: pool(ppAvailable, ppSpent),
    spells: pool(knowsFormulaGroup(build.magic, 'spells') ? magic * perRating : 0, formulae.spells),
    forms: pool(kindRow.attribute === 'res' ? resonance * perRating : 0, forms),
    foci: pool(magic * FOCUS_LIMITS.creationForcePerMagic, fociForce),
    positiveQualities: pool(preset.qualityCap, positiveKarma),
    negativeQualities: pool(preset.qualityCap, negativeKarma),
  };
  if (build.method === 'sumToTen') {
    let spent = 0;
    for (const level of Object.values(build.priorities)) if (level) spent += SUM_TO_TEN.cost[level];
    pools.priorityPoints = pool(SUM_TO_TEN.points, spent);
  }

  return {
    tables,
    effects,
    ratings: rated,
    pricing,
    pools,
    essence: essence(BASE_ESSENCE - essenceLost),
    essenceLost,
    magic,
    resonance,
    positiveKarma,
    negativeKarma,
    metatypeKarma,
    spendCosts,
    contactKarma,
    lifestyleMultiplier,
    formulae,
    forms,
    fociForce,
    karmaRemaining: karmaAvailable - karmaSpent,
    nuyenRemaining: nuyenAvailable - nuyenSpent,
  };
}

// ---------------------------------------------------------------------------
// budgets()
// ---------------------------------------------------------------------------

/** Every pool a build spends from, and the previews the rail shows beside them (§4.2). */
export function budgets(build: CharacterBuild, settings: ChargenSettings): Budgets {
  const t = tallyBuild(build, settings);
  const { preset } = t.tables;
  const karmaLeft = Math.max(0, t.karmaRemaining);
  const nuyenLeft = Math.max(0, t.nuyenRemaining);
  const tier = startingLifestyle(build);
  const kindRow = MAGIC_KIND_TABLE[build.magic.kind];
  return {
    pools: t.pools,
    preview: {
      essence: t.essence,
      ...(kindRow.attribute === 'mag' || t.ratings.attributes.mag.rating > 0 ? { magic: t.magic } : {}),
      ...(kindRow.attribute === 'res' ? { resonance: t.resonance } : {}),
      karmaCarried: Math.min(karmaLeft, preset.karmaCarry),
      karmaLost: Math.max(0, karmaLeft - preset.karmaCarry),
      nuyenCarried: Math.min(nuyenLeft, preset.nuyenCarry),
      nuyenLost: Math.max(0, nuyenLeft - preset.nuyenCarry),
      ...(tier
        ? { startingNuyen: { dice: LIFESTYLES[tier].startingDice, multiplier: LIFESTYLES[tier].startingMultiplier } }
        : {}),
      lifestyleMultiplier: t.lifestyleMultiplier,
    },
  };
}
