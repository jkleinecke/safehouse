import { beforeEach, describe, expect, it } from 'vitest';
import type { Encounter, WsEvent } from '@safehouse/contracts';
import { EVENT_BUFFER_SIZE, isHydrated, isHydrating, useLiveStore } from './store.js';

function evt(id: number, type = 'log.posted', payload: unknown = {}): WsEvent {
  return { id, type, payload, visibility: 'public', ts: new Date().toISOString() };
}

describe('live store', () => {
  beforeEach(() => {
    useLiveStore.getState().reset();
  });

  it('applies events in order and tracks lastEventId', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(1, 'log.posted'));
    s.applyEvent(evt(2, 'roll.created'));
    expect(useLiveStore.getState().lastEventId).toBe(2);
    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([1, 2]);
  });

  it('dedupes replayed events by id and keeps out-of-order ones', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(5, 'log.posted'));
    s.applyEvent(evt(5, 'log.posted')); // a replay — must not double-apply
    s.applyEvent(evt(3, 'log.posted')); // arrived late — real history, keep it
    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([3, 5]);
    expect(useLiveStore.getState().lastEventId).toBe(5);
  });

  it('caps the ring buffer', () => {
    const s = useLiveStore.getState();
    for (let i = 1; i <= EVENT_BUFFER_SIZE + 25; i++) s.applyEvent(evt(i, 'log.posted'));
    const st = useLiveStore.getState();
    expect(st.events).toHaveLength(EVENT_BUFFER_SIZE);
    expect(st.events[0]?.id).toBe(26);
    expect(st.lastEventId).toBe(EVENT_BUFFER_SIZE + 25);
  });

  it('projects scene.activated into activeSceneId', () => {
    useLiveStore.getState().applyEvent(evt(1, 'scene.activated', { sceneId: 'scn_1' }));
    expect(useLiveStore.getState().activeSceneId).toBe('scn_1');
  });

  it('projects encounter.updated (bare and wrapped payloads)', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(1, 'encounter.updated', { id: 'enc_1', state: 'live' }));
    expect((useLiveStore.getState().encounter as { id?: string } | null)?.id).toBe('enc_1');
    s.applyEvent(evt(2, 'encounter.updated', { encounter: { id: 'enc_2' } }));
    expect((useLiveStore.getState().encounter as { id?: string } | null)?.id).toBe('enc_2');
  });

  it('tracks ephemeral drags and clears them on the persisted token.moved', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({
      type: 'token.dragging',
      payload: { tokenId: 'tok_1', x: 3, y: 4 },
      ephemeral: true,
    });
    expect(useLiveStore.getState().drags['tok_1']).toMatchObject({ x: 3, y: 4 });
    s.applyEvent(evt(1, 'token.moved', { tokenId: 'tok_1', x: 5, y: 6 }));
    expect(useLiveStore.getState().drags['tok_1']).toBeUndefined();
  });

  it('tracks presence and fixer stream buffers', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({
      type: 'presence.changed',
      payload: { userId: 'u1', state: 'online' },
      ephemeral: true,
    });
    expect(useLiveStore.getState().presence['u1']?.state).toBe('online');

    s.handleEphemeral({ type: 'fixer.delta', payload: { text: 'Hoi' }, ephemeral: true });
    expect(useLiveStore.getState().fixerStream).toHaveLength(1);
    s.clearFixerStream();
    expect(useLiveStore.getState().fixerStream).toHaveLength(0);
  });

  it('ignores malformed ephemeral payloads', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({ type: 'token.dragging', payload: { x: 1 }, ephemeral: true });
    s.handleEphemeral({ type: 'presence.changed', payload: null, ephemeral: true });
    expect(useLiveStore.getState().drags).toEqual({});
    expect(useLiveStore.getState().presence).toEqual({});
  });

  /**
   * Marks used to collapse into one kind-less slot, so a "focus here" was
   * indistinguishable from a ping and the TV camera could not follow it
   * without guessing from cadence (FR9.15/FR9.21).
   */
  it('carries the server mark kind through to lastPing', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({
      type: 'ping',
      payload: { x: 3, y: 4, sceneId: 'scn_1', kind: 'focus' },
      ephemeral: true,
    });
    expect(useLiveStore.getState().lastPing).toMatchObject({
      x: 3,
      y: 4,
      sceneId: 'scn_1',
      kind: 'focus',
    });
  });

  it('falls back to the wire type when a mark carries no kind', () => {
    const s = useLiveStore.getState();
    s.handleEphemeral({ type: 'pointer', payload: { x: 1, y: 2 }, ephemeral: true });
    expect(useLiveStore.getState().lastPing?.kind).toBe('pointer');
    s.handleEphemeral({ type: 'ping', payload: { x: 1, y: 2, kind: 'nonsense' }, ephemeral: true });
    expect(useLiveStore.getState().lastPing?.kind).toBe('ping');
  });
});

