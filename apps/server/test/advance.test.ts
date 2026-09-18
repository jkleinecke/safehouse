/**
 * Career-mode advancement through the ledger (FR3.7, docs/CHARGEN.md §8.5):
 * `POST /api/characters/:id/advance` writes a pending Karma entry carrying
 * the change, and the ledger's approve applies it to the sheet as a revision
 * — once, in the same transaction, and only while it still fits the sheet.
 *
 * What is pinned: who may ask (the owner or the GM; never another player, an
 * observer or a display); the Karma of every kind of spend against the
 * Karma Advancement Table (SR5 p. 107) as the entry's delta; that the
 * projected balance must pay; that a pending advance changes nothing until
 * approved, applies exactly once, and never on a rejection; that a spend the
 * sheet has moved past is refused at approval with the entry left pending;
 * the `advanced` revision; the events; the GM's own advance approved in one
 * step; and the character DTO's build summary.
 *
 * Every name is invented (§14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { KarmaSpendInput, LedgerEntry, SheetV1Input } from '@safehouse/contracts';
import { characters, wsEvents } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let owner: JoinResult;
let other: JoinResult;
let observer: JoinResult;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

type Balances = { karma: number; nuyen: number; pending: { karma: number; nuyen: number } };
interface AdvanceOut {
  entry: LedgerEntry;
  balances: Balances;
  quote: { label: string; cost: number; training: { steps: unknown[]; total: { amount: number; unit: string } | null } };
  revision?: number;
}

function runnerSheet(over: Partial<SheetV1Input> = {}): SheetV1Input {
  return {
    v: 1,
    identity: { alias: 'Gutterlight', metatype: 'human' },
    attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 3, edg: { max: 3, current: 3 } },
    skills: [
      { id: 'pistols', rating: 3, attr: 'agi' },
      { id: 'con', rating: 2, attr: 'cha' },
    ],
    knowledge: [{ name: 'Safehouses', category: 'street', rating: 2 }],
    languages: [
      { name: 'English', rating: 0, native: true },
      { name: 'Cantonese', rating: 1, native: false },
    ],
    ...over,
  };
}

async function post(token: string, url: string, payload?: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), ...(payload !== undefined ? { payload: payload as never } : {}) });
}

async function get<T>(token: string, url: string): Promise<T> {
  const res = await t.app.inject({ method: 'GET', url, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

/** A character owned by `owner`, with `karma` approved on its ledger. */
async function character(name: string, sheet: SheetV1Input, karma: number): Promise<string> {
  const created = await post(boot.gmToken, '/api/characters', { campaignId: boot.campaignId, name, ownerUserId: owner.user.id, sheet });
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as { character: { id: string } }).character.id;
  if (karma > 0) {
    const award = await post(boot.gmToken, `/api/characters/${id}/ledger`, { currency: 'karma', delta: karma, reason: 'Run pay' });
    expect(award.statusCode).toBe(201);
  }
  return id;
}

async function advance(token: string, id: string, spend: KarmaSpendInput, extra: Record<string, unknown> = {}) {
  return post(token, `/api/characters/${id}/advance`, { spend, ...extra });
}

async function sheetOf(id: string) {
  return (await get<{ sheet: { attributes: Record<string, unknown>; skills: { id: string; rating: number }[] } }>(boot.gmToken, `/api/characters/${id}`)).sheet;
}

async function revisions(id: string) {
  return (await get<{ revisions: { seq: number; cause: string }[] }>(boot.gmToken, `/api/characters/${id}/revisions`)).revisions;
}

