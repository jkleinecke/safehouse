/**
 * The catalogue — items, spells, powers and qualities read OUT of the GM's
 * own book pages, so a sheet can pick one by name and carry its stats and
 * the page it came from.
 *
 * The books print their gear as tables, and pdf.js hands those tables back
 * one row per line under a header line naming the columns:
 *
 *   HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST
 *   Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥
 *
 * and their spells as a name over a stat line:
 *
 *   SOME SPELL
 *   Type: M Range: LOS Damage: P
 *   Duration: I Drain: F – 3
 *
 * `parsePageItems` turns one page of that text into rows; `compileCatalogue`
 * runs it over every page of a book already in `book_pages` and writes
 * `book_items`. Everything here is shape, not content: the parser knows what
 * a column header looks like and what a price looks like, and nothing else
 * (§14). Rows are parsed from the RIGHT — cost, then availability, then one
 * cell per stat column — because the name is the only cell whose width the
 * table does not fix.
 *
 * What it does not try to do: prose ("they have an Availability of 4F…"),
 * tables whose rows wrap over two lines, or ratings tables that print one
 * row per rating. Those items are still on the page, still in full-text
 * search, still a ref away; they are just not pickable by name.
 *
 * `stats` stays a map of strings — the column as printed — because that is
 * what `book_items.stats`, the search hit and the sheet's mapping all type it
 * as. Where the character builder has to do arithmetic (docs/CHARGEN.md §5
 * P4, §8.5) the parser writes the number in a form `Number()` reads rather
 * than inventing a second, typed record:
 *
 * - A quality's price. "Cost: 12 Karma" is `{ KARMA: '12' }`. A price per
 *   rating, "Cost: 6 Karma per rating (max rating 4)", is
 *   `{ KARMA: '6', PER: 'rating', MAX: '4' }` (a "per level" price reads the
 *   same: a quality's level is its rating). A band the table picks within,
 *   "Bonus: 4 to 25 Karma", is `{ KARMA: '4-25' }` — a hyphen, however the
 *   page printed the dash. A list of prices ("7 or 14") stays as printed.
 *   `qualityPrice` reads all of these back (through the rules engine's
 *   `catalogueQualityPrice`, which the builder's steps call directly).
 * - 'Ware. Essence and price are the standard grade's — the tables print no
 *   other, and the grade multipliers are the rules engine's
 *   (`IMPLANT_GRADES`), applied to a purchase, never to the catalogue. An
 *   Essence cell loses its footnote marks and a formula its brackets and its
 *   "×" ("0.2", "Rating x 0.2"); `cost` is the price as a number and
 *   `costText` the formula. `wareFigures` turns a row and a rating into the
 *   numbers a purchase records (the rules engine's `catalogueWareFigures`,
 *   which also quotes a grade).
 * - Availability is kept exactly as printed ("12F", "6R", "—",
 *   "(Rating x 2)R", "+2"): the rules engine's `parseAvailability` reads the
 *   code against the rating the purchase chose, and a rewritten code would be
 *   one it had never been tested on.
 *
 * All of this lands at compile time. Rows already in `book_items` keep the
 * shape they were compiled with until the book is compiled again — the GM's
 * "recompile" on the shelf (`POST /api/books/:id/catalogue`) or
 * `seed:books --catalogue` — which rereads the stored pages and replaces the
 * book's rows, so a parser change reaches an existing library without the
 * PDFs being extracted again.
 */
import { asc, eq } from 'drizzle-orm';
import { catalogueQualityKarma, catalogueQualityPrice, catalogueWareFigures } from '@safehouse/rules';
import { bookItems, bookPages, type Db } from '@safehouse/db';

export type ItemKind =
  | 'weapon'
  | 'ammo'
  | 'armor'
  | 'augmentation'
  | 'vehicle'
  | 'electronics'
  | 'program'
  | 'gear'
  | 'spell'
  | 'power'
  | 'quality'
  | 'complex_form';

export const ITEM_KINDS: readonly ItemKind[] = [
  'weapon',
  'ammo',
  'armor',
  'augmentation',
  'vehicle',
  'electronics',
  'program',
  'gear',
  'spell',
  'power',
  'quality',
  'complex_form',
];

