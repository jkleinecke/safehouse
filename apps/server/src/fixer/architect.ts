/**
 * The Architect: rough out a whole stretch of a campaign at once — the lore,
 * the people, the places — from one brief.
 *
 * Two asks, both under the GM's hand. `outlineArchitect` turns a brief into a
 * plan: codex pages, NPCs (each with a persona), scenes (each with its floor
 * described in words). Nothing is written by it. `buildArchitect` takes the
 * items the GM ticked and makes each one through the lane that already
 * exists for it — a codex page draft (the `draft_wiki_page` shape), an NPC
 * draft rolled off an archetype (the `generate_npc` shape), a staged scene
 * with a floor laid out by the floor builder (`floor-plan.ts`) — one at a
 * time, renaming the run as it goes (`activity.ts`), stopping the moment the
 * GM cancels, and reporting what landed. Pages and NPCs arrive as drafts for
 * the inbox (Principle 8); a scene is staged, never active, and deletable in
 * one click from the Scenes screen.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { campaigns, type Db } from '@safehouse/db';
import type { Persona } from '@safehouse/contracts';
import { tilesetById, TILESETS } from '@safehouse/rules';
import { httpError } from '../services/auth.js';
import { GeneratorService, genOf } from '../services/generator.js';
import { ScenesService } from '../services/scenes.js';
import { updateRun, type ActivityHub, type AiRun } from './activity.js';
import { createDraft } from './drafts.js';
import { proposeFloor } from './floor-plan.js';
import { LlmClient, type LlmConfig, type LlmUsage, type ModelSlot } from './llm.js';
import { usageMeter } from './usage.js';
import { parseModelJson } from './vision.js';

const ARCHITECT_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// The outline
// ---------------------------------------------------------------------------

export const OutlinePersonaSchema = z.object({
  traits: z.array(z.string().max(80)).max(8).default([]),
  voice: z.string().max(200).optional(),
  goals: z.array(z.string().max(160)).max(6).default([]),
  secrets: z.array(z.string().max(200)).max(6).default([]),
  knowledge: z.array(z.string().max(200)).max(8).default([]),
  backstory: z.string().max(1200).optional(),
  mannerisms: z.array(z.string().max(120)).max(6).default([]),
  hooks: z.array(z.string().max(200)).max(6).default([]),
});

export const OutlineLoreSchema = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(['page', 'location', 'faction', 'npc', 'run']).default('page'),
  summary: z.string().min(1).max(600).describe('Two or three sentences the page will be written from'),
});

export const OutlineNpcSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(120).describe('What they are to the story: fixer, dock foreman, corp security lieutenant'),
  archetype: z.string().max(80).optional().describe('The name of one of the campaign archetypes listed, if one fits'),
  persona: OutlinePersonaSchema.prefault({}),
});

export const OutlineSceneSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().min(1).max(400).describe('What happens here, in a sentence or two'),
  floor: z.string().min(1).max(1200).describe('The floor, described for the floor builder: rooms, doors, what is in them'),
  cols: z.number().int().min(10).max(80).default(30),
  rows: z.number().int().min(10).max(60).default(20),
  tileset: z.string().max(40).optional().describe('One of the tileset ids listed, if one fits'),
});

export const ArchitectOutlineSchema = z.object({
  title: z.string().min(1).max(120),
  premise: z.string().min(1).max(1500),
  lore: z.array(OutlineLoreSchema).max(12).default([]),
  npcs: z.array(OutlineNpcSchema).max(12).default([]),
  scenes: z.array(OutlineSceneSchema).max(8).default([]),
});
export type ArchitectOutline = z.infer<typeof ArchitectOutlineSchema>;
export type ArchitectOutlineInput = z.input<typeof ArchitectOutlineSchema>;

export function outlineJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(ArchitectOutlineSchema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

const OUTLINE_SYSTEM = [
  'You are the campaign architect for a Shadowrun 5th Edition game master: from a brief, you rough out the lore, the people and the places of a stretch of play.',
  'Answer with JSON only, matching the schema you are given. No prose, no markdown fence.',
  '',
  'Rules:',
  '1. Everything is original fiction. Do not reproduce published text, published characters or published plots.',
  '2. Lore is a list of codex pages the GM will keep: locations, factions, people, a run outline. Each gets a title and a summary the page will be written from later.',
  '3. NPCs are the people the runners will meet or fight. Give each a role and a persona: traits, a voice, goals, secrets they keep, what they know. Name one of the campaign archetypes listed when one fits the role.',
  '4. Scenes are places the table will fight or sneak through, each with the floor described for a floor builder: which rooms, roughly how big, where the doors are, what is in them. Keep the grid to what fits on a table.',
  '5. Fewer, stronger items beat many thin ones. Six pages, four NPCs and three scenes is a full evening of prep.',
].join('\n');

function outlineUserPrompt(campaignName: string, archetypes: readonly string[], brief: string): string {
  return [
    `Campaign: "${campaignName}".`,
    archetypes.length > 0
      ? `Archetypes on file (for "archetype"): ${archetypes.join(', ')}.`
      : 'No archetypes on file yet — leave "archetype" out.',
    `Tilesets (for "tileset"): ${TILESETS.map((t) => `${t.id} (${t.name})`).join(', ')}.`,
    '',
    `The GM's brief: ${brief.trim()}`,
    '',
    `Return the outline as JSON matching this schema:\n${JSON.stringify(outlineJsonSchema())}`,
  ].join('\n');
}

export interface OutlineAsk {
  campaignId: string;
  brief: string;
  slot?: ModelSlot | undefined;
  signal?: AbortSignal | undefined;
}

export interface OutlineResult {
  outline: ArchitectOutline;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

const AI_OFF = "the Fixer is switched off: choose an AI under the console's AI screen";

async function campaignName(db: Db, campaignId: string): Promise<string> {
  const row = (await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  return row?.name ?? 'the campaign';
}

export async function outlineArchitect(db: Db, config: LlmConfig | null, ask: OutlineAsk): Promise<OutlineResult> {
  if (!config) throw httpError(503, 'ai_disabled', AI_OFF);
  const name = await campaignName(db, ask.campaignId);
  const archetypes = (await new GeneratorService(db).listTemplates(ask.campaignId)).map((t) => t.name);
  const client = new LlmClient(config);
  const model = ask.slot === 'fast' ? config.fast : config.primary;
  const turn = await client.chat(
    {
      model,
      messages: [
        { role: 'system', content: OUTLINE_SYSTEM },
        { role: 'user', content: outlineUserPrompt(name, archetypes, ask.brief) },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    },
    { timeoutMs: ARCHITECT_TIMEOUT_MS, ...(ask.signal ? { signal: ask.signal } : {}) },
  );
  if (turn.finishReason === 'length' && !/\}\s*$/.test(turn.content.trim())) {
    throw httpError(
      502,
      'ai_error',
      'the model hit its token limit before it finished the outline — set Thinking to Off under AI, or ask for less',
      { preview: turn.content.trim().slice(-240), finishReason: turn.finishReason },
    );
  }
  const parsed = parseModelJson(turn.content, 'the campaign outline');
  const checked = ArchitectOutlineSchema.safeParse(parsed);
  if (!checked.success) {
    throw httpError(502, 'ai_error', 'the model returned an outline the schema rejects', checked.error.issues.slice(0, 8));
  }
  usageMeter.record(ask.campaignId, { model: turn.model, usage: turn.usage, latencyMs: turn.latencyMs });
  return { outline: checked.data, model: turn.model, usage: turn.usage, latencyMs: turn.latencyMs };
}

// ---------------------------------------------------------------------------
// The build: one item at a time, through the lane that already exists
// ---------------------------------------------------------------------------

export const BuildSelectionSchema = z.object({
  lore: z.array(z.number().int().min(0)).max(12).default([]),
  npcs: z.array(z.number().int().min(0)).max(12).default([]),
  scenes: z.array(z.number().int().min(0)).max(8).default([]),
});
export type BuildSelection = z.infer<typeof BuildSelectionSchema>;

export interface BuildItemResult {
  type: 'lore' | 'npc' | 'scene';
  index: number;
  name: string;
  ok: boolean;
  /** A draft id (lore, npc) or a scene id. */
  id?: string;
  /** Where the GM finds it. */
  landed?: 'drafts' | 'scenes';
  note?: string;
}

