/**
 * The Fixer's tool catalog (FR12.17) — the read-only state surface plus the
 * draft-producing actions, typed with Zod and handed to the model as JSON
 * Schema function definitions (FR12.13).
 *
 * Reads are free and always live: they run through the same service layer the
 * app itself uses, so the model sees the engine-derived numbers the table is
 * playing with this pass. Writes never write: `generate_npc`,
 * `draft_wiki_page` and `suggest_fog_reveal` all land in `ai_generations` as
 * drafts for the GM to accept (Principle 8).
 */
import { z } from 'zod';
import { GeneratorService, genOf } from '../services/generator.js';
import { httpError } from '../services/auth.js';
import type { ToolDefinition } from './llm.js';
import { createDraft, spoilerScan } from './drafts.js';
import { CODEX_TOOLS } from './tools-codex.js';
import { RECAP_TOOLS } from './tools-recap.js';
import { TABLE_TOOLS } from './tools-table.js';
import { proposeGeometryFromMap } from './vision.js';
import { Limit, tool, type FixerTool, type ToolContext } from './tool-kit.js';
import {
  getCampaignState,
  getCharacterState,
  getEncounterState,
  getLedgerState,
  getNpcState,
  getSceneState,
  getSessionLogState,
  listCharactersState,
  listNpcsState,
  searchBooksState,
} from './state.js';

