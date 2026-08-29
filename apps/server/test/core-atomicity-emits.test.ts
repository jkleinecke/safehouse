/**
 * The rest of the §6.2 sweep — the writes that were still a row committed and
 * *then* an event emitted after `core-atomicity-domains.test.ts` closed the
 * paths LIVE-4 actually broke.
 *
 * Same method, deliberately: block the path's event type with a REAL CHECK
 * constraint on `ws_events` (a genuine Postgres error through the real driver,
 * never a stubbed method), perform the operation, then assert BOTH halves — a
 * named error came back AND the domain row did not land. Only the second half
 * distinguishes "atomic" from "broken but loud", which is what LIVE-4 was.
 *
 * Covered here: the sheet surface (`plugins/characters.ts`), codex reveals
 * (`plugins/codex.ts`), the encounter builder (`plugins/generator.ts`),
 * ownership transfer (`plugins/campaigns-admin.ts`), the magic shelf
 * (`services/magic-store.ts`) and the `postLog` fallback arm
 * (`services/rolls.ts`). The Edge debit — the one that spends a resource that
 * does not grow back — lives in `core-atomicity-domains.test.ts` beside the
 * ledger and the damage paths.
 *
 * The last describe is the one that keeps this honest as the code moves: it
 * scans `src/` for any bare `hub.emit(` and allows exactly one, the audited
 * `display.set` exemption, by file and by name.
 *
 * All fiction here is original (G6/§14).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import {
  attachments,
  campaigns,
  characterRevisions,
  characters,
  combatants,
  devices,
  encounters,
  memberships,
  scenes,
  tokens,
  wikiPages,
  wikiRevisions,
} from '@safehouse/db';
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
let second: JoinResult;
let characterId: string;

/** An ORIGINAL runner; no book content anywhere in this file (§14). */
const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Halfstep' },
  attributes: {
    bod: 4,
    agi: 4,
    rea: 4,
    str: 3,
    wil: 4,
    log: 4,
    int: 4,
    cha: 3,
    edg: { max: 4, current: 4 },
    ess: 6,
  },
  skills: [{ id: 'perception', rating: 3, attr: 'int' }],
});

/** An ORIGINAL archetype template for the builder (FR10.1, §14). */
const TEMPLATE = {
  name: 'Warehouse Watchman',
  statblock: {
    weapons: [{ name: 'Stub Pistol', skillId: 'firearms', acc: 4, dv: '6P', ap: 0, modes: ['SS'] }],
    armor: [{ name: 'Work Jacket', rating: 7, worn: true }],
  },
  gen: {
    roleTags: ['guard'],
    tiers: [
      {
        id: 'street',
        label: 'Street',
        attributes: {
          bod: { min: 3, max: 4 },
          agi: { min: 3, max: 4 },
          rea: { min: 2, max: 3 },
          int: { min: 2, max: 3 },
        },
        skills: { firearms: { min: 2, max: 3 } },
        professionalRating: { min: 1, max: 2 },
        loadout: [
          { slot: 'primary', options: ['Stub Pistol'] },
          { slot: 'armor', options: ['Work Jacket'] },
        ],
      },
    ],
  },
} as const;

// --- harness ---------------------------------------------------------------

