/**
 * The OpenAI-compatible client (FR12.13): URL shaping, model slots, SSE
 * re-assembly (content deltas and tool_call fragments split across frames),
 * and the failure modes that must stay legible when the box is off.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  ChatAccumulator,
  LlmClient,
  chatCompletionsUrl,
  isAiEnabled,
  llmConfigFromEnv,
} from '../src/fixer/llm.js';
import { MockLlmServer } from '../src/fixer/mock-llm.js';

const servers: MockLlmServer[] = [];

afterAll(async () => {
  for (const server of servers) await server.close();
});

async function mock(...args: Parameters<typeof MockLlmServer.start>): Promise<MockLlmServer> {
  const server = await MockLlmServer.start(...args);
  servers.push(server);
  return server;
}

describe('configuration', () => {
  it('is disabled without LLM_BASE_URL and never guesses a default', () => {
    expect(llmConfigFromEnv({})).toBeNull();
    expect(llmConfigFromEnv({ LLM_BASE_URL: '   ' })).toBeNull();
    expect(isAiEnabled({ LLM_MODEL_PRIMARY: 'big' })).toBe(false);
  });

  it('falls the fast slot back to primary and trims the base URL', () => {
    const config = llmConfigFromEnv({
      LLM_BASE_URL: 'http://box.lan:8080/',
      LLM_MODEL_PRIMARY: 'big-instruct',
    });
    expect(config).toEqual({
      baseUrl: 'http://box.lan:8080',
      primary: 'big-instruct',
      fast: 'big-instruct',
    });
    const client = new LlmClient(config!);
    expect(client.model('primary')).toBe('big-instruct');
    expect(client.model('fast')).toBe('big-instruct');
  });

  it('builds the chat-completions URL either side of /v1', () => {
    expect(chatCompletionsUrl('http://box.lan:8080')).toBe('http://box.lan:8080/v1/chat/completions');
    expect(chatCompletionsUrl('http://box.lan:8080/v1')).toBe('http://box.lan:8080/v1/chat/completions');
    expect(chatCompletionsUrl('http://box.lan:8080/v1/')).toBe('http://box.lan:8080/v1/chat/completions');
  });
});

describe('stream re-assembly', () => {
  it('merges tool_call fragments by index', () => {
    const acc = new ChatAccumulator();
    acc.push({ model: 'm', choices: [{ delta: { role: 'assistant', content: 'thinking' } }] });
    acc.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'get_encounter', arguments: '{"enc' } },
            ],
          },
        },
      ],
    });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ounterId":"e1"}' } }] } }] });
    acc.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    acc.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });

    expect(acc.content).toBe('thinking');
    expect(acc.finishReason).toBe('tool_calls');
    expect(acc.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(acc.toolCalls()).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_encounter', arguments: '{"encounterId":"e1"}' },
      },
    ]);
  });

  it('streams deltas in order and returns the finished turn', async () => {
    const server = await mock({
      turns: [{ content: 'Two gangers, one drone, and the drone is the problem.' }],
    });
    const client = new LlmClient({ baseUrl: server.baseUrl, primary: 'p', fast: 'f' });
    const chunks: string[] = [];
    const turn = await client.chat(
      { model: 'p', messages: [{ role: 'user', content: 'what is out there?' }] },
      { onDelta: (delta) => chunks.push(delta) },
    );
    expect(chunks.length).toBeGreaterThan(1); // it really streamed
    expect(chunks.join('')).toBe(turn.content);
    expect(turn.content).toContain('drone');
    expect(turn.finishReason).toBe('stop');
    expect(turn.usage.totalTokens).toBeGreaterThan(0);
    expect(turn.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reads a tool call back off the wire', async () => {
    const server = await mock({
      turns: [{ toolCalls: [{ name: 'get_character', arguments: { characterId: 'abc-123' } }] }],
    });
    const client = new LlmClient({ baseUrl: server.baseUrl, primary: 'p', fast: 'f' });
    const turn = await client.chat({ model: 'p', messages: [{ role: 'user', content: 'stats?' }] });
    expect(turn.content).toBe('');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.function.name).toBe('get_character');
    expect(JSON.parse(turn.toolCalls[0]!.function.arguments)).toEqual({ characterId: 'abc-123' });
  });
});

describe('failure modes', () => {
  it('reports an unreachable box as 503 ai_unreachable', async () => {
    const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', primary: 'p', fast: 'f' });
    await expect(
      client.chat({ model: 'p', messages: [{ role: 'user', content: 'hi' }] }, { timeoutMs: 2000 }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'ai_unreachable' });
  });

  it('reports a refusing server as 502 ai_error', async () => {
    const server = await mock({
      responder: () => {
        throw new Error('model not loaded');
      },
    });
    const client = new LlmClient({ baseUrl: server.baseUrl, primary: 'p', fast: 'f' });
    await expect(
      client.chat({ model: 'p', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'ai_error' });
  });
});
