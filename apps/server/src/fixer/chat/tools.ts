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
 * The rest are new, and exist because the chat is now the one place the GM
 * asks for things:
 *
 * - The floor tools (`start_floor`, `add_rooms` … `clear_floor`) draw a
 *   floor on the map one small edit at a time (floor-draft.ts).
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
import type { FixerTool, ToolContext } from '../tools.js';
import type { AiContext } from '../context.js';
import { searchText } from './attachments.js';
import { floorTools, type FloorTurn } from './floor-draft.js';
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

export interface ChatToolDeps {
  ctx: ToolContext;
  /** Where the GM is looking — the scene and floor "this floor" means. */
  where: AiContext | undefined;
  /** The whole transcript, folded turns included, for recall. */
  transcript: readonly UIMessage[];
  memory: ConversationMemory;
  /** This turn's tool failures, shared by every tool and read by the loop. */
  ledger: RetryLedger;
  /** This turn's floor drawing: which floor, and its edits one at a time. */
  floor: FloorTurn;
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

export function chatTools(catalog: readonly FixerTool[], deps: ChatToolDeps): ToolSet {
  const { ctx } = deps;
  const tools: ToolSet = {};
  const { ledger } = deps;
  for (const t of catalog) tools[t.name] = wrap(t, ctx, ledger);

  // Drawing a floor: small edits to a plan kept in memory (floor-draft.ts).
  Object.assign(
    tools,
    floorTools({ ctx, where: deps.where, memory: deps.memory, turn: deps.floor }, async (name, run) => {
      if (ledger.exhausted(name)) return refused(name);
      try {
        const out = await run();
        ledger.succeeded(name);
        return out;
      } catch (err) {
        return withGuidance(name, ledger, { error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

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
