/**
 * The character builder's data layer (FR3.9, docs/CHARGEN.md §8.5–§8.6):
 * every builds and chargen route as a plain `async` function, a React Query
 * hook over each, and the live wiring that turns `build.*` events into
 * refetches.
 *
 * ## Keys
 *
 * `['build', id]` is one build row (`BuildRecord`), `['build', id, 'check']`
 * the server's check of it, `['campaign', c, 'builds']` the campaign's list
 * and `['campaign', c, 'chargen']` the campaign's creation settings. None of
 * them is a key another feature reads (web map §3.4), and each key has exactly
 * one query function and one shape — a second fetcher on a shared key is how
 * the sheet once had its cache overwritten.
 *
 * ## Reads are strict about the build, and why
 *
 * Elsewhere the web reads tolerantly and fills gaps. A build cannot: the
 * walkthrough autosaves the whole record, so a draft that a lenient reader
 * had quietly defaulted would be written straight back over the player's real
 * one. `normalizeBuildRecord` therefore parses with the contract's own
 * schema and throws when the record does not parse, and the page shows that
 * error instead of an editor. Envelopes are tolerated (`{ build: dto }`), and
 * the row's authoritative fields — state, notes, and the GM's approvals and
 * returned step when the server sends them beside the record — are laid over
 * the record's copies, as `BuildDtoSchema`'s docblock says the row wins.
 *
 * ## Autosave is a whole-record PATCH, deliberately
 *
 * §8.5 names `PATCH /api/builds/:id` with the whole player-writable record,
 * last write wins. In this client's vocabulary a whole replacement is
 * normally `apiPut`; the route is PATCH because that is what the server
 * mounts, and the body is always complete (`BuildPatchSchema`), never a
 * partial — the GM-owned fields (`GM_BUILD_FIELDS`) are stripped before it
 * leaves, since the server would ignore them anyway and a player's device
 * has no business sending approvals.
 *
 * Every autosave names the row it was built on (`baseUpdatedAt`), and a
 * server whose row has moved on refuses it with `409 build_stale` and that
 * row; `patchBuild` hands the session a `BuildStaleError` carrying it, and the
 * session keeps the player's typing on screen beside it (session.ts rule 7).
 *
 * ## Shapes are the contract's
 *
 * A row is `BuildDto`, a create body `BuildCreate`, an approval's answer
 * `BuildApproveResultSchema` — parsed with the schemas the server sends them
 * with, so the two sides cannot drift into two local copies of one shape.
 * The list also carries rows the server could not read as a build
 * (`UnreadableBuildDto` stubs); they are kept, by their columns, so the list
 * can offer to delete them.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  BUILD_STALE_CODE,
  BuildApproveResultSchema,
  BuildCheckDtoSchema,
  BuildDtoSchema,
  ChargenSettingsSchema,
  IssueSchema,
  UnreadableBuildDtoSchema,
  chargenSettingsForLevel,
  type ApprovalDecision,
  type BuildCheckDto,
  type BuildCreate,
  type BuildDto,
  type BuildStep,
  type BuildWritable,
  type CharacterBuild,
  type ChargenSettings,
  type ChargenSettingsWrite,
  type Issue,
  type UnreadableBuildDto,
  type WsEvent,
} from '@safehouse/contracts';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../api/client.js';
import { useLiveStore, type BuildSavedPing, type SocketStatus } from '../../live/store.js';
import { writableBuild } from './lib.js';

// ---------------------------------------------------------------------------
// Shapes and keys
// ---------------------------------------------------------------------------

/** A build row as the builder holds it: the contract's DTO, the character an approval made included. */
export type BuildRecord = BuildDto;

export interface BuildList {
  campaignId: string;
  builds: BuildRecord[];
  /**
   * Rows the server could not read as a build and sent as flagged stubs —
   * listed by their columns so the owner or the GM can delete them.
   */
  stubs: UnreadableBuildDto[];
  /** Rows that did not parse as a build or a stub — shown as a count, never guessed at. */
  unreadable: number;
}

/** The GM's decisions as the row holds them, and as approval sends them. */
export type ApprovalMap = Record<string, ApprovalDecision>;

/**
 * A write to the decisions (`BuildApprovalsSchema`): a decision per code, or
 * `null` to take one back — a GM who pressed "approve" by mistake undoes it
 * rather than having to deny what they meant to leave open.
 */
export type ApprovalChanges = Record<string, ApprovalDecision | null>;

