/**
 * The native builder's routes (FR3.9 P2, docs/CHARGEN.md §8.5): the campaign's
 * chargen settings, drafts and their autosave, the review loop, and the one
 * transaction that turns an approved build into a character.
 *
 * What these hold the server to, beyond "the route answers":
 *
 * - **Who may touch a build.** Every route is walked for the GM, the owning
 *   player, another player at the same table and an observer. A player can
 *   never approve their own build, set a decision, or smuggle `approvals` or
 *   `state` into an autosave — the writable schema strips them, and the row's
 *   columns stay what the GM left.
 * - **The engine's word, not the client's.** Submit refuses with the errors
 *   `validate` raises over the stored record; approve refuses while any error
 *   or undecided GM approval stands, and a denial is an error.
 * - **Approval is one fate.** The character row with its build as history,
 *   revision 1, the contacts, the magic shelf (spirits, sprites, foci), the
 *   starting-nuyen roll on the record, the opening ledger entries and both
 *   events land together — and when the last event is refused by a real CHECK
 *   constraint, none of it does and the build is still waiting.
 * - **A draft is not a runner.** The party roster never lists one.
 *
 * Every alias, contact and quality label is invented (§14); the builds are
 * `builds-fixtures.ts`, copied from the engine's own baselines.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  BuildApproveResultSchema,
  MAX_APPROVAL_DECISIONS,
  MAX_CHARGEN_BOOKS,
  type BuildWritable,
  type CharacterBuild,
  type Issue,
} from '@safehouse/contracts';
import {
  builds,
  campaigns,
  characterRevisions,
  characters,
  contacts,
  ledgerEntries,
  rolls,
  wsEvents,
} from '@safehouse/db';
import type { AuthContext } from '../src/services/auth.js';
import { approveBuild, groupedNumber, openingReasons, requireBuild, submitBuild } from '../src/services/builds.js';
import { getRollService } from '../src/services/rolls.js';
import { boundMage, cleanBuild, registeringTechnomancer, troubledSamurai, vary } from './builds-fixtures.js';
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
let owner: JoinResult;
let other: JoinResult;
let observer: JoinResult;
let display: JoinResult;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const fixedFace = (face: number) => () => (face - 1) / 6 + 1e-9;
const NOT_A_UUID = 'not-a-uuid';
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown) {
  return t.app.inject({
    method,
    url,
    headers: auth(token),
    ...(payload !== undefined ? { payload: payload as never } : {}),
  });
}

interface Dto {
  id: string;
  campaignId: string;
  ownerUserId: string;
  state: string;
  build: CharacterBuild;
  notes: string | null;
  characterId: string | null;
  updatedAt: string;
}

interface ErrorBody {
  error: { code: string; message: string; details?: { issues?: Issue[] } };
}

/** The writable half of a fixture: what an autosave carries. */
function writable(b: CharacterBuild): BuildWritable {
  const { approvals: _a, notes: _n, returnedStep: _r, state: _s, ...rest } = b;
  void _a;
  void _n;
  void _r;
  void _s;
  return rest;
}

/** A draft for `who`, filled with `b` and (optionally) submitted. */
async function draft(b: CharacterBuild, who: JoinResult = owner, submit = false): Promise<Dto> {
  const created = await call('POST', `/api/campaigns/${boot.campaignId}/builds`, who.token, {});
  expect(created.statusCode).toBe(201);
  const id = (created.json() as Dto).id;
  const saved = await call('PATCH', `/api/builds/${id}`, who.token, { build: writable(b) });
  expect(saved.statusCode).toBe(200);
  if (!submit) return saved.json() as Dto;
  const submitted = await call('POST', `/api/builds/${id}/submit`, who.token, {});
  expect(submitted.statusCode).toBe(200);
  return submitted.json() as Dto;
}

async function issuesOf(id: string, token = boot.gmToken): Promise<Issue[]> {
  const res = await call('GET', `/api/builds/${id}/check`, token);
  expect(res.statusCode).toBe(200);
  return (res.json() as { issues: Issue[] }).issues;
}

async function maxEventId(): Promise<number> {
  const rows = await t.db
    .select({ id: sql<number>`coalesce(max(${wsEvents.id}), 0)::int` })
    .from(wsEvents)
    .where(eq(wsEvents.campaignId, boot.campaignId));
  return rows[0]!.id;
}

async function eventsAfter(id: number) {
  return t.db
    .select()
    .from(wsEvents)
    .where(and(eq(wsEvents.campaignId, boot.campaignId), gt(wsEvents.id, id)));
}

async function rosterNames(token = boot.gmToken): Promise<string[]> {
  const res = await call('GET', `/api/campaigns/${boot.campaignId}/characters`, token);
  expect(res.statusCode).toBe(200);
  return (res.json() as { characters: Array<{ name: string }> }).characters.map((c) => c.name);
}

