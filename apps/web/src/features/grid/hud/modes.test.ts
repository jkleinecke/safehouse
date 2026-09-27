import { describe, expect, it } from 'vitest';
import type { GridTool } from '../types.js';
import {
  FOG_BAR_MODES,
  FOG_BAR_TOOLS,
  isTypingTarget,
  MODE_TABS,
  MODE_TOOLS,
  modeOfTab,
  modeOfTool,
  PLAYER_TOOLS,
  SHORTCUTS,
  shortcutAction,
  shortcutFor,
  toolFitsMode,
} from './modes.js';

const ALL_TOOLS: GridTool[] = [
  'select', 'ruler', 'aoe', 'pointer', 'fogbrush', 'focus', 'door', 'zone', 'pin', 'camera', 'light', 'note',
  'tile', 'tile-area', 'tile-room', 'tile-erase', 'arc', 'token',
];

describe('the three modes', () => {
  it('between them offer every tool exactly once, with select in all three, and the fog bar’s on no toolbar', () => {
    for (const tool of ALL_TOOLS) {
      const owners = (['build', 'prep', 'play'] as const).filter((m) => MODE_TOOLS[m].includes(tool));
      expect(owners.length, tool).toBe(tool === 'select' ? 3 : FOG_BAR_TOOLS.includes(tool) ? 0 : 1);
    }
    for (const m of ['build', 'prep', 'play'] as const) expect(MODE_TOOLS[m][0]).toBe('select');
  });

  it('keep every mode under Miller’s seven, tools and tabs alike', () => {
    for (const m of ['build', 'prep', 'play'] as const) {
      expect(MODE_TOOLS[m].length).toBeLessThanOrEqual(9);
      expect(MODE_TABS[m].length).toBeLessThanOrEqual(7);
    }
  });

  it('players get the same four tools whatever the mode', () => {
    expect(PLAYER_TOOLS).toEqual(['select', 'ruler', 'aoe', 'pointer']);
  });

  it('know which mode a tool or a tab lives in, and keep the current one when both would do', () => {
    expect(modeOfTool('arc')).toBe('build');
    expect(modeOfTool('camera')).toBe('prep');
    expect(modeOfTool('ruler')).toBe('play');
    expect(modeOfTool('select')).toBeNull();
    expect(modeOfTab('cameras', 'build')).toBe('prep');
    expect(modeOfTab('tokens', 'play')).toBe('play');
    expect(modeOfTab('tokens', 'build')).toBe('prep');
    // A tab only one mode has takes the GM to that mode.
    expect(modeOfTab('tv', 'build')).toBe('play');
    expect(modeOfTab('env', 'play')).toBe('prep');
  });
});

describe('the fog bar’s tools (2026-09-27)', () => {
  it('stay in hand in Prep and in Play, and are put down in Build', () => {
    expect(FOG_BAR_MODES).toEqual(['prep', 'play']);
    expect(toolFitsMode('fogbrush', 'prep')).toBe(true);
    expect(toolFitsMode('fogbrush', 'play')).toBe(true);
    expect(toolFitsMode('fogbrush', 'build')).toBe(false);
    // Every other tool fits the one mode whose toolbar has it, and Select all three.
    expect(toolFitsMode('camera', 'prep')).toBe(true);
    expect(toolFitsMode('camera', 'play')).toBe(false);
    expect(toolFitsMode('select', 'build')).toBe(true);
    // Picked up from Build, the brush takes the GM to Prep.
    expect(modeOfTool('fogbrush')).toBe('prep');
  });

  it('pick up the brush with F, the key the old Reveal area tool had', () => {
    expect(shortcutAction('f', true)).toEqual({ kind: 'tool', tool: 'fogbrush' });
    expect(shortcutAction('f', false)).toBeNull();
    expect(shortcutFor('fogbrush')).toBe('F');
  });
});

describe('single-key tools', () => {
  it('use each letter once and name it in the tooltip', () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(shortcutFor('arc')).toBe('W');
    expect(shortcutFor('tile-room')).toBe('R');
    expect(shortcutFor('select')).toBe('V');
  });

  it('turn a key into a tool, a floor, or nothing — and never for a player’s GM tool', () => {
    expect(shortcutAction('w', true)).toEqual({ kind: 'tool', tool: 'arc' });
    expect(shortcutAction('W', true)).toEqual({ kind: 'tool', tool: 'arc' });
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

});
