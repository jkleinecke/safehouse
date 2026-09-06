/**
 * Choosing an AI at runtime (FR12.13, D12).
 *
 * Three things are worth pinning here, and only one of them is "does it save".
 *
 * THE KEY MUST NOT COME BACK. `readAiSettings` is what a route hands to the
 * GM's browser. A secret that round-trips through a settings GET ends up in a
 * query cache, a log line and a screenshot, so the read path reports only
 * whether a key is on file — and there must be no shape at all that carries it
 * toward a response body.
 *
 * OFF MUST MEAN OFF. The env var is still a supported way to bring a server up
 * pointing somewhere. A GM who switches the AI off and finds it still running
 * against `LLM_BASE_URL` has been ignored, which is worse than a broken
 * feature.
 *
 * THE TRANSLATION HAS TO BE FAITHFUL. Anthropic's Messages API is a different
 * wire format, not a different host: system prompts leave the message list,
 * tool results change role, and arguments change type. Every one of those is a
 * silent wrong answer if it is got wrong, not a crash.
 */
import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, AiProviderSchema, aiProviderInfo } from '@safehouse/contracts';
import {
  applyAiSettings,
  readAiSettings,
  resolveLlmConfig,
} from '../src/fixer/providers.js';
import {
  fromAnthropicMessage,
  toAnthropicMessages,
  toAnthropicToolChoice,
} from '../src/fixer/anthropic.js';
import type { ChatMessage } from '../src/fixer/llm.js';

/** No environment at all, for the cases that must not consult one. */
const NO_ENV: Record<string, string | undefined> = {};
const LOCAL_ENV = { LLM_BASE_URL: 'http://box.lan:8080', LLM_MODEL_PRIMARY: 'big' };

