/**
 * The build session: the draft a walkthrough edits, and its autosave (FR3.9,
 * docs/CHARGEN.md §4.4 "Autosave on every change", §8.6 "autosaves with a
 * debounced PATCH").
 *
 * A plain store — `getState`, `subscribe`, and a handful of commands — with
 * no React in it, so the rules that make autosave safe are tested with fake
 * timers instead of trusted to a component (`useBuild` is a thin wrapper
 * over `useSyncExternalStore`). Those rules, and the defects each prevents:
 *
 * 1. **Edits are local first.** `update(fn)` applies a pure updater to the
 *    draft at once and bumps a revision; the rail reads the new record in
 *    the same render. The save is scheduled `delayMs` later and every
 *    further edit pushes it back, so typing an alias is one PATCH, not
 *    twelve.
 * 2. **One PATCH in flight, always the newest record.** A save carries the
 *    revision it was cut from. Edits made while it flies are not lost and
 *    not raced: when it lands, a newer revision schedules (or, under a
 *    flush, immediately sends) the next save.
 * 3. **The server's echo never overwrites newer typing, and never goes back
 *    in time.** A save's response, or a refetch the WebSocket triggered,
 *    replaces the draft only when nothing local is unsaved. Otherwise only
 *    the GM-owned fields (state, notes, approvals, returned step) are taken
 *    from it. A row older than the last one seen (`updatedAt`) is ignored
 *    outright, *whichever door it came through*: a GET that left before a
 *    PATCH and landed after it is stale, and so is a PATCH's own answer that
 *    lands after a refetch of a newer row — that answer only tells us the
 *    save committed. Without the second half, a save that raced a submit on
 *    another device reopened the submitted build as an editable draft, and
 *    the next edit was refused and lost. A submit seen while a save is still
 *    flying does not declare the flying edit lost either: the save's own
 *    answer (committed, or refused with 409) decides.
 * 4. **Flush at the edges.** Changing step saves at once (§8.6), as does
 *    leaving the page (`flush` on unmount, on a hidden tab and on
 *    `pagehide`), so closing a tab a moment after an edit does not drop it.
 *    The PATCH goes out with `keepalive` (`patchBuild`), so the browser lets
 *    it finish after the page is gone; the window that remains — edits typed
 *    while a save is already flying, or a save that failed — is what
 *    `shouldWarnOnLeave` asks the browser to confirm.
 * 5. **A build that stopped being editable says so.** When the server
 *    refuses a save because the build was submitted, approved, deleted or is
 *    not this device's to write (409, 423, 403, 404), autosave stops and the
 *    status is `conflict` with a sentence saying what happened; the caller
 *    refetches, and the fresh row replaces the draft. Other failures are
 *    `error`: the draft stays dirty and the next edit (or `retry`) tries
 *    again. `flush` resolves with whether everything reached the server, so
 *    an action that must not run over unsaved work (Submit) can refuse.
 * 6. **Nothing changes identity for nothing.** A save's answer, and the query
 *    cache's echo of it, carry the record the draft already is; the draft
 *    object is kept, so the analysis (memoised on identity) and the step
 *    screen are not recomputed after every autosave.
 * 7. **Two devices never overwrite each other in silence.** Every save names
 *    the row its draft was built on (`baseUpdatedAt`), and the server refuses
 *    one whose row has moved on with `409 build_stale` and the row as it now
 *    stands. The base is the row the draft's *content* was last in step
 *    with: it moves when a row is adopted as the draft, when a save lands,
 *    and when a newer row differs from the base only in what the draft never
 *    carries (the GM's decisions, the page on screen) — but not when a newer
 *    row with someone else's edits arrives while this device has typing of
 *    its own, because saving that typing over the newer row is exactly what
 *    must not happen unasked. A stale refusal is a conflict that keeps the
 *    typing on screen (read-only) beside the newer row, says so, and waits
 *    for the player: `resolveStale('mine')` saves this device's record over
 *    the newer one, `resolveStale('theirs')` drops it for the newer one.
 *    Without the precondition, a GM's tap on a player's draft opened ten
 *    minutes earlier replaced ten minutes of the player's work.
 *
 * The step on screen is part of the record (`step`, "where the walkthrough
 * was") but it is *the viewer's*: a refetch never moves the page, and a
 * read-only viewer (a GM reviewing, a submitted build) navigates without
 * saving anything. The same holds for anyone who is not the build's owner
 * (`ownsNavigation: false` — a GM opening a player's draft): moving between
 * steps or switching guided/free stays on that device, and an edit they do
 * save carries the server's step and mode, not theirs. Otherwise a GM who only
 * looked would PATCH their copy of the record — possibly older than the
 * player's last edit — just by pressing Next, and move the player's resume
 * point besides.
 */
