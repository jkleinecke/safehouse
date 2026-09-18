/**
 * `useBuild`'s own decisions (docs/CHARGEN.md §8.5 "owner or GM", §8.6; web
 * map pitfall "getSession().userId may be undefined").
 *
 * The hook is a thin React edge over `session.ts` and `analysis.ts`, each
 * tested on its own; what it adds is pinned here as plain functions, because
 * node renders no effects:
 *
 * - **who writes** — a wrong answer either lets another player's phone
 *   autosave into a build, lets a GM's stale copy replace a player's work
 *   with one tap, or locks a pasted-token device out of its own runner;
 * - **the submit order** — a Submit pressed after a last edit whose save
 *   failed must not submit the older row;
 * - **the page's edges** — hiding or leaving sends what is pending, and
 *   leaving over an edit nothing carries asks first.
 *
 * The runner is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BuildCheckDto, CharacterBuild, Issue } from '@safehouse/contracts';
import { ApiError } from '../../api/client.js';
import { createBuildSession } from './session.js';
import { BUILD_ID, blankBuild, recordOf } from './testing.js';
import { SubmitBlockedError, leaveHandlers, submitWhenSaved, writerFor } from './useBuild.js';

describe('writerFor', () => {
  it("the GM reads a player's build until they turn on edit-as-GM", () => {
    expect(writerFor('gm', 'u-gm', 'u-player')).toEqual({ canWrite: false, isOwner: false, ownsNavigation: false });
    expect(writerFor('gm', 'u-gm', 'u-player', true)).toEqual({ canWrite: true, isOwner: false, ownsNavigation: false });
    // A GM's own build (a pre-generated runner) is theirs to write and resume.
    expect(writerFor('gm', 'u-gm', 'u-gm')).toEqual({ canWrite: true, isOwner: true, ownsNavigation: true });
    // A GM device that cannot prove it owns the build treats it as a player's.
    expect(writerFor('gm', undefined, 'u-player').canWrite).toBe(false);
  });

  it('a player may write their own build and not another player’s', () => {
    expect(writerFor('player', 'u-player', 'u-player').canWrite).toBe(true);
    expect(writerFor('player', 'u-else', 'u-player').canWrite).toBe(false);
    // The GM's switch means nothing on a player's device.
    expect(writerFor('player', 'u-else', 'u-player', true).canWrite).toBe(false);
  });

  it('a player device with no stored user id gets the benefit of the doubt; the server decides', () => {
    expect(writerFor('player', undefined, 'u-player')).toEqual({ canWrite: true, isOwner: true, ownsNavigation: true });
  });

  it('an observer or the table TV never writes', () => {
    expect(writerFor('observer', 'u-player', 'u-player').canWrite).toBe(false);
    expect(writerFor('display', undefined, 'u-player', true).canWrite).toBe(false);
    expect(writerFor(null, undefined, undefined).canWrite).toBe(false);
  });
});

const setAlias = (alias: string) => (b: CharacterBuild): CharacterBuild => ({ ...b, identity: { ...b.identity, alias } });

function checkOf(issues: Issue[] = []): BuildCheckDto {
  return { issues } as unknown as BuildCheckDto;
}

describe('submitWhenSaved', () => {
  it('a last edit whose save failed is not submitted over', async () => {
    const session = createBuildSession({
      buildId: BUILD_ID,
      delayMs: 10_000,
      save: () => Promise.reject(new ApiError(0, 'network_error', 'Failed to fetch')),
    });
    session.receive(recordOf(blankBuild()));
    session.update((b) => ({ ...b, identity: { ...b.identity, background: 'Grew up above a noodle bar.' } }));
    const check = vi.fn(async () => checkOf());
    const submit = vi.fn(async () => undefined);

    const attempt = submitWhenSaved({ flush: () => session.flush(), check, submit });
    await expect(attempt).rejects.toBeInstanceOf(SubmitBlockedError);
    await expect(attempt).rejects.toThrow(/did not reach the server \(Failed to fetch\)/);
    expect(check).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(session.getState().status).toBe('error');
  });

  it('a build that stopped being editable says why, in the session’s words', async () => {
    const session = createBuildSession({
      buildId: BUILD_ID,
      delayMs: 10_000,
      save: () => Promise.reject(new ApiError(409, 'build_not_editable', 'no')),
    });
    session.receive(recordOf(blankBuild()));
    session.update(setAlias('Kestrel'));
    await expect(submitWhenSaved({ flush: () => session.flush(), check: async () => checkOf(), submit: async () => undefined })).rejects.toThrow(
      /submitted or approved elsewhere/,
    );
  });

  it("stops on the server's check when it still finds errors, carrying them", async () => {
    const issue: Issue = { code: 'alias-missing', severity: 'error', step: 1, message: 'Give the runner an alias.', ref: { book: 'SR5', page: 62 } };
    const warning: Issue = { ...issue, code: 'background-missing', severity: 'warning', step: 9 };
    const submit = vi.fn(async () => undefined);
    const attempt = submitWhenSaved({
      flush: async () => ({ saved: true, status: 'saved', error: null }),
      check: async () => checkOf([issue, warning]),
      submit,
    });
    await expect(attempt).rejects.toMatchObject({ issues: [issue] });
    expect(submit).not.toHaveBeenCalled();
  });

  it('saves, checks, then submits — in that order', async () => {
    const order: string[] = [];
    let saved = 0;
    const session = createBuildSession({
      buildId: BUILD_ID,
      delayMs: 10_000,
      save: async (_id, body) => {
        order.push('save');
        saved++;
        return recordOf({ ...blankBuild(), ...body }, { updatedAt: '2026-09-14T10:00:05.000Z' });
      },
    });
    session.receive(recordOf(blankBuild()));
    session.update(setAlias('Kestrel'));
    await submitWhenSaved({
      flush: () => session.flush(),
      check: async () => {
        order.push('check');
        return checkOf();
      },
      submit: async () => {
        order.push('submit');
      },
    });
    expect(order).toEqual(['save', 'check', 'submit']);
    expect(saved).toBe(1);
  });
});

describe('leaveHandlers', () => {
  it('hiding sends what is pending; leaving warns only over an edit nothing carries', () => {
    const flush = vi.fn(async () => ({ saved: true, status: 'saved' as const, error: null }));
    let warn = false;
    const edges = leaveHandlers({ flush, shouldWarnOnLeave: () => warn });

    edges.onHidden();
    expect(flush).toHaveBeenCalledTimes(1);

    const quiet = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    edges.onBeforeUnload(quiet);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(quiet.preventDefault).not.toHaveBeenCalled();

    warn = true;
    const ask = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    edges.onBeforeUnload(ask);
    expect(ask.preventDefault).toHaveBeenCalled();
    expect(ask.returnValue).toBe('');
  });

  it('with the real session: a pending edit is sent at once when the page goes, so no warning is needed', () => {
    const bodies: unknown[] = [];
    const session = createBuildSession({
      buildId: BUILD_ID,
      delayMs: 10_000,
      save: (_id, body) => {
        bodies.push(body);
        return new Promise(() => undefined);
      },
    });
    session.receive(recordOf(blankBuild()));
    session.update(setAlias('Kestrel'));
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    leaveHandlers(session).onBeforeUnload(event);
    // Sent without waiting for the debounce.
    expect(bodies).toHaveLength(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
    // A second edit behind that flight has nothing to carry it.
    session.update(setAlias('Kestrel Vane'));
    leaveHandlers(session).onBeforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