beforeAll(async () => {
  t = await makeTestApp('advance');
  boot = await bootstrapCampaign(t.app, 'Tin Harbour');
  owner = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Wren');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Stray');
  observer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'Lookout');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('who may ask', () => {
  let id: string;
  beforeAll(async () => {
    id = await character('Gutterlight', runnerSheet(), 50);
  });

  it('refuses another player and an observer, and answers 404 for a malformed or unknown id', async () => {
    const spend = { kind: 'attribute', id: 'agi', from: 4, to: 5 } as const;
    expect((await advance(other.token, id, spend)).statusCode).toBe(403);
    expect((await advance(observer.token, id, spend)).statusCode).toBe(403);
    expect((await advance(owner.token, 'not-a-uuid', spend)).statusCode).toBe(404);
    expect((await advance(owner.token, '00000000-0000-4000-8000-000000000000', spend)).statusCode).toBe(404);
  });

  it('refuses a body that is not a spend', async () => {
    const res = await post(owner.token, `/api/characters/${id}/advance`, { spend: { kind: 'attribute', id: 'luck', from: 1, to: 2 } });
    expect(res.statusCode).toBe(400);
  });

  it("lets the owner ask, and the request waits on the GM: the balance projects, the sheet does not move", async () => {
    const res = await advance(owner.token, id, { kind: 'attribute', id: 'agi', from: 4, to: 5 }, { state: 'approved' });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as AdvanceOut;
    expect(out.entry).toMatchObject({ state: 'pending', currency: 'karma', delta: -25, reason: 'Raise Agility 4 → 5 · 25 Karma' });
    expect(out.entry.advance).toMatchObject({ kind: 'advance', cost: 25, label: 'Raise Agility 4 → 5', spend: { id: 'agi', from: 4, to: 5 } });
    expect(out.quote.training.total).toEqual({ amount: 5, unit: 'week' });
    expect(out.revision).toBeUndefined();
    expect(out.balances).toMatchObject({ karma: 50, pending: { karma: 25 } });
    expect((await sheetOf(id)).attributes['agi']).toBe(4);
  });

  it('refuses asking for the same raise while it is waiting', async () => {
    const res = await advance(owner.token, id, { kind: 'attribute', id: 'agi', from: 4, to: 5 });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; details: { refusals: { code: string }[] } } };
    expect(body.error.code).toBe('advance_refused');
    expect(body.error.details.refusals.map((r) => r.code)).toEqual(['advance-pending']);
  });
});