describe('the provider catalogue', () => {
  it('has an entry for every provider the schema allows', () => {
    // The two are read by different halves of the app; a provider in one and
    // not the other is a dropdown entry that resolves to nothing.
    expect(AI_PROVIDERS.map((p) => p.id).sort()).toEqual(
      [...AiProviderSchema.options].sort(),
    );
  });

  it('gives every hosted provider a home and every local one a blank', () => {
    for (const p of AI_PROVIDERS) {
      if (p.needsKey) {
        expect(p.baseUrl).toMatch(/^https:\/\//);
        expect(p.defaults.primary.length).toBeGreaterThan(0);
      } else {
        // `off` and the escape hatch are defined by the GM, not by us.
        expect(p.baseUrl).toBe('');
      }
    }
  });

  it('routes Anthropic to its own dialect and everyone else to Chat Completions', () => {
    expect(aiProviderInfo('anthropic').dialect).toBe('anthropic');
    for (const id of ['openai', 'xai', 'openai-compatible'] as const) {
      expect(aiProviderInfo(id).dialect).toBe('openai');
    }
  });
});

describe('the API key never leaves the server', () => {
  it('reports that a key exists without saying what it is', () => {
    const saved = applyAiSettings({}, { provider: 'anthropic', apiKey: 'sk-ant-secret' });
    const view = readAiSettings(saved);
    expect(view.hasKey).toBe(true);
    // The blunt version of the assertion: the secret is nowhere in the object.
    expect(JSON.stringify(view)).not.toContain('sk-ant-secret');
  });

  it('leaves a stored key alone when a save omits it', () => {
    // So a GM can change models without re-typing a secret they cannot see.
    const first = applyAiSettings({}, { provider: 'anthropic', apiKey: 'sk-keep' });
    const second = applyAiSettings(first, { primaryModel: 'claude-sonnet-5' });
    expect(readAiSettings(second).hasKey).toBe(true);
    expect(resolveLlmConfig(second, NO_ENV)?.apiKey).toBe('sk-keep');
  });

  it('clears it on an explicitly empty one', () => {
    // A blank field and an absent field are different values on the wire, and
    // this is the only way to forget a key.
    const first = applyAiSettings({}, { provider: 'anthropic', apiKey: 'sk-drop' });
    const second = applyAiSettings(first, { apiKey: '' });
    expect(readAiSettings(second).hasKey).toBe(false);
  });

  it('drops it when the provider changes', () => {
    // Credentials are not portable between vendors. Keeping one quietly on
    // file produces a 401 the GM has no way to explain.
    const first = applyAiSettings({}, { provider: 'anthropic', apiKey: 'sk-ant' });
    const second = applyAiSettings(first, { provider: 'openai' });
    expect(readAiSettings(second).hasKey).toBe(false);
  });
});

describe('resolving what to call', () => {
  it('prefers the GM’s choice over the environment', () => {
    // Inverted from the usual precedence on purpose: the operator and the user
    // are the same person at the same laptop, and the thing they touched last
    // is the thing they meant.
    const saved = applyAiSettings({}, { provider: 'anthropic', apiKey: 'sk', primaryModel: 'claude-opus-5' });
    const config = resolveLlmConfig(saved, LOCAL_ENV);
    expect(config?.dialect).toBe('anthropic');
    expect(config?.baseUrl).toBe('https://api.anthropic.com');
    expect(config?.primary).toBe('claude-opus-5');
  });

  it('falls back to the environment when nothing has been chosen', () => {
    // Which is every deployment that exists today.
    const config = resolveLlmConfig({}, LOCAL_ENV);
    expect(config?.baseUrl).toBe('http://box.lan:8080');
    expect(config?.dialect).toBe('openai');
  });

  it('means OFF even when the environment points somewhere', () => {
    const saved = applyAiSettings({}, { provider: 'off' });
    expect(resolveLlmConfig(saved, LOCAL_ENV)).toBeNull();
  });

  it('refuses a hosted provider with no key rather than calling it unauthenticated', () => {
    const saved = applyAiSettings({}, { provider: 'openai', primaryModel: 'gpt-5' });
    expect(resolveLlmConfig(saved, NO_ENV)).toBeNull();
    expect(readAiSettings(saved).ready).toBe(false);
  });

  it('takes the GM’s own host for a local box, and only for a local box', () => {
    const local = applyAiSettings({}, {
      provider: 'openai-compatible',
      baseUrl: 'http://tower.lan:11434/v1/',
      primaryModel: 'llama',
    });
    expect(resolveLlmConfig(local, NO_ENV)?.baseUrl).toBe('http://tower.lan:11434/v1');

    // A stale host left over from the escape hatch must not follow the GM to a
    // named provider — that would send an Anthropic key to a stranger.
    const hosted = applyAiSettings(local, { provider: 'anthropic', apiKey: 'sk' });
    expect(resolveLlmConfig(hosted, NO_ENV)?.baseUrl).toBe('https://api.anthropic.com');
  });

  it('falls the fast slot back to the primary model', () => {
    const saved = applyAiSettings({}, { provider: 'openai', apiKey: 'sk', primaryModel: 'gpt-5' });
    const config = resolveLlmConfig(saved, NO_ENV);
    expect(config?.fast).toBe('gpt-5');
  });

  it('survives a settings blob that is nonsense', () => {
    // Stored jsonb is not a promise about its own shape.
    expect(() => resolveLlmConfig({ ai: 'not an object' }, NO_ENV)).not.toThrow();
    expect(readAiSettings({ ai: 42 }).provider).toBe('off');
  });
});

describe('translating to the Messages API', () => {
  it('lifts system prompts out of the message list', () => {
    // The single biggest shape difference: Anthropic takes the system prompt
    // as a top-level field. Left in the list it is a 400, or worse, ignored.
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'You are the Fixer.' },
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Who runs the docks?' },
    ]);
    expect(system).toBe('You are the Fixer.\n\nBe terse.');
    expect(messages).toEqual([{ role: 'user', content: 'Who runs the docks?' }]);
  });

  it('turns a tool call into a block and its arguments into an object', () => {
    // Chat Completions carries arguments as a JSON STRING; Anthropic wants the
    // parsed object. Passing the string through is accepted and then ignored.
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'find them' },
      {
        role: 'assistant',
        content: 'Looking.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"docks"}' } },
        ],
      },
    ]);
    const assistant = messages[1] as { role: string; content: unknown[] };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toEqual([
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'docks' } },
    ]);
  });

  it('gathers every tool result for a turn into one user message', () => {
    // Splitting them is accepted and teaches the model to stop calling tools
    // in parallel — the same trap the OpenAI side has.
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'go' },
      { role: 'tool', content: 'a', tool_call_id: 'call_1' },
      { role: 'tool', content: 'b', tool_call_id: 'call_2' },
    ]);
    expect(messages).toHaveLength(2);
    const results = messages[1] as { role: string; content: unknown[] };
    expect(results.role).toBe('user');
    expect(results.content).toHaveLength(2);
  });

  it('does not fold a tool result into somebody’s actual sentence', () => {
    const { messages } = toAnthropicMessages([
      { role: 'tool', content: 'a', tool_call_id: 'call_1' },
      { role: 'user', content: 'and what about the other one' },
      { role: 'tool', content: 'b', tool_call_id: 'call_2' },
    ]);
    // Three messages, not two: merging the second result into the user's own
    // text would misrepresent who said what.
    expect(messages).toHaveLength(3);
  });

  it('survives tool arguments that are not valid JSON', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c', type: 'function', function: { name: 'x', arguments: 'not json' } },
        ],
      },
    ] as ChatMessage[]);
    const blocks = (messages[0] as { content: Array<{ input?: unknown }> }).content;
    expect(blocks[0]?.input).toEqual({});
  });

  it('maps tool_choice across two vocabularies that do not line up', () => {
    expect(toAnthropicToolChoice('required')).toEqual({ type: 'any' });
    expect(toAnthropicToolChoice('none')).toEqual({ type: 'none' });
    expect(toAnthropicToolChoice('auto')).toEqual({ type: 'auto' });
    expect(toAnthropicToolChoice(undefined)).toBeUndefined();
  });
});

describe('translating back', () => {
  it('joins text blocks and re-serialises tool arguments', () => {
    const turn = fromAnthropicMessage({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 4 },
      content: [
        { type: 'text', text: 'On it. ' },
        { type: 'text', text: 'Searching.' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'docks' } },
      ],
    } as unknown as Parameters<typeof fromAnthropicMessage>[0]);

    expect(turn.content).toBe('On it. Searching.');
    expect(turn.finishReason).toBe('tool_use');
    // Back to a string, because that is what every tool in this codebase parses.
    expect(turn.toolCalls).toEqual([
      { id: 'tu_1', type: 'function', function: { name: 'search', arguments: '{"q":"docks"}' } },
    ]);
  });

  it('drops thinking blocks rather than showing them as the answer', () => {
    const turn = fromAnthropicMessage({
      content: [
        { type: 'thinking', thinking: 'let me consider the docks' },
        { type: 'text', text: 'Kowloon Sam.' },
      ],
      stop_reason: 'end_turn',
    } as unknown as Parameters<typeof fromAnthropicMessage>[0]);
    expect(turn.content).toBe('Kowloon Sam.');
  });
});
