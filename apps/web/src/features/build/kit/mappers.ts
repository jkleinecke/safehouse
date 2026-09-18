/**
 * A catalogue row becomes a line of the build (FR3.9, docs/CHARGEN.md §8.3
 * purchases and picks, §8.6 "catalogue picking reuses … toSheet").
 *
 * The sheet already has the mapping from a row the seeder read out of the
 * books to a sheet item (`toSheetItem`), and the rules engine now has the one
 * reader for a row's printed numbers (`catalogueWareFigures`,
 * `catalogueQualityPrice`, `cataloguePowerPoints`). A build line is those two
 * put together — nothing more — so the Gear, Qualities and Magic steps never
 * grow a third copy of either:
 *
 * - `hitToPurchase(hit, { list, rating, grade, qty, cost })` → `BuildPurchase`
 *   with the list price, Essence and printed Availability *at the rating and
 *   standard grade* (the budget applies the grade, §8.3), the device rating
 *   the commlink tables print in their own column, and the sheet item
 *   `toSheetItem` makes (its Essence evaluated at the rating, where
 *   `toSheetItem` alone would read "Rating x 0.1" as 0.1 at any rating).
 * - `hitToQuality(hit, { rating, karma, type })` → `BuildQuality`: a flat
 *   price, a price per rating at the rating, or a band at the Karma the
 *   player chose inside it.
 * - `hitToPick(hit)` → `BuildPick` for a spell, ritual, preparation or
 *   complex form, off the sheet's own line for the row: its category is what
 *   tells the engine's caps a ritual from a spell (`formulaGroup`), and the
 *   drain code (a form's fading and target) and printed note ride along so
 *   the approved sheet rolls drain without a second trip to the books.
 * - `hitToPower(hit, levels)` → `BuildPowerPick` with the power points at
 *   that many levels.
 *
 * Each result is parsed with the contract's schema, so a line the autosave
 * would be refused for fails here, at the tap, not a second later on the
 * server. Pure; tested with invented rows (`mappers.test.ts`).
 */
import {
  BuildPickSchema,
  BuildPowerPickSchema,
  BuildPurchaseSchema,
  BuildQualitySchema,
  PURCHASE_LISTS,
  type AugmentGrade,
  type BuildPick,
  type BuildPowerPick,
  type BuildPurchase,
  type BuildQuality,
  type PurchaseList,
  type QualityType,
  type Ref,
} from '@safehouse/contracts';
import { catalogueQualityKarma, catalogueQualityPrice, cataloguePowerPoints, catalogueWareFigures, qualityRuleFor } from '@safehouse/rules';
import { listFor, toSheetItem, type CatalogueHit, type SheetItemOf } from '../../sheet/catalogue/toSheet.js';

/** The page a row came from; a hand-written row may have none. */
export function hitRef(hit: Pick<CatalogueHit, 'bookCode' | 'printedPage'>): Ref | undefined {
  return hit.bookCode && hit.printedPage > 0 ? { book: hit.bookCode, page: hit.printedPage } : undefined;
}

/** The catalogue row id, unless the row was written by hand (`customHit`). */
function catalogueIdOf(hit: Pick<CatalogueHit, 'id'>): { catalogueId?: string } {
  return hit.id && hit.id !== 'custom' ? { catalogueId: hit.id } : {};
}

