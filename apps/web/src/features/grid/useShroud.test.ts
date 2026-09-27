/**
 * Whose eyes the canvas shows (FR9.16).
 *
 * The resolution rules are where a mistake would be felt at the table: a
 * player shown the wrong character's sightline is worse than one shown none,
 * and a GM silently locked into a token's view cannot run the map.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import {
  cameraLensId,
  sightInputsKey,
  viewpointCameraId,
  viewpointTokenId,
  type ShroudInputs,
} from './useShroud.js';

const token = (id: string, over: Partial<Token> = {}): Token =>
  ({
    id,
    name: id,
    source: 'character',
    sourceId: `char-${id}`,
    x: 1.5,
    y: 1.5,
    size: 1,
    ...over,
  }) as Token;

const base = (over: Partial<ShroudInputs> = {}): ShroudInputs => ({
  scene: undefined,
  tokens: [],
  isGm: false,
  losTokenId: null,
  myCharacterId: null,
  enabledForPlayers: false,
  ...over,
});

describe('viewpointTokenId', () => {
  it('gives the GM nobody by default', () => {
    // A GM permanently limited to one token's view cannot do their job, so
    // the lens starts down.
    expect(viewpointTokenId(base({ isGm: true }))).toBeNull();
  });

  it('honours the GM pick, including an NPC', () => {
    // "What does the guard see" is the question that makes this worth having.
    const guard = token('guard', { source: 'combatant', sourceId: null });
    expect(viewpointTokenId(base({ isGm: true, losTokenId: 'guard', tokens: [guard] }))).toBe(
      'guard',
    );
  });

  it('shows a player nothing while the GM has it switched off', () => {
    const mine = token('t1');
    expect(
      viewpointTokenId(base({ tokens: [mine], myCharacterId: 'char-t1', enabledForPlayers: false })),
    ).toBeNull();
  });

  it('resolves a player to their OWN character token', () => {
    const mine = token('t1');
    const theirs = token('t2');
    expect(
      viewpointTokenId(
        base({ tokens: [theirs, mine], myCharacterId: 'char-t1', enabledForPlayers: true }),
      ),
    ).toBe('t1');
  });

  it('never hands a player somebody elses eyes', () => {
    // The failure that would matter: a device with no character of its own
    // must get NO viewpoint, not the first token on the map.
    const theirs = token('t2');
    expect(
      viewpointTokenId(base({ tokens: [theirs], myCharacterId: null, enabledForPlayers: true })),
    ).toBeNull();
    expect(
      viewpointTokenId(
        base({ tokens: [theirs], myCharacterId: 'char-nobody', enabledForPlayers: true }),
      ),
    ).toBeNull();
  });

  it('ignores a non-character token that happens to share a sourceId', () => {
    // Props and NPCs carry sourceIds too; only a character token is "mine".
    const prop = token('p1', { source: 'prop', sourceId: 'char-t1' });
    expect(
      viewpointTokenId(base({ tokens: [prop], myCharacterId: 'char-t1', enabledForPlayers: true })),
    ).toBeNull();
  });

  it('lets the GM pick win over their own party token', () => {
    const mine = token('t1');
    const guard = token('guard', { source: 'combatant', sourceId: null });
    expect(
      viewpointTokenId(
        base({
          isGm: true,
          losTokenId: 'guard',
          tokens: [mine, guard],
          myCharacterId: 'char-t1',
          enabledForPlayers: true,
        }),
      ),
    ).toBe('guard');
  });
});

describe('the camera lens (FR9.23)', () => {
  it('names a camera, for the GM only', () => {
    expect(viewpointCameraId(base({ isGm: true, losTokenId: cameraLensId('cam_1') }))).toBe('cam_1');
    // A camera lens is not a token, so the token resolver stands down.
    expect(viewpointTokenId(base({ isGm: true, losTokenId: cameraLensId('cam_1') }))).toBeNull();
    // A player's scene never carries cameras; a lens id from them means nothing.
    expect(viewpointCameraId(base({ isGm: false, losTokenId: cameraLensId('cam_1') }))).toBeNull();
    expect(viewpointCameraId(base({ isGm: true, losTokenId: 'tok_1' }))).toBeNull();
  });
});

describe('sightInputsKey: what rebuilds the shroud', () => {
  // A ground floor with a wall and a painted door in it.
  const scene = (over: Partial<Scene> = {}): Scene =>
    ({
      id: 's1',
      grid: { cols: 10, rows: 10, unitM: 1 },
      geometry: { walls: [], doors: [], zones: [], pins: [] },
      levels: [],
      fog: { regions: [], revealed: [], revealedShapes: [] },
      tiles: {
        tilesetId: 'docklands',
        cells: {},
        ground: {},
        structure: { '5,3': 'wall', '5,4': 'door' },
        object: {},
      },
      ...over,
    }) as Scene;
  const tiles = scene().tiles!;

  it('changes when a painted door opens, which used to leave the shroud showing it shut', () => {
    const shut = sightInputsKey(scene());
    const open = sightInputsKey(scene({ tiles: { ...tiles, doors: { '5,4': { open: true, locked: false } } } }));
    expect(open).not.toBe(shut);
  });

  it('changes with the ground layer, the legacy cells and the tileset', () => {
    const before = sightInputsKey(scene());
    expect(sightInputsKey(scene({ tiles: { ...tiles, ground: { '1,1': 'floor' } } }))).not.toBe(before);
    expect(sightInputsKey(scene({ tiles: { ...tiles, cells: { '2,2': 'wall' } } }))).not.toBe(before);
    expect(sightInputsKey(scene({ tiles: { ...tiles, tilesetId: 'corp' } }))).not.toBe(before);
  });

  it('still changes with traced doors and upper floors, and not with the fog or a pin', () => {
    const before = sightInputsKey(scene());
    const door = { id: 'd1', a: { x: 1, y: 1 }, b: { x: 1, y: 2 }, open: false, locked: false };
    const shut = sightInputsKey(scene({ geometry: { walls: [], doors: [door], zones: [], pins: [] } }));
    const open = sightInputsKey(scene({ geometry: { walls: [], doors: [{ ...door, open: true }], zones: [], pins: [] } }));
    expect(shut).not.toBe(before);
    expect(open).not.toBe(shut);
    expect(sightInputsKey(scene({ levels: [{ id: 'l1', name: 'Roof' }] }))).not.toBe(before);
    // Neither blocks a look: the shroud is not rebuilt for them.
    expect(sightInputsKey(scene({ fog: { regions: [], revealed: ['r1'], revealedShapes: [] } }))).toBe(before);
    expect(
      sightInputsKey(
        scene({ geometry: { walls: [], doors: [], zones: [], pins: [{ id: 'p', at: { x: 1, y: 1 }, visibility: 'public' }] } }),
      ),
    ).toBe(before);
    expect(sightInputsKey(null)).toBe('');
  });
});
