/**
 * The build session's autosave, pinned with fake timers (docs/CHARGEN.md
 * §4.4 "Autosave on every change", §8.6 "a debounced PATCH").
 *
 * Each test is one of the ways an autosave loses a player's work: a save per
 * keystroke, a save that sends a stale record, a response or refetch that
 * overwrites newer typing, a Next pressed before the timer fired, a build
 * frozen by a submit on another device that keeps "saving" into a 409, and a
 * second device whose save lands first and would be silently overwritten
 * (the stale path: the typing stays on screen and the player chooses). The
 * runner in the fixtures ("Kestrel Vane") is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildWritable, CharacterBuild } from '@safehouse/contracts';
import { ApiError } from '../../api/client.js';
import { BuildStaleError, type BuildRecord } from './api.js';
import {
  STALE_MESSAGE,
  contentKey,
  createBuildSession,
  supersedes,
  withServerFields,
  type BuildSession,
} from './session.js';
import { BUILD_ID, blankBuild, recordOf } from './testing.js';

const DELAY = 500;

interface Harness {
  session: BuildSession;
  saves: BuildWritable[];
  /** The `baseUpdatedAt` each save named, in order. */
  bases: Array<string | null>;
  /** Resolve (or reject) the oldest pending save. */
  settle(result?: BuildRecord | Error): Promise<void>;
  pending(): number;
}

function harness(
  opts: { manual?: boolean; canWrite?: boolean; initial?: CharacterBuild; onSaved?: (r: BuildRecord) => void } = {},
): Harness {
  const saves: BuildWritable[] = [];
  const bases: Array<string | null> = [];
  const waiting: Array<{ body: BuildWritable; resolve: (r: BuildRecord) => void; reject: (e: unknown) => void }> = [];
  let clock = Date.parse('2026-09-14T10:00:00.000Z');
  const session = createBuildSession({
    buildId: BUILD_ID,
    delayMs: DELAY,
    canWrite: opts.canWrite ?? true,
    ...(opts.onSaved ? { onSaved: opts.onSaved } : {}),
    save: (_id, body, base) => {
      saves.push(body);
      bases.push(base);
      if (!opts.manual) {
        clock += 1000;
        return Promise.resolve(echo(body, new Date(clock).toISOString()));
      }
      return new Promise<BuildRecord>((resolve, reject) => waiting.push({ body, resolve, reject }));
    },
  });
  session.receive(recordOf(opts.initial ?? blankBuild()));
  return {
    session,
    saves,
    bases,
    pending: () => waiting.length,
    async settle(result) {
      const next = waiting.shift();
      if (!next) throw new Error('no save pending');
      clock += 1000;
      if (result instanceof Error) next.reject(result);
      else next.resolve(result ?? echo(next.body, new Date(clock).toISOString()));
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

/** What the server answers a PATCH with: the record it now holds. */
function echo(body: BuildWritable, updatedAt: string): BuildRecord {
  const build: CharacterBuild = { ...blankBuild(), ...body, state: 'draft', notes: null, approvals: {}, returnedStep: null };
  return recordOf(build, { updatedAt });
}

const setAlias = (alias: string) => (b: CharacterBuild): CharacterBuild => ({ ...b, identity: { ...b.identity, alias } });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('edits are local first, saves are debounced', () => {
  it('applies an update at once and saves once, with the newest record, after the pause', async () => {
    const h = harness();
    h.session.update(setAlias('K'));
    h.session.update(setAlias('Ke'));
    h.session.update(setAlias('Kes'));
    expect(h.session.getState().draft?.identity.alias).toBe('Kes');
    expect(h.session.getState().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(h.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]!.identity.alias).toBe('Kes');
    expect(h.session.getState().status).toBe('saved');
  });

  it('never sends the GM-owned fields', async () => {
    const h = harness();
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    const body = h.saves[0] as Record<string, unknown>;
    for (const key of ['approvals', 'notes', 'returnedStep', 'state']) expect(body).not.toHaveProperty(key);
    expect(body).toHaveProperty('identity');
  });

  it('each further edit pushes the save back', async () => {
    const h = harness();
    h.session.update(setAlias('A'));
    await vi.advanceTimersByTimeAsync(DELAY - 100);
    h.session.update(setAlias('AB'));
    await vi.advanceTimersByTimeAsync(DELAY - 100);
    expect(h.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.saves).toHaveLength(1);
  });
});

describe('one save in flight, and it never loses newer typing', () => {
  it('keeps edits made while a save flies and sends them next', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.pending()).toBe(1);

    h.session.update(setAlias('Kestrel Vane'));
    expect(h.session.getState().status).toBe('saving');
    // No second PATCH races the first.
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(h.saves).toHaveLength(1);

    // The first save's echo carries the OLD alias; it must not win.
    await h.settle();
    expect(h.session.getState().draft?.identity.alias).toBe('Kestrel Vane');
    expect(h.session.getState().status).toBe('dirty');

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1]!.identity.alias).toBe('Kestrel Vane');
    await h.settle();
    expect(h.session.getState().status).toBe('saved');
  });

  it('takes the GM-owned fields from an echo while keeping local typing', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.update(setAlias('Kestrel Vane'));
    const base = blankBuild('Kestrel');
    await h.settle(
      recordOf({ ...base, approvals: { 'approval-quality-lucky': 'approved' } }, { updatedAt: '2026-09-14T11:00:00.000Z' }),
    );
    const draft = h.session.getState().draft!;
    expect(draft.identity.alias).toBe('Kestrel Vane');
    expect(draft.approvals).toEqual({ 'approval-quality-lucky': 'approved' });
  });

  it('ignores a refetch older than the row it already holds', async () => {
    const h = harness();
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    // A GET that left before the PATCH and landed after it.
    h.session.receive(recordOf(blankBuild('Old Name'), { updatedAt: '2026-09-14T09:00:00.000Z' }));
    expect(h.session.getState().draft?.identity.alias).toBe('Kestrel');
  });

  it('a newer row replaces a clean draft, but never moves the page', async () => {
    const h = harness();
    h.session.goTo(4);
    await vi.advanceTimersByTimeAsync(0);
    const theirs = { ...blankBuild('Renamed Elsewhere'), step: 1 };
    h.session.receive(recordOf(theirs, { updatedAt: '2026-09-15T10:00:00.000Z' }));
    expect(h.session.getState().draft?.identity.alias).toBe('Renamed Elsewhere');
    expect(h.session.getState().draft?.step).toBe(4);
  });
});

