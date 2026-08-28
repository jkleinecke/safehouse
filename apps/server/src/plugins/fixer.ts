/**
 * fixer domain plugin (M12) — the GM's copilot surface.
 *
 * Routes (all GM-only, §13): the streaming chat turn, in-character NPC
 * conversations, the draft queue with accept/reject, and the usage meter.
 * Answers stream to the GM's panel over the hub as gm-visibility ephemeral
 * events (`fixer.delta` / `fixer.tool` / `fixer.done`) while the HTTP call
 * returns the finished turn.
 *
 * With `LLM_BASE_URL` unset the generative routes answer
 * `503 { error: { code: 'ai_disabled' } }` and `GET /api/fixer/status`
 * reports `enabled: false` so the web app can hide every AI entry point —
 * the app boots and plays with no model at all (NG7 / Principle 5).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aiGenerations, type Db } from '@safehouse/db';
import { and, eq } from 'drizzle-orm';
import { assertCampaign, httpError, requireRole } from '../services/auth.js';
import { LlmClient, llmConfigFromEnv } from '../fixer/llm.js';
import { runFixerChat, runNpcConverse } from '../fixer/agent.js';
import { listConversations, loadConversation } from '../fixer/conversations.js';
import { acceptDraft, listDrafts, rejectDraft } from '../fixer/drafts.js';
import { usageMeter } from '../fixer/usage.js';

const ChatBody = z.object({
  campaignId: z.string().optional(),
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
  slot: z.enum(['primary', 'fast']).optional(),
  maxRounds: z.number().int().min(1).max(8).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const ConverseBody = z.object({
  campaignId: z.string().optional(),
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
  slot: z.enum(['primary', 'fast']).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const DraftQuery = z.object({
  status: z.enum(['draft', 'accepted', 'rejected']).optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

/** Configured client, or null when no inference box is configured (NG7). */
function llmOrNull(): LlmClient | null {
  const config = llmConfigFromEnv();
  return config ? new LlmClient(config) : null;
}

/**
 * app.ts's error handler collapses every 5xx envelope code to `internal`, but
 * the disabled/unreachable states are exactly what the web app switches on —
 * so AI routes send their 5xx envelopes themselves.
 * INTEGRATION: if server-core ever preserves 5xx codes, these can go back to
 * plain `throw httpError(...)`.
 */
function sendAiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply
    .status(status)
    .send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

function disabled(reply: FastifyReply): FastifyReply {
  return sendAiError(
    reply,
    503,
    'ai_disabled',
    'the Fixer is switched off: set LLM_BASE_URL to point at an OpenAI-compatible server',
  );
}

/** Relay an upstream 5xx (unreachable box, bad model response) with its code. */
function upstream(reply: FastifyReply, err: unknown): FastifyReply {
  const e = (err ?? {}) as { statusCode?: unknown; code?: unknown; message?: unknown; details?: unknown };
  if (typeof e.statusCode === 'number' && e.statusCode >= 500 && typeof e.code === 'string') {
    return sendAiError(
      reply,
      e.statusCode,
      e.code,
      typeof e.message === 'string' ? e.message : 'the inference box failed',
      e.details,
    );
  }
  throw err;
}

/** GM-only, bound to this campaign (only the GM ever talks to the Fixer). */
function gmFor(req: FastifyRequest, campaignId: string | undefined): string {
  const auth = requireRole(req, 'gm');
  const id = campaignId ?? auth.campaignId;
  if (!id) throw httpError(400, 'bad_request', 'campaignId is required');
  assertCampaign(auth, id);
  return id;
}

/** One turn per campaign at a time — the box has one queue (FR12.16/R11). */
const inFlight = new Set<string>();

async function exclusive<T>(campaignId: string, run: () => Promise<T>): Promise<T> {
  if (inFlight.has(campaignId)) {
    throw httpError(409, 'ai_busy', 'the Fixer is still working on the previous turn');
  }
  inFlight.add(campaignId);
  try {
    return await run();
  } finally {
    inFlight.delete(campaignId);
  }
}

/** Persisted draft usage (FR12.15) — the durable half of the meter. */
async function draftUsage(db: Db, campaignId: string) {
  const rows = await db
    .select({ usage: aiGenerations.usage, status: aiGenerations.status })
    .from(aiGenerations)
    .where(eq(aiGenerations.campaignId, campaignId));
  let totalTokens = 0;
  let withUsage = 0;
  for (const row of rows) {
    const usage = row.usage as { totalTokens?: unknown } | null;
    if (usage && typeof usage.totalTokens === 'number') {
      totalTokens += usage.totalTokens;
      withUsage += 1;
    }
  }
  return { generations: rows.length, withUsage, totalTokens };
}

