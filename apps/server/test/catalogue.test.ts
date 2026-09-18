/**
 * The catalogue end to end: pages in `book_pages` become rows in `book_items`
 * (compile), a player finds them by name (search), a GM-only book's gear is
 * not a back door to the book (FR11.5), and the seeder's `--catalogue` flag
 * parses. Every name and number is invented (§14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { BuildQualitySchema } from '@safehouse/contracts';
import { bookItems, bookPages, books, campaigns, searchBookItems } from '@safehouse/db';
import { parseArgs } from '../scripts/seed-books.js';
import { qualityPrice } from '../src/services/catalogue.js';
import { forgetCampaignSettings } from '../src/services/discord.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let playerToken = '';
let coreId = '';
let secretId = '';

const CORE_PAGE = [
  'HEAVY PISTOLS',
  'Heavy pistols are powerful sidearms.',
  'HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST',
  'Zap Gun 5 (7) 8P –1 SA — 15 (c) 5R 725¥',
  'Burst Gun 6 6P — SA / BF (1) 21 (c) 7R 210¥',
  'ARMOR',
  'ARMOR ARMOR RATING AVAIL COST',
  'Crate Coat 9 2 900¥',
  'Armor Jacket 12 2 1,000¥',
].join('\n');

const CORE_SPELLS = ['COMBAT SPELLS', 'STONE FIST', 'Type: P Range: LOS Damage: S', 'Duration: I Drain: F – 3', 'It hits like a rock.'].join('\n');

const SECRET_PAGE = ['SECRET TOYS', 'AVAIL COST', 'Plot Device 12F 50,000¥'].join('\n');

beforeAll(async () => {
  t = await makeTestApp('catalogue');
  boot = await bootstrapCampaign(t.app, 'Catalogue');
  const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  playerToken = player.token;
  const [core] = await t.app.db
    .insert(books)
    .values({ code: 'SR5', title: 'Core', pageOffset: 5, shared: true, campaignId: null })
    .returning();
  const [secret] = await t.app.db
    .insert(books)
    .values({ code: 'GMX', title: 'GM only', pageOffset: 0, shared: false, campaignId: null })
    .returning();
  coreId = core!.id;
  secretId = secret!.id;
  await t.app.db.insert(bookPages).values([
    { bookId: coreId, printedPage: 426, text: CORE_PAGE },
    { bookId: coreId, printedPage: 284, text: CORE_SPELLS },
    { bookId: secretId, printedPage: 9, text: SECRET_PAGE },
  ]);
}, 120_000);

afterAll(async () => {
  await t.close();
});

const gm = () => ({ authorization: `Bearer ${boot.gmToken}` });
const player = () => ({ authorization: `Bearer ${playerToken}` });

describe('compiling', () => {
  it('is the GM\'s to run, and says what each book yielded', async () => {
    const denied = await t.app.inject({ method: 'POST', url: `/api/books/${coreId}/catalogue`, headers: player() });
    expect(denied.statusCode).toBe(403);
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${coreId}/catalogue`, headers: gm() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ book: { code: 'SR5' }, items: 5, byKind: { weapon: 2, armor: 2, spell: 1 }, pagesRead: 2 });
    const again = await t.app.inject({ method: 'POST', url: `/api/books/${coreId}/catalogue`, headers: gm() });
    expect((again.json() as { items: number }).items, 'a rerun replaces, never duplicates').toBe(5);
    const secret = await t.app.inject({ method: 'POST', url: `/api/books/${secretId}/catalogue`, headers: gm() });
    expect((secret.json() as { items: number }).items).toBe(1);
  });

  it('is summarised per book', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/catalogue/summary', headers: gm() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; books: Array<{ code: string; items: number; byKind: Record<string, number> }> };
    expect(body.total).toBe(6);
    expect(body.books.find((b) => b.code === 'SR5')).toMatchObject({ items: 5, byKind: { weapon: 2 } });
    // A player's summary does not list the GM-only book at all.
    const mine = await t.app.inject({ method: 'GET', url: '/api/catalogue/summary', headers: player() });
    expect((mine.json() as { total: number; books: Array<{ code: string }> }).books.map((b) => b.code)).toEqual(['SR5']);
  });
});

describe('finding', () => {
  it('finds an item by part of its name, with its stats, its price and its page', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=zap', headers: player() });
    expect(res.statusCode, res.body).toBe(200);
    const hits = (res.json() as { hits: Array<Record<string, unknown>> }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      name: 'Zap Gun',
      kind: 'weapon',
      category: 'HEAVY PISTOLS',
      stats: { ACC: '5 (7)', DAMAGE: '8P', AP: '–1', MODE: 'SA', RC: '—', AMMO: '15 (c)' },
      avail: '5R',
      cost: 725,
      ref: { book: 'SR5', page: 426 },
      pdfPage: 431,
      readUrl: '/read/SR5?p=426',
    });
  });

  it('finds by category word, exact names first, and filters by kind', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=heavy%20pistols', headers: player() });
    expect((res.json() as { hits: Array<{ name: string }> }).hits.map((h) => h.name).sort()).toEqual(['Burst Gun', 'Zap Gun']);
    // "armor" is the category of both; the one NAMED armor comes first.
    const armor = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=armor&kind=armor', headers: player() });
    expect((armor.json() as { hits: Array<{ name: string }> }).hits.map((h) => h.name)).toEqual(['Armor Jacket', 'Crate Coat']);
    const weaponsOnly = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=gun&kind=weapon', headers: player() });
    expect((weaponsOnly.json() as { hits: Array<{ name: string }> }).hits.map((h) => h.name)).toEqual(['Zap Gun', 'Burst Gun']);
    const exact = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=armor%20jacket', headers: player() });
    expect((exact.json() as { hits: Array<{ name: string }> }).hits[0]?.name).toBe('Armor Jacket');
    const spell = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=stone', headers: player() });
    expect((spell.json() as { hits: Array<{ name: string; kind: string; stats: Record<string, string> }> }).hits[0]).toMatchObject({ name: 'Stone Fist', kind: 'spell', stats: { DRAIN: 'F – 3' } });
  });

  it('keeps a GM-only book\'s items from players, and shows them to the GM', async () => {
    const mine = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=plot', headers: player() });
    expect((mine.json() as { hits: unknown[] }).hits).toEqual([]);
    const forbidden = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=plot&book=GMX', headers: player() });
    expect(forbidden.statusCode).toBe(403);
    const theirs = await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=plot', headers: gm() });
    expect((theirs.json() as { hits: Array<{ name: string; cost: number }> }).hits[0]).toMatchObject({ name: 'Plot Device', cost: 50000 });
  });

  it('rejects an empty query and needs a device', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=', headers: player() })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/api/catalogue/search?q=zap' })).statusCode).toBe(401);
  });
});

describe('browsing, paging, several books and the builder\'s books (CHARGEN.md §8.5)', () => {
  let rfId = '';
  const RF_QUALITIES = [
    'POSITIVE QUALITIES',
    'LUCKY STREAK',
    'Cost: 12 Karma',
    'IRON NERVE',
    'Cost: 4 Karma per rating (max rating 3)',
    'NEGATIVE QUALITIES',
    'BAD KNEES',
    'Bonus: 5 to 20 Karma',
    'SHAKY HANDS',
    'Bonus: 3 Karma per level (max 4)',
  ].join('\n');
  const RF_GEAR = ['ODD GEAR', 'AVAIL COST', '100% Kevlar Vest 4 500¥', '1000 Rounds Crate 2 100¥', 'Item_7 Kit 3 50¥', 'ItemX7 Kit 3 60¥'].join('\n');

  type Page = { query: string; hits: Array<{ id: string; name: string; kind: string; bookCode: string; stats: Record<string, string>; printedPage: number; ref: { book: string; page: number } }>; total: number; offset: number; limit: number; hasMore: boolean };
  const get = async (url: string, headers = player()) => {
    const res = await t.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json() as Page };
  };
  const names = (p: Page) => p.hits.map((h) => h.name);
  const setChargen = async (chargen: Record<string, unknown> | undefined) => {
    const [row] = await t.app.db.select({ settings: campaigns.settings }).from(campaigns).where(eq(campaigns.id, boot.campaignId));
    const settings = { ...((row?.settings ?? {}) as Record<string, unknown>) };
    if (chargen === undefined) delete settings['chargen'];
    else settings['chargen'] = chargen;
    await t.app.db.update(campaigns).set({ settings }).where(eq(campaigns.id, boot.campaignId));
    forgetCampaignSettings(boot.campaignId);
  };

  beforeAll(async () => {
    const [rf] = await t.app.db.insert(books).values({ code: 'RF', title: 'Second Book', pageOffset: 2, shared: true, campaignId: null }).returning();
    rfId = rf!.id;
    await t.app.db.insert(bookPages).values([
      { bookId: rfId, printedPage: 70, text: RF_QUALITIES },
      { bookId: rfId, printedPage: 180, text: RF_GEAR },
    ]);
    // A row compiled before the parser knew the per-rating shape: it carries the price with the scaling dropped.
    await t.app.db.insert(bookItems).values({ bookId: rfId, printedPage: 70, kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Iron Nerve', stats: { KARMA: '4', TYPE: 'positive' } });
  }, 120_000);

  afterAll(async () => {
    await setChargen(undefined);
  });

  it('picks up the new quality shapes when the book is compiled again', async () => {
    const stale = await get('/api/catalogue/search?kind=quality&book=RF');
    expect(stale.body.hits).toEqual([expect.objectContaining({ name: 'Iron Nerve', stats: { KARMA: '4', TYPE: 'positive' } })]);
    const res = await t.app.inject({ method: 'POST', url: `/api/books/${rfId}/catalogue`, headers: gm() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ items: 8, byKind: { quality: 4, gear: 4 } });
    const fresh = await get('/api/catalogue/search?kind=quality&book=RF');
    expect(fresh.body.hits.find((h) => h.name === 'Iron Nerve')?.stats).toEqual({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' });
    expect(fresh.body.hits.find((h) => h.name === 'Bad Knees')?.stats).toEqual({ KARMA: '5-20', TYPE: 'negative' });
    expect(fresh.body.hits.find((h) => h.name === 'Shaky Hands')?.stats).toEqual({ KARMA: '3', PER: 'rating', MAX: '4', TYPE: 'negative' });
    // …and the compiled row becomes a build's quality at a rating.
    const iron = fresh.body.hits.find((h) => h.name === 'Iron Nerve')!;
    const price = qualityPrice(iron.stats, 2);
    expect(BuildQualitySchema.parse({ name: iron.name, catalogueId: iron.id, ref: iron.ref, type: price.type, karma: price.karma, rating: 2 })).toMatchObject({ karma: 8, rating: 2, type: 'positive', ref: { book: 'RF', page: 70 } });
  });

  it('browses a kind alphabetically with no query, in pages that say how many there are', async () => {
    const all = await get('/api/catalogue/search?kind=quality');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ query: '', total: 4, offset: 0, limit: 20, hasMore: false });
    expect(names(all.body)).toEqual(['Bad Knees', 'Iron Nerve', 'Lucky Streak', 'Shaky Hands']);
    const first = await get('/api/catalogue/search?kind=quality&limit=3');
    expect(names(first.body)).toEqual(['Bad Knees', 'Iron Nerve', 'Lucky Streak']);
    expect(first.body).toMatchObject({ total: 4, hasMore: true });
    const second = await get('/api/catalogue/search?kind=quality&limit=3&offset=3');
    expect(names(second.body)).toEqual(['Shaky Hands']);
    expect(second.body).toMatchObject({ total: 4, offset: 3, hasMore: false });
    const past = await get('/api/catalogue/search?kind=quality&limit=3&offset=30');
    expect(past.body).toMatchObject({ hits: [], total: 4, hasMore: false });
    // A search pages the same way.
    const kits = await get('/api/catalogue/search?q=kit&limit=1');
    expect(kits.body).toMatchObject({ total: 2, hasMore: true });
    const nextKit = await get('/api/catalogue/search?q=kit&limit=1&offset=1');
    expect(nextKit.body.hits).toHaveLength(1);
    expect(nextKit.body.hits[0]!.name).not.toBe(kits.body.hits[0]!.name);
  });

  it('refuses a browse with no kind, and keeps GM-only books out of a browse', async () => {
    expect((await get('/api/catalogue/search')).status).toBe(400);
    expect((await get('/api/catalogue/search?limit=10')).status).toBe(400);
    expect(names((await get('/api/catalogue/search?kind=gear')).body)).not.toContain('Plot Device');
    expect(names((await get('/api/catalogue/search?kind=gear', gm())).body)).toContain('Plot Device');
  });

  it('narrows to several books, and still takes the single book older callers send', async () => {
    const both = await get('/api/catalogue/search?kind=armor&books=SR5,rf');
    expect(both.body.total).toBe(2);
    expect((await get('/api/catalogue/search?kind=quality&books=SR5')).body.total).toBe(0);
    expect((await get('/api/catalogue/search?kind=quality&book=RF')).body.total).toBe(4);
    const joined = await get('/api/catalogue/search?q=a&book=SR5&books=RF');
    expect(new Set(joined.body.hits.map((h) => h.bookCode))).toEqual(new Set(['SR5', 'RF']));
    expect((await get('/api/catalogue/search?kind=gear&books=RF,GMX')).status).toBe(403);
    expect((await get('/api/catalogue/search?kind=gear&books=RF,GMX', gm())).status).toBe(200);
    // A code no book has is unknown, not malformed; one longer than any code can be is malformed.
    expect((await get('/api/catalogue/search?kind=gear&books=RF,no%20such')).status).toBe(403);
    expect((await get('/api/catalogue/search?kind=gear&books=RF,THIRTEENCHARS')).status).toBe(400);
    expect((await get('/api/catalogue/search?kind=gear&book=THIRTEENCHARS')).status).toBe(400);
  });

  it('takes % and _ in a query literally', async () => {
    // "0% kev" shares no whole word with any row, so only the name match can find it — the one the escaping bug broke.
    expect(names((await get('/api/catalogue/search?q=0%25%20kev')).body)).toEqual(['100% Kevlar Vest']);
    // A percent sign is a percent sign: "100%" is not "100 then anything".
    expect(names((await get('/api/catalogue/search?q=100%25')).body)).toEqual(['100% Kevlar Vest']);
    // An underscore is an underscore: not any one character.
    expect(names((await get('/api/catalogue/search?q=m_7')).body)).toEqual(['Item_7 Kit']);
    expect(names((await get('/api/catalogue/search?q=%25')).body)).toEqual(['100% Kevlar Vest']);
    expect(names((await get('/api/catalogue/search?q=_')).body)).toEqual(['Item_7 Kit']);
    // The ranking's starts-with tier is escaped too: "100%" ranks the vest as a prefix match, first.
    expect(await searchBookItems(t.app.db, '100%', { bookCodes: ['RF'] })).toEqual([expect.objectContaining({ name: '100% Kevlar Vest' })]);
  });

  it('draws the builder\'s catalogue from the campaign\'s character-creation books', async () => {
    const campaignId = boot.campaignId;
    await setChargen({ books: ['rf'] });
    expect((await get(`/api/catalogue/search?kind=armor&campaignId=${campaignId}`)).body.total).toBe(0);
    expect((await get(`/api/catalogue/search?kind=quality&campaignId=${campaignId}`)).body.total).toBe(4);
    expect((await get(`/api/catalogue/search?q=zap&campaignId=${campaignId}`)).body.hits).toEqual([]);
    // Without the campaign the sheet's own search is unchanged.
    expect((await get('/api/catalogue/search?kind=armor')).body.total).toBe(2);
    const outside = await get(`/api/catalogue/search?kind=armor&book=SR5&campaignId=${campaignId}`);
    expect(outside.status).toBe(403);
    // An empty list is every shared book — for the GM too, so a GM-only book stays out of a build.
    await setChargen({ books: [] });
    expect((await get(`/api/catalogue/search?kind=armor&campaignId=${campaignId}`)).body.total).toBe(2);
    expect(names((await get(`/api/catalogue/search?kind=gear&campaignId=${campaignId}`, gm())).body)).not.toContain('Plot Device');
    // Another campaign's id, or no id at all, gets nothing.
    expect((await get('/api/catalogue/search?kind=gear&campaignId=00000000-0000-4000-8000-000000000000')).status).toBe(403);
    expect((await get('/api/catalogue/search?kind=gear&campaignId=nope')).status).toBe(400);
  });

  it('answers a malformed book id on recompile with 404, not a database error', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/books/not-a-uuid/catalogue', headers: gm() })).statusCode).toBe(404);
  });
});

describe('book codes the shelf accepts, and a capitalised quality section', () => {
  // The shelf takes any code of 1–8 characters; search must find every one of them.
  const CAPS_QUALITIES = ['POSITIVE QUALITIES', 'NIGHT OWL', 'COST: 3 KARMA PER', 'RATING (MAX 3)', 'Awake after dark, in our words.', 'NEGATIVE QUALITIES', 'GLASS JAW', 'BONUS: 4 TO 20 KARMA'].join('\n');
  let ampId = '';

  const get = async (url: string, headers = player()) => {
    const res = await t.app.inject({ method: 'GET', url, headers });
    return { status: res.statusCode, body: res.json() as { total: number; hits: Array<{ name: string; bookCode: string; stats: Record<string, string> }> } };
  };

  beforeAll(async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/books', headers: gm(), payload: { code: 'R&G', title: 'Ampersand Book', shared: true } });
    expect(created.statusCode, created.body).toBe(201);
    ampId = (created.json() as { id: string }).id;
    const [spaced] = await t.app.db.insert(books).values({ code: 'SR5 GM', title: 'Spaced Code', pageOffset: 0, shared: true, campaignId: null }).returning();
    await t.app.db.insert(bookPages).values([
      { bookId: ampId, printedPage: 12, text: CAPS_QUALITIES },
      { bookId: spaced!.id, printedPage: 3, text: ['ARMOR', 'ARMOR ARMOR RATING AVAIL COST', 'Tin Poncho 4 2 300¥'].join('\n') },
    ]);
    for (const id of [ampId, spaced!.id]) {
      expect((await t.app.inject({ method: 'POST', url: `/api/books/${id}/catalogue`, headers: gm() })).statusCode).toBe(200);
    }
  }, 120_000);

  it('narrows to a book whose code has an ampersand or a space in it', async () => {
    const amp = await get('/api/catalogue/search?book=R%26G&kind=quality');
    expect(amp.status).toBe(200);
    expect(amp.body.hits.map((h) => h.bookCode)).toEqual(['R&G', 'R&G']);
    expect((await get('/api/catalogue/search?books=r%26g,RF&kind=quality')).status).toBe(200);
    const spaced = await get('/api/catalogue/search?book=SR5%20GM&kind=armor');
    expect(spaced.status).toBe(200);
    expect(spaced.body.hits.map((h) => h.name)).toEqual(['Tin Poncho']);
    // Codes reach the query only as bound parameters: a hostile one is just an unknown book.
    expect((await get("/api/catalogue/search?books=SR5')%3B--&kind=armor")).status).toBe(403);
  });

  it('reads a quality section printed in capitals, a price broken over two lines included', async () => {
    const res = await get('/api/catalogue/search?book=R%26G&kind=quality');
    expect(res.body.hits.map((h) => [h.name, h.stats])).toEqual([
      ['Glass Jaw', { KARMA: '4-20', TYPE: 'negative' }],
      ['Night Owl', { KARMA: '3', PER: 'rating', MAX: '3', TYPE: 'positive' }],
    ]);
  });
});

describe('the seeder flag', () => {
  it('parses --catalogue', () => {
    expect(parseArgs(['--catalogue']).catalogue).toBe(true);
    expect(parseArgs(['--catalog', '--only', 'sr5'])).toMatchObject({ catalogue: true, only: 'SR5' });
    expect(parseArgs([]).catalogue).toBe(false);
  });
});
