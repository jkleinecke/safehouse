/**
 * The Anthropic transport for the Fixer (FR12.13, D12).
 *
 * ## Why this is a second implementation and not a base URL
 *
 * OpenAI, xAI and every local server speak the same Chat Completions shape, so
 * they differ only in host, key and model name. Anthropic's Messages API is a
 * different wire format, and the differences are not cosmetic:
 *
 *  - the system prompt is a TOP-LEVEL field, not a message with role `system`;
 *  - `max_tokens` is required rather than optional;
 *  - content comes back as a list of typed blocks, not one string;
 *  - a tool call is a `tool_use` block, and its result goes back as a
 *    `tool_result` block inside a USER message, not as a `tool` role.
 *
 * Pointing an OpenAI client at `api.anthropic.com` produces a 404 and a bad
 * afternoon. So the rest of the Fixer keeps speaking its own OpenAI-shaped
 * `ChatMessage` / `ChatTurn` vocabulary — every tool, every agent loop, every
 * meter reads those — and this module translates in both directions at the
 * edge. One dialect crossing, in one file.
 *
 * ## Streaming
 *
 * Always. §15 asks for deltas on the GM's panel as they arrive, and the SDK's
 * `.stream()` gives text events plus a `finalMessage()` that carries usage and
 * the assembled blocks, so the meter reads the same numbers it would from a
 * non-streamed call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { httpError } from '../services/auth.js';
// TYPE-ONLY, and it has to stay that way. `llm.ts` imports this module to
// dispatch on dialect, so importing a VALUE back from it closes a cycle that
// Node resolves by handing us an uninitialised binding — the whole server
// failed to boot with "Cannot access 'ZERO_USAGE' before initialization".
// Types are erased at compile time and cost nothing at runtime.
import type {
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  ChatTurn,
  ChatOptions,
} from './llm.js';

/**
 * Anthropic requires `max_tokens`; the rest of the Fixer treats it as optional
 * because Chat Completions does. This is what an omitted one becomes — large
 * enough for the Fixer's longest job (a recap) without being the 128K ceiling
 * that would demand streaming-only handling for its own sake.
 */
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * Split our flat message list into Anthropic's shape.
 *
 * Two rearrangements, both forced by the API rather than chosen:
 *
 * SYSTEM messages leave the list entirely and become the top-level `system`
 * string. More than one is joined — the Fixer builds its prompt in pieces and
 * the API takes a single field.
 *
 * TOOL results stop being their own role. Each becomes a `tool_result` block
 * addressed by id, and consecutive ones merge into ONE user message, because
 * Anthropic wants every result for a turn together. Emitting them as separate
 * messages is accepted but teaches the model to stop calling tools in
 * parallel, which is the same trap the OpenAI side has.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const system: string[] = [];
  const out: Anthropic.MessageParam[] = [];

  const pushResult = (block: Anthropic.ToolResultBlockParam) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      const blocks = last.content as Anthropic.ContentBlockParam[];
      // Only merge into a message that is ALL tool results; a user's own text
      // followed by a result would misrepresent who said what.
      if (blocks.every((b) => b.type === 'tool_result')) {
        blocks.push(block);
        return;
      }
    }
    out.push({ role: 'user', content: [block] });
  };

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) system.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      pushResult({
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
        content: m.content ?? '',
      });
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content ?? '' });
      continue;
    }

    // Assistant: text and tool calls travel together as blocks.
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (m.content && m.content.length > 0) blocks.push({ type: 'text', text: m.content });
    for (const call of m.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        // Arguments cross our own boundary as a JSON STRING because that is
        // what Chat Completions emits; Anthropic wants the object.
        input: safeParse(call.function.arguments),
      });
    }
    if (blocks.length > 0) out.push({ role: 'assistant', content: blocks });
  }

  return { system: system.join('\n\n'), messages: out };
}