export interface ParsedItem {
  kind: ItemKind;
  /** The table's own heading ("HEAVY PISTOLS") or the section above it. */
  category: string;
  name: string;
  /** The table's columns as printed, keyed by the header's own words. */
  stats: Record<string, string>;
  avail: string | null;
  /** The price as a number when the table printed one. */
  cost: number | null;
  /** The price as printed when it is a formula ("Rating x 500¥"). */
  costText: string | null;
  /** The page the row was read from — or the page the row itself cites. */
  printedPage: number;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Two-word column names, folded to one token before the header is split. */
const MULTI_WORD_COLUMNS = [
  'DEVICE RATING',
  'ARMOR RATING',
  'DAMAGE MODIFIER',
  'AP MODIFIER',
  'ACCESSORY MOUNT',
  'NANOTECH TYPE',
  'DEVICE TYPE',
  'COST (PER DOSE)',
  'ACTIONS TO DON',
];

const COLUMN_WORDS = new Set([
  'ACC',
  'ACCURACY',
  'HANDLING',
  'ACCELERATION',
  'DAMAGE',
  'DV',
  'DAM',
  'AP',
  'MODE',
  'RC',
  'AMMO',
  'AVAIL',
  'AVAILABILITY',
  'COST',
  'PAGE',
  'REF',
  'ARMOR',
  'RATING',
  'CAPACITY',
  'ESSENCE',
  'DEVICE',
  'HANDL',
  'HANDL*',
  'SPEED',
  'SPEED*',
  'ACCEL',
  'BOD',
  'BODY',
  'ARM',
  'PILOT',
  'SENS',
  'SENSOR',
  'SEATS',
  'BLAST',
  'REACH',
  'PROGRAMS',
  'ARRAY',
  'ITEM',
  'SUBSTANCE',
  'TRANSGENICS',
  ...MULTI_WORD_COLUMNS.map((c) => c.replace(/ /g, '_')),
]);

/** Columns that label the NAME cell rather than a stat. */
const NAME_COLUMNS = new Set(['ITEM', 'SUBSTANCE', 'TRANSGENICS', 'DEVICE', 'DEVICE_TYPE', 'NANOTECH_TYPE']);
/** Columns that are not stats: the price, the availability, a page citation. */
const TAIL_COLUMNS = new Set(['AVAIL', 'AVAILABILITY', 'COST', 'COST_(PER_DOSE)', 'PAGE', 'REF']);

export interface TableHeader {
  category: string;
  kind: ItemKind;
  /** Stat columns, left to right, as printed (underscores for two-word names). */
  stats: string[];
  /** The row cites its own page in a trailing column. */
  hasPageColumn: boolean;
}

/** A line that names a table's columns, or null. */
export function parseHeader(line: string): TableHeader | null {
  const raw = line.trim();
  if (raw.length < 10 || raw.length > 120) return null;
  if (/[a-z]/.test(raw.replace(/\(w\/ facility\)/i, ''))) return null; // prose
  if (/[,.:;]/.test(raw.replace(/\(PER DOSE\)/, ''))) return null; // a sentence, not a header
  if (!/\bAVAIL(?:ABILITY)?\b/.test(raw) || !/\bCOST\b/.test(raw)) return null;
  let folded = raw.toUpperCase();
  for (const c of MULTI_WORD_COLUMNS) folded = folded.split(c).join(c.replace(/ /g, '_'));
  const tokens = folded.split(/\s+/).filter((t) => t.length > 0);
  // The columns are the longest all-vocabulary suffix; what precedes them is
  // the table's heading ("HEAVY PISTOLS").
  let start = tokens.length;
  while (start > 0 && COLUMN_WORDS.has(tokens[start - 1]!)) start -= 1;
  let columns = tokens.slice(start);
  const last = columns[columns.length - 1];
  if (!columns.some((c) => c === 'COST' || c === 'COST_(PER_DOSE)')) return null;
  if (!(last === 'COST' || last === 'COST_(PER_DOSE)' || last === 'PAGE' || last === 'REF')) return null;
  // "ARMOR ARMOR_RATING …": the first ARMOR is the heading, not a column.
  let category = tokens.slice(0, start).join(' ');
  while (columns.length > 1 && columns[1]!.startsWith(`${columns[0]!}_`)) {
    category = `${category} ${columns[0]!}`.trim();
    columns = columns.slice(1);
  }
  const stats = columns.filter((c, i) => !TAIL_COLUMNS.has(c) && !(i === 0 && NAME_COLUMNS.has(c)));
  if (stats.some((c) => NAME_COLUMNS.has(c) && c !== 'DEVICE')) return null;
  return {
    category: category.replace(/_/g, ' '),
    kind: kindOf(columns),
    stats: stats.map((c) => c.replace(/_/g, ' ')),
    hasPageColumn: last === 'PAGE' || last === 'REF',
  };
}

function kindOf(columns: readonly string[]): ItemKind {
  const has = (c: string) => columns.includes(c);
  if (has('HANDL') || has('HANDL*') || has('HANDLING')) return 'vehicle';
  if ((has('ACC') || has('ACCURACY')) && (has('DV') || has('DAMAGE') || has('DAM'))) return 'weapon';
  if (has('DAMAGE_MODIFIER') || ((has('DAMAGE') || has('DV')) && has('AP') && !has('ACC'))) return 'ammo';
  if (has('ESSENCE')) return 'augmentation';
  if (has('ARMOR') || has('ARMOR_RATING')) return 'armor';
  if (has('DEVICE_RATING') || has('DEVICE')) return 'electronics';
  if (has('PROGRAMS') || has('ARRAY')) return 'program';
  return 'gear';
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Words that belong to a price formula rather than to a name. */
const COST_WORDS = new Set([
  'x',
  '×',
  '+',
  'per',
  'rating',
  'level',
  'force',
  'body',
  'grade',
  'gun',
  'weapon',
  'magnitude',
  'dose',
  'month',
  'week',
  'day',
  'hour',
  'vehicle',
  'armor',
  'device',
]);

const PRICE = /^\(?[\d,]+\)?¥$/;
const REF_PIECE = /^(?:\d{1,3}|p\.?|pg\.?|pp\.?|[A-Z]{2,4}\d?)$/;
/**
 * An Availability cell: a dash, "12", "12F", "16+", a bracketed formula
 * ("(Rating x 2)R"), a bare one ("Rating x 6R", "10 + Rating"), or an
 * accessory's addition to what it mounts on ("+2", "+4R").
 */
const AVAIL = /^(?:[—–-]|\d{1,3}[RFrf]?\+?|\+\d{1,2}[RFrf]?|\(.*\)[RFrf]?|(?:Rating|Force|Level)\s*[x×]\s*\d+[RFrf]?|\d+\s*\+\s*Rating)$/;
const NUMERIC_CELL = /^(?:\d+[A-Za-z]?|[\d.]+|\d+\/\d+)$/;

/**
 * Split a row into cells: parenthesised groups stay together ("(STR + 2)P",
 * "(Rating x 2)R"), a standalone slash joins its neighbours ("SA / BF",
 * "6P / 7P"), and a group after a number is that number's note ("5 (7)",
 * "15 (c)", "9P (f)") — but not after a mode ("SA / BF (1)" is a mode and
 * a recoil compensation).
 */
export function splitCells(line: string): string[] {
  const tokens = line.trim().split(/\s+/);
  const groups: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    let t = tokens[i]!;
    if (t.startsWith('(') && !t.includes(')')) {
      while (i + 1 < tokens.length && !t.includes(')')) {
        i += 1;
        t = `${t} ${tokens[i]!}`;
      }
    }
    groups.push(t);
  }
  const cells: string[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]!;
    // "Rating x 0.2", "Force x 3": a formula is one cell.
    if (
      /^[x×]$/.test(g) &&
      cells.length > 0 &&
      /^(?:Rating|Force|Level|Body|Grade)$/i.test(cells[cells.length - 1]!) &&
      i + 1 < groups.length &&
      /^[\d.,]+[A-Za-z¥]*$/.test(groups[i + 1]!)
    ) {
      i += 1;
      cells[cells.length - 1] = `${cells[cells.length - 1]!} x ${groups[i]!}`;
      continue;
    }
    if (g === '/' && cells.length > 0 && i + 1 < groups.length) {
      i += 1;
      cells[cells.length - 1] = `${cells[cells.length - 1]!} / ${groups[i]!}`;
      continue;
    }
    if (/^\(.*\)$/.test(g) && cells.length > 0 && NUMERIC_CELL.test(cells[cells.length - 1]!)) {
      cells[cells.length - 1] = `${cells[cells.length - 1]!} ${g}`;
      continue;
    }
    cells.push(g);
  }
  return cells;
}