/**
 * Make every `ws_events` insert of `type` fail the way a real DB fault would.
 * `NOT VALID` skips the backfill scan (the fixture has already emitted most of
 * these types) and still enforces on every INSERT — the only half this needs.
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

async function characterRow() {
  return (await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1))[0]!;
}

async function campaignRow() {
  return (await t.db.select().from(campaigns).where(eq(campaigns.id, boot.campaignId)).limit(1))[0]!;
}

async function countEncounters(): Promise<number> {
  return (await t.db.select({ n: sql<number>`count(*)::int` }).from(encounters))[0]?.n ?? 0;
}

async function countCombatants(): Promise<number> {
  return (await t.db.select({ n: sql<number>`count(*)::int` }).from(combatants))[0]?.n ?? 0;
}

async function countTokens(): Promise<number> {
  return (await t.db.select({ n: sql<number>`count(*)::int` }).from(tokens))[0]?.n ?? 0;
}

/** The magic shelf as it is actually stored, not as a route re-renders it. */
async function magicShelf(): Promise<{
  spirits: Array<{ id: string; services: number }>;
  foci: unknown[];
  reagents: Record<string, number>;
}> {
  const settings = (await campaignRow()).settings as Record<string, unknown>;
  const magic = (settings['magic'] ?? {}) as Record<string, unknown>;
  return {
    spirits: (magic['spirits'] ?? []) as Array<{ id: string; services: number }>,
    foci: (magic['foci'] ?? []) as unknown[],
    reagents: (magic['reagents'] ?? {}) as Record<string, number>,
  };
}

