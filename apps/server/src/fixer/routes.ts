/**
 * HTTP surface for the at-the-table Fixer tools (FR12.8, FR12.9, FR12.11).
 *
 * These are the same tools the model calls, exposed so the GM's own buttons —
 * "who is this?", "lay this place out", "are they at the door yet?" — reach
 * them without a chat turn. That matters: all three are deterministic, so they
 * work with **no inference box configured at all** (NG7). Only the wording
 * around them needs a model.
 *
 * The one exception is `POST /api/fixer/read-map` (FR12.11 lane 2), which needs
 * both a box and a vision-capable model on it; it says so with a distinct
 * status code rather than pretending, and `GET /api/fixer/status` publishes the
 * same capability so the button can be hidden before it is ever pressed.
 *
 * Everything is GM-only (§13) but one lane: the runner draft
 * (`/api/builds/:id/propose`, fixer/build-draft.ts), which a build's owner
 * reaches too, when the campaign turns it on. The two write-shaped routes produce
 * `ai_generations` drafts exactly like the tool path — nothing they return has
 * touched a token or a scene.
 *
 * Being the one player-reachable lane, that route is also the one place where
 * an error envelope has two audiences. A failure from the box names the
 * endpoint and quotes the provider, which is what the GM needs and is more
 * than a player should learn about the table's network, so the answer is
 * re-told for a non-GM (`sanitizeAiError`) with the status and code intact.
 *
 * Registered from `src/plugins/fixer.ts` (two lines: the import and one
 * `app.register`). That registration is load-bearing: these routes are the
 * GM's only way to reach FR12.8/12.9/12.11 with no model configured, which is
 * a supported posture (NG7), not a degraded one.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { campaigns, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { chargenSettingsOf, requireBuildFor } from '../services/builds.js';
import { withRun } from './activity.js';
import { ArchitectOutlineSchema, BuildSelectionSchema, buildArchitect, outlineArchitect } from './architect.js';
import {
  cancelBuildDraft,
  draftAvailability,
  draftBookIds,
  draftRefusal,
  proposeCharBuild,
  sanitizeAiError,
  withBuildDraft,
} from './build-draft.js';
import { floorPlanJsonSchema, proposeFloor } from './floor-plan.js';
import { layoutJsonSchema, LayoutDoorSchema, LayoutRoomSchema } from './geometry.js';
import { resolveLlmConfig } from './providers.js';
import { describeLook } from './token-look.js';
import { ScenesService } from '../services/scenes.js';
import { TokenLookSchema } from '@safehouse/contracts';
import { persistTurnUsage, type UsageKind, type UsageRecord } from './usage.js';
import { emitFogProximity, fogProximityState } from './proximity.js';
import { identifyTokensState } from './token-id.js';
import { FIXER_TOOLS, TOOLS_BY_NAME, toolParameters } from './tools.js';
import type { ToolContext } from './tool-kit.js';
import { mapVisionJsonSchema, proposeGeometryFromMap } from './vision.js';

const DescribeLookBody = z.object({
  description: z.string().trim().min(1).max(600),
  /** The look as the editor has it now, hand changes included. */
  current: TokenLookSchema.nullable().optional(),
});

const IdentifyBody = z.object({
  campaignId: z.string().optional(),
  sceneId: z.string().optional(),
  note: z.string().max(400).optional(),
  /** Draft by default; `false` answers "who is this?" without writing a row. */
  draft: z.boolean().default(true),
});

const GeometryBody = z.object({
  campaignId: z.string().optional(),
  sceneId: z.string().optional(),
  title: z.string().min(1).max(120),
  rooms: z.array(LayoutRoomSchema).min(1).max(60),
  doors: z.array(LayoutDoorSchema).max(160).default([]),
  notes: z.string().max(2000).default(''),
  mode: z.enum(['merge', 'replace']).default('merge'),
});

/** FR12.11 lane 2 — read the map the GM already uploaded onto the scene. */
const ReadMapBody = z.object({
  campaignId: z.string().optional(),
  sceneId: z.string().optional(),
  attachmentId: z.string().optional(),
  hint: z.string().max(600).optional(),
  mode: z.enum(['merge', 'replace']).default('merge'),
  slot: z.enum(['primary', 'fast']).optional(),
});

