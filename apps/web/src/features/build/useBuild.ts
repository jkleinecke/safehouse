/**
 * `useBuild(buildId)` — one build, editable, with an instant rail (FR3.9,
 * docs/CHARGEN.md §8.6 "State").
 *
 * The hook is the React edge of three plain modules and adds no rules of its
 * own:
 *
 * - `session.ts` holds the draft and the debounced autosave (every rule about
 *   what a save or a refetch may overwrite is there, tested with fake
 *   timers);
 * - `analysis.ts` runs budgets, validate, stepStatus, eligibility, ratings and
 *   the compile/derive preview over the draft, memoised on the draft's
 *   identity;
 * - `api.ts` reads the row and the campaign's creation settings.
 *
 * What it decides is *who is looking*: the build's owner writes; a GM
 * reviewing a submitted build is in review mode, read-only and free-roaming;
 * an observer or the table TV only reads. A GM looking at a *player's* open
 * draft reads it too, in free mode, until they turn on "edit as GM" — the
 * autosave writes the whole record, so a GM whose tap wrote their copy
 * (possibly minutes older than the player's) would silently replace the
 * player's work. The GM's page follows the player's saves (`build.saved`)
 * while it looks, so the copy an edit starts from is current. When the
 * campaign's settings cannot be read (an older server, a 403) the engine runs
 * with the build's own level and table and the page says so, rather than
 * refusing to open.
 *
 * Two devices on one build (a player's phone and tablet, a GM with "edit as
 * GM" on) do not overwrite each other: every autosave names the row it was
 * built on, and when another device saved first the page keeps this device's
 * edits on screen, refetches the newer row, and asks which one stands
 * (`save.stale`, `keepMine`, `takeTheirs`; session.ts rule 7).
 *
 * Its edges — `writerFor`, `submitWhenSaved`, `leaveHandlers` — are plain
 * functions, tested without React.
 *
 * `useBuildActions` sits beside it: submit, return, approvals, approve and
 * delete, each flushing the autosave first. Submit refuses when that flush
 * did not save (a network blip on the last edit) or when the server's check
 * still finds errors, so what the GM receives is what the player last typed.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BuildCheckDto, BuildMode, BuildStep, CharacterBuild, ChargenSettings, Issue, Role } from '@safehouse/contracts';
import { getSession } from '../../api/session.js';
import { createAnalyser, type BuildAnalysis } from './analysis.js';
import {
  buildKeys,
  fetchBuildCheck,
  issuesFromError,
  patchBuild,
  settingsFromBuild,
  storeBuildRecord,
  useApproveBuild,
  useBuildCheck,
  useBuildQuery,
  useChargenSettings,
  useDeleteBuild,
  useReturnBuild,
  useSetApprovals,
  useSubmitBuild,
  type ApprovalChanges,
  type ApprovalMap,
  type BuildRecord,
} from './api.js';
import { isEditableState } from './lib.js';
import { createBuildSession, type BuildSession, type BuildUpdater, type FlushResult, type SaveStatus } from './session.js';
import type { BuildActions } from './steps/types.js';

export interface UseBuildOptions {
  /** The campaign from the URL, so the settings load beside the build rather than after it. */
  campaignId?: string;
  /** Open on this step (a `?step=` deep link) once the build has loaded. */
  initialStep?: BuildStep | null;
}

/** The autosave's state, and what a player can do about a save that did not land. */
export interface SaveControls {
  status: SaveStatus;
  error: string | null;
  lastSavedAt: number | null;
  retry: () => void;
  /** Another device saved first: this device's edits are on screen, unsaved, until one of the two below. */
  stale: boolean;
  /** Save this device's edits over the other device's version. */
  keepMine: () => void;
  /** Drop this device's edits for the other device's version. */
  takeTheirs: () => void;
}

/** A GM's switch for writing into a player's open build (see the file header). */
export interface GmEditSwitch {
  /** A GM, on someone else's draft or returned build. */
  available: boolean;
  on: boolean;
  set: (on: boolean) => void;
}

export interface UseBuildResult {
  phase: 'loading' | 'error' | 'ready';
  /** Why the build could not be opened. */
  error: string | null;
  record: BuildRecord | null;
  build: CharacterBuild | null;
  settings: ChargenSettings | null;
  settingsFromCampaign: boolean;
  analysis: BuildAnalysis | null;
  budgets: BuildAnalysis['budgets'] | null;
  issues: BuildAnalysis['issues'];
  steps: BuildAnalysis['steps'];
  eligibility: BuildAnalysis['eligibility'] | null;
  preview: BuildAnalysis['preview'] | null;
  step: BuildStep;
  mode: BuildMode;
  readOnly: boolean;
  reviewMode: boolean;
  role: Role | null;
  isOwner: boolean;
  gmEdit: GmEditSwitch;
  save: SaveControls;
  update: (fn: BuildUpdater) => void;
  goTo: (step: BuildStep) => void;
  setMode: (mode: BuildMode) => void;
  flush: () => Promise<FlushResult>;
}

