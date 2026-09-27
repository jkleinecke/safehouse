/**
 * Which doors the map offers (doorReach.ts): the GM everywhere, a player
 * only beside their own runner, anyone else never. The geometry itself is
 * pinned in the rules (reach.test.ts); this pins who is asked about which
 * token, and that the answer is the rules' answer.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import { canWorkDoor, type DoorReachInput } from './doorReach.js';

const scene = {
  geometry: {
    walls: [],
    // Down the grid line x = 4, from y = 0 to y = 2.
    doors: [{ id: 'd.front', a: { x: 4, y: 0 }, b: { x: 4, y: 2 }, open: false, locked: false }],
    zones: [],
    pins: [],
  },
} as unknown as Scene;

function token(sourceId: string, col: number, row: number, over: Partial<Token> = {}): Token {
  return {
    id: `t-${sourceId}-${col}-${row}`,
    sceneId: 's1',
    source: 'character',
    sourceId,
    name: sourceId,
    x: col + 0.5,
    y: row + 0.5,
    size: 1,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'owner',
    ...over,
  } as Token;
}

function input(over: Partial<DoorReachInput>): DoorReachInput {
  return {
    role: 'player',
    scene,
    tokens: [],
    myCharacterId: 'char-static',
    door: { doorId: 'd.front' },
    ...over,
  };
}

describe('canWorkDoor', () => {
  it('lets the GM work any door from anywhere, with no runner at all', () => {
    expect(canWorkDoor(input({ role: 'gm', myCharacterId: null }))).toBe(true);
    expect(canWorkDoor(input({ role: 'gm', door: { cell: '20,20', level: 3 } }))).toBe(true);
  });

  it('lets a player work a traced door only with their runner beside its line', () => {
    expect(canWorkDoor(input({ tokens: [token('char-static', 3, 1)] }))).toBe(true);
    expect(canWorkDoor(input({ tokens: [token('char-static', 4, 2)] }))).toBe(true);
    // A square back from the line is too far.
    expect(canWorkDoor(input({ tokens: [token('char-static', 2, 1)] }))).toBe(false);
    expect(canWorkDoor(input({ tokens: [token('char-static', 4, 3)] }))).toBe(false);
  });

  it('lets a player work a painted door from its square and the eight round it, on its floor', () => {
    const door = { cell: '3,4', level: 0 };
    expect(canWorkDoor(input({ door, tokens: [token('char-static', 2, 3)] }))).toBe(true);
    expect(canWorkDoor(input({ door, tokens: [token('char-static', 4, 5)] }))).toBe(true);
    expect(canWorkDoor(input({ door, tokens: [token('char-static', 5, 4)] }))).toBe(false);
    // The floor above, over the same square, is not beside it.
    expect(canWorkDoor(input({ door, tokens: [token('char-static', 3, 3, { level: 1 })] }))).toBe(false);
    expect(canWorkDoor(input({ door: { cell: '3,4', level: 1 }, tokens: [token('char-static', 3, 3, { level: 1 })] }))).toBe(true);
  });

  it('asks about the player’s own runner, never someone else’s token or a prop', () => {
    const beside = [token('char-other', 3, 1), token('char-static', 12, 12), token('prop-1', 3, 1, { source: 'prop' })];
    expect(canWorkDoor(input({ tokens: beside }))).toBe(false);
    // A second token of their runner, beside the door, is enough.
    expect(canWorkDoor(input({ tokens: [...beside, token('char-static', 4, 0)] }))).toBe(true);
  });

  it('offers nothing to a player with no runner, an observer or the table’s display, or for a door that is not there', () => {
    const runner = [token('char-static', 3, 1)];
    expect(canWorkDoor(input({ myCharacterId: null, tokens: runner }))).toBe(false);
    expect(canWorkDoor(input({ role: 'observer', tokens: runner }))).toBe(false);
    expect(canWorkDoor(input({ role: 'display', tokens: runner }))).toBe(false);
    expect(canWorkDoor(input({ door: { doorId: 'd.nowhere' }, tokens: runner }))).toBe(false);
  });
});
