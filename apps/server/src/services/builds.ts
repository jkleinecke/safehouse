/**
 * The native builder's server half (FR3.9, docs/CHARGEN.md §4.3, §8.5): the
 * `builds` rows, the campaign's chargen settings, and the one transaction
 * that turns an approved build into a character.
 *
 * ## Who owns which field
 *
 * A build is the player's to edit and the GM's to judge, and the two must
 * never be able to write each other's half. The player's half is the JSON
 * record (`BuildWritableSchema`: everything but `GM_BUILD_FIELDS`); the GM's
 * half — the life-cycle `state`, the return `notes` and `returned_step`, the
 * per-item `approvals` — are columns of the row. A PATCH body is parsed with
 * the writable schema, which strips those keys, so a player who sends
 * `approvals: { … 'approved' }` has sent nothing. When a row is read the
 * columns are copied onto the record (`BuildDto` says the row is the source
 * of truth), which is how `validate` sees the GM's decisions.
 *
 * ## The numbers are the engine's, run here
 *
 * Every verdict the server gives — `check`, the refusal on submit, the
 * refusal on approve — is `@safehouse/rules` over the stored record and the
 * campaign's own settings, never anything the client computed. The web runs
 * the same functions locally for an instant rail (§8.6); this is the copy
 * that counts.
 *
 * ## Approval is one fate
 *
 * `approveBuild` writes the character row (with the build as history),
 * revision 1, the contacts, the bound spirits / registered sprites / bonded
 * foci on the magic shelf, the starting-nuyen roll on the record (G5), the
 * opening ledger entries, and the build's own state, inside ONE `hub.atomic`
 * block with every event they announce. A half-approved build is the worst
 * state this feature can reach: a runner on the roster whose Karma never
 * arrived, or a build still "waiting" whose character already exists and gets
 * approved a second time. Every lookup that can be hoisted is (the campaign
 * row); everything inside goes through `tx.db` (the deadlock rule on
 * `Hub.atomic`).
 *
 * ## A verdict is given on the row it changes
 *
 * Submit and approve each re-read the build under a row lock inside their
 * transaction and judge that — not the copy the route loaded before the
 * transaction opened, which an autosave or a GM's decision from another
 * device may already have replaced. Return and per-item decisions re-read the
 * approvals column the same way. A route's early read is for access and a
 * fast refusal only.
 *
 * ## A row that no longer reads
 *
 * The record's schema will change as the builder grows, and a tightened
 * schema turns an old draft into a row that does not parse. Such a row is
 * listed as a flagged stub (`UnreadableBuild`) rather than failing the list,
 * and DELETE works from the row's columns (`BuildHead`), so it can always be
 * removed; opening it answers `build_invalid`.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ApprovalDecisionSchema,
  BUILD_STALE_CODE,
  BuildStepSchema,
  BuildWritableSchema,
  ChargenSettingsSchema,
  MAX_APPROVAL_DECISIONS,
  mergeChargenSettings,
  type ApprovalDecision,
  type BuildCheckDto,
  type BuildDto,
  type BuildState,
  type BuildWritable,
  type CharacterBuild,
  type ChargenSettings,
  type ChargenSettingsWrite,
  type Issue,
  type SheetV1,
  type UnreadableBuildDto,
} from '@safehouse/contracts';
import {
  applyConcept,
  budgets,
  compileBuild,
  conceptPreset,
  deriveCharacter,
  emptyBuild,
  startingLifestyle,
  validate,
  type CompiledBuild,
  type CompiledOpening,
} from '@safehouse/rules';
import { builds, campaigns, characters, contacts, memberships, rolls, type Db } from '@safehouse/db';
import type { EventTx, Hub } from '../hub.js';
import { createEntry } from '../plugins/ledger.js';
import { writeNotes } from '../plugins/contacts.js';
import { httpError, type AuthContext } from './auth.js';
import { recordRevision, requireCharacter, type CharacterRecord } from './characters.js';
import { forgetCampaignSettings } from './discord.js';
import {
  FocusRecordSchema,
  MAX_FOCI,
  MAX_SPIRITS,
  MAX_SPRITES,
  SpiritRecordSchema,
  SpriteRecordSchema,
  commitMagicState,
  newMagicId,
  readMagicState,
  type FocusRecord,
  type SpiritRecord,
  type SpriteRecord,
} from './magic-store.js';
import { toRecord as toRollRecord } from './roll-log.js';
import { getRollService } from './rolls.js';

/** Postgres would raise 22P02 on a non-uuid comparison; we answer 404 instead. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds one person may have open (not yet approved) in a campaign. A draft
 * is autosaved from the first tap, so an abandoned one costs nothing — but a
 * script POSTing in a loop should meet a wall, not fill the table.
 */
export const MAX_OPEN_BUILDS = 25;

/** The cause on the approved character's first revision (§8.2). */
export const BUILT_CAUSE = 'built';

type BuildRow = typeof builds.$inferSelect;

export interface BuildRecord {
  id: string;
  campaignId: string;
  ownerUserId: string;
  state: BuildState;
  /** The stored record with the row's GM-owned columns copied on. */
  build: CharacterBuild;
  notes: string | null;
  returnedStep: number | null;
  approvals: Record<string, ApprovalDecision>;
  characterId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** The approvals column, tolerant of a hand-edited blob: anything unreadable is no decision. */
function readApprovals(raw: unknown): Record<string, ApprovalDecision> {
  const out: Record<string, ApprovalDecision> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = ApprovalDecisionSchema.safeParse(value);
    if (parsed.success) out[code] = parsed.data;
  }
  return out;
}

/** Strip the GM-owned fields: what goes in the `build` column. */
export function writableOf(build: CharacterBuild | BuildWritable): BuildWritable {
  const { approvals: _a, notes: _n, returnedStep: _r, state: _s, ...rest } = build as CharacterBuild;
  void _a;
  void _n;
  void _r;
  void _s;
  return rest;
}