beforeAll(async () => {
  t = await makeTestApp('builds');
  boot = await bootstrapCampaign(t.app);
  owner = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Moth');
  observer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'Lantern');
  display = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Wall Screen');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

// ---------------------------------------------------------------------------
// Campaign chargen settings
// ---------------------------------------------------------------------------

describe('GET/PUT /api/campaigns/:id/chargen', () => {
  const url = () => `/api/campaigns/${boot.campaignId}/chargen`;

  it('lets every member read the defaults, and only the GM write', async () => {
    for (const token of [boot.gmToken, owner.token, observer.token, display.token]) {
      const res = await call('GET', url(), token);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { settings: { level: string; maxAvailability: number } }).settings).toMatchObject({
        level: 'experienced',
        maxAvailability: 12,
      });
    }
    for (const token of [owner.token, observer.token, display.token]) {
      expect((await call('PUT', url(), token, { aiDrafts: true })).statusCode).toBe(403);
    }
    expect((await call('GET', `/api/campaigns/${NOT_A_UUID}/chargen`, boot.gmToken)).statusCode).toBe(404);
    expect((await call('GET', `/api/campaigns/${UNKNOWN_UUID}/chargen`, boot.gmToken)).statusCode).toBe(403);
    expect((await call('PUT', url(), boot.gmToken, { maxAvailability: -1 })).statusCode).toBe(400);
  });

  it('tells the table the rules moved, without persisting anything to replay', async () => {
    // Without this, a phone mid-build kept the level, the caps and the book
    // list the GM had just changed until something else made it refetch.
    const seen: Array<{ type: string; payload: unknown; visibility?: string }> = [];
    const real = t.app.hub.emitEphemeral.bind(t.app.hub);
    t.app.hub.emitEphemeral = ((campaignId: string, input: { type: string; payload: unknown; visibility?: string }) => {
      seen.push(input);
      real(campaignId, input as never);
    }) as typeof t.app.hub.emitEphemeral;
    const before = (await t.db.select({ id: wsEvents.id }).from(wsEvents)).length;
    try {
      expect((await call('PUT', url(), boot.gmToken, { level: 'street' })).statusCode).toBe(200);
      expect((await call('PUT', url(), owner.token, { level: 'prime' })).statusCode).toBe(403);
    } finally {
      // Back to the defaults the rest of this file builds against, then the
      // real hub — so the reset's own ping is counted too.
      await call('PUT', url(), boot.gmToken, { level: 'experienced' });
      t.app.hub.emitEphemeral = real as typeof t.app.hub.emitEphemeral;
    }
    const pings = seen.filter((s) => s.type === 'chargen.updated');
    // One for the GM's write, one for the reset — and none for the player's
    // refusal, which wrote nothing.
    expect(pings).toHaveLength(2);
    expect(pings[0]!.payload).toMatchObject({ campaignId: boot.campaignId, level: 'street', table: 'sr5' });
    expect((pings[0]!.payload as { by: string }).by).toBe(boot.gmUserId);
    // Ephemeral: the replay log is untouched.
    expect((await t.db.select({ id: wsEvents.id }).from(wsEvents)).length).toBe(before);
  });

  it('bounds the list of books a GM can store', async () => {
    const codes = (n: number) => Array.from({ length: n }, (_, i) => `BK${i}`);
    expect((await call('PUT', url(), boot.gmToken, { books: codes(MAX_CHARGEN_BOOKS + 1) })).statusCode).toBe(400);
    const most = await call('PUT', url(), boot.gmToken, { books: codes(MAX_CHARGEN_BOOKS) });
    expect(most.statusCode).toBe(200);
    expect((most.json() as { settings: { books: string[] } }).settings.books).toHaveLength(MAX_CHARGEN_BOOKS);
    expect((await call('PUT', url(), boot.gmToken, { books: [] })).statusCode).toBe(200);
  });

  it('merges a partial write onto what is stored and never resets an omitted field', async () => {
    const first = await call('PUT', url(), boot.gmToken, {
      books: ['SR5', 'RF'],
      allowSumToTen: true,
      maxAvailability: 14,
    });
    expect(first.statusCode).toBe(200);

    const toggle = await call('PUT', url(), boot.gmToken, { levelQualityCaps: false });
    expect((toggle.json() as { settings: Record<string, unknown> }).settings).toMatchObject({
      level: 'experienced',
      books: ['SR5', 'RF'],
      allowSumToTen: true,
      maxAvailability: 14,
      levelQualityCaps: false,
    });

    // A level change resets only the preset caps; books and toggles stay.
    const street = await call('PUT', url(), boot.gmToken, { level: 'street' });
    expect((street.json() as { settings: Record<string, unknown> }).settings).toMatchObject({
      level: 'street',
      maxAvailability: 10,
      maxDeviceRating: 4,
      books: ['SR5', 'RF'],
      allowSumToTen: true,
      levelQualityCaps: false,
    });

    // Stored under `chargen` only; a player reads it through the member route.
    const row = await t.db.select({ settings: campaigns.settings }).from(campaigns).where(eq(campaigns.id, boot.campaignId));
    expect((row[0]!.settings as Record<string, { level: string }>)['chargen']?.level).toBe('street');
    const seen = await call('GET', url(), owner.token);
    expect((seen.json() as { settings: { level: string } }).settings.level).toBe('street');

    // Back to the defaults the rest of this file builds against.
    const reset = await call('PUT', url(), boot.gmToken, {
      level: 'experienced',
      books: [],
      allowSumToTen: false,
      levelQualityCaps: true,
    });
    expect((reset.json() as { settings: Record<string, unknown> }).settings).toMatchObject({
      level: 'experienced',
      maxAvailability: 12,
      books: [],
      levelQualityCaps: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

describe('POST/GET /api/campaigns/:id/builds', () => {
  const url = () => `/api/campaigns/${boot.campaignId}/builds`;

  it('starts a draft for a player or the GM, at the campaign level, with the alias and concept', async () => {
    const res = await call('POST', url(), owner.token, { alias: 'Soft Static', conceptId: 'face' });
    expect(res.statusCode).toBe(201);
    const dto = res.json() as Dto;
    expect(dto).toMatchObject({ state: 'draft', ownerUserId: owner.user.id, campaignId: boot.campaignId, notes: null });
    expect(dto.build.level).toBe('experienced');
    expect(dto.build.identity).toMatchObject({ alias: 'Soft Static', concept: 'face' });
    expect(dto.build.priorities.metatype).not.toBeNull();
    expect(dto.build.approvals).toEqual({});

    const blank = await call('POST', url(), owner.token);
    expect(blank.statusCode).toBe(201);
    expect((blank.json() as Dto).build.identity.alias).toBe('');

    const forPlayer = await call('POST', url(), boot.gmToken, { ownerUserId: owner.user.id, alias: 'Pregen' });
    expect(forPlayer.statusCode).toBe(201);
    expect((forPlayer.json() as Dto).ownerUserId).toBe(owner.user.id);

    const gmOwn = await call('POST', url(), boot.gmToken, {});
    expect((gmOwn.json() as Dto).ownerUserId).toBe(boot.gmUserId);
  });

  it('refuses observers, displays, a player building for someone else, strangers and unknown concepts', async () => {
    expect((await call('POST', url(), observer.token, {})).statusCode).toBe(403);
    expect((await call('POST', url(), display.token, {})).statusCode).toBe(403);
    expect((await call('POST', url(), owner.token, { ownerUserId: other.user.id })).statusCode).toBe(403);
    expect((await call('POST', url(), boot.gmToken, { ownerUserId: UNKNOWN_UUID })).statusCode).toBe(400);
    // A member who can never open a build cannot be handed one, nor have it count against them.
    for (const who of [observer, display]) {
      const res = await call('POST', url(), boot.gmToken, { ownerUserId: who.user.id });
      expect(res.statusCode).toBe(400);
      expect((await t.db.select().from(builds).where(eq(builds.ownerUserId, who.user.id)))).toHaveLength(0);
    }
    expect((await call('POST', url(), owner.token, { conceptId: 'no-such-card' })).statusCode).toBe(400);
    expect((await call('POST', `/api/campaigns/${NOT_A_UUID}/builds`, owner.token, {})).statusCode).toBe(404);
    expect((await call('POST', `/api/campaigns/${UNKNOWN_UUID}/builds`, owner.token, {})).statusCode).toBe(403);
  });

  it('lists every build for the GM, only their own for a player, nothing for an observer', async () => {
    await call('POST', url(), other.token, { alias: 'Moth draft' });
    const gm = (await call('GET', url(), boot.gmToken)).json() as { builds: Dto[] };
    const mine = (await call('GET', url(), owner.token)).json() as { builds: Dto[] };
    const theirs = (await call('GET', url(), other.token)).json() as { builds: Dto[] };
    expect(gm.builds.some((b) => b.ownerUserId === other.user.id)).toBe(true);
    expect(gm.builds.some((b) => b.ownerUserId === owner.user.id)).toBe(true);
    expect(mine.builds.length).toBeGreaterThan(0);
    expect(mine.builds.every((b) => b.ownerUserId === owner.user.id)).toBe(true);
    expect(theirs.builds.every((b) => b.ownerUserId === other.user.id)).toBe(true);
    expect(gm.builds.length).toBe(
      gm.builds.filter((b) => b.ownerUserId === owner.user.id).length +
        gm.builds.filter((b) => b.ownerUserId === other.user.id).length +
        gm.builds.filter((b) => b.ownerUserId === boot.gmUserId).length,
    );
    expect((await call('GET', url(), observer.token)).statusCode).toBe(403);
    expect((await call('GET', url(), display.token)).statusCode).toBe(403);
  });

  it('never puts a draft on the party roster', async () => {
    await draft(vary(cleanBuild(), (b) => (b.identity.alias = 'Roster Ghost')), owner, true);
    const names = await rosterNames();
    expect(names).not.toContain('Roster Ghost');
    expect(await rosterNames(owner.token)).not.toContain('Roster Ghost');
  });
});

describe('GET/PATCH/DELETE /api/builds/:id', () => {
  it('opens a build for its owner and the GM only; a malformed or unknown id is 404', async () => {
    const d = await draft(cleanBuild());
    expect((await call('GET', `/api/builds/${d.id}`, owner.token)).statusCode).toBe(200);
    expect((await call('GET', `/api/builds/${d.id}`, boot.gmToken)).statusCode).toBe(200);
    expect((await call('GET', `/api/builds/${d.id}`, other.token)).statusCode).toBe(403);
    expect((await call('GET', `/api/builds/${d.id}`, observer.token)).statusCode).toBe(403);
    expect((await call('GET', `/api/builds/${d.id}`, display.token)).statusCode).toBe(403);
    expect((await call('GET', `/api/builds/${NOT_A_UUID}`, boot.gmToken)).statusCode).toBe(404);
    expect((await call('GET', `/api/builds/${UNKNOWN_UUID}`, boot.gmToken)).statusCode).toBe(404);
    expect((await call('PATCH', `/api/builds/${NOT_A_UUID}`, owner.token, { build: writable(cleanBuild()) })).statusCode).toBe(404);
    expect((await call('POST', `/api/builds/${NOT_A_UUID}/approve`, boot.gmToken, {})).statusCode).toBe(404);
  });

  it('autosaves the whole record for owner or GM, strips GM-owned fields, and persists no event', async () => {
    const created = (await call('POST', `/api/campaigns/${boot.campaignId}/builds`, owner.token, {})).json() as Dto;
    const before = await maxEventId();

    const smuggled = {
      build: {
        ...writable(cleanBuild()),
        level: 'prime',
        approvals: { 'approval-quality-exceptional-attribute-str': 'approved' },
        state: 'approved',
        notes: 'Looks great — the GM',
        returnedStep: 3,
      },
    };
    const res = await call('PATCH', `/api/builds/${created.id}`, owner.token, smuggled);
    expect(res.statusCode).toBe(200);
    const dto = res.json() as Dto;
    expect(dto.state).toBe('draft');
    expect(dto.build.approvals).toEqual({});
    expect(dto.build.notes).toBeNull();
    expect(dto.build.returnedStep).toBeNull();
    expect(dto.build.level).toBe('experienced');
    expect(dto.build.identity.alias).toBe('Cinder');
    expect(Date.parse(dto.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));

    const row = (await t.db.select().from(builds).where(eq(builds.id, created.id)))[0]!;
    expect(row.approvals).toEqual({});
    expect(row.state).toBe('draft');
    expect(Object.keys(row.build as object)).not.toContain('approvals');
    expect(Object.keys(row.build as object)).not.toContain('state');

    const gm = await call('PATCH', `/api/builds/${created.id}`, boot.gmToken, {
      build: writable(vary(cleanBuild(), (b) => (b.identity.alias = 'Cinder (GM edit)'))),
    });
    expect(gm.statusCode).toBe(200);
    expect((gm.json() as Dto).build.identity.alias).toBe('Cinder (GM edit)');

    expect((await call('PATCH', `/api/builds/${created.id}`, other.token, { build: writable(cleanBuild()) })).statusCode).toBe(403);
    expect((await call('PATCH', `/api/builds/${created.id}`, observer.token, { build: writable(cleanBuild()) })).statusCode).toBe(403);
    expect((await call('PATCH', `/api/builds/${created.id}`, owner.token, { build: { v: 2 } })).statusCode).toBe(400);

    expect(await maxEventId()).toBe(before);
  });

  it('refuses an autosave built on an older row with 409 build_stale and the row as it stands; without a base, last write wins', async () => {
    const created = (await call('POST', `/api/campaigns/${boot.campaignId}/builds`, owner.token, {})).json() as Dto;

    // The row's own timestamp is never stale against itself, though the column
    // holds microseconds and the ISO string only milliseconds.
    const first = await call('PATCH', `/api/builds/${created.id}`, owner.token, {
      build: writable(vary(cleanBuild(), (b) => (b.identity.alias = 'Cinder (phone)'))),
      baseUpdatedAt: created.updatedAt,
    });
    expect(first.statusCode, first.body).toBe(200);
    const phone = first.json() as Dto;

    // A second device still holding the row it opened with is refused, and told what the row now is.
    const tablet = await call('PATCH', `/api/builds/${created.id}`, owner.token, {
      build: writable(vary(cleanBuild(), (b) => (b.identity.alias = 'Cinder (tablet)'))),
      baseUpdatedAt: created.updatedAt,
    });
    expect(tablet.statusCode).toBe(409);
    const refusal = tablet.json() as { error: { code: string; details: Dto } };
    expect(refusal.error.code).toBe('build_stale');
    expect(refusal.error.details).toMatchObject({ id: created.id, state: 'draft', updatedAt: phone.updatedAt, characterId: null });
    expect(refusal.error.details.build.identity.alias).toBe('Cinder (phone)');
    const stored = (await t.db.select().from(builds).where(eq(builds.id, created.id)))[0]!;
    expect((stored.build as CharacterBuild).identity.alias).toBe('Cinder (phone)');

    // Rebased on the row it was shown, the tablet's save goes through.
    const rebased = await call('PATCH', `/api/builds/${created.id}`, owner.token, {
      build: writable(vary(cleanBuild(), (b) => (b.identity.alias = 'Cinder (tablet)'))),
      baseUpdatedAt: refusal.error.details.updatedAt,
    });
    expect(rebased.statusCode, rebased.body).toBe(200);
    expect((rebased.json() as Dto).build.identity.alias).toBe('Cinder (tablet)');

    // No base: last write wins, as before.
    const blind = await call('PATCH', `/api/builds/${created.id}`, boot.gmToken, {
      build: writable(vary(cleanBuild(), (b) => (b.identity.alias = 'Cinder (GM)'))),
    });
    expect(blind.statusCode).toBe(200);

    // A base that is not a timestamp is a bad request, not a stale one.
    const garbled = await call('PATCH', `/api/builds/${created.id}`, owner.token, { build: writable(cleanBuild()), baseUpdatedAt: 'last tuesday' });
    expect(garbled.statusCode).toBe(400);

    // A submitted build refuses as submitted, whatever the base says.
    const sent = await draft(cleanBuild(), owner, true);
    const late = await call('PATCH', `/api/builds/${sent.id}`, owner.token, { build: writable(cleanBuild()), baseUpdatedAt: sent.updatedAt });
    expect(late.statusCode).toBe(409);
    expect((late.json() as ErrorBody).error.code).toBe('build_state');
  });

  it('deletes: the owner while draft or returned, the GM until approval, nobody else', async () => {
    const mineDraft = await draft(cleanBuild());
    expect((await call('DELETE', `/api/builds/${mineDraft.id}`, other.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/builds/${mineDraft.id}`, observer.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/builds/${mineDraft.id}`, owner.token)).statusCode).toBe(200);
    expect((await call('GET', `/api/builds/${mineDraft.id}`, owner.token)).statusCode).toBe(404);

    const sent = await draft(cleanBuild(), owner, true);
    const refused = await call('DELETE', `/api/builds/${sent.id}`, owner.token);
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as ErrorBody).error.code).toBe('build_state');
    expect((await call('DELETE', `/api/builds/${sent.id}`, boot.gmToken)).statusCode).toBe(200);
  });

  it('lists an unreadable row as a flagged stub instead of failing the list, and still lets it be deleted', async () => {
    // A row the record schema no longer reads — an older draft after the schema tightened.
    const unreadable = { v: 1, method: 'nonsense' };
    const insert = async (ownerUserId: string, state: 'draft' | 'submitted' = 'draft') =>
      (await t.db.insert(builds).values({ campaignId: boot.campaignId, ownerUserId, state, build: unreadable }).returning())[0]!;
    const good = await draft(cleanBuild());
    const gmsOwn = await insert(boot.gmUserId);
    const playersDraft = await insert(owner.user.id);
    const playersSent = await insert(owner.user.id, 'submitted');

    const listUrl = `/api/campaigns/${boot.campaignId}/builds`;
    const gm = await call('GET', listUrl, boot.gmToken);
    expect(gm.statusCode).toBe(200);
    const rows = (gm.json() as { builds: Array<Record<string, unknown>> }).builds;
    expect(rows.find((r) => r['id'] === gmsOwn.id)).toEqual({
      id: gmsOwn.id,
      campaignId: boot.campaignId,
      ownerUserId: boot.gmUserId,
      state: 'draft',
      notes: null,
      characterId: null,
      unreadable: true,
      createdAt: gmsOwn.createdAt.toISOString(),
      updatedAt: gmsOwn.updatedAt.toISOString(),
    });
    expect(rows.find((r) => r['id'] === good.id)?.['build']).toMatchObject({ identity: { alias: 'Cinder' } });
    const mine = (await call('GET', listUrl, owner.token)).json() as { builds: Array<{ id: string; unreadable?: boolean }> };
    expect(mine.builds.filter((b) => b.unreadable).map((b) => b.id).sort()).toEqual([playersDraft.id, playersSent.id].sort());

    // Opening one still says why it cannot be shown.
    const opened = await call('GET', `/api/builds/${gmsOwn.id}`, boot.gmToken);
    expect(opened.statusCode).toBe(500);
    expect((opened.json() as ErrorBody).error.code).toBe('build_invalid');

    // Deleting reads only the row's columns: the same who-and-when rules as any build.
    expect((await call('DELETE', `/api/builds/${playersDraft.id}`, other.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/builds/${playersDraft.id}`, observer.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/builds/${playersSent.id}`, owner.token)).statusCode).toBe(409);
    expect((await call('DELETE', `/api/builds/${playersDraft.id}`, owner.token)).statusCode).toBe(200);
    expect((await call('DELETE', `/api/builds/${playersSent.id}`, boot.gmToken)).statusCode).toBe(200);
    expect((await call('DELETE', `/api/builds/${gmsOwn.id}`, boot.gmToken)).statusCode).toBe(200);
    const left = await t.db.select({ id: builds.id }).from(builds).where(sql`${builds.id} in (${gmsOwn.id}, ${playersDraft.id}, ${playersSent.id})`);
    expect(left).toEqual([]);
  });

  it('decides access before it parses, so an unreadable row tells nobody it exists', async () => {
    // The record was parsed first, so ANY authenticated device — another
    // player, an observer, a display — could tell an existing-but-unreadable
    // row (500 with zod's issues, naming fields of a build it may not open)
    // from an unknown id (404).
    const row = (
      await t.db
        .insert(builds)
        .values({ campaignId: boot.campaignId, ownerUserId: owner.user.id, state: 'draft', build: { v: 1, method: 'nonsense' } })
        .returning()
    )[0]!;
    try {
      for (const [who, token] of [
        ['another player', other.token],
        ['an observer', observer.token],
        ['a display', display.token],
      ] as const) {
        for (const path of [`/api/builds/${row.id}`, `/api/builds/${row.id}/check`]) {
          const res = await call('GET', path, token);
          expect(res.statusCode, `${who} on ${path}`).toBe(403);
          expect((res.json() as ErrorBody).error.code, `${who} on ${path}`).toBe('forbidden');
        }
      }
      // A GM-only route refuses the player before it parses too.
      const approve = await call('POST', `/api/builds/${row.id}/approve`, owner.token, {});
      expect(approve.statusCode).toBe(403);

      // The owner and the GM are told, and are not handed zod's issues.
      for (const token of [owner.token, boot.gmToken]) {
        const res = await call('GET', `/api/builds/${row.id}`, token);
        expect(res.statusCode).toBe(500);
        const body = res.json() as ErrorBody;
        expect(body.error.code).toBe('build_invalid');
        expect(body.error.details).toBeUndefined();
      }

      // A readable build at another table learns nothing either: 404, as for
      // an id that does not exist, rather than a 403 that confirms it.
      const elsewhere = (
        await t.db.insert(campaigns).values({ name: 'Another table', gmUserId: boot.gmUserId }).returning()
      )[0]!;
      const theirs = (
        await t.db
          .insert(builds)
          .values({ campaignId: elsewhere.id, ownerUserId: owner.user.id, state: 'draft', build: writable(cleanBuild()) })
          .returning()
      )[0]!;
      for (const token of [owner.token, boot.gmToken]) {
        expect((await call('GET', `/api/builds/${theirs.id}`, token)).statusCode).toBe(404);
        expect((await call('DELETE', `/api/builds/${theirs.id}`, token)).statusCode).toBe(404);
      }
      await t.db.delete(builds).where(eq(builds.id, theirs.id));
      await t.db.delete(campaigns).where(eq(campaigns.id, elsewhere.id));
    } finally {
      await t.db.delete(builds).where(eq(builds.id, row.id));
    }
  });
});

describe('GET /api/builds/:id/check', () => {
  it("returns the engine's budgets, issues, compiled sheet and derived character", async () => {
    const d = await draft(cleanBuild());
    const res = await call('GET', `/api/builds/${d.id}/check`, owner.token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      budgets: { pools: { karma: { remaining: number }; nuyen: { available: number } } };
      issues: Issue[];
      sheet: { identity: { alias: string } };
      derived?: { limits?: unknown };
    };
    expect(body.issues).toEqual([]);
    expect(body.budgets.pools.karma.remaining).toBe(0);
    expect(body.sheet.identity.alias).toBe('Cinder');
    expect(body.derived).toBeDefined();
    expect((await call('GET', `/api/builds/${d.id}/check`, boot.gmToken)).statusCode).toBe(200);
    expect((await call('GET', `/api/builds/${d.id}/check`, other.token)).statusCode).toBe(403);
    expect((await call('GET', `/api/builds/${d.id}/check`, observer.token)).statusCode).toBe(403);
  });

  it('answers for a blank draft too — the rail previews a build from its first tap', async () => {
    const blank = (await call('POST', `/api/campaigns/${boot.campaignId}/builds`, owner.token, {})).json() as Dto;
    const res = await call('GET', `/api/builds/${blank.id}/check`, owner.token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { issues: Issue[]; budgets: { pools: Record<string, unknown> } };
    expect(body.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(body.budgets.pools['karma']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The review loop
// ---------------------------------------------------------------------------

describe('submit and return', () => {
  it('refuses to submit a build with errors, and names them', async () => {
    const empty = (await call('POST', `/api/campaigns/${boot.campaignId}/builds`, owner.token, {})).json() as Dto;
    const res = await call('POST', `/api/builds/${empty.id}/submit`, owner.token, {});
    expect(res.statusCode).toBe(409);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe('build_invalid');
    expect(body.error.details?.issues?.length).toBeGreaterThan(0);
    expect(body.error.details?.issues?.every((i) => i.severity === 'error')).toBe(true);
    const row = (await t.db.select().from(builds).where(eq(builds.id, empty.id)))[0]!;
    expect(row.state).toBe('draft');
  });

  it('lets only the owner submit, announces it to the GM and owner, then locks the record', async () => {
    const d = await draft(cleanBuild());
    expect((await call('POST', `/api/builds/${d.id}/submit`, other.token, {})).statusCode).toBe(403);
    expect((await call('POST', `/api/builds/${d.id}/submit`, observer.token, {})).statusCode).toBe(403);
    expect((await call('POST', `/api/builds/${d.id}/submit`, boot.gmToken, {})).statusCode).toBe(403);

    const before = await maxEventId();
    const res = await call('POST', `/api/builds/${d.id}/submit`, owner.token, {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as Dto).state).toBe('submitted');
    const events = await eventsAfter(before);
    const submitted = events.filter((e) => e.type === 'build.submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ visibility: 'gm_owner', ownerUserId: owner.user.id });
    expect(submitted[0]!.payload).toMatchObject({ buildId: d.id, alias: 'Cinder' });

    // PATCH refuses after submit — for the owner and the GM alike.
    for (const token of [owner.token, boot.gmToken]) {
      const patched = await call('PATCH', `/api/builds/${d.id}`, token, { build: writable(cleanBuild()) });
      expect(patched.statusCode).toBe(409);
      expect((patched.json() as ErrorBody).error.code).toBe('build_state');
    }
    expect((await call('POST', `/api/builds/${d.id}/submit`, owner.token, {})).statusCode).toBe(409);
  });

  it('lets the GM return a submitted build with a note pinned to a step, reopening it', async () => {
    const d = await draft(cleanBuild(), owner, true);
    const body = { notes: 'Swap the knife skill for something quieter.', step: 6 };
    expect((await call('POST', `/api/builds/${d.id}/return`, owner.token, body)).statusCode).toBe(403);
    expect((await call('POST', `/api/builds/${d.id}/return`, other.token, body)).statusCode).toBe(403);
    expect((await call('POST', `/api/builds/${d.id}/return`, observer.token, body)).statusCode).toBe(403);
    expect((await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, { step: 6 })).statusCode).toBe(400);

    const before = await maxEventId();
    const res = await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, body);
    expect(res.statusCode).toBe(200);
    const dto = res.json() as Dto;
    expect(dto).toMatchObject({ state: 'returned', notes: body.notes });
    expect(dto.build).toMatchObject({ state: 'returned', notes: body.notes, returnedStep: 6 });
    const returned = (await eventsAfter(before)).filter((e) => e.type === 'build.returned');
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ visibility: 'gm_owner', ownerUserId: owner.user.id });

    // Returned is editable again, and cannot be returned twice.
    expect((await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, body)).statusCode).toBe(409);
    const edited = await call('PATCH', `/api/builds/${d.id}`, owner.token, { build: writable(cleanBuild()) });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as Dto).notes).toBe(body.notes);
    expect((await call('POST', `/api/builds/${d.id}/submit`, owner.token, {})).statusCode).toBe(200);
  });
});

describe('the record a verdict is given on', () => {
  const gmAuth = (): AuthContext => ({
    userId: boot.gmUserId,
    deviceId: 'gm-device',
    campaignId: boot.campaignId,
    role: 'gm',
    displayName: 'GM',
  });

  it('is the one stored when submit commits, not one read before an autosave landed', async () => {
    const d = await draft(cleanBuild());
    // What the route loaded, before the owner's other device saved over it.
    const readByTheRoute = await requireBuild(t.db, d.id);
    const blank = (await call('POST', `/api/campaigns/${boot.campaignId}/builds`, owner.token, {})).json() as Dto;
    expect((await call('PATCH', `/api/builds/${d.id}`, owner.token, { build: writable(blank.build) })).statusCode).toBe(200);

    await expect(submitBuild(t.db, t.app.hub, readByTheRoute)).rejects.toMatchObject({ statusCode: 409, code: 'build_invalid' });
    const row = (await t.db.select().from(builds).where(eq(builds.id, d.id)))[0]!;
    expect(row.state).toBe('draft');
  });

  it('is the one stored when approval commits: a denial that landed after the read is not overwritten', async () => {
    const d = await draft(vary(boundMage(), (b) => (b.identity.alias = 'Latecomer')), owner, true);
    const code = (await issuesOf(d.id)).find((i) => i.severity === 'approval')!.code;
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: { [code]: 'approved' } })).statusCode).toBe(200);
    const readByTheRoute = await requireBuild(t.db, d.id);
    // The GM's second device changes its mind before the approval's transaction opens.
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: { [code]: 'denied' } })).statusCode).toBe(200);

    getRollService(t.db, t.app.hub).setRng(fixedFace(3));
    await expect(approveBuild(t.db, t.app.hub, gmAuth(), readByTheRoute)).rejects.toMatchObject({
      statusCode: 409,
      code: 'build_not_approvable',
    });
    const row = (await t.db.select().from(builds).where(eq(builds.id, d.id)))[0]!;
    expect(row).toMatchObject({ state: 'submitted', characterId: null, approvals: { [code]: 'denied' } });
    expect(await rosterNames()).not.toContain('Latecomer');
  });

  it('gives the verdict before it opens a transaction, so no engine pass holds the one connection', async () => {
    // PGlite is single-process: an engine pass inside `hub.atomic` makes every
    // other device at the table wait on it. A refusal must therefore be
    // reached without opening the transaction at all — which is also what says
    // the pass moved out of it, since a refused build never reaches the lock.
    const d = await draft(vary(cleanBuild(), (b) => (b.identity.alias = '')));
    const read = await requireBuild(t.db, d.id);
    const real = t.app.hub.atomic.bind(t.app.hub);
    let opened = 0;
    t.app.hub.atomic = ((campaignId: string, fn: never) => {
      opened += 1;
      return real(campaignId, fn);
    }) as typeof t.app.hub.atomic;
    try {
      await expect(submitBuild(t.db, t.app.hub, read)).rejects.toMatchObject({ statusCode: 409, code: 'build_invalid' });
      expect(opened).toBe(0);
      // And a build the engine passes does open one, exactly once.
      const ok = await requireBuild(t.db, (await draft(cleanBuild())).id);
      expect((await submitBuild(t.db, t.app.hub, ok)).state).toBe('submitted');
      expect(opened).toBe(1);
    } finally {
      t.app.hub.atomic = real as typeof t.app.hub.atomic;
    }
  });
});

