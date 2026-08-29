/**
 * Rules-library bookmarks and the recently-opened-refs trail (FR11.6).
 *
 * Bookmarks are named printed pages ("grenade scatter"), so every one comes
 * back as a real ref chip: book code, printed page, the PDF page after the
 * offset, and the `/read` URL the viewer opens. They live under
 * `campaigns.settings.library` — no new table and no migration — so the suite
 * also proves a normal settings PATCH cannot quietly drop them.
 *
 * FR11.5 still applies: a GM-only book's bookmarks are GM-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { books, campaigns, type Db } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { MAX_RECENT_REFS, readLibrary, recordRecentRef } from '../src/services/bookmarks.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;

interface BookmarkDto {
  id: string;
  book: string;
  page: number;
  label: string;
  note: string;
  pinned: boolean;
  ref: string;
  pdfPage: number;
  readUrl: string;
}

function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload: Record<string, unknown> = {},
) {
  return t.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
}

function gm(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: Record<string, unknown> = {},
) {
  return inject(method, url, boot.gmToken, payload);
}

function asPlayer(method: 'GET' | 'POST', url: string, payload: Record<string, unknown> = {}) {
  return inject(method, url, player.token, payload);
}

beforeAll(async () => {
  t = await makeTestApp('books-bookmarks');
  boot = await bootstrapCampaign(t.app, 'Bookmarks');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  await t.db.insert(books).values([
    {
      campaignId: boot.campaignId,
      code: 'FOLIO',
      title: 'Table Folio',
      pageOffset: 5,
      shared: true,
    },
    {
      campaignId: boot.campaignId,
      code: 'SECRET',
      title: "The GM's back pocket",
      pageOffset: 0,
      shared: false,
    },
  ]);
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('named bookmarks (FR11.6)', () => {
  let scatterId: string;

  it('names a page and hands back a real ref chip', async () => {
    const res = await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'folio',
      page: 426,
      label: 'grenade scatter',
      note: 'the argument from session 4',
    });
    expect(res.statusCode).toBe(201);
    const bookmark = res.json() as BookmarkDto;
    scatterId = bookmark.id;
    expect(bookmark).toMatchObject({
      book: 'FOLIO',
      page: 426,
      label: 'grenade scatter',
      ref: 'FOLIO p.426',
      pinned: false,
    });
    // Printed 426 + the book's +5 front matter.
    expect(bookmark.pdfPage).toBe(431);
    expect(bookmark.readUrl).toBe('/read/FOLIO?p=426');
  });

  it('refuses a book that is not in the registry', async () => {
    const res = await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'NOPE',
      page: 12,
      label: 'nothing',
    });
    expect(res.statusCode).toBe(404);
  });

  it('is idempotent on the same book/page/label', async () => {
    const again = await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'FOLIO',
      page: 426,
      label: 'grenade scatter',
    });
    expect(again.statusCode).toBe(201);
    expect((again.json() as BookmarkDto).id).toBe(scatterId);
    const list = await gm('GET', `/api/campaigns/${boot.campaignId}/library`);
    expect((list.json() as { bookmarks: BookmarkDto[] }).bookmarks).toHaveLength(1);
  });

  it('pins the ones the table argues about most, and sorts them first', async () => {
    await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'FOLIO',
      page: 190,
      label: 'called shots',
    });
    const patched = await gm(
      'PATCH',
      `/api/campaigns/${boot.campaignId}/bookmarks/${scatterId}`,
      { pinned: true, label: 'grenade scatter (house)' },
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ pinned: true, label: 'grenade scatter (house)' });

    const list = await gm('GET', `/api/campaigns/${boot.campaignId}/library`);
    const bookmarks = (list.json() as { bookmarks: BookmarkDto[] }).bookmarks;
    expect(bookmarks.map((b) => b.label)).toEqual(['grenade scatter (house)', 'called shots']);
  });

  it('deletes one and 404s the second time', async () => {
    const created = await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'FOLIO',
      page: 12,
      label: 'temporary',
    });
    const { id } = created.json() as BookmarkDto;
    expect((await gm('DELETE', `/api/campaigns/${boot.campaignId}/bookmarks/${id}`)).statusCode).toBe(200);
    expect((await gm('DELETE', `/api/campaigns/${boot.campaignId}/bookmarks/${id}`)).statusCode).toBe(404);
  });
});

describe('the recently-opened trail (FR11.6)', () => {
  it('records what got opened, newest first', async () => {
    for (const page of [12, 44, 426]) {
      const res = await asPlayer('POST', `/api/campaigns/${boot.campaignId}/library/recent`, {
        book: 'FOLIO',
        page,
        label: `page ${page}`,
      });
      expect(res.statusCode).toBe(201);
    }
    const list = await gm('GET', `/api/campaigns/${boot.campaignId}/library`);
    const trail = (list.json() as { recentRefs: Array<{ page: number; ref: string }> }).recentRefs;
    expect(trail.map((r) => r.page)).toEqual([426, 44, 12]);
    expect(trail[0]!.ref).toBe('FOLIO p.426');
  });

  it('moves a re-opened page to the front instead of duplicating it', async () => {
    await asPlayer('POST', `/api/campaigns/${boot.campaignId}/library/recent`, {
      book: 'FOLIO',
      page: 12,
    });
    const list = await gm('GET', `/api/campaigns/${boot.campaignId}/library`);
    const trail = (list.json() as { recentRefs: Array<{ page: number }> }).recentRefs;
    expect(trail.map((r) => r.page)).toEqual([12, 426, 44]);
  });

  it('caps the trail so a long session cannot grow it forever', async () => {
    for (let page = 100; page < 100 + MAX_RECENT_REFS + 5; page++) {
      await recordRecentRef(t.db as Db, boot.campaignId, { book: 'FOLIO', page });
    }
    const library = await readLibrary(t.db as Db, boot.campaignId);
    expect(library.recentRefs).toHaveLength(MAX_RECENT_REFS);
    expect(library.recentRefs[0]!.page).toBe(100 + MAX_RECENT_REFS + 4);
  });
});

describe('access (FR11.5 / §13)', () => {
  it('lets players read the shared library but not edit it', async () => {
    const read = await asPlayer('GET', `/api/campaigns/${boot.campaignId}/library`);
    expect(read.statusCode).toBe(200);
    const create = await asPlayer('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'FOLIO',
      page: 1,
      label: 'mine now',
    });
    expect(create.statusCode).toBe(403);
  });

  it('keeps a GM-only book’s bookmarks GM-only', async () => {
    const created = await gm('POST', `/api/campaigns/${boot.campaignId}/bookmarks`, {
      book: 'SECRET',
      page: 3,
      label: 'the twist',
    });
    expect(created.statusCode).toBe(201);

    const gmView = await gm('GET', `/api/campaigns/${boot.campaignId}/library`);
    expect(
      (gmView.json() as { bookmarks: BookmarkDto[] }).bookmarks.map((b) => b.book),
    ).toContain('SECRET');

    const playerView = await asPlayer('GET', `/api/campaigns/${boot.campaignId}/library`);
    const visible = (playerView.json() as { bookmarks: BookmarkDto[] }).bookmarks;
    expect(visible.map((b) => b.book)).not.toContain('SECRET');
    expect(visible.map((b) => b.book)).toContain('FOLIO');

    const playerRecent = await asPlayer('POST', `/api/campaigns/${boot.campaignId}/library/recent`, {
      book: 'SECRET',
      page: 3,
    });
    expect(playerRecent.statusCode).toBe(403);
  });
});

describe('storage (no new table, no migration)', () => {
  it('lives under campaigns.settings.library', async () => {
    const row = (
      await t.db
        .select({ settings: campaigns.settings })
        .from(campaigns)
        .where(eq(campaigns.id, boot.campaignId))
        .limit(1)
    )[0]!;
    const settings = row.settings as { library?: { bookmarks: unknown[] } };
    expect(Array.isArray(settings.library?.bookmarks)).toBe(true);
  });

  it('survives an unrelated settings PATCH (shallow merge)', async () => {
    const before = await readLibrary(t.db as Db, boot.campaignId);
    const patched = await gm('PATCH', `/api/campaigns/${boot.campaignId}`, {
      settings: { mirrorRollsToDiscord: true },
    });
    expect(patched.statusCode).toBe(200);
    const after = await readLibrary(t.db as Db, boot.campaignId);
    expect(after.bookmarks.map((b) => b.id)).toEqual(before.bookmarks.map((b) => b.id));
  });

  it('reads a corrupted blob as empty rather than throwing', async () => {
    const other = await t.db
      .insert(campaigns)
      .values({
        name: 'Corrupt',
        gmUserId: boot.gmUserId,
        settings: { library: { bookmarks: 'not an array' } },
      })
      .returning();
    const library = await readLibrary(t.db as Db, other[0]!.id);
    expect(library).toEqual({ bookmarks: [], recentRefs: [] });
  });
});
