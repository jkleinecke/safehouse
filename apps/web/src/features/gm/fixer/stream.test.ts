import { describe, expect, it } from 'vitest';
import type { FixerChunk } from '../../../live/store.js';
import { reduceFixerStream } from './stream.js';

const chunk = (type: string, payload: unknown, ts = 0): FixerChunk => ({ type, payload, ts });

describe('reduceFixerStream (FR12.1 streaming)', () => {
  it('accumulates deltas into one streaming message', () => {
    const view = reduceFixerStream([
      chunk('fixer.delta', { delta: 'The Johnson ' }, 1),
      chunk('fixer.delta', { delta: 'is lying.' }, 2),
    ]);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]?.text).toBe('The Johnson is lying.');
    expect(view.messages[0]?.done).toBe(false);
    expect(view.streaming).toBe(true);
  });

  it('closes a message on fixer.done and starts a new one after', () => {
    const view = reduceFixerStream([
      chunk('fixer.delta', { delta: 'First.' }, 1),
      chunk('fixer.done', {}, 2),
      chunk('fixer.delta', { delta: 'Second.' }, 3),
    ]);
    expect(view.messages).toHaveLength(2);
    expect(view.messages[0]?.done).toBe(true);
    expect(view.messages[1]?.text).toBe('Second.');
    expect(view.streaming).toBe(true);
  });

  it('turns tool activity into chips and resolves running → done pairs', () => {
    const view = reduceFixerStream([
      chunk('fixer.tool', { name: 'search_books', status: 'start' }, 1),
      chunk('fixer.tool', { name: 'search_books', status: 'end', detail: '3 pages' }, 2),
      chunk('fixer.delta', { delta: 'Per the core book…' }, 3),
      chunk('fixer.done', {}, 4),
    ]);
    const msg = view.messages[0]!;
    expect(msg.chips).toHaveLength(1);
    expect(msg.chips[0]).toEqual({ name: 'search_books', status: 'done', detail: '3 pages' });
  });

  it('collects usage (tokens/latency) per turn and totals across turns', () => {
    const view = reduceFixerStream([
      chunk('fixer.delta', { delta: 'a' }, 1),
      chunk('fixer.done', { usage: { promptTokens: 900, completionTokens: 100, latencyMs: 800 } }, 2),
      chunk('fixer.delta', { delta: 'b' }, 3),
      chunk('fixer.done', { usage: { prompt_tokens: 100, completion_tokens: 50, latency_ms: 400 } }, 4),
    ]);
    expect(view.lastUsage).toEqual({
      promptTokens: 100, completionTokens: 50, totalTokens: 150, latencyMs: 400,
    });
    expect(view.totalUsage.promptTokens).toBe(1000);
    expect(view.totalUsage.completionTokens).toBe(150);
    expect(view.totalUsage.totalTokens).toBe(1150);
    expect(view.totalUsage.latencyMs).toBe(400); // last, not summed
  });

  it('keeps the latest situation snapshot (FR12.18) out of the transcript', () => {
    const view = reduceFixerStream([
      chunk('fixer.snapshot', { text: 'Turn 2, pass 1 — Static up.' }, 1),
      chunk('fixer.delta', { delta: 'Answer.' }, 2),
    ]);
    expect(view.snapshot).toBe('Turn 2, pass 1 — Static up.');
    expect(view.messages[0]?.text).toBe('Answer.');
  });

  it('surfaces fixer.error and stops streaming', () => {
    const view = reduceFixerStream([
      chunk('fixer.delta', { delta: 'partial' }, 1),
      chunk('fixer.error', { message: 'inference box unreachable' }, 2),
    ]);
    expect(view.error).toBe('inference box unreachable');
    expect(view.streaming).toBe(false);
    expect(view.messages[0]?.done).toBe(true);
  });

  it('ignores unknown fixer.* types (forward compatible)', () => {
    const view = reduceFixerStream([chunk('fixer.future', { x: 1 }, 1)]);
    expect(view.messages).toHaveLength(0);
    expect(view.streaming).toBe(false);
  });
});
