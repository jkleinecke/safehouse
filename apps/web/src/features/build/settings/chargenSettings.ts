/**
 * The GM's character creation settings as a form, and what a save of it sends
 * (FR3.9, docs/CHARGEN.md §3 "Sourcebook toggles, house-rule options", §8.3
 * `ChargenSettingsSchema`, §8.5 `PUT /api/campaigns/:id/chargen`).
 *
 * The settings had a member-readable route, a GM write route, a schema with
 * every default, and nothing in the browser that wrote them: a campaign ran
 * experienced on the core table with every book open until someone edited the
 * row by hand. This is the logic behind the console's "Character creation"
 * panel, kept pure so every rule below is a unit test rather than a click.
 *
 * ## A save sends what changed, and the server merges it
 *
 * The route merges a partial write onto what the campaign holds
 * (`mergeChargenSettings`), so the panel never sends the whole object back: a
 * second device that changed the books while this one changed the level
 * keeps its books. `settingsWrite(base, edited)` is the smallest write whose
 * merge onto `base` gives `edited`, and it has one subtlety. A write that
 * changes the level resets the four preset fields — Availability, device
 * rating and the two carry-overs — to the new level's numbers unless the same
 * write names them. So when the level changes, a cap is sent when it differs
 * from the new level's preset (what the server would otherwise put there),
 * not when it differs from what was saved.
 *
 * ## The four caps follow the level on screen, the way the server will
 *
 * Each cap is in one of three modes. `saved`: the GM has not touched it, so
 * it shows what the campaign holds — or, once another level is picked, that
 * level's number, because that is what a save will store. `typed`: the GM
 * set it in this edit, and it stays put whatever level is picked. `level`: the
 * GM pressed "reset to level", and it follows whichever level is picked. Going
 * back to the saved level puts untouched caps back to the saved numbers, a
 * GM's own house caps included.
 *
 * ## Also here
 *
 * The level cards' numbers (read from the rules engine's level presets, so a
 * card cannot promise what the validator does not hold a build to), the one
 * line on how the two printings of the priority table differ (read off the
 * technomancer's row, the only place they do), the book toggles (the table's
 * shared books; none ticked means all of them, which is what the catalogue
 * route does), whether AI drafts can be offered, and the builds list's hint
 * that a draft was saved under a level or table the campaign has since left.
 *
 * Our own words; numbers and page refs only (DESIGN.md §14).
 */
import {
  CHARGEN_LEVEL_PRESETS,
  PRIORITY_LEVELS,
  type BuildState,
  type CharacterBuild,
  type ChargenSettings,
  type ChargenSettingsWrite,
  type CreationLevel,
  type PriorityTable,
  type Ref,
} from '@safehouse/contracts';
import { BOOK_QUALITY_CAP, CREATION_LEVEL_PRESETS, PRIORITY_CHARTS, magicPriorityOption } from '@safehouse/rules';
import { formatNuyen } from '../lib.js';
import { LEVEL_NAMES, TABLE_NAMES } from '../steps/concept/campaign.js';

export { LEVEL_NAMES, TABLE_NAMES };

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type SettingField = keyof ChargenSettings;

/** The four fields a level presets, and a change of level resets. */
export const CAP_FIELDS = ['maxAvailability', 'maxDeviceRating', 'karmaCarry', 'nuyenCarry'] as const;
export type CapField = (typeof CAP_FIELDS)[number];

/** The on/off house rules and options. */
export const FLAG_FIELDS = [
  'allowSumToTen',
  'allowMetavariants',
  'levelQualityCaps',
  'uncouthDoublesPriorityPoints',
  'aiDrafts',
] as const;
export type FlagField = (typeof FLAG_FIELDS)[number];

