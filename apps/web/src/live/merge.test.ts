import { describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import {
  EMPTY_WINDOW,
  isEncounterDeleted,
  mergeEncounter,
  mergeEvents,
  monitorsFromCondition,
  normalizeCombatant,
  normalizeEncounter,
  OWNED_BY_VIEWER,
  pickLiveEncounter,
  type EventWindow,
} from './merge.js';

function evt(id: number, type = 'log.posted'): WsEvent {
  return { id, type, payload: { text: `line ${id}` }, visibility: 'public', ts: '2076-05-12T20:00:00.000Z' };
}

function win(ids: number[], last = ids[ids.length - 1] ?? 0, floor = 0): EventWindow {
  return { events: ids.map((i) => evt(i)), lastEventId: last, floorEventId: floor };
}

describe('mergeEvents', () => {
  it('backfills a snapshot into an empty window, oldest → newest', () => {
    const out = mergeEvents(EMPTY_WINDOW, [evt(3), evt(1), evt(2)], 500);
    expect(out.events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(out.lastEventId).toBe(3);
  });

  it('is idempotent: the same batch twice changes nothing and keeps identity', () => {
    const once = mergeEvents(EMPTY_WINDOW, [evt(1), evt(2)], 500);
    const twice = mergeEvents(once, [evt(1), evt(2)], 500);
    expect(twice).toBe(once);
    expect(twice.events).toHaveLength(2);
  });

  it('dedupes inside one batch', () => {
    const out = mergeEvents(EMPTY_WINDOW, [evt(7), evt(7), evt(7)], 500);
    expect(out.events).toHaveLength(1);
  });

  it('merges a live event on top of a backfill without duplicating it', () => {
    const hydrated = mergeEvents(EMPTY_WINDOW, [evt(10), evt(11)], 500);
    const withLive = mergeEvents(hydrated, [evt(12)], 500);
    expect(withLive.events.map((e) => e.id)).toEqual([10, 11, 12]);
    // The hub replays 11 and 12 after a reconnect: neither may land twice.
    const replayed = mergeEvents(withLive, [evt(11), evt(12)], 500);
    expect(replayed).toBe(withLive);
    expect(replayed.events.map((e) => e.id)).toEqual([10, 11, 12]);
  });

  it('accepts out-of-order arrivals and sorts them into place', () => {
    const a = mergeEvents(EMPTY_WINDOW, [evt(5)], 500);
    const b = mergeEvents(a, [evt(3)], 500);
    expect(b.events.map((e) => e.id)).toEqual([3, 5]);
    expect(b.lastEventId).toBe(5); // never walks backwards
  });

  it('raises lastEventId on a replay of events already held', () => {
    const w: EventWindow = { events: [evt(4)], lastEventId: 2, floorEventId: 0 };
    const out = mergeEvents(w, [evt(4)], 500);
    expect(out.lastEventId).toBe(4);
    expect(out.events).toHaveLength(1);
  });

  it('caps the buffer and refuses to resurrect what fell off the front', () => {
    const capped = mergeEvents(EMPTY_WINDOW, [evt(1), evt(2), evt(3), evt(4)], 2);
    expect(capped.events.map((e) => e.id)).toEqual([3, 4]);
    expect(capped.floorEventId).toBe(2);
    const again = mergeEvents(capped, [evt(1), evt(2)], 2);
    expect(again).toBe(capped);
  });

  it('ignores values that are not persisted events', () => {
    const out = mergeEvents(EMPTY_WINDOW, [null, 3, { type: 'x' }, { id: 'a', type: 'x' }], 500);
    expect(out).toBe(EMPTY_WINDOW);
  });
});

describe('normalizeEncounter', () => {
  const gmPayload = {
    encounter: {
      id: 'enc_1',
      campaignId: 'camp_1',
      sceneId: 'scn_1',
      name: 'Rooftop ambush',
      state: 'live',
      turn: 2,
      pass: 1,
      activeCombatantId: null,
    },
    combatants: [
      {
        id: 'cbt_1',
        encounterId: 'enc_1',
        source: 'character',
        sourceId: 'chr_1',
        name: 'Kestrel',
        initBase: 9,
        initDice: 2,
        initScore: 17,
        initKind: 'physical',
        monitors: {
          physical: { max: 10, filled: 2 },
          stun: { max: 10, filled: 0 },
          overflow: { max: 3, filled: 0 },
        },
        effects: [],
        visibility: 'public',
        actedThisPass: false,
      },
    ],
    activeCombatantId: 'cbt_1',
    turnOrder: ['cbt_1'],
    scope: 'gm',
    state: 'live',
    turn: 2,
    pass: 1,
  };

  it('reads the composed REST payload including the hoisted turn structure', () => {
    const enc = normalizeEncounter(gmPayload);
    expect(enc).not.toBeNull();
    expect(enc?.id).toBe('enc_1');
    expect(enc?.state).toBe('live');
    expect(enc?.turn).toBe(2);
    expect(enc?.pass).toBe(1);
    expect(enc?.activeCombatantId).toBe('cbt_1');
    expect(enc?.combatants?.map((c) => c.name)).toEqual(['Kestrel']);
  });

  it('reads turn/pass from the top level when the nested row omits them', () => {
    const enc = normalizeEncounter({
      encounter: { id: 'enc_2', name: 'Alley' },
      state: 'live',
      turn: 4,
      pass: 3,
      combatants: [],
    });
    expect(enc?.state).toBe('live');
    expect(enc?.turn).toBe(4);
    expect(enc?.pass).toBe(3);
  });

  it('reads a bare encounter payload (an `encounter.updated` delta)', () => {
    const enc = normalizeEncounter({ id: 'enc_3', state: 'prep', turn: 0, pass: 0 });
    expect(enc?.id).toBe('enc_3');
    expect(enc?.combatants).toBeUndefined(); // never asked ≠ zero combatants
  });

  it('returns null without an id rather than inventing one', () => {
    expect(normalizeEncounter({ name: 'nameless' })).toBeNull();
    expect(normalizeEncounter(null)).toBeNull();
  });

  it('survives a garbage payload with defaults instead of throwing', () => {
    const enc = normalizeEncounter({ id: 'enc_4', state: 'weird', turn: 'x', combatants: 'nope' });
    expect(enc?.state).toBe('prep');
    expect(enc?.turn).toBe(0);
    expect(enc?.combatants).toEqual([]);
  });
});

describe('normalizeCombatant', () => {
  it('carries the server-declared ownership the player payload cannot re-derive', () => {
    const c = normalizeCombatant(
      {
        id: 'cbt_9',
        name: 'Vex',
        source: 'character',
        initScore: 14,
        initKind: 'physical',
        actedThisPass: false,
        own: true,
        condition: 'unharmed',
        monitors: { physical: { max: 10, filled: 1 }, stun: { max: 9, filled: 0 }, overflow: { max: 0, filled: 0 } },
        effects: [],
      },
      'enc_1',
    );
    expect(c?.copilot?.[OWNED_BY_VIEWER]).toBe(true);
    expect(c?.monitors.physical.filled).toBe(1);
  });

  it('lands a monitor-less player row in the right coarse band', () => {
    const c = normalizeCombatant(
      { id: 'cbt_8', name: 'Ganger', source: 'generated', condition: 'bloodied', effects: [] },
      'enc_1',
    );
    expect(c?.monitors).toEqual(monitorsFromCondition('bloodied'));
    expect(c?.visibility).toBe('public');
    expect(c?.copilot?.[OWNED_BY_VIEWER]).toBeUndefined();
  });

  it('leaves an own row with no monitors at zero rather than inventing boxes', () => {
    const c = normalizeCombatant({ id: 'c', name: 'X', own: true, condition: 'down' }, 'enc_1');
    expect(c?.monitors.physical.max).toBe(0);
  });

  it('drops rows with no id or no name', () => {
    expect(normalizeCombatant({ name: 'no id' }, 'enc')).toBeNull();
    expect(normalizeCombatant({ id: 'no name' }, 'enc')).toBeNull();
  });
});

describe('normalizeEncounter over the encounter.updated broadcast', () => {
  // Shape emitted by EncountersService: the ROW is nested and serialised
  // WITHOUT its roster, while combatants and the acting row sit at the top
  // level. Reading `payload.encounter` alone loses every combatant.
  const broadcast = {
    encounterId: 'enc_1',
    scope: 'gm',
    reason: 'advance',
    encounter: {
      id: 'enc_1',
      campaignId: 'camp_1',
      sceneId: null,
      name: 'Rooftop ambush',
      state: 'live',
      turn: 2,
      pass: 1,
      activeCombatantId: null,
    },
    combatants: [
      { id: 'cbt_1', name: 'Kestrel', initScore: 21, effects: [] },
      { id: 'cbt_2', name: 'Hatchet', initScore: 17, effects: [] },
    ],
    activeCombatantId: 'cbt_2',
    turnOrder: ['cbt_1', 'cbt_2'],
  };

  it('keeps the top-level roster and acting row', () => {
    const enc = normalizeEncounter(broadcast);
    expect(enc?.combatants?.map((c) => c.name)).toEqual(['Kestrel', 'Hatchet']);
    expect(enc?.activeCombatantId).toBe('cbt_2');
    expect(enc?.turn).toBe(2);
  });

  it('finds the id in `encounterId` when the row is absent', () => {
    expect(normalizeEncounter({ encounterId: 'enc_9', staged: 3 })?.id).toBe('enc_9');
  });
});

describe('mergeEncounter', () => {
  const full = normalizeEncounter({
    encounter: { id: 'enc_1', name: 'Ambush', state: 'live', turn: 1, pass: 1 },
    combatants: [{ id: 'c1', name: 'Kestrel', effects: [] }],
    activeCombatantId: 'c1',
  });

  it('never lets a roster-less delta empty a populated tracker', () => {
    const delta = normalizeEncounter({ encounterId: 'enc_1', sceneId: 'scn_1', staged: 3 });
    const merged = mergeEncounter(full, delta);
    expect(merged?.combatants).toHaveLength(1);
    expect(merged?.activeCombatantId).toBe('c1');
  });

  it('takes a payload that does carry combatants wholesale, empty included', () => {
    const cleared = normalizeEncounter({
      encounter: { id: 'enc_1', name: 'Ambush', state: 'live' },
      combatants: [],
      activeCombatantId: null,
    });
    expect(mergeEncounter(full, cleared)?.combatants).toEqual([]);
  });

  it('replaces outright when the fight changed', () => {
    const other = normalizeEncounter({ id: 'enc_2', combatants: [] });
    expect(mergeEncounter(full, other)?.id).toBe('enc_2');
  });

  it('keeps what it has when there is nothing to merge', () => {
    expect(mergeEncounter(full, null)).toBe(full);
    expect(mergeEncounter(null, full)).toBe(full);
  });

  it('spots a deletion announcement', () => {
    expect(isEncounterDeleted({ encounterId: 'enc_1', deleted: true })).toBe(true);
    expect(isEncounterDeleted({ encounterId: 'enc_1' })).toBe(false);
  });
});

describe('pickLiveEncounter', () => {
  const enc = (id: string, state: 'prep' | 'live' | 'done') =>
    ({ id, campaignId: 'c', name: id, state, turn: 0, pass: 0 }) as never;

  it('prefers the running fight, then a prepared one', () => {
    expect(pickLiveEncounter([enc('a', 'done'), enc('b', 'live')])?.id).toBe('b');
    expect(pickLiveEncounter([enc('a', 'done'), enc('b', 'prep')])?.id).toBe('b');
    expect(pickLiveEncounter([enc('a', 'done')])?.id).toBe('a');
    expect(pickLiveEncounter([])).toBeNull();
    expect(pickLiveEncounter(undefined)).toBeNull();
  });
});

describe('a thin encounter delta folded onto the fight on screen', () => {
  const live = normalizeEncounter({
    encounter: { id: 'enc_1', campaignId: 'c1', name: 'Pier 23 ambush', state: 'live', turn: 2, pass: 1, sceneId: 's1' },
    combatants: [{ id: 'a', name: 'Static', initScore: 14 }],
    activeCombatantId: 'a',
  })!;

  it('keeps the name, the turn and the state a "staged" frame never mentioned', () => {
    const staged = normalizeEncounter({ encounterId: 'enc_1', sceneId: 's1', staged: 3, created: false })!;
    const merged = mergeEncounter(live, staged)!;
    expect(merged.name).toBe('Pier 23 ambush');
    expect(merged.state).toBe('live');
    expect(merged.turn).toBe(2);
    expect(merged.pass).toBe(1);
    expect(merged.combatants?.map((c) => c.id)).toEqual(['a']);
    expect(merged.activeCombatantId).toBe('a');
  });

  it('takes the header fields a delta does carry', () => {
    const over = normalizeEncounter({ encounter: { id: 'enc_1', state: 'done' } })!;
    const merged = mergeEncounter(live, over)!;
    expect(merged.state).toBe('done');
    expect(merged.name).toBe('Pier 23 ambush');
    expect(merged.turn).toBe(2);
  });

  it('a hand-built delta with no provenance still replaces the header, as before', () => {
    const merged = mergeEncounter(live, { ...live, name: 'Renamed', combatants: undefined } as never)!;
    expect(merged.name).toBe('Renamed');
    expect(merged.combatants?.length).toBe(1);
  });
});
