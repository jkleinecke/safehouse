/**
 * A mock inference box (BUILD_CONVENTIONS "Server architecture").
 *
 * Speaks the same OpenAI-compatible chat-completions API as llama.cpp/vLLM,
 * over real HTTP with real SSE framing, so the agent loop under test exercises
 * the actual client: chunked content deltas, tool_call fragments split across
 * frames, a usage frame, `[DONE]`.
 *
 * Scriptable two ways: a queue of canned turns (`queue`), or a responder
 * function that sees the request — which is how the tool-loop test asserts the
 * model's second turn actually read the first turn's tool result.
 *
 * Tests only; nothing imports it at runtime.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatMessage } from './llm.js';

export interface MockToolCall {
  name: string;
  arguments?: Record<string, unknown> | string;
  id?: string;
}

/** One scripted assistant turn: text, tool calls, or both. */
export interface MockTurn {
  content?: string;
  toolCalls?: MockToolCall[];
  usage?: { promptTokens?: number; completionTokens?: number };
  model?: string;
  /** Milliseconds to stall before the first frame (latency-meter tests). */
  delayMs?: number;
}

export interface MockChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }>;
  tool_choice?: unknown;
  stream?: boolean;
  temperature?: number;
}

export type MockResponder = (req: MockChatRequest) => MockTurn | Promise<MockTurn>;

const CONTENT_CHUNK = 7;

function sse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunkFrame(model: string, delta: Record<string, unknown>, finish: string | null): unknown {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function argumentsOf(call: MockToolCall): string {
  if (typeof call.arguments === 'string') return call.arguments;
  return JSON.stringify(call.arguments ?? {});
}

export class MockLlmServer {
  /** Every chat request the loop sent, in order. */
  readonly requests: MockChatRequest[] = [];
  private readonly turns: MockTurn[] = [];
  private responder: MockResponder | null = null;

  private constructor(
    private readonly server: Server,
    private readonly port: number,
  ) {}

  static async start(
    opts: { turns?: MockTurn[]; responder?: MockResponder } = {},
  ): Promise<MockLlmServer> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const mock = new MockLlmServer(server, address.port);
    if (opts.turns) mock.queue(...opts.turns);
    if (opts.responder) mock.respondWith(opts.responder);
    server.on('request', (req, res) => {
      void mock.handle(req, res);
    });
    return mock;
  }

  /** Point `LLM_BASE_URL` here. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  queue(...turns: MockTurn[]): this {
    this.turns.push(...turns);
    return this;
  }

  respondWith(fn: MockResponder): this {
    this.responder = fn;
    return this;
  }

  lastRequest(): MockChatRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  /** Tool results the loop fed back, newest last (test assertions). */
  toolResults(): ChatMessage[] {
    const last = this.lastRequest();
    return (last?.messages ?? []).filter((m) => m.role === 'tool');
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-primary' }, { id: 'mock-fast' }] }));
      return;
    }
    if (req.method !== 'POST' || !url.includes('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `no mock route for ${req.method} ${url}` } }));
      return;
    }

    const body = await readBody(req);
    let parsed: MockChatRequest;
    try {
      parsed = JSON.parse(body) as MockChatRequest;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad json' } }));
      return;
    }
    this.requests.push(parsed);

    let turn: MockTurn;
    try {
      turn = this.responder
        ? await this.responder(parsed)
        : (this.turns.shift() ?? { content: 'MOCK: nothing scripted for this turn.' });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }));
      return;
    }
    if (turn.delayMs && turn.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, turn.delayMs));
    }

    const model = turn.model ?? parsed.model ?? 'mock-model';
    if (parsed.stream === false) {
      this.sendJson(res, model, turn);
      return;
    }
    this.sendStream(res, model, turn);
  }

  private sendJson(res: ServerResponse, model: string, turn: MockTurn): void {
    const toolCalls = (turn.toolCalls ?? []).map((call, i) => ({
      id: call.id ?? `call_mock_${i}`,
      type: 'function',
      function: { name: call.name, arguments: argumentsOf(call) },
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: turn.content ?? null,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          },
        ],
        usage: usageFrame(turn),
      }),
    );
  }

  private sendStream(res: ServerResponse, model: string, turn: MockTurn): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    sse(res, chunkFrame(model, { role: 'assistant', content: '' }, null));

    const content = turn.content ?? '';
    for (let i = 0; i < content.length; i += CONTENT_CHUNK) {
      sse(res, chunkFrame(model, { content: content.slice(i, i + CONTENT_CHUNK) }, null));
    }

    const toolCalls = turn.toolCalls ?? [];
    for (let index = 0; index < toolCalls.length; index++) {
      const call = toolCalls[index]!;
      const args = argumentsOf(call);
      const split = Math.ceil(args.length / 2);
      sse(
        res,
        chunkFrame(
          model,
          {
            tool_calls: [
              {
                index,
                id: call.id ?? `call_mock_${index}`,
                type: 'function',
                function: { name: call.name, arguments: args.slice(0, split) },
              },
            ],
          },
          null,
        ),
      );
      // Second fragment carries only the argument tail — exactly how real
      // servers stream long JSON arguments.
      sse(
        res,
        chunkFrame(model, { tool_calls: [{ index, function: { arguments: args.slice(split) } }] }, null),
      );
    }

    sse(res, chunkFrame(model, {}, toolCalls.length > 0 ? 'tool_calls' : 'stop'));
    sse(res, {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      model,
      choices: [],
      usage: usageFrame(turn),
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

function usageFrame(turn: MockTurn): Record<string, number> {
  const prompt = turn.usage?.promptTokens ?? 128;
  const completion = turn.usage?.completionTokens ?? Math.max(1, Math.ceil((turn.content ?? '').length / 4));
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}