beforeAll(async () => {
  t = await makeTestApp('atomicity-emits');
  boot = await bootstrapCampaign(t.app, 'Half Commit II');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Halfstep');
  second = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kettle');
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Halfstep',
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
// 1. The sheet surface — `plugins/characters.ts` `commit()`
// ---------------------------------------------------------------------------

/**
 * Every mutating route on the characters plugin funnels through one `commit`,
 * so a torn write there is the whole sheet surface at once: the stored sheet
 * moves, no client is told, and every open phone keeps rendering — and rolling
 * from — the old numbers until somebody reloads.
 */
describe('sheet writes are atomic with `sheet.updated`', () => {
  it('does not rename or snapshot a character it cannot announce (FR3.8)', async () => {
    const before = await characterRow();
    const revsBefore = await t.db
      .select()
      .from(characterRevisions)
      .where(eq(characterRevisions.characterId, characterId));
    await blockEventType('sheet.updated');

    const res = await call('PATCH', `/api/characters/${characterId}`, {
      name: 'Halfstep (retired)',
      cause: 'edit',
    });

    expectAppendFailure(res, 'sheet.updated');
    expect((await characterRow()).name).toBe(before.name);
    // The revision joins the same fate on purpose: a snapshot for a change
    // nobody heard about is a rollback target matching no state the table saw.
    const revsAfter = await t.db
      .select()
      .from(characterRevisions)
      .where(eq(characterRevisions.characterId, characterId));
    expect(revsAfter.length).toBe(revsBefore.length);
  });

  it('fills no boxes when `combatant.damaged` cannot be recorded (FR3.4)', async () => {
    const before = await characterRow();
    await blockEventType('combatant.damaged');

    const res = await call('POST', `/api/characters/${characterId}/damage`, {
      monitor: 'physical',
      boxes: 4,
      op: 'damage',
    });

    expectAppendFailure(res, 'combatant.damaged');
    // Filled boxes are wound modifiers; stored with nobody told, the table
    // keeps rolling pools the server has already docked.
    expect((await characterRow()).sheet).toEqual(before.sheet);
  });

  it('spends no Edge when the loud line is what fails (FR2.3)', async () => {
    // The `/edge` route wraps `commit` AND its `log.posted` in one block. If the
    // line escaped the block, this would debit a point with nothing to show for
    // it — the same shape as the Edge-action path, on the sheet's own route.
    const before = await characterRow();
    await blockEventType('log.posted');

    const res = await call('POST', `/api/characters/${characterId}/edge`, {
      op: 'spend',
      amount: 1,
    });

    expectAppendFailure(res, 'log.posted');
    expect((await characterRow()).sheet).toEqual(before.sheet);
  });

  it('writes both halves once the fault clears', async () => {
    const res = await call('PATCH', `/api/characters/${characterId}`, { name: 'Halfstep' });
    expect(res.statusCode).toBe(200);
    expect((await characterRow()).name).toBe('Halfstep');
  });
});

// ---------------------------------------------------------------------------
// 2. Codex reveals — `plugins/codex.ts`
// ---------------------------------------------------------------------------

/**
 * The visibility flip IS the reveal (Principle 4 gates reads on the stored
 * row); the event is how anyone finds out it happened. Split, the GM reveals
 * the sequence of the night, gets no push and no card, and the page is open
 * with nobody at the table knowing to look at it.
 */
describe('codex reveals are atomic with their announcements (FR5.2)', () => {
  let pageId: string;
  let attachmentId: string;

  beforeAll(async () => {
    const made = await gmJson('POST', `/api/campaigns/${boot.campaignId}/wiki`, {
      kind: 'lore',
      title: 'The Tuesday drop',
      contentMd: '## The handoff\n\nA locker, a code, and ten minutes.\n',
      visibility: 'gm',
    });
    pageId = (made['page'] as unknown as { id: string }).id;
    // A handout row straight into the table: the upload path is the files
    // plugin's business, and this suite is about the reveal's transaction.
    const row = (
      await t.db
        .insert(attachments)
        .values({
          campaignId: boot.campaignId,
          kind: 'handout',
          path: 'handouts/locker.png',
          mime: 'image/png',
          size: 128,
          visibility: 'gm',
        })
        .returning()
    )[0]!;
    attachmentId = row.id;
  }, 60_000);

  it('does not open a page it cannot announce', async () => {
    const revsBefore = await t.db
      .select()
      .from(wikiRevisions)
      .where(eq(wikiRevisions.wikiPageId, pageId));
    await blockEventType('wiki.revealed');

    const res = await call('POST', `/api/wiki/${pageId}/reveal`, { visibility: 'public' });

    expectAppendFailure(res, 'wiki.revealed');
    const row = (await t.db.select().from(wikiPages).where(eq(wikiPages.id, pageId)).limit(1))[0]!;
    expect(row.visibility).toBe('gm');
    const revsAfter = await t.db
      .select()
      .from(wikiRevisions)
      .where(eq(wikiRevisions.wikiPageId, pageId));
    expect(revsAfter.length).toBe(revsBefore.length);
  });

  it('does not open a handout it cannot announce', async () => {
    await blockEventType('handout.revealed');

    const res = await call('POST', `/api/handouts/${attachmentId}/reveal`, {
      visibility: 'public',
      pageId,
    });

    expectAppendFailure(res, 'handout.revealed');
    // A flip with no frame is an image the table may now open and will never
    // be shown — the reveal has no other channel.
    const row = (
      await t.db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1)
    )[0]!;
    expect(row.visibility).toBe('gm');
  });

  it('reveals both, page and handout, once the fault clears', async () => {
    const revealed = await gmJson('POST', `/api/wiki/${pageId}/reveal`, { visibility: 'public' });
    expect((revealed['revealed'] as unknown as { visibility: string }).visibility).toBe('public');
    const opened = await call('POST', `/api/handouts/${attachmentId}/reveal`, {
      visibility: 'public',
    });
    expect(opened.statusCode).toBe(200);
  });

  it('a silent flip still writes — `announce: false` emits nothing to block', async () => {
    // The transaction must not turn a housekeeping flip into a 500 just
    // because the type it would have used is unavailable.
    await blockEventType('wiki.revealed');
    const res = await call('POST', `/api/wiki/${pageId}/reveal`, {
      visibility: 'gm',
      announce: false,
    });
    expect(res.statusCode).toBe(200);
    const row = (await t.db.select().from(wikiPages).where(eq(wikiPages.id, pageId)).limit(1))[0]!;
    expect(row.visibility).toBe('gm');
  });
});

// ---------------------------------------------------------------------------
// 3. The encounter builder — `plugins/generator.ts`
// ---------------------------------------------------------------------------

/**
 * A build is the widest write in the server: an encounter row, N combatants
 * and N staged tokens. A half-commit leaves the GM a fight that exists in the
 * database, is drawn on nobody's screen, and gets silently built a second time.
 */
describe('an encounter build is atomic with its announcements (FR10.4)', () => {
  let templateId: string;
  let sceneId: string;

  beforeAll(async () => {
    const made = await gmJson(
      'POST',
      `/api/campaigns/${boot.campaignId}/npc-templates`,
      TEMPLATE as unknown as Record<string, unknown>,
    );
    templateId = (made['template'] as unknown as { id: string }).id;
    const row = (
      await t.db.insert(scenes).values({ campaignId: boot.campaignId, name: 'Loading dock' }).returning()
    )[0]!;
    sceneId = row.id;
  }, 60_000);

  it('builds nothing when `encounter.updated` cannot be recorded', async () => {
    const encountersBefore = await countEncounters();
    const combatantsBefore = await countCombatants();
    await blockEventType('encounter.updated');

    const res = await call('POST', '/api/encounters/build', {
      campaignId: boot.campaignId,
      name: 'Dock watch',
      parts: [{ templateId, tierId: 'street', count: 2, seed: 991 }],
    });

    expectAppendFailure(res, 'encounter.updated');
    expect(await countEncounters()).toBe(encountersBefore);
    expect(await countCombatants()).toBe(combatantsBefore);
  });

  it('stages no tokens when `token.added` is what fails', async () => {
    // The staged tokens are the second announcement of the same block. Blocking
    // them proves the encounter and the combatants roll back too — a fight with
    // no figures on the map is not a smaller problem, it is a stranger one.
    const encountersBefore = await countEncounters();
    const tokensBefore = await countTokens();
    await blockEventType('token.added');

    const res = await call('POST', '/api/encounters/build', {
      campaignId: boot.campaignId,
      sceneId,
      name: 'Dock watch (staged)',
      parts: [{ templateId, tierId: 'street', count: 2, seed: 991 }],
    });

    expectAppendFailure(res, 'token.added');
    expect(await countEncounters()).toBe(encountersBefore);
    expect(await countTokens()).toBe(tokensBefore);
  });

  it('builds the whole fight once the fault clears', async () => {
    const built = await gmJson('POST', '/api/encounters/build', {
      campaignId: boot.campaignId,
      sceneId,
      name: 'Dock watch',
      parts: [{ templateId, tierId: 'street', count: 2, seed: 991 }],
    });
    expect((built['combatants'] as unknown as unknown[]).length).toBe(2);
    expect((built['tokens'] as unknown as unknown[]).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Who is the GM — `plugins/campaigns-admin.ts`
// ---------------------------------------------------------------------------

describe('ownership changes are atomic with their log line', () => {
  it('does not hand the table over on a transfer it cannot record', async () => {
    const before = await campaignRow();
    await blockEventType('log.posted');

    const res = await call('POST', `/api/campaigns/${boot.campaignId}/transfer-ownership`, {
      toUserId: player.user.id,
    });

    expectAppendFailure(res, 'log.posted');
    // Five writes answer one question — who is the GM. All five roll back, or
    // the campaign has two GMs, or none, and no line saying when it changed.
    expect((await campaignRow()).gmUserId).toBe(before.gmUserId);
    const seats = await t.db
      .select()
      .from(memberships)
      .where(eq(memberships.campaignId, boot.campaignId));
    expect(seats.find((m) => m.userId === boot.gmUserId)?.role).toBe('gm');
    expect(seats.find((m) => m.userId === player.user.id)?.role).toBe('player');
    // The device tokens are the half that actually gates the API.
    const gmDevices = await t.db
      .select()
      .from(devices)
      .where(eq(devices.campaignId, boot.campaignId));
    expect(gmDevices.filter((d) => d.role === 'gm').map((d) => d.userId)).toEqual([boot.gmUserId]);
  });

  it('does not claim a sheet for a phone it cannot tell', async () => {
    const before = await characterRow();
    await blockEventType('sheet.updated');

    const res = await call('PATCH', `/api/characters/${characterId}/owner`, {
      ownerUserId: second.user.id,
    });

    expectAppendFailure(res, 'sheet.updated');
    // `gm_owner` rolls and the "my character" list both key off this column: a
    // silent claim hands a player a sheet whose rolls they cannot see.
    expect((await characterRow()).ownerUserId).toBe(before.ownerUserId);
  });

  it('transfers cleanly once the fault clears, and hands it straight back', async () => {
    const moved = await gmJson('POST', `/api/campaigns/${boot.campaignId}/transfer-ownership`, {
      toUserId: player.user.id,
    });
    expect(moved['gmUserId'] as unknown as string).toBe(player.user.id);
    expect((await campaignRow()).gmUserId).toBe(player.user.id);

    // Back, so the rest of the suite still has a GM token that works.
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/transfer-ownership`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { toUserId: boot.gmUserId },
    });
    expect(res.statusCode).toBe(200);
    expect((await campaignRow()).gmUserId).toBe(boot.gmUserId);
  });
});

// ---------------------------------------------------------------------------
// 5. The magic shelf — `services/magic-store.ts`
// ---------------------------------------------------------------------------

/**
 * Spirits, foci and reagents live in `campaigns.settings.magic`, so the "row"
 * here is a JSONB subtree — which makes the torn shape easy to miss and no
 * less real: a counter that moved in the database with no frame on the wire,
 * and every open client drawing the old number until a refetch.
 *
 * This was the last emit in the sweep still sequenced by its callers
 * (`writeMagicState` then `announceMagic`, two statements). `commitMagicState`
 * fused them; these tests are what says so.
 */
describe('magic shelf writes are atomic with `magic.updated` (FR8.3/FR8.4)', () => {
  it('summons no spirit it cannot announce', async () => {
    const before = await magicShelf();
    await blockEventType('magic.updated');

    const res = await call('POST', `/api/campaigns/${boot.campaignId}/magic/spirits`, {
      characterId,
      spiritType: 'watcher',
      force: 3,
      services: 3,
    });

    expectAppendFailure(res, 'magic.updated');
    expect((await magicShelf()).spirits.length).toBe(before.spirits.length);
  });

  it('spends no service it cannot announce', async () => {
    const summoned = await gmJson('POST', `/api/campaigns/${boot.campaignId}/magic/spirits`, {
      characterId,
      spiritType: 'watcher',
      force: 3,
      services: 3,
    });
    const spiritId = (summoned['spirit'] as unknown as { id: string }).id;
    const before = (await magicShelf()).spirits.find((s) => s.id === spiritId)!;
    expect(before.services).toBe(3);

    await blockEventType('magic.updated');
    const res = await call(
      'POST',
      `/api/campaigns/${boot.campaignId}/magic/spirits/${spiritId}/services`,
      { op: 'spend', count: 1 },
    );

    expectAppendFailure(res, 'magic.updated');
    // A service is a spent resource the table counts down out loud; a silent
    // decrement is the argument two turns later.
    expect((await magicShelf()).spirits.find((s) => s.id === spiritId)!.services).toBe(3);
  });

  it('does not move the reagent counter it cannot announce', async () => {
    await gmJson('POST', `/api/characters/${characterId}/reagents`, { op: 'restock', amount: 10 });
    const before = (await magicShelf()).reagents[characterId];
    expect(before).toBe(10);

    await blockEventType('magic.updated');
    const res = await call('POST', `/api/characters/${characterId}/reagents`, {
      op: 'spend',
      amount: 4,
    });

    expectAppendFailure(res, 'magic.updated');
    expect((await magicShelf()).reagents[characterId]).toBe(10);
  });

  it('adds no focus it cannot announce', async () => {
    const before = await magicShelf();
    await blockEventType('magic.updated');

    const res = await call('POST', `/api/characters/${characterId}/foci`, {
      name: 'Chipped signet',
      kind: 'power focus',
      force: 2,
      bonded: true,
      active: true,
    });

    expectAppendFailure(res, 'magic.updated');
    // An active bonded focus emits real `Modifier` rows: a stored one nobody
    // heard about is a pool that moves on the server and nowhere else.
    expect((await magicShelf()).foci.length).toBe(before.foci.length);
  });

  it('writes both halves once the fault clears', async () => {
    const added = await gmJson('POST', `/api/characters/${characterId}/foci`, {
      name: 'Chipped signet',
      force: 2,
      bonded: true,
    });
    expect((added['focus'] as unknown as { name: string }).name).toBe('Chipped signet');
    expect((await magicShelf()).foci.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. The `postLog` fallback arm — `services/rolls.ts`
// ---------------------------------------------------------------------------

describe('`postLog` opens its own transaction when handed no `tx`', () => {
  it('surfaces a named failure rather than drizzle SQL, and stores nothing', async () => {
    // `atomicIn` with no `tx` is the arm every plain log line takes. It has no
    // domain row of its own — the assertion that matters is that the caller
    // gets the hub's named error (so a caller that later grows a domain write
    // beside its log line inherits the guarantee instead of a bare `emit`).
    await blockEventType('log.posted');

    const res = await call('POST', `/api/campaigns/${boot.campaignId}/log`, {
      kind: 'talk',
      text: 'the fixer is late again',
    });

    expectAppendFailure(res, 'log.posted');
    await unblockEvents();
    const body = await gmJson(
      'GET',
      `/api/campaigns/${boot.campaignId}/log?types=log.posted&limit=200`,
    );
    const events = body['events'] as unknown as { payload: Record<string, unknown> }[];
    expect(events.some((e) => String(e.payload['text']).includes('fixer is late'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. The audited exemption, pinned from the other side
// ---------------------------------------------------------------------------

/**
 * Every test above proves one path atomic. None of them can prove there is no
 * *other* path — a new route with a bare `hub.emit` after a write would sail
 * past all of them. So this reads the source.
 *
 * Exactly one bare `hub.emit(` is allowed, by file and by name: the
 * `display.set` command in `plugins/scenes.ts`, which has no domain row at all
 * — the event IS the state, read back with `latestEventOfType`. Should a
 * `display_state` row ever appear, this test is the thing that fails and says
 * so. Any other hit means somebody wrote a half-commit; use `hub.atomic` (or
 * `atomicIn` when a `tx` may already be open) instead.
 */
describe('the §6.2 sweep stays swept', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  /** Every bare `hub.emit(` in `src/`, as `path:line` plus its neighbourhood. */
  function bareEmits(): Array<{ at: string; near: string }> {
    const hits: Array<{ at: string; near: string }> = [];
    for (const file of walk(srcRoot)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\bhub\.emit\(/.test(line)) return;
        // Prose about the rule is not a use of it: docblocks and `//` comments
        // name `hub.emit` all over this codebase, and should keep being able to.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        hits.push({
          at: `${relative(srcRoot, file).replace(/\\/g, '/')}:${i + 1}`,
          near: lines.slice(i, i + 4).join('\n'),
        });
      });
    }
    return hits;
  }

  it('leaves exactly one bare `hub.emit` in the whole server, and it is the audited one', () => {
    const hits = bareEmits();
    // A failure prints the offending file:line, which is the whole point. The
    // line NUMBER is not pinned — only the file and what it emits — so an edit
    // above it does not turn into a false alarm.
    expect(hits.map((h) => h.at.replace(/:\d+$/, ''))).toEqual(['plugins/scenes.ts']);
    expect(hits[0]!.near).toContain("type: 'display.updated'");
  });

  it('names the exemption in the code, so the next reader is not left guessing', () => {
    const source = readFileSync(join(srcRoot, 'plugins', 'scenes.ts'), 'utf8');
    expect(source).toContain('AUDITED EXEMPTION');
    expect(source).toContain('display.updated');
  });
});