/** A whole number printed in a cell ("3"), or null. */
function printedInt(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

/** Which purchase list a row of this kind lands on: weapons, armor, 'ware, or gear for everything else. */
export function purchaseListFor(kind: string): PurchaseList {
  const list = listFor(kind);
  return (PURCHASE_LISTS as readonly string[]).includes(list) ? (list as PurchaseList) : 'gear';
}

/** The catalogue kind whose sheet mapping makes an item for a list. */
const KIND_FOR_LIST: Readonly<Record<PurchaseList, string>> = {
  gear: 'gear',
  weapons: 'weapon',
  armor: 'armor',
  augments: 'augmentation',
};

export interface PurchaseChoice {
  /** The list to buy onto, when not the kind's own (a focus or a spell formula bought as gear). */
  list?: PurchaseList;
  /** The rating bought; a rating printed in the row's name or its Rating column otherwise. */
  rating?: number | null;
  /** 'Ware only: the grade (default standard). The purchase keeps list figures; the budget applies it. */
  grade?: AugmentGrade | null;
  qty?: number;
  /** A price typed over the list price (the table's own, or one the row cannot print as a number). */
  cost?: number | null;
}

/** A catalogue row bought with nuyen. Throws when the row cannot make a legal purchase line. */
export function hitToPurchase(hit: CatalogueHit, choice: PurchaseChoice = {}): BuildPurchase {
  const list = choice.list ?? purchaseListFor(hit.kind);
  const mapped = toSheetItem(listFor(hit.kind) === list ? hit : { ...hit, kind: KIND_FOR_LIST[list] });
  const figures = catalogueWareFigures(hit, { rating: choice.rating ?? null });
  const rating = choice.rating ?? figures.rating ?? printedInt(hit.stats['RATING']);
  const deviceRating = printedInt(hit.stats['DEVICE RATING']);
  const essence = list === 'augments' ? (figures.essence ?? 0) : 0;
  const item =
    list === 'augments' && figures.essence !== null
      ? { ...mapped.item, essence: figures.essence }
      : list === 'gear' && rating !== null
        ? { ...mapped.item, rating }
        : mapped.item;
  const ref = hitRef(hit);
  return BuildPurchaseSchema.parse({
    list,
    kind: hit.kind,
    name: hit.name,
    ...(ref ? { ref } : {}),
    ...catalogueIdOf(hit),
    ...(hit.category ? { category: hit.category.slice(0, 120) } : {}),
    qty: Math.max(1, Math.round(choice.qty ?? 1)),
    rating,
    ...(deviceRating !== null && deviceRating <= 24 ? { deviceRating } : {}),
    grade: list === 'augments' ? (choice.grade ?? 'standard') : null,
    cost: Math.max(0, Math.round(choice.cost ?? figures.cost ?? 0)),
    avail: hit.avail,
    essence,
    item,
  });
}

export interface QualityChoice {
  /** A rated quality's rating (default 1). */
  rating?: number | null;
  /** The Karma chosen inside a band, or typed for a quality that prints none. */
  karma?: number | null;
  /** Positive or negative, for a hand-written row that does not say; the book's own word wins. */
  type?: QualityType;
}

/**
 * The side a quality row sits on, as the book says it: the row's own TYPE
 * column, then the engine's whitelist for a name it knows, then the table the
 * row was read from ("NEGATIVE QUALITIES"). Null when none of them says — a
 * hand-written row, which asks the player. Every caller reads one answer.
 */
export function hitQualityType(hit: Pick<CatalogueHit, 'name' | 'stats' | 'category'>): QualityType | null {
  const printed = catalogueQualityPrice(hit.stats).type;
  if (printed) return printed;
  const entry = qualityRuleFor(hit.name);
  if (entry) return entry.type;
  if (/\bnegative\b/i.test(hit.category)) return 'negative';
  if (/\bpositive\b/i.test(hit.category)) return 'positive';
  return null;
}

/** A catalogue quality taken at a rating or a chosen Karma. */
export function hitToQuality(hit: CatalogueHit, choice: QualityChoice = {}): BuildQuality {
  const price = catalogueQualityPrice(hit.stats);
  const rating = price.perRating ? Math.max(1, Math.round(choice.rating ?? 1)) : null;
  const ref = hitRef(hit);
  return BuildQualitySchema.parse({
    name: hit.name,
    ...(ref ? { ref } : {}),
    ...catalogueIdOf(hit),
    // The printed column wins; then the player's answer; then what the table heading says.
    type: price.type ?? choice.type ?? hitQualityType(hit) ?? 'positive',
    karma: catalogueQualityKarma(price, { rating, karma: choice.karma ?? null }),
    rating,
  });
}

/** A field the pick schema bounds, trimmed and clipped to fit; absent when empty. */
function bounded<K extends string>(key: K, text: string | undefined, max: number): Partial<Record<K, string>> {
  const value = text?.trim();
  return value ? ({ [key]: value.slice(0, max) } as Partial<Record<K, string>>) : {};
}

/**
 * A spell, ritual, preparation or complex form picked from the catalogue —
 * made from the sheet's own line for the row (`toSheetItem`), so what the
 * approved sheet rolls travels with the pick: a spell's category as the
 * sheet writes it ("combat", "rituals"), its drain code ("F-3") and the
 * printed type, range, damage and duration as its note; a form's target,
 * fading and duration. `compileBuild` writes them onto the sheet as they are.
 */
export function hitToPick(hit: CatalogueHit): BuildPick {
  const ref = hitRef(hit);
  const base = { name: hit.name, ...(ref ? { ref } : {}), ...catalogueIdOf(hit) };
  const mapped = toSheetItem(hit);
  if (mapped.list === 'spells') {
    const spell = mapped.item as SheetItemOf<'spells'>;
    return BuildPickSchema.parse({
      ...base,
      ...bounded('category', spell.category, 200),
      ...bounded('drain', spell.drain, 40),
      ...bounded('note', spell.note, 200),
    });
  }
  const category = hit.category.trim().toLowerCase();
  if (mapped.list === 'complexForms') {
    const form = mapped.item as SheetItemOf<'complexForms'>;
    return BuildPickSchema.parse({
      ...base,
      ...(category ? { category } : {}),
      ...bounded('target', form.target, 80),
      ...bounded('fading', form.fading, 40),
      ...bounded('note', form.note, 200),
    });
  }
  return BuildPickSchema.parse({ ...base, ...(category ? { category } : {}) });
}

/** An adept power at a number of levels, its power points read from the row. */
export function hitToPower(hit: CatalogueHit, levels = 1, target?: string): BuildPowerPick {
  const count = Math.max(1, Math.round(levels));
  const points = cataloguePowerPoints(hit.stats, count);
  const ref = hitRef(hit);
  return BuildPowerPickSchema.parse({
    name: hit.name,
    ...(ref ? { ref } : {}),
    ...catalogueIdOf(hit),
    cost: points.points ?? 0,
    levels: count,
    ...(target ? { target } : {}),
    mods: [],
  });
}