export interface BuildResult {
  results: BuildItemResult[];
  /** True when the GM stopped it: `results` holds what landed before that. */
  cancelled: boolean;
  usage: LlmUsage;
  latencyMs: number;
}

/** A transaction with an event channel — `Hub.atomic`'s shape, no more. */
export type AtomicFn = <T>(
  campaignId: string,
  body: (tx: { readonly db: Db; emit(input: { type: string; payload: unknown }): Promise<unknown> }) => Promise<T>,
) => Promise<T>;

export interface BuildAsk {
  campaignId: string;
  outline: ArchitectOutline;
  select: BuildSelection;
  slot?: ModelSlot | undefined;
  signal?: AbortSignal | undefined;
  /** For the activity bar's per-item label. */
  hub?: ActivityHub | undefined;
  run?: AiRun | undefined;
  /** Scene writes go through the hub so the table hears `scene.updated`. */
  atomic?: AtomicFn | undefined;
}

const PAGE_SYSTEM = [
  'You write codex pages for a Shadowrun 5th Edition game master: original fiction, GM-facing, in Markdown.',
  'Write the page only — no preamble, no fence. Headings, short paragraphs, a bullet list where a list reads better. 250 to 600 words.',
  'Do not reproduce published text, characters or plots.',
].join('\n');