/**
 * The columns of a row — everything access and the life cycle are decided
 * on, and nothing that has to parse. A route that must work on a row whose
 * record no longer reads (DELETE) works from this.
 */
export interface BuildHead {
  id: string;
  campaignId: string;
  ownerUserId: string;
  state: BuildState;
}

/**
 * A row whose `build` column no longer reads as a record — an older draft
 * after `CharacterBuildSchema` tightened. Listed by its columns so it never
 * takes the whole list down with it, and deletable like any build; opening
 * it answers `build_invalid`. `issues` are zod's, for the server log only.
 */
export interface UnreadableBuild extends BuildHead {
  unreadable: true;
  notes: string | null;
  characterId: string | null;
  createdAt: string;
  updatedAt: string;
  issues: readonly unknown[];
}

function readBuildRow(row: BuildRow): BuildRecord | UnreadableBuild {
  const parsed = BuildWritableSchema.safeParse(row.build);
  if (!parsed.success) {
    return {
      id: row.id,
      campaignId: row.campaignId,
      ownerUserId: row.ownerUserId,
      state: row.state,
      unreadable: true,
      notes: row.notes,
      characterId: row.characterId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      issues: parsed.error.issues,
    };
  }
  const approvals = readApprovals(row.approvals);
  const step = BuildStepSchema.safeParse(row.returnedStep);
  const returnedStep = step.success ? step.data : null;
  return {
    id: row.id,
    campaignId: row.campaignId,
    ownerUserId: row.ownerUserId,
    state: row.state,
    build: { ...parsed.data, approvals, notes: row.notes, returnedStep, state: row.state },
    notes: row.notes,
    returnedStep,
    approvals,
    characterId: row.characterId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function isUnreadable(rec: BuildRecord | UnreadableBuild): rec is UnreadableBuild {
  return 'unreadable' in rec;
}

/**
 * A row as a record, or 500 `build_invalid` when its record no longer reads.
 *
 * Zod's issues do NOT travel with the answer: their `path`, `expected` and
 * `received` describe the fields of a build, and the answer is given before
 * the reader has been told anything else about it. They go to `onUnreadable`
 * — the route's logger — the way the list route has always logged them.
 */
function toBuildRecord(row: BuildRow, onUnreadable?: (issues: readonly unknown[]) => void): BuildRecord {
  const read = readBuildRow(row);
  if (isUnreadable(read)) {
    onUnreadable?.(read.issues);
    throw httpError(500, 'build_invalid', 'stored build failed validation');
  }
  return read;
}

/** The columns of a row, for an access check made before anything is parsed. */
function headOf(row: BuildRow): BuildHead {
  return { id: row.id, campaignId: row.campaignId, ownerUserId: row.ownerUserId, state: row.state };
}

/** The list's stub for an unreadable row: its columns, flagged. */
export function unreadableDto(rec: UnreadableBuild): UnreadableBuildDto {
  return {
    id: rec.id,
    campaignId: rec.campaignId,
    ownerUserId: rec.ownerUserId,
    state: rec.state,
    notes: rec.notes,
    characterId: rec.characterId,
    unreadable: true,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

/** A row as `BuildDto`, the character approval created included (null until then). */
export function buildDto(rec: BuildRecord): BuildDto {
  return {
    id: rec.id,
    campaignId: rec.campaignId,
    ownerUserId: rec.ownerUserId,
    state: rec.state,
    build: rec.build,
    notes: rec.notes,
    characterId: rec.characterId,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

export async function loadBuild(db: Db, id: string): Promise<BuildRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  return rows[0] ? toBuildRecord(rows[0]) : null;
}

/** 404 for an unknown id and for anything that is not a uuid at all. */
export async function requireBuild(db: Db, id: string): Promise<BuildRecord> {
  const rec = await loadBuild(db, id);
  if (!rec) throw httpError(404, 'not_found', 'unknown build');
  return rec;
}

export interface BuildAccessOptions {
  /**
   * The rule to decide on the row's columns: `assertCanOpenBuild` by default,
   * `assertGmOf` for a GM-only route.
   */
  access?: (auth: AuthContext, head: BuildHead) => void;
  /** Where zod's issues go when the record no longer reads: the log, never the answer. */
  onUnreadable?: (issues: readonly unknown[]) => void;
}

/**
 * One build, for a device that is allowed it — **access decided before the
 * record is parsed**.
 *
 * The order is the whole point. Parsing first meant an unreadable row
 * answered 500 `build_invalid` (with zod's issues) to any authenticated
 * device, which told an observer, a display or a player from another table
 * both that the build existed and what its fields looked like. Now the row's
 * columns settle who may see it, and only then is the record read.
 *
 * A row in another campaign answers 404 rather than 403 for the same reason:
 * a device that cannot be told the build exists should not be able to infer
 * it from the refusal it gets.
 */
export async function requireBuildFor(
  db: Db,
  auth: AuthContext,
  id: string,
  options: BuildAccessOptions = {},
): Promise<BuildRecord> {
  if (!UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown build');
  const rows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw httpError(404, 'not_found', 'unknown build');
  (options.access ?? assertCanOpenBuild)(auth, headOf(row));
  return toBuildRecord(row, options.onUnreadable);
}

/** A row's columns only (`BuildHead`) — 404 like `requireBuild`, and never a parse. */
export async function requireBuildHead(db: Db, id: string): Promise<BuildHead> {
  if (!UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown build');
  const rows = await db
    .select({ id: builds.id, campaignId: builds.campaignId, ownerUserId: builds.ownerUserId, state: builds.state })
    .from(builds)
    .where(eq(builds.id, id))
    .limit(1);
  if (!rows[0]) throw httpError(404, 'not_found', 'unknown build');
  return rows[0];
}

/**
 * The row as it stands inside a transaction, locked against a concurrent
 * write until the transaction ends (`FOR UPDATE`). A verdict — submit's,
 * approval's — is given on this read, never on the one a route made before
 * the transaction opened: an autosave or a GM decision can commit in between.
 */
async function lockBuild(txDb: Db, id: string): Promise<BuildRecord> {
  const rows = await txDb.select().from(builds).where(eq(builds.id, id)).limit(1).for('update');
  if (!rows[0]) throw httpError(404, 'not_found', 'unknown build');
  return toBuildRecord(rows[0]);
}

/**
 * Every build in a campaign (the GM's view), or one person's. Newest change
 * first. A row whose record no longer reads comes back as `UnreadableBuild`
 * rather than failing the list.
 */
export async function listBuilds(
  db: Db,
  campaignId: string,
  ownerUserId?: string,
): Promise<Array<BuildRecord | UnreadableBuild>> {
  const where = ownerUserId
    ? and(eq(builds.campaignId, campaignId), eq(builds.ownerUserId, ownerUserId))
    : eq(builds.campaignId, campaignId);
  const rows = await db.select().from(builds).where(where).orderBy(desc(builds.updatedAt));
  return rows.map(readBuildRow);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** Only the GM and players build runners; an observer's or a display's device never sees a build. */
export function assertBuilder(auth: AuthContext): void {
  if (auth.role !== 'gm' && auth.role !== 'player') {
    throw httpError(403, 'forbidden', 'only the GM or a player works on builds');
  }
}

/**
 * The owner or the GM of the build's campaign (§8.5). Another player at the
 * same table is refused the way `assertCanEdit` refuses a character; a device
 * bound to another campaign is told the build does not exist, which is all it
 * is entitled to know.
 */
export function assertCanOpenBuild(auth: AuthContext, rec: BuildHead): void {
  assertBuilder(auth);
  // A build in another campaign is not this device's to know about at all, so
  // it answers as an unknown id does rather than confirming it exists.
  if (auth.campaignId !== rec.campaignId) throw httpError(404, 'not_found', 'unknown build');
  if (auth.role !== 'gm' && rec.ownerUserId !== auth.userId) {
    throw httpError(403, 'forbidden', 'only the owner or the GM may open this build');
  }
}

export function assertGmOf(auth: AuthContext, rec: BuildHead): void {
  if (auth.campaignId !== rec.campaignId) throw httpError(404, 'not_found', 'unknown build');
  if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'requires role: gm');
}

function assertState(rec: Pick<BuildHead, 'state'>, allowed: readonly BuildState[], action: string): void {
  if (!allowed.includes(rec.state)) {
    throw httpError(409, 'build_state', `a ${rec.state} build cannot be ${action}`, {
      state: rec.state,
      allowed,
    });
  }
}

// ---------------------------------------------------------------------------
// Campaign chargen settings (`campaigns.settings.chargen`)
// ---------------------------------------------------------------------------

interface CampaignFacts {
  settings: Record<string, unknown>;
  ingameDate: string | null;
}

async function campaignFacts(db: Db, campaignId: string): Promise<CampaignFacts> {
  const row = (
    await db
      .select({ settings: campaigns.settings, ingameDate: campaigns.ingameDate })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
  )[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  const settings =
    typeof row.settings === 'object' && row.settings !== null ? (row.settings as Record<string, unknown>) : {};
  return { settings, ingameDate: row.ingameDate };
}

/** The stored settings, degraded to the experienced defaults when absent or unreadable — never a 500. */
export function chargenSettingsOf(settings: Record<string, unknown>): ChargenSettings {
  const parsed = ChargenSettingsSchema.safeParse(settings['chargen'] ?? {});
  return parsed.success ? parsed.data : ChargenSettingsSchema.parse({});
}

export async function readChargenSettings(db: Db, campaignId: string): Promise<ChargenSettings> {
  return chargenSettingsOf((await campaignFacts(db, campaignId)).settings);
}

/**
 * Merge a partial write onto what the campaign has (`mergeChargenSettings`:
 * omitted fields keep their value; only a level change resets the preset
 * caps) and store it under `chargen` alone. `jsonb_set` rather than a
 * read-modify-write of the whole blob, so a magic-shelf write landing between
 * the read and this statement is not undone by it.
 */
export async function writeChargenSettings(
  db: Db,
  campaignId: string,
  write: ChargenSettingsWrite,
): Promise<ChargenSettings> {
  const current = await readChargenSettings(db, campaignId);
  const next = mergeChargenSettings(current, write);
  await db
    .update(campaigns)
    .set({
      settings: sql`jsonb_set(coalesce(${campaigns.settings}, '{}'::jsonb), '{chargen}', ${JSON.stringify(next)}::jsonb, true)`,
    })
    .where(eq(campaigns.id, campaignId));
  // The roll path and the Fixer cache campaign settings for 15s (services/discord.ts).
  forgetCampaignSettings(campaignId);
  return next;
}

/** The campaign decides the level and the printing of the table; a record never carries its own (§4.4 Step 1: "shown, not chosen"). */
function atCampaignLevel(build: BuildWritable, settings: ChargenSettings): BuildWritable {
  return { ...build, level: settings.level, table: settings.table };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface CreateBuildInput {
  ownerUserId: string;
  /** Who asked: a GM may start a build for another member of the table. */
  requestedBy: string;
  alias?: string;
  conceptId?: string;
  build?: BuildWritable;
}

/**
 * A new draft: the rules' `emptyBuild` at the campaign's level (or the
 * starting record the body carried — a Fixer draft), the alias, and the
 * concept card applied when one was named. Quiet: a draft announces nothing
 * until it is submitted.
 */
export async function createBuild(db: Db, campaignId: string, input: CreateBuildInput): Promise<BuildRecord> {
  const facts = await campaignFacts(db, campaignId);
  const settings = chargenSettingsOf(facts.settings);

  if (input.ownerUserId !== input.requestedBy) {
    const member = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.campaignId, campaignId), eq(memberships.userId, input.ownerUserId)))
      .limit(1);
    if (!member[0]) throw httpError(400, 'bad_request', 'the owner is not a member of this campaign');
    // An observer or a display could never open the build (`assertBuilder`),
    // yet it would count against their open builds and wait on the GM alone.
    const role: string = member[0].role;
    if (role !== 'gm' && role !== 'player') {
      throw httpError(400, 'bad_request', 'the owner cannot build runners: only the GM and players do');
    }
  }
  const open = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(builds)
    .where(
      and(
        eq(builds.campaignId, campaignId),
        eq(builds.ownerUserId, input.ownerUserId),
        inArray(builds.state, ['draft', 'submitted', 'returned']),
      ),
    );
  if ((open[0]?.n ?? 0) >= MAX_OPEN_BUILDS) {
    throw httpError(409, 'too_many_builds', `at most ${MAX_OPEN_BUILDS} builds may be open at once`);
  }

  const preset = input.conceptId !== undefined ? conceptPreset(input.conceptId) : null;
  if (input.conceptId !== undefined && !preset) {
    throw httpError(400, 'bad_request', `unknown concept: ${input.conceptId}`);
  }
  let record: CharacterBuild = input.build
    ? { ...emptyBuild(settings), ...atCampaignLevel(input.build, settings) }
    : emptyBuild(settings);
  if (input.alias !== undefined) record = { ...record, identity: { ...record.identity, alias: input.alias } };
  if (preset) record = applyConcept(record, preset, settings);

  const row = (
    await db
      .insert(builds)
      .values({
        campaignId,
        ownerUserId: input.ownerUserId,
        build: atCampaignLevel(writableOf(record), settings),
      })
      .returning()
  )[0]!;
  return toBuildRecord(row);
}

/**
 * Autosave (§8.5): the whole player-owned record. Only a draft or a returned
 * build takes one, and the `state` guard sits in the UPDATE itself so a save
 * racing a submit loses cleanly instead of editing a build the GM is already
 * reviewing.
 *
 * `baseUpdatedAt` is the optimistic precondition (`BuildPatchSchema`): the
 * `updatedAt` of the row the device's record was built on. When given, it is
 * part of the same UPDATE's guard — the row must not have moved on since —
 * so two devices saving at once cannot both pass a check made before either
 * wrote. Compared at millisecond precision, because that is all an ISO
 * string carries while the column holds microseconds (a fresh row's
 * `defaultNow()`): a device holding the row's own timestamp is never stale
 * against itself. A refused save answers `409 build_stale` with the row as it
 * now stands, so the device can put its edits beside the newer record. With
 * no base, last write wins.
 */
export async function saveBuild(
  db: Db,
  rec: BuildRecord,
  build: BuildWritable,
  baseUpdatedAt: string | null = null,
): Promise<BuildRecord> {
  assertState(rec, ['draft', 'returned'], 'edited');
  const base = baseUpdatedAt === null ? null : new Date(baseUpdatedAt);
  if (base !== null && Number.isNaN(base.getTime())) {
    throw httpError(400, 'bad_request', 'baseUpdatedAt must be an ISO timestamp');
  }
  const settings = await readChargenSettings(db, rec.campaignId);
  const rows = await db
    .update(builds)
    .set({ build: atCampaignLevel(writableOf(build), settings), updatedAt: new Date() })
    .where(
      and(
        eq(builds.id, rec.id),
        inArray(builds.state, ['draft', 'returned']),
        ...(base !== null ? [sql`date_trunc('milliseconds', ${builds.updatedAt}) <= ${base.toISOString()}::timestamptz`] : []),
      ),
    )
    .returning();
  if (rows[0]) return toBuildRecord(rows[0]);
  // Refused: say which guard did it, from the row as it stands now.
  const current = await loadBuild(db, rec.id);
  if (!current) throw httpError(404, 'not_found', 'unknown build');
  if (base !== null && current.state !== 'submitted' && current.state !== 'approved') {
    throw httpError(409, BUILD_STALE_CODE, 'the build was saved from another device since this record was loaded', buildDto(current));
  }
  throw httpError(409, 'build_state', 'the build was submitted before this save arrived');
}

/** Works from the row's columns (`BuildHead`), so a row whose record no longer reads can still go. */
export async function deleteBuild(db: Db, auth: AuthContext, rec: BuildHead): Promise<void> {
  if (auth.role === 'gm') assertState(rec, ['draft', 'submitted', 'returned'], 'deleted');
  else assertState(rec, ['draft', 'returned'], 'deleted by its owner');
  const rows = await db
    .delete(builds)
    .where(and(eq(builds.id, rec.id), eq(builds.state, rec.state)))
    .returning({ id: builds.id });
  if (!rows[0]) throw httpError(409, 'build_state', 'the build changed before it could be deleted');
}

// ---------------------------------------------------------------------------
// The engine's word
// ---------------------------------------------------------------------------

/** `GET /api/builds/:id/check`: pools, issues, the compiled sheet and, when derivation runs, the derived character. */
export async function checkBuild(db: Db, rec: BuildRecord): Promise<BuildCheckDto> {
  const settings = await readChargenSettings(db, rec.campaignId);
  const compiled = compileBuild(rec.build, settings);
  let derived: unknown;
  try {
    derived = deriveCharacter(compiled.sheet);
  } catch {
    // A half-built draft can compile to something derive cannot read yet;
    // the contract makes `derived` optional for exactly this.
    derived = undefined;
  }
  return {
    budgets: budgets(rec.build, settings),
    issues: compiled.issues,
    sheet: compiled.sheet,
    ...(derived !== undefined ? { derived } : {}),
  };
}

const errorsOf = (issues: readonly Issue[]) => issues.filter((i) => i.severity === 'error');

// ---------------------------------------------------------------------------
// The review loop: submit, return, decide
// ---------------------------------------------------------------------------

function announceTo(rec: BuildRecord) {
  return { visibility: 'gm_owner' as const, ownerUserId: rec.ownerUserId };
}

/**
 * The owner sends a finished build to the GM. Refused, with the errors, while
 * any error stands — and the record judged is the one under the row's lock,
 * so an autosave that commits while Submit is on its way (a second device, a
 * debounce firing) is the record that gets judged.
 *
 * The engine pass itself happens OUTSIDE the transaction, on the record the
 * route read, and is repeated inside only when the lock finds a row that has
 * moved since. `validate` over a long record is not free, and inside
 * `hub.atomic` it holds the process's one database connection: a build's own
 * owner could make every other device at the table wait on their Submit.
 */
export async function submitBuild(db: Db, hub: Hub, rec: BuildRecord): Promise<BuildRecord> {
  assertState(rec, ['draft', 'returned'], 'submitted');
  const settings = await readChargenSettings(db, rec.campaignId);
  // The verdict is computed BEFORE the transaction opens. An engine pass over
  // a long record takes real time, and inside `hub.atomic` it holds PGlite's
  // single connection — one player's Submit stalled the GM's own list for as
  // long as it ran. Inside, the pass is repeated only when the row has moved
  // since this read (`updatedAt`), which is the one case where judging the
  // earlier copy would be judging the wrong record.
  let issues = validate(rec.build, settings);
  const refuse = (errors: readonly Issue[]): never => {
    throw httpError(409, 'build_invalid', 'the build has errors to fix before it can be submitted', { issues: errors });
  };
  const early = errorsOf(issues);
  if (early.length > 0) refuse(early);
  return hub.atomic(rec.campaignId, async (tx) => {
    const current = await lockBuild(tx.db, rec.id);
    assertState(current, ['draft', 'returned'], 'submitted');
    if (current.updatedAt !== rec.updatedAt) {
      // An autosave (a second device, a debounce firing) landed between the
      // read and the lock: the record under the lock is the one that counts.
      issues = validate(current.build, settings);
      const errors = errorsOf(issues);
      if (errors.length > 0) refuse(errors);
    }
    const rows = await tx.db
      .update(builds)
      .set({ state: 'submitted', updatedAt: new Date() })
      .where(and(eq(builds.id, rec.id), inArray(builds.state, ['draft', 'returned'])))
      .returning();
    if (!rows[0]) throw httpError(409, 'build_state', 'the build changed before it could be submitted');
    const next = toBuildRecord(rows[0]);
    await tx.emit({
      type: 'build.submitted',
      payload: {
        buildId: next.id,
        ownerUserId: next.ownerUserId,
        alias: next.build.identity.alias,
        state: next.state,
        approvalsPending: issues.filter((i) => i.severity === 'approval').length,
      },
      ...announceTo(next),
    });
    return next;
  });
}

/**
 * Apply `{ code: decision | null }` to the stored decisions; `null` takes a
 * decision back. Each GM write is bounded by its schema; this bounds what the
 * column accumulates across writes — a merge that would grow it past
 * `MAX_APPROVAL_DECISIONS` is refused (one that re-decides or takes back
 * codes never is, so an oversized column can always be shrunk).
 */
export function mergeApprovals(
  current: Record<string, ApprovalDecision>,
  patch: Record<string, ApprovalDecision | null>,
): Record<string, ApprovalDecision> {
  const next = { ...current };
  for (const [code, decision] of Object.entries(patch)) {
    if (decision === null) delete next[code];
    else next[code] = decision;
  }
  const size = Object.keys(next).length;
  if (size > MAX_APPROVAL_DECISIONS && size > Object.keys(current).length) {
    throw httpError(
      409,
      'too_many_approvals',
      `a build holds at most ${MAX_APPROVAL_DECISIONS} decisions; take back ones no longer needed`,
      { max: MAX_APPROVAL_DECISIONS },
    );
  }
  return next;
}

/** The GM reopens a submitted build with a note pinned to a step, and any decisions made so far. */
export async function returnBuild(
  hub: Hub,
  rec: BuildRecord,
  body: { notes: string; step?: number | null; approvals?: Record<string, ApprovalDecision> },
): Promise<BuildRecord> {
  assertState(rec, ['submitted'], 'returned');
  return hub.atomic(rec.campaignId, async (tx) => {
    // Locked, so a decision from another device waits for this return rather than being merged over.
    const current = await tx.db
      .select({ approvals: builds.approvals })
      .from(builds)
      .where(eq(builds.id, rec.id))
      .for('update');
    const approvals = mergeApprovals(readApprovals(current[0]?.approvals), body.approvals ?? {});
    const rows = await tx.db
      .update(builds)
      .set({
        state: 'returned',
        notes: body.notes,
        returnedStep: body.step ?? null,
        approvals,
        updatedAt: new Date(),
      })
      .where(and(eq(builds.id, rec.id), eq(builds.state, 'submitted')))
      .returning();
    if (!rows[0]) throw httpError(409, 'build_state', 'the build changed before it could be returned');
    const next = toBuildRecord(rows[0]);
    await tx.emit({
      type: 'build.returned',
      payload: {
        buildId: next.id,
        ownerUserId: next.ownerUserId,
        alias: next.build.identity.alias,
        notes: next.notes,
        step: next.returnedStep,
      },
      ...announceTo(next),
    });
    return next;
  });
}

/**
 * The GM's per-item calls, merged into the column. Announced as
 * `build.reviewed` — not `build.submitted` (the GM's console would read it
 * as the player sending it again) nor `build.returned` (the player's page
 * would reopen editing and pin a note that was never written). A decision is
 * neither transition; it changes what `check` says for the owner's Finish
 * step and the GM's other devices, so it is persisted and replays like the
 * rest of the loop, `gm_owner` like the build.
 */
export async function decideApprovals(
  hub: Hub,
  rec: BuildRecord,
  patch: Record<string, ApprovalDecision | null>,
): Promise<BuildRecord> {
  assertState(rec, ['draft', 'submitted', 'returned'], 'reviewed');
  return hub.atomic(rec.campaignId, async (tx) => {
    const current = await tx.db
      .select({ approvals: builds.approvals, state: builds.state })
      .from(builds)
      .where(eq(builds.id, rec.id))
      // Locked: an approval in flight holds this row, and this read then sees it approved.
      .for('update');
    if (!current[0] || current[0].state === 'approved') {
      throw httpError(409, 'build_state', 'the build was approved before these decisions arrived');
    }
    const approvals = mergeApprovals(readApprovals(current[0].approvals), patch);
    const rows = await tx.db
      .update(builds)
      .set({ approvals, updatedAt: new Date() })
      .where(eq(builds.id, rec.id))
      .returning();
    const next = toBuildRecord(rows[0]!);
    await tx.emit({
      type: 'build.reviewed',
      payload: { buildId: next.id, ownerUserId: next.ownerUserId, approvals: next.approvals, decided: patch },
      ...announceTo(next),
    });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Approval: the build becomes a character
// ---------------------------------------------------------------------------

/**
 * An in-game `YYYY-MM-DD` plus whole months, the day clamped to the month
 * (a lifestyle paid from 31 January for one month runs to 28 February); null
 * when the campaign has no date or not one of that shape.
 */
export function addMonths(date: string | null, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const mo = index - y * 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(y, 4)}-${pad(mo + 1, 2)}-${pad(Math.min(day, last), 2)}`;
}

export interface StartingNuyenRoll {
  id: string;
  faces: number[];
  /** The dice total. */
  sum: number;
  multiplier: number;
  /** sum × multiplier — the rolled part, carry-over not included. */
  nuyen: number;
}

export interface ApproveResult {
  build: BuildRecord;
  character: CharacterRecord;
  revision: number;
  opening: CompiledOpening;
  roll: StartingNuyenRoll;
}

/** The magic shelf records an approved build brings with it. */
function magicRecordsFor(
  compiled: CompiledBuild,
  build: CharacterBuild,
  characterId: string,
  now: string,
): { spirits: SpiritRecord[]; sprites: SpriteRecord[]; foci: FocusRecord[] } {
  const spirits = compiled.spirits.map((s) =>
    SpiritRecordSchema.parse({
      id: newMagicId('spirit'),
      characterId,
      name: `${s.spiritType} spirit (Force ${s.force})`,
      spiritType: s.spiritType,
      force: s.force,
      bound: true,
      services: s.services,
      servicesInitial: s.services,
      note: 'Bound at character creation',
      createdAt: now,
    }),
  );
  const sprites = compiled.sprites.map((s) =>
    SpriteRecordSchema.parse({
      id: newMagicId('sprite'),
      characterId,
      name: `${s.spriteType} sprite (Level ${s.level})`,
      spriteType: s.spriteType,
      level: s.level,
      registered: true,
      tasks: s.tasks,
      tasksInitial: s.tasks,
      note: 'Registered at character creation',
      createdAt: now,
    }),
  );
  const foci = compiled.foci.map((f) => {
    const bought = f.purchaseIndex !== null ? build.purchases[f.purchaseIndex] : undefined;
    const ref = f.ref ?? bought?.ref ?? bought?.item.ref;
    const note = bought && 'note' in bought.item && typeof bought.item.note === 'string' ? bought.item.note : '';
    return FocusRecordSchema.parse({
      id: newMagicId('focus'),
      characterId,
      name: f.name,
      kind: f.kind,
      force: f.force,
      bonded: true,
      active: false,
      sourceKind: f.sourceKind,
      targets: f.targets,
      mods: f.mods,
      ...(ref ? { ref } : {}),
      note: note.slice(0, 300),
      createdAt: now,
    });
  });
  return { spirits, sprites, foci };
}

/**
 * Approve a submitted build (§8.5). Refused with the blocking issues — every
 * error, and every `approval` issue the GM has not yet decided — before
 * anything is written. `decisions` are the GM's calls travelling with the
 * approval (`BuildApproveSchema`); they count for the check and are stored
 * with the approved row, and nothing of them is kept if approval is refused.
 *
 * The verdict, the dice and the character all come from the row as it stands
 * under its lock inside the transaction — not from `rec`, which the route
 * read before it opened. A denial from the GM's other device that commits in
 * between is merged under this approval's decisions, never overwritten by a
 * stale copy, and the character is built from the decisions actually stored.
 *
 * The engine passes that produce them (`validate`, and `compileBuild` twice)
 * run on `rec` BEFORE the transaction opens, and are redone inside only when
 * the lock finds a row that has moved since — the case that made the earlier
 * copy the wrong record. They are the expensive part of this function, and
 * inside `hub.atomic` they hold the process's one database connection while
 * every other device waits.
 */
export async function approveBuild(
  db: Db,
  hub: Hub,
  auth: AuthContext,
  rec: BuildRecord,
  decisions: Record<string, ApprovalDecision> = {},
): Promise<ApproveResult> {
  assertState(rec, ['submitted'], 'approved');
  // Hoisted: the campaign row is read through the outer handle, which must
  // never be touched inside the block (the deadlock rule on `Hub.atomic`).
  const { settings: raw, ingameDate } = await campaignFacts(db, rec.campaignId);
  const settings = chargenSettingsOf(raw);
  const svc = getRollService(db, hub);
  const now = new Date().toISOString();

  /**
   * Judge a record and build its character: the blocking issues, the
   * starting-nuyen roll (SR5 p.95, thrown by the server through the roll
   * service's entropy knob so a test pins it like any other die) and the
   * compiled sheet. Run once outside the transaction and again inside it only
   * if the locked row turns out to have moved.
   */
  const judge = (build: CharacterBuild): { compiled: CompiledBuild; faces: number[]; sum: number } => {
    const issues = validate(build, settings);
    const blocking = issues.filter((i) => i.severity === 'error' || i.severity === 'approval');
    if (blocking.length > 0) {
      throw httpError(409, 'build_not_approvable', 'the build has errors or GM decisions still to make', {
        issues: blocking,
      });
    }
    const dice = compileBuild(build, settings).opening.startingNuyen.dice;
    const faces = Array.from({ length: dice }, () => Math.min(6, Math.max(1, Math.floor(svc.nextRandom() * 6) + 1)));
    const sum = faces.reduce((a, b) => a + b, 0);
    return { compiled: compileBuild(build, settings, { startingNuyenRoll: sum }), faces, sum };
  };

  const earlyApprovals = mergeApprovals(rec.approvals, decisions);
  const early = judge({ ...rec.build, approvals: earlyApprovals });

  const result = await hub.atomic(rec.campaignId, async (tx) => {
    const current = await lockBuild(tx.db, rec.id);
    assertState(current, ['submitted'], 'approved');
    const approvals = mergeApprovals(current.approvals, decisions);
    const build: CharacterBuild = { ...current.build, approvals };

    // Redone only when the row moved, or when the decisions the lock found
    // differ from the ones judged a moment ago (the GM's other device).
    const moved =
      current.updatedAt !== rec.updatedAt || JSON.stringify(approvals) !== JSON.stringify(earlyApprovals);
    const { compiled, faces, sum } = moved ? judge(build) : early;
    const { opening } = compiled;
    const multiplier = opening.startingNuyen.multiplier;
    const tier = startingLifestyle(build) ?? 'street';

    const sheet: SheetV1 = {
      ...compiled.sheet,
      lifestyles: compiled.sheet.lifestyles.map((l, i) => {
        const paidThrough = addMonths(ingameDate, compiled.lifestyles[i]?.months ?? 0);
        return paidThrough ? { ...l, paidThrough } : l;
      }),
    };
    const name = sheet.identity.alias;
    const history: CharacterBuild = { ...build, state: 'approved' };

    // Claim the build before writing a character: under the lock this cannot
    // miss, and without one (a store that ignores FOR UPDATE) a second
    // approval racing this one still stops here.
    const claimed = await tx.db
      .update(builds)
      .set({ state: 'approved', approvals, updatedAt: new Date() })
      .where(and(eq(builds.id, rec.id), eq(builds.state, 'submitted')))
      .returning({ id: builds.id });
    if (!claimed[0]) throw httpError(409, 'build_state', 'the build changed before it could be approved');

    // The character, its build as history, revision 1 — as creation does it.
    const inserted = await tx.db
      .insert(characters)
      .values({
        campaignId: rec.campaignId,
        ownerUserId: rec.ownerUserId,
        name,
        sheet: { ...sheet, play: {} },
        build: history,
      })
      .returning({ id: characters.id });
    const characterId = inserted[0]!.id;
    const revision = await recordRevision(tx.db, {
      characterId,
      sheet,
      cause: BUILT_CAUSE,
      createdBy: auth.userId,
    });
    await tx.emit({
      type: 'sheet.updated',
      payload: { characterId, name, revision, cause: BUILT_CAUSE, buildId: rec.id },
    });

    // Contacts (§8.2: the table, role → archetype).
    if (compiled.contacts.length > 0) {
      await tx.db.insert(contacts).values(
        compiled.contacts.map((c) => ({
          characterId,
          name: c.name,
          archetype: c.archetype,
          connection: c.connection,
          loyalty: c.loyalty,
          notes: writeNotes(c.notes ?? '', { owed: 0, owing: 0 }),
        })),
      );
    }

    // Spirits, sprites and foci onto the campaign's magic shelf.
    const magic = magicRecordsFor(compiled, build, characterId, now);
    if (magic.spirits.length + magic.sprites.length + magic.foci.length > 0) {
      const shelf = await readMagicState(tx.db, rec.campaignId);
      if (shelf.spirits.length + magic.spirits.length > MAX_SPIRITS) {
        throw httpError(409, 'too_many_spirits', `a campaign tracks at most ${MAX_SPIRITS} spirits`);
      }
      if (shelf.sprites.length + magic.sprites.length > MAX_SPRITES) {
        throw httpError(409, 'too_many_sprites', `a campaign tracks at most ${MAX_SPRITES} sprites`);
      }
      if (shelf.foci.length + magic.foci.length > MAX_FOCI) {
        throw httpError(409, 'too_many_foci', `a campaign tracks at most ${MAX_FOCI} foci`);
      }
      await commitMagicState(
        tx.db,
        hub,
        rec.campaignId,
        {
          ...shelf,
          spirits: [...shelf.spirits, ...magic.spirits],
          sprites: [...shelf.sprites, ...magic.sprites],
          foci: [...shelf.foci, ...magic.foci],
        },
        { payload: { op: 'build.approved', characterId, ...magic } },
        tx,
      );
    }

    // The starting-nuyen roll, on the record.
    const roll = await recordStartingNuyenRoll(tx, {
      campaignId: rec.campaignId,
      characterId,
      ownerUserId: rec.ownerUserId,
      actorName: name,
      buildId: rec.id,
      faces,
      multiplier,
      tier,
      carried: opening.nuyenCarry,
    });

    // Opening balances: approved, because the GM is the one approving.
    const entry = (currency: 'karma' | 'nuyen', delta: number, reason: string) =>
      delta > 0
        ? createEntry(
            tx.db,
            hub,
            rec.campaignId,
            { characterId, currency, delta, reason, state: 'approved', createdBy: auth.userId },
            { tx },
          )
        : Promise.resolve(null);
    const reasons = openingReasons({
      karma: opening.karma,
      nuyenCarry: opening.nuyenCarry,
      dice: faces.length,
      sum,
      multiplier,
    });
    await entry('karma', opening.karma, reasons.karma);
    await entry('nuyen', opening.nuyenCarry, reasons.carried);
    await entry('nuyen', sum * multiplier, reasons.rolled);

    await tx.db.update(builds).set({ characterId }).where(eq(builds.id, rec.id));
    await tx.emit({
      type: 'build.approved',
      payload: {
        buildId: rec.id,
        ownerUserId: rec.ownerUserId,
        characterId,
        name,
        revision,
        rollId: roll.id,
        opening: { karma: opening.karma, nuyen: opening.nuyenCarry + sum * multiplier },
      },
      ...announceTo(rec),
    });
    return { characterId, revision, opening, roll: { ...roll, sum, multiplier, nuyen: sum * multiplier } };
  });

  // The magic shelf lives in `campaigns.settings`; forget the cache only once
  // the write is visible to everyone else.
  forgetCampaignSettings(rec.campaignId);
  return {
    build: await requireBuild(db, rec.id),
    character: await requireCharacter(db, result.characterId),
    revision: result.revision,
    opening: result.opening,
    roll: result.roll,
  };
}

/**
 * A number as the app writes one everywhere ("5,000", en-US grouping — the
 * web's `formatNuyen` adds the ¥), so the ledger's reasons and the roll's
 * label read like the rest of the table's money.
 */
export function groupedNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * The opening ledger entries' reasons: the Karma carried, the nuyen left over
 * from creation, and the rolled starting nuyen with its dice. Our words; the
 * numbers grouped (`groupedNumber`), so a log line reads "+5,000¥ — Built:
 * 5,000¥ left over from creation", not "5000¥".
 */
export function openingReasons(o: { karma: number; nuyenCarry: number; dice: number; sum: number; multiplier: number }): {
  karma: string;
  carried: string;
  rolled: string;
} {
  return {
    karma: `Built: ${groupedNumber(o.karma)} Karma carried into play`,
    carried: `Built: ${groupedNumber(o.nuyenCarry)}¥ left over from creation`,
    rolled: `Built: starting nuyen, ${o.dice}D6 (${o.sum}) × ${groupedNumber(o.multiplier)}`,
  };
}

interface StartingNuyenInput {
  campaignId: string;
  characterId: string;
  ownerUserId: string;
  actorName: string;
  buildId: string;
  faces: number[];
  multiplier: number;
  tier: string;
  carried: number;
}

/**
 * Persist the starting-nuyen dice and announce them — the `recordCopilotRoll`
 * pattern (services/encounters-rolls.ts) with a character for the actor, since
 * `RollService.performRoll` opens its own block and cannot join approval's.
 *
 * The request stays `RollRequest`-shaped so the log renders it like any roll;
 * the sum, the multiplier and the nuyen it came to ride in `meta`
 * (`meta.chargen: 'startingNuyen'` marks it). Visible to the GM and the owner
 * (`gm_owner`, owner stamped into `meta.ownerUserId` for the log's SQL
 * filter), like the build it came from.
 *
 * It is a sum, not a success test, so it is stored as one that scored
 * nothing: no hits, no ones, no glitch — a 1 on these dice is a smaller
 * purse, not a glitch, and a 5 is not a hit. And it belongs to no session:
 * approval can happen mid-game, but the dice are the character's past, so
 * they stay out of that session's filter and its end-of-session roll tally.
 */
async function recordStartingNuyenRoll(
  tx: EventTx,
  input: StartingNuyenInput,
): Promise<{ id: string; faces: number[] }> {
  const sum = input.faces.reduce((a, b) => a + b, 0);
  const label = `Starting nuyen: ${input.faces.length}D6 × ${groupedNumber(input.multiplier)}`;
  const actor = { characterId: input.characterId };
  const request = {
    kind: 'simple' as const,
    pool: input.faces.length,
    breakdown: [{ label: `${input.tier} lifestyle`, value: input.faces.length, source: 'chargen' }],
    visibility: 'gm_owner' as const,
    actor,
    label,
    meta: {
      label,
      chargen: 'startingNuyen',
      buildId: input.buildId,
      lifestyle: input.tier,
      sum,
      multiplier: input.multiplier,
      nuyen: sum * input.multiplier,
      carried: input.carried,
      total: sum * input.multiplier + input.carried,
      ownerUserId: input.ownerUserId,
      actorName: input.actorName,
    },
  };
  const row = (
    await tx.db
      .insert(rolls)
      .values({
        campaignId: input.campaignId,
        sessionId: null,
        actor,
        kind: 'simple',
        request,
        faces: input.faces,
        hits: 0,
        ones: 0,
        glitch: 'none',
        limit: null,
        limitedHits: 0,
        visibility: 'gm_owner',
      })
      .returning()
  )[0]!;
  await tx.emit({
    type: 'roll.created',
    payload: {
      ...toRollRecord(row),
      label,
      actorName: input.actorName,
      result: { faces: input.faces, hits: 0, ones: 0, glitch: 'none', limitedHits: 0 },
    },
    visibility: 'gm_owner',
    ownerUserId: input.ownerUserId,
  });
  return { id: row.id, faces: input.faces };
}
