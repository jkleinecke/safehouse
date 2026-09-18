/**
 * What the builder's catalogue picker says about one row, before it is
 * picked (FR3.9, docs/CHARGEN.md §4.4 Step 7 "anything over is shown greyed
 * with its number", Step 5 "name, cost or bonus, page", §8.5 browse mode).
 *
 * A row in the builder is not a row in the sheet's "add from the books"
 * dialog: the question is not only "what is it" but "may this runner start
 * with it". Three answers per row, all pure and all read through the rules
 * engine's catalogue readers so the picker, the rail and the server's check
 * agree on every number:
 *
 * - `hitPrice` — what it costs in the currency it is bought with: nuyen at
 *   the rating and grade, a quality's Karma (flat, per rating, or a band),
 *   an adept power's points.
 * - `hitAvailability` — its Availability read at the rating and grade, or
 *   the printed code with why it cannot be read yet ("depends on the
 *   rating").
 * - `hitCapRefusals` — the campaign caps it is over, each a sentence with
 *   its number and the page (`issueRule`'s ref, so the "why?" chip opens where
 *   the validator's own issue does). A row over a cap is shown greyed with
 *   these, never hidden: a player hunting for the cyberdeck their concept
 *   needs should learn it is out of reach at this level, not that it does
 *   not exist.
 *
 * The comparison is the one the validator makes (`purchaseAvailability`
 * against `maxAvailability`, `purchaseDeviceRating` of a device against
 * `maxDeviceRating`), made on the purchase line `hitToPurchase` would add, so a
 * row the picker offers is a line the validator accepts on those two counts.
 *
 * Also `hitGmNote` (a Restricted or Forbidden row is taken only with the GM's
 * say-so, which the row says before the tap), `hitRatingRange` (does picking
 * this ask for a rating, and up to what) and the browse-page helpers
 * `useBuilderCatalogue` pages with.
 */
import type { AugmentGrade, ChargenSettings } from '@safehouse/contracts';
import {
  catalogueQualityPrice,
  cataloguePowerPoints,
  catalogueWareFigures,
  isDevice,
  issueRule,
  purchaseAvailability,
  purchaseDeviceRating,
} from '@safehouse/rules';
import type { CataloguePage } from '../../sheet/catalogue/api.js';
import type { CatalogueHit } from '../../sheet/catalogue/toSheet.js';
import type { Refusal } from '../components/LimitStepper.js';
import { formatNuyen } from '../lib.js';
import { hitToPurchase } from './mappers.js';

/** A rating and grade to read a row at; unset reads the row as printed. */
export interface HitReading {
  rating?: number | null;
  grade?: AugmentGrade | null;
}

/** Kinds not bought with nuyen at creation: no price in nuyen, no Availability, no caps. */
/** "7 or 14", "3, 6 or 9": a list price's amounts as the book would say them. */
function listWords(amounts: readonly number[]): string {
  if (amounts.length <= 1) return amounts.join('');
  return `${amounts.slice(0, -1).join(', ')} or ${amounts[amounts.length - 1]}`;
}

const NOT_BOUGHT = new Set(['quality', 'spell', 'power', 'complex_form']);

/** Whether a row of this kind is bought with nuyen (and so has Availability and caps). */
export function boughtWithNuyen(kind: string): boolean {
  return !NOT_BOUGHT.has(kind);
}

/**
 * The row's price in words: "12,000¥", "Rating x 500¥" (until a rating is
 * chosen), "4 Karma per rating, up to 3", "4–20 Karma", "7 or 14 Karma" (a list,
 * only those amounts), "0.5 PP per level".
 * Null for a spell or complex form, which the Magic step counts rather than
 * prices.
 */
export function hitPrice(hit: CatalogueHit, reading: HitReading = {}): string | null {
  switch (hit.kind) {
    case 'spell':
    case 'complex_form':
      return null;
    case 'quality': {
      const price = catalogueQualityPrice(hit.stats);
      const { karma, perRating } = price;
      if (typeof karma === 'number') {
        if (!perRating) return `${karma} Karma`;
        return `${karma} Karma per rating${perRating.max !== null ? `, up to ${perRating.max}` : ''}`;
      }
      if (karma && price.choices) return `${listWords(price.choices)} Karma`;
      if (karma) return `${karma.min}–${karma.max} Karma`;
      return 'Karma not printed';
    }
    case 'power': {
      const points = cataloguePowerPoints(hit.stats);
      if (points.points === null) return 'power points not printed';
      return `${points.points} PP${points.perLevel ? ' per level' : ''}`;
    }
    default: {
      const figures = catalogueWareFigures(hit, reading);
      if (figures.cost !== null) return formatNuyen(figures.cost);
      return hit.costText ?? 'no price printed';
    }
  }
}

/**
 * Availability in words at the rating and grade: "Availability 12R";
 * "Availability Rating x 6R, depends on the rating"; "Availability +2, added to
 * what it mounts on". Null when nothing is printed, or the kind is not bought.
 */
export function hitAvailability(hit: CatalogueHit, reading: HitReading = {}): string | null {
  if (!boughtWithNuyen(hit.kind)) return null;
  const { avail } = catalogueWareFigures(hit, reading);
  switch (avail.status) {
    case 'none':
      return null;
    case 'ok':
      return `Availability ${avail.value}${avail.legality ?? ''}`;
    case 'needsRating':
      return `Availability ${avail.printed}, depends on the rating`;
    case 'relative':
      return `Availability ${avail.printed}, added to what it mounts on`;
    default:
      return `Availability ${avail.printed}`;
  }
}

