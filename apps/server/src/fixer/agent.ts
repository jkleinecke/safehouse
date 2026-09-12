/**
 * The agent loop (FR12.1–12.4, 12.6, 12.17–12.19).
 *
 * One GM turn = system prompt (+ a live situation snapshot when a session is
 * running) + conversation history + the new message, then up to 8 rounds of
 * tool calls against the FR12.17 catalog, streaming deltas to the GM's panel
 * over the hub as gm-visibility ephemeral events. Nothing is broadcast to
 * players: only the GM can talk to the Fixer, and the GM is always the mouth
 * (NG7).
 *
 * Conversations persist in `ai_conversations`; the situation snapshot is NOT
 * persisted — it is rebuilt every turn so it can never go stale.
 */
import type { Visibility } from '@safehouse/contracts';
import { PersonaSchema } from '@safehouse/contracts';
import type { Db } from '@safehouse/db';
import { httpError } from '../services/auth.js';
import type { ChatMessage, ChatToolCall, LlmClient, LlmUsage, ModelSlot } from './llm.js';
import { ZERO_USAGE } from './llm.js';
import {
  loadConversation,
  saveConversation,
  trimHistory,
  type ConversationHandle,
} from './conversations.js';
import {
  FIXER_TOOLS,
  TOOLS_BY_NAME,
  VISION_TOOL_NAME,
  executeTool,
  toolDefinitions,
  type FixerTool,
  type ToolContext,
} from './tools.js';
import { cachedVisionCapability } from './vision.js';
import { getNpcState, getSessionLogState, isSessionLive, liveEncounterRow } from './state.js';
import { getEncounterState, getSceneState, listCharactersState } from './state.js';
import { usageMeter } from './usage.js';

export const MAX_TOOL_ROUNDS = 8;

/** Flush streamed text to the panel in bites, not per token. */
const DELTA_FLUSH_CHARS = 24;

export const FIXER_SYSTEM_PROMPT = [
  "You are the Fixer: the game master's copilot for a Shadowrun 5th Edition campaign, running on the GM's own machine.",
  'You are talking to the GM alone. Players never see you; the GM relays anything worth saying aloud.',
  '',
  'How you work:',
  '1. The rules engine owns every number. Never estimate stats, pools, monitors or initiative from memory — call a tool and read the live value.',
  '2. Cite only provenance you were handed. search_books returns the book code and printed page for each passage; cite those and nothing else. With no retrieved page, say so plainly instead of inventing a citation.',
  '3. Quote sparingly — a phrase at most, and summarise the rest in your own words.',
  '4. You never roll dice and never decide outcomes. You lay out options and the odds you were given; the GM adjudicates.',
  '5. Everything you produce is a draft. generate_npc, draft_wiki_page, draft_recap and suggest_fog_reveal save proposals for the GM to accept — never claim you changed the game.',
  '5b. Anything the players will read — a recap above all — is spoiler-checked against GM-only material. When a tool hands back spoilerFlags, name them to the GM and ask reveal or cut; never quietly leave them in.',
  '6. Fiction you write is original. Do not reproduce published text.',
  '7. At the table, be terse: answer first, reasoning after. Say when you are unsure rather than guessing.',
].join('\n');

export interface FixerHub {
  emitEphemeral(
    campaignId: string,
    input: { type: string; payload: unknown; visibility?: Visibility },
  ): void;
}

export interface FixerDeps {
  db: Db;
  llm: LlmClient;
  hub?: FixerHub;
}

