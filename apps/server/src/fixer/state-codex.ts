/**
 * The rest of the FR12.17 read surface: codex, contacts, runs, the in-game
 * calendar, and the magic / matrix snapshots.
 *
 * Same contract as `state.ts` — never raw rows, always the engine-derived view
 * the table is playing with, queried live at call time, and never a write.
 * Where a module is genuinely not built yet (spirit services FR8.3, Overwatch
 * FR7.4) these readers say so in a `tracked: false` field instead of inventing
 * numbers: the model must be able to tell "zero" from "we don't track that".
 *
 * The magic / Matrix snapshots live next door in `state-play.ts`.
 *
 * These readers query the tables directly rather than going through the codex
 * HTTP services next door. That is safe precisely because every one of them is
 * a GM-only read: the Fixer panel is GM-only (§13) and its tool catalog never
 * writes, so there is no viewer to filter for here — the filtering that
 * matters happens in `services/codex.ts` on the way to a player. The shapes
 * below are the tool contract and should stay put even if the plumbing moves.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { SheetV1Schema } from '@safehouse/contracts';
import {
  books,
  bookPages,
  campaigns,
  characters,
  contacts,
  gameSessions,
  ledgerEntries,
  runs,
  searchCodex,
  wikiPages,
  type Db,
} from '@safehouse/db';
import { httpError } from '../services/auth.js';
import { printedToPdfPage } from '../services/books.js';
// The contacts plugin owns the favours convention and exports the splitter.
import { readNotes } from '../plugins/contacts.js';
import type { TimelineEvent } from '../plugins/codex-calendar.js';

// ---------------------------------------------------------------------------
// Codex (FR12.3/FR12.17 `search_codex`)
// ---------------------------------------------------------------------------

export interface CodexSearchState {
  query: string;
  hits: Array<{
    pageId: string;
    title: string;
    kind: string;
    visibility: string;
    /** True when this page is GM-only — do not read it aloud verbatim. */
    gmOnly: boolean;
    tags: string[];
    snippet: string;
    rank: number;
  }>;
}

/**
 * Ranked FTS over the campaign codex. This is the GM's own surface, so GM-only
 * pages are included — each hit is stamped `gmOnly` so the model knows which
 * ones must not be quoted to players (Principle 4 applied to prose, FR12.19).
 */