describe('flush at the edges', () => {
  it('a step change saves at once, without waiting for the timer', async () => {
    const h = harness();
    h.session.update(setAlias('Kestrel'));
    h.session.goTo(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]).toMatchObject({ step: 2, identity: { alias: 'Kestrel' } });
  });

  it('flush sends what is pending and resolves when it is saved', async () => {
    const h = harness();
    h.session.update(setAlias('Kestrel'));
    await h.session.flush();
    expect(h.saves).toHaveLength(1);
    expect(h.session.getState().status).toBe('saved');
    // The timer it replaced does not send a duplicate.
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(h.saves).toHaveLength(1);
  });

  it('flush during a flight waits for it, then sends the newer edit', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.update(setAlias('Kestrel Vane'));
    const flushed = h.session.flush();
    await h.settle();
    expect(h.saves).toHaveLength(2);
    await h.settle();
    await flushed;
    expect(h.session.getState().status).toBe('saved');
    expect(h.saves[1]!.identity.alias).toBe('Kestrel Vane');
  });
});

describe('a build that stopped being editable', () => {
  it('a 409 stops autosave, says why, and refuses further edits', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    await h.settle(new ApiError(409, 'build_not_editable', 'not editable'));
    const s = h.session.getState();
    expect(s.status).toBe('conflict');
    expect(s.error).toMatch(/submitted or approved elsewhere/);
    h.session.update(setAlias('Ignored'));
    expect(h.session.getState().draft?.identity.alias).toBe('Kestrel');
    await vi.advanceTimersByTimeAsync(DELAY * 4);
    expect(h.saves).toHaveLength(1);
  });

  it('the refetched submitted row replaces the draft; a later return reopens it', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    await h.settle(new ApiError(409, 'build_not_editable', 'not editable'));

    const submitted = { ...blankBuild('Kestrel Vane'), state: 'submitted' as const };
    h.session.receive(recordOf(submitted, { state: 'submitted', updatedAt: '2026-09-14T12:00:00.000Z' }));
    expect(h.session.getState().draft?.state).toBe('submitted');
    expect(h.session.isWritable()).toBe(false);

    const returned = { ...blankBuild('Kestrel Vane'), state: 'returned' as const, notes: 'Pick a lifestyle.', returnedStep: 7 };
    h.session.receive(recordOf(returned, { state: 'returned', notes: 'Pick a lifestyle.', updatedAt: '2026-09-14T13:00:00.000Z' }));
    const s = h.session.getState();
    expect(s.status).toBe('idle');
    expect(s.draft?.notes).toBe('Pick a lifestyle.');
    expect(h.session.isWritable()).toBe(true);
    h.session.update(setAlias('Kestrel Vane II'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.saves).toHaveLength(2);
  });

  it('a submit seen by refetch while edits are unsaved says they were not saved', () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    const submitted = { ...blankBuild(), state: 'submitted' as const };
    h.session.receive(recordOf(submitted, { state: 'submitted', updatedAt: '2026-09-14T12:00:00.000Z' }));
    const s = h.session.getState();
    expect(s.status).toBe('conflict');
    expect(s.error).toMatch(/not saved/);
    expect(s.draft?.identity.alias).toBe('Kestrel Vane');
  });

  it('any other failure is an error the next edit retries', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    await h.settle(new ApiError(500, 'internal', 'the host fell over'));
    expect(h.session.getState().status).toBe('error');
    expect(h.session.getState().error).toBe('the host fell over');
    h.session.update(setAlias('Kestrel Vane'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.saves).toHaveLength(2);
  });
});