export { Limit, tool, type FixerTool, type ToolContext, type ToolDef } from './tool-kit.js';

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/** P1–P3 core: campaign, party, ledger, fight, scene, log, books, NPCs. */
const CORE_TOOLS: readonly FixerTool[] = [
  tool({
    name: 'get_campaign',
    description:
      'Campaign overview: name, in-game date, roster size, and whether a session, encounter or scene is currently live.',
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => getCampaignState(ctx.db, ctx.campaignId),
  }),

  tool({
    name: 'list_characters',
    description:
      'The player characters with live condition monitors, Edge, and current wound modifier. Use this before asking about anyone specific.',
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => ({ characters: await listCharactersState(ctx.db, ctx.campaignId) }),
  }),

  tool({
    name: 'get_character',
    description:
      'One character, fully derived by the rules engine right now: attributes, limits, initiative, movement and every dice pool with its breakdown, wound modifiers already applied.',
    kind: 'read',
    schema: z.object({
      characterId: z.string().describe('Character id from list_characters'),
    }),
    run: async (args, ctx) => getCharacterState(ctx.db, ctx.campaignId, args.characterId),
  }),

  tool({
    name: 'get_ledger',
    description:
      'Karma and nuyen balances plus recent entries, per character — approved totals and what is still pending approval.',
    kind: 'read',
    schema: z.object({
      characterId: z.string().optional().describe('Omit for the whole party'),
      limit: Limit(100, 20),
    }),
    run: async (args, ctx) =>
      getLedgerState(ctx.db, ctx.campaignId, {
        ...(args.characterId !== undefined ? { characterId: args.characterId } : {}),
        limit: args.limit,
      }),
  }),

  tool({
    name: 'get_encounter',
    description:
      'The running fight: turn, initiative pass, whose action is next, and every combatant with current physical/stun boxes and status effects. Omit the id for the live encounter.',
    kind: 'read',
    schema: z.object({
      encounterId: z.string().optional(),
    }),
    run: async (args, ctx) => getEncounterState(ctx.db, ctx.campaignId, args.encounterId),
  }),

  tool({
    name: 'get_scene',
    description:
      'The active scene (or one by id): environment tiers, grid, named fog regions with their revealed state, and every token including hidden ones. GM surface — never quote hidden tokens to players.',
    kind: 'read',
    schema: z.object({
      sceneId: z.string().optional(),
    }),
    run: async (args, ctx) => getSceneState(ctx.db, ctx.campaignId, args.sceneId),
  }),

  tool({
    name: 'get_session_log',
    description:
      'Recent table events (rolls, damage, scene changes, log posts), newest first — what actually happened at the table.',
    kind: 'read',
    schema: z.object({ limit: Limit(100, 30) }),
    run: async (args, ctx) => ({
      events: await getSessionLogState(ctx.db, ctx.campaignId, args.limit),
    }),
  }),

  tool({
    name: 'search_books',
    description:
      "Full-text search over the GM's own rulebook library. Every hit carries the book code and printed page it came from — cite ONLY those refs; never cite a page from memory.",
    kind: 'read',
    schema: z.object({
      query: z.string().min(2).describe('Search terms; quoted phrases and -exclusions work'),
      bookCode: z.string().optional().describe('Limit to one book code, e.g. SR5'),
      limit: Limit(10, 5),
    }),
    run: async (args, ctx) =>
      searchBooksState(ctx.db, args.query, {
        ...(args.bookCode !== undefined ? { bookCode: args.bookCode } : {}),
        limit: args.limit,
      }),
  }),

  tool({
    name: 'list_npcs',
    description: 'NPC/archetype templates in this campaign, with role tags and whether a persona exists.',
    kind: 'read',
    schema: z.object({}),
    run: async (_args, ctx) => ({ npcs: await listNpcsState(ctx.db, ctx.campaignId) }),
  }),

  tool({
    name: 'get_npc',
    description: 'One NPC template: its statblock and its persona sheet (traits, voice, goals, secrets, knowledge).',
    kind: 'read',
    schema: z.object({ npcId: z.string() }),
    run: async (args, ctx) => getNpcState(ctx.db, ctx.campaignId, args.npcId),
  }),

  tool({
    name: 'get_threat_readout',
    description:
      'Rules-heuristic threat estimate for an encounter: pools, defenses, soak, per-exchange damage estimates and action economy, party vs opposition. Estimates, never promises.',
    kind: 'read',
    schema: z.object({ encounterId: z.string().optional() }),
    run: async (args, ctx) => {
      const encounter = await getEncounterState(ctx.db, ctx.campaignId, args.encounterId);
      return new GeneratorService(ctx.db).threatReadout(encounter.id);
    },
  }),

  // -------------------------------------------------------------------------
  // Draft actions — the engine rolls the numbers, the AI writes the fiction,
  // and neither one applies anything without the GM (Principle 8, D13).
  // -------------------------------------------------------------------------

  tool({
    name: 'generate_npc',
    description:
      'Roll a rules-valid NPC from an existing template + tier using the seeded procedural generator, and save it as a DRAFT for the GM to accept. Never invent stats yourself — call this. Optionally attach persona fiction.',
    kind: 'draft',
    schema: z.object({
      templateId: z.string().describe('Template id from list_npcs'),
      tierId: z.string().describe('Tier id defined on that template'),
      seed: z.number().int().optional(),
      persona: z
        .object({
          traits: z.array(z.string()).default([]),
          voice: z.string().optional(),
          goals: z.array(z.string()).default([]),
          secrets: z.array(z.string()).default([]),
          knowledge: z.array(z.string()).default([]),
          backstory: z.string().optional(),
          mannerisms: z.array(z.string()).default([]),
          hooks: z.array(z.string()).default([]),
        })
        .optional()
        .describe('Original fiction only — no book text'),
      note: z.string().optional().describe('Why this NPC, for the GM reading the draft'),
    }),
    run: async (args, ctx) => {
      const service = new GeneratorService(ctx.db);
      const template = await service.getTemplate(args.templateId);
      const { seed, npc } = service.generateFromTemplate(
        template,
        args.tierId,
        args.seed,
      );
      const persona = { ...npc.persona, ...(args.persona ?? {}) };
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'npc',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          name: npc.name,
          statblock: npc.sheet,
          persona,
          gen: genOf(template),
          sourceTemplateId: template.id,
          tierId: npc.tierId,
          seed,
          monitors: npc.monitors,
          flavor: npc.flavor,
          corrections: npc.corrections,
          ...(args.note !== undefined ? { note: args.note } : {}),
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        name: npc.name,
        metatype: npc.metatype,
        professionalRating: npc.professionalRating,
        seed,
        monitors: npc.monitors,
        appliesTo: 'npc_templates',
        note: 'Saved as a draft. The GM must accept it before it exists at the table.',
      };
    },
  }),

  tool({
    name: 'draft_wiki_page',
    description:
      'Save a codex page (location, faction, NPC page, lore summary) as a DRAFT. Original fiction only. Player-facing text is spoiler-checked against GM-only names.',
    kind: 'draft',
    schema: z.object({
      title: z.string().min(1),
      contentMd: z.string().min(1).describe('Markdown body'),
      tags: z.array(z.string()).default([]),
      kind: z.string().default('page').describe('page | location | faction | npc | run'),
      playerFacing: z
        .boolean()
        .default(false)
        .describe('True when the GM intends to reveal this to players — triggers the spoiler guard'),
    }),
    run: async (args, ctx) => {
      const spoilers = args.playerFacing
        ? await spoilerScan(ctx.db, ctx.campaignId, `${args.title}\n${args.contentMd}`)
        : [];
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'wiki_page',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          title: args.title,
          contentMd: args.contentMd,
          tags: args.tags,
          kind: args.kind,
          playerFacing: args.playerFacing,
          spoilerFlags: spoilers,
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        title: args.title,
        spoilerFlags: spoilers,
        appliesTo: 'wiki_pages',
        note:
          spoilers.length > 0
            ? 'Draft saved, but it mentions GM-only material — tell the GM to reveal or cut.'
            : 'Saved as a GM-only draft page.',
      };
    },
  }),

  tool({
    name: 'suggest_fog_reveal',
    description:
      'Propose revealing named fog regions on a scene ("they are at the lab door"). Saves a DRAFT; the GM accepts before anything on the table changes.',
    kind: 'draft',
    schema: z.object({
      sceneId: z.string().optional().describe('Defaults to the active scene'),
      regions: z.array(z.string()).min(1).describe('Region ids or names from get_scene'),
      reason: z.string().default(''),
    }),
    run: async (args, ctx) => {
      const scene = await getSceneState(ctx.db, ctx.campaignId, args.sceneId);
      const wanted = args.regions.map((r) => r.toLowerCase());
      const matched = scene.fog.regions.filter(
        (r) => wanted.includes(r.id.toLowerCase()) || wanted.includes(r.name.toLowerCase()),
      );
      const unknown = args.regions.filter(
        (r) =>
          !scene.fog.regions.some(
            (region) =>
              region.id.toLowerCase() === r.toLowerCase() ||
              region.name.toLowerCase() === r.toLowerCase(),
          ),
      );
      const draft = await createDraft(ctx.db, {
        campaignId: ctx.campaignId,
        kind: 'fog_reveal',
        prompt: ctx.prompt,
        model: ctx.model,
        output: {
          sceneId: scene.id,
          sceneName: scene.name,
          regionIds: matched.map((r) => r.id),
          regionNames: matched.map((r) => r.name),
          reason: args.reason,
          unmatched: unknown,
        },
      });
      return {
        generationId: draft.id,
        status: 'draft',
        sceneId: scene.id,
        willReveal: matched.map((r) => r.name),
        alreadyRevealed: matched.filter((r) => r.revealed).map((r) => r.name),
        unmatched: unknown,
        appliesTo: 'scenes.fog',
      };
    },
  }),
];

