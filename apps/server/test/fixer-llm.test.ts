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
  explain404,
  foldSystemMessages,
  isAiEnabled,
  listServedModels,
  llmConfigFromEnv,
  modelsUrl,
  serverRootUrl,
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
      // The env path is the OpenAI-compatible one it has always been; naming
      // the dialect is what lets a runtime-chosen provider be a different one.
      dialect: 'openai',
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

// ---------------------------------------------------------------------------
// The 404 that cost an evening
// ---------------------------------------------------------------------------

/**
 * A wrong model name is what actually breaks when the inference box changes
 * hands, and every server spells the same weights differently: vLLM answers
 * only to its `--served-model-name`, llama.cpp to its `--alias`, Ollama to
 * `name:tag`. Configure one, meet another, get a bare 404 whose explanation
 * sits in a `details` field the UI is free not to render.
 *
 * Pinned here so the message stays useful: it must name the model we asked
 * for AND the models the box says it has.
 */
describe('URL shaping beyond /v1', () => {
  it('finds the server root whether or not the base URL carries a version', () => {
    // llama.cpp's /props lives at the root; the documented base URL ends /v1.
    expect(serverRootUrl('http://box.lan:8080/v1')).toBe('http://box.lan:8080');
    expect(serverRootUrl('http://box.lan:8080/v1/')).toBe('http://box.lan:8080');
    expect(serverRootUrl('http://box.lan:8080')).toBe('http://box.lan:8080');
    expect(serverRootUrl('http://box.lan:8080/')).toBe('http://box.lan:8080');
  });

  it('does not mistake a path segment for a version', () => {
    expect(serverRootUrl('http://box.lan/openai/v1')).toBe('http://box.lan/openai');
    expect(serverRootUrl('http://box.lan/v1beta')).toBe('http://box.lan/v1beta');
  });

  it('builds /v1/models from either spelling', () => {
    expect(modelsUrl('http://box.lan:8080')).toBe('http://box.lan:8080/v1/models');
    expect(modelsUrl('http://box.lan:8080/v1')).toBe('http://box.lan:8080/v1/models');
    expect(modelsUrl('http://box.lan:8080/v1/')).toBe('http://box.lan:8080/v1/models');
  });
});

describe('explain404', () => {
  /** A stand-in for the box's `GET /v1/models`. */
  async function withModels<T>(
    body: unknown,
    status: number,
    fn: (baseUrl: string) => Promise<T>,
  ): Promise<T> {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/v1/models')) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    try {
      return await fn(`http://127.0.0.1:${port}/v1`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  const vllmish = {
    object: 'list',
    data: [{ id: 'qwen3.8-27b', object: 'model', owned_by: 'vllm' }],
  };

  it('lists what the box actually serves', async () => {
    const msg = await withModels(vllmish, 200, (base) =>
      explain404(base, 'unsloth/Qwen3.8-27B-GGUF:Q4_K_M'),
    );
    // Both halves matter: the name that failed, and the name that would work.
    expect(msg).toContain('unsloth/Qwen3.8-27B-GGUF:Q4_K_M');
    expect(msg).toContain('qwen3.8-27b');
    expect(msg).toContain('LLM_MODEL_PRIMARY');
  });

  it('blames the path, not the name, when the model IS served', async () => {
    const msg = await withModels(vllmish, 200, (base) => explain404(base, 'qwen3.8-27b'));
    expect(msg).toContain('base URL path is wrong');
    expect(msg).not.toContain('LLM_MODEL_PRIMARY');
  });

  it('stays honest when the box will not list its models', async () => {
    const msg = await withModels({}, 500, (base) => explain404(base, 'anything'));
    expect(msg).toContain('would not list');
    // No invented advice about a model list we never saw.
    expect(msg).not.toContain('it serves:');
  });

  it('survives a models endpoint that answers with junk', async () => {
    await expect(withModels({ data: 'not-an-array' }, 200, (b) => listServedModels(b))).resolves.toEqual([]);
    await expect(withModels({ data: [{}, { id: 7 }, { id: 'ok' }] }, 200, (b) => listServedModels(b))).resolves.toEqual(['ok']);
  });

  it('returns an empty list rather than throwing when nothing is there', async () => {
    // Port 1 is reserved and refuses instantly; a dead box must not surface as
    // a crash inside an error handler.
    await expect(listServedModels('http://127.0.0.1:1/v1', 1_000)).resolves.toEqual([]);
  });
});

/**
 * A local server renders the request through the model's own Jinja chat
 * template, and some templates allow exactly one system message. The agent
 * builds its instructions in two pieces, so what is legal OpenAI arrived as a
 * 500 with a Jinja stack trace in it — from a healthy box, with a correct
 * request. Measured against Qwen3.8: one system message answers, two raise
 * "System message must be at the beginning".
 */
describe('one system message, at the front', () => {
  it('joins the pieces the agent sends separately', () => {
    const folded = foldSystemMessages([
      { role: 'system', content: 'standing orders' },
      { role: 'system', content: 'the snapshot' },
      { role: 'user', content: 'hello' },
    ]);
    expect(folded).toHaveLength(2);
    expect(folded[0]?.role).toBe('system');
    const text = folded[0]?.content ?? '';
    expect(text).toContain('standing orders');
    expect(text).toContain('the snapshot');
    // Joined in the order written, not whichever way a Set or a map felt like.
    expect(text.indexOf('standing orders')).toBeLessThan(text.indexOf('the snapshot'));
    expect(folded[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('drops blank pieces instead of sending an empty instruction', () => {
    const folded = foldSystemMessages([
      { role: 'system', content: '   ' },
      { role: 'system', content: null },
      { role: 'user', content: 'hi' },
    ]);
    expect(folded.some((m) => m.role === 'system')).toBe(false);
  });

  it('hoists a stray system message rather than losing it', () => {
    // There should never be one mid-history — but moving an instruction is a
    // much smaller lie than quietly deleting it.
    const folded = foldSystemMessages([
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'and be brief' },
    ]);
    expect(folded[0]?.content).toBe('and be brief');
    expect(folded).toHaveLength(2);
  });

  it('leaves a request that already has one alone', () => {
    const messages: Parameters<typeof foldSystemMessages>[0] = [
      { role: 'system', content: 'orders' },
      { role: 'user', content: 'hi' },
    ];
    expect(foldSystemMessages(messages)).toEqual(messages);
  });

  it('never puts a second one on the wire', async () => {
    const server = await mock({ turns: [{ content: 'ok' }] });
    const client = new LlmClient({ baseUrl: server.baseUrl, primary: 'm', fast: 'm' });
    await client.chat({
      model: 'm',
      messages: [
        { role: 'system', content: 'orders' },
        { role: 'system', content: 'snapshot' },
        { role: 'user', content: 'hello' },
      ],
    });
    const sent = server.lastRequest()?.messages ?? [];
    expect(sent.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(sent[0]?.role).toBe('system');
  });
});
