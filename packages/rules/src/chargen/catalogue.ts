/**
 * Reading a catalogue row's numbers — what a build records when a player
 * picks a quality, a power or a piece of 'ware from the books (FR3.9 P4–P5,
 * docs/CHARGEN.md §8.3 purchases, §8.5 "the quality parser learns …").
 *
 * The seeder keeps a row's cells as the book printed them, strings in
 * `stats` ("4" with `PER: 'rating'`, "4-20", "Rating x 0.1", "[2]"), because
 * a parser that turned them into numbers at compile time would have to be
 * right about every future shape before the first one shipped. Something has
 * to read them back into numbers, and it used to be the server alone
 * (`qualityPrice` / `wareFigures` in apps/server): the builder's Qualities and
 * Gear steps could not import it, so they would have grown a second reader,
 * and a second reader is how the rail and the server's check come to price
 * the same row differently. The reading lives here now, pure, and the server's
 * functions are thin shapes over it.
 *
 * - `catalogueQualityPrice(stats)` — a quality's printed price: flat, per
 *   rating (with the book's maximum), a band the table chooses within, a
 *   list of the only amounts it may choose, or nothing to read ("Varies").
 * - `catalogueQualityKarma(price, choice)` — the Karma a build records for a
 *   rating or a chosen amount.
 * - `cataloguePowerPoints(stats, levels)` — an adept power's cost at a level
 *   count ("0.25 PP per level").
 * - `catalogueWareFigures(row, { rating, grade })` — cost, Essence,
 *   Availability and capacity at a rating, with an implant grade's
 *   multipliers (`IMPLANT_GRADES`, SR5 p. 451) applied when one is asked for.
 *   A build purchase records the *standard* figures (the budget applies the
 *   grade, §8.3), so a caller filling a purchase asks without a grade and a
 *   caller quoting a price asks with one.
 *
 * A rating over the book's maximum is priced, never clamped: the validator is
 * where a table learns its build is over. Numbers only; no book text.
 */
import type { AugmentGrade, QualityType } from '@safehouse/contracts';
import { parseAvailability, type ParsedAvailability } from './budget.js';
import { IMPLANT_GRADES } from './grades.js';

// ---------------------------------------------------------------------------
// Qualities
// ---------------------------------------------------------------------------

/** A quality's printed price, read back from its catalogue stats. */
export interface CatalogueQualityPrice {
  type: QualityType | null;
  /**
   * The printed Karma: a number (per rating when `perRating` is set), the
   * bounds of a band ("4-20") or of a list ("7 or 14"), or null when the book
   * prints no number.
   */
  karma: number | { min: number; max: number } | null;
  /**
   * A list price's amounts, ascending ("7 or 14" → [7, 14]) — the only prices
   * it allows. Absent for a band, where every whole number between the
   * bounds is one.
   */
  choices?: readonly number[];
  /** Priced per rating, with the highest rating the book names (null when it names none). */
  perRating: { max: number | null } | null;
}

/** "4" → 4, "12" → 12; anything else → null. */
function wholeNumber(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** A quality row's price as the catalogue compiled it (`KARMA`, `PER`, `MAX`, `TYPE`). */
export function catalogueQualityPrice(stats: Readonly<Record<string, string>>): CatalogueQualityPrice {
  const type = stats['TYPE'] === 'positive' || stats['TYPE'] === 'negative' ? stats['TYPE'] : null;
  const printed = (stats['KARMA'] ?? '').trim();
  const flat = wholeNumber(printed);
  if (flat !== null) {
    return stats['PER'] === 'rating'
      ? { type, karma: flat, perRating: { max: wholeNumber(stats['MAX']) } }
      : { type, karma: flat, perRating: null };
  }
  const numbers = printed.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length < 2) return { type, karma: null, perRating: null };
  const karma = { min: Math.min(...numbers), max: Math.max(...numbers) };
  // A band is two numbers joined by a dash or "to"; any other run of numbers
  // ("7 or 14", "3, 6, OR 9") is a list, and only its amounts are prices —
  // 10 Karma is not something "7 or 14" allows.
  if (BAND_PRICE.test(printed)) return { type, karma, perRating: null };
  return { type, karma, choices: [...new Set(numbers)].sort((a, b) => a - b), perRating: null };
}

