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
import { openAiEffort, type LlmConfig, type ModelSlot } from '../llm.js';
import { isLocalServer, outputRoom } from '../model-info.js';

/** The `/v1` root a Chat Completions client appends `/chat/completions` to. */
export function v1Root(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function modelIdFor(config: LlmConfig, slot: ModelSlot): string {
  return slot === 'fast' ? config.fast : config.primary;
}

/**
 * The AI SDK model for one slot of this campaign's configuration. `window` is
 * the model's context length: a local server is told, on every request, how
 * much of it is left for the reply (model-info.ts, `outputRoom`).
 */
export function languageModelFor(config: LlmConfig, slot: ModelSlot = 'primary', window?: number): LanguageModel {
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
  const room = window !== undefined && isLocalServer(config) ? window : undefined;
  return createOpenAICompatible({
    name: config.provider ?? 'local',
    baseURL: v1Root(config.baseUrl),
    // A box on the LAN takes no key, and an empty bearer is worse than none:
    // some servers reject the header rather than ignore it.
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    includeUsage: true,
    // The GM's thinking setting, in the fields a local template reads — sent
    // only when the GM chose something: `default` means "as it always was" —
    // and the room left for the reply, so a server's own small default never
    // cuts a model off mid-thought.
    ...(Object.keys(effort).length > 0 || room !== undefined
      ? {
          transformRequestBody: (body: Record<string, unknown>) => {
            const next = { ...body, ...effort };
            if (room !== undefined && next['max_tokens'] === undefined) next['max_tokens'] = outputRoom(next, room);
            return next;
          },
        }
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
  return { anthropic: { thinking: { type: 'adaptive' }, effort: anthropicLevel(effort) } };
}

/** A level Claude takes: off is low (see above), and a local server's extra levels clamp to the nearest. */
export function anthropicLevel(effort: string): 'low' | 'medium' | 'high' {
  if (effort === 'off' || effort === 'minimal' || effort === 'low') return 'low';
  if (effort === 'medium') return 'medium';
  return 'high';
}

// What the server says about its models — the window, the levels, the list.
export { contextWindowFor, servedModelsFor } from '../model-info.js';