/** What each setting is called on screen — exhaustive over the schema, in the order the panel lays them out. */
export const FIELD_LABELS: Readonly<Record<SettingField, string>> = {
  level: 'Creation level',
  table: 'Priority table',
  maxAvailability: 'Highest Availability',
  maxDeviceRating: 'Highest device rating',
  karmaCarry: 'Karma carried into play',
  nuyenCarry: 'Nuyen carried into play',
  books: 'Books',
  allowSumToTen: 'Sum to Ten',
  allowMetavariants: 'Metavariants',
  levelQualityCaps: 'Level quality caps',
  uncouthDoublesPriorityPoints: 'Uncouth and Uneducated points',
  aiDrafts: 'AI drafts',
};

export const SETTING_FIELDS = Object.keys(FIELD_LABELS) as readonly SettingField[];

/** A cap as the GM reads it: a plain number, Karma, or nuyen. */
export function formatCap(field: CapField, value: number): string {
  if (field === 'nuyenCarry') return formatNuyen(value);
  if (field === 'karmaCarry') return `${value} Karma`;
  return String(value);
}

/** The number a level presets for a cap (contracts' `CHARGEN_LEVEL_PRESETS`, the schema's defaults). */
export function levelDefault(level: CreationLevel, field: CapField): number {
  return CHARGEN_LEVEL_PRESETS[level][field];
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

function bookKey(code: string): string {
  return code.trim().toUpperCase();
}

/** Book codes trimmed, blanks dropped, each code once (the server compares them without case). */
export function normalizeBooks(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const code = raw.trim();
    if (!code || seen.has(bookKey(code))) continue;
    seen.add(bookKey(code));
    out.push(code);
  }
  return out;
}

/** Whether two book lists allow the same books — order and case aside. */
export function sameBooks(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(normalizeBooks(a).map(bookKey));
  const right = new Set(normalizeBooks(b).map(bookKey));
  return left.size === right.size && [...left].every((code) => right.has(code));
}

/** A book from the library, as much of it as the toggles need. */
export interface LibraryBook {
  code: string;
  title: string;
  shared?: boolean;
}

export interface BookOption {
  code: string;
  title: string;
  /**
   * `shared` — on the table's shelf; `gm-only` — in the library but not
   * shared, so a player's catalogue never includes it even when ticked;
   * `missing` — ticked once, and no book in the library has the code now.
   */
  status: 'shared' | 'gm-only' | 'missing';
  checked: boolean;
}

/**
 * The toggles: every shared book once (by code, sorted), then any ticked code
 * that is not a shared book any more — listed so the GM can see it and untick
 * it, rather than a hidden entry quietly narrowing the catalogue.
 */
export function bookOptions(library: readonly LibraryBook[], selected: readonly string[]): BookOption[] {
  const ticked = new Set(normalizeBooks(selected).map(bookKey));
  const shared = new Map<string, LibraryBook>();
  for (const book of library) {
    if (book.shared === false || !book.code.trim() || shared.has(bookKey(book.code))) continue;
    shared.set(bookKey(book.code), book);
  }
  const options: BookOption[] = [...shared.values()]
    .sort((a, b) => bookKey(a.code).localeCompare(bookKey(b.code)))
    .map((book) => ({ code: book.code.trim(), title: book.title, status: 'shared', checked: ticked.has(bookKey(book.code)) }));
  for (const code of normalizeBooks(selected)) {
    if (shared.has(bookKey(code))) continue;
    const inLibrary = library.find((b) => bookKey(b.code) === bookKey(code));
    options.push({ code, title: inLibrary?.title ?? code, status: inLibrary ? 'gm-only' : 'missing', checked: true });
  }
  return options;
}

/** The allowed list with one code ticked or unticked. */
export function toggleBook(selected: readonly string[], code: string, on: boolean): string[] {
  const rest = normalizeBooks(selected).filter((c) => bookKey(c) !== bookKey(code));
  return on ? [...rest, code.trim()] : rest;
}

