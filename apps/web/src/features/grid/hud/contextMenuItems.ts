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
import type { FogRevealAs, Point, Scene, Token, TokenLight, TokenPose } from '@safehouse/contracts';
import { regionFashion, sceneLevels, type RegionFashion } from '@safehouse/rules';
import type { DoorOpInput } from '../api.js';
import { canWorkDoor, type DoorRef } from '../doorReach.js';
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
  /** Open the look editor for a token: describe it to the AI, or dress it by hand. */
  customiseLook(tokenId: string): void;
  /** Stand, crouch or go prone — the figure on the isometric map. */
  setPose(tokenId: string, pose: TokenPose): void;
  /** Save the light a token carries (VISION.md §4.1) — here, the same one switched on or off. */
  setLight(tokenId: string, light: TokenLight | null): void;
  removeToken(tokenId: string): void;
  /** Open the roll card for a token: a player's own runner, or anyone for the GM in Play. */
  act?(token: Token): void;
  doorOp(input: DoorOpInput): void;
  pinHere(x: number, y: number): void;
  noteHere(x: number, y: number): void;
  cameraHere(x: number, y: number): void;
  placeTokenHere(x: number, y: number): void;
  /** Reveal a named fog region to the table, live (the default) or as seen before (P6). */
  revealRegion(regionId: string, as?: FogRevealAs): void;
  /** Fog a named region again, whichever way it was revealed. */
  hideRegion(regionId: string): void;
  wallToDoor(wallId: string): void;
  /** Take one square out of a painted wall, splitting it in two. */
  breakWall(cell: string, level: number): void;
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
  /**
   * The GM's mode. Build is the map itself — tokens are placed while prepping
   * the scene and its encounter, not while laying the floor they stand on.
   */
  mode?: 'build' | 'prep' | 'play';
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

/**
 * The named fog region the point is inside, if any (first match wins, like
 * the reveal), and how the table is shown it now (`regionFashion`, P6): live,
 * seen before, or hidden. `revealed` is whether it is live, as it was before
 * the seen-before fashion existed.
 */
export function regionAt(
  scene: Scene,
  at: Point,
): { id: string; name: string; revealed: boolean; fashion: RegionFashion } | null {
  for (const region of scene.fog?.regions ?? []) {
    if (pointInPolygon(at, region.polygon)) {
      const fashion = scene.fog ? regionFashion(scene.fog, region.id) : 'hidden';
      return { id: region.id, name: region.name, revealed: fashion === 'live', fashion };
    }
  }
  return null;
}

/**
 * The fog verbs for the region under the pointer (P6; the GM, 2026-09-27):
 * the two fashions it is NOT in, as the Fog panel's three buttons offer them.
 * A hidden room can be revealed live or as seen before; a live one dropped
 * to seen before (the party has left it) or fogged again; a seen-before one
 * opened live (they are back) or fogged again. The fashion it is already in
 * is no verb, and is left out.
 */
function regionItems(actions: ContextMenuActions, region: { id: string; name: string; fashion: RegionFashion }): MenuItem[] {
  const live: MenuItem = {
    id: 'fog-reveal',
    label: `Reveal ${region.name} live`,
    hint: 'players and the TV see it, and everyone in it',
    run: () => actions.revealRegion(region.id, 'live'),
  };
  const explored: MenuItem = {
    id: 'fog-explored',
    label: `Reveal ${region.name} as seen before`,
    hint: 'shown dimmed, as remembered, with nobody in it',
    run: () => actions.revealRegion(region.id, 'explored'),
  };
  const hide: MenuItem = {
    id: 'fog-hide',
    label: `Fog ${region.name} again`,
    hint: 'the table sees nothing of it',
    run: () => actions.hideRegion(region.id),
  };
  if (region.fashion === 'live') return [explored, hide];
  if (region.fashion === 'explored') return [live, hide];
  return [live, explored];
}

