import { beforeEach, describe, expect, it } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import { EVENT_BUFFER_SIZE, useLiveStore } from './store.js';

function evt(id: number, type: string, payload: unknown = {}): WsEvent {
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

  it('dedupes replayed events by id', () => {
    const s = useLiveStore.getState();
    s.applyEvent(evt(5, 'log.posted'));
    s.applyEvent(evt(5, 'log.posted'));
    s.applyEvent(evt(3, 'log.posted'));
    expect(useLiveStore.getState().events).toHaveLength(1);
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
});