describe('a writer who is not the owner (a GM opening a player draft)', () => {
  it('moves between steps and modes without saving anything', async () => {
    const h = harness();
    h.session.setOwnsNavigation(false);
    h.session.goTo(5);
    h.session.setMode('free');
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(h.saves).toHaveLength(0);
    expect(h.session.getState().draft).toMatchObject({ step: 5, mode: 'free' });
  });

  it("an edit they save keeps the owner's step and mode", async () => {
    const h = harness();
    h.session.setOwnsNavigation(false);
    h.session.goTo(6);
    h.session.update(setAlias('Kestrel (GM fix)'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]).toMatchObject({ step: 1, mode: 'guided', identity: { alias: 'Kestrel (GM fix)' } });
    expect(h.session.getState().draft?.step).toBe(6);
  });
});

describe('read-only viewers', () => {
  it('a device that may not write edits nothing and saves nothing, but can move between steps', async () => {
    const h = harness({ canWrite: false });
    h.session.update(setAlias('Nope'));
    expect(h.session.getState().draft?.identity.alias).toBe('Kestrel Vane');
    h.session.goTo(6);
    expect(h.session.getState().draft?.step).toBe(6);
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(h.saves).toHaveLength(0);
  });

  it('a submitted build is read-only even for its owner', async () => {
    const h = harness({ initial: { ...blankBuild(), state: 'submitted' } });
    h.session.update(setAlias('Nope'));
    h.session.setMode('free');
    expect(h.session.getState().draft?.mode).toBe('free');
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(h.saves).toHaveLength(0);
  });
});

