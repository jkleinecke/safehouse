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

describe('the inspector’s selection (docs/UX_MAP_BUILDER.md §3.2)', () => {
  beforeEach(() => {
    useGridStore.setState({ mode: 'build', gmTab: 'map', tool: 'select', selected: null, selectedTokenId: null });
  });

  it('is one thing at a time, of any kind', () => {
    s().select({ kind: 'wall', id: 'w1' });
    expect(s().selected).toEqual({ kind: 'wall', id: 'w1' });
    s().select({ kind: 'camera', id: 'cam_1' });
    expect(s().selected).toEqual({ kind: 'camera', id: 'cam_1' });
    s().select(null);
    expect(s().selected).toBeNull();
  });

  it('survives picking up a drawing tool, and closes when the GM leaves authoring', () => {
    s().select({ kind: 'pin', id: 'p1' });
    s().setTool('wall');
    expect(s().selected).toEqual({ kind: 'pin', id: 'p1' });
    s().setTool('select');
    expect(s().selected).toEqual({ kind: 'pin', id: 'p1' });
    s().setTool('ruler');
    expect(s().selected).toBeNull();
  });

  it('closes when a token is picked, and stays when the token is put down', () => {
    s().select({ kind: 'door', id: 'd1' });
    s().selectToken(null);
    expect(s().selected).toEqual({ kind: 'door', id: 'd1' });
    s().selectToken('t1');
    expect(s().selected).toBeNull();
  });

  it('closes when the mode drops the tool that was in hand', () => {
    s().setTool('wall');
    s().select({ kind: 'wall', id: 'w1' });
    s().setMode('play');
    expect(s().tool).toBe('select');
    expect(s().selected).toBeNull();
  });
});
