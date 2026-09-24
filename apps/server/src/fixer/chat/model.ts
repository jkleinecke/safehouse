/**
 * The model the Fixer chat talks to, as an AI SDK `LanguageModel` — built from
 * the same `LlmConfig` every other lane reads, so the GM's AI settings page
 * still decides everything: which box, which model in which slot, the key,
 * and how hard it thinks.
 *
 * Two wire shapes, as before (fixer/llm.ts): Anthropic's Messages API, and
 * the Chat Completions shape spoken by OpenAI, xAI and every self-hosted
 * server (llama.cpp, TabbyAPI, vLLM, LM Studio). The effort setting rides
 * along the same way it always has — `chat_template_kwargs` (`enable_thinking`
 * and the level) for a Qwen-style template, adaptive thinking for Claude — so moving the
 * chat onto the SDK changes nothing a GM can see in their settings.
 *
 * Nothing here touches the internet on its own: the only destination is the
 * configured base URL.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { openAiEffort, serverRootUrl, type LlmConfig, type ModelSlot } from '../llm.js';

/** The `/v1` root a Chat Completions client appends `/chat/completions` to. */
export function v1Root(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function modelIdFor(config: LlmConfig, slot: ModelSlot): string {
  return slot === 'fast' ? config.fast : config.primary;
}

/** The AI SDK model for one slot of this campaign's configuration. */
export function languageModelFor(config: LlmConfig, slot: ModelSlot = 'primary'): LanguageModel {
  const id = modelIdFor(config, slot);
  if (config.dialect === 'anthropic') {
    return createAnthropic({
      apiKey: config.apiKey ?? '',
      ...(config.baseUrl.length > 0 && !/api\.anthropic\.com/.test(config.baseUrl)
        ? { baseURL: v1Root(config.baseUrl) }
        : {}),
    })(id);
  }
  const effort = openAiEffort(config);
  return createOpenAICompatible({
    name: config.provider ?? 'local',
    baseURL: v1Root(config.baseUrl),
    // A box on the LAN takes no key, and an empty bearer is worse than none:
    // some servers reject the header rather than ignore it.
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    includeUsage: true,
    // The GM's thinking setting, in the fields a local template reads. Sent
    // only when the GM chose something: `default` means "as it always was".
    ...(Object.keys(effort).length > 0
      ? { transformRequestBody: (body: Record<string, unknown>) => ({ ...body, ...effort }) }
      : {}),
  }).chatModel(id);
}

/**
 * Claude's reasoning controls as provider options. "Off" asks for LOW effort
 * with thinking on — see `anthropicEffort` in fixer/anthropic.ts for why a
 * tool-calling agent must never have its thinking switched off entirely.
 */
export function providerOptionsFor(config: LlmConfig): Record<string, Record<string, unknown>> | undefined {
  if (config.dialect !== 'anthropic') return undefined;
  const effort = config.effort ?? 'default';
  if (effort === 'default') return undefined;
  return { anthropic: { thinking: { type: 'adaptive' }, effort: effort === 'off' ? 'low' : effort } };
}

// ---------------------------------------------------------------------------
// How much the model can read
// ---------------------------------------------------------------------------

/** What to assume when the box will not say: a common local default, and Claude's floor. */
const LOCAL_FALLBACK_TOKENS = 32_768;
const HOSTED_FALLBACK_TOKENS = 200_000;

const windowCache = new Map<string, { tokens: number; at: number }>();
const WINDOW_TTL_MS = 10 * 60_000;

function envOverride(env: Record<string, string | undefined> = process.env): number | null {
  const raw = Number((env['LLM_CONTEXT_TOKENS'] ?? '').trim());
  return Number.isFinite(raw) && raw > 1024 ? Math.floor(raw) : null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 1024 ? Math.floor(v) : null;
}

/**
 * The model's context length, in tokens — the whole budget the context
 * curation (memory.ts) plans against.
 *
 * Asked of the box, because a local model's window is whatever the GM loaded
 * it with and nothing in our settings knows it: TabbyAPI answers
 * `/v1/model` with `max_seq_len`; llama.cpp answers `/props` with `n_ctx`.
 * `LLM_CONTEXT_TOKENS` overrides both. A hosted provider is assumed large.
 * Cached for ten minutes — a GM reloading the model with a bigger window
 * should not wait for a restart to have it used.
 */
export async function contextWindowFor(config: LlmConfig): Promise<number> {
  const forced = envOverride();
  if (forced) return forced;
  if (config.dialect === 'anthropic' || config.provider === 'openai' || config.provider === 'xai') {
    return HOSTED_FALLBACK_TOKENS;
  }
  const key = `${config.baseUrl}|${config.primary}`;
  const hit = windowCache.get(key);
  if (hit && Date.now() - hit.at < WINDOW_TTL_MS) return hit.tokens;

  let tokens: number | null = null;
  try {
    const tabby = (await getJson(`${v1Root(config.baseUrl)}/model`)) as Record<string, unknown>;
    const params = (tabby['parameters'] ?? {}) as Record<string, unknown>;
    tokens = positive(params['max_seq_len']) ?? positive(tabby['max_seq_len']);
  } catch {
    // not TabbyAPI
  }
  if (tokens === null) {
    try {
      const props = (await getJson(`${serverRootUrl(config.baseUrl)}/props`)) as Record<string, unknown>;
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
