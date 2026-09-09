import { describe, expect, it } from 'vitest';
import type { Scene, Token, Visibility, WsEvent } from '@safehouse/contracts';
import { tvStageState } from '../grid/tvStage.js';
import {
  mergeSceneEvents,
  tvActiveSceneId,
  tvReveal,
  type TvSceneSnapshot,
} from './sceneState.js';

let nextId = 0;

function evt(type: string, payload: unknown, visibility: Visibility = 'public'): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility, ts: '2076-05-12T21:00:00.000Z' };
}

function token(over: Partial<Token> & { id: string }): Token {
  return {
    sceneId: 's1',
    source: 'character',
    name: over.id,
    x: 1,
    y: 1,
    size: 1,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'public',
    ...over,
  };
}

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Redmond rooftop',
    state: 'active',
    grid: { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: ['map-1'],
    ...over,
  };
}

/** A REST read that landed before any of the events below existed. */
function snapshot(over: Partial<TvSceneSnapshot> = {}): TvSceneSnapshot {
  return {
    scene: scene(),
    tokens: [token({ id: 'wisp', x: 3, y: 4 }), token({ id: 'nine', x: 7, y: 2 })],
    asOfEventId: 0,
    ...over,
  };
}

const square = (n: number) => [
  { x: n, y: n },
  { x: n + 2, y: n },
  { x: n + 2, y: n + 2 },
  { x: n, y: n + 2 },
];

describe('hydration without a socket', () => {
  it('draws the hydrated scene with zero WS traffic — the reboot case', () => {
    const base = snapshot({
      scene: scene({
        fog: {
          regions: [{ id: 'r1', name: 'east wing', polygon: square(2) }],
          revealed: ['r1'],
          revealedShapes: [],
        },
      }),
    });

    const merged = mergeSceneEvents(base, []);
    expect(merged).toBe(base); // nothing applied → same identity, no churn

    const state = tvStageState({
      scene: merged!.scene,
      tokens: merged!.tokens,
      bars: new Map(),
      actingTokenId: null,
    });
    expect(state.scene.mapAttachmentIds).toEqual(['map-1']);
    expect(state.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
    expect(state.scene.fog.revealed).toEqual(['r1']);
    expect(state.role).toBe('display');
  });

  it('is null before the first read rather than inventing an empty scene', () => {
    expect(mergeSceneEvents(null, [evt('token.moved', { tokenId: 'wisp', x: 9, y: 9 })])).toBeNull();
  });
});

describe('mergeSceneEvents', () => {
  it('moves a token the stream reports', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5, rotation: 90 }),
    ]);
    expect(merged?.tokens.find((t) => t.id === 'wisp')).toMatchObject({ x: 12, y: 5, rotation: 90 });
  });

  it('adds, updates and removes tokens', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.added', { token: token({ id: 'ganger', x: 20, y: 8 }) }),
      evt('token.updated', { token: token({ id: 'nine', x: 7, y: 2, name: 'Nine-Toes' }) }),
      evt('token.removed', { tokenId: 'wisp', sceneId: 's1' }),
    ]);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['nine', 'ganger']);
    expect(merged?.tokens.find((t) => t.id === 'nine')?.name).toBe('Nine-Toes');
  });

  it('reveals and hides named fog regions', () => {
    const region = { id: 'r2', name: 'the lab', polygon: square(5) };
    const revealed = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r2', region }),
    ]);
    expect(revealed?.scene.fog.revealed).toEqual(['r2']);
    expect(revealed?.scene.fog.regions.map((r) => r.name)).toEqual(['the lab']);

    const hidden = mergeSceneEvents(revealed, [
      evt('fog.updated', { sceneId: 's1', op: 'hide', regionId: 'r2' }),
    ]);
    expect(hidden?.scene.fog.revealed).toEqual([]);
    expect(hidden?.scene.fog.regions).toEqual([]);
  });

  it('appends freeform reveals once, however often they replay', () => {
    const shape = square(9);
    const once = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape }),
    ]);
    expect(once?.scene.fog.revealedShapes).toHaveLength(1);
    // The same polygon arriving again (replay after reconnect) is not a second
    // brush stroke — an unbounded list on a six-hour kiosk is a leak.
    const twice = mergeSceneEvents(once, [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape }),
    ]);
    expect(twice?.scene.fog.revealedShapes).toHaveLength(1);
  });

  it('takes an environment change from scene.updated', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('scene.updated', {
        sceneId: 's1',
        changed: ['environment'],
        environment: { light: 3, visibility: 2, glare: 0, wind: 0 },
        vision: { playersSeeOwnSight: false },
      }),
    ]);
    expect(merged?.scene.environment.light).toBe(3);
  });

  it('IGNORES a gm-visibility event in the stream', () => {
    const base = snapshot();
    const merged = mergeSceneEvents(base, [
      evt('token.added', { token: token({ id: 'ambusher', x: 25, y: 3 }) }, 'gm'),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'secret' }, 'gm'),
      evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 99, y: 99 }, 'gm'),
    ]);
    expect(merged).toBe(base);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
    expect(merged?.scene.fog.revealed).toEqual([]);
  });

  it('ignores events belonging to another scene', () => {
    const base = snapshot();
    expect(
      mergeSceneEvents(base, [
        evt('token.moved', { tokenId: 'wisp', sceneId: 'other', x: 99, y: 99 }),
        evt('fog.updated', { sceneId: 'other', op: 'reveal', regionId: 'x' }),
      ]),
    ).toBe(base);
  });

  it('never lets a hidden token through, even if one is somehow relayed', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.added', { token: token({ id: 'sneak', hidden: true }) }),
    ]);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
  });

  it('skips events the snapshot already reflects', () => {
    const base = snapshot({ asOfEventId: 1_000 });
    const stale = { ...evt('token.moved', { tokenId: 'wisp', x: 99, y: 99 }), id: 900 };
    expect(mergeSceneEvents(base, [stale])).toBe(base);
  });
});

