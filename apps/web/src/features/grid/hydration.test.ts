import { describe, expect, it } from 'vitest';
import type { Combatant, Encounter, Scene, Token } from '@safehouse/contracts';
import { addPin, emptyGeometry } from './geometryEdit.js';
import {
  composeStageState,
  DEFAULT_DISPLAY,
  displayFromEvents,
  mergeEncounter,
  pickEncounterId,
  resolveSceneId,
} from './hydration.js';
import type { Viewer } from './projection.js';

// --- fixtures ---------------------------------------------------------------

function scene(patch: Partial<Scene> = {}): Scene {
  return {
    id: 'sc1',
    campaignId: 'c1',
    name: 'Loading dock',
    state: 'active',
    grid: { unitM: 1, cols: 20, rows: 12, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: emptyGeometry(),
    fog: { regions: [], revealed: [], revealedShapes: [] },
    mapAttachmentIds: [],
    ...patch,
  };
}

function token(patch: Partial<Token> = {}): Token {
  return {
    id: 't1',
    sceneId: 'sc1',
    source: 'character',
    sourceId: 'ch1',
    name: 'Wisp',
    x: 3,
    y: 4,
    size: 1,
    rotation: 0,
    hidden: false,
    barsVisibility: 'public',
    ...patch,
  };
}

function combatant(patch: Partial<Combatant> = {}): Combatant {
  return {
    id: 'cb1',
    encounterId: 'e1',
    tokenId: 't1',
    source: 'character',
    name: 'Wisp',
    initBase: 8,
    initDice: 2,
    initScore: 15,
    initKind: 'physical',
    monitors: {
      physical: { max: 10, filled: 3 },
      stun: { max: 10, filled: 1 },
      overflow: { max: 3, filled: 0 },
    },
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...patch,
  };
}

function encounter(patch: Partial<Encounter> = {}): Encounter {
  return {
    id: 'e1',
    campaignId: 'c1',
    sceneId: 'sc1',
    name: 'Dock ambush',
    state: 'live',
    turn: 1,
    pass: 1,
    activeCombatantId: 'cb1',
    ...patch,
  };
}

const gm: Viewer = { role: 'gm', userId: 'u_gm' };
const player: Viewer = { role: 'player', userId: 'u_p', characterId: 'ch1' };

// --- tests ------------------------------------------------------------------

describe('resolveSceneId', () => {
  it('finds the active scene from REST alone — no WS traffic (LIVE-1)', () => {
    const list = [scene({ id: 'draft1', state: 'draft' }), scene({ id: 'sc9', state: 'active' })];
    expect(resolveSceneId({ isGm: false, viewSceneId: null, liveActiveSceneId: null, scenes: list }))
      .toEqual({ activeSceneId: 'sc9', sceneId: 'sc9' });
  });

  it('lets a live activation override the list', () => {
    const list = [scene({ id: 'sc9', state: 'active' })];
    expect(
      resolveSceneId({ isGm: false, viewSceneId: null, liveActiveSceneId: 'sc2', scenes: list }),
    ).toEqual({ activeSceneId: 'sc2', sceneId: 'sc2' });
  });

  it('honours the GM staging a different scene, and ignores it for players', () => {
    const list = [scene({ id: 'sc9', state: 'active' })];
    expect(
      resolveSceneId({ isGm: true, viewSceneId: 'draft1', liveActiveSceneId: null, scenes: list }),
    ).toEqual({ activeSceneId: 'sc9', sceneId: 'draft1' });
    expect(
      resolveSceneId({ isGm: false, viewSceneId: 'draft1', liveActiveSceneId: null, scenes: list }),
    ).toEqual({ activeSceneId: 'sc9', sceneId: 'sc9' });
  });

  it('reports nothing on screen while the list is still loading', () => {
    expect(
      resolveSceneId({ isGm: true, viewSceneId: null, liveActiveSceneId: null, scenes: undefined }),
    ).toEqual({ activeSceneId: null, sceneId: null });
  });
});

describe('pickEncounterId', () => {
  it('prefers a live fight on this scene', () => {
    const list = [
      encounter({ id: 'other', sceneId: 'sc2', state: 'live' }),
      encounter({ id: 'here', sceneId: 'sc1', state: 'live' }),
    ];
    expect(pickEncounterId(list, 'sc1')).toBe('here');
  });

  it('falls back to any live fight, then to one staged against this scene', () => {
    expect(pickEncounterId([encounter({ id: 'elsewhere', sceneId: 'sc2' })], 'sc1')).toBe('elsewhere');
    expect(
      pickEncounterId([encounter({ id: 'staged', sceneId: 'sc1', state: 'prep' })], 'sc1'),
    ).toBe('staged');
    expect(
      pickEncounterId([encounter({ id: 'staged', sceneId: 'sc2', state: 'prep' })], 'sc1'),
    ).toBeNull();
    expect(pickEncounterId([], 'sc1')).toBeNull();
    expect(pickEncounterId(undefined, 'sc1')).toBeNull();
  });
});

describe('mergeEncounter', () => {
  const roster = [combatant()];

  it('uses the REST snapshot when nothing has come over the wire', () => {
    expect(mergeEncounter(null, encounter({ combatants: roster }))?.combatants).toEqual(roster);
  });

  it('keeps the hydrated roster under a header-only live delta', () => {
    const live = encounter({ pass: 2, activeCombatantId: 'cb2' });
    const merged = mergeEncounter(live, encounter({ combatants: roster }));
    expect(merged?.pass).toBe(2);
    expect(merged?.activeCombatantId).toBe('cb2');
    expect(merged?.combatants).toEqual(roster);
  });

  it('prefers the live roster when it has one', () => {
    const liveRoster = [combatant({ initScore: 22 })];
    const merged = mergeEncounter(
      encounter({ combatants: liveRoster }),
      encounter({ combatants: roster }),
    );
    expect(merged?.combatants?.[0]?.initScore).toBe(22);
  });

  it('does not paste a stale snapshot onto a different fight', () => {
    const live = encounter({ id: 'e2' });
    expect(mergeEncounter(live, encounter({ id: 'e1', combatants: roster }))).toBe(live);
  });

  it('is null when neither side has anything', () => {
    expect(mergeEncounter(null, null)).toBeNull();
  });
});

describe('displayFromEvents (FR9.21)', () => {
  const evt = (type: string, payload: unknown) => ({ type, payload });

  it('defaults to a live table with the ribbon showing', () => {
    expect(displayFromEvents([])).toEqual(DEFAULT_DISPLAY);
    expect(displayFromEvents([evt('roll.created', {})])).toEqual(DEFAULT_DISPLAY);
  });

  it('follows the newest steering event, not an accumulation of them', () => {
    expect(displayFromEvents([evt('display.updated', { blank: true })])).toEqual({
      blank: true,
      ribbon: true,
    });
    expect(
      displayFromEvents([
        evt('display.updated', { blank: true }),
        evt('roll.created', {}),
        evt('display.updated', { ribbon: false }),
      ]),
    ).toEqual({ blank: false, ribbon: false });
  });

  it('shrugs off a malformed payload', () => {
    expect(displayFromEvents([evt('display.updated', 'nope')])).toEqual(DEFAULT_DISPLAY);
  });
});

describe('composeStageState (hydration with zero WS traffic)', () => {
  it('draws a complete frame from REST data alone', () => {
    const state = composeStageState({
      scene: scene(),
      tokens: [token()],
      viewer: gm,
      encounter: encounter({ combatants: [combatant()] }),
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
    });
    expect(state).not.toBeNull();
    expect(state?.scene.id).toBe('sc1');
    expect(state?.tokens).toHaveLength(1);
    // The two things a cold mount used to lose entirely:
    expect(state?.actingTokenId).toBe('t1');
    expect(state?.bars.get('t1')).toEqual({
      physical: { filled: 3, max: 10 },
      stun: { filled: 1, max: 10 },
      effectCount: 0,
    });
    expect([...(state?.draggableIds ?? [])]).toEqual(['t1']);
  });

  it('still renders the map before any encounter exists', () => {
    const state = composeStageState({
      scene: scene({ geometry: addPin(emptyGeometry(), { x: 2, y: 2 }, { label: 'the safe' }) }),
      tokens: [token()],
      viewer: player,
      encounter: null,
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
      selectedPinId: 'pin_1',
    });
    expect(state?.actingTokenId).toBeNull();
    expect(state?.bars.size).toBe(0);
    expect(state?.scene.geometry.pins[0]?.label).toBe('the safe');
    expect(state?.selectedPinId).toBe('pin_1');
    // A player may drag their own character's token and nothing else.
    expect([...(state?.draggableIds ?? [])]).toEqual(['t1']);
  });

  it('is null until the scene query answers', () => {
    expect(
      composeStageState({
        scene: null,
        tokens: [],
        viewer: gm,
        encounter: null,
        selectedTokenId: null,
        tool: 'select',
        snapEnabled: true,
        aoe: null,
        scatter: null,
        fogDraft: null,
      }),
    ).toBeNull();
  });
});