import { BUILD_STALE_CODE, type BuildMode, type BuildStep, type BuildWritable, type CharacterBuild } from '@safehouse/contracts';
import { ApiError } from '../../api/client.js';
import type { BuildRecord } from './api.js';
import { isEditableState, writableBuild } from './lib.js';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export type BuildUpdater = (build: CharacterBuild) => CharacterBuild;

export interface BuildSessionState {
  buildId: string;
  /** The last row the server sent (or a save returned). */
  server: BuildRecord | null;
  /** The record the page renders and edits. Null until the first read. */
  draft: CharacterBuild | null;
  /** Bumped by every local change that needs saving. */
  revision: number;
  /** The newest revision the server has acknowledged. */
  savedRevision: number;
  status: SaveStatus;
  /** The sentence behind `error` / `conflict`. */
  error: string | null;
  /** `now()` of the last acknowledged save. */
  lastSavedAt: number | null;
  /** Whether this device may write at all (role and ownership), before state is considered. */
  canWrite: boolean;
  /** Whether step and mode changes are this device's to save (the owner's), or local only. */
  ownsNavigation: boolean;
  /** The `updatedAt` of the row the draft's content was built on — every save's precondition. */
  baseUpdatedAt: string | null;
  /**
   * A save was refused because another device saved first (`409 build_stale`):
   * the draft still shows this device's edits, `server` the newer row, and
   * nothing saves until `resolveStale` says which one stands.
   */
  stale: boolean;
}

export interface BuildSessionDeps {
  buildId: string;
  /**
   * The PATCH, with the `updatedAt` of the row the record was built on. Resolves
   * with the row the server now holds; rejects with a `409 build_stale`
   * (`BuildStaleError`, carrying the row as `current`) when the server's row
   * has moved on since `baseUpdatedAt`.
   */
  save: (buildId: string, build: BuildWritable, baseUpdatedAt: string | null) => Promise<BuildRecord>;
  /** Told about every row a save returned, so caches can be updated. */
  onSaved?: (record: BuildRecord) => void;
  /** Debounce for autosave. */
  delayMs?: number;
  canWrite?: boolean;
  /** Default true. False for a writer who is not the owner (see the file header). */
  ownsNavigation?: boolean;
  now?: () => number;
}

export const AUTOSAVE_DELAY_MS = 800;

export interface BuildSession {
  getState(): BuildSessionState;
  subscribe(listener: () => void): () => void;
  /** A row from the server: first load, a refetch, or a mutation's answer. */
  receive(record: BuildRecord): void;
  /** Apply a pure updater to the draft. Refused (a no-op) when the build is read-only. */
  update(fn: BuildUpdater): void;
  /** Move to a step; saves at once when the build is writable. */
  goTo(step: BuildStep): void;
  setMode(mode: BuildMode): void;
  setCanWrite(canWrite: boolean): void;
  setOwnsNavigation(owns: boolean): void;
  /** Whether `update` would be accepted right now. */
  isWritable(): boolean;
  /** Send whatever is unsaved now; resolves when it is saved or has failed, and says which. */
  flush(): Promise<FlushResult>;
  /** Clear an `error` and try again. */
  retry(): Promise<FlushResult>;
  /**
   * After a stale refusal: `'mine'` saves this device's record over the newer
   * row; `'theirs'` replaces the draft with the newer row. A no-op otherwise.
   */
  resolveStale(choice: 'mine' | 'theirs'): Promise<FlushResult>;
  /**
   * Whether leaving now would drop edits no save carries: a save failed, or
   * edits were typed while a save was already flying (`keepalive` carries the
   * flying save and one a flush starts at the edge, not a second queued
   * behind it).
   */
  shouldWarnOnLeave(): boolean;
  /** Cancel the pending timer. The session stays usable (StrictMode remounts). */
  dispose(): void;
}

/** What a `flush` achieved. */
export interface FlushResult {
  /** Nothing this device holds is unsaved, and the last save did not fail. */
  saved: boolean;
  status: SaveStatus;
  error: string | null;
}

/** Statuses the server uses to say "this build is not yours to change now". */
const CONFLICT_STATUSES = new Set([403, 404, 409, 423]);

