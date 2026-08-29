/**
 * Row-and-event atomicity for the REMAINING domain writes — the second half of
 * the LIVE-4 fix (`docs/BUILD_REPORT.md` §6.2).
 *
 * `core-atomicity.test.ts` pins the roll path and `Hub.atomic` itself; this
 * file holds the same guarantee over the writes that used to commit a row and
 * *then* emit — ledger, encounter damage, the campaign clock, scene/fog/token.
 *
 * Method, per path: make that path's event type fail the way a real database
 * fault would (a CHECK constraint on `ws_events` — a genuine Postgres error
 * through the real driver, never a stubbed method), perform the operation, and
 * assert BOTH halves: the caller got a named error, AND the domain row did not
 * land. The second is the one that matters — without it "the request failed"
 * is compatible with the bug, because LIVE-4's roll returned 500 *and*
 * persisted.
 *
 * Sibling: `core-atomicity-emits.test.ts` finishes the sweep (sheets, codex,
 * generator, ownership, the magic shelf, the `postLog` fallback) and pins the
 * one audited exemption by scanning `src/` for any other bare `hub.emit`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import {
  campaigns,
  characters,
  combatants,
  ledgerEntries,
  rolls,
  scenes,
  tokens,
} from '@safehouse/db';
import { EncountersService } from '../src/services/encounters.js';
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

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

/** Original fiction only (G6/§14). */
const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Ledger' },
  attributes: {
    bod: 4,
    agi: 4,
    rea: 4,
    str: 3,
    wil: 3,
    log: 4,
    int: 4,
    cha: 3,
    edg: { max: 3, current: 3 },
    ess: 6,
  },
  skills: [{ id: 'perception', rating: 3, attr: 'int' }],
});

// --- harness ---------------------------------------------------------------

/**
 * Make every `ws_events` insert of `type` fail, the way a real DB fault would.
 *
 * `NOT VALID` matters here and not in `core-atomicity.test.ts`: this suite
 * blocks types its own fixture has ALREADY emitted (activating a scene, adding
 * the combatant about to be shot), and a validating CHECK refuses to be
 * created when existing rows violate it. `NOT VALID` skips the backfill scan
 * and still enforces on every INSERT — the only half this needs.
 */
async function blockEventType(type: string): Promise<void> {
  await t.db.execute(
    sql`alter table ws_events add constraint atomicity_probe check (type <> ${sql.raw(`'${type}'`)}) not valid`,
  );
}

async function unblockEvents(): Promise<void> {
  await t.db.execute(sql`alter table ws_events drop constraint if exists atomicity_probe`);
}

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  token = boot.gmToken,
) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