describe('a save answer never goes back in time', () => {
  it('an older PATCH answer landing after a newer submitted row keeps the build submitted', async () => {
    const onSaved = vi.fn();
    const h = harness({ manual: true, onSaved });
    h.session.update(setAlias('Typed'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.pending()).toBe(1);

    // The PATCH committed at 10:00:01; another device submitted at 10:00:02,
    // and the refetch that event caused lands before the PATCH's answer.
    const submitted = { ...blankBuild('Typed'), state: 'submitted' as const };
    h.session.receive(recordOf(submitted, { state: 'submitted', updatedAt: '2026-09-14T10:00:02.000Z' }));
    // The flying edit may well have committed: nothing is declared lost yet.
    expect(h.session.getState().status).toBe('saving');
    expect(h.session.getState().error).toBeNull();
    expect(h.session.isWritable()).toBe(false);

    await h.settle(recordOf(blankBuild('Typed'), { updatedAt: '2026-09-14T10:00:01.000Z' }));
    const s = h.session.getState();
    expect(s.draft?.state).toBe('submitted');
    expect(s.server?.state).toBe('submitted');
    expect(s.server?.updatedAt).toBe('2026-09-14T10:00:02.000Z');
    expect(s.status).toBe('saved');
    expect(h.session.isWritable()).toBe(false);
    // The query cache is not handed the older row either.
    expect(onSaved).not.toHaveBeenCalled();

    // An echo of the older row changes nothing.
    h.session.receive(recordOf(blankBuild('Typed'), { updatedAt: '2026-09-14T10:00:01.000Z' }));
    expect(h.session.getState().draft?.state).toBe('submitted');
  });

  it('a submit seen while a save flies: a 409 answer then says the edit was not saved', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Typed'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.receive(
      recordOf({ ...blankBuild(), state: 'submitted' }, { state: 'submitted', updatedAt: '2026-09-14T10:00:02.000Z' }),
    );
    expect(h.session.getState().status).toBe('saving');
    await h.settle(new ApiError(409, 'build_not_editable', 'not editable'));
    expect(h.session.getState().status).toBe('conflict');
    expect(h.session.getState().error).toMatch(/not saved/);
  });

  it('edits typed after the flying save are lost at a freeze, and it says so at once', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Typed'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.update(setAlias('Typed more'));
    h.session.receive(
      recordOf({ ...blankBuild('Typed'), state: 'submitted' }, { state: 'submitted', updatedAt: '2026-09-14T10:00:02.000Z' }),
    );
    expect(h.session.getState().status).toBe('conflict');
    await h.settle(recordOf(blankBuild('Typed'), { updatedAt: '2026-09-14T10:00:01.000Z' }));
    // The flight's clean answer does not clear the sentence about the later edit.
    expect(h.session.getState().status).toBe('conflict');
    expect(h.session.getState().draft?.state).toBe('submitted');
  });

  it("a GM's newer decision seen mid-flight survives the save's older answer", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Typed'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.receive(
      recordOf(
        { ...blankBuild('Typed'), approvals: { 'approval-quality-lucky': 'approved' } },
        { updatedAt: '2026-09-14T10:00:02.000Z' },
      ),
    );
    await h.settle(recordOf(blankBuild('Typed'), { updatedAt: '2026-09-14T10:00:01.000Z' }));
    const s = h.session.getState();
    expect(s.draft?.approvals).toEqual({ 'approval-quality-lucky': 'approved' });
    expect(s.server?.updatedAt).toBe('2026-09-14T10:00:02.000Z');
    expect(s.status).toBe('saved');
    expect(h.session.isWritable()).toBe(true);
  });

  it("another device's newer save seen mid-flight becomes the draft once nothing here is unsaved", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('From this phone'));
    await vi.advanceTimersByTimeAsync(DELAY);
    // The tablet saved after this PATCH committed; its refetch lands first.
    h.session.receive(recordOf(blankBuild('From the tablet'), { updatedAt: '2026-09-14T10:00:02.000Z' }));
    // Still flying: the typing on screen is kept.
    expect(h.session.getState().draft?.identity.alias).toBe('From this phone');
    await h.settle(recordOf(blankBuild('From this phone'), { updatedAt: '2026-09-14T10:00:01.000Z' }));
    // The server holds the tablet's record; so does the page now.
    expect(h.session.getState().draft?.identity.alias).toBe('From the tablet');
    expect(h.session.getState().status).toBe('saved');
  });

  it('at the same instant, a frozen row outranks an editable one', () => {
    const at = '2026-09-14T10:00:01.000Z';
    expect(supersedes({ updatedAt: at, state: 'draft' }, { updatedAt: at, state: 'submitted' })).toBe(false);
    expect(supersedes({ updatedAt: at, state: 'submitted' }, { updatedAt: at, state: 'draft' })).toBe(true);
    expect(supersedes({ updatedAt: at, state: 'draft' }, null)).toBe(true);
  });
});

describe('flush says whether it saved', () => {
  it('resolves saved on success, and not saved when the PATCH failed', async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Kestrel'));
    const ok = h.session.flush();
    await h.settle();
    await expect(ok).resolves.toMatchObject({ saved: true, status: 'saved' });

    h.session.update(setAlias('Kestrel Vane'));
    const failed = h.session.flush();
    await h.settle(new ApiError(0, 'network_error', 'Failed to fetch'));
    await expect(failed).resolves.toEqual({ saved: false, status: 'error', error: 'Failed to fetch' });
  });

  it('a device with nothing to save has saved', async () => {
    const h = harness({ canWrite: false });
    await expect(h.session.flush()).resolves.toMatchObject({ saved: true });
  });
});

