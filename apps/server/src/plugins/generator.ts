/**
 * generator domain plugin (M10, FR10.1–10.6) — GM-only prep surface.
 *
 * Routes
 *   GET/POST    /api/campaigns/:campaignId/npc-templates      (FR10.1)
 *   GET/PATCH/DELETE /api/npc-templates/:id                   (FR10.1)
 *   POST        /api/generator/npc                            (FR10.2)
 *   POST        /api/generator/group                          (FR10.2)
 *   POST        /api/generator/promote                        (FR10.3)
 *   POST        /api/encounters/build                         (FR10.4)
 *   GET         /api/encounters/:id/threat                    (FR10.5)
 *   POST        /api/encounters/:id/threat/recompute          (FR10.6)
 *
 * Generator output is PROCEDURAL, not AI: it is returned directly to the GM
 * (never parked in `ai_generations` — Principle 8 covers model output only) and
 * only becomes durable state when the GM promotes it or builds an encounter.
 * Seeds are always returned so "reroll the squad identically" works.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GenTemplateSchema, PersonaSchema, RefSchema, SheetV1Schema } from '@safehouse/contracts';
import { assertCampaign, httpError, requireRole } from '../services/auth.js';
import {
  GeneratorService,
  type BuildPartInput,
  type NpcTemplateRow,
} from '../services/generator.js';

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const Seed = z.number().int().min(0).max(0xffff_ffff);
const Locks = z.array(z.string().min(1)).max(8).default([]);

/** `tierId` is canonical; `tier` is accepted as an alias (DESIGN.md prose). */
const TierRef = { tierId: z.string().min(1).optional(), tier: z.string().min(1).optional() };

const TemplateBody = z.object({
  name: z.string().min(1).max(200),
  statblock: SheetV1Schema.partial().optional(),
  gen: GenTemplateSchema.optional(),
  persona: PersonaSchema.partial().optional(),
  pageRef: RefSchema.nullish(),
});

const TemplatePatchBody = TemplateBody.partial();

const GenerateNpcBody = z.object({
  templateId: z.string().min(1),
  ...TierRef,
  seed: Seed.optional(),
  /** The previous roll's seed — required when `locks` are set (FR10.2). */
  prevSeed: Seed.optional(),
  locks: Locks,
});

const GenerateGroupBody = GenerateNpcBody.extend({
  size: z.number().int().min(1).max(50).default(1),
});

const PromoteBody = z.object({
  kind: z.enum(['npc', 'group']).default('npc'),
  templateId: z.string().min(1),
  ...TierRef,
  /** Required: promotion re-derives exactly the roll the GM is looking at. */
  seed: Seed,
  prevSeed: Seed.optional(),
  locks: Locks,
  size: z.number().int().min(1).max(50).default(1),
  name: z.string().min(1).max(200).optional(),
  /** GM edits round-trip (FR10.3): a hand-tuned sheet wins over the roll. */
  statblock: SheetV1Schema.optional(),
  persona: PersonaSchema.partial().optional(),
});

const PartBody = z.object({
  kind: z.enum(['npc', 'gruntGroup']).optional(),
  templateId: z.string().min(1),
  ...TierRef,
  count: z.number().int().min(1).max(20).optional(),
  size: z.number().int().min(1).max(50).optional(),
  seed: Seed.optional(),
});

const BuildBody = z.object({
  campaignId: z.string().min(1),
  sceneId: z.string().min(1).nullish(),
  name: z.string().min(1).max(200).default('Untitled encounter'),
  parts: z.array(PartBody).min(1).max(24),
});

const RecomputeBody = z.object({ parts: z.array(PartBody).min(1).max(24) });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

function tierOf(body: { tierId?: string | undefined; tier?: string | undefined }): string {
  const tierId = body.tierId ?? body.tier;
  if (!tierId) throw httpError(400, 'bad_request', 'tierId is required (the tier dial, FR10.1)');
  return tierId;
}

function partOf(part: z.output<typeof PartBody>): BuildPartInput {
  const kind = part.kind ?? (part.size !== undefined ? 'gruntGroup' : 'npc');
  return {
    kind,
    templateId: part.templateId,
    tierId: tierOf(part),
    ...(part.count !== undefined ? { count: part.count } : {}),
    ...(part.size !== undefined ? { size: part.size } : {}),
    ...(part.seed !== undefined ? { seed: part.seed } : {}),
  };
}

/** Every route here is prep material: GM only, bound to the row's campaign. */
function gmFor(req: FastifyRequest, campaignId: string): void {
  const auth = requireRole(req, 'gm');
  assertCampaign(auth, campaignId);
}

