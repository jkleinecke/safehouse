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
 * Everything is GM-only (§13). The two write-shaped routes produce
 * `ai_generations` drafts exactly like the tool path — nothing they return has
 * touched a token or a scene.
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
import { assertCampaign, httpError, requireRole } from '../services/auth.js';
import { floorPlanJsonSchema, proposeFloor } from './floor-plan.js';
import { layoutJsonSchema, LayoutDoorSchema, LayoutRoomSchema } from './geometry.js';
import { resolveLlmConfig } from './providers.js';
import { persistTurnUsage } from './usage.js';
import { emitFogProximity, fogProximityState } from './proximity.js';
import { identifyTokensState } from './token-id.js';
import { FIXER_TOOLS, TOOLS_BY_NAME, toolParameters } from './tools.js';
import type { ToolContext } from './tool-kit.js';
import { mapVisionJsonSchema, proposeGeometryFromMap } from './vision.js';

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
    const result = await tool.run(
      {
        ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
      ctxFor(campaignId, 'GM asked the app to identify the tokens on this scene'),
    );
    return reply.send(result);
  });

  // --- FR12.11: layout copilot ---------------------------------------------
  app.post('/api/fixer/propose-geometry', async (req, reply) => {
    const body = parse(GeometryBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const tool = TOOLS_BY_NAME.get('propose_geometry')!;
    const result = await tool.run(
      {
        title: body.title,
        rooms: body.rooms,
        doors: body.doors,
        notes: body.notes,
        mode: body.mode,
        ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
      },
      ctxFor(campaignId, `GM asked for a layout: ${body.title}`),
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
    const result = await proposeGeometryFromMap(app.db, config, {
      campaignId,
      mode: body.mode,
      prompt: 'GM asked the Fixer to read the scene map image',
      ...(body.sceneId !== undefined ? { sceneId: body.sceneId } : {}),
      ...(body.attachmentId !== undefined ? { attachmentId: body.attachmentId } : {}),
      ...(body.hint !== undefined ? { hint: body.hint } : {}),
      ...(body.slot !== undefined ? { slot: body.slot } : {}),
    });
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
    const result = await proposeFloor(app.db, config, {
      campaignId,
      sceneId: body.sceneId,
      level: body.level,
      tilesetId: body.tilesetId,
      prompt: body.prompt,
      ...(body.slot !== undefined ? { slot: body.slot } : {}),
    });
    await persistTurnUsage(app.db, {
      campaignId,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      kind: 'draft',
    });
    return reply.status(201).send(result);
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
