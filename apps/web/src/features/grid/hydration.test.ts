import { describe, expect, it } from 'vitest';
import type { Combatant, Encounter, Scene, Token } from '@safehouse/contracts';
import { cellBitsFrom, encodeCellBits } from '@safehouse/rules';
import { addPin, emptyGeometry } from './geometryEdit.js';
import {
  composeStageState,
  DEFAULT_DISPLAY,
  displayFromEvents,
  mergeEncounter,
  pickEncounterId,
  resolveSceneId,
  tokensBelow,
  tokensInSight,
} from './hydration.js';
import type { Viewer } from './projection.js';
import { tvStageState } from './tvStage.js';

// --- fixtures ---------------------------------------------------------------

function scene(patch: Partial<Scene> = {}): Scene {
  return {
    id: 'sc1',
    campaignId: 'c1',
    name: 'Loading dock',
    state: 'active',
    grid: { unitM: 1, cols: 20, rows: 12, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: emptyGeometry(),
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
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
    level: 0,
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

describe('token layers reach the canvas (FR9.26)', () => {
  it('names the tokens on hidden layers, and none when the scene has no layers', () => {
    const base = {
      tokens: [token(), token({ id: 't2', sourceId: null, source: 'prop' as const })],
      viewer: gm,
      encounter: null,
      selectedTokenId: null,
      tool: 'select' as const,
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
    };
    const layered = composeStageState({
      ...base,
      scene: scene({
        tokenLayers: [
          { id: 'layer_1', name: 'Ambush', hidden: true, tokenIds: ['t2'] },
          { id: 'layer_2', name: 'Shown', hidden: false, tokenIds: ['t1'] },
        ],
      }),
    });
    expect([...(layered?.hiddenLayerTokenIds ?? [])]).toEqual(['t2']);
    // The GM still has both on the canvas — hidden means ghosted for them, not gone.
    expect(layered?.tokens.map((t) => t.id)).toEqual(['t1', 't2']);
    const plain = composeStageState({ ...base, scene: scene() });
    expect(plain?.hiddenLayerTokenIds?.size).toBe(0);
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
      selection: { kind: 'pin', id: 'pin_1' },
    });
    expect(state?.actingTokenId).toBeNull();
    expect(state?.bars.size).toBe(0);
    expect(state?.scene.geometry.pins[0]?.label).toBe('the safe');
    expect(state?.selection).toEqual({ kind: 'pin', id: 'pin_1' });
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

describe('tokensInSight (FR9.16)', () => {
  const player: Viewer = { role: 'player', userId: 'u2', characterId: 'char-me' };
  const mine = token({ id: 'me', source: 'character', sourceId: 'char-me', x: 2.5, y: 2.5 });
  const guardInView = token({ id: 'g1', source: 'npc_template', sourceId: null, x: 5.5, y: 2.5 });
  const guardBehindWall = token({ id: 'g2', source: 'npc_template', sourceId: null, x: 9.5, y: 2.5 });
  const shroud = { visible: new Set(['2,2', '3,2', '4,2', '5,2']), gm: false };

  it('draws a player only the tokens their runner can see, and always their own', () => {
    const drawn = tokensInSight([mine, guardInView, guardBehindWall], player, shroud);
    expect(drawn.map((t) => t.id)).toEqual(['me', 'g1']);
  });

  it('draws everything when there is no sightline to apply', () => {
    expect(tokensInSight([mine, guardBehindWall], player, null)).toHaveLength(2);
  });

  it('is a lens for the GM, not a limit', () => {
    const drawn = tokensInSight([mine, guardBehindWall], gm, { ...shroud, gm: true });
    expect(drawn).toHaveLength(2);
  });

  it('feeds the stage frame, so bars and drags follow what is drawn', () => {
    const state = composeStageState({
      scene: scene(),
      tokens: [mine, guardBehindWall],
      viewer: player,
      encounter: null,
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
      shroud,
    });
    expect(state?.tokens.map((t) => t.id)).toEqual(['me']);
  });
});

/**
 * The second guard (sightlines, P6; FR9.13): whatever a device holds, it
 * draws a token for the table only while it stands on LIVE ground. The
 * server already withholds the others from a player's and the TV's copy;
 * this is the rule again on the device, for a copy of the tokens a beat
 * ahead of its copy of the sight, and the whole rule for the GM's "See as
 * party" lens, whose copy holds everyone.
 */
describe('the table is drawn only the tokens on live ground (P6)', () => {
  const COLS = 20;
  const ROWS = 12;
  type Cells = [number, number][];
  const bits = (cells: Cells): string => encodeCellBits(cellBitsFrom(COLS, ROWS, cells.map(([col, row]) => ({ col, row }))));

  // The runners see the corridor at (2,2) and (3,2), and remember the room at (8,8).
  const sight = {
    cols: COLS,
    rows: ROWS,
    levels: { '0': { live: bits([[2, 2], [3, 2]]), explored: bits([[2, 2], [3, 2], [8, 8]]) } },
  };
  /** A player's (and the TV's) copy: fogged by the sightlines, said with `active`. */
  const tableCopy = scene({ fog: { regions: [], revealed: [], revealedShapes: [], sight, active: true } });
  /** The GM's copy of the same scene: no `active`, the sightlines on. */
  const gmCopy = scene({ fog: { regions: [], revealed: [], revealedShapes: [], sight }, vision: { playersSeeOwnSight: false, sight: 'on' } });

  const me = token({ id: 'me', source: 'character', sourceId: 'ch1', x: 10.5, y: 10.5 });
  const inCorridor = token({ id: 'g-live', source: 'npc_template', sourceId: null, x: 3.5, y: 2.5 });
  const inRememberedRoom = token({ id: 'g-explored', source: 'npc_template', sourceId: null, x: 8.5, y: 8.5 });
  const inTheDark = token({ id: 'g-hidden', source: 'npc_template', sourceId: null, x: 15.5, y: 5.5 });
  // Two squares across, (3..4, 2..3): one of them is in the corridor.
  const van = token({ id: 'van', source: 'prop', sourceId: null, x: 4, y: 3, size: 2 });
  const everyone = [me, inCorridor, inRememberedRoom, inTheDark, van];

  function drawn(copy: Scene, viewer: Viewer, over: Partial<Parameters<typeof composeStageState>[0]> = {}): string[] {
    const state = composeStageState({
      scene: copy,
      tokens: everyone,
      viewer,
      encounter: null,
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
      ...over,
    });
    return (state?.tokens ?? []).map((t) => t.id);
  }

  it('draws a player the runners anywhere, and everyone else only where the table sees live', () => {
    expect(drawn(tableCopy, player)).toEqual(['me', 'g-live', 'van']);
  });

  it('draws the TV and an observer the same', () => {
    expect(drawn(tableCopy, { role: 'display', userId: 'u_tv' })).toEqual(['me', 'g-live', 'van']);
    expect(drawn(tableCopy, { role: 'observer', userId: 'u_o' })).toEqual(['me', 'g-live', 'van']);
    const tv = tvStageState({ scene: tableCopy, tokens: everyone, level: 0 });
    expect(tv.tokens.map((t) => t.id)).toEqual(['me', 'g-live', 'van']);
  });

  it('keeps every token on the GM screen', () => {
    expect(drawn(gmCopy, gm)).toEqual(['me', 'g-live', 'g-explored', 'g-hidden', 'van']);
  });

  it('shows the GM exactly what the table is shown under the party lens, the GM-hidden tokens gone too', () => {
    const hidden = token({ id: 'g-flagged', source: 'npc_template', sourceId: null, x: 2.5, y: 2.5, hidden: true });
    const layered = token({ id: 'g-layered', source: 'npc_template', sourceId: null, x: 3.5, y: 2.5 });
    const copy = { ...gmCopy, tokenLayers: [{ id: 'l1', name: 'ambush', hidden: true, tokenIds: ['g-layered'] }] };
    const state = composeStageState({
      scene: copy,
      tokens: [...everyone, hidden, layered],
      viewer: gm,
      encounter: null,
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
      shroud: { visible: new Set(['2,2', '3,2']), gm: true, party: true },
    });
    expect(state?.tokens.map((t) => t.id)).toEqual(['me', 'g-live', 'van']);
    // A token's own lens is still a lens, not a limit: nobody is taken off.
    expect(drawn(gmCopy, gm, { shroud: { visible: new Set(['2,2']), gm: true } })).toHaveLength(everyone.length);
  });

  it('draws everyone on an open scene, whatever the party remembers', () => {
    const open = scene({ fog: { regions: [], revealed: [], revealedShapes: [], sight, active: false } });
    expect(drawn(open, player)).toEqual(['me', 'g-live', 'g-explored', 'g-hidden', 'van']);
    // And a scene without sightlines or fog at all is exactly as it was.
    expect(drawn(scene(), player)).toEqual(['me', 'g-live', 'g-explored', 'g-hidden', 'van']);
  });

  it('draws the ground revealed live by the GM as live, and nobody on ground revealed as seen before', () => {
    const square = (x: number, y: number) => [{ x, y }, { x: x + 2, y }, { x: x + 2, y: y + 2 }, { x, y: y + 2 }];
    const copy = scene({
      fog: {
        regions: [
          { id: 'r-live', name: 'lobby', polygon: square(14, 4) },
          { id: 'r-seen', name: 'vault', polygon: square(7, 7) },
        ],
        revealed: ['r-live'],
        revealedShapes: [],
        exploredRegionIds: ['r-seen'],
        active: true,
      },
    });
    // No sight on this copy: only the lobby is live, and the guard standing
    // in it is the one the corridor fixture calls g-hidden.
    expect(drawn(copy, player)).toEqual(['me', 'g-hidden']);
  });

  it('applies the same rule to the tokens seen below through the open squares', () => {
    const below = composeStageState({
      scene: tableCopy,
      tokens: everyone,
      viewer: player,
      encounter: null,
      selectedTokenId: null,
      tool: 'select',
      snapEnabled: true,
      aoe: null,
      scatter: null,
      fogDraft: null,
      level: 1,
    });
    expect((below?.belowTokens ?? []).map((b) => b.token.id)).toEqual(['me', 'g-live', 'van']);
  });
});

describe('tokens on the floors below', () => {
  // A mezzanine over a ballroom: the ring is painted, the void over the
  // dance floor is not.
  const scene = {
    tiles: { tilesetId: 'corp', cells: {}, ground: { '5,5': 'carpet', '1,1': 'carpet' }, structure: {}, object: {} },
    levels: [{ id: 'mezz', name: 'Mezzanine', tiles: { tilesetId: 'corp', cells: {}, ground: { '1,1': 'carpet' }, structure: {}, object: {} } }],
  } as unknown as Scene;
  const token = (id: string, x: number, y: number, level: number) => ({ id, x, y, level }) as unknown as Token;

  it('shows a token below where every floor between leaves its square empty', () => {
    const below = tokensBelow(scene, [token('dancer', 5.5, 5.5, 0), token('waiter', 1.5, 1.5, 0), token('up', 5.5, 5.5, 1)], 1);
    expect(below.map((b) => [b.token.id, b.depth])).toEqual([['dancer', 1]]);
  });

  it('shows nothing below from the ground floor', () => {
    expect(tokensBelow(scene, [token('dancer', 5.5, 5.5, 0)], 0)).toEqual([]);
  });
});