/**
 * Who may write a build from this device: the player who owns it, the GM on
 * their own build, or a GM who has turned on "edit as GM". A player device
 * with no stored user id (a pasted token) is given the benefit of the doubt —
 * the server has the last word, and a refusal becomes a conflict. A GM device
 * without one is not: for the GM, "not provably theirs" means "a player's".
 */
export function writerFor(
  role: Role | null | undefined,
  userId: string | undefined,
  ownerUserId: string | undefined,
  gmEdit = false,
): {
  canWrite: boolean;
  isOwner: boolean;
  /** Step and mode changes are saved only by the owner; a GM looking at a player's build moves locally. */
  ownsNavigation: boolean;
} {
  const isOwner = ownerUserId === undefined || userId === undefined || ownerUserId === userId;
  const gmOwns = userId !== undefined && ownerUserId === userId;
  const ownsNavigation = role === 'gm' ? gmOwns : role === 'player' && isOwner;
  const canWrite = role === 'gm' ? gmOwns || gmEdit : role === 'player' && isOwner;
  return { canWrite, isOwner, ownsNavigation };
}

/** Why Submit did not go ahead, before the server was asked. */
export class SubmitBlockedError extends Error {
  readonly issues: readonly Issue[];
  constructor(message: string, issues: readonly Issue[] = []) {
    super(message);
    this.name = 'SubmitBlockedError';
    this.issues = issues;
  }
}

/**
 * Submit, in the only order that submits what the player typed: save the last
 * edit and stop if it did not save; read the server's check and stop if it
 * still finds errors (their issues ride on the refusal, for the Finish
 * checklist); then submit.
 */
export async function submitWhenSaved(steps: {
  flush: () => Promise<FlushResult>;
  check: () => Promise<BuildCheckDto>;
  submit: () => Promise<unknown>;
}): Promise<void> {
  const saved = await steps.flush();
  if (!saved.saved) {
    throw new SubmitBlockedError(
      saved.status === 'conflict' && saved.error
        ? saved.error
        : `Your last changes did not reach the server${saved.error ? ` (${saved.error})` : ''}, so nothing was submitted. Try again when the save goes through.`,
    );
  }
  const check = await steps.check();
  const errors = check.issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new SubmitBlockedError(
      `The server's check still finds ${errors.length} ${errors.length === 1 ? 'thing' : 'things'} to fix, so nothing was submitted.`,
      errors,
    );
  }
  await steps.submit();
}

/**
 * The page's edges as event handlers (§4.4 "Autosave on every change"):
 * hiding the tab or leaving the page sends what is pending at once, with
 * `keepalive` so the browser finishes it; leaving over an edit no save can
 * carry (a failed save, or typing while a save flies) asks the browser to
 * confirm first.
 */
export function leaveHandlers(session: Pick<BuildSession, 'flush' | 'shouldWarnOnLeave'>): {
  onHidden: () => void;
  onBeforeUnload: (event: { preventDefault: () => void; returnValue?: unknown }) => void;
} {
  return {
    onHidden: () => void session.flush(),
    onBeforeUnload: (event) => {
      void session.flush();
      if (session.shouldWarnOnLeave()) {
        event.preventDefault();
        // Older browsers still read the return value.
        event.returnValue = '';
      }
    },
  };
}

const NO_ISSUES: BuildAnalysis['issues'] = [];
const NO_STEPS: BuildAnalysis['steps'] = [];