/** "4-20", "4 – 20", "4 to 20 Karma": two numbers with only a dash or "to" between them. */
const BAND_PRICE = /^\D*\d+\s*(?:[-–—]|to)\s*\d+\D*$/i;

/** What the player chose for a quality: its rating, or the Karma within a band. */
export interface QualityKarmaChoice {
  rating?: number | null;
  karma?: number | null;
}

/**
 * The Karma a build records for a quality at a choice — a magnitude, always a
 * whole non-negative number:
 *
 * - per rating: the printed Karma × the rating (1 when none is given), even
 *   past the book's maximum;
 * - flat: the printed Karma, whatever the choice;
 * - a band: the chosen Karma kept inside the printed bounds, the lower bound
 *   when nothing was chosen;
 * - a list: the listed amount nearest the chosen Karma (the lower of two
 *   equally near), the lowest when nothing was chosen;
 * - nothing printed: the chosen Karma, or 0.
 */
export function catalogueQualityKarma(price: CatalogueQualityPrice, choice: QualityKarmaChoice = {}): number {
  const whole = (n: number) => Math.max(0, Math.round(n));
  const { karma } = price;
  if (typeof karma === 'number') {
    if (!price.perRating) return whole(karma);
    const rating = choice.rating != null && choice.rating >= 1 ? Math.round(choice.rating) : 1;
    return whole(karma * rating);
  }
  if (karma !== null) {
    const chosen = choice.karma ?? karma.min;
    const listed = price.choices ?? [];
    if (listed.length > 0) {
      return whole(listed.reduce((best, c) => (Math.abs(c - chosen) < Math.abs(best - chosen) ? c : best), listed[0]!));
    }
    return whole(Math.min(karma.max, Math.max(karma.min, chosen)));
  }
  return whole(choice.karma ?? 0);
}

// ---------------------------------------------------------------------------
// Adept powers
// ---------------------------------------------------------------------------

/** An adept power's cost in power points, read from its printed `COST`. */
export interface CataloguePowerPoints {
  /** The whole cost at the level count asked for; null when no number is printed ("Varies"). */
  points: number | null;
  /** The printed cost is per level. */
  perLevel: boolean;
}

/** "0.5 PP per level" at 3 levels → 1.5; "1 PP" → 1; "Varies" → null. Quarters stay exact. */
export function cataloguePowerPoints(stats: Readonly<Record<string, string>>, levels = 1): CataloguePowerPoints {
  const text = (stats['COST'] ?? '').trim();
  const m = /(\d*\.?\d+)/.exec(text);
  const perLevel = /\bper\s+level\b/i.test(text);
  if (!m) return { points: null, perLevel };
  const each = Number(m[1]);
  const count = perLevel ? Math.max(1, Math.round(levels)) : 1;
  return { points: Math.round(each * count * 100) / 100, perLevel };
}

// ---------------------------------------------------------------------------
// 'Ware and rated gear
// ---------------------------------------------------------------------------

/** The cells of a catalogue row the figures come from (a search hit or a parsed row). */
export interface CatalogueWareRow {
  /** Read for a printed rating ("(Rating 2)") or a rating range ("(Rating 1–3)"). */
  name?: string;
  stats: Readonly<Record<string, string>>;
  avail?: string | null;
  /** The price as a number, when the table printed one. */
  cost?: number | null;
  /** The price as printed, when it is a formula ("Rating x 500¥"). */
  costText?: string | null;
}

export interface CatalogueWareOptions {
  /** The rating bought; without one, a rating the row's name prints is used. */
  rating?: number | null;
  /** An implant grade to apply; none (or standard) gives the list figures a purchase records. */
  grade?: AugmentGrade | null;
}

/** A catalogue row's numbers at a rating and grade. */
export interface CatalogueWareFigures {
  /** Nuyen per unit, whole; null when the price is a formula this cannot read ("Gun + 3,000¥") or needs a rating. */
  cost: number | null;
  /** Essence per unit; 0 when the row prints none or a dash; null when unreadable or it needs a rating. */
  essence: number | null;
  /** Availability read at the rating with the grade's modifier added, and the code as printed. */
  avail: ParsedAvailability & { printed: string | null };
  /** Capacity ("[2]", "[Rating]", "15"); null when the row prints none or it needs a rating. */
  capacity: number | null;
  /** The rating these figures are at: the one asked for, else the one the row's name prints. */
  rating: number | null;
  /** The top of a printed rating range ("(Rating 1–4)"), when the name gives one. */
  maxRating: number | null;
  /** Essence or price is written in Rating, and no rating was given or printed. */
  needsRating: boolean;
}