/** LIVE-1 for anything live-edited: refetch on mount and on reconnect. Local, like `PARTY_HYDRATE`. */
export const BUILD_HYDRATE = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnReconnect: 'always',
} as const;

export const buildKeys = {
  all: ['build'] as const,
  build: (buildId: string) => ['build', buildId] as const,
  check: (buildId: string) => ['build', buildId, 'check'] as const,
  list: (campaignId: string) => ['campaign', campaignId, 'builds'] as const,
  settings: (campaignId: string) => ['campaign', campaignId, 'chargen'] as const,
};

/**
 * An autosave refused because the server's row moved on since the row the
 * record was built on (`409 build_stale`). `current` is that row, read from
 * the refusal's details — null when they did not parse, and the session's
 * refetch brings it instead.
 */
export class BuildStaleError extends ApiError {
  readonly current: BuildRecord | null;
  constructor(message: string, current: BuildRecord | null, details?: unknown) {
    super(409, BUILD_STALE_CODE, message, details);
    this.name = 'BuildStaleError';
    this.current = current;
  }
}

/** A server answer the builder refuses to guess at (see the file header). */
export class BuildShapeError extends Error {
  constructor(what: string, detail?: string) {
    super(`The server sent ${what} this app cannot read${detail ? ` (${detail})` : ''}.`);
    this.name = 'BuildShapeError';
  }
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Unwrap `{ build: dto }` / `{ record: dto }` envelopes down to the row itself. */
function unwrapRow(raw: unknown): Record<string, unknown> | null {
  const r = rec(raw);
  if (!r) return null;
  if (typeof r['id'] === 'string' && rec(r['build'])) return r;
  for (const key of ['build', 'record', 'row']) {
    const inner = rec(r[key]);
    if (inner && typeof inner['id'] === 'string' && rec(inner['build'])) return inner;
  }
  return null;
}

/**
 * One build row, parsed with the contract. Throws `BuildShapeError` rather
 * than defaulting a record the autosave would then write back.
 */
export function normalizeBuildRecord(raw: unknown): BuildRecord {
  const row = unwrapRow(raw);
  if (!row) throw new BuildShapeError('a build', 'no build row in the response');
  const parsed = BuildDtoSchema.safeParse(row);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BuildShapeError('a build', first ? `${first.path.join('.')}: ${first.message}` : undefined);
  }
  const dto = parsed.data;
  // The row is authoritative for the GM-owned fields; the server may send
  // them as columns beside the record, or only as the record's copies.
  const approvals = rec(row['approvals']);
  const returnedStep = row['returnedStep'];
  const build: CharacterBuild = {
    ...dto.build,
    state: dto.state,
    notes: dto.notes,
    ...(approvals ? { approvals: approvalsOf(approvals) } : {}),
    returnedStep: typeof returnedStep === 'number' || returnedStep === null ? validStep(returnedStep) : dto.build.returnedStep,
  };
  return { ...dto, build };
}

function approvalsOf(r: Record<string, unknown>): ApprovalMap {
  const out: ApprovalMap = {};
  for (const [code, decision] of Object.entries(r)) {
    if (decision === 'approved' || decision === 'denied') out[code] = decision;
  }
  return out;
}

function validStep(v: unknown): BuildStep | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9 ? (v as BuildStep) : null;
}

/**
 * The campaign's list: `{ campaignId, builds }` or a bare array. A row the
 * server flagged `unreadable` is kept as its stub (so it can be deleted);
 * anything else that does not parse is counted, not shown.
 */
export function normalizeBuildList(raw: unknown, campaignId: string): BuildList {
  const r = rec(raw);
  const rows = Array.isArray(raw) ? raw : Array.isArray(r?.['builds']) ? (r['builds'] as unknown[]) : [];
  const builds: BuildRecord[] = [];
  const stubs: UnreadableBuildDto[] = [];
  let unreadable = 0;
  for (const row of rows) {
    if (rec(row)?.['unreadable'] === true) {
      const stub = UnreadableBuildDtoSchema.safeParse(row);
      if (stub.success) stubs.push(stub.data);
      else unreadable++;
      continue;
    }
    try {
      builds.push(normalizeBuildRecord(row));
    } catch {
      unreadable++;
    }
  }
  return { campaignId, builds, stubs, unreadable };
}

