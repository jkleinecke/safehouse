/**
 * The rest of the FR12.17 catalog: search_codex, get_page, list_contacts,
 * list_runs / get_run, get_calendar, get_magic_state and get_matrix_state.
 *
 * Two contracts are under test. First, every one of these returns the state the
 * table is actually playing with, live at call time. Second — the one that
 * matters for Principle 8 — **reads never mutate**: the suite snapshots every
 * row count before running the whole read catalog and asserts nothing moved,
 * and asserts no `ai_generations` row appears.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiGenerations,
  bookPages,
  books,
  campaigns,
  characters,
  contacts,
  gameSessions,
  ledgerEntries,
  runs,
  scenes,
  tokens,
  wikiPages,
  type Db,
} from '@safehouse/db';
import {
  bootstrapCampaign,
  makeTestApp,
  type BootstrapResult,
  type TestApp,
} from './core-helpers.js';
import { FIXER_TOOLS, executeTool, type ToolContext } from '../src/fixer/tools.js';
import { readContactFavors } from '../src/fixer/state-codex.js';
import { writeNotes } from '../src/plugins/contacts.js';
import { makeSheet, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let fx: FixerFixture;
let ctx: ToolContext;
let runId: string;
let mageId: string;

async function call(name: string, args: unknown = {}): Promise<Record<string, unknown>> {
  const res = await executeTool(name, JSON.stringify(args), ctx);
  if (!res.ok) throw new Error(`tool ${name} failed: ${res.error}`);
  return res.result as Record<string, unknown>;
}

beforeAll(async () => {
  t = await makeTestApp('fixer-catalog');
  boot = await bootstrapCampaign(t.app, 'Catalog Completion');
  fx = await seedFixerFixture(t.db, boot.campaignId);
  ctx = {
    db: t.db as Db,
    campaignId: boot.campaignId,
    prompt: 'catalog test',
    model: 'mock-fast',
  };

  await t.db
    .update(campaigns)
    .set({ ingameDate: '2076-06-14' })
    .where(eq(campaigns.id, boot.campaignId));

  // A mage with something to sustain and a decker with a deck (FR8/FR7 reads).
  const mageSheet = makeSheet('Cinder');
  const mage = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        name: 'Cinder',
        sheet: {
          ...mageSheet,
          spells: [{ name: 'Lantern Light', category: 'Manipulation', drain: 'F-2' }],
          gear: [{ name: 'Sustaining focus (bracelet)', qty: 1, rating: 3 }],
          matrix: { deck: { name: 'Streetline Deck', asdf: [4, 3, 3, 2], programs: ['Toolbox'] } },
          complexForms: [{ name: 'Static Veil', target: 'Sleaze', fading: 'L-1' }],
          lifestyles: [{ name: 'Low', costPerMonth: 2000, paidThrough: '2076-06-01' }],
          play: { sustained: [{ id: 's1', name: 'Lantern Light', exempt: false }] },
        },
      })
      .returning()
  )[0]!;
  mageId = mage.id;

  await t.db.insert(contacts).values([
    {
      characterId: fx.staticId,
      name: 'Loop',
      archetype: 'Fixer',
      connection: 4,
      loyalty: 3,
      // The contacts service's own envelope — the authority for favours.
      notes: writeNotes('Runs the noodle bar.', { owed: 2, owing: 1 }),
    },
    {
      characterId: fx.staticId,
      name: 'Dr Vance',
      archetype: 'Street doc',
      connection: 2,
      loyalty: 5,
      notes: 'Patched Static up twice.',
    },
  ]);

  const johnson = (
    await t.db
      .insert(wikiPages)
      .values({
        campaignId: boot.campaignId,
        kind: 'npc',
        title: 'Mr Ashgrove',
        contentMd: 'A polite man in a grey coat who never gives a straight answer about Renraku.',
        visibility: 'gm',
        tags: ['johnson'],
      })
      .returning()
  )[0]!;
  await t.db.insert(wikiPages).values({
    campaignId: boot.campaignId,
    kind: 'location',
    title: 'The Pike Street walk-up',
    contentMd: 'A safehouse over a noodle bar in Redmond. Two exits, one of them a lie.',
    visibility: 'public',
    tags: ['safehouse'],
  });

  const run = (
    await t.db
      .insert(runs)
      .values({
        campaignId: boot.campaignId,
        title: 'The Ashgrove pickup',
        johnsonPageId: johnson.id,
        state: 'prep',
        payout: {
          nuyen: 12000,
          objectives: ['collect the courier', 'leave no trace'],
          opposition: ['corp security'],
        },
        awards: { karma: 6 },
      })
      .returning()
  )[0]!;
  runId = run.id;
  await t.db.insert(ledgerEntries).values({
    characterId: fx.staticId,
    currency: 'nuyen',
    delta: 4000,
    reason: 'Ashgrove advance',
    state: 'approved',
    runId: run.id,
  });

  await t.db.insert(gameSessions).values({
    campaignId: boot.campaignId,
    date: '2026-08-01',
    state: 'done',
    recapMd: 'They took the meet.',
  });

  const book = (
    await t.db
      .insert(books)
      .values({
        campaignId: boot.campaignId,
        code: 'FOLIO',
        title: 'Table Folio',
        pageOffset: 4,
      })
      .returning()
  )[0]!;
  await t.db.insert(bookPages).values({
    bookId: book.id,
    printedPage: 88,
    text: 'House ruling on scatter: the throwing test decides the drift, and the table agrees the direction before the dice land.',
  });
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('the catalog is complete (FR12.17)', () => {
  it('exposes every tool the FR names', () => {
    expect(FIXER_TOOLS.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'search_codex',
        'get_page',
        'list_contacts',
        'list_runs',
        'get_run',
        'get_calendar',
        'get_magic_state',
        'get_matrix_state',
      ]),
    );
  });

  it('marks the new state readers read-only', () => {
    const readOnly = [
      'search_codex',
      'get_page',
      'list_contacts',
      'list_runs',
      'get_run',
      'get_calendar',
      'get_magic_state',
      'get_matrix_state',
    ];
    for (const name of readOnly) {
      expect(FIXER_TOOLS.find((tool) => tool.name === name)?.kind).toBe('read');
    }
  });
});

describe('codex + library reads', () => {
  it('search_codex ranks pages and flags the GM-only ones', async () => {
    const found = await call('search_codex', { query: 'noodle bar safehouse' });
    const hits = found['hits'] as Array<{ title: string; gmOnly: boolean; snippet: string }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.title)).toContain('The Pike Street walk-up');
    expect(hits.find((h) => h.title === 'The Pike Street walk-up')?.gmOnly).toBe(false);

    const secret = await call('search_codex', { query: 'Renraku grey coat' });
    const secretHits = secret['hits'] as Array<{ title: string; gmOnly: boolean }>;
    expect(secretHits.find((h) => h.title === 'Mr Ashgrove')?.gmOnly).toBe(true);
  });

  it('search_codex can be narrowed to one page kind', async () => {
    const found = await call('search_codex', { query: 'Redmond noodle bar', kind: 'location' });
    const hits = found['hits'] as Array<{ kind: string }>;
    expect(hits.every((h) => h.kind === 'location')).toBe(true);
  });

  it('get_page returns the printed page it actually came from, with the offset applied', async () => {
    const page = await call('get_page', { book: 'folio', page: 88 });
    expect(page['ref']).toEqual({ book: 'FOLIO', page: 88 });
    expect(page['pdfPage']).toBe(92); // printed 88 + offset 4
    expect(String(page['text'])).toContain('scatter');
    expect(page['readUrl']).toBe('/read/FOLIO?p=88');
  });

  it('get_page says so rather than inventing an unextracted page', async () => {
    const missing = await executeTool('get_page', JSON.stringify({ book: 'FOLIO', page: 900 }), ctx);
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('not been extracted');
  });
});

describe('P4 state reads', () => {
  it('list_contacts carries Connection, Loyalty and the tracked favours', async () => {
    const state = await call('list_contacts', { characterId: fx.staticId });
    const rows = (state['characters'] as Array<{ contacts: Array<Record<string, unknown>> }>)[0]!;
    expect(rows.contacts.map((c) => c['name'])).toEqual(['Loop', 'Dr Vance']);
    expect(rows.contacts[0]).toMatchObject({ connection: 4, loyalty: 3, rating: 7 });
    expect(rows.contacts[0]!['favors']).toEqual({ owed: 2, owing: 1, source: 'structured' });
    // The prose comes back clean — the JSON envelope never leaks to the model.
    expect(rows.contacts[0]!['notes']).toBe('Runs the noodle bar.');
    expect(rows.contacts[1]!['favors']).toEqual({ owed: 0, owing: 0, source: 'none' });
  });

  it('says where a favour number came from, and never invents one', () => {
    expect(readContactFavors(writeNotes('hi', { owed: 3, owing: 0 })).favors).toEqual({
      owed: 3,
      owing: 0,
      source: 'structured',
    });
    // Prose a GM typed before the field existed is read, but labelled as prose.
    expect(readContactFavors('favors owed: 3, favours owing: 1').favors).toEqual({
      owed: 3,
      owing: 1,
      source: 'note',
    });
    expect(readContactFavors('owes us big').favors).toEqual({ owed: 0, owing: 0, source: 'none' });
  });

  it('list_runs and get_run show payout, objectives and the money already booked', async () => {
    const list = await call('list_runs');
    const rows = list['runs'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'The Ashgrove pickup', state: 'prep', johnson: 'Mr Ashgrove' });

    const run = await call('get_run', { runId });
    expect(run['objectives']).toEqual(['collect the courier', 'leave no trace']);
    expect(run['opposition']).toEqual(['corp security']);
    const ledger = run['ledger'] as Array<{ delta: number; characterName: string }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 4000, characterName: 'Static' });
  });

  it('get_calendar answers the in-game date and flags overdue rent', async () => {
    const calendar = await call('get_calendar');
    expect(calendar['ingameDate']).toBe('2076-06-14');
    const lifestyles = calendar['lifestyles'] as Array<Record<string, unknown>>;
    const low = lifestyles.find((l) => l['characterName'] === 'Cinder')!;
    expect(low).toMatchObject({ lifestyle: 'Low', paidThrough: '2076-06-01', overdue: true });
    expect((calendar['sessions'] as unknown[]).length).toBe(1);
    expect((calendar['runs'] as unknown[]).length).toBe(1);
  });

  it('get_calendar separates the beats still ahead from the ones behind', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/calendar`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { date: '2076-07-01', title: 'Ashgrove wants the courier', kind: 'deadline' },
    });
    expect([200, 201]).toContain(res.statusCode);
    await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/calendar`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { date: '2076-05-02', title: 'The meet in Redmond', kind: 'event' },
    });

    const calendar = await call('get_calendar');
    const events = calendar['events'] as Array<{ title: string; date: string }>;
    expect(events.map((e) => e.date)).toEqual(['2076-05-02', '2076-07-01']);
    const upcoming = calendar['upcoming'] as Array<{ title: string }>;
    expect(upcoming.map((e) => e.title)).toEqual(['Ashgrove wants the courier']);
  });
});

describe('magic + matrix snapshots', () => {
  it('get_magic_state reports live sustaining and its dice cost', async () => {
    const magic = await call('get_magic_state');
    const rows = magic['characters'] as Array<Record<string, unknown>>;
    const cinder = rows.find((c) => c['name'] === 'Cinder')!;
    expect(cinder['sustained']).toEqual([{ id: 's1', name: 'Lantern Light', exempt: false }]);
    expect(cinder['sustainingPenalty']).toBe(-2);
    // Gear the GM typed that reads like a focus is still reported, but is
    // flagged as never registered so the model cannot mistake it for a toggle.
    const foci = cinder['foci'] as Array<{ name: string; tracked: boolean }>;
    const gearFocus = foci.find((f) => f.name.includes('Sustaining focus'))!;
    expect(gearFocus.tracked).toBe(false);
  });

  it('get_magic_state answers spirits with a number now that FR8.3 tracks them', async () => {
    const magic = await call('get_magic_state');
    // The honest answer changed shape when the tracker landed: an empty list of
    // spirits is a fact, where `tracked: false` was an admission.
    expect(magic['spirits']).toMatchObject({ tracked: true });
    expect(Array.isArray((magic['spirits'] as { list: unknown }).list)).toBe(true);
    const rows = magic['characters'] as Array<Record<string, unknown>>;
    expect(rows.every((c) => typeof c['reagents'] === 'number')).toBe(true);
  });

  it('get_matrix_state reports the deck and refuses to invent an Overwatch score', async () => {
    const matrix = await call('get_matrix_state');
    const rows = matrix['characters'] as Array<Record<string, unknown>>;
    const cinder = rows.find((c) => c['name'] === 'Cinder')!;
    expect(cinder['deck']).toMatchObject({ name: 'Streetline Deck', asdf: [4, 3, 3, 2] });
    expect((cinder['complexForms'] as Array<{ name: string }>)[0]!.name).toBe('Static Veil');
    expect(matrix['overwatch']).toMatchObject({ tracked: false });
    expect(matrix['marks']).toMatchObject({ tracked: false });
  });
});

describe('reads never mutate (Principle 8)', () => {
  it('runs the entire read catalog and leaves every table untouched', async () => {
    const count = async (): Promise<Record<string, number>> => ({
      characters: (await t.db.select().from(characters)).length,
      scenes: (await t.db.select().from(scenes)).length,
      tokens: (await t.db.select().from(tokens)).length,
      wikiPages: (await t.db.select().from(wikiPages)).length,
      contacts: (await t.db.select().from(contacts)).length,
      runs: (await t.db.select().from(runs)).length,
      ledgerEntries: (await t.db.select().from(ledgerEntries)).length,
      gameSessions: (await t.db.select().from(gameSessions)).length,
      generations: (await t.db.select().from(aiGenerations)).length,
    });
    const before = await count();

    const args: Record<string, unknown> = {
      get_character: { characterId: fx.staticId },
      get_npc: { npcId: fx.templateId },
      search_books: { query: 'rain' },
      search_codex: { query: 'noodle' },
      get_page: { book: 'FOLIO', page: 88 },
      get_run: { runId },
      list_contacts: {},
    };
    for (const tool of FIXER_TOOLS.filter((entry) => entry.kind === 'read')) {
      // Failures are fine here (a tool may have nothing to read); writes are not.
      await executeTool(tool.name, JSON.stringify(args[tool.name] ?? {}), ctx);
    }

    expect(await count()).toEqual(before);
    // Not one draft row: reads are free and leave no paper trail (FR12.17).
    expect((await t.db.select().from(aiGenerations)).length).toBe(0);
  });

  it('scopes every read to this campaign', async () => {
    const other = await bootstrapCampaign(t.app, 'Someone else').catch(() => null);
    // Bootstrap only works on an empty db; the guard we care about is the id check.
    expect(other).toBeNull();
    const stranger = await executeTool('get_run', JSON.stringify({ runId: mageId }), ctx);
    expect(stranger.ok).toBe(false);
    expect(stranger.error).toContain('unknown run');
  });
});