export default async function fixerPlugin(app: FastifyInstance): Promise<void> {
  // --- capability probe: lets the web app hide AI entry points cleanly ------
  app.get('/api/fixer/status', async (req) => {
    requireRole(req, 'gm');
    const config = llmConfigFromEnv();
    return {
      enabled: config !== null,
      models: config ? { primary: config.primary, fast: config.fast } : null,
      maxToolRounds: 8,
    };
  });

  // --- FR12.1–12.4: the chat turn (streams over WS, returns the result) ----
  app.post('/api/fixer/chat', async (req, reply) => {
    const body = parseBody(ChatBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const llm = llmOrNull();
    if (!llm) return disabled(reply);
    let result: Awaited<ReturnType<typeof runFixerChat>>;
    try {
      result = await exclusive(campaignId, () =>
        runFixerChat(
          { db: app.db, llm, hub: app.hub },
          {
            campaignId,
            message: body.message,
            ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
            ...(body.slot !== undefined ? { slot: body.slot } : {}),
            ...(body.maxRounds !== undefined ? { maxRounds: body.maxRounds } : {}),
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
          },
        ),
      );
    } catch (err) {
      return upstream(reply, err);
    }
    return reply.send({
      conversationId: result.conversationId,
      text: result.text,
      rounds: result.rounds,
      truncated: result.truncated,
      tools: result.tools,
      usage: result.usage,
      model: result.model,
      snapshotApplied: result.snapshot !== null,
    });
  });

  // --- FR12.6: speak as an NPC --------------------------------------------
  app.post('/api/npcs/:id/converse', async (req, reply) => {
    const body = parseBody(ConverseBody, req.body);
    const campaignId = gmFor(req, body.campaignId);
    const { id } = req.params as { id: string };
    const llm = llmOrNull();
    if (!llm) return disabled(reply);
    let result: Awaited<ReturnType<typeof runNpcConverse>>;
    try {
      result = await exclusive(campaignId, () =>
        runNpcConverse(
          { db: app.db, llm, hub: app.hub },
          {
            campaignId,
            npcId: id,
            message: body.message,
            ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
            ...(body.slot !== undefined ? { slot: body.slot } : {}),
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
          },
        ),
      );
    } catch (err) {
      return upstream(reply, err);
    }
    return reply.send({
      conversationId: result.conversationId,
      npcId: id,
      line: result.text,
      usage: result.usage,
      model: result.model,
    });
  });

  // --- FR12.1: conversation history ---------------------------------------
  app.get('/api/campaigns/:id/fixer/conversations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaignId = gmFor(req, id);
    return reply.send({ conversations: await listConversations(app.db, campaignId) });
  });

  app.get('/api/fixer/conversations/:id', async (req, reply) => {
    const campaignId = gmFor(req, undefined);
    const { id } = req.params as { id: string };
    const conversation = await loadConversation(app.db, campaignId, {
      kind: 'fixer',
      conversationId: id,
    });
    return reply.send(conversation);
  });

  // --- FR12.15: the draft queue -------------------------------------------
  app.get('/api/campaigns/:id/generations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaignId = gmFor(req, id);
    const query = DraftQuery.safeParse(req.query ?? {});
    if (!query.success) throw httpError(400, 'bad_request', 'invalid query', query.error.issues);
    return reply.send({
      generations: await listDrafts(app.db, campaignId, {
        ...(query.data.status !== undefined ? { status: query.data.status } : {}),
        ...(query.data.kind !== undefined ? { kind: query.data.kind } : {}),
        ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
      }),
    });
  });

  app.post('/api/generations/:id/accept', async (req, reply) => {
    const campaignId = gmFor(req, undefined);
    const { id } = req.params as { id: string };
    const result = await acceptDraft(app.db, campaignId, id);
    app.hub.emitEphemeral(campaignId, {
      type: 'fixer.generation',
      payload: { id, status: 'accepted', applied: result.applied },
      visibility: 'gm',
    });
    return reply.send(result);
  });

  app.post('/api/generations/:id/reject', async (req, reply) => {
    const campaignId = gmFor(req, undefined);
    const { id } = req.params as { id: string };
    const generation = await rejectDraft(app.db, campaignId, id);
    app.hub.emitEphemeral(campaignId, {
      type: 'fixer.generation',
      payload: { id, status: 'rejected' },
      visibility: 'gm',
    });
    return reply.send({ generation });
  });

  // --- FR12.15/12.16: tokens + latency, never dollars ----------------------
  app.get('/api/campaigns/:id/fixer/usage', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaignId = gmFor(req, id);
    const pending = await app.db
      .select({ id: aiGenerations.id })
      .from(aiGenerations)
      .where(and(eq(aiGenerations.campaignId, campaignId), eq(aiGenerations.status, 'draft')));
    return reply.send({
      campaignId,
      /** Since this server process started — see fixer/usage.ts INTEGRATION. */
      session: usageMeter.totals(campaignId),
      drafts: { ...(await draftUsage(app.db, campaignId)), pending: pending.length },
      currency: 'tokens+latency',
    });
  });
}