/** One line on what the allowed list comes to. */
export function booksLine(options: readonly BookOption[]): string {
  const shared = options.filter((o) => o.status === 'shared');
  const ticked = options.filter((o) => o.checked);
  if (ticked.length === 0) {
    return shared.length === 0
      ? 'No books are shared with the table yet, so the builder has nothing to pick from.'
      : `Every shared book (${shared.length}) — nothing is ticked, so nothing is left out.`;
  }
  const tickedShared = ticked.filter((o) => o.status === 'shared').length;
  const others = ticked.length - tickedShared;
  const base = `${tickedShared} of ${shared.length} shared ${shared.length === 1 ? 'book' : 'books'}`;
  return others > 0 ? `${base}, and ${others} the players cannot open` : base;
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/**
 * The smallest write that, merged onto `base` by the server
 * (`mergeChargenSettings`), gives `edited`. Unchanged fields are left out;
 * after a change of level a cap is sent only when it differs from the new
 * level's preset, which is what the server stores for a cap the write omits.
 */
export function settingsWrite(base: ChargenSettings, edited: ChargenSettings): ChargenSettingsWrite {
  const write: ChargenSettingsWrite = {};
  const levelChanged = edited.level !== base.level;
  if (levelChanged) write.level = edited.level;
  if (edited.table !== base.table) write.table = edited.table;
  for (const field of CAP_FIELDS) {
    const omitted = levelChanged ? levelDefault(edited.level, field) : base[field];
    if (edited[field] !== omitted) write[field] = edited[field];
  }
  if (!sameBooks(base.books, edited.books)) write.books = normalizeBooks(edited.books);
  for (const flag of FLAG_FIELDS) {
    if (edited[flag] !== base[flag]) write[flag] = edited[flag];
  }
  return write;
}

/** The settings whose value on screen differs from what the campaign holds — what the GM would call their changes. */
export function changedFields(base: ChargenSettings, edited: ChargenSettings): SettingField[] {
  return SETTING_FIELDS.filter((field) =>
    field === 'books' ? !sameBooks(base.books, edited.books) : base[field] !== edited[field],
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/** How a cap on screen behaves when the level changes (see the file header). */
export type CapMode = 'saved' | 'typed' | 'level';

export interface ChargenForm {
  /** The settings as the form stands; a cap whose text does not parse keeps its last good number. */
  values: ChargenSettings;
  /** The four caps as typed. */
  capText: Readonly<Record<CapField, string>>;
  capMode: Readonly<Record<CapField, CapMode>>;
}

function capRecord<T>(make: (field: CapField) => T): Record<CapField, T> {
  return Object.fromEntries(CAP_FIELDS.map((field) => [field, make(field)])) as Record<CapField, T>;
}

/** A form holding the campaign's settings, nothing touched. */
export function formOf(settings: ChargenSettings): ChargenForm {
  return {
    values: { ...settings, books: [...settings.books] },
    capText: capRecord((field) => String(settings[field])),
    capMode: capRecord(() => 'saved'),
  };
}

/** The largest number a cap field takes — far past any rule, short of what a typo in nuyen reaches. */
export const CAP_INPUT_MAX = 999_999_999;

/** A cap as typed: a whole number from 0, or null. */
export function parseCap(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n <= CAP_INPUT_MAX ? n : null;
}

/** Why a cap's text will not save, or null when it will. */
export function capError(text: string): string | null {
  if (text.trim() === '') return 'Enter a number, or reset it to the level.';
  return parseCap(text) === null ? 'A whole number, 0 or more.' : null;
}

/** The form at another level: untouched and reset caps take the number a save would store; typed ones stay. */
export function withLevel(form: ChargenForm, level: CreationLevel, base: ChargenSettings): ChargenForm {
  const values: ChargenSettings = { ...form.values, level };
  const capText = { ...form.capText };
  for (const field of CAP_FIELDS) {
    const mode = form.capMode[field];
    if (mode === 'typed') continue;
    const follows = mode === 'saved' && level === base.level ? base[field] : levelDefault(level, field);
    values[field] = follows;
    capText[field] = String(follows);
  }
  return { ...form, values, capText };
}

/** The form with a cap typed: it stays put through level changes from now on. */
export function withCapText(form: ChargenForm, field: CapField, text: string): ChargenForm {
  const parsed = parseCap(text);
  return {
    values: parsed === null ? form.values : { ...form.values, [field]: parsed },
    capText: { ...form.capText, [field]: text },
    capMode: { ...form.capMode, [field]: 'typed' },
  };
}

/** "Reset to level": the cap takes the level's number and follows the level from now on. */
export function resetCap(form: ChargenForm, field: CapField): ChargenForm {
  const value = levelDefault(form.values.level, field);
  return {
    values: { ...form.values, [field]: value },
    capText: { ...form.capText, [field]: String(value) },
    capMode: { ...form.capMode, [field]: 'level' },
  };
}

/** Whether a cap already shows its level's number (the reset has nothing to do). */
export function capAtLevel(form: ChargenForm, field: CapField): boolean {
  return parseCap(form.capText[field]) === levelDefault(form.values.level, field);
}

/** The form with the table, a flag or the books changed. */
export function withValues(
  form: ChargenForm,
  patch: Partial<Pick<ChargenSettings, 'table' | 'books' | FlagField>>,
): ChargenForm {
  return { ...form, values: { ...form.values, ...patch } };
}

export interface FormOutcome {
  /** What a save sends; empty when nothing changed. */
  write: ChargenSettingsWrite;
  /** What the GM changed, by field. */
  changed: SettingField[];
  /** Caps whose text will not save. */
  invalid: CapField[];
  /** Whether the save button has anything to do. */
  canSave: boolean;
}

export function formOutcome(base: ChargenSettings, form: ChargenForm): FormOutcome {
  const invalid = CAP_FIELDS.filter((field) => capError(form.capText[field]) !== null);
  const write = settingsWrite(base, form.values);
  const changed = changedFields(base, form.values);
  return { write, changed, invalid, canSave: invalid.length === 0 && Object.keys(write).length > 0 };
}

/** The status line beside the save button. */
export function saveLine(outcome: FormOutcome): string {
  if (outcome.invalid.length > 0) {
    return `${outcome.invalid.map((f) => FIELD_LABELS[f]).join(', ')}: fix the number before saving.`;
  }
  const n = outcome.changed.length;
  if (n === 0) return 'No unsaved changes.';
  return `${n} unsaved ${n === 1 ? 'change' : 'changes'}: ${outcome.changed.map((f) => FIELD_LABELS[f]).join(', ')}.`;
}

/**
 * What a change of level does to the caps, said before the save: which follow
 * the new level (with its numbers) and which stay as the GM set them. Null
 * when the level is the saved one.
 */
export function levelChangeNote(base: ChargenSettings, form: ChargenForm): string | null {
  const level = form.values.level;
  if (level === base.level) return null;
  const following = CAP_FIELDS.filter((field) => form.capMode[field] !== 'typed');
  const kept = CAP_FIELDS.filter((field) => form.capMode[field] === 'typed');
  const name = LEVEL_NAMES[level];
  const parts: string[] = [];
  if (following.length > 0) {
    const list = following.map((f) => `${FIELD_LABELS[f]} ${formatCap(f, levelDefault(level, f))}`).join(', ');
    parts.push(`Saving at ${name} moves these to its numbers: ${list}.`);
  }
  if (kept.length > 0) {
    const list = kept.map((f) => `${FIELD_LABELS[f]} ${form.capText[f].trim() || '(blank)'}`).join(', ');
    parts.push(`You set ${kept.length === 1 ? 'this one' : 'these'} yourself, so ${kept.length === 1 ? 'it stays' : 'they stay'}: ${list}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// What the level and the table mean
// ---------------------------------------------------------------------------

export interface LevelFigure {
  key: string;
  label: string;
  value: string;
}

/**
 * A level's own numbers, from the engine's presets: starting Karma, the
 * quality cap (the level's reading when `levelQualityCaps` is on, the book's
 * flat 25 when off), the Availability and device caps it presets, the most
 * Karma that may become nuyen, and the contact multiplier.
 */
export function levelFigures(level: CreationLevel, levelQualityCaps: boolean): LevelFigure[] {
  const p = CREATION_LEVEL_PRESETS[level];
  const qualityCap = levelQualityCaps ? p.qualityCap : BOOK_QUALITY_CAP;
  return [
    { key: 'karma', label: 'Starting Karma', value: String(p.karma) },
    { key: 'qualities', label: 'Quality Karma', value: `${qualityCap} each way` },
    { key: 'availability', label: 'Availability', value: `up to ${p.maxAvailability}` },
    { key: 'device', label: 'Device rating', value: `up to ${p.maxDeviceRating}` },
    { key: 'toNuyen', label: 'Karma to nuyen', value: `up to ${p.karmaToNuyenMax}` },
    { key: 'contacts', label: 'Contact Karma', value: `Charisma × ${p.contactKarmaPerCharisma}` },
  ];
}

/** The page a level is set out on. */
export function levelRef(level: CreationLevel): Ref {
  return CREATION_LEVEL_PRESETS[level].ref;
}

/** The technomancer's row in one printing, the one row where the two differ: "A 3 skills at 5, 7 forms; …". */
export function tableLine(table: PriorityTable): string {
  const cells: string[] = [];
  for (const level of PRIORITY_LEVELS) {
    const option = magicPriorityOption(table, level, 'technomancer');
    if (!option) continue;
    const skills = option.skills
      ? `${option.skills.count} ${option.skills.count === 1 ? 'skill' : 'skills'} at ${option.skills.rating}`
      : 'no skills';
    cells.push(`${level} ${skills}, ${option.forms} ${option.forms === 1 ? 'form' : 'forms'}`);
  }
  return `Technomancer: ${cells.join('; ')}`;
}

/** The page a printing of the table is on. */
export function tableRef(table: PriorityTable): Ref {
  return PRIORITY_CHARTS[table].A.ref;
}

// ---------------------------------------------------------------------------
// AI drafts
// ---------------------------------------------------------------------------

/** Whether the campaign has an AI to draft with: on, off, still being read, or unreadable. */
export type AiAvailability = 'on' | 'off' | 'checking' | 'unknown';

/**
 * Read from the GM's AI settings. `ready` is the server's own answer — a
 * chosen provider with what it needs, or the environment's fallback — so it
 * is the whole test.
 */
export function aiAvailability(ai: { ready: boolean } | undefined, loading: boolean, error: unknown): AiAvailability {
  if (ai) return ai.ready ? 'on' : 'off';
  if (loading) return 'checking';
  return error ? 'unknown' : 'checking';
}

/**
 * Whether the AI drafts box can be ticked. Not while AI is off or still being
 * read — but a box already on can always be turned off, or a GM who switched
 * AI off afterwards would be left with a setting they cannot clear.
 */
export function aiDraftsEnabled(ai: AiAvailability, current: boolean): boolean {
  return current || ai === 'on' || ai === 'unknown';
}

// ---------------------------------------------------------------------------
// The builds list's hint
// ---------------------------------------------------------------------------

/**
 * The hint on a builds list row when the build was last saved at another
 * level or on another table than the campaign's now — null when it matches,
 * or when the build is approved (history; its settings no longer matter).
 *
 * The server stamps the campaign's level and table on a build whenever it is
 * saved, so a mismatch means the settings changed after that save. The caps,
 * books and toggles are not recorded on a build and cannot be compared; the
 * walkthrough checks those against the campaign's settings when it opens.
 */
export function settingsDrift(
  build: Pick<CharacterBuild, 'level' | 'table'>,
  state: BuildState,
  settings: Pick<ChargenSettings, 'level' | 'table'> | undefined,
): string | null {
  if (!settings || state === 'approved') return null;
  const parts: string[] = [];
  if (build.level !== settings.level) {
    parts.push(`saved at ${LEVEL_NAMES[build.level]}, the campaign now runs ${LEVEL_NAMES[settings.level]}`);
  }
  if (build.table !== settings.table) {
    parts.push(`saved on the ${TABLE_NAMES[build.table]}, the campaign now uses the ${TABLE_NAMES[settings.table]}`);
  }
  if (parts.length === 0) return null;
  return `Settings changed since this build was saved: ${parts.join('; ')}. It is checked against the new settings when opened.`;
}
