/**
 * generator domain plugin (M10, FR10.1–10.6) — GM-only prep surface.
 *
 * Routes
 *   GET/POST    /api/campaigns/:campaignId/npc-templates      (FR10.1)
 *   GET/PATCH/DELETE /api/npc-templates/:id                   (FR10.1)
 *   GET         /api/campaigns/:campaignId/archetype-library  (FR10.1 cold start)
 *   POST        /api/campaigns/:campaignId/archetype-library/install
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
  archetypeLibrary,
  installStarterArchetypes,
  preserveStarterId,
  unknownStarterIds,
} from '../services/archetypes.js';
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
  /**
   * GM override of the rolled Professional Rating (the FR10.6 lever).
   *
   * PR is a morale and Edge-spend dial (FR10.9), not readout math — a GM who
   * decides these particular guards are conscripts rather than corp security
   * is describing how they behave when the first one drops, and the number has
   * to survive the build or the lever does nothing.
   */
  professionalRating: z.number().int().min(0).max(6).optional(),
});

const BuildBody = z.object({
  campaignId: z.string().min(1),
  sceneId: z.string().min(1).nullish(),
  name: z.string().min(1).max(200).default('Untitled encounter'),
  parts: z.array(PartBody).min(1).max(24),
});

const RecomputeBody = z.object({ parts: z.array(PartBody).min(1).max(24) });

/** Install the whole starter catalogue, or just the entries the GM ticked. */
const InstallArchetypesBody = z.object({
  ids: z.array(z.string().min(1)).max(64).optional(),
});

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
    ...(part.professionalRating !== undefined
      ? { professionalRating: part.professionalRating }
      : {}),
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
    const existing = await templateFor(req, id);
    const body = parse(TemplatePatchBody, req.body);
    return {
      template: await generator.updateTemplate(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.statblock !== undefined ? { statblock: body.statblock } : {}),
        // `GenTemplateSchema` strips unknown keys, so a plain assignment would
        // erase `gen.starterId` — the mark that says this row came from the
        // starter library. Retuning a tier curve must not make the library
        // offer the archetype again as if it had never been installed.
        ...(body.gen !== undefined ? { gen: preserveStarterId(existing.gen, body.gen) } : {}),
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

  // --- starter archetype library (FR10.1 cold start) -----------------------
  //
  // The catalogue is shipped ORIGINAL content (§14/D10 forbids transcribing
  // book stat blocks, not shipping our own), and installing it writes ordinary
  // `npc_templates` rows: editable, retierable, renamable, deletable. Nothing
  // here emits — opposition prep is GM-only and the table hears nothing (§13).
  //
  // A campaign is also born with the catalogue installed (see
  // `AuthService.createCampaign`), so these two routes are the recovery path
  // rather than the only door: they are what a GM uses after deleting rows, or
  // to pull in archetypes added to a later build.
  //
  // The web shelf that consumes these is
  // `apps/web/src/features/gm/generator/StarterLibrary.tsx`, reachable at
  // `/c/:campaignId/gm/generator?tab=library`. It reads `installed`,
  // `templateId` and `installedAs` off each entry, so a GM who renamed their
  // copy is still told they own it, and POSTs `{ ids }` for the rest.
  // Installing twice is safe, so the button needs no guard.

  app.get('/api/campaigns/:campaignId/archetype-library', async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    gmFor(req, campaignId);
    const entries = await archetypeLibrary(app.db, campaignId);
    return {
      entries,
      installedCount: entries.filter((e) => e.installed).length,
      availableCount: entries.filter((e) => !e.installed).length,
    };
  });

  app.post('/api/campaigns/:campaignId/archetype-library/install', async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    gmFor(req, campaignId);
    const body = parse(InstallArchetypesBody, req.body ?? {});
    if (body.ids) {
      const unknown = unknownStarterIds(body.ids);
      if (unknown.length > 0) {
        throw httpError(400, 'bad_request', `unknown archetype ids: ${unknown.join(', ')}`, {
          unknown,
        });
      }
    }

    // One transaction over read-then-insert. The idempotency check is a read
    // of this campaign's templates followed by an insert of what is missing,
    // and a doubled click (or a retry on a slow first response) is exactly the
    // interleaving that would install the catalogue twice. `atomic` emits
    // nothing here — it is used purely for the transaction, so every read
    // inside goes through `tx.db` (the deadlock rule in `Hub.atomic`).
    const result = await app.hub.atomic(campaignId, async (tx) =>
      installStarterArchetypes(tx.db, campaignId, {
        ...(body.ids ? { ids: body.ids } : {}),
      }),
    );

    // 200, not 201: this is a converge-to-installed operation whose second
    // call legitimately creates nothing. `installed` says what actually landed.
    return {
      installed: result.installed,
      alreadyInstalled: result.alreadyInstalled,
      entries: result.entries,
    };
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
    const parts = body.parts.map(partOf);

    // One transaction over the build AND its two announcements. A build is the
    // widest write in this file — an encounter row, N combatants, N staged
    // tokens — so a half-commit leaves the GM a fight that exists in the
    // database, is drawn on nobody's screen, and is silently built again.
    //
    // The service is re-pointed at the transaction handle rather than threaded
    // with a `tx` parameter: `GeneratorService` holds nothing but its `Db`, and
    // every read it makes inside the block (templates, the scene check) must go
    // through that handle or wait forever on PGlite's single connection — the
    // deadlock rule in `Hub.atomic`'s docblock.
    const result = await app.hub.atomic(body.campaignId, async (tx) => {
      const built = await new GeneratorService(tx.db).buildEncounter({
        campaignId: body.campaignId,
        sceneId: body.sceneId ?? null,
        name: body.name,
        parts,
      });

      // Coordination with the encounters/scene agents is via db rows; the hub
      // event just tells GM clients to refetch. Opposition is GM-visible and the
      // staged tokens are hidden, so both events stay gm-scoped (Principle 4).
      await tx.emit({
        type: 'encounter.updated',
        payload: {
          encounterId: built.encounter.id,
          encounter: built.encounter,
          combatants: built.combatants,
          reason: 'generator.build',
        },
        visibility: 'gm',
      });
      for (const token of built.tokens) {
        await tx.emit({
          type: 'token.added',
          payload: { token, staged: true },
          visibility: 'gm',
        });
      }
      return built;
    });
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