const BuildFloorBody = z.object({
  campaignId: z.string().optional(),
  sceneId: z.string().min(1),
  level: z.number().int().min(0).max(9).default(0),
  tilesetId: z.string().min(1).max(64),
  prompt: z.string().min(3).max(2000),
  slot: z.enum(['primary', 'fast']).optional(),
});

const ArchitectOutlineBody = z.object({
  campaignId: z.string().optional(),
  brief: z.string().min(10).max(4000),
  slot: z.enum(['primary', 'fast']).optional(),
});

const ArchitectBuildBody = z.object({
  campaignId: z.string().optional(),
  outline: ArchitectOutlineSchema,
  select: BuildSelectionSchema,
  slot: z.enum(['primary', 'fast']).optional(),
});

/** A player's description of their runner — data for the model, never instructions (fixer/build-draft.ts). */
const ProposeBuildBody = z.object({
  prompt: z.string().trim().min(3).max(2000),
});

const ProximityQuery = z.object({
  campaignId: z.string().optional(),
  sceneId: z.string().optional(),
  radiusM: z.coerce.number().min(0).max(50).optional(),
  /**
   * Also push the GM-only `fixer.suggestion` frame to the panel. Spelled out
   * rather than `z.coerce.boolean()`, which reads the string "false" as true.
   */
  announce: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * One durable row per turn the box answered (FR12.15).
 *
 * Per turn rather than per draft, and on the failure path as well as the happy
 * one: the repair turn's tokens were spent even when the repair missed, and a
 * meter that only counts the drafts that worked is a meter a GM cannot use to
 * answer "what has the box been doing?". A row that will not insert is never
 * worth the caller's answer (`persistTurnUsage` resolves either way).
 */
async function meterDraftTurns(
  db: Db,
  campaignId: string,
  turns: readonly UsageRecord[],
  kind: UsageKind,
): Promise<void> {
  for (const turn of turns) {
    const { promptTokens, completionTokens, totalTokens } = turn.usage;
    if (promptTokens + completionTokens + totalTokens <= 0) continue;
    await persistTurnUsage(db, { campaignId, model: turn.model, usage: turn.usage, latencyMs: turn.latencyMs, kind });
  }
}

/** GM-only, bound to this campaign — only the GM ever drives the Fixer. */
function gmFor(req: FastifyRequest, campaignId: string | undefined): string {
  const auth = requireRole(req, 'gm');
  const id = campaignId ?? auth.campaignId;
  if (!id) throw httpError(400, 'bad_request', 'campaignId is required');
  assertCampaign(auth, id);
  return id;
}

export default async function fixerToolRoutes(app: FastifyInstance): Promise<void> {
  const ctxFor = (campaignId: string, prompt: string): ToolContext => ({
    db: app.db,
    campaignId,
    prompt,
    /** No model was involved — the draft records that honestly. */
    model: null,
  });

  /** The catalog itself, so the GM panel can show what the Fixer can see. */
  app.get('/api/fixer/tools', async (req, reply) => {
    requireRole(req, 'gm');
    return reply.send({
      tools: FIXER_TOOLS.map((t) => ({
        name: t.name,
        kind: t.kind,
        description: t.description,
        parameters: toolParameters(t.schema),
      })),
      reads: FIXER_TOOLS.filter((t) => t.kind === 'read').length,
      drafts: FIXER_TOOLS.filter((t) => t.kind === 'draft').length,
    });
  });

  /**
   * The layout schema on its own, for grammar / guided-JSON constrained
   * decoding on the inference box (FR12.11/12.13).
   */
  app.get('/api/fixer/geometry-schema', async (req, reply) => {
    requireRole(req, 'gm');
    return reply.send({
      name: 'propose_geometry',
      units: 'whole grid squares; the scene grid supplies metres per square',
      layout: layoutJsonSchema(),
      tool: toolParameters(TOOLS_BY_NAME.get('propose_geometry')!.schema),
      /** The same schema plus the grid-alignment fields the vision lane adds. */
      mapVision: mapVisionJsonSchema(),
    });
  });

  // --- FR12.9: who is this? -------------------------------------------------
  app.post('/api/fixer/identify-tokens', async (req, reply) => {
    const body = parse(IdentifyBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    if (!body.draft) {
      return reply.send(
        await identifyTokensState(app.db, campaignId, {
          ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
        }),
      );
    }
    const tool = TOOLS_BY_NAME.get('identify_tokens')!;
    const result = await withRun(app.hub, campaignId, 'tokens', 'identifying the tokens on the scene', () =>
      tool.run(
        {
          ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
        ctxFor(campaignId, 'GM asked the app to identify the tokens on this scene'),
      ),
    );
    return reply.send(result);
  });

  // --- FR12.11: layout copilot ---------------------------------------------
  app.post('/api/fixer/propose-geometry', async (req, reply) => {
    const body = parse(GeometryBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const tool = TOOLS_BY_NAME.get('propose_geometry')!;
    const result = await withRun(app.hub, campaignId, 'geometry', `laying out ${body.title}`, () =>
      tool.run(
        {
          title: body.title,
          rooms: body.rooms,
          doors: body.doors,
          notes: body.notes,
          mode: body.mode,
          ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
        },
        ctxFor(campaignId, `GM asked for a layout: ${body.title}`),
      ),
    );
    return reply.status(201).send(result);
  });

  /** This campaign's settings blob — the AI config lives in it. */
  async function campaignSettings(db: Db, id: string): Promise<Record<string, unknown>> {
    const rows = await db
      .select({ settings: campaigns.settings })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    const raw = rows[0]?.settings;
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  }

  // --- FR12.11 lane 2: read the map image ----------------------------------
  /**
   * Unlike its neighbours this one DOES need the box — it is the only route
   * here that sends anything to a model. It answers three different ways on
   * purpose, because "hides cleanly" has to mean something the client can act
   * on: `503 ai_disabled` (no box), `501 vision_unsupported` (a box whose model
   * is text-only), or a geometry draft. `GET /api/fixer/status` reports the
   * same capability up front so the button need never be shown at all.
   */
  app.post('/api/fixer/read-map', async (req, reply) => {
    const body = parse(ReadMapBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    // The campaign's OWN configuration, like every other AI route. Reading the
    // environment here meant the one lane that actually sends an image to a
    // model ignored the provider the GM had chosen — so a GM who pointed the
    // Fixer at a vision model on their own screen still got whatever
    // LLM_BASE_URL happened to say, or nothing at all.
    const config = resolveLlmConfig(await campaignSettings(app.db, campaignId));
    const result = await withRun(app.hub, campaignId, 'map', 'reading the scene map image', (signal) =>
      proposeGeometryFromMap(app.db, config, {
        campaignId,
        mode: body.mode,
        prompt: 'GM asked the Fixer to read the scene map image',
        ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
        ...(body.attachmentId !== undefined ? { attachmentId: body.attachmentId } : {}),
        ...(body.hint !== undefined ? { hint: body.hint } : {}),
        ...(body.slot !== undefined ? { slot: body.slot } : {}),
        signal,
      }),
    );
    return reply.status(201).send(result);
  });

  // --- FR12.11 lane 3: build a floor from a description --------------------
  app.get('/api/fixer/floor-schema', async (req, reply) => {
    requireRole(req, 'gm');
    return reply.send({ name: 'build_floor', units: 'whole grid squares; a room includes its walls', plan: floorPlanJsonSchema() });
  });

  app.post('/api/fixer/build-floor', async (req, reply) => {
    const body = parse(BuildFloorBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    // The campaign's own configuration, like every other AI route.
    const config = resolveLlmConfig(await campaignSettings(app.db, campaignId));
    const result = await withRun(app.hub, campaignId, 'floor', 'drafting a floor from the description', (signal) =>
      proposeFloor(app.db, config, {
        campaignId,
        sceneId: body.sceneId,
        level: body.level,
        tilesetId: body.tilesetId,
        prompt: body.prompt,
        ...(body.slot !== undefined ? { slot: body.slot } : {}),
        signal,
      }),
    );
    await persistTurnUsage(app.db, {
      campaignId,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      kind: 'draft',
    });
    return reply.status(201).send(result);
  });

  // --- The Architect: a whole stretch of a campaign from one brief -----------
  app.post('/api/fixer/architect/outline', async (req, reply) => {
    const body = parse(ArchitectOutlineBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const config = resolveLlmConfig(await campaignSettings(app.db, campaignId));
    const result = await withRun(app.hub, campaignId, 'architect', 'roughing out the outline', (signal) =>
      outlineArchitect(app.db, config, {
        campaignId,
        brief: body.brief,
        ...(body.slot !== undefined ? { slot: body.slot } : {}),
        signal,
      }),
    );
    await persistTurnUsage(app.db, {
      campaignId,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      kind: 'draft',
    });
    return reply.status(201).send(result);
  });

  // Builds the ticked items one at a time. A cancel mid-way answers 200 with
  // what landed and `cancelled: true`, not 499 — the GM wants to know which
  // drafts and scenes exist, and every one of them is deletable on its own.
  app.post('/api/fixer/architect/build', async (req, reply) => {
    const body = parse(ArchitectBuildBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const config = resolveLlmConfig(await campaignSettings(app.db, campaignId));
    const count = body.select.lore.length + body.select.npcs.length + body.select.scenes.length;
    const result = await withRun(
      app.hub,
      campaignId,
      'architect',
      `building ${count} item${count === 1 ? '' : 's'} from the outline`,
      (signal, run) =>
        buildArchitect(app.db, config, {
          campaignId,
          outline: body.outline,
          select: body.select,
          ...(body.slot !== undefined ? { slot: body.slot } : {}),
          signal,
          hub: app.hub,
          run,
          atomic: (cid, fn) => app.hub.atomic(cid, fn),
        }),
    );
    if (result.usage.totalTokens > 0) {
      await persistTurnUsage(app.db, {
        campaignId,
        model: config?.primary ?? 'unknown',
        usage: result.usage,
        latencyMs: result.latencyMs,
        kind: 'draft',
      });
    }
    return reply.status(201).send(result);
  });

  // --- FR3.9 §8.5: the Fixer drafts a runner (owner or GM) ------------------
  /**
   * The build's owner or the GM of its campaign — the builds service's own
   * rule, so an observer, a display or another player is refused exactly as
   * opening the build refuses them, a build in another campaign is a 404, and
   * so is a malformed id.
   */
  async function draftTarget(req: FastifyRequest) {
    const auth = requireAuth(req);
    const id = (req.params as { id: string }).id;
    // Access on the row's columns first, the record parsed after: an
    // unreadable row must not answer a device that may not open the build.
    const rec = await requireBuildFor(app.db, auth, id, {
      onUnreadable: (issues) =>
        req.log.warn({ buildId: id, issues: issues.slice(0, 5) }, 'builds: stored record failed validation'),
    });
    const settings = await campaignSettings(app.db, rec.campaignId);
    const chargen = chargenSettingsOf(settings);
    const availability = draftAvailability({
      aiDrafts: chargen.aiDrafts,
      aiConfigured: resolveLlmConfig(settings) !== null,
      buildId: rec.id,
    });
    return { auth, rec, settings, chargen, availability };
  }

  /** Whether the Draft button works for this build, and why not — never the provider, model or key. */
  app.get('/api/builds/:id/propose', async (req, reply) => {
    const { availability } = await draftTarget(req);
    return reply.send(availability);
  });

  /**
   * A proposed build from a description. Never written: the answer is the
   * record the player may accept, its issues, and what could not be found.
   */
  app.post('/api/builds/:id/propose', async (req, reply) => {
    const { auth, rec, settings, chargen, availability } = await draftTarget(req);
    if (availability.reason) throw draftRefusal(availability.reason);
    if (rec.state !== 'draft' && rec.state !== 'returned') {
      throw httpError(409, 'build_state', `a ${rec.state} build cannot be redrafted`, { state: rec.state });
    }
    const body = parse(ProposeBuildBody, req.body);
    const config = resolveLlmConfig(settings);
    const bookIds = await draftBookIds(app.db, {
      campaignId: rec.campaignId,
      // The GM's own runner may draw on the GM's books; a player's never does.
      sharedOnly: !(auth.role === 'gm' && rec.ownerUserId === auth.userId),
      allowed: chargen.books,
    });
    // Every turn the box answered, whether or not the draft survived what was
    // in it: the meter reports the hardware, so a failed draft counts too
    // (fixer/usage.ts, `onTurn` in fixer/build-draft.ts).
    const turns: UsageRecord[] = [];
    let result: Awaited<ReturnType<typeof proposeCharBuild>>;
    try {
      result = await withBuildDraft(
        { buildId: rec.id, campaignId: rec.campaignId, userId: auth.userId },
        (signal) =>
          proposeCharBuild(app.db, config, {
            campaignId: rec.campaignId,
            base: rec.build,
            settings: chargen,
            bookIds,
            prompt: body.prompt,
            signal,
            onTurn: (record) => turns.push(record),
          }),
      );
    } catch (err) {
      await meterDraftTurns(app.db, rec.campaignId, turns, 'draft:failed');
      // The box's own words go to the log and to the GM, never to a player
      // (`sanitizeAiError`): this is the one Fixer route a non-GM reaches.
      const told = sanitizeAiError(err, { forGm: auth.role === 'gm' });
      if (told !== err) req.log.warn({ err }, 'a draft failed for a player; the endpoint and the provider text were kept back');
      throw told;
    }
    await meterDraftTurns(app.db, rec.campaignId, turns, 'draft');
    return reply.send(result);
  });

  /**
   * Dress a token's figure from a description: the GM for any token, a
   * player for their own runner. Answers the look; saving it is the token
   * PATCH, so the player sees it before the table does.
   */
  app.post('/api/tokens/:id/look/describe', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(DescribeLookBody, req.body);
    const svc = new ScenesService(app.db);
    const { token, scene } = await svc.tokenWithScene(id);
    assertCampaign(auth, scene.campaignId);
    if (!(await svc.canControlToken(auth, token))) throw httpError(403, 'forbidden', 'you do not control this token');
    const config = resolveLlmConfig(await campaignSettings(app.db, scene.campaignId));
    let result: Awaited<ReturnType<typeof describeLook>>;
    try {
      result = await describeLook(config, {
        campaignId: scene.campaignId,
        description: body.description,
        name: token.name,
        current: body.current ?? (TokenLookSchema.nullable().safeParse(token.look ?? null).data ?? null),
      });
    } catch (err) {
      const told = sanitizeAiError(err, { forGm: auth.role === 'gm' });
      if (told !== err) req.log.warn({ err }, 'a token look failed for a player; the provider text was kept back');
      throw told;
    }
    await persistTurnUsage(app.db, {
      campaignId: scene.campaignId,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      kind: 'look',
    });
    return reply.send({ look: result.look });
  });

  /** Stop this build's draft; the running request answers `ai_cancelled`. */
  app.delete('/api/builds/:id/propose', async (req, reply) => {
    const { rec } = await draftTarget(req);
    return reply.send({ cancelled: cancelBuildDraft(rec.id) });
  });

  // --- FR12.8: proximity prompts -------------------------------------------
  app.get('/api/fixer/fog-proximity', async (req, reply) => {
    const query = parse(ProximityQuery, req.query);
    const campaignId = gmFor(req, query.campaignId);
    const opts = {
      ...(query.sceneId !== undefined ? { sceneId: query.sceneId } : {}),
      ...(query.radiusM !== undefined ? { radiusM: query.radiusM } : {}),
    };
    const state = await fogProximityState(app.db, campaignId, opts);
    const announced = query.announce
      ? await emitFogProximity(app.db, app.hub, campaignId, opts)
      : [];
    return reply.send({ ...state, announced: announced.length });
  });
}
