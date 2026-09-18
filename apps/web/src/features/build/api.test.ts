/**
 * The builder's data layer against docs/CHARGEN.md §8.5: every route's path,
 * method and body; the strict read of a build row (a draft that did not parse
 * must never be defaulted and autosaved back over the real one); the row's
 * authority over the GM-owned fields; and which live events make which
 * queries stale. The client is mocked at the module boundary, so what is
 * asserted is exactly what would go over the wire. Invented runners only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client.js';
import {
  BuildShapeError,
  BuildStaleError,
  KEEPALIVE_BODY_BYTES,
  fitsKeepalive,
  staleKeysForChargen,
  staleKeysForSave,
  storeBuildRecord,
  type BuildList,
  type BuildRecord,
  approveBuild,
  buildKeys,
  createBuild,
  deleteBuild,
  fetchBuild,
  fetchBuildCheck,
  fetchBuilds,
  fetchChargenSettings,
  issuesFromError,
  normalizeBuildList,
  normalizeBuildRecord,
  normalizeChargenSettings,
  patchBuild,
  returnBuild,
  saveChargenSettings,
  setBuildApprovals,
  settingsFromBuild,
  staleKeysFor,
  submitBuild,
} from './api.js';
import { builderCatalogueKey } from './kit/useBuilderCatalogue.js';
import { isStale } from './session.js';
import { BUILD_ID, CAMPAIGN, blankBuild, recordOf } from './testing.js';

const calls = vi.hoisted(() => ({
  list: [] as Array<{ method: string; path: string; body?: unknown; opts?: unknown }>,
  reply: null as unknown,
  /** Thrown instead of replying, when set. */
  fail: null as unknown,
}));

vi.mock('../../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.js')>();
  const record = (method: string) => async (path: string, body?: unknown, opts?: unknown) => {
    calls.list.push({ method, path, ...(body !== undefined ? { body } : {}), ...(opts !== undefined ? { opts } : {}) });
    if (calls.fail) throw calls.fail;
    return calls.reply;
  };
  return {
    ...actual,
    apiGet: vi.fn(async (path: string) => {
      calls.list.push({ method: 'GET', path });
      return calls.reply;
    }),
    apiPost: vi.fn(record('POST')),
    apiPatch: vi.fn(record('PATCH')),
    apiPut: vi.fn(record('PUT')),
    apiDelete: vi.fn(async (path: string) => {
      calls.list.push({ method: 'DELETE', path });
      return calls.reply;
    }),
  };
});

/** A row as JSON, the way it arrives. */
const wire = (over: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ ...recordOf(blankBuild()), ...over }));

beforeEach(() => {
  calls.list = [];
  calls.reply = wire();
  calls.fail = null;
});

