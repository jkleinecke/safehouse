/**
 * What the AI server says about the models it serves — asked, never assumed.
 *
 * Two things the GM's settings cannot know and the server can:
 *
 * - How long a context the model takes. A local model's window is whatever
 *   the box was started with (a one-click Qwen kit runs 262k; the same model
 *   under llama.cpp might run 32k), and the chat's context curation plans
 *   against it (chat/memory.ts). Guessing low wastes most of the window;
 *   guessing high runs the box out.
 * - Which thinking levels its chat template accepts. Qwen templates take
 *   `low`, `medium`, `xhigh` — not OpenAI's `high` — and an older template
 *   takes none at all; the chat bar offers what is really there.
 *
 * Where each is read, in order:
 *
 *  1. The model's own entry in `/v1/models`. vLLM reports `max_model_len`;
 *     other servers use `context_length`, `max_context_length` or `n_ctx`.
 *     `supported_reasoning_efforts` lists the levels (the one-click kit's
 *     server renders its template once per level and keeps those that change
 *     the prompt, so the list is honest).
 *  2. TabbyAPI's `/v1/model` (`max_seq_len`), then llama.cpp's `/props`
 *     (`n_ctx`) — the window only.
 *
 * `LLM_CONTEXT_TOKENS` overrides the window. A hosted provider is not asked:
 * its windows are large and its levels are the API's own. Answers are cached
 * for a minute, so a GM who reloads the box with a bigger window, or another
 * model, has it used without restarting anything.
 */
import type { LlmConfig } from './llm.js';
import { modelsUrl, serverRootUrl } from './urls.js';

export interface ModelInfo {
  id: string;
  /** Tokens the model can hold, prompt and answer together, when the server says. */
  contextWindow?: number;
  /** The thinking levels its template takes, when the server says; empty means none. */
  efforts?: string[];
}

/** What to assume when the box will not say: a common local default, and Claude's floor. */
const LOCAL_FALLBACK_TOKENS = 32_768;
const HOSTED_FALLBACK_TOKENS = 200_000;
const TTL_MS = 60_000;

/** Ids that are not chat models: embeddings, speech, images, moderation. */
const NOT_CHAT = /embed|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|search|rerank/i;

/** A local server — anything that is not a hosted provider's own API. */
export function isLocalServer(config: Pick<LlmConfig, 'dialect' | 'provider'>): boolean {
  return config.dialect !== 'anthropic' && config.provider !== 'openai' && config.provider !== 'xai';
}

function envOverride(env: Record<string, string | undefined> = process.env): number | null {
  const raw = Number((env['LLM_CONTEXT_TOKENS'] ?? '').trim());
  return Number.isFinite(raw) && raw > 1024 ? Math.floor(raw) : null;
}

function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 1024 ? Math.floor(v) : null;
}

function headersFor(config: LlmConfig): Record<string, string> {
  if (config.dialect === 'anthropic') return { 'x-api-key': config.apiKey ?? '', 'anthropic-version': '2023-06-01' };
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** One `/v1/models` entry, read for what it says about itself. */
export function readModelEntry(raw: unknown): ModelInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const id = m['id'];
  if (typeof id !== 'string' || id.length === 0 || NOT_CHAT.test(id)) return null;
  const meta = (typeof m['meta'] === 'object' && m['meta'] !== null ? m['meta'] : {}) as Record<string, unknown>;
  const window =
    positive(m['max_model_len']) ??
    positive(m['context_length']) ??
    positive(m['max_context_length']) ??
    positive(m['context_window']) ??
    positive(m['n_ctx']) ??
    positive(m['max_seq_len']) ??
    positive(meta['n_ctx']);
  const levels = m['supported_reasoning_efforts'] ?? m['reasoning_efforts'];
  const efforts = Array.isArray(levels) ? levels.filter((l): l is string => typeof l === 'string' && l.length > 0) : null;
  return { id, ...(window ? { contextWindow: window } : {}), ...(efforts ? { efforts } : {}) };
}

const listCache = new Map<string, { models: ModelInfo[]; at: number }>();

