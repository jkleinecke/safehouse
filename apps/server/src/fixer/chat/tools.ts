/**
 * The Fixer chat's tools, as AI SDK tools.
 *
 * The FR12.17 catalog is unchanged — every tool keeps its zod schema and its
 * `run` — and is wrapped here so the SDK's loop can call it. Two things the
 * hand-rolled loop did are kept: a tool that throws answers with its error
 * instead of killing the turn (a model that passes a bad id should be told
 * and try again), and a result over 24k characters is cut rather than sent
 * whole.
 *
 * Three tools are new, and exist because the chat is now the one place the
 * GM asks for things:
 *
 * - `draft_floor` does what the dock's "draft a floor" tab did. The plan it
 *   returns carries every painted square, which the chat's plan card needs
 *   for its Build button and the model does not: `toModelOutput` hands the
 *   model a one-line summary instead.
 * - `recall_conversation` reads the whole transcript back, folded turns
 *   included — the other half of keeping only a brief in context.
 * - `read_attachment` searches a text file too long to carry every turn.
 * - `ask_gm` puts a question to the GM, with the answers the Fixer would
 *   suggest. It has no `execute`: the turn stops at the question, the panel
 *   draws it, and the GM's answer — a suggestion, or anything they type —
 *   comes back as the tool's result and the turn carries on (turn.ts).
 */
import { tool, type ToolSet, type UIMessage } from 'ai';
import { z } from 'zod';
import { levelTiles } from '@safehouse/rules';
import { ScenesService, serializeScene } from '../../services/scenes.js';
import { proposeFloor, type CompiledFloor } from '../floor-plan.js';
import type { FixerTool, ToolContext } from '../tools.js';
import type { AiContext } from '../context.js';
import { searchText } from './attachments.js';
import { messageText, type ConversationMemory } from './memory.js';

const MAX_TOOL_RESULT_CHARS = 24_000;

/** Retries a failed tool gets in one turn before the Fixer stops and says so. */
export const TOOL_RETRIES = 3;

/**
 * How a turn's tool calls have been going, tool by tool — the retry policy.
 *
 * A failed call goes back to the model with its error AND with what to do
 * about it: which attempt this was, how many are left, and the instruction to
 * fix the cause rather than repeat the call — correct the arguments, look an
 * id up with a read tool first. The turn's loop then makes the model call a
 * tool again (turn.ts, `prepareStep`) instead of letting it apologise and
 * stop. After the last retry the tool refuses further calls for the turn and
 * tells the model to stop and tell the GM what failed: a tool failing the
 * same way four times is not going to be argued into working a fifth.
 *
 * A success clears the count, so a tool that recovers is a tool in good
 * standing again.
 */
export class RetryLedger {
  private readonly failures = new Map<string, number>();

  failed(tool: string): number {
    const n = (this.failures.get(tool) ?? 0) + 1;
    this.failures.set(tool, n);
    return n;
  }

  succeeded(tool: string): void {
    this.failures.delete(tool);
  }

  exhausted(tool: string): boolean {
    return (this.failures.get(tool) ?? 0) > TOOL_RETRIES;
  }

  /** Any tool still owed a retry — the loop's cue to make the model try again. */
  pending(): boolean {
    for (const n of this.failures.values()) if (n <= TOOL_RETRIES) return true;
    return false;
  }
}

/** A failure, as the model reads it: the error, the attempt, and what to do next. */
function withGuidance<T extends { error: string }>(tool: string, ledger: RetryLedger, failure: T) {
  const attempt = ledger.failed(tool);
  if (attempt > TOOL_RETRIES) {
    return {
      ...failure,
      attempt,
      retriesLeft: 0,
      guidance: `${tool} has failed ${attempt} times this turn. Do not call it again. Stop, and tell the GM plainly what you were trying to do, what failed, and what they could change.`,
    };
  }
  return {
    ...failure,
    attempt,
    retriesLeft: TOOL_RETRIES - attempt + 1,
    guidance: `${tool} failed (retry ${attempt} of ${TOOL_RETRIES}). Read the error and fix its cause before calling it again — correct the arguments, or look the right id up with a read tool first. Do not repeat the same call unchanged.`,
  };
}