/**
 * A save refused because the server's row moved on since the one the record
 * was built on (`409 build_stale`). `patchBuild` rejects with a
 * `BuildStaleError` (api.ts) carrying that row as `current` when it could be
 * read; the session reads it structurally, so this module stays free of the
 * data layer.
 */
export function isStale(err: unknown): err is ApiError & { current?: BuildRecord | null } {
  return err instanceof ApiError && err.status === 409 && err.code === BUILD_STALE_CODE;
}

/** Said while a stale refusal waits on the player. */
export const STALE_MESSAGE =
  'This build was saved from another device while you were editing. Your changes are still on screen but not saved: keep yours to save them over the other version, or take theirs.';

/** The sentence a refused save shows. */
export function conflictMessage(err: ApiError): string {
  if (err.status === 404) return 'This build no longer exists on the server; nothing more will be saved.';
  if (err.status === 403) return 'This device cannot change this build; your last changes were not saved.';
  return 'This build was submitted or approved elsewhere and can no longer be changed here; your last changes were not saved.';
}

export function isConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && CONFLICT_STATUSES.has(err.status);
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Whether `next` may replace `held` as the row this device believes: newer,
 * or the same instant unless it would thaw a frozen row (a save never follows
 * a submit — the server refuses it — so at a tie the frozen row is the later).
 */
export function supersedes(
  next: Pick<BuildRecord, 'updatedAt' | 'state'>,
  held: Pick<BuildRecord, 'updatedAt' | 'state'> | null,
): boolean {
  if (!held) return true;
  const a = time(next.updatedAt);
  const b = time(held.updatedAt);
  if (a !== b) return a > b;
  return !(isEditableState(next.state) && !isEditableState(held.state));
}

/**
 * What of a record a save carries and another device's save would change:
 * the writable record without the page on screen and the mode, which are
 * each viewer's. Two rows with the same key differ only in what the draft
 * never holds of its own (the GM's decisions, a step), so a base can move
 * across them without hiding anyone's edits.
 */
export function contentKey(build: CharacterBuild): string {
  const { step: _step, mode: _mode, ...content } = writableBuild(build);
  return JSON.stringify(content);
}

function sameApprovals(a: CharacterBuild['approvals'], b: CharacterBuild['approvals']): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** The GM-owned fields of a row laid over a local draft — the same draft object when none of them moved. */
export function withServerFields(draft: CharacterBuild, record: BuildRecord): CharacterBuild {
  const b = record.build;
  if (
    draft.state === b.state &&
    draft.notes === b.notes &&
    draft.returnedStep === b.returnedStep &&
    sameApprovals(draft.approvals, b.approvals)
  ) {
    return draft;
  }
  return { ...draft, state: b.state, notes: b.notes, approvals: b.approvals, returnedStep: b.returnedStep };
}

/** Said when the build froze while a save flew, and the save then failed without the server saying why. */
const UNCONFIRMED_MESSAGE =
  'This build was submitted or approved before your last changes were confirmed; they may not have been saved.';