// ---------------------------------------------------------------------------
// Hydration (LIVE-1)
// ---------------------------------------------------------------------------

const encounter = (id: string, turn = 1, pass = 1): Encounter => ({
  id,
  campaignId: 'camp_1',
  sceneId: null,
  name: 'Rooftop ambush',
  state: 'live',
  turn,
  pass,
  activeCombatantId: null,
  combatants: [],
});

describe('live store hydration', () => {
  beforeEach(() => {
    useLiveStore.getState().reset();
  });

  it('backfills history the socket never delivered', () => {
    useLiveStore.getState().hydrate({ events: [evt(1), evt(2), evt(3)] });
    const st = useLiveStore.getState();
    expect(st.events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(st.lastEventId).toBe(3);
  });

  it('merges a live event onto a backfill exactly once', () => {
    const s = useLiveStore.getState();
    s.hydrate({ events: [evt(1), evt(2)] });
    s.applyEvent(evt(3));
    // The hub replays from last_event_id on reconnect; re-hydration repeats
    // history. Neither may double-apply.
    s.applyEvent(evt(3));
    s.hydrate({ events: [evt(1), evt(2), evt(3)] });
    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('accepts a snapshot that arrives out of order without losing live events', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(9));
    s.hydrate({ events: [evt(6), evt(7), evt(8)] });
    const st = useLiveStore.getState();
    expect(st.events.map((e) => e.id)).toEqual([6, 7, 8, 9]);
    expect(st.lastEventId).toBe(9);
  });

  it('projects a hydrated encounter and active scene', () => {
    useLiveStore.getState().hydrate({ encounter: encounter('enc_1'), activeSceneId: 'scn_1' });
    const st = useLiveStore.getState();
    expect(st.encounter?.id).toBe('enc_1');
    expect(st.activeSceneId).toBe('scn_1');
  });

  it('refuses to let a stale snapshot roll back newer socket state', () => {
    const s = useLiveStore.getState();
    // A snapshot read is issued while lastEventId is 0…
    const asOfEventId = useLiveStore.getState().lastEventId;
    // …then the socket delivers a newer encounter while it is still in flight.
    s.applyEvent(evt(40, 'encounter.updated', { encounter: encounter('enc_new', 3, 2) }));
    s.applyEvent(evt(41, 'scene.activated', { sceneId: 'scn_new' }));
    // The late response must not win.
    s.hydrate({ encounter: encounter('enc_old'), activeSceneId: 'scn_old', asOfEventId });
    const st = useLiveStore.getState();
    expect(st.encounter?.id).toBe('enc_new');
    expect(st.activeSceneId).toBe('scn_new');
  });

  it('accepts a snapshot issued after the last socket write', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(40, 'encounter.updated', { encounter: encounter('enc_a') }));
    s.hydrate({ encounter: encounter('enc_b'), asOfEventId: useLiveStore.getState().lastEventId });
    expect(useLiveStore.getState().encounter?.id).toBe('enc_b');
  });

  it('keeps the roster off the real encounter.updated broadcast', () => {
    // The service nests the row (serialised WITHOUT combatants) and puts the
    // roster at the top level. Reading only `payload.encounter` gave the
    // tracker a live fight with zero combatants.
    useLiveStore.getState().applyEvent(
      evt(30, 'encounter.updated', {
        encounterId: 'enc_1',
        scope: 'gm',
        reason: 'advance',
        encounter: { id: 'enc_1', name: 'Ambush', state: 'live', turn: 2, pass: 1, activeCombatantId: null },
        combatants: [
          { id: 'cbt_1', name: 'Kestrel', initScore: 21, effects: [] },
          { id: 'cbt_2', name: 'Hatchet', initScore: 17, effects: [] },
        ],
        activeCombatantId: 'cbt_2',
      }),
    );
    const enc = useLiveStore.getState().encounter;
    expect(enc?.combatants).toHaveLength(2);
    expect(enc?.activeCombatantId).toBe('cbt_2');
    expect(enc?.turn).toBe(2);
  });

  it('does not let a roster-less delta empty a populated tracker', () => {
    const s = useLiveStore.getState();
    s.hydrate({
      encounter: {
        ...encounter('enc_1'),
        combatants: [
          {
            id: 'cbt_1',
            encounterId: 'enc_1',
            source: 'manual',
            name: 'Kestrel',
            initBase: 9,
            initDice: 2,
            initScore: 21,
            initKind: 'physical',
            monitors: {
              physical: { max: 10, filled: 0 },
              stun: { max: 10, filled: 0 },
              overflow: { max: 0, filled: 0 },
            },
            effects: [],
            visibility: 'public',
            actedThisPass: false,
          },
        ],
      },
    });
    s.applyEvent(evt(31, 'encounter.updated', { encounterId: 'enc_1', sceneId: 'scn_1', staged: 3 }));
    expect(useLiveStore.getState().encounter?.combatants).toHaveLength(1);
  });

  it('clears the encounter on a deletion announcement', () => {
    const s = useLiveStore.getState();
    s.hydrate({ encounter: encounter('enc_1') });
    s.applyEvent(evt(32, 'encounter.updated', { encounterId: 'enc_1', deleted: true }));
    expect(useLiveStore.getState().encounter).toBeNull();
  });

  it('clears the encounter when the server hydrates an explicit null', () => {
    const s = useLiveStore.getState();
    s.hydrate({ encounter: encounter('enc_1') });
    s.hydrate({ encounter: null });
    expect(useLiveStore.getState().encounter).toBeNull();
  });

  it('hydrates live-mode presence', () => {
    useLiveStore.getState().hydrate({ sessionLive: true, activeSessionId: 'ses_1', connectedCount: 5 });
    const st = useLiveStore.getState();
    expect(st.sessionLive).toBe(true);
    expect(st.activeSessionId).toBe('ses_1');
    expect(st.connectedCount).toBe(5);
  });

  it('tracks per-slice hydration so an empty view can tell why it is empty', () => {
    const s = useLiveStore.getState();
    expect(isHydrating(useLiveStore.getState(), 'log')).toBe(true);
    expect(isHydrated(useLiveStore.getState(), 'log')).toBe(false);

    s.setHydration('log', 'loading');
    expect(isHydrated(useLiveStore.getState(), 'log')).toBe(false);

    s.setHydration('log', 'ready');
    expect(isHydrated(useLiveStore.getState(), 'log')).toBe(true);
    expect(isHydrating(useLiveStore.getState(), 'log')).toBe(false);

    // A failed read is "we asked and could not get it", not "nothing here".
    s.setHydration('encounter', 'error');
    expect(isHydrated(useLiveStore.getState(), 'encounter')).toBe(true);
  });

  it('bumps reconnectEpoch on a reconnect, not on the first connect', () => {
    const s = useLiveStore.getState();
    s.setStatus('connecting');
    s.setStatus('online');
    expect(useLiveStore.getState().reconnectEpoch).toBe(0);
    expect(useLiveStore.getState().hasBeenOnline).toBe(true);

    s.setStatus('offline');
    s.setStatus('online');
    expect(useLiveStore.getState().reconnectEpoch).toBe(1);

    s.setStatus('offline');
    s.setStatus('connecting');
    s.setStatus('online');
    expect(useLiveStore.getState().reconnectEpoch).toBe(2);
  });

  it('reset clears hydration bookkeeping as well as state', () => {
    const s = useLiveStore.getState();
    s.hydrate({ events: [evt(1)], encounter: encounter('enc_1') });
    s.setHydration('log', 'ready');
    s.setStatus('online');
    useLiveStore.getState().reset();
    const st = useLiveStore.getState();
    expect(st.events).toEqual([]);
    expect(st.encounter).toBeNull();
    expect(st.hydration.log).toBe('idle');
    expect(st.hasBeenOnline).toBe(false);
    expect(st.reconnectEpoch).toBe(0);
  });
});
