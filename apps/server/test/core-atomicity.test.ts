/**
 * Row-and-event atomicity (DESIGN.md §11; BUILD_CONVENTIONS "Server
 * architecture").
 *
 * The bug this pins down: `insert into rolls` committed as its own statement
 * and `hub.emit` then ran as a second one, so any failure on the event append
 * returned 500 to the client while leaving the roll durable in the database —
 * a roll nobody was told about, absent from the shared log for ever, yet
 * present in `GET /api/campaigns/:id/rolls`. Half a write is worse than none.
 *
 * The forced failure is a CHECK constraint on `ws_events`, i.e. a real
 * Postgres error arriving through the real driver, not a stubbed method: that
 * is the only way to prove the whole path (transaction, rollback, error
 * envelope, log line) behaves, and it is also the shape the field report had
 * (`Failed query: insert into "ws_events" …` with the cause thrown away).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { characters, rolls, wsEvents } from '@safehouse/db';
import { describeDbError, Hub } from '../src/hub.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let characterId: string;

const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Static' },
  attributes: {
    bod: 4,
    agi: 4,
    rea: 4,
    str: 3,
    wil: 3,
    log: 3,
    int: 5,
    cha: 3,
    edg: { max: 3, current: 3 },
    ess: 6,
  },
  skills: [{ id: 'perception', rating: 3, attr: 'int' }],
});

/** Make every `ws_events` insert of `type` fail, the way a real DB fault would. */
async function blockEventType(type: string): Promise<void> {
  await t.db.execute(
    sql`alter table ws_events add constraint atomicity_probe check (type <> ${sql.raw(`'${type}'`)})`,
  );
}

async function unblockEvents(): Promise<void> {
  await t.db.execute(sql`alter table ws_events drop constraint if exists atomicity_probe`);
}

async function countRolls(): Promise<number> {
  const rows = await t.db.select({ n: sql<number>`count(*)::int` }).from(rolls);
  return rows[0]?.n ?? 0;
}

async function countEvents(type: string): Promise<number> {
  const rows = await t.db
    .select({ n: sql<number>`count(*)::int` })
    .from(wsEvents)
    .where(eq(wsEvents.type, type));
  return rows[0]?.n ?? 0;
}

async function currentEdge(): Promise<number> {
  const row = (
    await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0]!;
  return (row.sheet as SheetV1).attributes.edg.current;
}

function post(url: string, token: string, payload: Record<string, unknown>) {
  return t.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
}

beforeAll(async () => {
  t = await makeTestApp('atomicity');
  boot = await bootstrapCampaign(t.app, 'Atomic Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Static',
        sheet: SHEET,
      })
      .returning()
  )[0]!;
  characterId = row.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

afterEach(async () => {
  await unblockEvents();
});

describe('roll + event write atomically', () => {
  it('leaves no orphan roll when the event append fails', async () => {
    const rollsBefore = await countRolls();
    await blockEventType('roll.created');

    const res = await post('/api/rolls', boot.gmToken, {
      kind: 'simple',
      pool: 6,
      breakdown: [{ label: 'test', value: 6 }],
      visibility: 'public',
      actor: { gm: true },
    });

    expect(res.statusCode).toBe(500);
    // Fail at the APPEND, not earlier — otherwise "no orphan row" would be
    // vacuously true because the request never reached the insert at all.
    expect((res.json() as { error: { code: string } }).error.code).toBe('event_append_failed');
    // The row the old code committed and never announced.
    expect(await countRolls()).toBe(rollsBefore);
    expect(await countEvents('roll.created')).toBe(0);
  });

  it('answers with a named error, not a raw SQL string', async () => {
    await blockEventType('roll.created');
    const res = await post('/api/rolls', boot.gmToken, {
      kind: 'simple',
      pool: 6,
      breakdown: [{ label: 'test', value: 6 }],
      visibility: 'public',
      actor: { gm: true },
    });
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('event_append_failed');
    expect(body.error.message).toContain('roll.created');
    // The report's 500 body was drizzle's statement text; that must not be the
    // client's error message any more.
    expect(body.error.message).not.toContain('insert into');
  });

  it('does not debit Edge for a roll that could not be recorded', async () => {
    const edgeBefore = await currentEdge();
    const rollsBefore = await countRolls();
    await blockEventType('roll.created');

    const res = await post('/api/rolls', player.token, {
      pool: 8,
      edge: 'push_pre',
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });

    expect(res.statusCode).toBe(500);
    expect(await currentEdge()).toBe(edgeBefore);
    expect(await countRolls()).toBe(rollsBefore);
    expect(await countEvents('log.posted')).toBe(0);
  });

  it('still writes both once the fault clears', async () => {
    const res = await post('/api/rolls', boot.gmToken, {
      kind: 'simple',
      pool: 6,
      breakdown: [{ label: 'test', value: 6 }],
      visibility: 'public',
      actor: { gm: true },
    });
    expect(res.statusCode).toBe(201);
    expect(await countRolls()).toBe(1);
    expect(await countEvents('roll.created')).toBe(1);
  });
});

