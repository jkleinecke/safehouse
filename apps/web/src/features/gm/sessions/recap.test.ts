import { describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import { headlineEvents, headlineOf, recapSkeleton, toggleAttendee } from './recap.js';

let nextId = 0;
function ev(type: string, payload: unknown): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility: 'public', ts: `2076-05-12T20:0${nextId % 10}:00Z` };
}

describe('headlineOf (FR6.3 headline events)', () => {
  it('keeps big rolls and drops quiet ones', () => {
    expect(headlineOf(ev('roll.created', { actorName: 'Static', result: { hits: 6, glitch: 'none' } }))?.text).toBe(
      'Static rolled 6 hits.',
    );
    expect(headlineOf(ev('roll.created', { actorName: 'Static', result: { hits: 2, glitch: 'none' } }))).toBeNull();
  });

  it('always keeps glitches, however few hits', () => {
    const critical = headlineOf(
      ev('roll.created', { actorName: 'Hex', label: 'Spellcasting', result: { hits: 0, glitch: 'critical' } }),
    );
    expect(critical?.text).toBe('Hex critically glitched on Spellcasting.');
    const glitch = headlineOf(ev('roll.created', { actorName: 'Hex', result: { hits: 1, glitch: 'glitch' } }));
    expect(glitch?.kind).toBe('roll');
  });

  it('reports damage and downed combatants', () => {
    expect(headlineOf(ev('combatant.damaged', { name: 'Ganger 3', boxes: 4, monitor: 'physical' }))?.text).toBe(
      'Ganger 3 took 4 physical boxes.',
    );
    expect(headlineOf(ev('combatant.damaged', { name: 'Ganger 3', down: true }))?.text).toBe(
      'Ganger 3 went down.',
    );
    expect(headlineOf(ev('combatant.damaged', { name: 'Ganger 3', boxes: 0 }))).toBeNull();
  });

  it('reports approved ledger movement only', () => {
    expect(
      headlineOf(
        ev('ledger.changed', {
          characterName: 'Static',
          delta: 5,
          currency: 'karma',
          reason: 'the job',
          state: 'approved',
        }),
      )?.text,
    ).toBe('Static +5 karma — the job.');
    expect(headlineOf(ev('ledger.changed', { characterName: 'Static', delta: 5, state: 'pending' }))).toBeNull();
  });

  it('reports scene activations, reveals and clock advances', () => {
    expect(headlineOf(ev('scene.activated', { name: 'Loading dock' }))?.kind).toBe('scene');
    expect(headlineOf(ev('wiki.revealed', { title: 'The Johnson' }))?.text).toBe(
      'Revealed to the table: The Johnson.',
    );
    expect(headlineOf(ev('clock.advanced', { ingameDate: '2076-05-14' }))?.text).toBe(
      'In-game date advanced to 2076-05-14.',
    );
  });

  it('ignores traffic that is not recap material', () => {
    expect(headlineOf(ev('token.moved', { tokenId: 't1', x: 1, y: 2 }))).toBeNull();
    expect(headlineOf(ev('fog.updated', {}))).toBeNull();
  });
});

describe('headlineEvents', () => {
  it('orders by event id and keeps the most recent within the limit', () => {
    const events = [
      ev('roll.created', { actorName: 'A', result: { hits: 5 } }),
      ev('token.moved', {}),
      ev('roll.created', { actorName: 'B', result: { hits: 7 } }),
      ev('roll.created', { actorName: 'C', result: { hits: 9 } }),
    ];
    const all = headlineEvents(events);
    expect(all.map((h) => h.text)).toEqual([
      'A rolled 5 hits.',
      'B rolled 7 hits.',
      'C rolled 9 hits.',
    ]);
    expect(headlineEvents(events, 2).map((h) => h.text)).toEqual([
      'B rolled 7 hits.',
      'C rolled 9 hits.',
    ]);
  });
});

describe('recapSkeleton', () => {
  it('writes a Markdown starting point with headlines and attendance', () => {
    const md = recapSkeleton({
      date: '2026-08-27',
      ingameDate: '2076-05-12',
      attendance: ['Static', 'Hex'],
      headlines: [{ kind: 'roll', text: 'Static rolled 6 hits.', ts: '', eventId: 1 }],
    });
    expect(md).toContain('# Session — 2026-08-27');
    expect(md).toContain('*In-game: 2076-05-12*');
    expect(md).toContain('*Present: Static, Hex*');
    expect(md).toContain('- Static rolled 6 hits.');
    expect(md).toContain('## Where it left off');
  });

  it('says so when the log is empty', () => {
    const md = recapSkeleton({ date: '2026-08-27', attendance: [], headlines: [] });
    expect(md).toContain('- (nothing in the log yet)');
    expect(md).not.toContain('Present:');
  });
});

describe('toggleAttendee', () => {
  it('adds and removes without mutating', () => {
    const base = ['Static'];
    expect(toggleAttendee(base, 'Hex')).toEqual(['Static', 'Hex']);
    expect(toggleAttendee(base, 'Static')).toEqual([]);
    expect(base).toEqual(['Static']);
  });
});
