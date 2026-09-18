/**
 * builds domain plugin (FR3.9 native character creation, docs/CHARGEN.md
 * §4.3, §8.5).
 *
 *   GET    /api/campaigns/:id/chargen        any member: the campaign's creation settings
 *   PUT    /api/campaigns/:id/chargen        GM: a partial write merged onto them
 *                                            (ephemeral `chargen.updated` to the table)
 *   GET    /api/campaigns/:id/builds         GM: every build; player: their own
 *   POST   /api/campaigns/:id/builds         GM or player: a new draft
 *   GET    /api/builds/:id                   owner or GM
 *   PATCH  /api/builds/:id                   owner or GM, draft/returned only: autosave the record
 *                                            (`baseUpdatedAt` older than the row → 409 build_stale)
 *   DELETE /api/builds/:id                   owner while draft/returned; GM until approval
 *   GET    /api/builds/:id/check             owner or GM: budgets, issues, sheet, derived
 *   POST   /api/builds/:id/submit            owner: draft/returned → submitted
 *   POST   /api/builds/:id/return            GM: submitted → returned, with a note
 *   POST   /api/builds/:id/approvals         GM: per-item decisions on approval issues
 *   POST   /api/builds/:id/approve           GM: submitted → approved, the character created
 *
 * Secrecy (Principle 4): a draft is its owner's and the GM's. Observers and
 * display devices never reach a build, another player's device is refused
 * one, and every build event is `gm_owner` with the build's owner, so the
 * filtering happens at the hub rather than in a client. The chargen settings
 * are not secret — they are the table's rules — and players cannot read
 * `campaigns.settings` itself (it holds the Discord webhook), so they have a
 * member-readable route of their own (§8.2).
 *
 * Atomicity (§6.2, LIVE-4): submit, return, approvals and approve each commit
 * their row and their event together (`hub.atomic`, inside the service).
 * Autosave and create announce nothing persisted — the replay log is for what
 * the table needs to catch up on after a reconnect, and a draft's keystrokes
 * are not that — so a PATCH sends at most an ephemeral `build.saved` to the
 * owner's and the GM's other open devices. A settings write is the same shape
 * for the opposite reason: one current value nobody replays, but every open
 * builder holds a copy of it, so the PUT sends an ephemeral `chargen.updated`
 * and the devices refetch rather than go on building to last week's rules.
 *
 * Two open devices (a player's phone and tablet, a GM editing a player's
 * draft) must not silently overwrite each other's autosaves. A PATCH may name
 * the `updatedAt` its record was built on (`baseUpdatedAt`); when the row has
 * moved on since, the save is refused with `409 build_stale` and the row as it
 * now stands in `error.details`, so the device can show its own edits beside
 * the newer record and let the player choose. A PATCH without it is last
 * write wins.
 *
 * Ids: a malformed `:id` answers 404 like an unknown one (the `UUID_RE` guard
 * from services/rolls.ts), never Postgres' 22P02 as a 500.
 *
 * A row whose record no longer reads is listed as a flagged stub and logged,
 * never a 500 for the whole list; DELETE checks access and state from the
 * row's columns alone, so such a row can still be removed. Every single-build
 * route decides access on the row's columns BEFORE parsing its record, so such
 * a row answers `build_invalid` only to the owner and the GM — and never with
 * zod's issues, which describe the fields of a build the reader may not open.
 * A build in another campaign answers 404, not 403, for the same reason.
 *
 * Bounds: every GM write of decisions (`return`, `approvals`, `approve`)
 * carries at most `MAX_APPROVAL_DECISIONS` codes of at most 200 characters,
 * and the column never grows past that many across writes (`mergeApprovals`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  BuildApprovalsSchema,
  BuildApproveSchema,
  BuildCreateSchema,
  BuildPatchSchema,
  BuildReturnSchema,
  ChargenSettingsWriteSchema,
} from '@safehouse/contracts';
import { assertCampaign, httpError, requireAuth, requireRole, type AuthContext } from '../services/auth.js';
import {
  UUID_RE,
  approveBuild,
  assertBuilder,
  assertCanOpenBuild,
  assertGmOf,
  buildDto,
  checkBuild,
  createBuild,
  decideApprovals,
  deleteBuild,
  isUnreadable,
  listBuilds,
  readChargenSettings,
  requireBuildFor,
  requireBuildHead,
  returnBuild,
  saveBuild,
  submitBuild,
  unreadableDto,
  writeChargenSettings,
} from '../services/builds.js';
import { characterDto } from '../services/characters.js';
import { balancesFor } from './ledger.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

export default async function buildsPlugin(app: FastifyInstance): Promise<void> {
  /** The `:id` of a campaign route: 404 when malformed, 403 when this device is not bound to it. */
  function campaignScope(req: FastifyRequest): { auth: AuthContext; campaignId: string } {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown campaign');
    assertCampaign(auth, id);
    return { auth, campaignId: id };
  }

  /**
   * One build for a device that may have it. Access is decided on the row's
   * columns and the record is parsed after — never the other way round, which
   * let an unreadable row answer 500 (with zod's issues) to a device that was
   * not allowed to know it existed. The issues go to this request's log, as
   * the list route has always logged them.
   */
  async function openBuild(req: FastifyRequest, access?: typeof assertGmOf) {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireBuildFor(app.db, auth, id, {
      ...(access ? { access } : {}),
      onUnreadable: (issues) =>
        req.log.warn({ buildId: id, issues: issues.slice(0, 5) }, 'builds: stored record failed validation'),
    });
    return { auth, rec };
  }

  const gmBuild = (req: FastifyRequest) => openBuild(req, assertGmOf);

  // --- campaign settings --------------------------------------------------
  app.get('/api/campaigns/:id/chargen', async (req, reply) => {
    const { campaignId } = campaignScope(req);
    return reply.send({ campaignId, settings: await readChargenSettings(app.db, campaignId) });
  });

  app.put('/api/campaigns/:id/chargen', async (req, reply) => {
    requireRole(req, 'gm');
    const { auth, campaignId } = campaignScope(req);
    const write = parse(ChargenSettingsWriteSchema, req.body);
    const settings = await writeChargenSettings(app.db, campaignId, write);
    // Not persisted: the settings are one current value, and nothing about a
    // past write needs replaying. But every open builder is holding a copy —
    // the level's caps, the priority table, the book list its catalogue
    // searches are scoped by — so the table is told the rules moved and
    // refetches. The level and the table ride along because they are what a
    // device shows before its refetch lands; neither is secret (the whole
    // table reads the settings through the member route).
    app.hub.emitEphemeral(campaignId, {
      type: 'chargen.updated',
      payload: { campaignId, level: settings.level, table: settings.table, by: auth.userId },
    });
    return reply.send({ campaignId, settings });
  });

  // --- the list and a new draft -------------------------------------------
  app.get('/api/campaigns/:id/builds', async (req, reply) => {
    const { auth, campaignId } = campaignScope(req);
    assertBuilder(auth);
    const recs = await listBuilds(app.db, campaignId, auth.role === 'gm' ? undefined : auth.userId);
    const rows = recs.map((rec) => {
      if (!isUnreadable(rec)) return buildDto(rec);
      req.log.warn(
        { buildId: rec.id, campaignId, issues: rec.issues.slice(0, 5) },
        'builds: stored record failed validation; listed as unreadable',
      );
      return unreadableDto(rec);
    });
    return reply.send({ campaignId, builds: rows });
  });

  app.post('/api/campaigns/:id/builds', async (req, reply) => {
    const { auth, campaignId } = campaignScope(req);
    assertBuilder(auth);
    // `ownerUserId` is the GM's alone: a GM may start a build for a player at
    // the table; a player's is always their own.
    const body = parse(BuildCreateSchema, req.body);
    if (body.ownerUserId !== undefined && auth.role !== 'gm' && body.ownerUserId !== auth.userId) {
      throw httpError(403, 'forbidden', 'a player starts builds only for themselves');
    }
    const rec = await createBuild(app.db, campaignId, {
      ownerUserId: body.ownerUserId ?? auth.userId,
      requestedBy: auth.userId,
      ...(body.alias !== undefined ? { alias: body.alias } : {}),
      ...(body.conceptId !== undefined ? { conceptId: body.conceptId } : {}),
      ...(body.build !== undefined ? { build: body.build } : {}),
    });
    return reply.status(201).send(buildDto(rec));
  });

  // --- one build ------------------------------------------------------------
  app.get('/api/builds/:id', async (req, reply) => {
    const { rec } = await openBuild(req);
    return reply.send(buildDto(rec));
  });

  app.patch('/api/builds/:id', async (req, reply) => {
    const { auth, rec } = await openBuild(req);
    const body = parse(BuildPatchSchema, req.body);
    const next = await saveBuild(app.db, rec, body.build, body.baseUpdatedAt ?? null);
    // Never stored: a second open device (the GM's review screen, the
    // player's tablet) hears that the record moved and refetches it.
    app.hub.emitEphemeral(next.campaignId, {
      type: 'build.saved',
      payload: { buildId: next.id, ownerUserId: next.ownerUserId, updatedAt: next.updatedAt, by: auth.userId },
      visibility: 'gm_owner',
      ownerUserId: next.ownerUserId,
    });
    return reply.send(buildDto(next));
  });

  app.delete('/api/builds/:id', async (req, reply) => {
    // The row's columns only: a record that no longer parses must still be deletable.
    const auth = requireAuth(req);
    const head = await requireBuildHead(app.db, (req.params as { id: string }).id);
    assertCanOpenBuild(auth, head);
    await deleteBuild(app.db, auth, head);
    return reply.send({ deleted: head.id });
  });

  app.get('/api/builds/:id/check', async (req, reply) => {
    const { rec } = await openBuild(req);
    return reply.send(await checkBuild(app.db, rec));
  });

  // --- the review loop ------------------------------------------------------
  app.post('/api/builds/:id/submit', async (req, reply) => {
    const { auth, rec } = await openBuild(req);
    if (rec.ownerUserId !== auth.userId) {
      throw httpError(403, 'forbidden', 'only the owner submits a build');
    }
    return reply.send(buildDto(await submitBuild(app.db, app.hub, rec)));
  });

  app.post('/api/builds/:id/return', async (req, reply) => {
    const { rec } = await gmBuild(req);
    const body = parse(BuildReturnSchema, req.body);
    const next = await returnBuild(app.hub, rec, {
      notes: body.notes,
      step: body.step ?? null,
      ...(body.approvals ? { approvals: body.approvals } : {}),
    });
    return reply.send(buildDto(next));
  });

  app.post('/api/builds/:id/approvals', async (req, reply) => {
    const { rec } = await gmBuild(req);
    const body = parse(BuildApprovalsSchema, req.body);
    return reply.send(buildDto(await decideApprovals(app.hub, rec, body.approvals)));
  });

  app.post('/api/builds/:id/approve', async (req, reply) => {
    const { auth, rec } = await gmBuild(req);
    const body = parse(BuildApproveSchema, req.body);
    const out = await approveBuild(app.db, app.hub, auth, rec, body.approvals ?? {});
    // The shape is `BuildApproveResultSchema`; the route test parses the answer with it.
    return reply.status(201).send({
      build: buildDto(out.build),
      character: characterDto(out.character, await balancesFor(app.db, out.character.id)),
      revision: out.revision,
      opening: out.opening,
      roll: out.roll,
    });
  });
}
