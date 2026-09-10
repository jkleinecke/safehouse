import { describe, expect, it } from 'vitest';
import type { GridTool } from '../types.js';
import {
  isTypingTarget,
  MODE_TABS,
  MODE_TOOLS,
  modeOfTab,
  modeOfTool,
  PLAYER_TOOLS,
  SHORTCUTS,
  shortcutAction,
  shortcutFor,
  TOOL_HINTS,
} from './modes.js';

const ALL_TOOLS: GridTool[] = [
  'select', 'ruler', 'aoe', 'pointer', 'fogdef', 'focus', 'wall', 'door', 'zone', 'pin', 'camera', 'note',
  'tile', 'tile-area', 'tile-room', 'tile-erase',
];

describe('the three modes', () => {
  it('between them offer every tool exactly once, with select in all three', () => {
    for (const tool of ALL_TOOLS) {
      const owners = (['build', 'prep', 'play'] as const).filter((m) => MODE_TOOLS[m].includes(tool));
      expect(owners.length, tool).toBe(tool === 'select' ? 3 : 1);
    }
    for (const m of ['build', 'prep', 'play'] as const) expect(MODE_TOOLS[m][0]).toBe('select');
  });

  it('keep every mode under Miller’s seven, tools and tabs alike', () => {
    for (const m of ['build', 'prep', 'play'] as const) {
      expect(MODE_TOOLS[m].length).toBeLessThanOrEqual(9);
      expect(MODE_TABS[m].length).toBeLessThanOrEqual(7);
      expect(MODE_TABS[m][0]).toBe('scenes');
    }
  });

  it('players get the same four tools whatever the mode', () => {
    expect(PLAYER_TOOLS).toEqual(['select', 'ruler', 'aoe', 'pointer']);
  });

  it('know which mode a tool or a tab lives in, and keep the current one when both would do', () => {
    expect(modeOfTool('wall')).toBe('build');
    expect(modeOfTool('camera')).toBe('prep');
    expect(modeOfTool('ruler')).toBe('play');
    expect(modeOfTool('select')).toBeNull();
    expect(modeOfTab('fog', 'build')).toBe('prep');
    expect(modeOfTab('tokens', 'play')).toBe('play');
    expect(modeOfTab('tokens', 'build')).toBe('prep');
    expect(modeOfTab('scenes', 'play')).toBe('play');
  });
});

describe('single-key tools', () => {
  it('use each letter once and name it in the tooltip', () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(shortcutFor('wall')).toBe('W');
    expect(shortcutFor('tile-room')).toBe('R');
    expect(shortcutFor('select')).toBe('V');
  });

  it('turn a key into a tool, a floor, or nothing — and never for a player’s GM tool', () => {
    expect(shortcutAction('w', true)).toEqual({ kind: 'tool', tool: 'wall' });
    expect(shortcutAction('W', true)).toEqual({ kind: 'tool', tool: 'wall' });
    expect(shortcutAction('w', false)).toBeNull();
    expect(shortcutAction('m', false)).toEqual({ kind: 'tool', tool: 'ruler' });
    expect(shortcutAction('Escape', false)).toEqual({ kind: 'escape' });
    expect(shortcutAction('3', true)).toEqual({ kind: 'floor', index: 2 });
    expect(shortcutAction('3', false)).toBeNull();
    expect(shortcutAction('w', true, { ctrl: true })).toBeNull();
    expect(shortcutAction('q', true)).toBeNull();
  });

  it('leave a field alone', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('have one hint line for every tool', () => {
    for (const tool of ALL_TOOLS) expect(TOOL_HINTS[tool].length, tool).toBeGreaterThan(10);
  });
});
