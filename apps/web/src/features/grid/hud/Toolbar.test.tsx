/**
 * The toolbar shows one mode's tools (docs/UX_MAP_BUILDER.md §3.1), names the
 * key for each (§3.3), and says in one line what the tool in hand wants.
 * Static markup, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GridTool } from '../types.js';
import Toolbar, { toolTitle, ViewControls } from './Toolbar.js';
import type { GridMode } from './modes.js';

function render(isGm: boolean, mode: GridMode, tool: GridTool = 'select'): string {
  return renderToStaticMarkup(
    <Toolbar isGm={isGm} mode={mode} tool={tool} onMode={() => undefined} onTool={() => undefined} />,
  );
}

describe('<Toolbar>', () => {
  it('shows the GM the mode switch and only that mode’s tools', () => {
    const build = render(true, 'build', 'wall');
    expect(build).toContain('data-testid="mode-switch"');
    expect(build).toContain('data-testid="tool-wall"');
    expect(build).toContain('data-testid="tool-tile-room"');
    expect(build).not.toContain('data-testid="tool-ruler"');
    expect(build).not.toContain('data-testid="tool-camera"');

    const prep = render(true, 'prep');
    expect(prep).toContain('data-testid="tool-camera"');
    expect(prep).toContain('data-testid="tool-fogdef"');
    expect(prep).not.toContain('data-testid="tool-wall"');

    const play = render(true, 'play');
    expect(play).toContain('data-testid="tool-ruler"');
    expect(play).toContain('data-testid="tool-focus"');
    expect(play).not.toContain('data-testid="tool-pin"');
  });

  it('shows a player the four play tools and no modes, whatever mode the store holds', () => {
    const html = render(false, 'build');
    expect(html).not.toContain('data-testid="mode-switch"');
    for (const t of ['select', 'ruler', 'aoe', 'pointer']) expect(html).toContain(`data-testid="tool-${t}"`);
    expect(html).not.toContain('data-testid="tool-wall"');
    expect(html).not.toContain('data-testid="tool-focus"');
  });

  it('names the key in every tooltip and says what the tool in hand wants', () => {
    expect(toolTitle('wall')).toBe('Drag to draw a wall (W)');
    expect(toolTitle('tile-room')).toBe('Drag a room: floor inside, walls around (R)');
    const html = render(true, 'build', 'wall');
    expect(html).toContain('data-testid="tool-hint"');
    expect(html).toMatch(/Drag along the wall/);
    // No spec ids anywhere a GM reads.
    expect(html).not.toMatch(/FR\d/);
  });
});

describe('<Toolbar> undo and redo', () => {
  const history = (undoLabel: string | null, redoLabel: string | null) => ({
    undoLabel,
    redoLabel,
    busy: false,
    onUndo: () => undefined,
    onRedo: () => undefined,
  });
  const render = (mode: GridMode, isGm = true, h = history('paint 12 squares', null)) =>
    renderToStaticMarkup(
      <Toolbar isGm={isGm} mode={mode} tool="select" onMode={() => undefined} onTool={() => undefined} history={h} />,
    );

  it('sits beside the build and prep tools, naming the step and the key', () => {
    const html = render('build');
    expect(html).toContain('data-testid="undo"');
    expect(html).toContain('Undo: paint 12 squares (Ctrl+Z)');
    expect(html).toMatch(/data-testid="redo"[^>]*/);
    expect(html).toMatch(/Nothing to redo/);
    expect(render('prep')).toContain('data-testid="undo"');
  });

  it('is disabled with nothing to take back, and absent in Play and for a player', () => {
    const empty = render('build', true, history(null, null));
    expect(empty).toMatch(/aria-label="Nothing to undo"[^>]*disabled=""/);
    expect(render('play')).not.toContain('data-testid="undo"');
    expect(render('build', false)).not.toContain('data-testid="undo"');
  });
});

describe('<ViewControls>', () => {
  it('holds snap, zoom, fit and — for the GM — the view and the panel', () => {
    const gm = renderToStaticMarkup(
      <ViewControls
        isGm
        snapEnabled
        gmPanelOpen
        viewProjection="scene"
        sceneProjection="topdown"
        onView={() => undefined}
        onToggleSnap={() => undefined}
        onToggleGmPanel={() => undefined}
        onZoom={() => undefined}
        onFit={() => undefined}
      />,
    );
    expect(gm).toContain('Fit the whole scene');
    expect(gm).toContain('data-testid="view-toggle"');
    expect(gm).toContain('GM authoring panel');
    const player = renderToStaticMarkup(
      <ViewControls
        isGm={false}
        snapEnabled={false}
        gmPanelOpen={false}
        onToggleSnap={() => undefined}
        onToggleGmPanel={() => undefined}
        onZoom={() => undefined}
        onFit={() => undefined}
      />,
    );
    expect(player).toContain('Zoom in');
    expect(player).not.toContain('data-testid="view-toggle"');
  });
});