/** True for a line that is a whole-section heading ("ARMOR", "COMBAT SPELLS"). */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 48) return false;
  if (/[a-z]/.test(t)) return false;
  if (!/[A-Z]{2}/.test(t)) return false;
  if (/¥|\d{3}/.test(t)) return false;
  if (/[:.]$/.test(t)) return false;
  return true;
}

function priceOf(costText: string): number | null {
  const m = /^([\d,]+)¥$/.exec(costText);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

/** Footnote marks a printed cell can trail: asterisks, daggers, superscript digits. */
const FOOTNOTE = /[*†‡¹²³]+$/u;

/**
 * An Essence cell in a form arithmetic can read: "0.2*" → "0.2", ".5" →
 * "0.5", "(Rating × 0.1)" → "Rating x 0.1". A dash, a bracket that is not a
 * formula, or anything else is left as printed.
 */
export function essenceCell(cell: string): string {
  const t = cell.trim().replace(FOOTNOTE, '');
  if (/^\d*\.?\d+$/.test(t)) return String(Number(t));
  const formula = /^\(?\s*(Rating|Level)\s*[x×*]\s*(\d*\.?\d+)\s*\)?$/i.exec(t);
  if (formula) return `Rating x ${String(Number(formula[2]!))}`;
  return t.length > 0 ? t : cell;
}

/** A line that could be an item's name: short, wordy, not a row, not a header. */
function looksLikeName(line: string | null | undefined): line is string {
  const t = (line ?? '').trim();
  return t.length >= 2 && t.length <= 60 && /[A-Za-z]{2}/.test(t) && !/\d¥\s*$/.test(t) && parseHeader(t) === null;
}

/**
 * One table row under `header`, or null when the line is not one.
 *
 * A row with no name of its own takes it from the line above — a vehicle's
 * model over its numbers — and when the line above is the header itself,
 * from `nameAbove`: the heading the books print over a one-row table
 * ("COMBAT AXE", then the columns, then the numbers).
 */
export function parseRow(
  line: string,
  header: TableHeader,
  previousLine: string | null,
  printedPage: number,
  nameAbove: string | null = null,
  /** The last non-row line under this header — the item a run of "Rating N" rows belongs to. */
  subheading: string | null = null,
): ParsedItem | null {
  let cells = splitCells(line);
  if (cells.length < 2) return null;
  let refPage: number | null = null;
  if (header.hasPageColumn) {
    // Trailing citation: "12", "p. 12", "SR5 p. 425" — peel it off the end.
    const pieces: string[] = [];
    while (cells.length > 0 && REF_PIECE.test(cells[cells.length - 1]!) && !cells[cells.length - 1]!.includes('¥')) {
      pieces.unshift(cells.pop()!);
      if (pieces.length >= 3) break;
    }
    const n = pieces.find((p) => /^\d{1,3}$/.test(p));
    if (n !== undefined) refPage = Number(n);
  }
  if (cells.length < 2 || !PRICE.test(cells[cells.length - 1]!)) {
    // A formula price ends in ¥ too ("Rating x 500¥"), but so does nothing else.
    if (cells.length < 2 || !/\d¥$/.test(cells[cells.length - 1]!)) return null;
  }
  const costParts = [cells.pop()!];
  while (cells.length > 0 && costParts.length < 4 && COST_WORDS.has(cells[cells.length - 1]!.toLowerCase())) {
    costParts.unshift(cells.pop()!);
  }
  const costText = costParts.join(' ');
  const cost = priceOf(costText);
  let avail: string | null = null;
  if (cells.length > 0 && AVAIL.test(cells[cells.length - 1]!)) avail = cells.pop()!;
  const n = header.stats.length;
  if (cells.length < n) return null;
  const statCells = cells.slice(cells.length - n);
  let nameCells = cells.slice(0, cells.length - n);
  if (nameCells.length === 0) {
    const prev = previousLine?.trim() ?? '';
    if (parseHeader(prev) !== null) {
      if (!looksLikeName(nameAbove)) return null;
      nameCells = [nameAbove.trim().replace(/\s*\*+$/, '')];
    } else {
      if (!looksLikeName(prev)) return null;
      nameCells = [prev.replace(/\s*\*+$/, '')];
    }
  }
  let name = nameCells.join(' ').replace(/\s*\*+$/, '').trim();
  // "(Rating 1-6)" on its own is the line above's rating range.
  if (/^\(/.test(name) && !/[A-Za-z]/.test(name.replace(/\(.*?\)/g, '')) && looksLikeName(previousLine)) {
    name = `${previousLine.trim()} ${name}`;
  }
  // "Rating 2" under "Wired Reflexes": the sub-heading is the item, the row its rating.
  if (/^(?:Rating|Level|Grade)\s+\d/i.test(name) && looksLikeName(subheading)) {
    // "Wired Nerves (Rating 1-3)" over "Rating 2" reads "Wired Nerves (Rating 2)".
    name = `${subheading.trim().replace(/\s*\((?:Rating|Level|Grade)[^)]*\)\s*$/i, '')} (${name})`;
  }
  // A heading's name in capitals reads as a name on a sheet.
  if (!/[a-z]/.test(name)) name = titleCase(name);
  if (name.length < 2 || !/[A-Za-z]/.test(name)) return null;
  const stats: Record<string, string> = {};
  header.stats.forEach((col, i) => {
    stats[col] = col === 'ESSENCE' ? essenceCell(statCells[i]!) : statCells[i]!;
  });
  return {
    kind: header.kind,
    category: header.category,
    name,
    stats,
    avail,
    cost,
    costText: cost === null ? costText : null,
    printedPage: refPage ?? printedPage,
  };
}

// ---------------------------------------------------------------------------
// Spells, powers, qualities, complex forms — a name over a stat line
// ---------------------------------------------------------------------------

const NAME_LINE = /^[A-Z][A-Z0-9 '’\-(),/&\[\]]{1,46}$/;
/**
 * The labels are matched without regard to case: a section may print "Cost:"
 * or "COST:", and the books do both (most quality sections are in capitals —
 * a case-sensitive match read none of them).
 */
const STAT_LABELS = 'Type|Range|Damage|Duration|Drain|Cost|Bonus|Activation|Target|FV|Threshold';
const STAT_LINE = new RegExp(`^(?:${STAT_LABELS}):`, 'i');

function field(block: string, label: string): string | null {
  const m = new RegExp(`\\b${label}:\\s*(.+?)(?=\\s+(?:${STAT_LABELS}):|$)`, 'i').exec(block);
  return m ? m[1]!.trim() : null;
}

/**
 * A price line the page broke mid-phrase — "COST: 3 KARMA PER" over "RATING
 * (MAX 3)", or one that stops inside its brackets — whose rest is the next
 * line. A line that reads as finished ("… per rating") is never joined: the
 * line under it is prose, and prose can say "max" too.
 */
const BROKEN_PRICE = /\bKarma\b.*(?:\bper|\([^)]*)$/i;

/** A spell, power, quality or complex form whose name is `line`, or null. */
export function parseStatBlock(line: string, following: readonly string[], category: string, printedPage: number): ParsedItem | null {
  const name = line.trim();
  if (!NAME_LINE.test(name) || name.split(' ').length > 6) return null;
  // A spell may carry its keywords first — "(INDIRECT)", "(ACTIVE, AREA)" —
  // then only the stat lines; the prose under them is the description.
  let rest = following.slice(0, 4).map((l) => l.trim());
  let keywords: string | null = null;
  if (rest[0] !== undefined && /^\([A-Z][A-Z ,'’-]*\)$/.test(rest[0])) {
    keywords = rest[0].slice(1, -1);
    rest = rest.slice(1);
  }
  const statLines: string[] = [];
  for (const l of rest.slice(0, 3)) {
    if (!STAT_LINE.test(l)) break;
    statLines.push(l);
  }
  const block = statLines.join(' ');
  const first = statLines[0] ?? '';
  const base = { category, name: titleCase(name), avail: null, cost: null, costText: null, printedPage };
  if (/^Type:/i.test(first) && /\bDrain:/i.test(block)) {
    const stats: Record<string, string> = {};
    if (keywords) stats['KEYWORDS'] = keywords;
    for (const key of ['Type', 'Range', 'Damage', 'Duration', 'Drain'] as const) {
      const v = field(block, key);
      if (v !== null) stats[key.toUpperCase()] = v.replace(/\s*[–-]\s*/, ' – ').replace(/\s*\+\s*/, ' + ');
    }
    return { ...base, kind: 'spell', stats };
  }
  if (/^Cost:\s*[\d.]+\s*PP/i.test(first)) {
    const stats: Record<string, string> = {};
    const cost = field(block, 'Cost');
    if (cost !== null) stats['COST'] = cost;
    const act = field(block, 'Activation');
    if (act !== null) stats['ACTIVATION'] = act;
    return { ...base, kind: 'power', stats };
  }
  const next = rest[statLines.length];
  const priceLine = statLines.length === 1 && next !== undefined && BROKEN_PRICE.test(first) ? `${first} ${next}` : first;
  const karma = qualityKarmaStats(priceLine);
  if (karma) return { ...base, kind: 'quality', stats: karma };
  if (/^Target:/i.test(first) && /\bFV:/i.test(block)) {
    const stats: Record<string, string> = {};
    for (const key of ['Target', 'Duration', 'FV'] as const) {
      const v = field(block, key);
      if (v !== null) stats[key.toUpperCase()] = v;
    }
    return { ...base, kind: 'complex_form', stats };
  }
  return null;
}

/**
 * A quality's price line, "Cost: …" or "Bonus: …", as stats — or null when
 * the line prints no Karma number ("Cost: Varies").
 *
 *   Cost: 12 Karma                               { KARMA: '12' }
 *   Cost: 6 Karma per rating (max rating 4)      { KARMA: '6', PER: 'rating', MAX: '4' }
 *   Cost: 2 Karma per level (max 3)              { KARMA: '2', PER: 'rating', MAX: '3' }
 *   Bonus: 4 to 25 Karma  /  4 – 25 Karma        { KARMA: '4-25' }
 *   Cost: 7 or 14 Karma                          { KARMA: '7 or 14' }
 *   BONUS: 3, 6, OR 9 KARMA                      { KARMA: '3, 6, OR 9' }
 *
 * each with `TYPE` positive for a cost and negative for a bonus, and each
 * read whatever the case it was printed in (a list keeps its printed case —
 * `qualityPrice` reads only its numbers). Before the per-rating and band
 * shapes were read, the first dropped its scaling and its maximum without a
 * word, and the second was not in the catalogue at all — a builder pricing
 * either off the catalogue priced it wrong.
 */
function qualityKarmaStats(line: string): Record<string, string> | null {
  const m = /^(Cost|Bonus):\s*(\d+(?:\s*(?:,(?:\s*or)?|or|to|–|—|-)\s*\d+)*)\s*Karma\b(.*)$/i.exec(line.trim());
  if (!m) return null;
  const type = m[1]!.toLowerCase() === 'cost' ? 'positive' : 'negative';
  const printed = m[2]!.trim();
  const rest = m[3] ?? '';
  const band = /^(\d+)\s*(?:to|–|—|-)\s*(\d+)$/i.exec(printed);
  if (band) return { KARMA: `${Number(band[1])}-${Number(band[2])}`, TYPE: type };
  if (/^\d+$/.test(printed) && /^[\s(]*per\s+(?:rating|level)\b/i.test(rest)) {
    const max = /\bmax(?:imum)?\.?\s*(?:rating|level)?\s*(?:of\s+)?(\d+)/i.exec(rest);
    return { KARMA: String(Number(printed)), PER: 'rating', ...(max ? { MAX: String(Number(max[1])) } : {}), TYPE: type };
  }
  return { KARMA: printed, TYPE: type };
}

// ---------------------------------------------------------------------------
// Reading the numbers back — what a build records from a row
// ---------------------------------------------------------------------------
//
// The reading itself is the rules engine's (`catalogueQualityPrice`,
// `catalogueWareFigures` in @safehouse/rules chargen/catalogue.ts), so the
// builder's steps in the browser and every server path price a row the same
// way. These two keep the shapes the server's callers and tests were written
// against.

/** What a catalogue quality's price line allows, read back from its stats. */
export interface QualityPrice {
  type: 'positive' | 'negative' | null;
  /**
   * The Karma at `rating` — a flat price ignores the rating. Null when the
   * table has to choose (a band, a list of prices) or a per-rating price was
   * given no rating.
   */
  karma: number | null;
  /** A price per rating, and the highest rating the book allows (null when it names none). */
  rated: { perRating: number; maxRating: number | null } | null;
  /** The bounds a band ("4-25") or a list ("7 or 14") lets the table choose within. */
  range: { min: number; max: number } | null;
}

/**
 * A quality row's Karma at a rating. A rating above the book's maximum is
 * not clamped — the validator is where a table is told its build is over.
 */
export function qualityPrice(stats: Readonly<Record<string, string>>, rating: number | null = null): QualityPrice {
  const price = catalogueQualityPrice(stats);
  const { type, karma, perRating } = price;
  if (typeof karma === 'number') {
    if (perRating) {
      return {
        type,
        karma: rating !== null && rating >= 1 ? catalogueQualityKarma(price, { rating }) : null,
        rated: { perRating: karma, maxRating: perRating.max },
        range: null,
      };
    }
    return { type, karma, rated: null, range: null };
  }
  return { type, karma: null, rated: null, range: karma };
}

/** The numbers a 'ware (or any rated gear) purchase records from a catalogue row, at standard grade. */
export interface WareFigures {
  /** Essence per unit at the rating; 0 when the row prints none or a dash; null when unreadable or it needs a rating. */
  essence: number | null;
  /** List price per unit at the rating; null when the price is a formula this cannot evaluate, or it needs a rating. */
  cost: number | null;
  /** The Availability exactly as printed — the rules engine reads it against the rating. */
  avail: string | null;
  /** The rating these figures are at: the one asked for, else the one the row's name prints ("Glass Eyes (Rating 2)"). */
  rating: number | null;
  /** The top of a printed rating range ("Muscle knot (Rating 1–4)"), when the name gives one. */
  maxRating: number | null;
  /** The row prices Essence or nuyen by rating, and no rating was given or printed. */
  needsRating: boolean;
}

/**
 * A catalogue row's Essence, price and Availability for a purchase at a
 * rating. The numbers are the standard grade's; the build applies the grade
 * (CHARGEN.md §8.3), so changing a grade never means re-reading this.
 */
export function wareFigures(
  row: Pick<ParsedItem, 'name' | 'stats' | 'avail' | 'cost' | 'costText'>,
  rating: number | null = null,
): WareFigures {
  const figures = catalogueWareFigures(row, { rating });
  return {
    essence: figures.essence,
    cost: figures.cost,
    avail: row.avail,
    rating: figures.rating,
    maxRating: figures.maxRating,
    needsRating: figures.needsRating,
  };
}

/** "MANABOLT" → "Manabolt", "ANALYZE DEVICE" → "Analyze Device". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-(/])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
    .replace(/\b(Of|The|And|Or|To|A|An|In|On|For)\b/g, (w) => w.toLowerCase())
    .replace(/^([a-z])/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// A page
// ---------------------------------------------------------------------------

export interface PageParse {
  items: ParsedItem[];
  /** Rows under a header that could not be read. */
  skipped: number;
}

/** What one page hands the next: the spell section a run of pages sits in. */
export interface PageCarry {
  spellHeading: string;
}

export function parsePageItems(text: string, printedPage: number, carry: PageCarry = { spellHeading: '' }): PageParse {
  const lines = text.split('\n');
  const items: ParsedItem[] = [];
  let skipped = 0;
  let header: TableHeader | null = null;
  let heading = '';
  let spellHeading = carry.spellHeading;
  let sinceHeader = 0;
  /** The line over the header — the name of a one-row table's only item. */
  let nameAbove: string | null = null;
  /** The last non-row line under the header — what a run of "Rating N" rows is. */
  let subheading: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const asHeader = parseHeader(line);
    if (asHeader) {
      header = asHeader.category === '' ? { ...asHeader, category: heading } : asHeader;
      nameAbove = i > 0 ? lines[i - 1]! : null;
      subheading = null;
      sinceHeader = 0;
      continue;
    }
    if (header) {
      const row = parseRow(line, header, i > 0 ? lines[i - 1]! : null, printedPage, nameAbove, subheading);
      if (row) {
        items.push(row);
        sinceHeader = 0;
        continue;
      }
      if (/\d¥\s*$/.test(line)) skipped += 1;
      else if (looksLikeName(line)) subheading = line.trim();
      // A table ends where the rows stop: two lines of anything else.
      sinceHeader += 1;
      if (sinceHeader >= 2) header = null;
    }
    if (isHeading(line)) {
      heading = line.trim();
      if (/SPELLS?$|POWERS$|QUALITIES$|FORMS$|RITUALS$/.test(heading)) {
        spellHeading = heading;
        carry.spellHeading = heading;
      }
      const block = parseStatBlock(line, lines.slice(i + 1, i + 4), spellHeading, printedPage);
      if (block) items.push(block);
    }
  }
  return { items, skipped };
}

// ---------------------------------------------------------------------------
// A book
// ---------------------------------------------------------------------------

export interface CatalogueSummary {
  bookId: string;
  items: number;
  byKind: Partial<Record<ItemKind, number>>;
  skippedRows: number;
  pagesRead: number;
}

const INSERT_CHUNK = 200;

/**
 * Read every page of a book already in `book_pages` and write its rows to
 * `book_items` — replacing whatever was there for that book, so a rerun is a
 * refresh, not a duplicate. The same row printed twice on one page (a table
 * and its index) is kept once.
 */
export async function compileCatalogue(db: Db, bookId: string): Promise<CatalogueSummary> {
  const pages = await db
    .select({ printedPage: bookPages.printedPage, text: bookPages.text })
    .from(bookPages)
    .where(eq(bookPages.bookId, bookId))
    .orderBy(asc(bookPages.printedPage));
  const seen = new Set<string>();
  const rows: Array<typeof bookItems.$inferInsert> = [];
  const byKind: Partial<Record<ItemKind, number>> = {};
  let skippedRows = 0;
  const carry: PageCarry = { spellHeading: '' };
  for (const page of pages) {
    const parsed = parsePageItems(page.text, page.printedPage, carry);
    skippedRows += parsed.skipped;
    for (const item of parsed.items) {
      const key = `${item.kind}|${item.name.toLowerCase()}|${item.printedPage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
      rows.push({
        bookId,
        printedPage: item.printedPage,
        kind: item.kind,
        category: item.category,
        name: item.name,
        stats: item.stats,
        avail: item.avail,
        cost: item.cost,
        costText: item.costText,
      });
    }
  }
  await db.delete(bookItems).where(eq(bookItems.bookId, bookId));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(bookItems).values(rows.slice(i, i + INSERT_CHUNK));
  }
  return { bookId, items: rows.length, byKind, skippedRows, pagesRead: pages.length };
}

const KIND_PLURAL: Record<ItemKind, string> = {
  weapon: 'weapons',
  ammo: 'ammunition',
  armor: 'armor',
  augmentation: 'augmentations',
  vehicle: 'vehicles',
  electronics: 'electronics',
  program: 'programs',
  gear: 'gear',
  spell: 'spells',
  power: 'powers',
  quality: 'qualities',
  complex_form: 'complex forms',
};

/** "412 items — 96 weapons, 40 armor, 84 spells" for the seeder's log line. */
export function describeSummary(s: CatalogueSummary): string {
  const parts = ITEM_KINDS.filter((k) => (s.byKind[k] ?? 0) > 0).map((k) => `${s.byKind[k]} ${KIND_PLURAL[k]}`);
  return `${s.items} item${s.items === 1 ? '' : 's'}${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}${s.skippedRows > 0 ? ` (${s.skippedRows} rows not read)` : ''}`;
}