/** The chargen settings: the object itself, or `{ settings }` / `{ chargen }`. Defaults fill what is absent. */
export function normalizeChargenSettings(raw: unknown): ChargenSettings {
  const r = rec(raw);
  const body = rec(r?.['settings']) ?? rec(r?.['chargen']) ?? r ?? {};
  const parsed = ChargenSettingsSchema.safeParse(body);
  if (!parsed.success) throw new BuildShapeError('creation settings');
  return parsed.data;
}

/**
 * Settings to run the engine with when the campaign's could not be read: the
 * build's own level and table, the level's preset caps. Honest enough for a
 * rail, and the page says the numbers are the build's, not the campaign's.
 */
export function settingsFromBuild(build: Pick<CharacterBuild, 'level' | 'table'>): ChargenSettings {
  return chargenSettingsForLevel(build.level, { table: build.table });
}

export function normalizeBuildCheck(raw: unknown): BuildCheckDto {
  const parsed = BuildCheckDtoSchema.safeParse(raw);
  if (!parsed.success) throw new BuildShapeError('a build check');
  return parsed.data;
}

/**
 * The validator issues a refusal carried (`409` on submit or approve):
 * `details.issues`, or `details` itself as an array. Unparsable entries drop.
 */
export function issuesFromError(error: unknown): Issue[] {
  if (!(error instanceof ApiError)) return [];
  const d = error.details;
  const list = Array.isArray(d) ? d : Array.isArray(rec(d)?.['issues']) ? (rec(d)!['issues'] as unknown[]) : [];
  return list.flatMap((i) => {
    const parsed = IssueSchema.safeParse(i);
    return parsed.success ? [parsed.data] : [];
  });
}

export { writableBuild };

// ---------------------------------------------------------------------------
// Network functions (one per route, §8.5)
// ---------------------------------------------------------------------------

/** `GET /api/campaigns/:id/chargen` (members) → the campaign's creation settings. */
export async function fetchChargenSettings(campaignId: string): Promise<ChargenSettings> {
  return normalizeChargenSettings(await apiGet<unknown>(`/api/campaigns/${campaignId}/chargen`));
}

/** `PUT /api/campaigns/:id/chargen` (GM) — a partial write merged onto the stored settings server-side. */
export async function saveChargenSettings(campaignId: string, write: ChargenSettingsWrite): Promise<ChargenSettings> {
  return normalizeChargenSettings(await apiPut<unknown>(`/api/campaigns/${campaignId}/chargen`, write));
}

/** `GET /api/campaigns/:id/builds` — the GM gets every build, a player their own. */
export async function fetchBuilds(campaignId: string): Promise<BuildList> {
  return normalizeBuildList(await apiGet<unknown>(`/api/campaigns/${campaignId}/builds`), campaignId);
}

/** `POST /api/campaigns/:id/builds`'s body (`BuildCreateSchema`): alias, concept card, starting record, and — the GM's alone — an owner. */
export type CreateBuildInput = BuildCreate;

/** `POST /api/campaigns/:id/builds` → a new draft at the campaign's level. Every field is optional. */
export async function createBuild(campaignId: string, input: CreateBuildInput = {}): Promise<BuildRecord> {
  const alias = input.alias?.trim();
  const body: BuildCreate = {
    ...(alias ? { alias } : {}),
    ...(input.conceptId ? { conceptId: input.conceptId } : {}),
    ...(input.build ? { build: input.build } : {}),
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
  };
  return normalizeBuildRecord(await apiPost<unknown>(`/api/campaigns/${campaignId}/builds`, body));
}

/** `GET /api/builds/:id` (owner or GM). */
export async function fetchBuild(buildId: string): Promise<BuildRecord> {
  return normalizeBuildRecord(await apiGet<unknown>(`/api/builds/${buildId}`));
}

/**
 * The largest autosave body sent with `keepalive`. Browsers refuse a
 * keepalive request once the bodies of all such requests in flight pass
 * 64 KB; an autosave has at most one flight plus the flush that follows it,
 * so half of that each keeps both inside the cap. A record past it (a runner
 * with an arsenal) is sent plainly — the page then warns before it closes
 * over an unsent save rather than trusting the browser to finish it.
 */
export const KEEPALIVE_BODY_BYTES = 32_000;

function byteLength(text: string): number {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length * 3;
}

/** Whether a PATCH body is small enough to be sent with `keepalive`. */
export function fitsKeepalive(body: unknown): boolean {
  return byteLength(JSON.stringify(body)) <= KEEPALIVE_BODY_BYTES;
}