/** Footnote marks a printed cell can trail. */
const CELL_FOOTNOTE = /[*†‡¹²³]+$/u;

/**
 * "Rating x 0.2", "(Rating x 500)¥", "0.3", "4,000¥" at a rating: a number;
 * `null` when it is a formula in Rating with no rating; `undefined` when it is
 * not something this reads ("Gun + 3,000¥"). A capacity cell is also read in
 * its square brackets, and a bare "Rating" there is the rating itself
 * ("[2]", "[Rating]") — shapes an Essence or price cell never means.
 */
function ratedNumber(text: string, rating: number | null, capacity = false): number | null | undefined {
  let t = text.trim().replace(/¥$/, '').replace(CELL_FOOTNOTE, '').trim();
  const wrapped = capacity ? /^[([](.*)[)\]]$/ : /^\((.*)\)$/;
  while (wrapped.test(t)) t = t.slice(1, -1).trim();
  const figure = (s: string): number | undefined => (/^(?:\d{1,3}(?:,\d{3})+|\d*\.?\d+)$/.test(s) ? Number(s.replace(/,/g, '')) : undefined);
  const plain = figure(t);
  if (plain !== undefined) return plain;
  if (capacity && /^(?:Rating|Level)$/i.test(t)) return rating;
  const m = /^(?:(?:Rating|Level)\s*[x×*]\s*([\d,.]+)|([\d,.]+)\s*[x×*]\s*(?:Rating|Level))$/i.exec(t);
  if (!m) return undefined;
  const factor = figure((m[1] ?? m[2])!);
  if (factor === undefined) return undefined;
  return rating === null ? null : Math.round(factor * rating * 10_000) / 10_000;
}

const isDash = (t: string): boolean => t === '' || /^[—–-]+$/.test(t);

/**
 * A row's cost, Essence, Availability and capacity at a rating and grade.
 * With no grade (or standard) these are the figures a purchase records;
 * with one they are what that grade costs, for a quote or a cap check.
 */
export function catalogueWareFigures(row: CatalogueWareRow, options: CatalogueWareOptions = {}): CatalogueWareFigures {
  const name = row.name ?? '';
  const printedRating = /\((?:Rating|Level)\s+(\d+)\)\s*$/i.exec(name);
  const range = /\((?:Rating|Level)\s+\d+\s*[–—-]\s*(\d+)\)/i.exec(name);
  const rating = options.rating ?? (printedRating ? Number(printedRating[1]) : null);
  const grade = options.grade ? IMPLANT_GRADES[options.grade] : IMPLANT_GRADES.standard;
  let needsRating = false;

  const essenceText = (row.stats['ESSENCE'] ?? '').trim();
  let essence: number | null = 0;
  if (!isDash(essenceText)) {
    const read = ratedNumber(essenceText, rating);
    if (read === null) needsRating = true;
    essence = read ?? null;
  }

  let cost: number | null = row.cost ?? null;
  if (cost === null && row.costText) {
    const read = ratedNumber(row.costText, rating);
    if (read === null) needsRating = true;
    cost = read ?? null;
  }

  const capacityText = (row.stats['CAPACITY'] ?? '').trim();
  const capacity = isDash(capacityText) ? null : (ratedNumber(capacityText, rating, true) ?? null);

  const printedAvail = row.avail ?? null;
  const parsed = parseAvailability(printedAvail, rating);
  const avail = {
    ...parsed,
    value: parsed.value === null ? null : parsed.value + grade.availability,
    printed: printedAvail,
  };

  return {
    cost: cost === null ? null : Math.round(cost * grade.cost),
    essence: essence === null ? null : Math.round(essence * grade.essence * 10_000) / 10_000,
    avail,
    capacity,
    rating,
    maxRating: range ? Number(range[1]) : null,
    needsRating,
  };
}