/** Refused outright: the tool already used every retry this turn. */
function refused(tool: string) {
  return {
    error: `${tool} already failed ${TOOL_RETRIES + 1} times this turn and will not be run again.`,
    retriesLeft: 0,
    guidance: 'Stop calling it. Tell the GM what failed and what they could change.',
  };
}

/** Every set a scene can be drawn in has an id; this is the one a blank scene starts in. */
const FALLBACK_TILESET = 'docklands';

export interface ChatToolDeps {
  ctx: ToolContext;
  /** Where the GM is looking — the scene and floor "this floor" means. */
  where: AiContext | undefined;
  /** The whole transcript, folded turns included, for recall. */
  transcript: readonly UIMessage[];
  memory: ConversationMemory;
  /** This turn's tool failures, shared by every tool and read by the loop. */
  ledger: RetryLedger;
}

/** One catalog tool, runnable by the SDK — under the retry policy. */
function wrap(t: FixerTool, ctx: ToolContext, ledger: RetryLedger) {
  return tool({
    description: t.description,
    inputSchema: t.schema as z.ZodType<Record<string, unknown>>,
    execute: async (input: unknown) => {
      if (ledger.exhausted(t.name)) return refused(t.name);
      try {
        const result = await t.run(input, ctx);
        ledger.succeeded(t.name);
        const json = JSON.stringify(result ?? null);
        if (json.length <= MAX_TOOL_RESULT_CHARS) return result ?? null;
        return { truncated: true, text: `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]` };
      } catch (err) {
        return withGuidance(t.name, ledger, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

/**
 * Whether a failed floor was cut off by thinking — the one cause the tool can
 * fix itself, because the model cannot switch its own thinking off.
 */
function cutOffByThinking(err: unknown): boolean {
  const d = (err as { details?: Record<string, unknown> } | null)?.details;
  if (!d || d['finishReason'] !== 'length') return false;
  return /spent thinking/.test((err as { message?: string }).message ?? '');
}

/**
 * The tokens a tool's OWN model call used — not the chat's. `draft_floor`
 * asks the model separately, with its own prompt and its own output limit,
 * so its numbers never show in the chat's context; the panel reads them here.
 */
export interface SubCallUsage {
  model?: string;
  promptTokens: number;
  completionTokens: number;
  maxOutputTokens?: number;
  latencyMs?: number;
  finishReason?: string | null;
}

/** What the chat's plan card receives from `draft_floor`. */
export interface FloorPlanOutput {
  kind: 'floor-plan';
  sceneId: string;
  level: number;
  plan: CompiledFloor;
  usage: SubCallUsage;
}

/** A failed tool that still reports what its own model call spent. */
function failure(err: unknown): { error: string; usage?: SubCallUsage } {
  const e = err as { message?: string; details?: Record<string, unknown> } | null;
  const d = e?.details ?? {};
  const u = d['usage'] as { promptTokens?: number; completionTokens?: number } | undefined;
  return {
    error: e?.message ?? String(err),
    ...(u
      ? {
          usage: {
            promptTokens: u.promptTokens ?? 0,
            completionTokens: u.completionTokens ?? 0,
            ...(typeof d['maxOutputTokens'] === 'number' ? { maxOutputTokens: d['maxOutputTokens'] } : {}),
            ...(typeof d['model'] === 'string' ? { model: d['model'] } : {}),
            ...(typeof d['finishReason'] === 'string' ? { finishReason: d['finishReason'] } : {}),
          },
        }
      : {}),
  };
}

/** The set a floor is painted in, or the scene's, or the one a blank scene starts in. */
async function tilesetFor(ctx: ToolContext, sceneId: string, level: number): Promise<string> {
  const row = await new ScenesService(ctx.db).sceneRow(sceneId).catch(() => null);
  if (!row || row.campaignId !== ctx.campaignId) throw new Error(`no scene [${sceneId}] in this campaign`);
  const scene = serializeScene(row);
  return levelTiles(scene, level)?.tilesetId ?? scene.tiles?.tilesetId ?? FALLBACK_TILESET;
}

function planSummary(out: FloorPlanOutput): string {
  const p = out.plan;
  const c = p.counts;
  const rooms = p.rooms.map((r) => `${r.name} (${r.kind}, ${r.rect.w}×${r.rect.h})`).join('; ');
  return [
    `Drafted "${p.title}" for scene [${out.sceneId}] floor ${out.level}: ${p.rooms.length} rooms — ${rooms}.`,
    `${c.floor} floor squares, ${c.wall} wall, ${c.door} doors, ${c.window} windows, ${c.prop} props, ${c.stair} stairs.`,
    p.warnings.length > 0 ? `Warnings: ${p.warnings.join(' | ')}` : '',
    'It is being built on the map now, as one step the GM can undo with Ctrl+Z. Say briefly what you laid out and why; do not repeat the square counts, and do not ask whether to build it.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function chatTools(catalog: readonly FixerTool[], deps: ChatToolDeps): ToolSet {
  const { ctx } = deps;
  const tools: ToolSet = {};
  const { ledger } = deps;
  for (const t of catalog) tools[t.name] = wrap(t, ctx, ledger);

  tools['draft_floor'] = tool({
    description:
      "Lay out one floor of a scene from a description — rooms with their walls, doors, windows, furniture and stairs, in the scene's own tileset — and build it on the map. Use it when the GM asks for a floor, a building, a room layout or a map to be drawn. Leave sceneId and level out to use the scene and floor the GM is looking at. It is built straight away, as one step the GM can undo with Ctrl+Z.",
    inputSchema: z.object({
      description: z
        .string()
        .min(3)
        .describe('What the floor is, in the GM\'s words plus anything this chat has settled — rooms, what connects to what, locked doors, the feel.'),
      sceneId: z.string().optional().describe('Scene id; defaults to the scene on the GM\'s screen.'),
      level: z.number().int().min(0).optional().describe('Floor index, 0 for the ground; defaults to the floor on screen.'),
    }),
    execute: async ({ description, sceneId, level }, options) => {
      const sid = sceneId ?? deps.where?.sceneId;
      if (!sid) {
        // Not a failure to retry: nothing the model changes will open a scene.
        return { error: 'No scene to draw on: the GM is not looking at one. Ask which scene, or to open it on the Map.' };
      }
      const lvl = level ?? deps.where?.level ?? 0;
      if (ledger.exhausted('draft_floor')) return refused('draft_floor');
      try {
        const tilesetId = await tilesetFor(ctx, sid, lvl);
        const ask = {
          campaignId: ctx.campaignId,
          sceneId: sid,
          level: lvl,
          tilesetId,
          prompt: description,
          ...(options.abortSignal ? { signal: options.abortSignal } : {}),
        };
        let result;
        try {
          result = await proposeFloor(ctx.db, ctx.llm ?? null, ask);
        } catch (err) {
          // Cut off because thinking ate the room: the one fix the model
          // cannot make, so the tool makes it — the same floor, thinking off.
          if (!cutOffByThinking(err) || !ctx.llm) throw err;
          result = await proposeFloor(ctx.db, { ...ctx.llm, effort: 'off' }, ask);
        }
        ledger.succeeded('draft_floor');
        const out: FloorPlanOutput = {
          kind: 'floor-plan',
          sceneId: sid,
          level: result.level,
          plan: result.plan,
          usage: {
            model: result.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            latencyMs: result.latencyMs,
          },
        };
        return out;
      } catch (err) {
        return withGuidance('draft_floor', ledger, failure(err));
      }
    },
    // The plan's squares are for the Build button, not for the model.
    toModelOutput: ({ output }) => {
      const o = output as FloorPlanOutput | { error: string; guidance?: string };
      // The retry instructions ride with the error — without them the model
      // reads only "it failed" and gives up.
      if ('error' in o) return { type: 'error-text', value: [o.error, o.guidance].filter(Boolean).join('\n') };
      return { type: 'text', value: planSummary(o) };
    },
  });

  tools['recall_conversation'] = tool({
    description:
      "Search this chat's whole transcript, including turns folded into the SESSION BRIEF, for what was said. Use it when the GM refers back to something the brief only summarises, or when you need exact earlier wording.",
    inputSchema: z.object({
      query: z.string().min(2).describe('Words to look for.'),
      limit: z.number().int().min(1).max(12).default(6),
    }),
    execute: async ({ query, limit }) => {
      const words = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2);
      const hits = deps.transcript
        .map((m, turn) => ({ turn, role: m.role, text: messageText(m) }))
        .map((h) => {
          const lower = h.text.toLowerCase();
          return { ...h, score: words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0) };
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score || a.turn - b.turn)
        .slice(0, limit)
        .sort((a, b) => a.turn - b.turn)
        .map((h) => ({ turn: h.turn, who: h.role === 'user' ? 'GM' : 'Fixer', text: h.text.slice(0, 1_500) }));
      return hits.length > 0 ? { hits } : { hits: [], note: `nothing in this chat mentions "${query}"` };
    },
  });

  tools['ask_gm'] = tool({
    description:
      "Ask the GM a question when you need a decision only they can make — which scene, how big, whether a door locks, which of two readings of a rule they want. Offer one to four answers, the one you recommend first; the GM can always type their own instead. The turn pauses until they answer. Do not ask what a tool, the brief or the files can tell you, and do not ask whether to go ahead with something they already asked for.",
    inputSchema: AskGmInput,
    // No execute: answered by the GM, in the panel.
  });

  const texts = Object.values(deps.memory.files).filter((f) => f.kind === 'text' && f.text);
  if (texts.length > 0) {
    tools['read_attachment'] = tool({
      description: `Read a text file the GM attached to this chat. Files: ${texts.map((f) => `"${f.name}"`).join(', ')}. Give a query to get the passages that mention it, or an offset to read on from a point.`,
      inputSchema: z.object({
        file: z.string().describe('The file name, as listed under ATTACHED FILES.'),
        query: z.string().optional(),
        offset: z.number().int().min(0).default(0),
      }),
      execute: async ({ file, query, offset }) => {
        const f =
          texts.find((t) => t.name === file) ??
          texts.find((t) => t.name.toLowerCase().includes(file.toLowerCase()));
        if (!f?.text) return { error: `no attached text file called "${file}"` };
        return { file: f.name, text: searchText(f.text, query, offset) };
      },
    });
  }
  return tools;
}

/** A question for the GM — what `ask_gm` takes, and what the panel draws. */
export const AskGmInput = z.object({
  question: z.string().min(3).max(600).describe('The question, in one or two sentences.'),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(120).describe('A short answer the GM can pick.'),
        description: z.string().max(300).optional().describe('What choosing it means, if that is not obvious.'),
      }),
    )
    .min(1)
    .max(4)
    .describe('One to four suggested answers, the one you recommend first.'),
});

/** What comes back when the GM answers. */
export interface AskGmOutput {
  answer: string;
  /** The suggestion they picked, or absent when they typed their own. */
  chosen?: string;
}

/** Characters the tool definitions add to every request — for the budget. */
export function toolDefinitionChars(tools: ToolSet): number {
  let n = 0;
  for (const [name, t] of Object.entries(tools)) {
    n += name.length + (t.description?.length ?? 0) + 200;
  }
  return n;
}