describe('the price of each kind of spend (SR5 p.107)', () => {
  it('writes the Karma Advancement Table as the entry delta', async () => {
    const runner = await character('Ledgerline', runnerSheet(), 200);
    const mystic = await character(
      'Saltwick',
      runnerSheet({
        identity: { alias: 'Saltwick', metatype: 'elf' },
        attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 5, edg: { max: 2, current: 2 }, mag: 5 },
        awakening: { kind: 'mysticAdept', powerPoints: 2 },
        spells: [{ name: 'Mend' }],
      }),
      50,
    );
    const techno = await character(
      'Hexline',
      runnerSheet({
        identity: { alias: 'Hexline', metatype: 'human' },
        attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 4, int: 4, cha: 3, edg: { max: 3, current: 3 }, res: 4 },
        awakening: { kind: 'technomancer' },
      }),
      50,
    );
    const cases: [string, KarmaSpendInput, number, string][] = [
      [runner, { kind: 'attribute', id: 'log', from: 3, to: 4 }, 20, 'Raise Logic 3 → 4'],
      [runner, { kind: 'skill', id: 'con', from: 2, to: 3 }, 6, 'Raise Con 2 → 3'],
      [runner, { kind: 'skill', id: 'blades', from: 0, to: 1 }, 2, 'Learn Blades at 1'],
      [runner, { kind: 'group', id: 'athletics', from: 0, to: 1 }, 5, 'Learn Athletics group at 1'],
      [runner, { kind: 'knowledge', name: 'Safehouses', from: 2, to: 3 }, 3, 'Raise Safehouses 2 → 3'],
      [runner, { kind: 'knowledge', name: 'Corp Law', category: 'academic', from: 0, to: 1 }, 1, 'Learn Corp Law at 1'],
      [runner, { kind: 'language', name: 'Cantonese', from: 1, to: 2 }, 2, 'Raise Cantonese 1 → 2'],
      [runner, { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }, 7, 'Specialise Pistols: Revolvers'],
      [mystic, { kind: 'spell', name: 'Flash', category: 'combat' }, 5, 'Learn spell Flash'],
      [techno, { kind: 'form', name: 'Static Veil' }, 4, 'Learn complex form Static Veil'],
    ];
    for (const [id, spend, cost, label] of cases) {
      const res = await advance(owner.token, id, spend);
      expect(res.statusCode, `${label}: ${res.body}`).toBe(201);
      const out = res.json() as AdvanceOut;
      expect(out.entry.delta, label).toBe(-cost);
      expect(out.entry.advance?.label).toBe(label);
      expect(out.entry.reason).toBe(`${label} · ${cost} Karma`);
    }
    // A mystic adept's power points are a creation purchase (p.69); in play
    // there is no Karma price for one (p.279).
    const points = await advance(owner.token, mystic, { kind: 'powerPoint', count: 1 });
    expect(points.statusCode).toBe(409);
    expect((points.json() as { error: { code: string; details: { refusals: { code: string }[] } } }).error).toMatchObject({
      code: 'advance_refused',
      details: { refusals: [{ code: 'advance-not-in-play' }] },
    });
    // The ledger read carries the change with each entry.
    const ledger = await get<{ entries: LedgerEntry[] }>(owner.token, `/api/characters/${runner}/ledger?state=pending`);
    expect(ledger.entries).toHaveLength(8);
    expect(ledger.entries.every((e) => e.advance?.kind === 'advance')).toBe(true);
  });

  it('refuses what the rules refuse in play, with the sentence', async () => {
    const id = await character('Slate', runnerSheet(), 100);
    const res = await advance(owner.token, id, { kind: 'spell', name: 'Flash', category: 'combat' });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: 'advance_refused', message: 'Only magicians, mystic adepts and sorcerers learn spells.' });
    const stale = await advance(owner.token, id, { kind: 'skill', id: 'pistols', from: 2, to: 3 });
    expect((stale.json() as { error: { details: { refusals: { code: string }[] } } }).error.details.refusals[0]?.code).toBe('advance-stale');
  });
});

describe('a crafted request', () => {
  it('answers a rating no ladder reaches at once, rather than pricing its way there', async () => {
    const id = await character('Overflow', runnerSheet(), 100);
    const started = Date.now();
    const res = await advance(owner.token, id, { kind: 'skill', id: 'pistols', from: 3, to: 1_000_000_000 });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('bad_request');
    expect(Date.now() - started).toBeLessThan(2_000);
    // Nothing was written on the way to the refusal.
    const ledger = await get<{ entries: LedgerEntry[] }>(owner.token, `/api/characters/${id}/ledger`);
    expect(ledger.entries.filter((e) => e.advance)).toHaveLength(0);
  });

  it('refuses free text no ledger line should carry, and keeps the entry it writes readable', async () => {
    const id = await character('Longhand', runnerSheet(), 100);
    const huge = await advance(owner.token, id, { kind: 'skill', id: 'exotic-ranged', target: 'A'.repeat(400_000), from: 0, to: 1 });
    expect(huge.statusCode).toBe(400);
    // What does fit is written whole: the entry reads back with its change.
    const target = 'B'.repeat(200);
    const ok = await advance(owner.token, id, { kind: 'skill', id: 'exotic-ranged', target, from: 0, to: 1 });
    expect(ok.statusCode, ok.body).toBe(201);
    const out = ok.json() as AdvanceOut;
    expect(out.entry.reason.length).toBeLessThanOrEqual(500);
    expect(out.entry.advance?.spend).toMatchObject({ kind: 'skill', target });
  });
});

