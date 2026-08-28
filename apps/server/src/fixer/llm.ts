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
import { httpError } from '../services/auth.js';

const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Config (env is read per call so tests can flip the switch at runtime)
// ---------------------------------------------------------------------------

export type ModelSlot = 'primary' | 'fast';

export interface LlmConfig {
  /** Base URL of the OpenAI-compatible server, no trailing slash. */
  baseUrl: string;
  /** Big instruct model: conversations, fiction, rules synthesis. */
  primary: string;
  /** Small model: mechanical tasks, live-session work (FR12.16). */
  fast: string;
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
  return { baseUrl, primary, fast };
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

  /** One streamed chat completion. Throws an envelope error when unreachable. */
  async chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatTurn> {
    const startedAt = Date.now();
    const signals: AbortSignal[] = [AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)];
    if (opts.signal) signals.push(opts.signal);
    const body = JSON.stringify({ ...req, stream: true, stream_options: { include_usage: true } });

    let res: Response;
    try {
      res = await fetch(chatCompletionsUrl(this.config.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
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