export default async function generatorPlugin(app: FastifyInstance): Promise<void> {
  const generator = new GeneratorService(app.db);

  const templateFor = async (req: FastifyRequest, id: string): Promise<NpcTemplateRow> => {
    const row = await generator.getTemplate(id);
    gmFor(req, row.campaignId);
    return row;
  };

  // --- npc_templates CRUD (FR10.1) ----------------------------------------

  app.get('/api/campaigns/:campaignId/npc-templates', async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    gmFor(req, campaignId);
    return { templates: await generator.listTemplates(campaignId) };
  });

  app.post('/api/campaigns/:campaignId/npc-templates', async (req, reply) => {
    const { campaignId } = req.params as { campaignId: string };
    gmFor(req, campaignId);
    const body = parse(TemplateBody, req.body);
    const row = await generator.createTemplate({
      campaignId,
      name: body.name,
      statblock: body.statblock ?? {},
      gen: body.gen ?? {},
      persona: body.persona ?? {},
      ...(body.pageRef ? { pageRef: body.pageRef } : {}),
    });
    return reply.status(201).send({ template: row });
  });

  app.get('/api/npc-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { template: await templateFor(req, id) };
  });

  app.patch('/api/npc-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    await templateFor(req, id);
    const body = parse(TemplatePatchBody, req.body);
    return {
      template: await generator.updateTemplate(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.statblock !== undefined ? { statblock: body.statblock } : {}),
        ...(body.gen !== undefined ? { gen: body.gen } : {}),
        ...(body.persona !== undefined ? { persona: body.persona } : {}),
        ...(body.pageRef !== undefined ? { pageRef: body.pageRef ?? null } : {}),
      }),
    };
  });

  app.delete('/api/npc-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await templateFor(req, id);
    await generator.deleteTemplate(id);
    return reply.status(204).send();
  });

  // --- generation (FR10.2): seeded, returned directly, nothing persisted ---

  app.post('/api/generator/npc', async (req) => {
    const body = parse(GenerateNpcBody, req.body);
    const template = await templateFor(req, body.templateId);
    const tierId = tierOf(body);
    const result = generator.generateFromTemplate(
      template,
      tierId,
      body.seed,
      body.locks,
      body.prevSeed,
    );
    // `seed` is the normalized uint32 that reproduces this exact NPC — send it
    // back verbatim to reroll identically (FR10.2).
    return {
      templateId: template.id,
      tierId,
      seed: result.npc.seed,
      ...(result.prevSeed !== undefined ? { prevSeed: result.prevSeed } : {}),
      locks: body.locks,
      npc: result.npc,
    };
  });

  app.post('/api/generator/group', async (req) => {
    const body = parse(GenerateGroupBody, req.body);
    const template = await templateFor(req, body.templateId);
    const { group } = generator.generateGroupFromTemplate(
      template,
      tierOf(body),
      body.size,
      body.seed,
    );
    return {
      templateId: template.id,
      tierId: group.tierId,
      seed: group.seed,
      size: body.size,
      group,
    };
  });

  // --- promote to a reusable template (FR10.3) ----------------------------

  app.post('/api/generator/promote', async (req, reply) => {
    const body = parse(PromoteBody, req.body);
    const source = await templateFor(req, body.templateId);
    const tierId = tierOf(body);

    let name: string;
    let statblock: unknown;
    let persona: unknown;
    if (body.kind === 'group') {
      const { group } = generator.generateGroupFromTemplate(source, tierId, body.size, body.seed);
      name = body.name ?? `${source.name} (${tierId})`;
      statblock = body.statblock ?? group.statblock;
      persona = body.persona ?? source.persona ?? {};
    } else {
      const { npc } = generator.generateFromTemplate(
        source,
        tierId,
        body.seed,
        body.locks,
        body.prevSeed,
      );
      name = body.name ?? npc.name;
      statblock = body.statblock ?? npc.sheet;
      persona = body.persona ?? npc.persona;
    }

    // The promoted template keeps the source's gen params so it can be rolled
    // again (edits round-trip, FR10.3) — statblock is the concrete result.
    const row = await generator.createTemplate({
      campaignId: source.campaignId,
      name,
      statblock,
      gen: source.gen,
      persona,
    });
    return reply.status(201).send({
      template: row,
      promotedFrom: { templateId: source.id, tierId, seed: body.seed, kind: body.kind },
    });
  });

  // --- encounter builder (FR10.4) -----------------------------------------

  app.post('/api/encounters/build', async (req, reply) => {
    const body = parse(BuildBody, req.body);
    gmFor(req, body.campaignId);
    const result = await generator.buildEncounter({
      campaignId: body.campaignId,
      sceneId: body.sceneId ?? null,
      name: body.name,
      parts: body.parts.map(partOf),
    });

    // Coordination with the encounters/scene agents is via db rows; the hub
    // event just tells GM clients to refetch. Opposition is GM-visible and the
    // staged tokens are hidden, so both events stay gm-scoped (Principle 4).
    await app.hub.emit(body.campaignId, {
      type: 'encounter.updated',
      payload: {
        encounterId: result.encounter.id,
        encounter: result.encounter,
        combatants: result.combatants,
        reason: 'generator.build',
      },
      visibility: 'gm',
    });
    for (const token of result.tokens) {
      await app.hub.emit(body.campaignId, {
        type: 'token.added',
        payload: { token, staged: true },
        visibility: 'gm',
      });
    }
    return reply.status(201).send(result);
  });

  // --- threat readout (FR10.5) + lever recompute (FR10.6) -----------------

  app.get('/api/encounters/:id/threat', async (req) => {
    const { id } = req.params as { id: string };
    const encounter = await generator.getEncounter(id);
    gmFor(req, encounter.campaignId);
    return generator.threatReadout(id);
  });

  app.post('/api/encounters/:id/threat/recompute', async (req) => {
    const { id } = req.params as { id: string };
    const encounter = await generator.getEncounter(id);
    gmFor(req, encounter.campaignId);
    const body = parse(RecomputeBody, req.body);
    return generator.threatRecompute(id, body.parts.map(partOf));
  });
}