/**
 * The campaign caps a row is over at a rating and grade, each with its
 * number and page — empty when it may be taken. Read off the purchase line
 * the row would add, with the engine's own readers.
 */
export function hitCapRefusals(
  hit: CatalogueHit,
  settings: Pick<ChargenSettings, 'maxAvailability' | 'maxDeviceRating'>,
  reading: HitReading = {},
): Refusal[] {
  if (!boughtWithNuyen(hit.kind)) return [];
  let purchase;
  try {
    purchase = hitToPurchase(hit, { rating: reading.rating ?? null, grade: reading.grade ?? null });
  } catch {
    return [];
  }
  const out: Refusal[] = [];
  const avail = purchaseAvailability(purchase);
  if (avail.value !== null && avail.value > settings.maxAvailability) {
    const ref = issueRule('availability-over')?.ref;
    out.push({
      reason: `Availability ${avail.value} is over this campaign's cap of ${settings.maxAvailability}.`,
      ...(ref ? { ref } : {}),
    });
  }
  const deviceRating = purchaseDeviceRating(purchase);
  if (isDevice(purchase) && deviceRating !== null && deviceRating > settings.maxDeviceRating) {
    const ref = issueRule('device-rating-over')?.ref;
    out.push({
      reason: `Device rating ${deviceRating} is over this campaign's cap of ${settings.maxDeviceRating}.`,
      ...(ref ? { ref } : {}),
    });
  }
  return out;
}

/**
 * "Restricted: needs the GM." — a row whose Availability carries R or F at
 * the rating and grade, with the page the validator's `approval-gear` item
 * cites. Not a refusal: the row may be picked, and the GM decides it on
 * review; saying so on the row means a player learns it before the tap, not
 * from the issues list after. Read off the purchase line, as the validator
 * reads it. Null for a legal row, or one not bought with nuyen.
 */
export function hitGmNote(hit: CatalogueHit, reading: HitReading = {}): (Refusal & { legality: 'R' | 'F' }) | null {
  if (!boughtWithNuyen(hit.kind)) return null;
  let purchase;
  try {
    purchase = hitToPurchase(hit, { rating: reading.rating ?? null, grade: reading.grade ?? null });
  } catch {
    return null;
  }
  const { legality } = purchaseAvailability(purchase);
  if (!legality) return null;
  const ref = issueRule('approval-gear')?.ref;
  return { legality, reason: `${legality === 'F' ? 'Forbidden' : 'Restricted'}: needs the GM.`, ...(ref ? { ref } : {}) };
}

/** The ratings picking a row asks for: from 1 up to the book's maximum (null when it prints none). */
export interface RatingRange {
  min: number;
  max: number | null;
}

/**
 * Whether picking a row asks for a rating, and its range: a quality priced
 * per rating, a power priced per level, a row whose price, Essence or
 * Availability is written in Rating, or a name printing a rating range.
 * Null when there is nothing to choose.
 */
export function hitRatingRange(hit: CatalogueHit): RatingRange | null {
  if (hit.kind === 'quality') {
    const { perRating } = catalogueQualityPrice(hit.stats);
    return perRating ? { min: 1, max: perRating.max } : null;
  }
  if (hit.kind === 'power') return cataloguePowerPoints(hit.stats).perLevel ? { min: 1, max: null } : null;
  if (!boughtWithNuyen(hit.kind)) return null;
  const figures = catalogueWareFigures(hit);
  if (figures.maxRating !== null) return { min: 1, max: figures.maxRating };
  if (figures.rating !== null) return null;
  return figures.needsRating || figures.avail.status === 'needsRating' ? { min: 1, max: null } : null;
}

// ---------------------------------------------------------------------------
// Browse pages
// ---------------------------------------------------------------------------

/** A page as the server answers it, read tolerantly: an older server sends no total or paging. */
export function readCataloguePage(raw: unknown, offset: number): CataloguePage {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const hits = Array.isArray(r['hits']) ? (r['hits'] as CatalogueHit[]) : [];
  return {
    query: typeof r['query'] === 'string' ? r['query'] : '',
    hits,
    total: typeof r['total'] === 'number' ? r['total'] : hits.length,
    offset: typeof r['offset'] === 'number' ? r['offset'] : offset,
    limit: typeof r['limit'] === 'number' ? r['limit'] : hits.length,
    hasMore: r['hasMore'] === true,
  };
}

/** Where the page after this one starts, or undefined at the end. */
export function nextPageOffset(page: CataloguePage): number | undefined {
  return page.hasMore && page.hits.length > 0 ? page.offset + page.hits.length : undefined;
}

/** Pages laid end to end: every hit once (a row that moved between pages is not listed twice), the last page's total. */
export function mergeCataloguePages(pages: readonly CataloguePage[]): { hits: CatalogueHit[]; total: number | null; hasMore: boolean } {
  const seen = new Set<string>();
  const hits: CatalogueHit[] = [];
  for (const page of pages) {
    for (const hit of page.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
  }
  const last = pages[pages.length - 1];
  return { hits, total: last ? last.total : null, hasMore: last ? last.hasMore : false };
}
