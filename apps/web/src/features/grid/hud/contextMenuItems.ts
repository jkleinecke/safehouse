/**
 * The map's context menu, as data (UX proposal 4.1).
 *
 * Roll20 and Foundry taught every GM that the token IS the menu: right-click
 * the thing and the verbs for it are there, at the cursor, with no tool
 * switch first. This file decides which verbs, for whom, about what — pure,
 * so the rules ("a player sees ping and range, the GM sees hide and remove")
 * are unit-tested without a canvas. `ContextMenu.tsx` only draws the list;
 * `GridPage` supplies the actions, which are the same mutations the panel
 * tabs and the inspector already call.
 */
import type { Point, Scene, Token } from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import type { DoorOpInput } from '../api.js';
import { pointInPolygon } from '../geometry.js';
import type { ContextTarget } from '../types.js';

export interface MenuItem {
  id: string;
  label: string;
  /** Second line, quieter: what the verb does or why it is here. */
  hint?: string;
  danger?: boolean;
  run: () => void;
}

export interface ContextMenuActions {
  ping(x: number, y: number): void;
  /** GM: push "focus here" to every screen. */
  focus(x: number, y: number): void;
  centerOn(x: number, y: number): void;
  /** Measure between two tokens: the range readout and its roll modifier. */
  rangeBetween(from: Token, to: Token): void;
  openSheet(characterId: string): void;
  setHidden(tokenId: string, hidden: boolean): void;
  removeToken(tokenId: string): void;
  doorOp(input: DoorOpInput): void;
  pinHere(x: number, y: number): void;
  noteHere(x: number, y: number): void;
  cameraHere(x: number, y: number): void;
  placeTokenHere(x: number, y: number): void;
  revealRegion(regionId: string): void;
  hideRegion(regionId: string): void;
  wallToDoor(wallId: string): void;
  removeWall(wallId: string): void;
  removeDoor(doorId: string): void;
}

export interface ContextMenuInput {
  role: 'gm' | 'player' | 'observer' | 'display';
  target: ContextTarget;
  grid: Point;
  scene: Scene;
  tokens: readonly Token[];
  selectedTokenId: string | null;
  /** The viewer's own runner, when they are a player with a sheet. */
  myCharacterId: string | null;
  actions: ContextMenuActions;
}

/** The painted door in `cell` on `level`, or null when nothing is painted there. */
export function tileDoorState(
  scene: Scene,
  level: number,
  cell: string,
): { open: boolean; locked: boolean } | null {
  const floor = sceneLevels(scene)[level];
  const door = floor?.tiles?.doors?.[cell];
  if (!door) return { open: false, locked: false };
  return { open: door.open === true, locked: door.locked === true };
}

/** The named fog region the point is inside, if any (first match wins, like the reveal). */
export function regionAt(scene: Scene, at: Point): { id: string; name: string; revealed: boolean } | null {
  for (const region of scene.fog?.regions ?? []) {
    if (pointInPolygon(at, region.polygon)) {
      return { id: region.id, name: region.name, revealed: (scene.fog?.revealed ?? []).includes(region.id) };
    }
  }
  return null;
}

function tokenItems(input: ContextMenuInput, token: Token): MenuItem[] {
  const { role, actions, tokens, selectedTokenId, myCharacterId } = input;
  const items: MenuItem[] = [];
  const mine = token.source === 'character' && token.sourceId !== null && token.sourceId === myCharacterId;
  // The other token to measure from: the selected one, or the viewer's own.
  const other =
    tokens.find((t) => t.id !== token.id && t.id === selectedTokenId) ??
    (role === 'player' && !mine
      ? tokens.find((t) => t.source === 'character' && t.sourceId === myCharacterId)
      : undefined);
  if (other) {
    items.push({
      id: 'range',
      label: `Range from ${other.name}`,
      hint: 'the readout and the roll modifier, without the ruler',
      run: () => actions.rangeBetween(other, token),
    });
  }
  items.push({ id: 'center', label: 'Centre on it', run: () => actions.centerOn(token.x, token.y) });
  if (token.source === 'character' && token.sourceId && (role === 'gm' || mine)) {
    const id = token.sourceId;
    items.push({ id: 'sheet', label: mine ? 'Open my sheet' : `Open ${token.name}'s sheet`, run: () => actions.openSheet(id) });
  }
  if (role === 'gm') {
    items.push({
      id: 'hidden',
      label: token.hidden ? 'Reveal to players' : 'Hide from players',
      hint: token.hidden ? 'it appears on every screen' : 'players and the TV stop seeing it',
      run: () => actions.setHidden(token.id, !token.hidden),
    });
    items.push({
      id: 'remove',
      label: 'Remove from the scene',
      hint: 'Ctrl+Z puts it back',
      danger: true,
      run: () => actions.removeToken(token.id),
    });
  }
  return items;
}

