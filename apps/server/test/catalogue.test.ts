/**
 * The catalogue end to end: pages in `book_pages` become rows in `book_items`
 * (compile), a player finds them by name (search), a GM-only book's gear is
 * not a back door to the book (FR11.5), and the seeder's `--catalogue` flag
 * parses. Every name and number is invented (§14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookPages, books } from '@safehouse/db';
import { parseArgs } from '../scripts/seed-books.js';
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

describe('the seeder flag', () => {
  it('parses --catalogue', () => {
    expect(parseArgs(['--catalogue']).catalogue).toBe(true);
    expect(parseArgs(['--catalog', '--only', 'sr5'])).toMatchObject({ catalogue: true, only: 'SR5' });
    expect(parseArgs([]).catalogue).toBe(false);
  });
});