export function createBuildSession(deps: BuildSessionDeps): BuildSession {
  const delay = deps.delayMs ?? AUTOSAVE_DELAY_MS;
  const now = deps.now ?? (() => Date.now());
  let state: BuildSessionState = {
    buildId: deps.buildId,
    server: null,
    draft: null,
    revision: 0,
    savedRevision: 0,
    status: 'idle',
    error: null,
    lastSavedAt: null,
    canWrite: deps.canWrite ?? true,
    ownsNavigation: deps.ownsNavigation ?? true,
    baseUpdatedAt: null,
    stale: false,
  };
  const listeners = new Set<() => void>();
  /** `contentKey` of the base row, so a newer row that changed nothing of the record can move the base. */
  let baseKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  /** The revision the flying save carries. */
  let inFlightRevision = 0;

  function set(patch: Partial<BuildSessionState>): void {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  }

  /** The base as a patch: this row is what the draft's content is now built on. */
  function rebase(record: BuildRecord): Pick<BuildSessionState, 'baseUpdatedAt'> {
    baseKey = contentKey(record.build);
    return { baseUpdatedAt: record.updatedAt };
  }

  /** Rebase onto a row only when it carries the same record content as the base. */
  function rebaseIfSameContent(record: BuildRecord): Partial<Pick<BuildSessionState, 'baseUpdatedAt'>> {
    return baseKey !== null && contentKey(record.build) === baseKey ? rebase(record) : {};
  }

  /** A server row as the draft, keeping the viewer's page (and a non-owner's mode). */
  const fromServer = (record: BuildRecord, draft: CharacterBuild): CharacterBuild => ({
    ...record.build,
    step: draft.step,
    ...(state.ownsNavigation ? {} : { mode: draft.mode }),
  });

  const unsaved = () => state.revision > state.savedRevision;
  const writable = () =>
    state.canWrite && state.draft !== null && state.status !== 'conflict' && isEditableState(state.draft.state);

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void startSave();
    }, delay);
  }

  function startSave(): Promise<void> {
    if (inFlight) return inFlight;
    if (!unsaved() || !writable() || !state.draft) return Promise.resolve();
    cancelTimer();
    const revision = state.revision;
    const mine = writableBuild(state.draft);
    const server = state.server?.build;
    const body = state.ownsNavigation || !server ? mine : { ...mine, step: server.step, mode: server.mode };
    set({ status: 'saving', error: null });
    inFlightRevision = revision;
    inFlight = deps
      .save(state.buildId, body, state.baseUpdatedAt)
      .then(
        (record) => {
          const savedRevision = Math.max(state.savedRevision, revision);
          const status: SaveStatus =
            state.status === 'conflict' ? 'conflict' : state.revision > savedRevision ? 'dirty' : 'saved';
          const error = status === 'conflict' ? state.error : null;
          const held = state.server;
          if (!supersedes(record, held)) {
            // A newer row arrived while this save flew (a refetch after a
            // submit, a GM's decision, another device's save). The answer only
            // says the save committed: the newer row stands, and the query
            // cache is not handed the older one. With nothing newer typed
            // here, the draft becomes that row — it was kept as this device's
            // typing only while the save was unanswered.
            const adopt = status === 'saved' && held !== null && state.draft !== null && isEditableState(held.state);
            // The save's row is the draft's content now; the newer row is too
            // when the draft becomes it, or when it changed nothing of the
            // record (a GM's decision).
            const sameContent = held !== null && contentKey(held.build) === contentKey(record.build);
            set({
              savedRevision,
              lastSavedAt: now(),
              status,
              error,
              ...(held !== null && (adopt || sameContent) ? rebase(held) : rebase(record)),
              ...(adopt && state.draft && held ? { draft: fromServer(held, state.draft) } : {}),
            });
            return;
          }
          set({
            server: record,
            savedRevision,
            lastSavedAt: now(),
            status,
            error,
            ...rebase(record),
            // Keep the typing; take the GM's fields. When nothing newer was
            // typed, the local draft is already what was sent.
            draft: state.draft ? withServerFields(state.draft, record) : record.build,
          });
          deps.onSaved?.(record);
        },
        (err: unknown) => {
          if (state.status === 'conflict') return;
          const frozen = state.draft !== null && !isEditableState(state.draft.state);
          if (isStale(err)) {
            // Another device saved first. Keep this device's typing on screen,
            // take the newer row as the server's, and wait for the player.
            cancelTimer();
            const current = err.current ?? null;
            const newer = current !== null && current.id === state.buildId && supersedes(current, state.server) ? current : null;
            set({
              status: 'conflict',
              stale: true,
              error: STALE_MESSAGE,
              ...(newer ? { server: newer, ...(state.draft ? { draft: withServerFields(state.draft, newer) } : {}) } : {}),
            });
            return;
          }
          if (isConflict(err)) {
            cancelTimer();
            set({ status: 'conflict', error: conflictMessage(err) });
          } else if (frozen) {
            set({ status: 'conflict', error: UNCONFIRMED_MESSAGE });
          } else {
            set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
          }
        },
      )
      .finally(() => {
        inFlight = null;
        if (state.status === 'dirty' && unsaved() && writable() && timer === null) schedule();
      });
    return inFlight;
  }

  const outcome = (): FlushResult => ({
    saved: !unsaved() && state.status !== 'error' && state.status !== 'conflict',
    status: state.status,
    error: state.error,
  });

  async function flush(): Promise<FlushResult> {
    // Bounded: each pass either saves the newest revision or stops on a failure.
    for (let pass = 0; pass < 4; pass++) {
      cancelTimer();
      if (inFlight) {
        await inFlight;
        continue;
      }
      if (!unsaved() || !writable()) break;
      await startSave();
      if (state.status === 'error' || state.status === 'conflict') break;
    }
    return outcome();
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    receive(record) {
      if (record.id !== state.buildId) return;
      const prior = state.server;
      if (!supersedes(record, prior)) return;
      const draft = state.draft;
      if (!draft) {
        set({ server: record, draft: record.build, ...rebase(record) });
        return;
      }
      // The same row again — usually the query cache echoing a save's own
      // answer: the draft already is it, so its identity is kept.
      const sameRow = prior !== null && prior.updatedAt === record.updatedAt && prior.state === record.state;
      if (!isEditableState(record.state)) {
        // Frozen on the server: show what the server holds, keep the viewer's
        // page. Edits no save carries cannot be kept anywhere, so say they
        // were lost. An edit a save is carrying right now may well have
        // committed before the freeze: that save's answer decides.
        cancelTimer();
        const lost = inFlight ? state.revision > inFlightRevision : unsaved();
        set({
          server: record,
          draft: sameRow && draft.state === record.build.state ? draft : { ...record.build, step: draft.step },
          savedRevision: state.revision,
          stale: false,
          ...rebase(record),
          ...(lost
            ? {
                status: 'conflict' as const,
                error: 'This build was submitted or approved elsewhere; your last changes were not saved.',
              }
            : state.status === 'conflict' || inFlight
              ? {}
              : { status: 'idle' as const, error: null }),
        });
        return;
      }
      if (state.stale) {
        // Waiting on the player after a stale refusal: the newer row is the
        // server's, the typing stays on screen until `resolveStale`.
        set({ server: record, draft: withServerFields(draft, record) });
        return;
      }
      if (state.status === 'conflict') {
        // Editable again (a GM returned it, or the refusal was transient):
        // the refused edits are gone, as the conflict sentence said; start
        // clean from the server's record and let autosave resume.
        set({
          server: record,
          draft: { ...record.build, step: draft.step },
          savedRevision: state.revision,
          status: 'idle',
          error: null,
          ...rebase(record),
        });
        return;
      }
      if (unsaved() || inFlight) {
        // This device's typing stands; the base moves only across a row that
        // changed nothing of the record (rule 7).
        set({ server: record, draft: withServerFields(draft, record), ...rebaseIfSameContent(record) });
        return;
      }
      if (sameRow && draft.state === record.build.state) {
        if (record !== prior) set({ server: record, ...rebase(record) });
        return;
      }
      set({
        server: record,
        draft: fromServer(record, draft),
        ...rebase(record),
      });
    },

    update(fn) {
      if (!writable() || !state.draft) return;
      const next = fn(state.draft);
      if (next === state.draft) return;
      set({ draft: next, revision: state.revision + 1, status: state.status === 'saving' ? 'saving' : 'dirty' });
      if (!inFlight) schedule();
    },

    goTo(step) {
      if (!state.draft || state.draft.step === step) return;
      if (!writable() || !state.ownsNavigation) {
        set({ draft: { ...state.draft, step } });
        return;
      }
      set({ draft: { ...state.draft, step }, revision: state.revision + 1 });
      void flush();
    },

    setMode(mode) {
      if (!state.draft || state.draft.mode === mode) return;
      if (!writable() || !state.ownsNavigation) {
        set({ draft: { ...state.draft, mode } });
        return;
      }
      set({ draft: { ...state.draft, mode }, revision: state.revision + 1 });
      void flush();
    },

    setCanWrite(canWrite) {
      if (canWrite !== state.canWrite) set({ canWrite });
    },

    setOwnsNavigation(owns) {
      if (owns !== state.ownsNavigation) set({ ownsNavigation: owns });
    },

    isWritable: writable,

    flush,

    retry() {
      if (state.status === 'error') set({ status: 'dirty', error: null });
      return flush();
    },

    resolveStale(choice) {
      const { draft, server } = state;
      if (!state.stale || !draft || !server) return Promise.resolve(outcome());
      if (choice === 'theirs') {
        set({
          stale: false,
          status: 'idle',
          error: null,
          draft: fromServer(server, draft),
          savedRevision: state.revision,
          ...rebase(server),
        });
        return Promise.resolve(outcome());
      }
      // Mine: the same record, now built on the newer row, saved at once.
      set({
        stale: false,
        status: 'dirty',
        error: null,
        draft: withServerFields(draft, server),
        revision: Math.max(state.revision, state.savedRevision + 1),
        ...rebase(server),
      });
      return flush();
    },

    shouldWarnOnLeave() {
      // Typing a stale refusal holds on screen goes nowhere until the player chooses.
      if (state.stale && unsaved()) return true;
      if (!unsaved() || !writable()) return false;
      return state.status === 'error' || (inFlight !== null && state.revision > inFlightRevision);
    },

    dispose() {
      cancelTimer();
    },
  };
}
