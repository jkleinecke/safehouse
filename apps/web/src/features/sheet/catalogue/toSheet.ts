/**
 * A catalogue row becomes a sheet item — the numbers the book printed, in
 * the fields the sheet already has, with the page it came from as the ref.
 *
 * The catalogue (`GET /api/catalogue/search`) is what the seeder read out of
 * the GM's own books: a row's stats are the table's own columns as printed
 * (`{ ACC: "5 (7)", DAMAGE: "8P", … }`). The sheet wants typed fields —
 * `acc: 5`, `dv: "8P"`, `ap: -1`, `modes: ["SA"]` — so this is where "5 (7)"
 * becomes 5 and "SA / BF" becomes two modes. Anything the sheet has no field
 * for rides along in `note`, and the ref makes the printed page one tap away.
 *
 * Acquiring is the table's business: the GM and the player work out how the
 * runner came by it; this only keeps the inventory and the stats.
 */
import type { SheetV1 } from '@safehouse/contracts';

export interface CatalogueHit {
  id: string;
  bookId: string;
  bookCode: string;
  printedPage: number;
  kind: string;
  category: string;
  name: string;
  stats: Record<string, string>;
  avail: string | null;
  cost: number | null;
  costText: string | null;
  title: string;
  pdfPage: number;
  ref: { book: string; page: number };
  readUrl: string;
}

export type SheetList = 'gear' | 'weapons' | 'armor' | 'augments' | 'spells' | 'powers' | 'complexForms' | 'qualities';

/** Which list of the sheet a row of this kind lives on. */
export function listFor(kind: string): SheetList {
  switch (kind) {
    case 'weapon':
      return 'weapons';
    case 'armor':
      return 'armor';
    case 'augmentation':
      return 'augments';
    case 'spell':
      return 'spells';
    case 'power':
      return 'powers';
    case 'complex_form':
      return 'complexForms';
    case 'quality':
      return 'qualities';
    default:
      return 'gear';
  }
}

const firstInt = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const m = /-?\d+/.exec(s.replace(/[–−]/g, '-'));
  return m ? Number(m[0]) : undefined;
};
const firstNumber = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const m = /-?\d+(?:\.\d+)?/.exec(s.replace(/[–−]/g, '-'));
  return m ? Number(m[0]) : undefined;
};

/** "ACC 5 (7) · DAMAGE 8P · … · avail 5R · 725¥" — the row on one line. */
/** The order the books print columns in; JSONB hands keys back alphabetised. */
const STAT_ORDER = ['ACC', 'ACCURACY', 'REACH', 'DAMAGE', 'DV', 'DAM', 'AP', 'MODE', 'RC', 'AMMO', 'ARMOR RATING', 'ARMOR', 'RATING', 'DEVICE RATING', 'ESSENCE', 'CAPACITY', 'HANDL', 'HANDL*', 'SPEED', 'SPEED*', 'ACCEL', 'BODY', 'BOD', 'ARM', 'PILOT', 'SENS', 'SENSOR', 'SEATS', 'KEYWORDS', 'TYPE', 'RANGE', 'DURATION', 'DRAIN', 'COST', 'ACTIVATION', 'TARGET', 'FV', 'KARMA'];
const statRank = (k: string): number => {
  const i = STAT_ORDER.indexOf(k);
  return i === -1 ? STAT_ORDER.length : i;
};

export function statsLine(hit: Pick<CatalogueHit, 'stats' | 'avail' | 'cost' | 'costText'>): string {
  const parts = Object.entries(hit.stats)
    .filter(([, v]) => v !== '' && v !== '—')
    .sort((a, b) => statRank(a[0]) - statRank(b[0]))
    .map(([k, v]) => `${k.toLowerCase()} ${v}`);
  if (hit.avail && hit.avail !== '—') parts.push(`avail ${hit.avail}`);
  if (hit.cost !== null) parts.push(`${hit.cost.toLocaleString('en-US')}¥`);
  else if (hit.costText) parts.push(hit.costText);
  return parts.join(' · ');
}

/** The skill a weapon in this table uses, from the table's own heading. */
export function skillFor(category: string, stats: Record<string, string>): string {
  const c = category.toLowerCase();
  if (/hold-?out|pistol|taser|revolver/.test(c) && !/machine pistol/.test(c)) return 'pistols';
  if (/submachine|machine pistol|assault rifle|carbine|smg/.test(c)) return 'automatics';
  if (/shotgun|sniper|sporting|rifle|longarm/.test(c)) return 'longarms';
  if (/machine gun|launcher|cannon|mortar|heavy|rocket|missile/.test(c)) return 'heavy-weapons';
  if (/blade|sword|knife|knives|axe|katana/.test(c)) return 'blades';
  if (/club|staff|hammer|baton|stun|mace/.test(c)) return 'clubs';
  if (/bow|archery/.test(c)) return 'archery';
  if (/throw|grenade/.test(c)) return 'throwing-weapons';
  if (/unarmed|cyber-?implant|implant/.test(c)) return 'unarmed-combat';
  const ranged = 'MODE' in stats || 'AMMO' in stats;
  return ranged ? 'exotic-ranged' : 'exotic-melee';
}