/** Every model the server lists, with what each entry says. Empty when it will not say. */
export async function listModelInfo(config: LlmConfig): Promise<ModelInfo[]> {
  const key = `${config.baseUrl}|${config.dialect}|${config.apiKey ? 'k' : ''}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  let models: ModelInfo[] = [];
  try {
    const anthropic = config.dialect === 'anthropic';
    const base = anthropic && config.baseUrl.length === 0 ? 'https://api.anthropic.com' : config.baseUrl;
    const body = (await getJson(`${modelsUrl(base)}${anthropic ? '?limit=100' : ''}`, headersFor(config))) as {
      data?: unknown;
    };
    models = Array.isArray(body.data) ? body.data.map(readModelEntry).filter((m): m is ModelInfo => m !== null) : [];
  } catch {
    // Will not say.
  }
  listCache.set(key, { models, at: Date.now() });
  return models;
}

/** The entry for one model: by id, or the only one a single-model box lists. */
export async function modelInfoFor(config: LlmConfig, model = config.primary): Promise<ModelInfo | null> {
  const all = await listModelInfo(config);
  return all.find((m) => m.id === model) ?? (all.length === 1 ? all[0]! : null);
}

/**
 * The models the chat bar's menu offers, the configured one first — so a
 * server that will not say still offers the one it runs. A hosted provider's
 * entries say nothing of levels; the bar offers the API's own for those.
 */
export async function servedModelsFor(config: LlmConfig): Promise<ModelInfo[]> {
  const all = await listModelInfo(config);
  const configured = all.find((m) => m.id === config.primary) ?? { id: config.primary };
  return [configured, ...all.filter((m) => m.id !== config.primary).sort((a, b) => a.id.localeCompare(b.id))];
}

const windowCache = new Map<string, { tokens: number; at: number }>();

/**
 * The model's context length, in tokens — the whole budget the context
 * curation (chat/memory.ts) plans against, and the ceiling on what a reply
 * may be given room for (`outputRoom`).
 */
export async function contextWindowFor(config: LlmConfig): Promise<number> {
  const forced = envOverride();
  if (forced) return forced;
  if (!isLocalServer(config)) return HOSTED_FALLBACK_TOKENS;
  const key = `${config.baseUrl}|${config.primary}`;
  const hit = windowCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tokens;

  let tokens: number | null = (await modelInfoFor(config))?.contextWindow ?? null;
  const headers = headersFor(config);
  if (tokens === null) {
    try {
      const tabby = (await getJson(`${serverRootUrl(config.baseUrl)}/v1/model`, headers)) as Record<string, unknown>;
      const params = (tabby['parameters'] ?? {}) as Record<string, unknown>;
      tokens = positive(params['max_seq_len']) ?? positive(tabby['max_seq_len']);
    } catch {
      // not TabbyAPI
    }
  }
  if (tokens === null) {
    try {
      const props = (await getJson(`${serverRootUrl(config.baseUrl)}/props`, headers)) as Record<string, unknown>;
      const gen = (props['default_generation_settings'] ?? {}) as Record<string, unknown>;
      tokens = positive(gen['n_ctx']) ?? positive(props['n_ctx']);
    } catch {
      // not llama.cpp either
    }
  }
  const resolved = tokens ?? LOCAL_FALLBACK_TOKENS;
  windowCache.set(key, { tokens: resolved, at: Date.now() });
  return resolved;
}

/** Tokens an image in a request is counted as, whatever its data URL's length. */
const IMAGE_TOKENS = 1_600;
/** Deliberately few characters a token, so the prompt is over-counted and the room under. */
const CHARS_PER_TOKEN = 2;
const ROOM_MARGIN = 512;
const ROOM_FLOOR = 1_024;

/**
 * How many tokens a reply may be given: everything the window has left
 * after the prompt.
 *
 * A local server that is sent no `max_tokens` picks its own, and some pick
 * small — the one-click Qwen kit's default is 1,024, which a model thinking
 * about a floor plan spends before it has called a single tool, and the turn
 * ends with nothing to show. So every request says, and what it says is not a
 * cap of ours but the room there is. The prompt is estimated from the request
 * itself, over-counted on purpose so prompt and reply never outgrow the window.
 */
export function outputRoom(body: unknown, window: number): number {
  let images = 0;
  const text = JSON.stringify(body, (_k, v: unknown) => {
    if (typeof v === 'string' && v.startsWith('data:')) {
      images += 1;
      return '';
    }
    return v;
  });
  const prompt = Math.ceil(text.length / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
  return Math.max(ROOM_FLOOR, window - prompt - ROOM_MARGIN);
}
