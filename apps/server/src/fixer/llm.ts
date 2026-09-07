/**
 * OpenAI-compatible chat client for the Fixer (FR12.13, D12).
 *
 * Plain `fetch` against `LLM_BASE_URL` + `/v1/chat/completions` — llama.cpp
 * (`llama-server`) or vLLM on the LAN inference box. Streaming SSE always
 * (§15 "AI latency"): deltas relay to the GM's panel as they arrive. Tool
 * calling is OpenAI-style function calling; tool_call deltas are re-assembled
 * by index. Two model slots (`LLM_MODEL_PRIMARY` / `LLM_MODEL_FAST`, FR12.16).
 *
 * Nothing here touches the internet: the only destination is the configured
 * base URL. With `LLM_BASE_URL` unset, `llmConfigFromEnv()` returns null and
 * every AI entry point disables cleanly (NG7 / Principle 5).
 */
import type { AiDialect, AiEffort, AiProvider } from '@safehouse/contracts';
import { anthropicChat } from './anthropic.js';
import { httpError } from '../services/auth.js';

const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Config (env is read per call so tests can flip the switch at runtime)
// ---------------------------------------------------------------------------

export type ModelSlot = 'primary' | 'fast';

export interface LlmConfig {
  /** Base URL of the server, no trailing slash. */
  baseUrl: string;
  /** Big instruct model: conversations, fiction, rules synthesis. */
  primary: string;
  /** Small model: mechanical tasks, live-session work (FR12.16). */
  fast: string;
  /**
   * Which wire shape to speak. Absent means `openai`, which is what every
   * caller meant before there was a choice — so an old config keeps working.
   */
  dialect?: AiDialect;
  /** Which provider a GM picked, for diagnostics and for the panel to name. */
  provider?: AiProvider;
  /** Bearer/x-api-key credential. Absent for a box on the LAN. */
  apiKey?: string;
  /**
   * How hard to think. `default` (or absent) sends nothing and lets the
   * model behave as it always has.
   */
  effort?: AiEffort;
}

/** `null` when `LLM_BASE_URL` is unset/blank — the whole Fixer disables (NG7). */
export function llmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const raw = (env['LLM_BASE_URL'] ?? '').trim();
  if (raw.length === 0) return null;
  const baseUrl = raw.replace(/\/+$/, '');
  const primary = (env['LLM_MODEL_PRIMARY'] ?? '').trim() || 'local-primary';
  const fast = (env['LLM_MODEL_FAST'] ?? '').trim() || primary;
  // `LLM_API_KEY` is optional and always has been implicitly: a box on the LAN
  // takes no credential, and that is still the default posture.
  const apiKey = (env['LLM_API_KEY'] ?? '').trim();
  const dialect: AiDialect = (env['LLM_DIALECT'] ?? '').trim() === 'anthropic' ? 'anthropic' : 'openai';
  return { baseUrl, primary, fast, dialect, ...(apiKey ? { apiKey } : {}) };
}

export function isAiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return llmConfigFromEnv(env) !== null;
}

/** `…/v1/chat/completions`, tolerating a base URL that already ends in `/v1`. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

/**
 * The server's root, with any `/v1` suffix removed.
 *
 * Not every endpoint lives under `/v1`: llama.cpp serves `/props` — the
 * capability report the vision probe reads — at the root, so a base URL
 * written the documented way (ending in `/v1`) turns that into `/v1/props`
 * and a 404. Both spellings have to land in the same place.
 */
export function serverRootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

/** `…/v1/models`, tolerating a base URL that already ends in `/v1`. */
export function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

