/**
 * The Fixer chat's curated context (fixer/chat/memory.ts): what the model is
 * handed each turn, against a budget, and where the transcript folds.
 */
import { describe, expect, it } from 'vitest';
import type { ToolSet, UIMessage } from 'ai';
import {
  EMPTY_MEMORY,
  budgetFor,
  buildContext,
  calibrate,
  foldPoint,
  fromLegacy,
  readMemory,
  receipt,
  type ConversationMemory,
} from '../src/fixer/chat/memory.js';

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const fixer = (id: string, text: string, parts: UIMessage['parts'] = []): UIMessage => ({
  id,
  role: 'assistant',
  parts: [...parts, { type: 'text', text }],
});

/** A finished tool call, as the SDK stores it on an assistant message. */
const toolCall = (name: string, output: unknown): UIMessage['parts'][number] =>
  ({
    type: `tool-${name}`,
    toolCallId: `call-${name}-${Math.random()}`,
    state: 'output-available',
    input: { id: 'x' },
    output,
  }) as unknown as UIMessage['parts'][number];

const memory = (over: Partial<ConversationMemory> = {}): ConversationMemory => ({ ...EMPTY_MEMORY, files: {}, ...over });

const base = {
  instructions: 'You are the Fixer.',
  tools: {} as ToolSet,
  toolChars: 0,
  vision: false,
  loadImage: async () => null,
};

describe('the budget', () => {
  it('keeps room for the answer out of the prompt', () => {
    const b = budgetFor(32_768);
    expect(b.window).toBe(32_768);
    expect(b.prompt).toBe(32_768 - 6_553);
    // A big hosted window keeps at most 8k back.
    expect(budgetFor(200_000).prompt).toBe(200_000 - 8_192);
  });

  it('learns the chars-per-token ratio slowly, and ignores nonsense', () => {
    const m = memory();
    const next = calibrate(m, 40_000, 10_000); // observed 4.0 against 3.5
    expect(next.charsPerToken).toBeCloseTo(3.65, 2);
    expect(calibrate(m, 40_000, undefined)).toBe(m);
    expect(calibrate(m, 100, 10)).toBe(m);
  });
});

describe('what goes in', () => {
  it('puts the brief and small files in the instructions', async () => {
    const built = await buildContext({
      ...base,
      messages: [user('u1', 'hi')],
      memory: memory({
        brief: 'Decisions:\n- the clinic has a locked store',
        files: { f1: { id: 'f1', name: 'notes.txt', mediaType: 'text/plain', kind: 'text', text: 'the fixer is called Rook', tokens: 8 } },
      }),
      budget: budgetFor(32_768),
    });
    expect(built.instructions).toContain('SESSION BRIEF');
    expect(built.instructions).toContain('the clinic has a locked store');
    expect(built.instructions).toContain('the fixer is called Rook');
  });

  it('names a big file instead of carrying it', async () => {
    const built = await buildContext({
      ...base,
      messages: [user('u1', 'hi')],
      memory: memory({
        files: { f1: { id: 'f1', name: 'book.txt', mediaType: 'text/plain', kind: 'text', text: 'x'.repeat(50_000), tokens: 14_000 } },
      }),
      budget: budgetFor(32_768),
    });
    expect(built.instructions).toContain('book.txt: 14000 tokens');
    expect(built.instructions).not.toContain('x'.repeat(100));
  });

  it('starts the verbatim tail where the brief leaves off', async () => {
    const messages = [user('u1', 'first'), fixer('a1', 'one'), user('u2', 'second'), fixer('a2', 'two'), user('u3', 'third')];
    const built = await buildContext({ ...base, messages, memory: memory({ foldedCount: 2 }), budget: budgetFor(32_768) });
    const text = JSON.stringify(built.messages);
    expect(text).not.toContain('first');
    expect(text).toContain('second');
    expect(text).toContain('third');
  });

  it('shrinks old tool calls to receipts and keeps recent ones whole', async () => {
    const big = { rows: 'r'.repeat(2_000) };
    const messages = [
      user('u1', 'old question'),
      fixer('a1', 'old answer', [toolCall('get_scene', big)]),
      user('u2', 'q2'),
      fixer('a2', 'a2'),
      user('u3', 'q3'),
      fixer('a3', 'recent answer', [toolCall('get_npc', big)]),
      user('u4', 'now'),
    ];
    const built = await buildContext({ ...base, messages, memory: memory(), budget: budgetFor(200_000) });
    const text = JSON.stringify(built.messages);
    expect(text).toContain('[earlier: get_scene(');
    // The recent call went as a real tool call with its whole output.
    expect(text).toContain('get_npc');
    // Exactly one whole output went: the recent one. The old one is a receipt.
    expect(text.split('r'.repeat(2_000)).length - 1).toBe(1);
  });

  it('asks for a fold once the tail passes the soft line', async () => {
    const long = 'word '.repeat(4_000);
    const messages = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? user(`u${i}`, long) : fixer(`a${i}`, long)));
    const built = await buildContext({ ...base, messages, memory: memory(), budget: budgetFor(32_768) });
    expect(built.shouldFold).toBe(true);
  });

  it('leaves out the oldest turns of this request when nothing else fits, never the new message', async () => {
    const huge = 'word '.repeat(30_000);
    const messages = [user('u1', huge), fixer('a1', huge), user('u2', 'the question')];
    const built = await buildContext({ ...base, messages, memory: memory(), budget: budgetFor(32_768) });
    expect(built.dropped).toBe(2);
    expect(JSON.stringify(built.messages)).toContain('the question');
  });
});

describe('folding', () => {
  it('folds the older half, ending before a GM message', () => {
    const messages = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? user(`u${i}`, 'q') : fixer(`a${i}`, 'a')));
    const end = foldPoint(messages, memory())!;
    expect(end).toBe(6);
    expect(messages[end]!.role).toBe('user');
  });

  it('does not fold a short tail', () => {
    const messages = [user('u1', 'q'), fixer('a1', 'a'), user('u2', 'q')];
    expect(foldPoint(messages, memory())).toBeNull();
  });
});

describe('older rows', () => {
  it('reads an empty or foreign memory column as empty', () => {
    expect(readMemory({})).toEqual({ ...EMPTY_MEMORY, files: {} });
    expect(readMemory(null).foldedCount).toBe(0);
    expect(readMemory({ foldedCount: 4, brief: 'b', charsPerToken: 99 }).charsPerToken).toBe(3.5);
  });

  it('keeps the words of a pre-SDK conversation and drops its tool plumbing', () => {
    const legacy = [
      { role: 'user', content: 'what is Static on?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c', content: '{}' },
      { role: 'assistant', content: 'Static is on 6 physical.' },
    ];
    const ui = fromLegacy(legacy);
    expect(ui.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(ui)).toContain('Static is on 6 physical.');
  });

  it('writes a receipt a model can read in one line', () => {
    const line = receipt(toolCall('get_scene', { name: 'Clinic' }));
    expect(line).toMatch(/^\[earlier: get_scene\(\{"id":"x"\}\) → \{"name":"Clinic"\}\]$/);
  });
});