/**
 * `PATCH /api/builds/:id` — the whole player-writable record (see the file
 * header). `keepalive` lets the save finish after the tab closes (autosave
 * asks for it on every save; it is dropped for a body too big to carry).
 * `baseUpdatedAt` is the row the record was built on; a server whose row has
 * moved on answers `409 build_stale`, which rejects here as a
 * `BuildStaleError` carrying that row (null when it could not be read).
 */
export async function patchBuild(
  buildId: string,
  build: CharacterBuild | BuildWritable,
  options: { keepalive?: boolean; baseUpdatedAt?: string | null } = {},
): Promise<BuildRecord> {
  const body = {
    build: 'state' in build ? writableBuild(build as CharacterBuild) : build,
    ...(options.baseUpdatedAt ? { baseUpdatedAt: options.baseUpdatedAt } : {}),
  };
  const keepalive = options.keepalive === true && fitsKeepalive(body);
  let raw: unknown;
  try {
    raw = await apiPatch<unknown>(`/api/builds/${buildId}`, body, keepalive ? { keepalive: true } : undefined);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === BUILD_STALE_CODE) {
      let current: BuildRecord | null = null;
      try {
        current = normalizeBuildRecord(err.details);
      } catch {
        current = null;
      }
      throw new BuildStaleError(err.message, current, err.details);
    }
    throw err;
  }
  return normalizeBuildRecord(raw);
}

/** `GET /api/builds/:id/check` → `{ budgets, issues, sheet, derived }` computed on the server. */
export async function fetchBuildCheck(buildId: string): Promise<BuildCheckDto> {
  return normalizeBuildCheck(await apiGet<unknown>(`/api/builds/${buildId}/check`));
}

/** `POST /api/builds/:id/submit` (owner) — refused with the issues when errors remain. */
export async function submitBuild(buildId: string): Promise<BuildRecord> {
  return normalizeBuildRecord(await apiPost<unknown>(`/api/builds/${buildId}/submit`, {}));
}

export interface ReturnBuildInput {
  notes: string;
  step: BuildStep | null;
  approvals?: ApprovalMap;
}

/** `POST /api/builds/:id/return` (GM) — back to the player with a note pinned to a step. */
export async function returnBuild(buildId: string, input: ReturnBuildInput): Promise<BuildRecord> {
  return normalizeBuildRecord(
    await apiPost<unknown>(`/api/builds/${buildId}/return`, {
      notes: input.notes,
      step: input.step,
      ...(input.approvals ? { approvals: input.approvals } : {}),
    }),
  );
}

/** `POST /api/builds/:id/approvals` (GM) — per-item decisions on `approval` issues, merged over the row's; `null` takes one back. */
export async function setBuildApprovals(buildId: string, approvals: ApprovalChanges): Promise<BuildRecord> {
  return normalizeBuildRecord(await apiPost<unknown>(`/api/builds/${buildId}/approvals`, { approvals }));
}

export interface ApproveResult {
  record: BuildRecord | null;
  characterId: string | null;
}

/**
 * `POST /api/builds/:id/approve` (GM) — creates the character in one
 * transaction, and answers `BuildApproveResultSchema`: the approved row and
 * the character it made. An answer that does not parse still approved
 * something, so it is read for whatever row and id it carries rather than
 * thrown away.
 */
export async function approveBuild(buildId: string, approvals?: ApprovalMap): Promise<ApproveResult> {
  const raw = await apiPost<unknown>(`/api/builds/${buildId}/approve`, approvals ? { approvals } : {});
  const parsed = BuildApproveResultSchema.safeParse(raw);
  if (parsed.success) {
    return { record: normalizeBuildRecord(parsed.data.build), characterId: parsed.data.character.id };
  }
  let record: BuildRecord | null = null;
  try {
    record = normalizeBuildRecord(raw);
  } catch {
    record = null;
  }
  const r = rec(raw);
  const id = r?.['characterId'] ?? rec(r?.['character'])?.['id'] ?? record?.characterId ?? null;
  return { record, characterId: typeof id === 'string' ? id : null };
}

/** `DELETE /api/builds/:id` (owner while draft, GM before approval). */
export async function deleteBuild(buildId: string): Promise<void> {
  await apiDelete<unknown>(`/api/builds/${buildId}`);
}

// ---------------------------------------------------------------------------
// Cache writes shared by the hooks and the autosave
// ---------------------------------------------------------------------------

