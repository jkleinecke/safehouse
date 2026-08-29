import { describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import { codexEventEffects } from './live.js';

let nextId = 0;
function ev(type: string, payload: unknown = {}): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility: 'public', ts: '2076-05-12T20:00:00Z' };
}

describe('codexEventEffects', () => {
  it('refetches the revealed page and the list (FR5.2)', () => {
    const effects = codexEventEffects([ev('wiki.revealed', { pageId: 'p1', title: 'Renraku' })]);
    expect(effects.pages).toEqual(['p1']);
    expect(effects.list).toBe(true);
  });

  it('handles a page-level reveal with no page id gracefully', () => {
    const effects = codexEventEffects([ev('wiki.revealed', {})]);
    expect(effects.pages).toEqual([]);
    expect(effects.list).toBe(true);
  });

  it('refetches handouts, and the page a handout was revealed on (FR5.4)', () => {
    const effects = codexEventEffects([
      ev('handout.revealed', { attachmentId: 'a1', pageId: 'p2' }),
    ]);
    expect(effects.handouts).toBe(true);
    expect(effects.pages).toEqual(['p2']);
  });

  it('refetches the calendar when the GM advances the clock (FR5.7)', () => {
    expect(codexEventEffects([ev('clock.advanced', { to: '2076-05-14' })]).calendar).toBe(true);
  });

  it('refetches the runs board when ledger entries move (FR5.5 awards)', () => {
    expect(codexEventEffects([ev('ledger.changed', { delta: 6 })]).runs).toBe(true);
  });

  it('de-duplicates page ids across a batch', () => {
    expect(
      codexEventEffects([
        ev('wiki.revealed', { pageId: 'p1' }),
        ev('wiki.revealed', { pageId: 'p1' }),
        ev('handout.revealed', { pageId: 'p1' }),
      ]).pages,
    ).toEqual(['p1']);
  });

  it('ignores table traffic that has nothing to do with the codex', () => {
    expect(
      codexEventEffects([ev('roll.created', {}), ev('token.moved', {}), ev('fog.updated', {})]),
    ).toEqual({ pages: [], list: false, handouts: false, runs: false, calendar: false });
  });

  it('is inert for an empty batch', () => {
    expect(codexEventEffects([])).toEqual({
      pages: [],
      list: false,
      handouts: false,
      runs: false,
      calendar: false,
    });
  });

  it('survives a payload that is not an object', () => {
    expect(() => codexEventEffects([ev('wiki.revealed', 'nonsense')])).not.toThrow();
    expect(codexEventEffects([ev('wiki.revealed', null)]).list).toBe(true);
  });
});