describe('leaving the page', () => {
  it('warns only when an edit no save carries would be dropped', async () => {
    const h = harness({ manual: true });
    expect(h.session.shouldWarnOnLeave()).toBe(false);
    h.session.update(setAlias('Kestrel'));
    // A flush at the edge carries this one (keepalive): no warning needed.
    void h.session.flush();
    expect(h.pending()).toBe(1);
    expect(h.session.shouldWarnOnLeave()).toBe(false);
    // Typed while that save flies: nothing carries it yet.
    h.session.update(setAlias('Kestrel Vane'));
    expect(h.session.shouldWarnOnLeave()).toBe(true);
    await h.settle(new ApiError(500, 'internal', 'the host fell over'));
    expect(h.session.getState().status).toBe('error');
    expect(h.session.shouldWarnOnLeave()).toBe(true);
  });
});

describe('identity is kept when nothing changed', () => {
  it("a save's answer and the cache's echo of it keep the draft object", async () => {
    let stored: BuildRecord | null = null;
    const h = harness({ onSaved: (r) => (stored = r) });
    h.session.update(setAlias('Kestrel'));
    const typed = h.session.getState().draft;
    await h.session.flush();
    expect(h.session.getState().draft).toBe(typed);
    expect(stored).not.toBeNull();
    // useBuild feeds the cached copy back; the cache may hand over a new object for the same row.
    const echo: BuildRecord = { ...stored!, build: { ...stored!.build } };
    h.session.receive(echo);
    expect(h.session.getState().draft).toBe(typed);
  });

  it('withServerFields returns the same draft when the GM-owned fields did not move', () => {
    const draft = blankBuild();
    expect(withServerFields(draft, recordOf({ ...draft, approvals: {} }))).toBe(draft);
    const moved = withServerFields(draft, recordOf({ ...draft, notes: 'Pick a lifestyle.' }));
    expect(moved).not.toBe(draft);
    expect(moved.notes).toBe('Pick a lifestyle.');
  });

  it('a genuinely newer row still replaces a clean draft', () => {
    const h = harness();
    const before = h.session.getState().draft;
    h.session.receive(recordOf(blankBuild('Renamed'), { updatedAt: '2026-09-14T10:30:00.000Z' }));
    expect(h.session.getState().draft).not.toBe(before);
    expect(h.session.getState().draft?.identity.alias).toBe('Renamed');
  });
});

