/**
 * Rules-library bookmarks and the recently-opened-refs trail (FR11.6).
 *
 * Named per-book bookmarks ("grenade scatter", "called shots") are the pages
 * the table argues about; the trail is what got opened this session, so the GM
 * can jump back to the page they were on two arguments ago.
 *
 * Storage: **no new table.** Both live under `campaigns.settings.library`,
 * which is already a JSONB column and is *shallow-merged* by
 * `PATCH /api/campaigns/:id`, so a settings edit elsewhere cannot silently drop
 * them. Everything is validated on the way in and on the way out, so a
 * hand-edited settings blob degrades to "no bookmarks", never to a 500.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, type Db } from '@safehouse/db';
import { forgetCampaignSettings } from './discord.js';
import { httpError } from './auth.js';

export const BookmarkSchema = z.object({
  id: z.string().min(1),
  /** Book code as registered in M11, e.g. 'SR5'. */
  book: z.string().min(1).max(8),
  /** PRINTED page, the same number a ref chip carries (FR11.2). */
  page: z.number().int().min(1).max(2000),
  label: z.string().min(1).max(120),
  note: z.string().max(500).default(''),
  /** Pinned bookmarks sort first on the GM screen. */
  pinned: z.boolean().default(false),
  createdAt: z.string(),
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const RecentRefSchema = z.object({
  book: z.string().min(1).max(8),
  page: z.number().int().min(1).max(2000),
  label: z.string().max(120).default(''),
  at: z.string(),
});
export type RecentRef = z.infer<typeof RecentRefSchema>;

export const LibraryStateSchema = z.object({
  bookmarks: z.array(BookmarkSchema).default([]),
  recentRefs: z.array(RecentRefSchema).default([]),
});
export type LibraryState = z.infer<typeof LibraryStateSchema>;

export const MAX_BOOKMARKS = 200;
export const MAX_RECENT_REFS = 20;

const EMPTY: LibraryState = { bookmarks: [], recentRefs: [] };

/** Bookmarks sort pinned-first, then by book code, then by printed page. */
function sortBookmarks(list: Bookmark[]): Bookmark[] {
  return [...list].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || a.book.localeCompare(b.book) || a.page - b.page,
  );
}

async function loadSettings(db: Db, campaignId: string): Promise<Record<string, unknown>> {
  const row = (
    await db
      .select({ settings: campaigns.settings })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
  )[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  return typeof row.settings === 'object' && row.settings !== null
    ? { ...(row.settings as Record<string, unknown>) }
    : {};
}

/** Read the library state; a malformed blob reads as empty, never as an error. */
export async function readLibrary(db: Db, campaignId: string): Promise<LibraryState> {
  const settings = await loadSettings(db, campaignId);
  const parsed = LibraryStateSchema.safeParse(settings['library'] ?? {});
  const state = parsed.success ? parsed.data : EMPTY;
  return { bookmarks: sortBookmarks(state.bookmarks), recentRefs: state.recentRefs };
}

async function writeLibrary(
  db: Db,
  campaignId: string,
  next: LibraryState,
): Promise<LibraryState> {
  const settings = await loadSettings(db, campaignId);
  settings['library'] = next;
  await db.update(campaigns).set({ settings }).where(eq(campaigns.id, campaignId));
  // The roll path caches campaign settings for 15s (services/discord.ts).
  forgetCampaignSettings(campaignId);
  return { bookmarks: sortBookmarks(next.bookmarks), recentRefs: next.recentRefs };
}

export interface CreateBookmarkInput {
  book: string;
  page: number;
  label: string;
  note?: string;
  pinned?: boolean;
}

export async function addBookmark(
  db: Db,
  campaignId: string,
  input: CreateBookmarkInput,
): Promise<{ bookmark: Bookmark; library: LibraryState }> {
  const library = await readLibrary(db, campaignId);
  if (library.bookmarks.length >= MAX_BOOKMARKS) {
    throw httpError(409, 'too_many_bookmarks', `a campaign holds at most ${MAX_BOOKMARKS} bookmarks`);
  }
  const book = input.book.toUpperCase();
  const duplicate = library.bookmarks.find(
    (b) => b.book === book && b.page === input.page && b.label === input.label,
  );
  if (duplicate) return { bookmark: duplicate, library };
  const bookmark = BookmarkSchema.parse({
    id: `bm-${book.toLowerCase()}-${input.page}-${Date.now().toString(36)}`,
    book,
    page: input.page,
    label: input.label,
    note: input.note ?? '',
    pinned: input.pinned ?? false,
    createdAt: new Date().toISOString(),
  });
  const next = await writeLibrary(db, campaignId, {
    bookmarks: [...library.bookmarks, bookmark],
    recentRefs: library.recentRefs,
  });
  return { bookmark, library: next };
}

export interface UpdateBookmarkInput {
  label?: string;
  note?: string;
  pinned?: boolean;
  page?: number;
}

export async function updateBookmark(
  db: Db,
  campaignId: string,
  bookmarkId: string,
  patch: UpdateBookmarkInput,
): Promise<{ bookmark: Bookmark; library: LibraryState }> {
  const library = await readLibrary(db, campaignId);
  const existing = library.bookmarks.find((b) => b.id === bookmarkId);
  if (!existing) throw httpError(404, 'not_found', 'unknown bookmark');
  const bookmark = BookmarkSchema.parse({
    ...existing,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.page !== undefined ? { page: patch.page } : {}),
  });
  const next = await writeLibrary(db, campaignId, {
    bookmarks: library.bookmarks.map((b) => (b.id === bookmarkId ? bookmark : b)),
    recentRefs: library.recentRefs,
  });
  return { bookmark, library: next };
}

export async function removeBookmark(
  db: Db,
  campaignId: string,
  bookmarkId: string,
): Promise<LibraryState> {
  const library = await readLibrary(db, campaignId);
  if (!library.bookmarks.some((b) => b.id === bookmarkId)) {
    throw httpError(404, 'not_found', 'unknown bookmark');
  }
  return writeLibrary(db, campaignId, {
    bookmarks: library.bookmarks.filter((b) => b.id !== bookmarkId),
    recentRefs: library.recentRefs,
  });
}

/**
 * Push a ref onto the trail: newest first, one entry per book+page, capped at
 * {@link MAX_RECENT_REFS}. Re-opening a page moves it to the front rather than
 * filling the list with the page the table keeps arguing about.
 */
export async function recordRecentRef(
  db: Db,
  campaignId: string,
  ref: { book: string; page: number; label?: string },
): Promise<LibraryState> {
  const library = await readLibrary(db, campaignId);
  const book = ref.book.toUpperCase();
  const entry = RecentRefSchema.parse({
    book,
    page: ref.page,
    label: ref.label ?? '',
    at: new Date().toISOString(),
  });
  const rest = library.recentRefs.filter((r) => !(r.book === book && r.page === ref.page));
  return writeLibrary(db, campaignId, {
    bookmarks: library.bookmarks,
    recentRefs: [entry, ...rest].slice(0, MAX_RECENT_REFS),
  });
}