/**
 * Map vision (FR12.11, lane 2) — capability-flagged.
 *
 * This is the only tool in the catalog that can be *absent*: DESIGN.md says
 * map vision requires a vision-capable local model and the feature hides
 * otherwise, so `runFixerChat` drops it from the tool list when the probed
 * capability says no (`fixer/vision.ts`). A model that never sees the
 * definition cannot promise the GM something the box cannot do.
 */
export const VISION_TOOL_NAME = 'read_map_image';

const VISION_TOOLS: readonly FixerTool[] = [
  tool({
    name: VISION_TOOL_NAME,
    description:
      "Read the battle map image already attached to a scene and propose its geometry: rooms snapped to the scene's grid, doors, walls and named fog regions, plus what grid the image looks like. Saves a DRAFT for the GM to accept — the same draft kind the layout copilot produces. Use this when the GM has uploaded or photographed a map; use propose_geometry instead when they are describing a place in words.",
    kind: 'draft',
    schema: z.object({
      sceneId: z.string().optional().describe('Defaults to the active scene'),
      attachmentId: z
        .string()
        .optional()
        .describe("Defaults to the scene's first background map image"),
      hint: z
        .string()
        .max(600)
        .optional()
        .describe('What the GM wants read, e.g. "ground floor only, ignore the furniture"'),
      mode: z.enum(['merge', 'replace']).default('merge'),
    }),
    run: async (args, ctx) => {
      if (!ctx.llm) {
        throw httpError(
          503,
          'ai_disabled',
          'reading a map needs the inference box; none is configured for this call',
        );
      }
      return proposeGeometryFromMap(ctx.db, ctx.llm, {
        campaignId: ctx.campaignId,
        prompt: ctx.prompt,
        mode: args.mode,
        ...(args.sceneId !== undefined ? { sceneId: args.sceneId } : {}),
        ...(args.attachmentId !== undefined ? { attachmentId: args.attachmentId } : {}),
        ...(args.hint !== undefined ? { hint: args.hint } : {}),
      });
    },
  }),
];