export async function searchCodexState(
  db: Db,
  campaignId: string,
  query: string,
  opts: { limit?: number; kind?: string } = {},
): Promise<CodexSearchState> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const hits = await searchCodex(db, query, { campaignId, limit: limit * 2 });
  if (hits.length === 0) return { query, hits: [] };
  const rows = await db
    .select()
    .from(wikiPages)
    .where(inArray(wikiPages.id, hits.map((h) => h.pageId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: CodexSearchState['hits'] = [];
  for (const hit of hits) {
    const page = byId.get(hit.pageId);
    if (!page) continue;
    if (opts.kind !== undefined && page.kind !== opts.kind) continue;
    out.push({
      pageId: page.id,
      title: page.title,
      kind: page.kind,
      visibility: page.visibility,
      gmOnly: page.visibility !== 'public',
      tags: page.tags,
      snippet: hit.snippet,
      rank: Number(hit.rank.toFixed(4)),
    });
    if (out.length >= limit) break;
  }
  return { query, hits: out };
}

// ---------------------------------------------------------------------------
// Book pages (FR12.17 `get_page`)
// ---------------------------------------------------------------------------

export interface BookPageState {
  ref: { book: string; page: number };
  bookId: string;
  title: string;
  /** printed page + offset; what the in-app reader actually opens (FR11.1). */
  pdfPage: number;
  readUrl: string;
  text: string;
}

/**
 * The full extracted text of one printed page, addressed the way a ref chip is
 * (`{ book, page }`). The citation is ours: the returned `ref` is the page the
 * text physically came from, never something the model remembered.
 */
export async function getBookPageState(
  db: Db,
  bookCode: string,
  printedPage: number,
): Promise<BookPageState> {
  if (!Number.isInteger(printedPage) || printedPage < 1) {
    throw httpError(400, 'bad_request', 'page must be a positive printed page number');
  }
  const book = (
    await db.select().from(books).where(eq(books.code, bookCode.toUpperCase())).limit(1)
  )[0];
  if (!book) throw httpError(404, 'not_found', `no book registered with code "${bookCode}"`);
  const page = (
    await db
      .select({ text: bookPages.text })
      .from(bookPages)
      .where(and(eq(bookPages.bookId, book.id), eq(bookPages.printedPage, printedPage)))
      .limit(1)
  )[0];
  if (!page) {
    throw httpError(404, 'not_found', `${book.code} p.${printedPage} has not been extracted`);
  }
  return {
    ref: { book: book.code, page: printedPage },
    bookId: book.id,
    title: book.title,
    pdfPage: printedToPdfPage(printedPage, book.pageOffset),
    readUrl: `/read/${encodeURIComponent(book.code)}?p=${printedPage}`,
    text: page.text,
  };
}

// ---------------------------------------------------------------------------
// Contacts (FR5.8 / FR12.17 `list_contacts`)
// ---------------------------------------------------------------------------

const FAVOR_OWED = /favou?rs?\s+owed\s*[:=]\s*(\d{1,3})/i;
const FAVOR_OWING = /favou?rs?\s+owing\s*[:=]\s*(\d{1,3})/i;

export interface Favors {
  /** Favours the contact owes the character. */
  owed: number;
  /** Favours the character owes the contact. */
  owing: number;
  /** Where the numbers came from — a model should not treat a guess as a fact. */
  source: 'structured' | 'note' | 'none';
}

/**
 * Favours have no column of their own: the contacts service keeps them in a
 * JSON envelope inside `contacts.notes` and exposes {@link readNotes} to split
 * it back out. That is the authority. As a courtesy we also read the plain
 * phrasing a GM might have typed before the field existed ("favors owed: 2"),
 * and say which of the two it was — a model that can tell a parsed number from
 * a guessed one can hedge, and one that cannot will state the guess as fact.
 * Should favours ever get a column, read it here and drop the prose fallback;
 * the `Favors` shape is the tool contract and should not move.
 */
export function readContactFavors(rawNotes: string): { notes: string; favors: Favors } {
  const { notes, favours } = readNotes(rawNotes);
  if (favours.owed !== 0 || favours.owing !== 0) {
    return { notes, favors: { ...favours, source: 'structured' } };
  }
  const owed = FAVOR_OWED.exec(notes);
  const owing = FAVOR_OWING.exec(notes);
  if (owed || owing) {
    return {
      notes,
      favors: {
        owed: owed ? Number(owed[1]) : 0,
        owing: owing ? Number(owing[1]) : 0,
        source: 'note',
      },
    };
  }
  return { notes, favors: { owed: 0, owing: 0, source: 'none' } };
}

export interface ContactsState {
  characters: Array<{
    characterId: string;
    name: string;
    contacts: Array<{
      id: string;
      name: string;
      archetype: string;
      connection: number;
      loyalty: number;
      /** Connection + Loyalty — the usual "how much pull is this?" number. */
      rating: number;
      notes: string;
      favors: Favors;
      npcPageId: string | null;
      npcPageTitle: string | null;
    }>;
  }>;
  note: string;
}

export async function listContactsState(
  db: Db,
  campaignId: string,
  opts: { characterId?: string } = {},
): Promise<ContactsState> {
  const roster = await db.select().from(characters).where(eq(characters.campaignId, campaignId));
  const wanted = opts.characterId ? roster.filter((r) => r.id === opts.characterId) : roster;
  if (opts.characterId && wanted.length === 0) {
    throw httpError(404, 'not_found', 'unknown character');
  }
  const ids = wanted.map((r) => r.id);
  const rows =
    ids.length === 0
      ? []
      : await db.select().from(contacts).where(inArray(contacts.characterId, ids));
  const pageIds = rows.map((r) => r.npcPageId).filter((id): id is string => id !== null);
  const pages =
    pageIds.length === 0
      ? []
      : await db
          .select({ id: wikiPages.id, title: wikiPages.title })
          .from(wikiPages)
          .where(inArray(wikiPages.id, pageIds));
  const titleById = new Map(pages.map((p) => [p.id, p.title]));
  return {
    characters: wanted.map((character) => ({
      characterId: character.id,
      name: character.name,
      contacts: rows
        .filter((c) => c.characterId === character.id)
        .sort((a, b) => b.connection - a.connection || a.name.localeCompare(b.name))
        .map((c) => {
          const { notes, favors } = readContactFavors(c.notes);
          return {
          id: c.id,
          name: c.name,
          archetype: c.archetype,
          connection: c.connection,
          loyalty: c.loyalty,
          rating: c.connection + c.loyalty,
          notes,
          favors,
          npcPageId: c.npcPageId,
          npcPageTitle: c.npcPageId ? (titleById.get(c.npcPageId) ?? null) : null,
          };
        }),
    })),
    note: 'favors.source says where the numbers came from: "structured" is the tracked field, "note" is prose the GM typed, "none" means nobody wrote any down.',
  };
}

// ---------------------------------------------------------------------------
// Runs (FR5.5 / FR12.17 `list_runs` + `get_run`)
// ---------------------------------------------------------------------------

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export interface RunSummary {
  id: string;
  title: string;
  state: string;
  johnsonPageId: string | null;
  johnson: string | null;
  payout: Record<string, unknown>;
  awards: Record<string, unknown>;
  hasRecap: boolean;
}

export async function listRunsState(
  db: Db,
  campaignId: string,
  opts: { state?: string } = {},
): Promise<{ runs: RunSummary[] }> {
  const rows = await db.select().from(runs).where(eq(runs.campaignId, campaignId));
  const filtered = opts.state ? rows.filter((r) => r.state === opts.state) : rows;
  const johnsonIds = filtered.map((r) => r.johnsonPageId).filter((id): id is string => id !== null);
  const pages =
    johnsonIds.length === 0
      ? []
      : await db
          .select({ id: wikiPages.id, title: wikiPages.title })
          .from(wikiPages)
          .where(inArray(wikiPages.id, johnsonIds));
  const titleById = new Map(pages.map((p) => [p.id, p.title]));
  return {
    runs: filtered
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((row) => ({
        id: row.id,
        title: row.title,
        state: row.state,
        johnsonPageId: row.johnsonPageId,
        johnson: row.johnsonPageId ? (titleById.get(row.johnsonPageId) ?? null) : null,
        payout: asRecord(row.payout),
        awards: asRecord(row.awards),
        hasRecap: row.recapMd.trim().length > 0,
      })),
  };
}

export interface RunState extends RunSummary {
  recapMd: string;
  /** Objectives / opposition links as the codex stored them, if any. */
  objectives: unknown[];
  opposition: unknown[];
  /** Ledger rows already booked against this run (FR3.6 → FR5.5). */
  ledger: Array<{
    characterId: string;
    characterName: string;
    currency: 'karma' | 'nuyen';
    delta: number;
    reason: string;
    state: string;
  }>;
}

export async function getRunState(db: Db, campaignId: string, runId: string): Promise<RunState> {
  const row = (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
  if (!row || row.campaignId !== campaignId) throw httpError(404, 'not_found', 'unknown run');
  const summary = (await listRunsState(db, campaignId)).runs.find((r) => r.id === row.id);
  const payout = asRecord(row.payout);
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.runId, row.id))
    .orderBy(desc(ledgerEntries.createdAt));
  const names = new Map(
    (await db.select().from(characters).where(eq(characters.campaignId, campaignId))).map((c) => [
      c.id,
      c.name,
    ]),
  );
  return {
    ...(summary ?? {
      id: row.id,
      title: row.title,
      state: row.state,
      johnsonPageId: row.johnsonPageId,
      johnson: null,
      payout,
      awards: asRecord(row.awards),
      hasRecap: row.recapMd.trim().length > 0,
    }),
    recapMd: row.recapMd,
    objectives: Array.isArray(payout['objectives']) ? (payout['objectives'] as unknown[]) : [],
    opposition: Array.isArray(payout['opposition']) ? (payout['opposition'] as unknown[]) : [],
    ledger: entries.map((e) => ({
      characterId: e.characterId,
      characterName: names.get(e.characterId) ?? 'unknown',
      currency: e.currency,
      delta: e.delta,
      reason: e.reason,
      state: e.state,
    })),
  };
}

// ---------------------------------------------------------------------------
// Calendar (FR5.7 / FR12.17 `get_calendar`)
// ---------------------------------------------------------------------------

export interface CalendarState {
  /** The campaign's current in-game date (FR5.7), or null if never set. */
  ingameDate: string | null;
  /** GM-pinned timeline beats, earliest first. The GM sees all of them. */
  events: TimelineEvent[];
  /** Events dated on or after the in-game date — "what's coming". */
  upcoming: TimelineEvent[];
  sessions: Array<{ id: string; date: string | null; state: string; hasRecap: boolean }>;
  runs: Array<{ id: string; title: string; state: string }>;
  lifestyles: Array<{
    characterId: string;
    characterName: string;
    lifestyle: string;
    costPerMonth: number;
    paidThrough: string | null;
    /** True when `paidThrough` is already behind the in-game date. */
    overdue: boolean;
  }>;
  note: string;
}

/** Sixth-World dates are plain ISO-ish strings; compare them as strings. */
function isBefore(a: string, b: string): boolean {
  return a.slice(0, 10) < b.slice(0, 10);
}

/**
 * Pinned timeline events live under `campaigns.settings.timeline` (the codex
 * calendar's own note says a table is a straight lift when one lands). Parsed
 * tolerantly here so a hand-edited blob degrades to "no beats" rather than
 * failing a tool call mid-answer. `plugins/codex-calendar.ts` reads the same
 * key with the same tolerance; if it ever exports that reader, this becomes a
 * one-line delegation.
 */
function readTimelineEvents(settings: unknown): TimelineEvent[] {
  const rec = asRecord(settings);
  const raw = rec['timeline'];
  if (!Array.isArray(raw)) return [];
  const out: TimelineEvent[] = [];
  for (const entry of raw) {
    const e = asRecord(entry);
    if (typeof e['id'] !== 'string' || typeof e['date'] !== 'string') continue;
    if (typeof e['title'] !== 'string') continue;
    const visibility = e['visibility'];
    out.push({
      id: e['id'],
      date: e['date'],
      title: e['title'],
      ...(typeof e['body'] === 'string' ? { body: e['body'] } : {}),
      kind: typeof e['kind'] === 'string' ? e['kind'] : 'event',
      visibility:
        visibility === 'public' || visibility === 'gm' || visibility === 'gm_owner'
          ? visibility
          : 'gm',
      ...(typeof e['pageId'] === 'string' ? { pageId: e['pageId'] } : {}),
      ...(typeof e['runId'] === 'string' ? { runId: e['runId'] } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getCalendarState(db: Db, campaignId: string): Promise<CalendarState> {
  const campaign = (
    await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  )[0];
  if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
  const [sessionRows, runRows, characterRows] = await Promise.all([
    db.select().from(gameSessions).where(eq(gameSessions.campaignId, campaignId)),
    db.select().from(runs).where(eq(runs.campaignId, campaignId)),
    db.select().from(characters).where(eq(characters.campaignId, campaignId)),
  ]);
  const today = campaign.ingameDate;
  const lifestyles: CalendarState['lifestyles'] = [];
  for (const row of characterRows) {
    const parsed = SheetV1Schema.safeParse(row.sheet);
    if (!parsed.success) continue;
    for (const lifestyle of parsed.data.lifestyles) {
      const paidThrough = lifestyle.paidThrough ?? null;
      lifestyles.push({
        characterId: row.id,
        characterName: row.name,
        lifestyle: lifestyle.name,
        costPerMonth: lifestyle.costPerMonth,
        paidThrough,
        overdue: today !== null && paidThrough !== null && isBefore(paidThrough, today),
      });
    }
  }
  const events = readTimelineEvents(campaign.settings);
  return {
    ingameDate: today,
    events,
    upcoming: today === null ? events : events.filter((e) => !isBefore(e.date, today)),
    sessions: sessionRows
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .map((s) => ({
        id: s.id,
        date: s.date,
        state: s.state,
        hasRecap: s.recapMd.trim().length > 0,
      })),
    runs: runRows.map((r) => ({ id: r.id, title: r.title, state: r.state })),
    lifestyles,
    note: 'Session dates are real-world; timeline beats, lifestyle paidThrough and the campaign date are in-game (FR5.7).',
  };
}