/** Tool arguments arrive as a JSON string. A malformed one is not fatal. */
function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Our tool definitions, in Anthropic's shape. */
export function toAnthropicTools(req: ChatRequest): Anthropic.Tool[] | undefined {
  if (!req.tools || req.tools.length === 0) return undefined;
  return req.tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

/** `tool_choice`, where the two vocabularies happen not to line up. */
export function toAnthropicToolChoice(
  choice: ChatRequest['tool_choice'],
): Anthropic.ToolChoice | undefined {
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'auto') return { type: 'auto' };
  return undefined;
}

/** A finished Anthropic message, back in the Fixer's own vocabulary. */
export function fromAnthropicMessage(msg: Anthropic.Message): {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
} {
  let content = '';
  const toolCalls: ChatToolCall[] = [];
  for (const block of msg.content) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        // Back to a JSON string, because that is what every tool in this
        // codebase expects to parse.
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    // `thinking` blocks are deliberately dropped: the Fixer shows the GM an
    // answer, and reasoning text is not part of the contract the panel renders.
  }
  return { content, toolCalls, finishReason: msg.stop_reason };
}

/**
 * One streamed turn against the Messages API.
 *
 * Throws the same envelope errors the OpenAI transport does, so callers do not
 * have to know which provider answered — an unreachable Anthropic and an
 * unreachable llama.cpp box are the same problem to a GM mid-session.
 */
export async function anthropicChat(
  opts: { apiKey: string; baseUrl?: string | undefined },
  req: ChatRequest,
  chatOpts: ChatOptions = {},
): Promise<ChatTurn> {
  const startedAt = Date.now();
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.baseUrl && opts.baseUrl.length > 0 ? { baseURL: opts.baseUrl } : {}),
    // The SDK retries 429/5xx twice by default, which is what we want; its
    // timeout is in MILLISECONDS, unlike the Python SDK's seconds.
    ...(chatOpts.timeoutMs !== undefined ? { timeout: chatOpts.timeoutMs } : {}),
  });

  const { system, messages } = toAnthropicMessages(req.messages);
  const tools = toAnthropicTools(req);
  const toolChoice = toAnthropicToolChoice(req.tool_choice);

  try {
    const stream = client.messages.stream({
      model: req.model,
      max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
      ...(system.length > 0 ? { system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      messages,
      ...(chatOpts.signal ? { signal: chatOpts.signal } : {}),
    });

    if (chatOpts.onDelta) {
      const onDelta = chatOpts.onDelta;
      stream.on('text', (delta: string) => onDelta(delta));
    }

    const message = await stream.finalMessage();
    const { content, toolCalls, finishReason } = fromAnthropicMessage(message);

    return {
      content,
      toolCalls,
      finishReason,
      usage: {
        promptTokens: message.usage.input_tokens ?? 0,
        completionTokens: message.usage.output_tokens ?? 0,
        totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
      },
      model: message.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    throw anthropicError(err, req.model);
  }
}

/**
 * Turn an SDK error into the envelope the routes already speak.
 *
 * Most specific first, per the SDK's own guidance — collapsing everything into
 * one class loses the difference between "your key is wrong" (the GM must act)
 * and "rate limited" (wait), which is the whole content of the message.
 */
export function anthropicError(err: unknown, model: string): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return httpError(
      502,
      'llm_unauthorized',
      'Anthropic rejected the API key. Check it in the AI settings.',
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return httpError(
      502,
      'llm_model_not_found',
      `Anthropic has no model named '${model}'. Check the model id in the AI settings.`,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return httpError(502, 'llm_rate_limited', 'Anthropic is rate limiting this key — try again shortly.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return httpError(502, 'llm_unreachable', 'Could not reach Anthropic. Is this machine online?');
  }
  if (err instanceof Anthropic.APIError) {
    return httpError(502, 'llm_error', `Anthropic answered ${err.status}: ${err.message}`);
  }
  return httpError(502, 'llm_error', err instanceof Error ? err.message : 'Anthropic call failed');
}
