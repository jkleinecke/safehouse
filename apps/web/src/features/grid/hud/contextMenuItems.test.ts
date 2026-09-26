/**
 * The context menu's rules (UX proposal 4.1): who sees which verbs about what.
 * The list is data, so this needs no canvas and no DOM.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import {
  contextMenuItems,
  regionAt,
  tileDoorState,
  type ContextMenuActions,
  type ContextMenuInput,
} from './contextMenuItems.js';

function token(id: string, over: Partial<Token> = {}): Token {
  return {
    id,
    sceneId: 's1',
    source: 'character',
    sourceId: `char-${id}`,
    name: id,
    x: 2,
    y: 2,
    size: 1,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'owner',
    ...over,
  } as Token;
}

const scene = {
  id: 's1',
  grid: { cols: 20, rows: 20, unitM: 1, offset: { x: 0, y: 0 } },
  geometry: {
    walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }],
    doors: [{ id: 'd1', a: { x: 4, y: 0 }, b: { x: 5, y: 0 }, open: false, locked: true }],
    zones: [],
    pins: [],
  },
  fog: {
    regions: [
      { id: 'r1', name: 'the office', polygon: [{ x: 10, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 15 }, { x: 10, y: 15 }] },
    ],
    revealed: [],
    revealedShapes: [],
  },
  tiles: { tilesetId: 'docklands', cells: {}, ground: {}, structure: { '3,3': 'door' }, object: {}, doors: { '3,3': { open: true, locked: false } } },
  levels: [],
} as unknown as Scene;

function actions(): ContextMenuActions & Record<string, ReturnType<typeof vi.fn>> {
  const a = {
    ping: vi.fn(),
    focus: vi.fn(),
    centerOn: vi.fn(),
    rangeBetween: vi.fn(),
    openSheet: vi.fn(),
    setHidden: vi.fn(),
    setPose: vi.fn(),
    customiseLook: vi.fn(),
    removeToken: vi.fn(),
    doorOp: vi.fn(),
    pinHere: vi.fn(),
    noteHere: vi.fn(),
    cameraHere: vi.fn(),
    placeTokenHere: vi.fn(),
    revealRegion: vi.fn(),
    hideRegion: vi.fn(),
    wallToDoor: vi.fn(),
    removeWall: vi.fn(),
    removeDoor: vi.fn(),
  };
  return a as unknown as ContextMenuActions & Record<string, ReturnType<typeof vi.fn>>;
}

function input(over: Partial<ContextMenuInput>): ContextMenuInput {
  return {
    role: 'gm',
    target: { kind: 'floor' },
    grid: { x: 1, y: 1 },
    scene,
    tokens: [token('Whisper'), token('Ganger', { source: 'npc_template', sourceId: 'npc-1', hidden: true, x: 6, y: 6 })],
    selectedTokenId: null,
    myCharacterId: null,
    actions: actions(),
    ...over,
  };
}

const ids = (items: ReturnType<typeof contextMenuItems>) => items.map((i) => i.id);

describe('the token menu', () => {
  it('gives the GM the token verbs and runs the same mutations the panel does', () => {
    const inp = input({ target: { kind: 'token', id: 'Ganger' } });
    const items = contextMenuItems(inp);
    // A standing figure can crouch or go prone (2026-09-25: tokens are figures on the iso map).
    expect(ids(items)).toEqual(['center', 'pose-crouch', 'pose-prone', 'look', 'hidden', 'remove']);
    items.find((i) => i.id === 'pose-prone')!.run();
    expect(inp.actions.setPose).toHaveBeenCalledWith('Ganger', 'prone');
    items.find((i) => i.id === 'hidden')!.run();
    expect(inp.actions.setHidden).toHaveBeenCalledWith('Ganger', false);
    expect(items.find((i) => i.id === 'hidden')!.label).toBe('Reveal to players');
  });

  it('offers range from the selected token, and the sheet for a character', () => {
    const inp = input({ target: { kind: 'token', id: 'Ganger' }, selectedTokenId: 'Whisper' });
    const items = contextMenuItems(inp);
    expect(ids(items)).toEqual(['range', 'center', 'pose-crouch', 'pose-prone', 'look', 'hidden', 'remove']);
    items[0]!.run();
    expect(inp.actions.rangeBetween).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'Whisper' }),
      expect.objectContaining({ id: 'Ganger' }),
    );
    expect(ids(contextMenuItems(input({ target: { kind: 'token', id: 'Whisper' } })))).toContain('sheet');
  });

  it('shows a player their own sheet and range from their runner, never hide or remove', () => {
    const own = contextMenuItems(input({ role: 'player', myCharacterId: 'char-Whisper', target: { kind: 'token', id: 'Whisper' } }));
    // Their own runner's pose is theirs to set; nobody else's is.
    expect(ids(own)).toEqual(['center', 'sheet', 'pose-crouch', 'pose-prone', 'look']);
    expect(own.find((i) => i.id === 'sheet')!.label).toBe('Open my sheet');
    const other = contextMenuItems(input({ role: 'player', myCharacterId: 'char-Whisper', target: { kind: 'token', id: 'Ganger' } }));
    expect(ids(other)).toEqual(['range', 'center']);
    expect(other[0]!.label).toBe('Range from Whisper');
  });
});

describe('the floor menu', () => {
  it('is ping alone for a player, and the GM verbs for the GM', () => {
    expect(ids(contextMenuItems(input({ role: 'player' })))).toEqual(['ping']);
    expect(ids(contextMenuItems(input({})))).toEqual(['ping', 'focus', 'place', 'pin', 'note', 'camera']);
  });

  it('offers the fog region under the pointer, reveal or re-fog', () => {
    const inside = input({ grid: { x: 12, y: 12 } });
    expect(ids(contextMenuItems(inside))).toContain('fog-reveal');
    contextMenuItems(inside).find((i) => i.id === 'fog-reveal')!.run();
    expect(inside.actions.revealRegion).toHaveBeenCalledWith('r1');
    const revealed = { ...scene, fog: { ...scene.fog, revealed: ['r1'] } } as Scene;
    expect(ids(contextMenuItems(input({ grid: { x: 12, y: 12 }, scene: revealed })))).toContain('fog-hide');
    expect(regionAt(scene, { x: 1, y: 1 })).toBeNull();
  });

  it('is empty for an observer or the TV', () => {
    expect(contextMenuItems(input({ role: 'observer' }))).toEqual([]);
    expect(contextMenuItems(input({ role: 'display', target: { kind: 'token', id: 'Whisper' } }))).toEqual([]);
  });
});

describe('doors and walls', () => {
  it('opens for anyone, locks and removes for the GM only', () => {
    const gm = input({ target: { kind: 'door', id: 'd1' } });
    expect(ids(contextMenuItems(gm))).toEqual(['door-toggle', 'door-lock', 'door-remove']);
    contextMenuItems(gm)[0]!.run();
    expect(gm.actions.doorOp).toHaveBeenCalledWith({ doorId: 'd1', op: 'open' });
    expect(contextMenuItems(gm)[1]!.label).toBe('Unlock it');
    expect(ids(contextMenuItems(input({ role: 'player', target: { kind: 'door', id: 'd1' } })))).toEqual(['door-toggle']);
  });

  it('reads a painted door off its floor', () => {
    expect(tileDoorState(scene, 0, '3,3')).toEqual({ open: true, locked: false });
    const inp = input({ target: { kind: 'tileDoor', cell: '3,3', level: 0 } });
    const items = contextMenuItems(inp);
    expect(items[0]!.label).toBe('Close the door');
    items[0]!.run();
    expect(inp.actions.doorOp).toHaveBeenCalledWith({ cell: '3,3', level: 0, op: 'close' });
  });

  it('turns a wall into a door or removes it, GM only', () => {
    expect(ids(contextMenuItems(input({ target: { kind: 'wall', id: 'w1' } })))).toEqual(['wall-door', 'wall-remove']);
    expect(contextMenuItems(input({ role: 'player', target: { kind: 'wall', id: 'w1' } }))).toEqual([]);
  });
});