async function gmJson(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, never>> {
  const res = await call(method, url, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as Record<string, never>;
}

/** The 500 envelope the hub raises when an event could not be recorded. */
function expectAppendFailure(
  res: { statusCode: number; json: () => unknown },
  eventType: string,
): void {
  expect(res.statusCode).toBe(500);
  const body = res.json() as { error: { code: string; message: string } };
  expect(body.error.code).toBe('event_append_failed');
  expect(body.error.message).toContain(eventType);
  // The field report's 500 body was drizzle's raw statement; never again.
  expect(body.error.message).not.toContain('insert into');
}

async function countRows(what: 'ledger' | 'combatants' | 'rolls'): Promise<number> {
  const table = what === 'ledger' ? ledgerEntries : what === 'combatants' ? combatants : rolls;
  const rows = await t.db.select({ n: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.n ?? 0;
}

async function campaignRow() {
  return (await t.db.select().from(campaigns).where(eq(campaigns.id, boot.campaignId)).limit(1))[0]!;
}

async function sceneRow(id: string) {
  return (await t.db.select().from(scenes).where(eq(scenes.id, id)).limit(1))[0]!;
}

async function tokenRow(id: string) {
  return (await t.db.select().from(tokens).where(eq(tokens.id, id)).limit(1))[0]!;
}

async function combatantRow(id: string) {
  return (await t.db.select().from(combatants).where(eq(combatants.id, id)).limit(1))[0]!;
}

/** Edge as the stored sheet has it — the row a player's phone renders from. */
async function edgeOnSheet(): Promise<{ max: number; current: number }> {
  const row = (
    await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0]!;
  return (row.sheet as SheetV1).attributes.edg;
}

/** The FR2.3 announcements: `log.posted` lines whose `kind` is `edge`. */
async function edgeLogLines(): Promise<string[]> {
  const body = await gmJson(
    'GET',
    `/api/campaigns/${boot.campaignId}/log?types=log.posted&limit=200`,
  );
  const events = body['events'] as unknown as { payload: Record<string, unknown> }[];
  return events.filter((e) => e.payload['kind'] === 'edge').map((e) => String(e.payload['text']));
}

beforeAll(async () => {
  t = await makeTestApp('atomicity-domains');
  boot = await bootstrapCampaign(t.app, 'Half Commit');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Ledger');
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Ledger',
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

// ---------------------------------------------------------------------------
// 1. The ledger — money (highest value: the number players argue about)
// ---------------------------------------------------------------------------

describe('ledger writes are atomic with `ledger.changed`', () => {
  it('leaves no orphan entry when the event append fails', async () => {
    const before = await countRows('ledger');
    await blockEventType('ledger.changed');

    const res = await call('POST', `/api/characters/${characterId}/ledger`, {
      currency: 'nuyen',
      delta: 12_000,
      reason: 'milk run payout',
    });

    expectAppendFailure(res, 'ledger.changed');
    // The row the old code committed: a payout in the database that no sheet
    // was ever told about, and no reload would ever explain.
    expect(await countRows('ledger')).toBe(before);
  });

  it('does not move the balance a client was never told about', async () => {
    const paid = await gmJson('POST', `/api/characters/${characterId}/ledger`, {
      currency: 'nuyen',
      delta: 5_000,
      reason: 'advance',
      state: 'approved',
    });
    const balanceBefore = (paid['balances'] as unknown as { nuyen: number }).nuyen;

    await blockEventType('ledger.changed');
    const res = await call('POST', `/api/characters/${characterId}/ledger`, {
      currency: 'nuyen',
      delta: -1_000,
      reason: 'bribe',
      state: 'approved',
    });
    expectAppendFailure(res, 'ledger.changed');

    await unblockEvents();
    const after = (await gmJson('GET', `/api/characters/${characterId}/ledger`))[
      'balances'
    ] as unknown as { nuyen: number };
    expect(after.nuyen).toBe(balanceBefore);
  });

  it('does not settle a pending entry whose settlement could not be announced', async () => {
    const created = await gmJson('POST', `/api/characters/${characterId}/ledger`, {
      currency: 'karma',
      delta: 4,
      reason: 'survived the night',
      state: 'pending',
    });
    const entryId = (created['entry'] as unknown as { id: string; state: string }).id;

    await blockEventType('ledger.changed');
    const res = await call('POST', `/api/ledger/${entryId}/approve`);
    expectAppendFailure(res, 'ledger.changed');

    // `approved` with nobody told is the worst outcome: the GM's settle-up
    // screen still shows it pending and approves it a second time.
    const row = (
      await t.db.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1)
    )[0]!;
    expect(row.state).toBe('pending');
    expect(row.approvedBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Encounter damage — monitors
// ---------------------------------------------------------------------------

describe('encounter damage is atomic with its events', () => {
  let encounterId: string;
  let targetId: string;

  beforeAll(async () => {
    const enc = await gmJson('POST', `/api/campaigns/${boot.campaignId}/encounters`, {
      name: 'Loading bay',
    });
    encounterId = (enc['encounter'] as unknown as { id: string }).id;
    const added = await gmJson('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'manual',
      name: 'Dockhand',
      initBase: 8,
      initDice: 1,
      initScore: 12,
      visibility: 'public',
      monitors: MONITORS,
      professionalRating: 2,
    });
    targetId = (added['combatant'] as unknown as { id: string }).id;
  }, 60_000);

  it('fills no boxes when `combatant.damaged` cannot be recorded', async () => {
    const before = await combatantRow(targetId);
    await blockEventType('combatant.damaged');

    const res = await call('POST', `/api/encounters/${encounterId}/damage`, {
      targetId,
      boxes: 6,
      track: 'physical',
    });

    expectAppendFailure(res, 'combatant.damaged');
    const after = await combatantRow(targetId);
    expect(after.monitors).toEqual(before.monitors);
    expect(after.initScore).toBe(before.initScore);
    // No undo snapshot either — an undo offered for damage that never landed
    // would hand the GM a button that silently heals.
    expect((after.copilot as { lastDamage?: unknown }).lastDamage).toBeUndefined();
  });

  it('rolls the damage back when the tracker refresh is what fails', async () => {
    // `encounter.updated` is emitted by `emitUpdated`, which used to run as its
    // own statement AFTER the row was already durable. Blocking it proves the
    // refresh joined the damage transaction rather than trailing it.
    const before = await combatantRow(targetId);
    await blockEventType('encounter.updated');

    const res = await call('POST', `/api/encounters/${encounterId}/damage`, {
      targetId,
      boxes: 4,
      track: 'stun',
    });

    expectAppendFailure(res, 'encounter.updated');
    expect((await combatantRow(targetId)).monitors).toEqual(before.monitors);
  });

  it('does not undo damage it cannot announce', async () => {
    const applied = await gmJson('POST', `/api/encounters/${encounterId}/damage`, {
      targetId,
      boxes: 3,
      track: 'physical',
    });
    const damaged = (applied['combatant'] as unknown as { monitors: unknown }).monitors;

    await blockEventType('combatant.damaged');
    const res = await call('POST', `/api/encounters/${encounterId}/damage/undo`, {
      combatantId: targetId,
    });
    expectAppendFailure(res, 'combatant.damaged');

    // Still hurt, and the undo snapshot is still there to be retried.
    const row = await combatantRow(targetId);
    expect(row.monitors).toEqual(damaged);
    expect((row.copilot as { lastDamage?: unknown }).lastDamage).toBeDefined();
  });

  it('adds no combatant when the roster refresh cannot be recorded', async () => {
    const before = await countRows('combatants');
    await blockEventType('encounter.updated');

    const res = await call('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'manual',
      name: 'Ghost',
      initBase: 8,
      initDice: 1,
      visibility: 'gm',
      monitors: MONITORS,
    });

    expectAppendFailure(res, 'encounter.updated');
    expect(await countRows('combatants')).toBe(before);
  });

  it('persists no copilot roll it cannot put on the log (G5)', async () => {
    const service = new EncountersService(t.db, t.app.hub);
    const before = await countRows('rolls');
    await blockEventType('roll.created');

    await expect(
      service.recordRoll({
        campaignId: boot.campaignId,
        combatantId: targetId,
        kind: 'attack',
        request: { kind: 'simple', pool: 5, breakdown: [], visibility: 'gm', actor: {} },
        result: { faces: [5, 2, 6, 1, 4], hits: 2, ones: 1, glitch: 'none', limitedHits: 2 },
        visibility: 'gm',
        label: 'Dockhand — Attack',
      }),
    ).rejects.toThrow(/roll\.created/);

    // The dice are authoritative and immutable (G5): a row nobody was told
    // about is a roll the log can never show and the session count disagrees
    // with — LIVE-4 exactly, on the copilot's half of the record.
    expect(await countRows('rolls')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. The campaign clock
// ---------------------------------------------------------------------------

describe('the clock advance is atomic with `clock.advanced`', () => {
  it('does not move the in-game date it cannot announce (FR5.7)', async () => {
    await gmJson('PATCH', `/api/campaigns/${boot.campaignId}`, { ingameDate: '2081-03-04' });
    await blockEventType('clock.advanced');

    const res = await call('PATCH', `/api/campaigns/${boot.campaignId}`, {
      ingameDate: '2081-04-01',
    });

    expectAppendFailure(res, 'clock.advanced');
    // Downtime, lifestyle and every "how long ago" in the codex count from
    // this field; a silent jump is a campaign that disagrees with its own log.
    expect((await campaignRow()).ingameDate).toBe('2081-03-04');
  });

  it('still writes an edit that emits nothing', async () => {
    // A settings-only patch raises no event, so the blocked type is irrelevant
    // to it — the transaction must not turn an unrelated edit into a 500.
    await blockEventType('clock.advanced');
    const res = await call('PATCH', `/api/campaigns/${boot.campaignId}`, {
      settings: { houseRuleGlitchOnOnes: true },
    });
    expect(res.statusCode).toBe(200);
    expect((await campaignRow()).ingameDate).toBe('2081-03-04');
  });
});

// ---------------------------------------------------------------------------
// 4. Scene, fog and tokens
// ---------------------------------------------------------------------------

describe('scene, fog and token writes are atomic with their events', () => {
  let sceneId: string;
  let spareSceneId: string;
  let regionId: string;
  let tokenId: string;

  beforeAll(async () => {
    const made = await gmJson('POST', `/api/campaigns/${boot.campaignId}/scenes`, {
      name: 'Rooftop',
    });
    sceneId = (made['scene'] as unknown as { id: string }).id;
    const spare = await gmJson('POST', `/api/campaigns/${boot.campaignId}/scenes`, {
      name: 'Stairwell',
    });
    spareSceneId = (spare['scene'] as unknown as { id: string }).id;
    await gmJson('POST', `/api/scenes/${sceneId}/activate`);

    const defined = await gmJson('POST', `/api/scenes/${sceneId}/fog`, {
      op: 'define',
      region: {
        name: 'service stair',
        polygon: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
      },
    });
    regionId = (defined['fog'] as unknown as { regions: Array<{ id: string }> }).regions[0]!.id;

    const token = await gmJson('POST', `/api/scenes/${sceneId}/tokens`, {
      source: 'prop',
      name: 'crate',
      x: 3,
      y: 3,
    });
    tokenId = (token['token'] as unknown as { id: string }).id;
  }, 60_000);

  it('does not move a token it cannot announce (FR9.5)', async () => {
    const before = await tokenRow(tokenId);
    await blockEventType('token.moved');

    const res = await call('PATCH', `/api/tokens/${tokenId}`, { x: 19, y: 21 });

    expectAppendFailure(res, 'token.moved');
    // The server is authoritative for position: a stored move nobody heard
    // leaves every other screen — the TV included — drawing the old square.
    const after = await tokenRow(tokenId);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('adds no token when `token.added` cannot be recorded', async () => {
    await blockEventType('token.added');
    const blocked = await call('POST', `/api/scenes/${sceneId}/tokens`, {
      source: 'prop',
      name: 'phantom',
      x: 1,
      y: 1,
    });
    expectAppendFailure(blocked, 'token.added');
    const rows = await t.db.select().from(tokens).where(eq(tokens.sceneId, sceneId));
    expect(rows.map((r) => r.name)).not.toContain('phantom');
  });

  it('does not reveal fog it cannot announce (FR9.13, Principle 4)', async () => {
    const before = await sceneRow(sceneId);
    await blockEventType('fog.updated');

    const res = await call('POST', `/api/scenes/${sceneId}/fog`, { op: 'reveal', regionId });

    expectAppendFailure(res, 'fog.updated');
    // A stored reveal with no event leaves players fogged out of a room the
    // server now calls open; a stored `hide` with no event is worse — the
    // client keeps drawing geometry the server has taken back.
    expect((await sceneRow(sceneId)).fog).toEqual(before.fog);
  });

  it('does not hand the table a scene it cannot announce (FR9.1)', async () => {
    await blockEventType('scene.activated');

    const res = await call('POST', `/api/scenes/${spareSceneId}/activate`);

    expectAppendFailure(res, 'scene.activated');
    // Activation is demote-then-promote: BOTH halves must roll back, or the
    // campaign ends up with no active scene at all.
    expect((await sceneRow(sceneId)).state).toBe('active');
    expect((await sceneRow(spareSceneId)).state).toBe('draft');
  });

  it('stages no combatants when the staging cannot be announced (FR9.10)', async () => {
    await gmJson('POST', `/api/scenes/${sceneId}/tokens`, {
      source: 'character',
      sourceId: characterId,
      x: 2,
      y: 2,
    });
    const before = await countRows('combatants');
    await blockEventType('encounter.updated');

    const res = await call('POST', `/api/scenes/${sceneId}/stage-encounter`, {
      name: 'Rooftop ambush',
    });

    expectAppendFailure(res, 'encounter.updated');
    // The encounter row and every combatant derived from a token go together:
    // half a staged fight is one the GM has to spot is wrong mid-scene.
    expect(await countRows('combatants')).toBe(before);
  });

  it('still writes both halves once the fault clears', async () => {
    const staged = await gmJson('POST', `/api/scenes/${sceneId}/stage-encounter`, {
      name: 'Rooftop ambush',
    });
    expect((staged['combatantIds'] as unknown as string[]).length).toBeGreaterThan(0);

    const moved = await call('PATCH', `/api/tokens/${tokenId}`, { x: 19, y: 21 });
    expect(moved.statusCode).toBe(200);
    expect((await tokenRow(tokenId)).x).toBe(19);

    const revealed = await gmJson('POST', `/api/scenes/${sceneId}/fog`, { op: 'reveal', regionId });
    expect((revealed['fog'] as unknown as { revealed: string[] }).revealed).toContain(regionId);
  });
});

// ---------------------------------------------------------------------------
// 5. The Edge debit (services/rolls-edge.ts) — the resource that does not
//    grow back, and the highest-cost half-commit left after §6.2's first pass
// ---------------------------------------------------------------------------

/**
 * Seize the Initiative and Blitz spend a point of Edge and say so out loud
 * (FR2.3: "Edge spend decrements the character's current Edge *with* a log
 * entry"). Three rows used to be three statements: the sheet, the
 * `sheet.updated` frame that redraws every open phone, and the log line.
 *
 * Both torn shapes cost the table something no reload repairs. A debit with no
 * frame is a point gone from the row while the player's own phone still shows
 * it — so it gets spent twice. A debit with no log line is a point gone with
 * nothing to point at — so the player says it never happened, and they are
 * arguing from the only record there is.
 *
 * The NPC arm is deliberately NOT covered here: copilot Edge lives on the
 * combatant row and its only writer is `EncountersService.updateCombatant`,
 * which takes no `tx`, so an NPC's spend is still two transactions. That is
 * named in `spend()`'s docblock rather than silently tested around.
 */
describe('an Edge spend is atomic with the sheet AND its log line (FR2.3)', () => {
  let encounterId: string;

  beforeAll(async () => {
    const enc = await gmJson('POST', `/api/campaigns/${boot.campaignId}/encounters`, {
      name: 'Alley behind the noodle stand',
    });
    encounterId = (enc['encounter'] as unknown as { id: string }).id;
    // Source `character`: the payer is the PC's SHEET, which is the arm that
    // costs a player something when it tears.
    await gmJson('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'character',
      sourceId: characterId,
      initScore: 11,
    });
    await gmJson('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'manual',
      name: 'Doorway watcher',
      initBase: 9,
      initDice: 2,
      initScore: 22,
      visibility: 'public',
      monitors: MONITORS,
    });
  }, 60_000);

  /** The combatant the PC drives, looked up fresh (the roster can grow). */
  async function pcCombatantId(): Promise<string> {
    const enc = await gmJson('GET', `/api/encounters/${encounterId}`);
    const list = enc['combatants'] as unknown as Array<{ id: string; sourceId: string | null }>;
    return list.find((c) => c.sourceId === characterId)!.id;
  }

  it('costs no Edge when `sheet.updated` cannot be recorded', async () => {
    const before = await edgeOnSheet();
    const linesBefore = await edgeLogLines();
    await blockEventType('sheet.updated');

    const res = await call('POST', '/api/edge/seize-initiative', {
      combatantId: await pcCombatantId(),
    });

    expectAppendFailure(res, 'sheet.updated');
    // The whole point: the point of Edge is still on the sheet.
    expect(await edgeOnSheet()).toEqual(before);
    // …and nothing claimed it was spent, either.
    await unblockEvents();
    expect(await edgeLogLines()).toEqual(linesBefore);
  });

  it('costs no Edge when the FR2.3 log line is what fails', async () => {
    // This is the half the first §6.2 pass left open: the debit was already
    // inside a transaction, but `postLog` opened a SECOND one after it, so a
    // fault here used to leave the point spent and unannounced.
    const before = await edgeOnSheet();
    await blockEventType('log.posted');

    const res = await call('POST', '/api/edge/blitz', { combatantId: await pcCombatantId() });

    expectAppendFailure(res, 'log.posted');
    expect(await edgeOnSheet()).toEqual(before);
  });

  it('spends exactly one point, with its line, once the fault clears', async () => {
    const before = await edgeOnSheet();
    const linesBefore = await edgeLogLines();

    const res = await call('POST', '/api/edge/seize-initiative', {
      combatantId: await pcCombatantId(),
    });
    expect(res.statusCode).toBe(200);

    const after = await edgeOnSheet();
    expect(after.current).toBe(before.current - 1);
    const lines = await edgeLogLines();
    expect(lines.length).toBe(linesBefore.length + 1);
    expect(lines.some((l) => l.includes('spends 1 Edge'))).toBe(true);
    // The line quotes what is LEFT, so it has to agree with the row it rode in
    // with — that agreement is the thing the transaction buys.
    expect(lines.some((l) => l.includes(`(${after.current}/${after.max} left)`))).toBe(true);
  });
});