export interface FixerToolTrace {
  name: string;
  arguments: unknown;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface FixerTurnResult {
  conversationId: string;
  text: string;
  rounds: number;
  tools: FixerToolTrace[];
  usage: LlmUsage & { latencyMs: number };
  /** The snapshot that was prefixed, or null when no session is live. */
  snapshot: string | null;
  model: string;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Situation snapshot (FR12.18)
// ---------------------------------------------------------------------------

/** Environment as severity tiers (0 clear .. 3 worst) — the engine owns the dice modifier. */
function envLine(env: { light: number; visibility: number; glare: number; wind: number; note?: string }): string {
  const parts = [
    `light ${env.light}/3`,
    `visibility ${env.visibility}/3`,
    `glare ${env.glare}/3`,
    `wind ${env.wind}/3`,
  ];
  const body = `env severity ${parts.join(', ')}`;
  return env.note ? `${body} (${env.note})` : body;
}

/**
 * A compact, cache-friendly prefix: active scene + environment, the encounter
 * one-liner, and the party status line — so "can Static take another hit?"
 * answers without a tool round-trip. Returns null outside live sessions.
 */
export async function buildSituationSnapshot(db: Db, campaignId: string): Promise<string | null> {
  if (!(await isSessionLive(db, campaignId))) return null;
  const lines: string[] = [
    'SITUATION SNAPSHOT (live session; rebuilt every turn — trust it over anything earlier in this conversation).',
  ];

  try {
    const scene = await getSceneState(db, campaignId);
    const revealed = scene.fog.regions.filter((r) => r.revealed).length;
    lines.push(
      `Scene: ${scene.name} - ${envLine(scene.environment)}; ${scene.tokens.length} tokens ` +
        `(${scene.tokens.filter((t) => t.hidden).length} hidden); fog ${revealed}/${scene.fog.regions.length} regions revealed.`,
    );
  } catch {
    lines.push('Scene: none active.');
  }

  const encounterRow = await liveEncounterRow(db, campaignId);
  if (encounterRow) {
    const encounter = await getEncounterState(db, campaignId, encounterRow.id);
    const up = encounter.upNext ? `${encounter.upNext.name} (${encounter.upNext.initScore})` : 'pass complete';
    const down = encounter.down.length > 0 ? `; down: ${encounter.down.join(', ')}` : '';
    lines.push(
      `Encounter: "${encounter.name}" turn ${encounter.turn}, pass ${encounter.pass} - up next ${up}; ` +
        `${encounter.order.length} combatants${down}.`,
    );
  } else {
    lines.push('Encounter: none running.');
  }

  const party = await listCharactersState(db, campaignId);
  if (party.length > 0) {
    const status = party
      .map((c) => {
        const wound = c.woundModifier !== 0 ? ` wound ${c.woundModifier}` : '';
        return `${c.name} P${c.wounds.physical}/${c.monitors.physical} S${c.wounds.stun}/${c.monitors.stun} Edge ${c.edge.current}/${c.edge.max}${wound}`;
      })
      .join(' | ');
    lines.push(`Party: ${status}`);
  }
  lines.push('Anything deeper than this line: use the tools.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

interface LoopOptions {
  campaignId: string;
  conversation: ConversationHandle;
  systemPrompt: string;
  snapshot: string | null;
  userMessage: string;
  tools: readonly FixerTool[];
  slot: ModelSlot;
  maxRounds: number;
  temperature?: number;
  mode: 'fixer' | 'npc';
  /** The GM's cancel (fixer/activity.ts): aborts the model call, and the loop between calls. */
  signal?: AbortSignal;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error('cancelled by the GM');
    err.name = 'AbortError';
    throw err;
  }
}

async function runLoop(deps: FixerDeps, opts: LoopOptions): Promise<FixerTurnResult> {
  const { db, llm, hub } = deps;
  const model = llm.model(opts.slot);
  const conversationId = opts.conversation.id;
  const registry = new Map(opts.tools.map((t) => [t.name, t]));
  const defs = opts.tools.length > 0 ? toolDefinitions(opts.tools) : undefined;

  const userMessage: ChatMessage = { role: 'user', content: opts.userMessage };
  const transcript: ChatMessage[] = [...opts.conversation.messages, userMessage];
  const messages: ChatMessage[] = [{ role: 'system', content: opts.systemPrompt }];
  if (opts.snapshot) messages.push({ role: 'system', content: opts.snapshot });
  messages.push(...trimHistory(opts.conversation.messages), userMessage);

  const toolCtx: ToolContext = {
    db,
    campaignId: opts.campaignId,
    prompt: opts.userMessage,
    model,
    /** Only map vision uses this — a second, multimodal call (FR12.11). */
    llm: llm.config,
  };

  const emit = (type: string, payload: Record<string, unknown>): void => {
    hub?.emitEphemeral(opts.campaignId, {
      type,
      payload: { conversationId, mode: opts.mode, ...payload },
      visibility: 'gm',
    });
  };

  // FR12.18: the panel shows what the model was handed before it answers, so
  // the GM can see the snapshot was current without asking for it.
  if (opts.snapshot) emit('fixer.snapshot', { text: opts.snapshot });

  const totals: LlmUsage & { latencyMs: number } = { ...ZERO_USAGE, latencyMs: 0 };
  const traces: FixerToolTrace[] = [];
  let text = '';
  let rounds = 0;
  let truncated = true;

  for (let round = 1; round <= opts.maxRounds; round++) {
    throwIfCancelled(opts.signal);
    rounds = round;
    let buffer = '';
    const flush = (force: boolean): void => {
      if (buffer.length === 0) return;
      if (!force && buffer.length < DELTA_FLUSH_CHARS) return;
      emit('fixer.delta', { round, text: buffer });
      buffer = '';
    };
    const turn = await llm.chat(
      {
        model,
        messages,
        ...(defs ? { tools: defs, tool_choice: 'auto' as const } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
      {
        onDelta: (delta) => {
          buffer += delta;
          flush(false);
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
    flush(true);

    totals.promptTokens += turn.usage.promptTokens;
    totals.completionTokens += turn.usage.completionTokens;
    totals.totalTokens += turn.usage.totalTokens;
    totals.latencyMs += turn.latencyMs;
    usageMeter.record(opts.campaignId, {
      model: turn.model,
      usage: turn.usage,
      latencyMs: turn.latencyMs,
    });

    const assistant: ChatMessage = {
      role: 'assistant',
      content: turn.content.length > 0 ? turn.content : null,
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
    };
    messages.push(assistant);
    transcript.push(assistant);

    if (turn.toolCalls.length === 0) {
      text = turn.content;
      truncated = false;
      break;
    }

    for (const call of turn.toolCalls) {
      throwIfCancelled(opts.signal);
      const startedAt = Date.now();
      // Two frames per call, not one: the panel's chip needs to say "running"
      // while a `search_books` grinds through the library, then settle. A
      // single frame left every chip reading "done" the instant it appeared.
      emit('fixer.tool', { round, name: call.function.name, status: 'start' });
      const result = await executeTool(call.function.name, call.function.arguments, toolCtx, registry);
      const ms = Date.now() - startedAt;
      emit('fixer.tool', {
        round,
        name: call.function.name,
        status: result.ok ? 'end' : 'error',
        detail: result.ok ? `${ms} ms` : result.error,
      });
      const trace: FixerToolTrace = {
        name: call.function.name,
        arguments: safeJson(call.function.arguments),
        ok: result.ok,
        ms,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
      traces.push(trace);
      const toolMessage = toolResultMessage(call, result.content);
      messages.push(toolMessage);
      transcript.push(toolMessage);
    }
  }

  if (truncated && text.length === 0) {
    text = `I ran out of tool rounds (${opts.maxRounds}) before I could answer. Narrow the question and I will try again.`;
  }

  await saveConversation(db, conversationId, transcript);
  emit('fixer.done', {
    text,
    rounds,
    truncated,
    usage: totals,
    tools: traces.map((t) => ({ name: t.name, ok: t.ok })),
  });

  return {
    conversationId,
    text,
    rounds,
    tools: traces,
    usage: totals,
    snapshot: opts.snapshot,
    model,
    truncated,
  };
}

function toolResultMessage(call: ChatToolCall, content: string): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    name: call.function.name,
    content,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface FixerChatInput {
  campaignId: string;
  message: string;
  conversationId?: string;
  slot?: ModelSlot;
  maxRounds?: number;
  tools?: readonly FixerTool[];
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * The catalog this box can actually honour (FR12.11's capability flag).
 *
 * `read_map_image` is offered only when the *cached* probe says the model reads
 * images. Cached deliberately: the probe belongs to `GET /api/fixer/status`, so
 * a chat turn never pays two extra round trips, and an unprobed box hides the
 * tool rather than letting the model promise the GM something that will fail
 * halfway through a turn.
 */
export function toolsFor(
  llm: LlmClient,
  slot: ModelSlot,
  catalog: readonly FixerTool[] = FIXER_TOOLS,
): readonly FixerTool[] {
  if (cachedVisionCapability(llm.config, slot).supported) return catalog;
  return catalog.filter((t) => t.name !== VISION_TOOL_NAME);
}

/** GM chat (FR12.1–12.4) with the full tool catalog and the live snapshot. */
export async function runFixerChat(
  deps: FixerDeps,
  input: FixerChatInput,
): Promise<FixerTurnResult> {
  const conversation = await loadConversation(deps.db, input.campaignId, {
    kind: 'fixer',
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
  });
  const snapshot = await buildSituationSnapshot(deps.db, input.campaignId);
  const slot = input.slot ?? 'primary';
  return runLoop(deps, {
    campaignId: input.campaignId,
    conversation,
    systemPrompt: FIXER_SYSTEM_PROMPT,
    snapshot,
    userMessage: input.message,
    tools: input.tools ?? toolsFor(deps.llm, slot),
    slot,
    maxRounds: Math.min(Math.max(input.maxRounds ?? MAX_TOOL_ROUNDS, 1), MAX_TOOL_ROUNDS),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    mode: 'fixer',
  });
}

export interface NpcConverseInput {
  campaignId: string;
  npcId: string;
  message: string;
  conversationId?: string;
  slot?: ModelSlot;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * "Speak as ⟨NPC⟩" (FR12.6): persona + a hard knowledge boundary in the
 * system prompt, transcript saved to `ai_conversations` (kind `npc`).
 * The NPC gets no tools — what they know is what the boundary says they know.
 */
export async function runNpcConverse(
  deps: FixerDeps,
  input: NpcConverseInput,
): Promise<FixerTurnResult> {
  const npc = await getNpcState(deps.db, input.campaignId, input.npcId);
  const conversation = await loadConversation(deps.db, input.campaignId, {
    kind: 'npc',
    npcRef: npc.id,
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
  });
  if (conversation.npcRef && conversation.npcRef !== npc.id) {
    throw httpError(400, 'bad_request', 'that conversation belongs to a different NPC');
  }
  const recent = await getSessionLogState(deps.db, input.campaignId, 10);
  const systemPrompt = npcSystemPrompt(npc.name, npc.persona, recent.map((e) => `${e.type} @ ${e.ts}`));
  return runLoop(deps, {
    campaignId: input.campaignId,
    conversation,
    systemPrompt,
    snapshot: null,
    userMessage: input.message,
    tools: [],
    slot: input.slot ?? 'primary',
    maxRounds: 1,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    mode: 'npc',
  });
}

/** Persona + knowledge boundary + secrets, as a system prompt (FR12.5/12.6). */
export function npcSystemPrompt(name: string, rawPersona: unknown, recentEvents: string[]): string {
  const parsed = PersonaSchema.safeParse(rawPersona ?? {});
  const persona = parsed.success
    ? parsed.data
    : { traits: [], goals: [], secrets: [], knowledge: [], mannerisms: [], hooks: [] };
  const lines = [
    `You are playing ${name}, a non-player character in a Shadowrun 5th Edition campaign.`,
    'Speak in first person, in character, one short exchange at a time. The GM is your only audience and relays your lines aloud.',
    '',
    `Traits: ${persona.traits.length > 0 ? persona.traits.join(', ') : 'unspecified'}`,
    `Voice: ${persona.voice ?? 'unspecified'}`,
    `Mannerisms: ${persona.mannerisms.length > 0 ? persona.mannerisms.join('; ') : 'unspecified'}`,
    `Goals: ${persona.goals.length > 0 ? persona.goals.join('; ') : 'unspecified'}`,
  ];
  if (persona.backstory) lines.push(`Background: ${persona.backstory}`);
  lines.push(
    '',
    'KNOWLEDGE BOUNDARY - you know only the following, plus common street knowledge any local would have:',
    persona.knowledge.length > 0
      ? persona.knowledge.map((k) => `- ${k}`).join('\n')
      : '- nothing beyond ordinary local knowledge',
    '',
    'SECRETS - never volunteer these. Under real pressure you may hint, deflect, or lie; say what you would do rather than dumping the truth:',
    persona.secrets.length > 0 ? persona.secrets.map((s) => `- ${s}`).join('\n') : '- none',
  );
  if (recentEvents.length > 0) {
    lines.push(
      '',
      'Recent table events (only draw on these if this character was plausibly present):',
      recentEvents.map((e) => `- ${e}`).join('\n'),
    );
  }
  lines.push(
    '',
    'Rules: if asked something outside your knowledge, react like a person who does not know - do not invent campaign facts.',
    'Never describe game mechanics, dice, or rules; you are a person, not a rulebook. Out-of-character notes to the GM go in [square brackets] at the end.',
  );
  return lines.join('\n');
}

export { FIXER_TOOLS, TOOLS_BY_NAME };
export {
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationHandle,
} from './conversations.js';