function pagePrompt(outline: ArchitectOutline, item: ArchitectOutline['lore'][number]): string {
  return [
    `Campaign premise: ${outline.premise}`,
    `Write the codex page "${item.title}" (${item.kind}).`,
    `It should cover: ${item.summary}`,
    outline.npcs.length > 0 ? `People in this stretch of play: ${outline.npcs.map((n) => `${n.name} (${n.role})`).join('; ')}.` : '',
    outline.scenes.length > 0 ? `Places: ${outline.scenes.map((s) => s.name).join('; ')}.` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/** The archetype an NPC rolls from: the hinted name, else one that sounds like the role, else the first. */
export function pickArchetype<T extends { name: string }>(
  templates: readonly T[],
  hint: string | undefined,
  role: string,
): T | null {
  if (templates.length === 0) return null;
  const want = (hint ?? '').trim().toLowerCase();
  if (want) {
    const exact = templates.find((t) => t.name.toLowerCase() === want);
    if (exact) return exact;
    const partial = templates.find((t) => t.name.toLowerCase().includes(want) || want.includes(t.name.toLowerCase()));
    if (partial) return partial;
  }
  const words = role
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  const byRole = templates.find((t) => words.some((w) => t.name.toLowerCase().includes(w)));
  return byRole ?? templates[0] ?? null;
}

/** The outline's persona over the template's: only what the outline actually said. */
export function mergePersona(base: Partial<Persona>, over: z.infer<typeof OutlinePersonaSchema>): Persona {
  const out: Persona = {
    traits: base.traits ?? [],
    goals: base.goals ?? [],
    secrets: base.secrets ?? [],
    knowledge: base.knowledge ?? [],
    mannerisms: base.mannerisms ?? [],
    hooks: base.hooks ?? [],
    ...(base.voice !== undefined ? { voice: base.voice } : {}),
    ...(base.backstory !== undefined ? { backstory: base.backstory } : {}),
  };
  for (const key of ['traits', 'goals', 'secrets', 'knowledge', 'mannerisms', 'hooks'] as const) {
    if (over[key].length > 0) out[key] = over[key];
  }
  if (over.voice) out.voice = over.voice;
  if (over.backstory) out.backstory = over.backstory;
  return out;
}

type Job = { type: 'lore' | 'npc' | 'scene'; index: number };

export async function buildArchitect(db: Db, config: LlmConfig | null, ask: BuildAsk): Promise<BuildResult> {
  if (!config) throw httpError(503, 'ai_disabled', AI_OFF);
  const client = new LlmClient(config);
  const model = ask.slot === 'fast' ? config.fast : config.primary;
  const totals: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let latencyMs = 0;
  const results: BuildItemResult[] = [];
  const outline = ask.outline;
  const jobs: Job[] = [
    ...ask.select.lore.filter((i) => outline.lore[i]).map((index) => ({ type: 'lore' as const, index })),
    ...ask.select.npcs.filter((i) => outline.npcs[i]).map((index) => ({ type: 'npc' as const, index })),
    ...ask.select.scenes.filter((i) => outline.scenes[i]).map((index) => ({ type: 'scene' as const, index })),
  ];
  const say = (label: string) => {
    if (ask.run) updateRun(ask.hub, ask.run, label);
  };
  const cancelled = () => ask.signal?.aborted === true;
  const chatOpts = { timeoutMs: ARCHITECT_TIMEOUT_MS, ...(ask.signal ? { signal: ask.signal } : {}) };
  const tally = (usage: LlmUsage, ms: number) => {
    totals.promptTokens += usage.promptTokens;
    totals.completionTokens += usage.completionTokens;
    totals.totalTokens += usage.totalTokens;
    latencyMs += ms;
  };
  // Without a hub (tests, scripts) the writes still land — nobody is told.
  const atomic: AtomicFn = ask.atomic ?? ((_campaignId, body) => body({ db, emit: async () => undefined }));
  const generator = new GeneratorService(db);
  const templates = await generator.listTemplates(ask.campaignId);
  const nameOf = (job: Job): string =>
    job.type === 'lore'
      ? outline.lore[job.index]!.title
      : job.type === 'npc'
        ? outline.npcs[job.index]!.name
        : outline.scenes[job.index]!.name;

  for (const [n, job] of jobs.entries()) {
    if (cancelled()) break;
    const position = `${n + 1} of ${jobs.length}`;
    try {
      if (job.type === 'lore') {
        const item = outline.lore[job.index]!;
        say(`writing “${item.title}” (${position})`);
        const turn = await client.chat(
          {
            model,
            messages: [
              { role: 'system', content: PAGE_SYSTEM },
              { role: 'user', content: pagePrompt(outline, item) },
            ],
            temperature: 0.8,
            max_tokens: 4000,
          },
          chatOpts,
        );
        tally(turn.usage, turn.latencyMs);
        usageMeter.record(ask.campaignId, { model: turn.model, usage: turn.usage, latencyMs: turn.latencyMs });
        const contentMd = turn.content.trim();
        if (contentMd.length === 0) throw new Error('the model wrote nothing');
        const draft = await createDraft(db, {
          campaignId: ask.campaignId,
          kind: 'wiki_page',
          prompt: `Architect: ${outline.title} — ${item.title}`,
          model: turn.model,
          output: { title: item.title, contentMd, tags: ['architect'], kind: item.kind, playerFacing: false, spoilerFlags: [] },
          usage: turn.usage,
        });
        results.push({ type: 'lore', index: job.index, name: item.title, ok: true, id: draft.id, landed: 'drafts' });
      } else if (job.type === 'npc') {
        const item = outline.npcs[job.index]!;
        say(`rolling ${item.name} (${position})`);
        const template = pickArchetype(templates, item.archetype, item.role);
        if (!template) {
          results.push({
            type: 'npc',
            index: job.index,
            name: item.name,
            ok: false,
            note: 'no archetypes on file — install one from the Generator, then build the NPCs again',
          });
          continue;
        }
        const gen = genOf(template);
        // The middle tier when there is one: a named NPC is rarely the mook.
        const tierId = gen.tiers[Math.min(1, gen.tiers.length - 1)]!.id;
        const { seed, npc } = generator.generateFromTemplate(template, tierId, undefined);
        const draft = await createDraft(db, {
          campaignId: ask.campaignId,
          kind: 'npc',
          prompt: `Architect: ${outline.title} — ${item.name}, ${item.role}`,
          model,
          output: {
            name: item.name,
            statblock: npc.sheet,
            persona: mergePersona(npc.persona, item.persona),
            gen,
            sourceTemplateId: template.id,
            tierId: npc.tierId,
            seed,
            monitors: npc.monitors,
            flavor: npc.flavor,
            corrections: npc.corrections,
            note: `${item.role} — rolled from “${template.name}” by the Architect`,
          },
        });
        results.push({
          type: 'npc',
          index: job.index,
          name: item.name,
          ok: true,
          id: draft.id,
          landed: 'drafts',
          note: `rolled from ${template.name}`,
        });
      } else {
        const item = outline.scenes[job.index]!;
        say(`laying out ${item.name} (${position})`);
        const set = (item.tileset ? tilesetById(item.tileset) : null) ?? TILESETS[0]!;
        // Staged first, so a floor that fails still leaves a scene the GM can
        // paint by hand — or delete in one click.
        const created = await atomic(ask.campaignId, async (tx) => {
          const scene = await new ScenesService(tx.db).createScene(ask.campaignId, {
            name: item.name,
            grid: { cols: item.cols, rows: item.rows, unitM: 1, offset: { x: 0, y: 0 } },
            notes: `${item.purpose}\n\n(Architect: ${outline.title})`,
          });
          await tx.emit({ type: 'scene.updated', payload: { sceneId: scene.id, changed: ['created'] } });
          return scene;
        });
        let floor;
        try {
          floor = await proposeFloor(db, config, {
            campaignId: ask.campaignId,
            sceneId: created.id,
            level: 0,
            tilesetId: set.id,
            prompt: `${item.purpose}\n${item.floor}`,
            ...(ask.slot !== undefined ? { slot: ask.slot } : {}),
            ...(ask.signal ? { signal: ask.signal } : {}),
          });
        } catch (err) {
          if (cancelled()) throw err;
          results.push({
            type: 'scene',
            index: job.index,
            name: item.name,
            ok: false,
            id: created.id,
            landed: 'scenes',
            note: `staged empty — the floor failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
        tally(floor.usage, floor.latencyMs);
        await atomic(ask.campaignId, async (tx) => {
          const svc = new ScenesService(tx.db);
          const fresh = await svc.sceneRow(created.id);
          await svc.updateScene(fresh, { tiles: { tilesetId: set.id, ...floor.plan.layers, cells: {} } });
          await tx.emit({ type: 'scene.updated', payload: { sceneId: created.id, changed: ['tiles'] } });
        });
        const c = floor.plan.counts;
        const rooms = floor.plan.rooms.length;
        const warn = floor.plan.warnings.length;
        results.push({
          type: 'scene',
          index: job.index,
          name: item.name,
          ok: true,
          id: created.id,
          landed: 'scenes',
          note: `${rooms} room${rooms === 1 ? '' : 's'}, ${c.floor} floor squares, ${c.door} door${c.door === 1 ? '' : 's'}${
            warn > 0 ? `, ${warn} warning${warn === 1 ? '' : 's'}` : ''
          } — staged in ${set.name}`,
        });
      }
    } catch (err) {
      if (cancelled()) break;
      results.push({ type: job.type, index: job.index, name: nameOf(job), ok: false, note: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, cancelled: cancelled(), usage: totals, latencyMs };
}