function floorItems(input: ContextMenuInput): MenuItem[] {
  const { role, actions, grid, scene } = input;
  const x = grid.x;
  const y = grid.y;
  const items: MenuItem[] = [
    { id: 'ping', label: 'Ping here', hint: 'a flash on every screen', run: () => actions.ping(x, y) },
  ];
  if (role !== 'gm') return items;
  items.push({ id: 'focus', label: 'Focus everyone here', hint: 'pans the players and the TV', run: () => actions.focus(x, y) });
  const region = regionAt(scene, grid);
  if (region) {
    items.push(
      region.revealed
        ? { id: 'fog-hide', label: `Fog ${region.name} again`, run: () => actions.hideRegion(region.id) }
        : {
            id: 'fog-reveal',
            label: `Reveal ${region.name}`,
            hint: 'players and the TV see it now',
            run: () => actions.revealRegion(region.id),
          },
    );
  }
  items.push(
    { id: 'place', label: 'Place a token here', hint: 'opens the roster with this square filled in', run: () => actions.placeTokenHere(x, y) },
    { id: 'pin', label: 'Pin here', run: () => actions.pinHere(x, y) },
    { id: 'note', label: 'Note here', hint: 'GM only', run: () => actions.noteHere(x, y) },
    { id: 'camera', label: 'Camera here', run: () => actions.cameraHere(x, y) },
  );
  return items;
}

function doorItems(input: ContextMenuInput, doorId: string): MenuItem[] {
  const { role, actions, scene } = input;
  const door = scene.geometry.doors.find((d) => d.id === doorId);
  if (!door) return [];
  const items: MenuItem[] = [
    {
      id: 'door-toggle',
      label: door.open ? 'Close the door' : 'Open the door',
      run: () => actions.doorOp({ doorId, op: door.open ? 'close' : 'open' }),
    },
  ];
  if (role === 'gm') {
    items.push({
      id: 'door-lock',
      label: door.locked ? 'Unlock it' : 'Lock it',
      hint: door.locked ? 'players can open it again' : 'players are refused; you are not',
      run: () => actions.doorOp({ doorId, op: door.locked ? 'unlock' : 'lock' }),
    });
    items.push({ id: 'door-remove', label: 'Remove the door', danger: true, run: () => actions.removeDoor(doorId) });
  }
  return items;
}

function tileDoorItems(input: ContextMenuInput, cell: string, level: number): MenuItem[] {
  const { role, actions, scene } = input;
  const state = tileDoorState(scene, level, cell);
  if (!state) return [];
  const items: MenuItem[] = [
    {
      id: 'door-toggle',
      label: state.open ? 'Close the door' : 'Open the door',
      run: () => actions.doorOp({ cell, level, op: state.open ? 'close' : 'open' }),
    },
  ];
  if (role === 'gm') {
    items.push({
      id: 'door-lock',
      label: state.locked ? 'Unlock it' : 'Lock it',
      run: () => actions.doorOp({ cell, level, op: state.locked ? 'unlock' : 'lock' }),
    });
  }
  return items;
}

function wallItems(input: ContextMenuInput, wallId: string): MenuItem[] {
  if (input.role !== 'gm') return [];
  return [
    {
      id: 'wall-door',
      label: 'Make it a door',
      hint: 'same segment; it opens, shuts and locks',
      run: () => input.actions.wallToDoor(wallId),
    },
    { id: 'wall-remove', label: 'Remove the wall', hint: 'Ctrl+Z puts it back', danger: true, run: () => input.actions.removeWall(wallId) },
  ];
}

/** The menu for this pointer, this viewer, this target. Empty means: no menu. */
export function contextMenuItems(input: ContextMenuInput): MenuItem[] {
  if (input.role === 'observer' || input.role === 'display') return [];
  const t = input.target;
  switch (t.kind) {
    case 'token': {
      const token = input.tokens.find((k) => k.id === t.id);
      return token ? tokenItems(input, token) : [];
    }
    case 'door':
      return doorItems(input, t.id);
    case 'tileDoor':
      return tileDoorItems(input, t.cell, t.level);
    case 'wall':
      return wallItems(input, t.id);
    case 'floor':
      return floorItems(input);
    default:
      return [];
  }
}
