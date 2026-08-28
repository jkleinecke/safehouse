import { describe, expect, it } from 'vitest';
import type { Visibility, WsEvent } from '@safehouse/contracts';
import { edgeLabel, parseRoll, toLogItem, toLogItems } from './views.js';

function evt(
  type: string,
  payload: unknown,
  over: Partial<Pick<WsEvent, 'id' | 'visibility' | 'ts'>> = {},
): WsEvent {
  return {
    id: over.id ?? 1,
    type,
    payload,
    visibility: (over.visibility ?? 'public') as Visibility,
    ts: over.ts ?? '2076-05-12T20:15:00.000Z',
  };
}

const FLAT_ROLL = {
  kind: 'simple',
  actor: { characterId: 'char-1' },
  actorName: 'Wisp',
  request: {
    pool: 9,
    breakdown: [
      { label: 'Agility', value: 5 },
      { label: 'Automatics', value: 6 },
      { label: 'Recoil', value: -2, source: 'situational' },
    ],
    limit: { kind: 'accuracy', value: 4 },
    meta: { label: 'Burst on the runner' },
  },
  result: { faces: [5, 6, 2, 1, 5, 3, 6, 1, 4], hits: 5, ones: 2, glitch: 'none', limitedHits: 4 },
};

describe('parseRoll', () => {
  it('reads the flat rolls-record shape', () => {
    const roll = parseRoll(evt('roll.created', FLAT_ROLL));
    expect(roll).not.toBeNull();
    expect(roll?.actorName).toBe('Wisp');
    expect(roll?.pool).toBe(9);
    expect(roll?.hits).toBe(5);
    expect(roll?.limitedHits).toBe(4);
    expect(roll?.limit).toEqual({ kind: 'accuracy', value: 4 });
    expect(roll?.breakdown).toHaveLength(3);
    expect(roll?.label).toBe('Burst on the runner');
  });

  it('accepts a { roll: … } wrapper', () => {
    const roll = parseRoll(evt('roll.created', { roll: FLAT_ROLL }));
    expect(roll?.hits).toBe(5);
  });

  it('carries glitch state and edge callouts', () => {
    const roll = parseRoll(
      evt('roll.created', {
        ...FLAT_ROLL,
        glitch: 'critical',
        edgeAction: 'push_pre',
        result: { faces: [1, 1, 1, 2], hits: 0, ones: 3, glitch: 'critical', limitedHits: 0 },
        request: { ...FLAT_ROLL.request, meta: { burnEdge: true } },
      }),
    );
    expect(roll?.glitch).toBe('critical');
    expect(roll?.edge).toBe('push_pre');
    expect(roll?.burnedEdge).toBe(true);
  });

  it('renders bought hits with no faces at all', () => {
    const roll = parseRoll(
      evt('roll.created', {
        actor: { gm: true },
        request: { pool: 12, meta: { buyHits: true, boughtHits: 3, label: 'Bought hits' } },
        result: { faces: [], ones: 0, glitch: 'none' },
      }),
    );
    expect(roll?.bought).toBe(true);
    expect(roll?.hits).toBe(3);
    expect(roll?.actorName).toBe('GM');
  });

  it('counts ones itself when the server omits them', () => {
    const roll = parseRoll(
      evt('roll.created', { result: { faces: [1, 1, 5, 6], hits: 2, glitch: 'none', limitedHits: 2 } }),
    );
    expect(roll?.ones).toBe(2);
  });

  it('returns null for a payload with nothing to draw', () => {
    expect(parseRoll(evt('roll.created', { note: 'nope' }))).toBeNull();
    expect(parseRoll(evt('token.moved', FLAT_ROLL))).toBeNull();
  });
});

describe('toLogItem', () => {
  it('maps damage events', () => {
    const item = toLogItem(
      evt('combatant.damaged', { name: 'Ganger', boxes: 4, monitor: 'physical', woundModifier: -1 }),
    );
    expect(item).toMatchObject({ kind: 'damage', name: 'Ganger', boxes: 4, woundModifier: -1 });
  });

  it('splits table talk from scene markers', () => {
    expect(toLogItem(evt('log.posted', { text: 'I check the door', authorName: 'Wisp' }))).toMatchObject({
      kind: 'talk',
      author: 'Wisp',
    });
    expect(toLogItem(evt('log.posted', { text: 'The lights go out', kind: 'marker' }))).toMatchObject({
      kind: 'marker',
    });
  });

  it('turns scene and clock changes into markers', () => {
    expect(toLogItem(evt('scene.activated', { name: 'Rooftop' }))).toMatchObject({
      kind: 'marker',
      text: 'Scene: Rooftop',
    });
    expect(toLogItem(evt('clock.advanced', { ingameDate: '2076-05-13' }))).toMatchObject({
      kind: 'marker',
    });
  });

  it('treats reveals as their own line', () => {
    expect(toLogItem(evt('handout.revealed', { title: 'Datachip' }))).toMatchObject({
      kind: 'reveal',
      text: 'Datachip',
    });
    expect(toLogItem(evt('fog.updated', { announce: true, regionName: 'east wing' }))).toMatchObject({
      kind: 'reveal',
    });
  });

  it('stays quiet about routine fog and token traffic', () => {
    expect(toLogItem(evt('fog.updated', { regionName: 'east wing' }))).toBeNull();
    expect(toLogItem(evt('token.moved', { tokenId: 't1' }))).toBeNull();
    expect(toLogItem(evt('encounter.updated', { id: 'e1' }))).toBeNull();
  });

  it('formats ledger deltas with a sign', () => {
    const item = toLogItem(
      evt('ledger.changed', { entry: { currency: 'nuyen', delta: -2500, reason: 'Fixer cut' } }),
    );
    expect(item).toMatchObject({ kind: 'ledger' });
    expect(item && 'text' in item ? item.text : '').toContain('-2500 nuyen');
  });
});

describe('toLogItems', () => {
  it('keeps order and drops the noise', () => {
    const items = toLogItems([
      evt('token.moved', { tokenId: 't1' }, { id: 1 }),
      evt('log.posted', { text: 'first' }, { id: 2 }),
      evt('log.posted', { text: 'second' }, { id: 3 }),
    ]);
    expect(items.map((i) => i.id)).toEqual([2, 3]);
  });
});

describe('edgeLabel', () => {
  it('names the edge actions', () => {
    expect(edgeLabel('push_pre')).toBe('Push the Limit');
    expect(edgeLabel('second_chance')).toBe('Second Chance');
    expect(edgeLabel('seize_the_initiative')).toBe('seize the initiative');
  });
});
