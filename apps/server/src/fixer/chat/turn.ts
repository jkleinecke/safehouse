/**
 * One Fixer chat turn on the AI SDK (FR12.1–12.4, 12.11, 12.17–12.18).
 *
 * The GM's panel sends only its new message; the transcript lives here. The
 * turn loads it, adds the message (and any files on it) to the
 * conversation's memory, folds older turns into the brief if the context has
 * outgrown its soft line, builds the curated context (memory.ts), and runs
 * the tool loop with `streamText` — streamed straight back to the panel as a
 * UI message stream, which `useChat` reads.
 *
 * Kept from the hand-rolled loop: one AI job per campaign at a time and the
 * GM's cancel (`withRun`), the live situation snapshot rebuilt every turn and
 * never stored, at most eight tool rounds, and one usage row per turn.
 *
 * New: the model is given the curated context instead of the last forty
 * messages; a slow local box is only given up on when it goes QUIET, not when
 * a long answer runs long; and the reply is persisted as the SDK's own UI
 * messages, so the panel reloads a thread exactly as it was drawn.
 */
import type { FastifyReply } from 'fastify';
import {
  createIdGenerator,
  createUIMessageStream,
  isStepCount,
  pipeUIMessageStreamToResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { Db } from '@safehouse/db';
import { withRun, type ActivityHub } from '../activity.js';
import { httpError } from '../../services/auth.js';
import { FIXER_SYSTEM_PROMPT, buildSituationSnapshot, toolsFor } from '../agent.js';
import { joinSnapshot, whereTheGmIs, type AiContext } from '../context.js';
import { loadConversation, saveChat, saveMemory } from '../conversations.js';
import { LlmClient, type LlmConfig, type ModelSlot } from '../llm.js';
import type { ToolContext } from '../tools.js';
import { persistTurnUsage, usageMeter } from '../usage.js';
import { cachedVisionCapability } from '../vision.js';
import { imageDataUrl, registerAttachments } from './attachments.js';
import { fold } from './compact.js';
import {
  HARD_LINE,
  budgetFor,
  buildContext,
  calibrate,
  fromLegacy,
  readMemory,
  type ContextBreakdown,
  type ConversationMemory,
} from './memory.js';
import { contextWindowFor, languageModelFor, modelIdFor, providerOptionsFor } from './model.js';
import { newFloorTurn } from './floor-draft.js';
import { RetryLedger, chatTools, toolDefinitionChars } from './tools.js';

/**
 * Model calls per turn. Drawing a floor is many small edits — start it, a
 * few rooms at a time, the doors, each room's furniture, the outside, a look
 * and a fix or two (floor-draft.ts) — with room on top for the retries a
 * failed tool is owed (tools.ts, `TOOL_RETRIES`).
 */
export const MAX_STEPS = 40;

/**
 * Silence, not duration (fixer/llm.ts). The first chunk waits for the box to
 * read the whole prompt, which on a local model with a full context is the
 * one long wait with nothing to show for it; after that, any gap this long
 * with nothing streamed means the box has stopped.
 */
const TURN_TIMEOUT = { firstChunkMs: 300_000, chunkMs: 120_000, toolMs: 600_000 } as const;

/** What the GM sees when the answer fails part way — said as what happened. */
function errorText(err: unknown): string {
  const e = err as { name?: string; message?: string; expose?: boolean } | null;
  if (e?.name === 'TimeoutError' || /timed? ?out|timeout/i.test(e?.message ?? '')) {
    return 'The model went quiet mid-answer and was given up on. It may still be loading, or overloaded — try again.';
  }
  if (e?.name === 'AbortError') return 'Cancelled.';
  if (e?.expose && e.message) return e.message;
  return e?.message ? `The inference box failed: ${e.message}` : 'The inference box failed.';
}

/** What the panel's context ring reads — see `stats` in `streamFixerTurn`. */
export interface ContextStats {
  /** The estimate for the first request of the turn — what the ring fills to. */
  usedTokens: number;
  windowTokens: number;
  /** What the prompt may use: the window less room kept for the answer. */
  promptBudget: number;
  breakdown: ContextBreakdown;
  /** Each request the turn made, as the model counted it. */
  steps: Array<{ inputTokens: number; outputTokens: number; finishReason: string; tools: string[] }>;
  folded: number;
  windowMessages: number;
  dropped: number;
  totalMessages: number;
  charsPerToken: number;
  model: string;
}

export interface FixerTurnInput {
  campaignId: string;
  config: LlmConfig;
  /** A new GM message — or, instead, */
  message?: UIMessage;
  /** the GM's answer to the question the last reply stopped at. */
  answer?: { toolCallId: string; answer: string; chosen?: string | undefined };
  conversationId?: string | undefined;
  context?: AiContext | undefined;
  slot?: ModelSlot | undefined;
}

export interface FixerTurnDeps {
  db: Db;
  hub?: ActivityHub | undefined;
}

/**
 * The stored transcript with the GM's answer filled into the question the
 * last reply stopped at. Anything else — no reply waiting, a question already
 * answered, a call id from another turn — is refused: an answer only means
 * something to the question it was asked of.
 */
export function answerQuestion(
  history: readonly UIMessage[],
  answer: { toolCallId: string; answer: string; chosen?: string | undefined },
): UIMessage[] {
  const last = history[history.length - 1];
  const idx = last?.role === 'assistant'
    ? last.parts.findIndex(
        (p) =>
          p.type === 'tool-ask_gm' &&
          (p as { toolCallId?: string }).toolCallId === answer.toolCallId &&
          (p as { state?: string }).state === 'input-available',
      )
    : -1;
  if (!last || idx < 0) {
    throw httpError(409, 'conflict', 'that question is not waiting for an answer any more');
  }
  const part = last.parts[idx]!;
  const output = { answer: answer.answer, ...(answer.chosen ? { chosen: answer.chosen } : {}) };
  const parts = [...last.parts];
  parts[idx] = { ...part, state: 'output-available', output } as typeof part;
  return [...history.slice(0, -1), { ...last, parts }];
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

/**
 * Run the turn and stream it into `reply`. Throws BEFORE anything is written
 * when the campaign is busy or the conversation is unknown, so the route can
 * answer those as ordinary JSON errors; once streaming has begun, every
 * failure goes down the stream as an error part instead.
 */
export async function streamFixerTurn(
  deps: FixerTurnDeps,
  reply: FastifyReply,
  input: FixerTurnInput,
): Promise<void> {
  const { db } = deps;
  const { campaignId, config } = input;
  const slot = input.slot ?? 'primary';

  // Fails as JSON, before the stream exists: an unknown thread is a 404.
  const conversation = await loadConversation(db, campaignId, {
    kind: 'fixer',
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
  });

  const history = fromLegacy(conversation.messages as unknown[]);
  // An answer fills in the question the last reply is waiting on, and the
  // same reply carries on; a message starts a new exchange. Checked before
  // the stream exists, so a stale answer is an ordinary 409.
  const messages: UIMessage[] = input.answer
    ? answerQuestion(history, input.answer)
    : [...history, input.message!];
  const asked = [...messages].reverse().find((m) => m.role === 'user') ?? messages[messages.length - 1]!;

  await withRun(deps.hub, campaignId, 'chat', 'answering the Fixer chat', async (signal) => {
    let memory: ConversationMemory = input.message
      ? await registerAttachments(db, campaignId, input.message, readMemory(conversation.memory))
      : readMemory(conversation.memory);

    const window = await contextWindowFor(config);
    const model = languageModelFor(config, slot, window);
    const foldModel = languageModelFor(config, 'fast', window);
    const providerOptions = providerOptionsFor(config);
    const budget = budgetFor(window);
    const vision = cachedVisionCapability(config, slot).supported;
    const ctx: ToolContext = {
      db,
      campaignId,
      prompt: textOf(asked),
      model: modelIdFor(config, slot),
      llm: config,
    };
    const snapshot = joinSnapshot(await buildSituationSnapshot(db, campaignId), whereTheGmIs(input.context));
    const baseInstructions = [FIXER_SYSTEM_PROMPT, snapshot].filter(Boolean).join('\n\n');
    const loadImage = (id: string) =>
      imageDataUrl(db, campaignId, id, memory.files[id]?.mediaType ?? 'image/png');

    let captured: { result: ReturnType<typeof streamText> | null; sentChars: number; startedAt: number } = {
      result: null,
      sentChars: 0,
      startedAt: Date.now(),
    };
    /** This turn's tool failures, for the retry policy (tools.ts). */
    const ledger = new RetryLedger();
    /** This turn's floor drawing (floor-draft.ts). */
    const floor = newFloorTurn();
    /**
     * Everything the context panel shows about this turn: the window and the
     * budget, the estimate by layer, what the model itself counted for each
     * step, and how the transcript stands — folded, sent, left out.
     */
    const stats: ContextStats = {
      usedTokens: 0,
      windowTokens: budget.window,
      promptBudget: budget.prompt,
      breakdown: { system: 0, brief: 0, files: 0, messages: 0, tools: 0, images: 0 },
      steps: [],
      folded: 0,
      windowMessages: 0,
      dropped: 0,
      totalMessages: messages.length,
      charsPerToken: memory.charsPerToken,
      model: modelIdFor(config, slot),
    };

    const stream = createUIMessageStream({
      originalMessages: messages,
      generateId: createIdGenerator({ prefix: 'msg', size: 16 }),
      execute: async ({ writer }) => {
        // What the model will be handed, before it answers (FR12.18).
        if (snapshot) writer.write({ type: 'data-snapshot', data: { text: snapshot }, transient: true });

        const toolsNow = () =>
          chatTools(toolsFor(new LlmClient(config), slot), {
            ctx,
            where: input.context,
            transcript: messages,
            memory,
            ledger,
            floor,
          });
        const build = () => {
          const tools = toolsNow();
          return buildContext({
            messages,
            memory,
            budget,
            instructions: baseInstructions,
            tools,
            toolChars: toolDefinitionChars(tools),
            vision,
            loadImage,
          }).then((built) => ({ built, tools }));
        };

        let { built, tools } = await build();
        // Past the soft line: fold the oldest half into the brief BEFORE
        // answering. Done here, inside the turn's own lock, rather than after
        // the last one — a fold that outlived its turn would either block the
        // GM's next message or race it for the memory row.
        for (let i = 0; i < 2 && built.shouldFold; i += 1) {
          writer.write({
            type: 'data-status',
            data: { text: 'folding older turns into the session brief…' },
            transient: true,
          });
          const folded = await fold(foldModel, messages, memory, {
            abortSignal: signal,
            ...(providerOptions ? { providerOptions } : {}),
          });
          if (folded.folded === 0) break;
          memory = folded.memory;
          ({ built, tools } = await build());
          if (built.estimatedTokens <= budget.prompt * HARD_LINE && !built.shouldFold) break;
        }

        const result = streamText({
          model,
          instructions: built.instructions,
          messages: built.messages,
          tools,
          stopWhen: isStepCount(MAX_STEPS),
          // A tool failed and is owed a retry: the next step must call a tool
          // — the failed one, fixed, or a read that finds what it was
          // missing — rather than answer the GM with an apology. Once the
          // tool has used its retries it says so, and the model is free.
          prepareStep: ({ steps }) => {
            const last = steps[steps.length - 1];
            const owed = last?.toolResults.some((r) => {
              const out = r.output as { error?: unknown; retriesLeft?: unknown } | null;
              return typeof out === 'object' && out !== null && 'error' in out && Number(out.retriesLeft) > 0;
            });
            return owed ? { toolChoice: 'required' } : {};
          },
          timeout: TURN_TIMEOUT,
          abortSignal: signal,
          ...(providerOptions ? { providerOptions: providerOptions as never } : {}),
          onStepEnd: (step) => {
            // What the box itself counted — the truth the estimate is checked against.
            stats.steps.push({
              inputTokens: step.usage.inputTokens ?? 0,
              outputTokens: step.usage.outputTokens ?? 0,
              finishReason: step.finishReason,
              tools: step.toolCalls.map((c) => c.toolName),
            });
            usageMeter.record(campaignId, {
              model: ctx.model ?? 'unknown',
              usage: {
                promptTokens: step.usage.inputTokens ?? 0,
                completionTokens: step.usage.outputTokens ?? 0,
                totalTokens: (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
              },
              latencyMs: 0,
            });
          },
        });
        captured = { result, sentChars: built.sentChars, startedAt: captured.startedAt };
        stats.usedTokens = built.estimatedTokens;
        stats.breakdown = built.breakdown;
        stats.folded = memory.foldedCount;
        stats.windowMessages = built.windowMessages;
        stats.dropped = built.dropped;
        stats.charsPerToken = memory.charsPerToken;

        writer.merge(
          toUIMessageStream({
            stream: result.stream,
            tools,
            sendReasoning: true,
            onError: errorText,
            messageMetadata: ({ part }) => {
              if (part.type === 'start') return { conversationId: conversation.id };
              if (part.type === 'finish') {
                const u = (part as { totalUsage?: { inputTokens?: number; outputTokens?: number } }).totalUsage;
                return {
                  conversationId: conversation.id,
                  usage: {
                    promptTokens: u?.inputTokens ?? 0,
                    completionTokens: u?.outputTokens ?? 0,
                    totalTokens: (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
                    latencyMs: Date.now() - captured.startedAt,
                  },
                  context: stats,
                };
              }
              return undefined;
            },
          }),
        );
      },
      onError: errorText,
      onEnd: async ({ messages: all }) => {
        // The whole transcript and the memory as it now stands — files
        // registered, anything folded. A cancelled turn keeps what streamed.
        await saveChat(db, conversation.id, all, memory);
      },
    });

    reply.hijack();
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream });

    // After the stream: the meter, and the tokens-per-character calibration.
    const result = captured.result;
    if (!result) return;
    try {
      const [usage, steps] = await Promise.all([result.usage, result.steps]);
      await persistTurnUsage(db, {
        campaignId,
        model: ctx.model ?? 'unknown',
        usage: {
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        },
        latencyMs: Date.now() - captured.startedAt,
        kind: 'chat',
      });
      const first = steps[0]?.usage.inputTokens;
      const next = calibrate(memory, captured.sentChars, first);
      if (next !== memory) await saveMemory(db, conversation.id, next);
    } catch {
      // A cancelled or failed turn has no totals to record.
    }
  });
}