describe('reading a build row', () => {
  it('parses a row, and an enveloped one', () => {
    expect(normalizeBuildRecord(wire()).build.identity.alias).toBe('Kestrel Vane');
    expect(normalizeBuildRecord({ build: wire() }).id).toBe(BUILD_ID);
  });

  it('refuses a row whose build does not parse, rather than defaulting it', () => {
    const bad = wire();
    bad.build.attributes.agi = -4;
    expect(() => normalizeBuildRecord(bad)).toThrow(BuildShapeError);
    expect(() => normalizeBuildRecord({ ok: true })).toThrow(/cannot read/);
  });

  it("lays the row's state, notes, approvals and returned step over the record's copies", () => {
    const row = wire({
      state: 'returned',
      notes: 'Pick a lifestyle before you submit.',
      approvals: { 'approval-quality-lucky': 'denied', junk: 'maybe' },
      returnedStep: 7,
      characterId: null,
    });
    const r = normalizeBuildRecord(row);
    expect(r.build.state).toBe('returned');
    expect(r.build.notes).toBe('Pick a lifestyle before you submit.');
    expect(r.build.approvals).toEqual({ 'approval-quality-lucky': 'denied' });
    expect(r.build.returnedStep).toBe(7);
  });

  it('counts unreadable rows in a list instead of showing guesses', () => {
    const bad = wire({ id: 'other' });
    bad.build.v = 2;
    const list = normalizeBuildList({ campaignId: CAMPAIGN, builds: [wire(), bad] }, CAMPAIGN);
    expect(list.builds).toHaveLength(1);
    expect(list.unreadable).toBe(1);
    expect(list.stubs).toEqual([]);
    expect(normalizeBuildList([wire()], CAMPAIGN).builds).toHaveLength(1);
  });

  it("keeps the server's flagged stubs by their columns, so they can be deleted", () => {
    const at = '2026-09-10T08:00:00.000Z';
    const stub = { id: 'b-old', campaignId: CAMPAIGN, ownerUserId: 'u-player', state: 'draft', notes: null, characterId: null, unreadable: true, createdAt: at, updatedAt: at };
    const list = normalizeBuildList({ campaignId: CAMPAIGN, builds: [wire(), stub, { ...stub, id: 7 }] }, CAMPAIGN);
    expect(list.builds).toHaveLength(1);
    expect(list.stubs).toEqual([stub]);
    // A flagged row that is not even a stub is still only counted.
    expect(list.unreadable).toBe(1);
  });

  it('reads the character an approval made off the row, and none off an older row', () => {
    expect(normalizeBuildRecord(wire({ characterId: 'ch-1' })).characterId).toBe('ch-1');
    const { characterId: _gone, ...older } = wire();
    expect(normalizeBuildRecord(older).characterId).toBeNull();
  });
});

describe('settings', () => {
  it('reads the settings object bare or enveloped, defaults filling the rest', () => {
    expect(normalizeChargenSettings({ level: 'street' }).level).toBe('street');
    expect(normalizeChargenSettings({ settings: { level: 'prime' } }).level).toBe('prime');
    expect(normalizeChargenSettings({}).maxAvailability).toBe(12);
  });

  it("falls back to the build's own level and table", () => {
    const s = settingsFromBuild({ level: 'street', table: 'rf' });
    expect(s).toMatchObject({ level: 'street', table: 'rf', maxAvailability: 10 });
  });
});