describe('how many decisions a build can carry', () => {
  const many = (n: number, prefix = 'approval-invented') =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}-${i}`, 'approved' as const]));

  it('bounds the decisions a return, an approval or a review may carry, and a code\'s length', async () => {
    const d = await draft(cleanBuild(), owner, true);
    const over = many(MAX_APPROVAL_DECISIONS + 1);
    expect((await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, { notes: 'Too many.', approvals: over })).statusCode).toBe(400);
    expect((await call('POST', `/api/builds/${d.id}/approve`, boot.gmToken, { approvals: over })).statusCode).toBe(400);
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: over })).statusCode).toBe(400);
    const longCode = { ['x'.repeat(201)]: 'approved' };
    expect((await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, { notes: 'Long.', approvals: longCode })).statusCode).toBe(400);
    expect((await call('POST', `/api/builds/${d.id}/approve`, boot.gmToken, { approvals: longCode })).statusCode).toBe(400);
    const row = (await t.db.select().from(builds).where(eq(builds.id, d.id)))[0]!;
    expect(row).toMatchObject({ state: 'submitted', approvals: {} });
  });

  it('caps what the column holds across calls, and taking decisions back makes room', async () => {
    const d = await draft(cleanBuild(), owner, true);
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: many(MAX_APPROVAL_DECISIONS) })).statusCode).toBe(200);
    const more = await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: many(1, 'approval-another') });
    expect(more.statusCode).toBe(409);
    expect((more.json() as ErrorBody).error.code).toBe('too_many_approvals');
    const viaReturn = await call('POST', `/api/builds/${d.id}/return`, boot.gmToken, { notes: 'One more.', approvals: many(1, 'approval-another') });
    expect(viaReturn.statusCode).toBe(409);
    // Re-deciding a code already held is not growth.
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: { 'approval-invented-0': 'denied' } })).statusCode).toBe(200);
    // Taking one back frees its place.
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: { 'approval-invented-0': null } })).statusCode).toBe(200);
    expect((await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, { approvals: many(1, 'approval-another') })).statusCode).toBe(200);
    const row = (await t.db.select().from(builds).where(eq(builds.id, d.id)))[0]!;
    expect(Object.keys(row.approvals)).toHaveLength(MAX_APPROVAL_DECISIONS);
    expect(row.state).toBe('submitted');
  });
});

describe('GM approvals', () => {
  let samuraiId: string;
  let codes: string[];

  beforeAll(async () => {
    samuraiId = (await draft(troubledSamurai(), owner, true)).id;
    codes = (await issuesOf(samuraiId)).filter((i) => i.severity === 'approval').map((i) => i.code);
  });

  it('are waiting on the samurai, and no player may decide them or approve', async () => {
    expect(codes.length).toBeGreaterThanOrEqual(2);
    const decide = { approvals: Object.fromEntries(codes.map((c) => [c, 'approved'])) };
    for (const token of [owner.token, other.token, observer.token]) {
      expect((await call('POST', `/api/builds/${samuraiId}/approvals`, token, decide)).statusCode).toBe(403);
      expect((await call('POST', `/api/builds/${samuraiId}/approve`, token, {})).statusCode).toBe(403);
      expect((await call('POST', `/api/builds/${samuraiId}/approve`, token, decide)).statusCode).toBe(403);
    }
    const row = (await t.db.select().from(builds).where(eq(builds.id, samuraiId)))[0]!;
    expect(row.approvals).toEqual({});
    expect(row.state).toBe('submitted');
  });

  it('refuse approval while a decision is outstanding, and treat a denial as an error', async () => {
    const pending = await call('POST', `/api/builds/${samuraiId}/approve`, boot.gmToken, {});
    expect(pending.statusCode).toBe(409);
    const body = pending.json() as ErrorBody;
    expect(body.error.code).toBe('build_not_approvable');
    expect(body.error.details?.issues?.map((i) => i.code).sort()).toEqual([...codes].sort());

    const before = await maxEventId();
    const deny = await call('POST', `/api/builds/${samuraiId}/approvals`, boot.gmToken, {
      approvals: { [codes[0]!]: 'denied' },
    });
    expect(deny.statusCode).toBe(200);
    expect((deny.json() as Dto).build.approvals).toEqual({ [codes[0]!]: 'denied' });
    const reviewed = (await eventsAfter(before)).filter((e) => e.type === 'build.reviewed');
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({ visibility: 'gm_owner', ownerUserId: owner.user.id });

    // The owner's check sees the GM's decision: the denied item is now an error.
    const seen = await issuesOf(samuraiId, owner.token);
    expect(seen.some((i) => i.code === codes[0] && i.severity === 'error')).toBe(true);
    const denied = await call('POST', `/api/builds/${samuraiId}/approve`, boot.gmToken, {
      approvals: Object.fromEntries(codes.slice(1).map((c) => [c, 'approved'])),
    });
    expect(denied.statusCode).toBe(409);
    expect((denied.json() as ErrorBody).error.details?.issues?.some((i) => i.severity === 'error')).toBe(true);
    // A refused approval keeps none of the decisions it carried.
    const row = (await t.db.select().from(builds).where(eq(builds.id, samuraiId)))[0]!;
    expect(row.approvals).toEqual({ [codes[0]!]: 'denied' });

    // `null` takes a decision back.
    const cleared = await call('POST', `/api/builds/${samuraiId}/approvals`, boot.gmToken, {
      approvals: { [codes[0]!]: null },
    });
    expect((cleared.json() as Dto).build.approvals).toEqual({});
    expect((await call('POST', `/api/builds/${samuraiId}/approvals`, boot.gmToken, { approvals: {} })).statusCode).toBe(400);
  });

  it('travel with the approval itself, which then creates the samurai', async () => {
    getRollService(t.db, t.app.hub).setRng(fixedFace(3));
    const res = await call('POST', `/api/builds/${samuraiId}/approve`, boot.gmToken, {
      approvals: Object.fromEntries(codes.map((c) => [c, 'approved'])),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { build: Dto; character: { name: string; ownerUserId: string } };
    expect(body.build.state).toBe('approved');
    expect(body.build.build.approvals).toEqual(Object.fromEntries(codes.map((c) => [c, 'approved'])));
    expect(body.character).toMatchObject({ name: 'Breakwater', ownerUserId: owner.user.id });
  });
});

// ---------------------------------------------------------------------------
// Approval: one transaction
// ---------------------------------------------------------------------------

describe('the opening ledger words', () => {
  it('groups every number the way the app writes money: "5,000¥", "× 1,000"', () => {
    expect(groupedNumber(5000)).toBe('5,000');
    expect(groupedNumber(7)).toBe('7');
    expect(openingReasons({ karma: 7, nuyenCarry: 5000, dice: 6, sum: 21, multiplier: 1000 })).toEqual({
      karma: 'Built: 7 Karma carried into play',
      carried: 'Built: 5,000¥ left over from creation',
      rolled: 'Built: starting nuyen, 6D6 (21) × 1,000',
    });
  });
});

describe('POST /api/builds/:id/approve', () => {
  afterEach(async () => {
    await t.db.execute(sql`alter table ws_events drop constraint if exists atomicity_probe`);
  });

  async function magicShelf(token = boot.gmToken) {
    const res = await call('GET', `/api/campaigns/${boot.campaignId}/magic`, token);
    expect(res.statusCode).toBe(200);
    return res.json() as {
      spirits: Array<Record<string, unknown>>;
      sprites: Array<Record<string, unknown>>;
      foci: Array<Record<string, unknown>>;
    };
  }

  async function readyMage(alias: string): Promise<string> {
    const d = await draft(vary(boundMage(), (b) => (b.identity.alias = alias)), owner, true);
    const pending = (await issuesOf(d.id)).filter((i) => i.severity === 'approval');
    expect(pending).toHaveLength(1);
    const ok = await call('POST', `/api/builds/${d.id}/approvals`, boot.gmToken, {
      approvals: { [pending[0]!.code]: 'approved' },
    });
    expect(ok.statusCode).toBe(200);
    return d.id;
  }

  it('rolls back every write when the last event is refused, and the build stays waiting', async () => {
    const id = await readyMage('Undertow');
    const shelfBefore = await magicShelf();
    const rollsBefore = await t.db.select({ n: sql<number>`count(*)::int` }).from(rolls);
    const ledgerBefore = await t.db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries);
    const contactsBefore = await t.db.select({ n: sql<number>`count(*)::int` }).from(contacts);
    const eventsBefore = await maxEventId();

    await t.db.execute(
      sql`alter table ws_events add constraint atomicity_probe check (type <> ${sql.raw(`'build.approved'`)}) not valid`,
    );
    getRollService(t.db, t.app.hub).setRng(fixedFace(5));
    const res = await call('POST', `/api/builds/${id}/approve`, boot.gmToken, {});
    expect(res.statusCode).toBe(500);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe('event_append_failed');
    expect(body.error.message).toContain('build.approved');

    expect(await t.db.select().from(characters).where(eq(characters.name, 'Undertow'))).toHaveLength(0);
    expect((await t.db.select({ n: sql<number>`count(*)::int` }).from(rolls))[0]!.n).toBe(rollsBefore[0]!.n);
    expect((await t.db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries))[0]!.n).toBe(ledgerBefore[0]!.n);
    expect((await t.db.select({ n: sql<number>`count(*)::int` }).from(contacts))[0]!.n).toBe(contactsBefore[0]!.n);
    expect(await magicShelf()).toEqual(shelfBefore);
    expect(await maxEventId()).toBe(eventsBefore);
    const row = (await t.db.select().from(builds).where(eq(builds.id, id)))[0]!;
    expect(row.state).toBe('submitted');
    expect(row.characterId).toBeNull();
    expect(await rosterNames()).not.toContain('Undertow');

    // Nothing half-landed stands in the way of trying again.
    await t.db.execute(sql`alter table ws_events drop constraint if exists atomicity_probe`);
    const retry = await call('POST', `/api/builds/${id}/approve`, boot.gmToken, {});
    expect(retry.statusCode).toBe(201);
    expect(await rosterNames()).toContain('Undertow');
  });

  it('creates the character, revision 1, contacts, magic, the roll on the record, the ledger and both events', async () => {
    const id = await readyMage('Gutterlight');
    expect(await rosterNames()).not.toContain('Gutterlight');
    const shelfBefore = await magicShelf();
    const eventsBefore = await maxEventId();

    getRollService(t.db, t.app.hub).setRng(fixedFace(4));
    const res = await call('POST', `/api/builds/${id}/approve`, boot.gmToken, {});
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      build: Dto;
      character: { id: string; name: string; ownerUserId: string; balances: { karma: number; nuyen: number } };
      revision: number;
      opening: { karma: number; nuyenCarry: number; startingNuyen: { dice: number; multiplier: number; total: number } };
      roll: { id: string; faces: number[]; sum: number; multiplier: number; nuyen: number };
    };
    const characterId = body.character.id;
    // The answer is the contract's shape, which the web reads it with.
    expect(BuildApproveResultSchema.parse(body)).toMatchObject({ build: { state: 'approved', characterId }, roll: { id: body.roll.id } });

    // The character: owned by the build's owner, its build kept as history.
    expect(body.character).toMatchObject({ name: 'Gutterlight', ownerUserId: owner.user.id });
    const charRow = (await t.db.select().from(characters).where(eq(characters.id, characterId)))[0]!;
    expect((charRow.sheet as { identity: { alias: string } }).identity.alias).toBe('Gutterlight');
    expect((charRow.build as CharacterBuild).state).toBe('approved');
    expect((charRow.build as CharacterBuild).karma.spends.some((s) => s.kind === 'spirit')).toBe(true);
    expect(await rosterNames(owner.token)).toContain('Gutterlight');

    // Revision 1, cause `built`.
    const revisions = await t.db.select().from(characterRevisions).where(eq(characterRevisions.characterId, characterId));
    expect(revisions.map((r) => [r.seq, r.cause])).toEqual([[1, 'built']]);
    expect(body.revision).toBe(1);

    // Contacts rows, role → archetype.
    const rows = await t.db.select().from(contacts).where(eq(contacts.characterId, characterId));
    expect(rows.map((c) => [c.name, c.archetype, c.connection, c.loyalty]).sort()).toEqual(
      [
        ['Moss', 'Fixer', 3, 2],
        ['Wren', 'Street doc', 2, 2],
      ].sort(),
    );
    expect(rows.find((c) => c.name === 'Wren')?.notes).toBe('Owes nobody, charges everybody.');
    const listed = await call('GET', `/api/characters/${characterId}/contacts`, owner.token);
    expect(listed.statusCode).toBe(200);

    // The magic shelf: a bound spirit at Force = Magic and a bonded focus with what it feeds.
    const shelf = await magicShelf(owner.token);
    const spirits = shelf.spirits.filter((s) => s['characterId'] === characterId);
    expect(spirits).toHaveLength(1);
    expect(spirits[0]).toMatchObject({ spiritType: 'air', force: 3, bound: true, services: 3, servicesInitial: 3 });
    const foci = shelf.foci.filter((f) => f['characterId'] === characterId);
    expect(foci).toHaveLength(1);
    expect(foci[0]).toMatchObject({
      name: 'Spell Focus',
      kind: 'spell',
      force: 2,
      bonded: true,
      sourceKind: 'spell',
      targets: ['spellcasting'],
      note: 'Etched copper ring',
    });
    expect(shelf.spirits.length).toBe(shelfBefore.spirits.length + 1);
    expect(shelf.foci.length).toBe(shelfBefore.foci.length + 1);

    // The starting-nuyen roll, on the record: Low lifestyle, 3D6 × 60, dice pinned at 4.
    expect(body.roll).toMatchObject({ faces: [4, 4, 4], sum: 12, multiplier: 60, nuyen: 720 });
    const rollRow = (await t.db.select().from(rolls).where(eq(rolls.id, body.roll.id)))[0]!;
    expect(rollRow.faces).toEqual([4, 4, 4]);
    expect(rollRow.actor).toEqual({ characterId });
    expect(rollRow.visibility).toBe('gm_owner');
    expect((rollRow.request as { meta: Record<string, unknown> }).meta).toMatchObject({
      chargen: 'startingNuyen',
      buildId: id,
      sum: 12,
      multiplier: 60,
      nuyen: 720,
      carried: 3_000,
      total: 3_720,
      ownerUserId: owner.user.id,
    });

    // Ledger: Karma carried (3), nuyen carried (3,000) and rolled (720), all approved.
    const entries = await t.db.select().from(ledgerEntries).where(eq(ledgerEntries.characterId, characterId));
    expect(entries.map((e) => [e.currency, e.delta, e.state]).sort()).toEqual(
      [
        ['karma', 3, 'approved'],
        ['nuyen', 3_000, 'approved'],
        ['nuyen', 720, 'approved'],
      ].sort(),
    );
    // Their reasons write numbers the way the app does, grouped.
    expect(entries.map((e) => e.reason).sort()).toEqual(
      ['Built: 3 Karma carried into play', 'Built: 3,000¥ left over from creation', 'Built: starting nuyen, 3D6 (12) × 60'].sort(),
    );
    expect(body.character.balances).toMatchObject({ karma: 3, nuyen: 3_720 });
    expect(body.opening).toMatchObject({ karma: 3, nuyenCarry: 3_000, startingNuyen: { dice: 3, multiplier: 60, total: 3_720 } });

    // The events: sheet.updated (cause built) for the roster, build.approved for the loop.
    const events = await eventsAfter(eventsBefore);
    const types = events.map((e) => e.type);
    const sheetUpdated = events.filter((e) => e.type === 'sheet.updated');
    expect(sheetUpdated).toHaveLength(1);
    expect(sheetUpdated[0]!.payload).toMatchObject({ characterId, name: 'Gutterlight', revision: 1, cause: 'built' });
    const approved = events.filter((e) => e.type === 'build.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ visibility: 'gm_owner', ownerUserId: owner.user.id });
    expect(approved[0]!.payload).toMatchObject({ buildId: id, characterId, rollId: body.roll.id });
    expect(types.filter((x) => x === 'ledger.changed')).toHaveLength(3);
    expect(types.filter((x) => x === 'roll.created')).toHaveLength(1);
    expect(types.filter((x) => x === 'magic.updated')).toHaveLength(1);
    expect(events.find((e) => e.type === 'roll.created')).toMatchObject({ visibility: 'gm_owner', ownerUserId: owner.user.id });

    // The build: approved, pointing at its character, and final.
    const buildRow = (await t.db.select().from(builds).where(eq(builds.id, id)))[0]!;
    expect(buildRow).toMatchObject({ state: 'approved', characterId });
    expect((await call('POST', `/api/builds/${id}/approve`, boot.gmToken, {})).statusCode).toBe(409);
    expect((await call('PATCH', `/api/builds/${id}`, owner.token, { build: writable(boundMage()) })).statusCode).toBe(409);
    expect((await call('DELETE', `/api/builds/${id}`, boot.gmToken)).statusCode).toBe(409);
    expect((await call('POST', `/api/builds/${id}/approvals`, boot.gmToken, { approvals: { x: 'denied' } })).statusCode).toBe(409);
    expect((await call('GET', `/api/builds/${id}`, owner.token)).json()).toMatchObject({ characterId });
  });

  it('registers sprites on the shelf beside spirits, and later magic writes keep them', async () => {
    const d = await draft(registeringTechnomancer(), owner, true);
    expect(await issuesOf(d.id)).toEqual([]);
    getRollService(t.db, t.app.hub).setRng(fixedFace(2));
    const res = await call('POST', `/api/builds/${d.id}/approve`, boot.gmToken, {});
    expect(res.statusCode).toBe(201);
    const characterId = (res.json() as { character: { id: string } }).character.id;

    const shelf = await magicShelf(owner.token);
    const sprites = shelf.sprites.filter((s) => s['characterId'] === characterId);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toMatchObject({ spriteType: 'crack', level: 3, tasks: 3, tasksInitial: 3, registered: true });

    // A write through the existing spirit tracker spreads the shelf it read.
    const summoned = await call('POST', `/api/campaigns/${boot.campaignId}/magic/spirits`, boot.gmToken, {
      spiritType: 'smoke',
      force: 4,
      services: 1,
    });
    expect(summoned.statusCode).toBe(201);
    const after = await magicShelf();
    expect(after.sprites.filter((s) => s['characterId'] === characterId)).toHaveLength(1);

    // Karma carried at the cap.
    const entries = await t.db.select().from(ledgerEntries).where(eq(ledgerEntries.characterId, characterId));
    expect(entries.find((e) => e.currency === 'karma')?.delta).toBe(7);
  });

  it('keeps the starting-nuyen roll out of the live session and off the success-test tallies', async () => {
    const started = await call('POST', `/api/campaigns/${boot.campaignId}/sessions/start`, boot.gmToken, {});
    expect(started.statusCode).toBe(201);
    const sessionId = (started.json() as { session: { id: string } }).session.id;
    try {
      const d = await draft(vary(cleanBuild(), (b) => (b.identity.alias = 'Snake Eyes')), owner, true);
      // Ones and fives on the dice: a success test would read hits and a glitch into them.
      const faces = [1, 1, 5, 6, 1, 5];
      let i = 0;
      getRollService(t.db, t.app.hub).setRng(() => (faces[i++ % faces.length]! - 1) / 6 + 1e-9);
      const res = await call('POST', `/api/builds/${d.id}/approve`, boot.gmToken, {});
      expect(res.statusCode).toBe(201);
      const roll = (res.json() as { roll: { id: string; faces: number[]; sum: number } }).roll;
      expect(roll.faces.length).toBeGreaterThan(0);

      const row = (await t.db.select().from(rolls).where(eq(rolls.id, roll.id)))[0]!;
      expect(row).toMatchObject({ sessionId: null, hits: 0, ones: 0, limitedHits: 0, glitch: 'none' });
      expect((row.request as { meta: Record<string, unknown> }).meta).toMatchObject({ chargen: 'startingNuyen', sum: roll.sum });

      const house = await call('GET', `/api/sessions/${sessionId}/housekeeping`, boot.gmToken);
      expect(house.statusCode).toBe(200);
      expect((house.json() as { housekeeping: { rolls: { total: number } } }).housekeeping.rolls.total).toBe(0);
    } finally {
      expect((await call('POST', `/api/sessions/${sessionId}/end`, boot.gmToken, {})).statusCode).toBe(200);
    }
  });

  it('refuses a build that is not submitted', async () => {
    const d = await draft(cleanBuild());
    const res = await call('POST', `/api/builds/${d.id}/approve`, boot.gmToken, {});
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('build_state');
  });
});