describe('reconnect', () => {
  it('a fresh read replaces the merged state and retires the old deltas', () => {
    const moved = evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5 });
    const before = mergeSceneEvents(snapshot(), [moved]);
    expect(before?.tokens.find((t) => t.id === 'wisp')?.x).toBe(12);

    // The socket dropped and came back; REST is re-read and now includes the
    // move, plus everything the TV missed while it was gone.
    const rehydrated = snapshot({
      scene: scene({ fog: { regions: [], revealed: ['r9'], revealedShapes: [] } }),
      tokens: [token({ id: 'wisp', x: 12, y: 5 }), token({ id: 'nine', x: 7, y: 2 })],
      asOfEventId: moved.id,
    });
    const after = mergeSceneEvents(rehydrated, [moved]);
    expect(after).toBe(rehydrated); // the replayed delta applies nothing new
    expect(after?.scene.fog.revealed).toEqual(['r9']);
    expect(after?.tokens.find((t) => t.id === 'wisp')?.x).toBe(12);
  });
});

describe('tvActiveSceneId', () => {
  it('prefers the newest activation over the cached read', () => {
    expect(
      tvActiveSceneId(
        [evt('scene.activated', { sceneId: 's1' }), evt('scene.activated', { sceneId: 's2' })],
        'cached',
      ),
    ).toBe('s2');
  });

  it('picks by event id, not array position', () => {
    const older = evt('scene.activated', { sceneId: 's1' });
    const newer = evt('scene.activated', { sceneId: 's2' });
    expect(tvActiveSceneId([newer, older], null)).toBe('s2');
    expect(tvActiveSceneId([older, newer], null)).toBe('s2');
  });

  it('falls back to the REST value when the stream is silent', () => {
    expect(tvActiveSceneId([], 'cached')).toBe('cached');
    expect(tvActiveSceneId([], null)).toBeNull();
  });

  it('will not follow a gm-only activation', () => {
    expect(tvActiveSceneId([evt('scene.activated', { sceneId: 'staged' }, 'gm')], 's1')).toBe('s1');
  });
});

describe('tvReveal', () => {
  it('announces the newest named region reveal', () => {
    const reveal = tvReveal([
      evt('fog.updated', { sceneId: 's1', op: 'reveal', region: { id: 'r1', name: 'east wing' } }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', region: { id: 'r2', name: 'the lab' } }),
    ]);
    expect(reveal?.name).toBe('the lab');
  });

  it('picks by event id, not array position', () => {
    const older = evt('fog.updated', { op: 'reveal', region: { id: 'r1', name: 'east wing' } });
    const newer = evt('fog.updated', { op: 'reveal', region: { id: 'r2', name: 'the lab' } });
    expect(tvReveal([newer, older])?.name).toBe('the lab');
    expect(tvReveal([older, newer])?.name).toBe('the lab');
  });

  it('says nothing for a hide, an unnamed brush reveal, or a gm event', () => {
    expect(tvReveal([evt('fog.updated', { op: 'hide', regionId: 'r1' })])).toBeNull();
    expect(tvReveal([evt('fog.updated', { op: 'reveal', shape: square(1) })])).toBeNull();
    expect(
      tvReveal([evt('fog.updated', { op: 'reveal', region: { id: 'r', name: 'vault' } }, 'gm')]),
    ).toBeNull();
  });
});