/**
 * The catalog handed to the model. Core first (the questions asked every
 * session), then the codex/contacts/runs/calendar/magic/matrix reads, then the
 * at-the-table tools, the recap, and last the capability-flagged vision lane.
 */
export const FIXER_TOOLS: readonly FixerTool[] = [
  ...CORE_TOOLS,
  ...CODEX_TOOLS,
  ...TABLE_TOOLS,
  ...RECAP_TOOLS,
  ...VISION_TOOLS,
];

export const TOOLS_BY_NAME: ReadonlyMap<string, FixerTool> = new Map(
  FIXER_TOOLS.map((t) => [t.name, t]),
);

/** Reads cost nothing and change nothing — used by tests and the usage meter. */
export const READ_ONLY_TOOLS: readonly FixerTool[] = FIXER_TOOLS.filter((t) => t.kind === 'read');

// ---------------------------------------------------------------------------
// Zod → JSON Schema for the API
// ---------------------------------------------------------------------------

/** JSON Schema for one tool's arguments (draft 2020-12, `$schema` stripped). */
export function toolParameters(schemaLike: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schemaLike, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  if (json['type'] === 'object') {
    json['properties'] = json['properties'] ?? {};
    json['additionalProperties'] = false;
  }
  return json;
}

/** The tool array sent with every chat request (OpenAI function-calling shape). */
export function toolDefinitions(tools: readonly FixerTool[] = FIXER_TOOLS): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toolParameters(t.schema),
    },
  }));
}

export interface ToolRunResult {
  ok: boolean;
  /** JSON string handed back to the model as the tool message content. */
  content: string;
  result?: unknown;
  error?: string;
}

const MAX_TOOL_RESULT_CHARS = 24_000;

/**
 * Validate and run one tool call. Failures come back as tool messages, not
 * exceptions: a model that passes a bad id should get told and try again
 * rather than killing the GM's turn.
 */
export async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
  registry: ReadonlyMap<string, FixerTool> = TOOLS_BY_NAME,
): Promise<ToolRunResult> {
  const entry = registry.get(name);
  if (!entry) {
    const known = [...registry.keys()].join(', ');
    return fail(`unknown tool "${name}". Available tools: ${known}`);
  }
  let parsedArgs: unknown;
  try {
    parsedArgs = rawArguments.trim().length === 0 ? {} : JSON.parse(rawArguments);
  } catch (err) {
    return fail(`arguments were not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const validated = entry.schema.safeParse(parsedArgs ?? {});
  if (!validated.success) {
    return fail(`invalid arguments: ${JSON.stringify(validated.error.issues).slice(0, 600)}`);
  }
  try {
    const result = await entry.run(validated.data, ctx);
    let content = JSON.stringify(result ?? null);
    if (content.length > MAX_TOOL_RESULT_CHARS) {
      content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
    }
    return { ok: true, content, result };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(error: string): ToolRunResult {
  return { ok: false, error, content: JSON.stringify({ error }) };
}