describe('routes (§8.5)', () => {
  it('chargen settings: GET for members, PUT a partial write for the GM', async () => {
    calls.reply = { level: 'street' };
    await fetchChargenSettings(CAMPAIGN);
    await saveChargenSettings(CAMPAIGN, { books: ['SR5'] });
    expect(calls.list).toEqual([
      { method: 'GET', path: `/api/campaigns/${CAMPAIGN}/chargen` },
      { method: 'PUT', path: `/api/campaigns/${CAMPAIGN}/chargen`, body: { books: ['SR5'] } },
    ]);
  });

  it('the list and a new draft', async () => {
    calls.reply = { campaignId: CAMPAIGN, builds: [wire()] };
    await fetchBuilds(CAMPAIGN);
    calls.reply = wire();
    await createBuild(CAMPAIGN, { alias: '  Kestrel Vane ', conceptId: 'muscle' });
    await createBuild(CAMPAIGN);
    expect(calls.list).toEqual([
      { method: 'GET', path: `/api/campaigns/${CAMPAIGN}/builds` },
      { method: 'POST', path: `/api/campaigns/${CAMPAIGN}/builds`, body: { alias: 'Kestrel Vane', conceptId: 'muscle' } },
      { method: 'POST', path: `/api/campaigns/${CAMPAIGN}/builds`, body: {} },
    ]);
  });

  it('read, and the whole-record PATCH without the GM-owned fields', async () => {
    await fetchBuild(BUILD_ID);
    await patchBuild(BUILD_ID, { ...blankBuild(), approvals: { x: 'approved' }, notes: 'sneaky', state: 'approved' });
    expect(calls.list[0]).toEqual({ method: 'GET', path: `/api/builds/${BUILD_ID}` });
    const patch = calls.list[1]!;
    expect(patch.method).toBe('PATCH');
    expect(patch.path).toBe(`/api/builds/${BUILD_ID}`);
    const body = (patch.body as { build: Record<string, unknown> }).build;
    expect(body['identity']).toMatchObject({ alias: 'Kestrel Vane' });
    for (const k of ['approvals', 'notes', 'returnedStep', 'state']) expect(body).not.toHaveProperty(k);
    // A plain call asks nothing of the browser, and names no base.
    expect(patch).not.toHaveProperty('opts');
    expect(patch.body).not.toHaveProperty('baseUpdatedAt');
  });

  it('names the row an autosave was built on, and turns a stale refusal into the row that now stands', async () => {
    await patchBuild(BUILD_ID, blankBuild(), { baseUpdatedAt: '2026-09-14T10:00:00.000Z' });
    expect(calls.list[0]!.body).toMatchObject({ baseUpdatedAt: '2026-09-14T10:00:00.000Z' });

    const newer = wire({ updatedAt: '2026-09-14T10:05:00.000Z' });
    newer.build.identity.alias = 'Kestrel (tablet)';
    calls.fail = new ApiError(409, 'build_stale', 'the build was saved from another device', newer);
    const refused = await patchBuild(BUILD_ID, blankBuild(), { baseUpdatedAt: '2026-09-14T10:00:00.000Z' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BuildStaleError);
    expect(isStale(refused)).toBe(true);
    const current = (refused as BuildStaleError).current;
    expect(current?.updatedAt).toBe('2026-09-14T10:05:00.000Z');
    expect(current?.build.identity.alias).toBe('Kestrel (tablet)');

    // Unreadable details still say stale, with no row; any other 409 is left as it came.
    calls.fail = new ApiError(409, 'build_stale', 'stale', { nonsense: true });
    const blind = (await patchBuild(BUILD_ID, blankBuild()).catch((e: unknown) => e)) as BuildStaleError;
    expect(blind).toBeInstanceOf(BuildStaleError);
    expect(blind.current).toBeNull();
    const submitted = new ApiError(409, 'build_state', 'submitted');
    calls.fail = submitted;
    expect(await patchBuild(BUILD_ID, blankBuild()).catch((e: unknown) => e)).toBe(submitted);
  });

  it('an autosave PATCH outlives the page when its body is small enough to', async () => {
    await patchBuild(BUILD_ID, blankBuild(), { keepalive: true });
    expect(calls.list[0]!.opts).toEqual({ keepalive: true });

    // A record past the browser's keepalive allowance is sent plainly rather than refused.
    const arsenal = {
      ...blankBuild(),
      identity: { alias: 'Kestrel Vane', background: 'x'.repeat(KEEPALIVE_BODY_BYTES) },
    };
    expect(fitsKeepalive({ build: arsenal })).toBe(false);
    await patchBuild(BUILD_ID, arsenal, { keepalive: true });
    expect(calls.list[1]).not.toHaveProperty('opts');
  });

  it("reads approval's answer in the contract's shape: the approved row and the character it made", async () => {
    const approvedRow = wire({ state: 'approved', characterId: 'ch-made' });
    calls.reply = {
      build: approvedRow,
      character: { id: 'ch-made', name: 'Kestrel Vane' },
      revision: 1,
      opening: { karma: 5, nuyenCarry: 1200, startingNuyen: { dice: 3, multiplier: 60, total: 2400 } },
      roll: { id: 'r-1', faces: [2, 3, 5], sum: 10, multiplier: 60, nuyen: 600 },
    };
    const result = await approveBuild(BUILD_ID);
    expect(result.characterId).toBe('ch-made');
    expect(result.record?.state).toBe('approved');
    expect(result.record?.characterId).toBe('ch-made');
  });

  it('a create body carries an owner only when one is named', async () => {
    await createBuild(CAMPAIGN, { ownerUserId: '7d1c1f7e-0000-4000-8000-000000000009' });
    expect(calls.list[0]!.body).toEqual({ ownerUserId: '7d1c1f7e-0000-4000-8000-000000000009' });
  });

  it('check, submit, return, approvals, approve, delete', async () => {
    calls.reply = { budgets: { pools: {} }, issues: [], sheet: {} };
    await expect(fetchBuildCheck(BUILD_ID)).rejects.toThrow(BuildShapeError);
    calls.reply = wire();
    await submitBuild(BUILD_ID);
    await returnBuild(BUILD_ID, { notes: 'Two attributes at max.', step: 3 });
    await setBuildApprovals(BUILD_ID, { 'approval-quality-lucky': 'approved' });
    calls.reply = { characterId: 'ch-new', build: wire() };
    const approved = await approveBuild(BUILD_ID, { 'approval-quality-lucky': 'approved' });
    expect(approved.characterId).toBe('ch-new');
    calls.reply = undefined;
    await deleteBuild(BUILD_ID);
    expect(calls.list.slice(1)).toEqual([
      { method: 'POST', path: `/api/builds/${BUILD_ID}/submit`, body: {} },
      { method: 'POST', path: `/api/builds/${BUILD_ID}/return`, body: { notes: 'Two attributes at max.', step: 3 } },
      { method: 'POST', path: `/api/builds/${BUILD_ID}/approvals`, body: { approvals: { 'approval-quality-lucky': 'approved' } } },
      { method: 'POST', path: `/api/builds/${BUILD_ID}/approve`, body: { approvals: { 'approval-quality-lucky': 'approved' } } },
      { method: 'DELETE', path: `/api/builds/${BUILD_ID}` },
    ]);
  });

  it('reads the issues a refused submit carried', () => {
    const issue = { code: 'alias-missing', severity: 'error', step: 1, message: 'Give the runner an alias.', ref: { book: 'SR5', page: 62 } };
    expect(issuesFromError(new ApiError(409, 'build_has_errors', 'no', { issues: [issue, { junk: true }] }))).toEqual([issue]);
    expect(issuesFromError(new ApiError(409, 'x', 'no', [issue]))).toEqual([issue]);
    expect(issuesFromError(new Error('plain'))).toEqual([]);
  });
});

describe('the cache never goes back in time', () => {
  it('storeBuildRecord keeps a newer cached row, in its key and in the list', () => {
    const qc = new QueryClient();
    const newer = recordOf({ ...blankBuild(), state: 'submitted' }, { state: 'submitted', updatedAt: '2026-09-14T10:00:02.000Z' });
    const older = recordOf(blankBuild(), { updatedAt: '2026-09-14T10:00:01.000Z' });
    qc.setQueryData(buildKeys.list(CAMPAIGN), { campaignId: CAMPAIGN, builds: [newer], stubs: [], unreadable: 0 });
    storeBuildRecord(qc, newer);
    // A save's answer that left before the submit and landed after its refetch.
    storeBuildRecord(qc, older);
    expect(qc.getQueryData<BuildRecord>(buildKeys.build(BUILD_ID))?.state).toBe('submitted');
    expect(qc.getQueryData<BuildList>(buildKeys.list(CAMPAIGN))?.builds[0]?.state).toBe('submitted');

    const later = recordOf({ ...blankBuild(), state: 'returned' }, { state: 'returned', updatedAt: '2026-09-14T10:00:03.000Z' });
    storeBuildRecord(qc, later);
    expect(qc.getQueryData<BuildRecord>(buildKeys.build(BUILD_ID))?.state).toBe('returned');
    expect(qc.getQueryData<BuildList>(buildKeys.list(CAMPAIGN))?.builds[0]?.state).toBe('returned');
  });
});

describe('keys and live invalidation', () => {
  it('owns keys no other feature reads', () => {
    expect(buildKeys.build('b')).toEqual(['build', 'b']);
    expect(buildKeys.check('b')).toEqual(['build', 'b', 'check']);
    expect(buildKeys.list('c')).toEqual(['campaign', 'c', 'builds']);
    expect(buildKeys.settings('c')).toEqual(['campaign', 'c', 'chargen']);
  });

  it('a review event refreshes the list and the build it names', () => {
    const keys = staleKeysFor({ type: 'build.returned', payload: { buildId: BUILD_ID } }, CAMPAIGN, BUILD_ID);
    expect(keys).toEqual([buildKeys.list(CAMPAIGN), buildKeys.build(BUILD_ID)]);
    const other = staleKeysFor({ type: 'build.submitted', payload: { buildId: 'someone-else' } }, CAMPAIGN, BUILD_ID);
    expect(other).toEqual([buildKeys.list(CAMPAIGN)]);
  });

  it("a GM's approval decisions refresh the build they are about (and its check), not the list", () => {
    const keys = staleKeysFor({ type: 'build.reviewed', payload: { buildId: BUILD_ID } }, CAMPAIGN, BUILD_ID);
    expect(keys).toEqual([buildKeys.build(BUILD_ID)]);
    // Invalidation matches by prefix: the row's key covers the server check.
    expect(buildKeys.check(BUILD_ID).slice(0, 2)).toEqual(buildKeys.build(BUILD_ID));
    expect(staleKeysFor({ type: 'build.reviewed', payload: { buildId: 'other' } }, CAMPAIGN, BUILD_ID)).toEqual([]);
  });

  it('a build.saved ping refetches the open build unless the cache already holds that row', () => {
    const held = { updatedAt: '2026-09-14T10:00:01.000Z' };
    const ping = (updatedAt: string | null, buildId = BUILD_ID) => ({ buildId, updatedAt });
    expect(staleKeysForSave(ping('2026-09-14T10:00:05.000Z'), BUILD_ID, held)).toEqual([buildKeys.build(BUILD_ID)]);
    // This device's own save, already stored.
    expect(staleKeysForSave(ping('2026-09-14T10:00:01.000Z'), BUILD_ID, held)).toEqual([]);
    // Not the open build, or no build open.
    expect(staleKeysForSave(ping('2026-09-14T10:00:05.000Z', 'other'), BUILD_ID, held)).toEqual([]);
    expect(staleKeysForSave(ping('2026-09-14T10:00:05.000Z'), undefined, held)).toEqual([]);
    // A ping without a time, or nothing cached yet: refetch.
    expect(staleKeysForSave(ping(null), BUILD_ID, held)).toEqual([buildKeys.build(BUILD_ID)]);
    expect(staleKeysForSave(ping('2026-09-14T10:00:05.000Z'), BUILD_ID, undefined)).toEqual([buildKeys.build(BUILD_ID)]);
  });

  it('a chargen.updated ping refetches the rules, the open build and every catalogue page', () => {
    // The GM changed the level, the caps or the book list. A device holding
    // the old settings goes on pricing, capping and searching by rules the
    // table has left behind, and nothing else would make it refetch.
    const keys = staleKeysForChargen(CAMPAIGN, BUILD_ID);
    expect(keys).toEqual([buildKeys.settings(CAMPAIGN), buildKeys.build(BUILD_ID), ['catalogue']]);
    // With no build open, the rules and the catalogue still move.
    expect(staleKeysForChargen(CAMPAIGN, undefined)).toEqual([buildKeys.settings(CAMPAIGN), ['catalogue']]);
    expect(staleKeysForChargen(undefined, BUILD_ID)).toEqual([]);
    // `['catalogue']` is a prefix of every catalogue query, the builder's
    // picker included, so one entry covers them all.
    expect(builderCatalogueKey({ campaignId: CAMPAIGN, kind: 'gear' })[0]).toBe('catalogue');
  });

  it('approval also refreshes the roster and who-am-I', () => {
    const keys = staleKeysFor({ type: 'build.approved', payload: { buildId: BUILD_ID } }, CAMPAIGN);
    expect(keys).toEqual([buildKeys.list(CAMPAIGN), ['characters', CAMPAIGN], ['me']]);
  });

  it('an ordinary sheet edit refreshes nothing here; the approval’s own sheet.updated does', () => {
    expect(staleKeysFor({ type: 'sheet.updated', payload: { characterId: 'ch-1' } }, CAMPAIGN)).toEqual([]);
    expect(staleKeysFor({ type: 'sheet.updated', payload: { characterId: 'ch-1', cause: 'built' } }, CAMPAIGN)).toEqual([
      buildKeys.list(CAMPAIGN),
    ]);
    expect(staleKeysFor({ type: 'token.moved', payload: {} }, CAMPAIGN, BUILD_ID)).toEqual([]);
  });
});