/** The range table a weapon in this table reads — the sheet's own keys where they exist. */
export function rangeCatFor(category: string, stats: Record<string, string>): string | undefined {
  const c = category.toLowerCase();
  if (!('MODE' in stats || 'AMMO' in stats)) return undefined; // melee
  if (/hold-?out/.test(c)) return 'holdout';
  if (/light pistol/.test(c)) return 'light_pistol';
  if (/heavy pistol|revolver/.test(c)) return 'heavy_pistol';
  if (/machine pistol/.test(c)) return 'machine_pistol';
  if (/submachine|smg/.test(c)) return 'smg';
  if (/shotgun/.test(c)) return 'shotgun';
  if (/taser/.test(c)) return 'taser';
  if (/sniper/.test(c)) return 'marksman';
  if (/assault rifle|carbine|rifle/.test(c)) return 'carbine';
  if (/throw|grenade/.test(c)) return 'thrown';
  const key = c.replace(/s$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return key.length > 0 ? key : undefined;
}

export type SheetItemOf<L extends SheetList> = SheetV1[L][number];

/** The sheet item a catalogue row becomes, and which list it belongs on. */
export function toSheetItem(hit: CatalogueHit): { list: SheetList; item: SheetItemOf<SheetList> } {
  // A row from the books carries its page; a hand-written item may carry none.
  const ref = hit.bookCode && hit.printedPage > 0 ? { book: hit.bookCode, page: hit.printedPage } : undefined;
  const s = hit.stats;
  const line = statsLine(hit);
  const priced = [hit.avail && hit.avail !== '—' ? `avail ${hit.avail}` : '', hit.cost !== null ? `${hit.cost.toLocaleString('en-US')}¥` : hit.costText ?? '']
    .filter(Boolean)
    .join(' · ');
  const note = (text: string) => (text.length > 0 ? { note: text } : {});
  switch (hit.kind) {
    case 'weapon': {
      const dv = s['DAMAGE'] ?? s['DV'] ?? s['DAM'];
      const modes = (s['MODE'] ?? '')
        .split('/')
        .map((m) => m.trim().replace(/\*+$/, ''))
        .filter((m) => m.length > 0 && m !== '—');
      const cap = firstInt(s['AMMO']);
      const acc = firstInt(s['ACC'] ?? s['ACCURACY']);
      const rc = firstInt(s['RC']);
      const rangeCat = rangeCatFor(hit.category, s);
      const item: SheetItemOf<'weapons'> = {
        name: hit.name,
        skillId: skillFor(hit.category, s),
        ap: firstInt(s['AP']) ?? 0,
        modes,
        ...(ref ? { ref } : {}),
        ...(acc !== undefined ? { acc } : {}),
        ...(dv ? { dv: dv.replace(/\s+/g, '') } : {}),
        ...(rangeCat ? { rangeCat } : {}),
        ...(cap !== undefined ? { ammo: { cap, current: cap } } : {}),
        ...(rc !== undefined && rc > 0 ? { recoilComp: rc } : {}),
        ...note([hit.category.toLowerCase(), s['REACH'] ? `reach ${s['REACH']}` : '', priced].filter(Boolean).join(' · ')),
      };
      return { list: 'weapons', item };
    }
    case 'armor': {
      const rating = firstInt(s['ARMOR RATING'] ?? s['ARMOR'] ?? s['RATING']) ?? 0;
      const item: SheetItemOf<'armor'> = { name: hit.name, rating, worn: false, ...(ref ? { ref } : {}), ...note([s['CAPACITY'] ? `capacity ${s['CAPACITY']}` : '', priced].filter(Boolean).join(' · ')) };
      return { list: 'armor', item };
    }
    case 'augmentation': {
      const essence = firstNumber(s['ESSENCE']);
      const item: SheetItemOf<'augments'> = {
        name: hit.name,
        essence: essence !== undefined && Number.isFinite(essence) ? Math.abs(essence) : 0,
        mods: [],
        ...(ref ? { ref } : {}),
        ...note([essence === undefined && s['ESSENCE'] ? `essence ${s['ESSENCE']}` : '', s['CAPACITY'] ? `capacity ${s['CAPACITY']}` : '', s['RATING'] ? `rating ${s['RATING']}` : '', priced].filter(Boolean).join(' · ')),
      };
      return { list: 'augments', item };
    }
    case 'spell': {
      const drain = (s['DRAIN'] ?? '').replace(/\s+/g, '').replace(/–/g, '-');
      const category = hit.category.replace(/\s*SPELLS?$/i, '').toLowerCase();
      const item: SheetItemOf<'spells'> = {
        name: hit.name,
        ...(ref ? { ref } : {}),
        ...(category ? { category } : {}),
        ...(drain ? { drain } : {}),
        ...note(['TYPE', 'RANGE', 'DAMAGE', 'DURATION'].filter((k) => s[k]).map((k) => `${k.toLowerCase()} ${s[k]}`).join(' · ')),
      };
      return { list: 'spells', item };
    }
    case 'power': {
      const cost = firstNumber(s['COST']);
      const item: SheetItemOf<'powers'> = {
        name: hit.name,
        mods: [],
        ...(ref ? { ref } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...note([s['COST'] ?? '', s['ACTIVATION'] ? `activation ${s['ACTIVATION']}` : ''].filter(Boolean).join(' · ')),
      };
      return { list: 'powers', item };
    }
    case 'complex_form': {
      const item: SheetItemOf<'complexForms'> = {
        name: hit.name,
        ...(ref ? { ref } : {}),
        ...(s['TARGET'] ? { target: s['TARGET'] } : {}),
        ...(s['FV'] ? { fading: s['FV'].replace(/\s+/g, '') } : {}),
        ...note(s['DURATION'] ? `duration ${s['DURATION']}` : ''),
      };
      return { list: 'complexForms', item };
    }
    case 'quality': {
      const item: SheetItemOf<'qualities'> = {
        name: hit.name,
        mods: [],
        ...(ref ? { ref } : {}),
        ...note([s['KARMA'] ? `${s['KARMA']} karma` : '', s['TYPE'] ?? ''].filter(Boolean).join(' · ')),
      };
      return { list: 'qualities', item };
    }
    default: {
      const rating = /^\d+$/.test(s['RATING'] ?? '') ? Number(s['RATING']) : undefined;
      const item: SheetItemOf<'gear'> = {
        name: hit.name,
        qty: 1,
        ...(ref ? { ref } : {}),
        ...(rating !== undefined ? { rating } : {}),
        ...note([hit.category.toLowerCase(), line].filter(Boolean).join(' · ')),
      };
      return { list: 'gear', item };
    }
  }
}

/**
 * The sheet with the row added. A second copy of a piece of gear is one more
 * of it; a second copy of anything else is nothing (the sheet keys its lists
 * by name), and `added` says so.
 */
export function withCatalogueItem(sheet: SheetV1, hit: CatalogueHit): { sheet: SheetV1; added: boolean; list: SheetList } {
  const { list, item } = toSheetItem(hit);
  const existing = (sheet[list] as Array<{ name: string }>).find((x) => x.name === item.name);
  if (existing) {
    if (list === 'gear') {
      return { sheet: { ...sheet, gear: sheet.gear.map((g) => (g.name === item.name ? { ...g, qty: g.qty + 1 } : g)) }, added: true, list };
    }
    return { sheet, added: false, list };
  }
  return { sheet: { ...sheet, [list]: [...(sheet[list] as unknown[]), item] } as SheetV1, added: true, list };
}

/** The sheet without the named item of a list — one click, one revision, undone from History. */
export function withoutItem(sheet: SheetV1, list: SheetList, name: string): SheetV1 {
  return { ...sheet, [list]: (sheet[list] as Array<{ name: string }>).filter((x) => x.name !== name) } as SheetV1;
}

// ---------------------------------------------------------------------------
// Your own item — not in any table, or not in any book
// ---------------------------------------------------------------------------

export interface CustomItemInput {
  kind: string;
  name: string;
  /** The table it would sit in ("heavy pistols") — drives a weapon's skill and range. */
  category?: string;
  /** The same keys a book row carries: ACC, DAMAGE, AP, MODE, RC, AMMO, ARMOR RATING, ESSENCE, DRAIN, COST… */
  stats: Record<string, string>;
  avail?: string;
  cost?: number | null;
  /** The page it came from, when there is one. */
  ref?: { book: string; page: number } | null;
}

/**
 * A hand-written item shaped like a catalogue row, so it lands on the sheet
 * through the same mapping a row from the books does (§14: the player's own
 * words, with a page only if they give one).
 */
export function customHit(input: CustomItemInput): CatalogueHit {
  const stats: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.stats)) {
    const t = v.trim();
    if (t.length > 0) stats[k] = t;
  }
  const ref = input.ref && input.ref.book.trim().length > 0 && input.ref.page >= 1 ? { book: input.ref.book.trim().toUpperCase(), page: Math.round(input.ref.page) } : null;
  return {
    id: 'custom',
    bookId: '',
    bookCode: ref?.book ?? '',
    printedPage: ref?.page ?? 0,
    kind: input.kind,
    category: (input.category ?? '').trim().toUpperCase(),
    name: input.name.trim(),
    stats,
    avail: input.avail?.trim() || null,
    cost: input.cost !== undefined && input.cost !== null && Number.isFinite(input.cost) && input.cost > 0 ? Math.round(input.cost) : null,
    costText: null,
    title: ref?.book ?? '',
    pdfPage: 0,
    ref: ref ?? { book: '', page: 0 },
    readUrl: '',
  };
}