function time(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Whether a cached row is newer than the one offered for its place (it then stays). */
function newerThan(held: Pick<BuildRecord, 'updatedAt'> | undefined, offered: Pick<BuildRecord, 'updatedAt'>): boolean {
  return held !== undefined && time(held.updatedAt) > time(offered.updatedAt);
}

/**
 * Put a fresh row where every reader of it looks: its own key and its line in
 * the list — unless the cache already holds a newer copy. A save's answer can
 * land after a refetch of a later row (a submit on another device), and the
 * open walkthrough reads this cache: handing it the older row reopened a
 * submitted build.
 */
export function storeBuildRecord(qc: QueryClient, record: BuildRecord): void {
  qc.setQueryData<BuildRecord>(buildKeys.build(record.id), (held) => (newerThan(held, record) ? held : record));
  qc.setQueryData<BuildList>(buildKeys.list(record.campaignId), (list) => {
    if (!list) return list;
    const at = list.builds.findIndex((b) => b.id === record.id);
    if (at !== -1 && newerThan(list.builds[at], record)) return list;
    const builds = at === -1 ? [record, ...list.builds] : list.builds.map((b, i) => (i === at ? record : b));
    return { ...list, builds };
  });
}

/**
 * A state change: the row, the list, and the server's check are all stale.
 * Invalidation matches by prefix, so the row's key `['build', id]` covers its
 * check `['build', id, 'check']` too — one call, not two racing refetches.
 */
function settleStateChange(qc: QueryClient, record: BuildRecord | null, buildId: string, campaignId: string): void {
  if (record) storeBuildRecord(qc, record);
  void qc.invalidateQueries({ queryKey: buildKeys.build(buildId) });
  void qc.invalidateQueries({ queryKey: buildKeys.list(campaignId) });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useChargenSettings(campaignId: string | undefined) {
  return useQuery({
    queryKey: buildKeys.settings(campaignId ?? ''),
    queryFn: () => fetchChargenSettings(campaignId!),
    enabled: Boolean(campaignId),
    // A 403/404 is an answer (an older server, an observer); the page falls back.
    retry: false,
    staleTime: 60_000,
  });
}

export function useSaveChargenSettings(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (write: ChargenSettingsWrite) => saveChargenSettings(campaignId, write),
    onSuccess: (settings) => qc.setQueryData(buildKeys.settings(campaignId), settings),
  });
}

export function useBuilds(campaignId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: buildKeys.list(campaignId ?? ''),
    queryFn: () => fetchBuilds(campaignId!),
    enabled: Boolean(campaignId) && options.enabled !== false,
    retry: false,
    ...BUILD_HYDRATE,
  });
}

export function useCreateBuild(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBuildInput = {}) => createBuild(campaignId, input),
    onSuccess: (record) => {
      storeBuildRecord(qc, record);
      void qc.invalidateQueries({ queryKey: buildKeys.list(campaignId) });
    },
  });
}

export function useBuildQuery(buildId: string | undefined) {
  return useQuery({
    queryKey: buildKeys.build(buildId ?? ''),
    queryFn: () => fetchBuild(buildId!),
    enabled: Boolean(buildId),
    retry: (count, error) => !(error instanceof BuildShapeError) && !(error instanceof ApiError && error.status < 500) && count < 1,
    ...BUILD_HYDRATE,
  });
}

/**
 * A one-off whole-record save. The walkthrough's autosave does not use this
 * hook (it debounces through `createBuildSession`); this is for a caller
 * that writes a record in one go, such as applying a Fixer draft.
 */
export function usePatchBuild(buildId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (build: CharacterBuild | BuildWritable) => patchBuild(buildId, build),
    onSuccess: (record) => storeBuildRecord(qc, record),
  });
}

/** The server's check: fetched on the Finish step and before submit (§8.6), never per keystroke. */
export function useBuildCheck(buildId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: buildKeys.check(buildId ?? ''),
    queryFn: () => fetchBuildCheck(buildId!),
    enabled: Boolean(buildId) && options.enabled !== false,
    retry: false,
    staleTime: 0,
  });
}

export function useSubmitBuild(buildId: string, campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => submitBuild(buildId),
    onSuccess: (record) => settleStateChange(qc, record, buildId, campaignId),
    onError: () => void qc.invalidateQueries({ queryKey: buildKeys.check(buildId) }),
  });
}