export function useBuild(buildId: string | undefined, options: UseBuildOptions = {}): UseBuildResult {
  const qc = useQueryClient();
  const session = getSession();
  const role = session?.role ?? null;
  const buildQuery = useBuildQuery(buildId);
  const record = buildQuery.data ?? null;
  const settingsQuery = useChargenSettings(options.campaignId ?? record?.campaignId);

  const store = useMemo(
    () =>
      createBuildSession({
        buildId: buildId ?? '',
        save: (id, body, baseUpdatedAt) => patchBuild(id, body, { keepalive: true, baseUpdatedAt }),
        onSaved: (saved) => {
          storeBuildRecord(qc, saved);
          // The server's check is of the row just replaced. Only an active
          // check (the Finish step's) refetches.
          void qc.invalidateQueries({ queryKey: buildKeys.check(saved.id) });
        },
        canWrite: false,
      }),
    [buildId, qc],
  );
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // "Edit as GM" is this device's, per build, and starts off.
  const [gmEditFor, setGmEditFor] = useState<string | null>(null);
  const gmEditOn = gmEditFor !== null && gmEditFor === buildId;
  const { canWrite, isOwner, ownsNavigation } = writerFor(role, session?.userId, record?.ownerUserId, gmEditOn);
  useEffect(() => {
    store.setCanWrite(canWrite);
    store.setOwnsNavigation(ownsNavigation);
  }, [store, canWrite, ownsNavigation]);
  useEffect(() => {
    if (record) store.receive(record);
  }, [store, record]);

  const setGmEdit = useCallback(
    (on: boolean) => {
      setGmEditFor(on ? (buildId ?? null) : null);
      // Start from the newest row, not the one this page opened with.
      if (on && buildId) void qc.invalidateQueries({ queryKey: buildKeys.build(buildId) });
      if (!on) void store.flush();
    },
    [buildId, qc, store],
  );

  // A deep-linked step, once, when the draft first exists.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!state.draft || openedAt === (buildId ?? '')) return;
    setOpenedAt(buildId ?? '');
    if (options.initialStep) store.goTo(options.initialStep);
  }, [state.draft, openedAt, buildId, options.initialStep, store]);

  // A refused save: re-read the row so the page shows what the server holds.
  useEffect(() => {
    if (state.status === 'conflict' && buildId) void qc.invalidateQueries({ queryKey: buildKeys.build(buildId) });
  }, [state.status, buildId, qc]);

  // Flush at the edges: hiding the tab, leaving the page, unmounting.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const edges = leaveHandlers(store);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') edges.onHidden();
    };
    window.addEventListener('pagehide', edges.onHidden);
    window.addEventListener('beforeunload', edges.onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', edges.onHidden);
      window.removeEventListener('beforeunload', edges.onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      void store.flush();
      store.dispose();
    };
  }, [store]);

  const draft = state.draft;
  const settingsFromCampaign = Boolean(settingsQuery.data);
  const fallbackLevel = draft?.level;
  const fallbackTable = draft?.table;
  const settings = useMemo<ChargenSettings | null>(() => {
    if (settingsQuery.data) return settingsQuery.data;
    if (settingsQuery.isError && fallbackLevel && fallbackTable) {
      return settingsFromBuild({ level: fallbackLevel, table: fallbackTable });
    }
    return null;
  }, [settingsQuery.data, settingsQuery.isError, fallbackLevel, fallbackTable]);

  const [analyse] = useState(createAnalyser);
  const analysis = useMemo(() => (draft && settings ? analyse(draft, settings) : null), [analyse, draft, settings]);

  const update = useCallback((fn: BuildUpdater) => store.update(fn), [store]);
  const goTo = useCallback((step: BuildStep) => store.goTo(step), [store]);
  const setMode = useCallback((mode: BuildMode) => store.setMode(mode), [store]);
  const flush = useCallback(() => store.flush(), [store]);
  const retry = useCallback(() => void store.retry(), [store]);
  const keepMine = useCallback(() => void store.resolveStale('mine'), [store]);
  const takeTheirs = useCallback(() => void store.resolveStale('theirs'), [store]);

  const reviewMode = role === 'gm' && draft?.state === 'submitted';
  const readOnly = !canWrite || !draft || !isEditableState(draft.state) || state.status === 'conflict';
  // A GM on a player's build is never walked through the gates (§4.4 "free …
  // what a returning player or the GM gets"), whether reading or editing.
  const gmOnPlayers = role === 'gm' && !ownsNavigation;
  const gmEdit = useMemo<GmEditSwitch>(
    () => ({ available: gmOnPlayers && draft !== null && isEditableState(draft.state), on: gmEditOn, set: setGmEdit }),
    [gmOnPlayers, draft, gmEditOn, setGmEdit],
  );

  const phase: UseBuildResult['phase'] =
    draft && analysis ? 'ready' : buildQuery.isError && !draft ? 'error' : 'loading';
  const error =
    phase === 'error' ? (buildQuery.error instanceof Error ? buildQuery.error.message : 'This build could not be loaded.') : null;

  const save = useMemo<SaveControls>(
    () => ({
      status: state.status,
      error: state.error,
      lastSavedAt: state.lastSavedAt,
      retry,
      stale: state.stale,
      keepMine,
      takeTheirs,
    }),
    [state.status, state.error, state.lastSavedAt, retry, state.stale, keepMine, takeTheirs],
  );

  return {
    phase,
    error,
    record: state.server ?? record,
    build: draft,
    settings,
    settingsFromCampaign,
    analysis,
    budgets: analysis?.budgets ?? null,
    issues: analysis?.issues ?? NO_ISSUES,
    steps: analysis?.steps ?? NO_STEPS,
    eligibility: analysis?.eligibility ?? null,
    preview: analysis?.preview ?? null,
    step: draft?.step ?? 1,
    // Someone who cannot edit is reading, not building: nothing to gate.
    mode: reviewMode || readOnly || gmOnPlayers ? 'free' : (draft?.mode ?? 'guided'),
    readOnly,
    reviewMode,
    role,
    isOwner,
    gmEdit,
    save,
    update,
    goTo,
    setMode,
    flush,
  };
}