describe('Hub.atomic', () => {
  it('rolls the domain row back with its event, and broadcasts neither', async () => {
    const sent: string[] = [];
    const hub = new Hub(t.db);
    const socket = {
      readyState: 1,
      send: (data: string) => sent.push(data),
      close: () => {},
      on: () => undefined,
    };
    hub.joinRoom(socket, boot.campaignId, { userId: boot.gmUserId, role: 'gm' });
    sent.length = 0;

    const rollsBefore = await countRolls();
    await blockEventType('atomicity.probe');
    await expect(
      hub.atomic(boot.campaignId, async (tx) => {
        await tx.db.insert(rolls).values({
          campaignId: boot.campaignId,
          sessionId: null,
          actor: { gm: true },
          kind: 'simple',
          request: { kind: 'simple', pool: 1, breakdown: [], visibility: 'public', actor: { gm: true } },
          faces: [3],
          hits: 0,
          ones: 0,
          glitch: 'none',
          limitedHits: 0,
          visibility: 'public',
        });
        await tx.emit({ type: 'atomicity.probe', payload: {} });
      }),
    ).rejects.toThrow(/atomicity\.probe/);

    expect(await countRolls()).toBe(rollsBefore);
    expect(sent).toHaveLength(0);
  });

  it('broadcasts queued events only after the commit', async () => {
    const order: string[] = [];
    const hub = new Hub(t.db);
    const socket = {
      readyState: 1,
      send: (data: string) => order.push(`sent:${(JSON.parse(data) as { type: string }).type}`),
      close: () => {},
      on: () => undefined,
    };
    hub.joinRoom(socket, boot.campaignId, { userId: boot.gmUserId, role: 'gm' });
    order.length = 0;

    await hub.atomic(boot.campaignId, async (tx) => {
      await tx.emit({ type: 'atomicity.first', payload: {} });
      order.push('emitted:first');
      await tx.emit({ type: 'atomicity.second', payload: {} });
      order.push('emitted:second');
    });

    expect(order).toEqual([
      'emitted:first',
      'emitted:second',
      'sent:atomicity.first',
      'sent:atomicity.second',
    ]);
  });
});

describe('event-append failures are diagnosable', () => {
  it('logs the underlying db error with the campaign and event type', async () => {
    const logged: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    const hub = new Hub(t.db, {
      error: (obj: unknown, msg?: string) => {
        logged.push({ obj: obj as Record<string, unknown>, ...(msg ? { msg } : {}) });
      },
      debug: () => {},
    });

    await blockEventType('atomicity.probe');
    await expect(hub.emit(boot.campaignId, { type: 'atomicity.probe', payload: {} })).rejects.toThrow();

    expect(logged).toHaveLength(1);
    const entry = logged[0]!;
    expect(entry.obj['campaignId']).toBe(boot.campaignId);
    expect(entry.obj['eventType']).toBe('atomicity.probe');
    // SQLSTATE 23514 = check_violation. Before this, only drizzle's "Failed
    // query: insert into ws_events …" reached the log, which named the
    // statement but never the fault.
    expect(entry.obj['dbCode']).toBe('23514');
    expect(String(entry.obj['dbMessage'])).toContain('atomicity_probe');
    expect(entry.msg).toContain('atomicity.probe');
    expect(entry.msg).toContain(boot.campaignId);
  });

  it('describeDbError digs the cause out of a driver wrapper', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (id)=(2) already exists.',
      constraint: 'ws_events_pkey',
      table: 'ws_events',
      routine: '_bt_check_unique',
    });
    const wrapper = new Error('Failed query: insert into "ws_events" ("id", …) values (default, $1)');
    (wrapper as Error & { cause?: unknown }).cause = cause;

    expect(describeDbError(wrapper)).toEqual({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      detail: 'Key (id)=(2) already exists.',
      constraint: 'ws_events_pkey',
      table: 'ws_events',
    });
  });

  it('describeDbError survives a plain error and a cycle', () => {
    expect(describeDbError(new Error('boom')).message).toBe('boom');
    const a = new Error('a') as Error & { cause?: unknown };
    a.cause = a;
    expect(describeDbError(a).message).toBe('a');
    expect(describeDbError(undefined).message).toBe('unknown error');
  });
});