/** Model ids the box admits to serving. Empty when it will not say. */
export async function listServedModels(baseUrl: string, timeoutMs = 5_000): Promise<string[]> {
  try {
    const res = await fetch(modelsUrl(baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    return body.data
      .map((m) => (typeof m === 'object' && m !== null ? (m as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Does this 4xx mean "no such model" rather than "bad request"?
 *
 * Only consulted for a 400, and only on the body, because a 400 is otherwise
 * a genuinely different problem — a malformed request — and answering it with
 * a list of model names would send the GM somewhere useless.
 */
export function looksLikeUnknownModel(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /model .*not (found|exist)|unknown model|no such model/i.test(body);
}

/**
 * Turn a 404 into the sentence that ends the investigation.
 *
 * A wrong model name is the likeliest thing to break when the box behind
 * `LLM_BASE_URL` changes hands, and the same weights are legitimately called
 * three different things: vLLM answers only to its `--served-model-name`,
 * llama.cpp to its `--alias`, Ollama to `name:tag`. Configure one and meet
 * another and you get a bare 404 whose body — the part that actually says
 * which — lands in `details` where the UI need not show it.
 *
 * So the message names what we asked for AND what the box offers. "LLM
 * responded 404" sends a person to read proxy logs; this sends them to one
 * line of `.env`.
 */
export async function explain404(baseUrl: string, model: string): Promise<string> {
  const served = await listServedModels(baseUrl);
  if (served.length === 0) {
    return `the inference server at ${baseUrl} has no model called "${model}" (404), and would not list what it does serve — check that the base URL points at the server root or its /v1 path`;
  }
  if (served.includes(model)) {
    // The name is right, so the 404 is about the ROUTE, not the model.
    return `the inference server at ${baseUrl} does serve "${model}" but answered 404 — the base URL path is wrong, not the model name`;
  }
  return `the inference server has no model called "${model}" — it serves: ${served.join(', ')}. Set LLM_MODEL_PRIMARY (and LLM_MODEL_FAST) to one of those.`;
}

// ---------------------------------------------------------------------------
// Wire shapes (OpenAI chat-completions subset we actually use)
// ---------------------------------------------------------------------------

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/** A function tool as the API wants it (JSON Schema parameters). */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_tokens?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** One completed assistant turn (text and/or tool calls) + its meter data. */
export interface ChatTurn {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

export interface ChatOptions {
  /** Called with each text delta as it streams (relayed to the GM panel). */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/** Split an SSE body into lines, tolerating chunk boundaries mid-line. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer.replace(/\r$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readUsage(raw: unknown): LlmUsage | null {
  if (!isRecord(raw)) return null;
  const prompt = raw['prompt_tokens'];
  const completion = raw['completion_tokens'];
  const total = raw['total_tokens'];
  const promptTokens = typeof prompt === 'number' ? prompt : 0;
  const completionTokens = typeof completion === 'number' ? completion : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: typeof total === 'number' ? total : promptTokens + completionTokens,
  };
}

/**
 * Re-assembles streamed chunks into one turn. Tool-call fragments arrive as
 * `{ index, id?, function: { name?, arguments? } }` and are merged by index —
 * argument JSON commonly spans many deltas.
 */
export class ChatAccumulator {
  content = '';
  finishReason: string | null = null;
  usage: LlmUsage | null = null;
  model = '';
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  /** Feed one parsed `data:` chunk; returns the text delta it carried (if any). */
  push(chunk: unknown): string {
    if (!isRecord(chunk)) return '';
    if (typeof chunk['model'] === 'string' && chunk['model'].length > 0) this.model = chunk['model'];
    const usage = readUsage(chunk['usage']);
    if (usage && usage.totalTokens > 0) this.usage = usage;
    const choices = chunk['choices'];
    if (!Array.isArray(choices) || choices.length === 0) return '';
    const choice = choices[0];
    if (!isRecord(choice)) return '';
    if (typeof choice['finish_reason'] === 'string') this.finishReason = choice['finish_reason'];
    // Non-streaming responses put the whole turn under `message`.
    const delta = isRecord(choice['delta'])
      ? choice['delta']
      : isRecord(choice['message'])
        ? choice['message']
        : null;
    if (!delta) return '';
    let text = '';
    if (typeof delta['content'] === 'string') text = delta['content'];
    this.content += text;
    const toolCalls = delta['tool_calls'];
    if (Array.isArray(toolCalls)) {
      for (let i = 0; i < toolCalls.length; i++) {
        const raw = toolCalls[i];
        if (!isRecord(raw)) continue;
        const index = typeof raw['index'] === 'number' ? raw['index'] : i;
        const entry = this.calls.get(index) ?? { id: '', name: '', args: '' };
        if (typeof raw['id'] === 'string' && raw['id'].length > 0) entry.id = raw['id'];
        const fn = raw['function'];
        if (isRecord(fn)) {
          if (typeof fn['name'] === 'string' && fn['name'].length > 0) entry.name = fn['name'];
          if (typeof fn['arguments'] === 'string') entry.args += fn['arguments'];
        }
        this.calls.set(index, entry);
      }
    }
    return text;
  }

  toolCalls(): ChatToolCall[] {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        id: call.id.length > 0 ? call.id : `call_${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args.length > 0 ? call.args : '{}' },
      }));
  }
}

// ---------------------------------------------------------------------------
// Client
/**
 * The reasoning knob, for a Chat Completions server.
 *
 * TWO knobs, because the hosted providers and a local box do not share one.
 * OpenAI and xAI read `reasoning_effort`. A llama.cpp router accepts that
 * field, returns 200, and ignores it completely — measured: identical
 * reasoning length with and without. What actually moves the number there is
 * the chat template's own `enable_thinking`, which is a boolean, so a local
 * model gets thinking on or off and nothing in between.
 *
 * Both are sent. A server that does not know a field ignores it, which is the
 * behaviour we are relying on either way, and sending the pair means one
 * setting works on all three without the GM having to know which is which.
 */
export function openAiEffort(config: LlmConfig): Record<string, unknown> {
  const effort = config.effort ?? 'default';
  if (effort === 'default') return {};
  if (effort === 'off') {
    // `minimal` is OpenAI's floor; `enable_thinking: false` is what a Qwen
    // template on llama.cpp reads. Neither upsets a server that has no idea
    // what it is.
    return {
      reasoning_effort: 'minimal',
      chat_template_kwargs: { enable_thinking: false },
    };
  }
  return { reasoning_effort: effort, chat_template_kwargs: { enable_thinking: true } };
}

// ---------------------------------------------------------------------------

export class LlmClient {
  constructor(readonly config: LlmConfig) {}

  /** Build from env, or null when the Fixer is disabled (NG7). */
  static fromEnv(env: Record<string, string | undefined> = process.env): LlmClient | null {
    const config = llmConfigFromEnv(env);
    return config ? new LlmClient(config) : null;
  }

  model(slot: ModelSlot = 'primary'): string {
    return slot === 'fast' ? this.config.fast : this.config.primary;
  }

  /**
   * One streamed chat completion. Throws an envelope error when unreachable.
   *
   * Dispatches on the DIALECT, not the provider: OpenAI, xAI and every local
   * server share this path and differ only in host, key and model name, while
   * Anthropic's Messages API is a genuinely different wire format. Callers
   * never learn which one answered — an agent loop, a tool and a usage meter
   * all read the same `ChatTurn` either way, which is the entire point of
   * doing the translation here rather than in twenty places.
   */
  async chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatTurn> {
    if (this.config.dialect === 'anthropic') {
      return anthropicChat(
        {
          apiKey: this.config.apiKey ?? '',
          baseUrl: this.config.baseUrl,
          effort: this.config.effort,
        },
        req,
        opts,
      );
    }
    return this.chatOpenAi(req, opts);
  }

  /** The Chat Completions path — OpenAI, xAI, and anything self-hosted. */
  private async chatOpenAi(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatTurn> {
    const startedAt = Date.now();
    const signals: AbortSignal[] = [AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)];
    if (opts.signal) signals.push(opts.signal);
    const body = JSON.stringify({
      ...req,
      ...openAiEffort(this.config),
      stream: true,
      stream_options: { include_usage: true },
    });

    let res: Response;
    try {
      res = await fetch(chatCompletionsUrl(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          // A hosted provider needs a bearer; a box on the LAN takes none, and
          // sending an empty one is worse than sending nothing — some servers
          // reject the header rather than ignore it.
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body,
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      throw httpError(
        503,
        'ai_unreachable',
        `the inference box at ${this.config.baseUrl} did not answer`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // A wrong model name is the likeliest misconfiguration, and servers do
      // not agree on how to say so: llama.cpp's router answers 400 with
      // "model 'x' not found" in the body where vLLM answers 404. Matching on
      // the status alone sent a GM the raw JSON of the one error we know how
      // to explain, so the body is consulted too.
      if (res.status === 404 || looksLikeUnknownModel(res.status, text)) {
        // Worth a round-trip: ask the box what it DOES serve and say so.
        throw httpError(
          502,
          'ai_error',
          await explain404(this.config.baseUrl, req.model),
          text.slice(0, 500),
        );
      }
      throw httpError(502, 'ai_error', `LLM responded ${res.status}`, text.slice(0, 500));
    }
    if (!res.body) throw httpError(502, 'ai_error', 'LLM response carried no body');

    const acc = new ChatAccumulator();
    for await (const line of sseLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data.length === 0) continue;
      if (data === '[DONE]') break;
      let chunk: unknown;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // a partial/garbled frame is not worth killing the turn over
      }
      const delta = acc.push(chunk);
      if (delta.length > 0 && opts.onDelta) opts.onDelta(delta);
    }

    return {
      content: acc.content,
      toolCalls: acc.toolCalls(),
      finishReason: acc.finishReason,
      usage: acc.usage ?? { ...ZERO_USAGE },
      model: acc.model.length > 0 ? acc.model : req.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}