describe('Karma must be there', () => {
  it('refuses a spend the approved-plus-pending balance cannot pay, and writes nothing', async () => {
    const id = await character('Thinwire', runnerSheet(), 30);
    expect((await advance(owner.token, id, { kind: 'attribute', id: 'agi', from: 4, to: 5 })).statusCode).toBe(201); // 25 pending
    const res = await advance(owner.token, id, { kind: 'skill', id: 'pistols', from: 3, to: 4 }); // 8, only 5 projected
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
      code: 'insufficient_karma',
      details: { cost: 8, available: 5 },
    });
    const ledger = await get<{ entries: LedgerEntry[] }>(owner.token, `/api/characters/${id}/ledger`);
    expect(ledger.entries.filter((e) => e.advance)).toHaveLength(1);
  });
});

describe('settling an advance', () => {
  it('applies a pending advance exactly once on approval, as an `advanced` revision, with its events', async () => {
    const id = await character('Needlepoint', runnerSheet(), 40);
    const before = await revisions(id);
    const asked = (await advance(owner.token, id, { kind: 'skill', id: 'pistols', from: 3, to: 4 })).json() as AdvanceOut;

    const approved = await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    const out = approved.json() as { entry: LedgerEntry; balances: Balances; revision: number };
    expect(out.entry.state).toBe('approved');
    expect(out.balances.karma).toBe(32);
    expect((await sheetOf(id)).skills.find((s) => s.id === 'pistols')?.rating).toBe(4);

    const after = await revisions(id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ seq: out.revision, cause: 'advanced' });
    const snapshot = await get<{ sheet: { skills: { id: string; rating: number }[] } }>(boot.gmToken, `/api/characters/${id}/revisions/${out.revision}`);
    expect(snapshot.sheet.skills.find((s) => s.id === 'pistols')?.rating).toBe(4);

    // Approving again is refused and applies nothing a second time.
    const again = await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`);
    expect(again.statusCode).toBe(409);
    expect(await revisions(id)).toHaveLength(after.length);

    const events = await t.db.select().from(wsEvents).where(eq(wsEvents.campaignId, boot.campaignId));
    const updated = events.filter((e) => e.type === 'sheet.updated' && (e.payload as { characterId?: string }).characterId === id);
    const advanced = updated.filter((e) => (e.payload as { cause?: string }).cause === 'advanced');
    expect(advanced).toHaveLength(1);
    expect(advanced[0]?.payload).toMatchObject({ revision: out.revision, entryId: asked.entry.id, advance: 'Raise Pistols 3 → 4' });
    const settled = events.filter(
      (e) => e.type === 'ledger.changed' && (e.payload as { entry?: { id?: string }; settled?: string }).entry?.id === asked.entry.id,
    );
    expect(settled.map((e) => (e.payload as { settled?: string }).settled ?? 'created')).toEqual(['created', 'approved']);
  });

  it('never applies a rejected advance', async () => {
    const id = await character('Cold Iron', runnerSheet(), 40);
    const before = await revisions(id);
    const asked = (await advance(owner.token, id, { kind: 'attribute', id: 'str', from: 3, to: 4 })).json() as AdvanceOut;
    const rejected = await post(boot.gmToken, `/api/ledger/${asked.entry.id}/reject`);
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as { entry: LedgerEntry; balances: Balances }).balances).toMatchObject({ karma: 40, pending: { karma: 40 } });
    expect((await sheetOf(id)).attributes['str']).toBe(3);
    expect(await revisions(id)).toHaveLength(before.length);
    // Rejected is settled: it cannot be approved into the sheet afterwards.
    expect((await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`)).statusCode).toBe(409);
    expect((await sheetOf(id)).attributes['str']).toBe(3);
  });

  it('refuses approval when the sheet has moved past the spend, leaving the entry pending', async () => {
    const id = await character('Backwash', runnerSheet(), 40);
    const asked = (await advance(owner.token, id, { kind: 'attribute', id: 'agi', from: 4, to: 5 })).json() as AdvanceOut;
    // The GM raises Agility by hand in the meantime.
    const current = await get<{ sheet: { attributes: Record<string, unknown> } }>(boot.gmToken, `/api/characters/${id}`);
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${id}`,
      headers: auth(boot.gmToken),
      payload: { sheet: { attributes: { ...current.sheet.attributes, agi: 5 } } },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const before = await revisions(id);

    const approve = await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`);
    expect(approve.statusCode).toBe(409);
    const error = (approve.json() as { error: { code: string; message: string; details: { refusals: { code: string }[] } } }).error;
    expect(error.code).toBe('advance_stale');
    expect(error.message).toBe('Raise Agility 4 → 5 no longer applies: Agility is 5 now, not 4.');
    expect(error.details.refusals.map((r) => r.code)).toEqual(['advance-stale']);

    const ledger = await get<{ entries: LedgerEntry[]; balances: Balances }>(owner.token, `/api/characters/${id}/ledger`);
    expect(ledger.entries.find((e) => e.id === asked.entry.id)?.state).toBe('pending');
    expect(ledger.balances.karma).toBe(40);
    expect(await revisions(id)).toHaveLength(before.length);
    expect((await post(boot.gmToken, `/api/ledger/${asked.entry.id}/reject`)).statusCode).toBe(200);
  });

  it("refuses approval the approved Karma cannot pay (a pending award is not Karma yet)", async () => {
    const id = await character('Paperweight', runnerSheet(), 0);
    const award = await post(boot.gmToken, `/api/characters/${id}/ledger`, { currency: 'karma', delta: 30, reason: 'Pending pay', state: 'pending' });
    expect(award.statusCode).toBe(201);
    const asked = (await advance(owner.token, id, { kind: 'attribute', id: 'agi', from: 4, to: 5 })).json() as AdvanceOut;
    const approve = await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`);
    expect(approve.statusCode).toBe(409);
    expect((approve.json() as { error: { code: string } }).error.code).toBe('insufficient_karma');
    const awardId = (award.json() as { entry: { id: string } }).entry.id;
    expect((await post(boot.gmToken, `/api/ledger/${awardId}/approve`)).statusCode).toBe(200);
    expect((await post(boot.gmToken, `/api/ledger/${asked.entry.id}/approve`)).statusCode).toBe(200);
    expect((await sheetOf(id)).attributes['agi']).toBe(5);
  });

  it("approves and applies the GM's own advance in one step, or leaves it pending when asked", async () => {
    const id = await character('Brass Hollow', runnerSheet(), 40);
    const res = await advance(boot.gmToken, id, { kind: 'attribute', id: 'wil', from: 3, to: 4 });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as AdvanceOut;
    expect(out.entry.state).toBe('approved');
    expect(out.revision).toEqual(expect.any(Number));
    expect(out.balances.karma).toBe(20);
    expect((await sheetOf(id)).attributes['wil']).toBe(4);
    expect((await revisions(id)).at(-1)?.cause).toBe('advanced');

    const held = (await advance(boot.gmToken, id, { kind: 'attribute', id: 'log', from: 3, to: 4 }, { state: 'pending' })).json() as AdvanceOut;
    expect(held.entry.state).toBe('pending');
    expect((await sheetOf(id)).attributes['log']).toBe(3);
  });
});

describe('the character DTO says how the runner was built', () => {
  it('is null for a character typed in, and a summary for one the builder approved', async () => {
    const id = await character('Tallow', runnerSheet(), 0);
    expect((await get<{ build: unknown }>(owner.token, `/api/characters/${id}`)).build).toBeNull();
    await t.db
      .update(characters)
      .set({
        build: {
          v: 1,
          method: 'priority',
          level: 'experienced',
          table: 'sr5',
          priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
          metatype: 'troll',
          magic: { kind: 'mundane' },
          identity: { alias: 'Tallow' },
        },
      })
      .where(and(eq(characters.id, id), eq(characters.campaignId, boot.campaignId)));
    const dto = await get<{ build: unknown }>(owner.token, `/api/characters/${id}`);
    expect(dto.build).toEqual({
      method: 'priority',
      level: 'experienced',
      table: 'sr5',
      priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
      metatype: 'troll',
      magic: 'mundane',
    });
  });
});