function tokenItems(input: ContextMenuInput, token: Token): MenuItem[] {
  const { role, actions, tokens, selectedTokenId, myCharacterId } = input;
  const items: MenuItem[] = [];
  const mine = token.source === 'character' && token.sourceId !== null && token.sourceId === myCharacterId;
  const act = actions.act;
  if (act && token.source !== 'prop' && (mine || (role === 'gm' && input.mode === 'play'))) {
    items.push({
      id: 'act',
      label: mine ? 'Act…' : 'Actions…',
      hint: mine ? 'the actions, each with its roll card' : 'its actions and the attacks on it',
      run: () => act(token),
    });
  }
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
  // Crouch behind the crates, drop flat under the window: the GM for anyone,
  // a player for their own runner. A prop has no pose.
  if (token.source !== 'prop' && (role === 'gm' || mine)) {
    const now = token.pose ?? 'stand';
    const poses: Array<[TokenPose, string]> = [
      ['stand', now === 'prone' ? 'Get up' : 'Stand up'],
      ['crouch', 'Crouch'],
      ['prone', 'Go prone'],
    ];
    for (const [pose, label] of poses) {
      if (pose !== now) items.push({ id: `pose-${pose}`, label, run: () => actions.setPose(token.id, pose) });
    }
    items.push({
      id: 'look',
      label: 'Customise look…',
      hint: 'describe it to the AI, or dress it by hand',
      run: () => actions.customiseLook(token.id),
    });
  }
  // A flashlight, a lantern: whoever may pose the token may flick its light.
  // A prop can carry one too — a flare, a burning barrel — so props are not
  // left out here the way they are from posing.
  const light = token.light;
  if (light && (role === 'gm' || mine)) {
    const lit = light.on !== false;
    items.push({
      id: 'light',
      label: lit ? 'Switch light off' : 'Switch light on',
      hint: lit ? 'it stops lighting the squares round it' : 'it lights the squares round it again',
      run: () => actions.setLight(token.id, { ...light, on: !lit }),
    });
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
  if (region) items.push(...regionItems(actions, region));
  if (input.mode !== 'build') {
    items.push({
      id: 'place',
      label: 'Place a token here',
      hint: 'opens the roster with this square filled in',
      run: () => actions.placeTokenHere(x, y),
    });
  }
  items.push(
    { id: 'pin', label: 'Pin here', run: () => actions.pinHere(x, y) },
    { id: 'note', label: 'Note here', hint: 'GM only', run: () => actions.noteHere(x, y) },
    { id: 'camera', label: 'Camera here', run: () => actions.cameraHere(x, y) },
  );
  return items;
}

/**
 * Whether this viewer may work the door the menu is about, from where their
 * runner stands (`canWorkDoor`: the GM's rule, 2026-09-27, that a player
 * opens or shuts a door only with their runner next to it). A player's menu
 * on a door out of reach is the floor's menu instead: the door's verbs are
 * left out, and a ping on it is still there to say "look at this door".
 */
function mayWorkDoor(input: ContextMenuInput, door: DoorRef): boolean {
  return canWorkDoor({
    role: input.role,
    scene: input.scene,
    tokens: input.tokens,
    myCharacterId: input.myCharacterId,
    door,
  });
}

function doorItems(input: ContextMenuInput, doorId: string): MenuItem[] {
  const { role, actions, scene } = input;
  const door = scene.geometry.doors.find((d) => d.id === doorId);
  if (!door) return [];
  if (!mayWorkDoor(input, { doorId })) return floorItems(input);
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
  if (!mayWorkDoor(input, { cell, level })) return floorItems(input);
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

/**
 * One square of a painted wall, while building. Breaking it takes out that
 * square alone, so the run it was in becomes two — which is how a room is
 * re-cut quickly: break the wall where the new corner goes, then slide the
 * half that should move.
 */
function paintedWallItems(input: ContextMenuInput, cell: string, level: number): MenuItem[] {
  if (input.role !== 'gm') return [];
  return [
    {
      id: 'wall-break',
      label: 'Break the wall here',
      hint: 'takes out this square; Ctrl+Z puts it back',
      danger: true,
      run: () => input.actions.breakWall(cell, level),
    },
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
    case 'paintedWall':
      return paintedWallItems(input, t.cell, t.level);
    case 'floor':
      return floorItems(input);
    default:
      return [];
  }
}