export function useReturnBuild(buildId: string, campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReturnBuildInput) => returnBuild(buildId, input),
    onSuccess: (record) => settleStateChange(qc, record, buildId, campaignId),
  });
}

export function useSetApprovals(buildId: string, campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (approvals: ApprovalChanges) => setBuildApprovals(buildId, approvals),
    onSuccess: (record) => {
      storeBuildRecord(qc, record);
      void qc.invalidateQueries({ queryKey: buildKeys.check(buildId) });
    },
  });
}

export function useApproveBuild(buildId: string, campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (approvals?: ApprovalMap) => approveBuild(buildId, approvals),
    onSuccess: ({ record }) => {
      settleStateChange(qc, record, buildId, campaignId);
      // A new character: the roster, and the owner's "which sheet is mine".
      void qc.invalidateQueries({ queryKey: ['characters', campaignId] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useDeleteBuild(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buildId: string) => deleteBuild(buildId),
    onSuccess: (_void, buildId) => {
      qc.removeQueries({ queryKey: buildKeys.build(buildId) });
      qc.setQueryData<BuildList>(buildKeys.list(campaignId), (list) =>
        list ? { ...list, builds: list.builds.filter((b) => b.id !== buildId) } : list,
      );
      void qc.invalidateQueries({ queryKey: buildKeys.list(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Live: events invalidate, never build state (web map §4.2)
// ---------------------------------------------------------------------------

/**
 * The review loop's persisted events: submitted, returned, approved, and
 * `build.reviewed` — the GM's per-item approval decisions, persisted so the
 * owner's open page and the GM's other devices catch up (the client's own
 * `validate` reads `approvals`, so a missed decision showed items wrongly
 * decided until a reload).
 */
export const BUILD_EVENTS: ReadonlySet<string> = new Set([
  'build.submitted',
  'build.returned',
  'build.reviewed',
  'build.approved',
]);

/** The build an event is about, when its payload names one. */
export function eventBuildId(event: Pick<WsEvent, 'payload'>): string | null {
  const p = rec(event.payload) ?? {};
  const candidates = [p['buildId'], rec(p['build'])?.['id'], p['id']];
  const hit = candidates.find((c) => typeof c === 'string');
  return typeof hit === 'string' ? hit : null;
}

/** What one event makes stale for a page watching `campaignId` (and maybe one build). */
export function staleKeysFor(
  event: Pick<WsEvent, 'type' | 'payload'>,
  campaignId: string,
  buildId?: string,
): ReadonlyArray<readonly unknown[]> {
  if (BUILD_EVENTS.has(event.type)) {
    const about = eventBuildId(event);
    // A decision changes no line of the list (state, alias and date stay put);
    // every other review event does.
    const keys: Array<readonly unknown[]> = event.type === 'build.reviewed' ? [] : [buildKeys.list(campaignId)];
    // A payload naming no build is invalidated conservatively (cheap). The
    // row's key covers its server check by prefix.
    if (buildId && (about === null || about === buildId)) keys.push(buildKeys.build(buildId));
    if (event.type === 'build.approved') keys.push(['characters', campaignId], ['me']);
    return keys;
  }
  if (event.type === 'sheet.updated') {
    // Every sheet edit emits this; only the one approval makes (cause `built`)
    // changes a build list.
    const p = rec(event.payload) ?? {};
    if (p['cause'] === 'built' || typeof p['buildId'] === 'string') {
      return [buildKeys.list(campaignId), ...(buildId ? [buildKeys.build(buildId)] : [])];
    }
  }
  return [];
}

/** How long a `build.saved` ping waits for this device's own PATCH answer before it is judged. */
export const SAVE_PING_SETTLE_MS = 400;

/**
 * What a `build.saved` ping makes stale for a page with `buildId` open: that
 * build's row (and, by prefix, its check) when the ping is about it and the
 * cache does not already hold the row it announces — this device's own save
 * has usually stored its answer before the ping arrives, and refetching that
 * would be a GET per autosave for nothing.
 */
export function staleKeysForSave(
  ping: Pick<BuildSavedPing, 'buildId' | 'updatedAt'>,
  buildId: string | undefined,
  held: Pick<BuildRecord, 'updatedAt'> | undefined,
): ReadonlyArray<readonly unknown[]> {
  if (!buildId || ping.buildId !== buildId) return [];
  if (held && ping.updatedAt !== null && time(held.updatedAt) >= time(ping.updatedAt)) return [];
  return [buildKeys.build(buildId)];
}

/**
 * Every catalogue query, by prefix: the builder's picker
 * (`['catalogue', 'builder', …]`), the sheet's Add from books
 * (`['catalogue', 'search'|'page', …]`) and the summary all hang off it.
 */
export const CATALOGUE_KEY = ['catalogue'] as const;

/**
 * What a `chargen.updated` ping makes stale: the campaign's creation rules,
 * the open build's row (its check is computed against those rules server-side,
 * and the row's key covers it by prefix) and every catalogue page, because the
 * book list the searches are scoped by is part of the settings.
 *
 * Without this the GM could change the level, the Availability cap or the
 * books and a phone already inside the builder would go on quoting the old
 * caps until something unrelated made it refetch.
 */
export function staleKeysForChargen(
  campaignId: string | undefined,
  buildId: string | undefined,
): ReadonlyArray<readonly unknown[]> {
  if (!campaignId) return [];
  return [
    buildKeys.settings(campaignId),
    ...(buildId ? [buildKeys.build(buildId)] : []),
    CATALOGUE_KEY,
  ];
}

/**
 * Keep the builds list (and one open build) current: `build.submitted`,
 * `build.returned`, `build.reviewed`, `build.approved` and an approval's
 * `sheet.updated` invalidate; so does the ephemeral `build.saved` for the open
 * build, so a GM watching a player's draft (or the player's second device)
 * follows the edits instead of holding a copy that goes stale; so does the
 * ephemeral `chargen.updated`, so the rules a device is building to are the
 * ones the GM has just written; a reconnect re-reads (LIVE-1). The open build's refetch is merged by the build session,
 * which never lets it overwrite unsaved edits.
 */
export function useBuildLive(campaignId: string | undefined, buildId?: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!campaignId || !buildId) return;
    let seen = useLiveStore.getState().buildSaved?.seq ?? 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useLiveStore.subscribe((state) => {
      const ping = state.buildSaved;
      if (!ping || ping.seq <= seen) return;
      seen = ping.seq;
      if (ping.buildId !== buildId) return;
      // The server announces a save before it answers the PATCH, so on the
      // device that saved, the ping usually beats the answer into the cache.
      // Judge it a moment later, against whatever the cache holds by then.
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const held = qc.getQueryData<BuildRecord>(buildKeys.build(buildId));
        for (const key of staleKeysForSave(ping, buildId, held)) void qc.invalidateQueries({ queryKey: [...key] });
      }, SAVE_PING_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [campaignId, buildId, qc]);

  // The GM writing the creation rules: refetch them, the open build and the
  // catalogue. No settle delay — the device that made the write refetches one
  // settings GET it was going to want anyway, and a stale copy of the rules is
  // worse than a request.
  useEffect(() => {
    if (!campaignId) return;
    let seen = useLiveStore.getState().chargenUpdated?.seq ?? 0;
    return useLiveStore.subscribe((state) => {
      const ping = state.chargenUpdated;
      if (!ping || ping.seq <= seen) return;
      seen = ping.seq;
      for (const key of staleKeysForChargen(campaignId, buildId)) {
        void qc.invalidateQueries({ queryKey: [...key] });
      }
    });
  }, [campaignId, buildId, qc]);

  useEffect(() => {
    if (!campaignId) return;
    let seen = useLiveStore.getState().lastEventId;
    return useLiveStore.subscribe((state) => {
      if (state.lastEventId <= seen) return;
      const fresh = state.events.filter((e) => e.id > seen);
      seen = state.lastEventId;
      const keys = new Map<string, readonly unknown[]>();
      for (const event of fresh) {
        for (const key of staleKeysFor(event, campaignId, buildId)) keys.set(JSON.stringify(key), key);
      }
      for (const key of keys.values()) void qc.invalidateQueries({ queryKey: [...key] });
    });
  }, [campaignId, buildId, qc]);

  useEffect(() => {
    if (!campaignId) return;
    let previous: SocketStatus = useLiveStore.getState().status;
    return useLiveStore.subscribe((state) => {
      const next = state.status;
      if (next === previous) return;
      const reconnected = previous === 'offline' && next === 'online';
      previous = next;
      if (!reconnected) return;
      void qc.invalidateQueries({ queryKey: buildKeys.list(campaignId) });
      if (buildId) void qc.invalidateQueries({ queryKey: buildKeys.build(buildId) });
    });
  }, [campaignId, buildId, qc]);
}
