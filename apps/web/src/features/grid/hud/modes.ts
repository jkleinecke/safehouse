/**
 * The Grid's three modes — Build · Prep · Play — and what belongs to each.
 *
 * Twelve tabs and fourteen tools at one level was twenty-six choices before a
 * GM had decided what they were doing (docs/UX_MAP_BUILDER.md §2, Hick's Law).
 * A mode is that decision, made once: the toolbar shows only the mode's
 * tools and the panel only its sections. Scenes sit in every mode, because
 * switching scenes is not a mode.
 *
 * Pure, so the store and the tests can agree on it without a DOM. Picking a
 * tool or a tab that belongs to another mode switches to that mode — the GM
 * asked for the thing, not for the mode it lives in.
 */
import type { GmTab } from '../store.js';
import type { GridTool } from '../types.js';

export type GridMode = 'build' | 'prep' | 'play';

export const MODES: ReadonlyArray<{ id: GridMode; label: string; hint: string }> = [
  { id: 'build', label: 'Build', hint: 'The map itself: image, floors, tiles, walls, doors, pins' },
  { id: 'prep', label: 'Prep', hint: 'What only you know: fog, cameras, notes, hidden tokens, the weather' },
  { id: 'play', label: 'Play', hint: 'Friday night: tokens, measuring, the fight, the TV' },
];

/** Which panel sections each mode shows, in order. Scenes is first in all three. */
export const MODE_TABS: Record<GridMode, readonly GmTab[]> = {
  build: ['scenes', 'map', 'tiles', 'geo', 'pins'],
  prep: ['scenes', 'tokens', 'fog', 'cameras', 'notes', 'env', 'los'],
  play: ['scenes', 'tokens', 'los', 'tv'],
};

/** Which tools each mode's toolbar offers a GM, in order. */
export const MODE_TOOLS: Record<GridMode, readonly GridTool[]> = {
  build: ['select', 'tile-room', 'tile-area', 'tile', 'tile-erase', 'wall', 'door', 'zone', 'pin'],
  prep: ['select', 'fogdef', 'camera', 'note'],
  play: ['select', 'ruler', 'aoe', 'pointer', 'focus'],
};

/** The tools a player has — the same in every mode, because players have no modes. */
export const PLAYER_TOOLS: readonly GridTool[] = ['select', 'ruler', 'aoe', 'pointer'];

/** The mode a tool lives in, or null for tools every mode has (select). */
export function modeOfTool(tool: GridTool): GridMode | null {
  if (tool === 'select') return null;
  for (const mode of ['build', 'prep', 'play'] as const) {
    if (MODE_TOOLS[mode].includes(tool)) return mode;
  }
  return null;
}

/** The mode a tab lives in, preferring the current one when the tab is in several. */
export function modeOfTab(tab: GmTab, current: GridMode): GridMode {
  if (MODE_TABS[current].includes(tab)) return current;
  for (const mode of ['build', 'prep', 'play'] as const) {
    if (MODE_TABS[mode].includes(tab)) return mode;
  }
  return current;
}

/** Single-key tools (docs/UX_MAP_BUILDER.md §3.3): the letter, the tool. */
export const SHORTCUTS: ReadonlyArray<{ key: string; tool: GridTool; gmOnly: boolean }> = [
  { key: 'v', tool: 'select', gmOnly: false },
  { key: 'm', tool: 'ruler', gmOnly: false },
  { key: 'o', tool: 'aoe', gmOnly: false },
  { key: 'x', tool: 'pointer', gmOnly: false },
  { key: 'r', tool: 'tile-room', gmOnly: true },
  { key: 'a', tool: 'tile-area', gmOnly: true },
  { key: 'b', tool: 'tile', gmOnly: true },
  { key: 'e', tool: 'tile-erase', gmOnly: true },
  { key: 'w', tool: 'wall', gmOnly: true },
  { key: 'd', tool: 'door', gmOnly: true },
  { key: 'z', tool: 'zone', gmOnly: true },
  { key: 'p', tool: 'pin', gmOnly: true },
  { key: 'f', tool: 'fogdef', gmOnly: true },
  { key: 'c', tool: 'camera', gmOnly: true },
  { key: 'n', tool: 'note', gmOnly: true },
  { key: 'g', tool: 'focus', gmOnly: true },
];

/** The key that picks `tool`, for its tooltip; undefined when it has none. */
export function shortcutFor(tool: GridTool): string | undefined {
  return SHORTCUTS.find((s) => s.tool === tool)?.key.toUpperCase();
}

export type ShortcutAction = { kind: 'tool'; tool: GridTool } | { kind: 'escape' } | { kind: 'floor'; index: number };

/**
 * What a key press means, or null when it means nothing here. Modifier
 * chords are left to the browser, and the caller decides whether the press
 * happened somewhere typing is going on.
 */
export function shortcutAction(
  key: string,
  isGm: boolean,
  mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): ShortcutAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (key === 'Escape') return { kind: 'escape' };
  if (/^[1-9]$/.test(key)) return isGm ? { kind: 'floor', index: Number(key) - 1 } : null;
  const hit = SHORTCUTS.find((s) => s.key === key.toLowerCase());
  if (!hit || (hit.gmOnly && !isGm)) return null;
  return { kind: 'tool', tool: hit.tool };
}

/** True when a key press landed where someone is typing, so it is theirs. */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Duck-typed rather than instanceof HTMLElement: the store's tests run in node.
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** One line under the toolbar: what the tool in hand wants from the GM. */
export const TOOL_HINTS: Record<GridTool, string> = {
  select: 'Click a token to drag it, a door’s knob to open it, a pin or note to edit it. Double-tap to ping.',
  ruler: 'Drag to measure in metres; start on a token to see its walk and run.',
  aoe: 'Click to place the circle; set its radius in the measure panel.',
  pointer: 'Drag to draw a pointer trail everyone sees.',
  fogdef: 'Click the corners of a fog region, then save it on the Fog section.',
  focus: 'Click to pull every screen to that spot, once.',
  wall: 'Drag along the wall. Shift for a free angle. Esc when done.',
  door: 'Drag across the doorway. Click a door’s knob later to open or shut it.',
  zone: 'Click the corners of a named area; name it on the Geo section.',
  pin: 'Click to drop a pin; it opens on the Pins section.',
  camera: 'Click to mount a camera; aim it on the Cams section. Only you see it.',
  note: 'Click to drop a note only you ever see.',
  tile: 'Drag to paint with the chosen material; Auto reads the square around it.',
  'tile-area': 'Drag a rectangle of floor.',
  'tile-room': 'Drag a rectangle: floor inside, walls around it.',
  'tile-erase': 'Drag to clear painted squares.',
};
