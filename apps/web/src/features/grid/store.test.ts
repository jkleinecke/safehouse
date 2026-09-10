/**
 * Modes (docs/UX_MAP_BUILDER.md §3.1): picking a tool moves the GM to the
 * mode that owns it; changing mode drops a foreign tool and lands on a tab
 * that exists there. The rest of the store is covered by its feature tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useGridStore } from './store.js';

const s = () => useGridStore.getState();

describe('grid modes in the store', () => {
  beforeEach(() => {
    useGridStore.setState({ mode: 'build', gmTab: 'map', tool: 'select' });
  });

  it('follows the tool into its mode', () => {
    s().setTool('camera');
    expect(s().mode).toBe('prep');
    s().setTool('ruler');
    expect(s().mode).toBe('play');
    s().setTool('select');
    expect(s().mode).toBe('play');
  });

  it('follows a tab into its mode, and keeps the mode when the tab is shared', () => {
    s().setGmTab('fog');
    expect(s().mode).toBe('prep');
    s().setGmTab('scenes');
    expect(s().mode).toBe('prep');
    s().setGmTab('geo');
    expect(s().mode).toBe('build');
  });

  it('drops a foreign tool and lands on a real tab when the mode changes', () => {
    s().setTool('wall');
    s().setMode('play');
    expect(s().tool).toBe('select');
    expect(s().gmTab).toBe('tokens');
    s().setMode('build');
    expect(s().gmTab).toBe('map');
    s().setGmTab('scenes');
    s().setMode('prep');
    expect(s().gmTab).toBe('scenes');
  });
});