function errorText(error: unknown): string | null {
  return error ? (error instanceof Error ? error.message : String(error)) : null;
}

/**
 * Submit, return, approvals, approve, delete — and the server's check — for
 * one build. Every action that could race the autosave flushes it first.
 */
export function useBuildActions(
  build: Pick<UseBuildResult, 'flush' | 'step'>,
  buildId: string,
  campaignId: string,
): BuildActions {
  const qc = useQueryClient();
  const submitMutation = useSubmitBuild(buildId, campaignId);
  const returnMutation = useReturnBuild(buildId, campaignId);
  const approvalsMutation = useSetApprovals(buildId, campaignId);
  const approveMutation = useApproveBuild(buildId, campaignId);
  const deleteMutation = useDeleteBuild(campaignId);
  const check = useBuildCheck(buildId, { enabled: build.step === 9 });
  const { flush } = build;
  // A refusal decided on this device (an unsaved last edit, the server's
  // check still failing) — no mutation ran, so no mutation carries it.
  const [blocked, setBlocked] = useState<unknown>(null);

  const busy: BuildActions['busy'] = submitMutation.isPending
    ? 'submit'
    : returnMutation.isPending
      ? 'return'
      : approvalsMutation.isPending
        ? 'approvals'
        : approveMutation.isPending
          ? 'approve'
          : deleteMutation.isPending
            ? 'delete'
            : null;
  const failure =
    blocked ?? submitMutation.error ?? approveMutation.error ?? returnMutation.error ?? approvalsMutation.error ?? deleteMutation.error;

  const { mutateAsync: submitAsync } = submitMutation;
  const { mutateAsync: returnAsync } = returnMutation;
  const { mutateAsync: approvalsAsync } = approvalsMutation;
  const { mutateAsync: approveAsync } = approveMutation;
  const { mutateAsync: deleteAsync } = deleteMutation;
  const refetchCheck = check.refetch;

  const submit = useCallback(async () => {
    setBlocked(null);
    try {
      await submitWhenSaved({
        flush,
        // §8.6: the server's check is read before submit, so what the GM
        // receives is what the server — not only this browser — computed.
        check: () =>
          qc
            .fetchQuery({ queryKey: buildKeys.check(buildId), queryFn: () => fetchBuildCheck(buildId), staleTime: 0 })
            .catch((err: unknown) => {
              throw new SubmitBlockedError(
                `The server's check could not be read (${errorText(err) ?? 'no answer'}), so nothing was submitted.`,
                issuesFromError(err),
              );
            }),
        submit: () => submitAsync(),
      });
    } catch (err) {
      // The server's refusal of the submit itself is the mutation's `error`;
      // a refusal decided before asking is this hook's to show.
      if (err instanceof SubmitBlockedError) setBlocked(err);
      throw err;
    }
  }, [flush, qc, buildId, submitAsync]);

  const returnWithNotes = useCallback(
    async (notes: string, step: BuildStep | null) => {
      setBlocked(null);
      await returnAsync({ notes, step });
    },
    [returnAsync],
  );
  const setApprovals = useCallback(
    async (approvals: ApprovalChanges) => {
      setBlocked(null);
      await approvalsAsync(approvals);
    },
    [approvalsAsync],
  );
  const approve = useCallback(
    async (approvals?: ApprovalMap) => {
      setBlocked(null);
      return (await approveAsync(approvals)).characterId;
    },
    [approveAsync],
  );
  const remove = useCallback(async () => {
    setBlocked(null);
    await deleteAsync(buildId);
  }, [deleteAsync, buildId]);
  const refresh = useCallback(() => void refetchCheck(), [refetchCheck]);

  const error = errorText(failure);
  const refusalIssues = useMemo<readonly Issue[]>(
    () => (failure instanceof SubmitBlockedError ? failure.issues : issuesFromError(failure)),
    [failure],
  );
  const checkData = check.data ?? null;
  const checkLoading = check.isFetching;
  const checkError = errorText(check.error);

  return useMemo<BuildActions>(
    () => ({
      flush,
      submit,
      returnWithNotes,
      setApprovals,
      approve,
      remove,
      busy,
      error,
      refusalIssues,
      check: { data: checkData, loading: checkLoading, error: checkError, refresh },
    }),
    [flush, submit, returnWithNotes, setApprovals, approve, remove, busy, error, refusalIssues, checkData, checkLoading, checkError, refresh],
  );
}