describe('two devices never overwrite each other in silence (rule 7)', () => {
  const OPENED = '2026-09-14T10:00:00.000Z';
  /** Another device's save of the same build: its alias, at a later instant. */
  const theirs = (alias: string, updatedAt: string) => recordOf(blankBuild(alias), { updatedAt });

  it('every save names the row its draft was built on, and the base follows the saves that land', async () => {
    const h = harness();
    expect(h.session.getState().baseUpdatedAt).toBe(OPENED);
    h.session.update(setAlias('Kestrel'));
    await vi.advanceTimersByTimeAsync(DELAY);
    h.session.update(setAlias('Kestrel V'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.bases).toEqual([OPENED, '2026-09-14T10:00:01.000Z']);
    expect(h.session.getState().baseUpdatedAt).toBe('2026-09-14T10:00:02.000Z');
  });

  it("a newer row with someone else's edits does not move the base under unsaved typing; the refused save keeps the typing on screen", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Mine'));
    // The tablet's save reaches this device (a build.saved refetch) before the phone's timer fires.
    h.session.receive(theirs('Theirs', '2026-09-14T10:00:05.000Z'));
    expect(h.session.getState().draft?.identity.alias).toBe('Mine');
    expect(h.session.getState().baseUpdatedAt).toBe(OPENED);

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.bases).toEqual([OPENED]);
    await h.settle(new BuildStaleError('saved elsewhere', theirs('Theirs', '2026-09-14T10:00:05.000Z')));

    const s = h.session.getState();
    expect(s.status).toBe('conflict');
    expect(s.stale).toBe(true);
    expect(s.error).toBe(STALE_MESSAGE);
    expect(s.draft?.identity.alias).toBe('Mine');
    expect(s.server?.build.identity.alias).toBe('Theirs');
    // Read-only until the player chooses; nothing more is sent, and leaving would lose the typing.
    expect(h.session.isWritable()).toBe(false);
    h.session.update(setAlias('Mine, more'));
    expect(h.session.getState().draft?.identity.alias).toBe('Mine');
    await vi.advanceTimersByTimeAsync(DELAY * 4);
    expect(h.saves).toHaveLength(1);
    expect(h.session.shouldWarnOnLeave()).toBe(true);

    // The refetch the conflict asks for brings an even newer row: it becomes the server's, the typing stays.
    h.session.receive(theirs('Theirs again', '2026-09-14T10:00:09.000Z'));
    expect(h.session.getState().server?.build.identity.alias).toBe('Theirs again');
    expect(h.session.getState().draft?.identity.alias).toBe('Mine');
    expect(h.session.getState().stale).toBe(true);
  });

  it("'take theirs' drops the typing for the newer row and autosave resumes from it", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Mine'));
    await vi.advanceTimersByTimeAsync(DELAY);
    await h.settle(new BuildStaleError('saved elsewhere', theirs('Theirs', '2026-09-14T10:00:05.000Z')));

    const done = await h.session.resolveStale('theirs');
    expect(done.saved).toBe(true);
    const s = h.session.getState();
    expect(s).toMatchObject({ stale: false, status: 'idle', error: null, baseUpdatedAt: '2026-09-14T10:00:05.000Z' });
    expect(s.draft?.identity.alias).toBe('Theirs');
    expect(h.saves).toHaveLength(1);
    h.session.update(setAlias('Theirs, fixed'));
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.bases).toEqual([OPENED, '2026-09-14T10:00:05.000Z']);
  });

  it("'keep mine' saves the typing over the newer row, built on that row", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Mine'));
    await vi.advanceTimersByTimeAsync(DELAY);
    // No row came with the refusal: the refetch brings it.
    await h.settle(new BuildStaleError('saved elsewhere', null));
    expect(h.session.getState().stale).toBe(true);
    h.session.receive(theirs('Theirs', '2026-09-14T10:00:05.000Z'));

    const saving = h.session.resolveStale('mine');
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1]!.identity.alias).toBe('Mine');
    expect(h.bases[1]).toBe('2026-09-14T10:00:05.000Z');
    // The server takes it over the newer row, so its answer is later still.
    await h.settle(recordOf(blankBuild('Mine'), { updatedAt: '2026-09-14T10:00:06.000Z' }));
    expect((await saving).saved).toBe(true);
    expect(h.session.getState()).toMatchObject({ stale: false, status: 'saved' });
    expect(h.session.getState().draft?.identity.alias).toBe('Mine');
  });

  it("a newer row that changed only the GM's decisions or the page moves the base, so the save is not refused", async () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Mine'));
    const decided = recordOf({ ...blankBuild(), approvals: { 'approval-quality-lucky': 'approved' }, step: 4 }, { updatedAt: '2026-09-14T10:00:05.000Z' });
    expect(contentKey(decided.build)).toBe(contentKey(blankBuild()));
    h.session.receive(decided);
    expect(h.session.getState().baseUpdatedAt).toBe('2026-09-14T10:00:05.000Z');
    expect(h.session.getState().draft?.approvals).toEqual({ 'approval-quality-lucky': 'approved' });
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(h.bases).toEqual(['2026-09-14T10:00:05.000Z']);
  });

  it('a stale refusal is not a submit: the build freezing later still says the typing was lost', () => {
    const h = harness({ manual: true });
    h.session.update(setAlias('Mine'));
    return vi.advanceTimersByTimeAsync(DELAY).then(async () => {
      await h.settle(new BuildStaleError('saved elsewhere', null));
      const submitted = { ...blankBuild('Theirs'), state: 'submitted' as const };
      h.session.receive(recordOf(submitted, { state: 'submitted', updatedAt: '2026-09-14T10:00:07.000Z' }));
      const s = h.session.getState();
      expect(s.stale).toBe(false);
      expect(s.status).toBe('conflict');
      expect(s.error).toMatch(/not saved/);
      expect(s.draft?.state).toBe('submitted');
    });
  });
});
