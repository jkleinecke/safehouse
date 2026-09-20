/**
 * The toolbar shows one mode's tools (docs/UX_MAP_BUILDER.md §3.1) as icons,
 * naming each and its key in the tooltip (§3.3) and writing nothing under the
 * row (§3.7). The mode switch itself is not here — see `ModeBar.test.tsx`.
 * Static markup, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GridTool } from '../types.js';
import Toolbar, { toolTitle, ViewControls } from './Toolbar.js';
import type { GridMode } from './modes.js';

function render(isGm: boolean, mode: GridMode, tool: GridTool = 'select'): string {
  return renderToStaticMarkup(
    <Toolbar isGm={isGm} mode={mode} tool={tool} onTool={() => undefined} />,
  );
}

describe('<Toolbar>', () => {
  it('shows the GM only that mode’s tools, and never the mode switch', () => {
    const build = render(true, 'build', 'wall');
    // Build · Prep · Play live in <ModeBar>, above the map.
    expect(build).not.toContain('data-testid="mode-switch"');
    expect(build).toContain('data-testid="tool-wall"');
    expect(build).toContain('data-testid="tool-tile-room"');
    expect(build).not.toContain('data-testid="tool-ruler"');
    expect(build).not.toContain('data-testid="tool-camera"');

    const prep = render(true, 'prep');
    expect(prep).toContain('data-testid="tool-camera"');
    expect(prep).toContain('data-testid="tool-fogdef"');
    expect(prep).not.toContain('data-testid="tool-wall"');

    // Select and Erase lead the Build row, apart from the tools.
    expect(build).toContain('aria-label="Select and erase"');
    expect(build).toContain('data-testid="tool-tile-erase"');
    const play = render(true, 'play');
    // Nothing to erase in Play, so Select leads it alone.
    expect(play).toContain('aria-label="Select"');
    expect(play).toContain('data-testid="tool-ruler"');
    expect(play).toContain('data-testid="tool-focus"');
    expect(play).not.toContain('data-testid="tool-pin"');
  });

  it('shows a player the four play tools, whatever mode the store holds', () => {
    const html = render(false, 'build');
    for (const t of ['select', 'ruler', 'aoe', 'pointer']) expect(html).toContain(`data-testid="tool-${t}"`);
    expect(html).not.toContain('data-testid="tool-wall"');
    expect(html).not.toContain('data-testid="tool-focus"');
  });

  it('gives every tooltip the name and the key, and nothing longer', () => {
    expect(toolTitle('wall')).toBe('Wall line (W)');
    expect(toolTitle('tile-room')).toBe('Room (R)');
    const html = render(true, 'build', 'wall');
    // Nothing spelled out under the buttons (§3.7) — the tooltip carries it.
    expect(html).not.toContain('data-testid="tool-hint"');
    // No spec ids anywhere a GM reads.
    expect(html).not.toMatch(/FR\d/);
  });
});

describe('<Toolbar> buttons', () => {
  it('draws icons only, with the name in the tooltip and for a screen reader', () => {
    const html = render(true, 'build', 'wall');
    // The label is not body text on the button...
    expect(html).not.toMatch(/>Wall line</);
    // ...it is the tooltip and the accessible name.
    const title = 'Wall line (W)';
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(`aria-label="${title}"`);
  });

  it('carries no undo or redo — those are in the mode row', () => {
    const html = render(true, 'build', 'wall');
    expect(html).not.toContain('data-testid="undo"');
    expect(html).not.toContain('data-testid="redo"');
  });
});

describe('<ViewControls>', () => {
  it('holds snap, zoom, fit and the view for everyone, and the panel for the GM', () => {
    const gm = renderToStaticMarkup(
      <ViewControls
        isGm
        snapEnabled
        gmPanelOpen
        projection="topdown"
        onProjection={() => undefined}
        onToggleSnap={() => undefined}
        onToggleGmPanel={() => undefined}
        onZoom={() => undefined}
        onFit={() => undefined}
      />,
    );
    expect(gm).toContain('title="Fit"');
    expect(gm).toContain('title="Panel"');
    // One control with a value, not two buttons with a pressed state.
    expect(gm).toContain('data-testid="view-select"');
    expect(gm).toContain('>Top<');
    expect(gm).toContain('>Iso<');

    const player = renderToStaticMarkup(
      <ViewControls
        isGm={false}
        snapEnabled={false}
        gmPanelOpen={false}
        projection="iso"
        onProjection={() => undefined}
        onToggleSnap={() => undefined}
        onToggleGmPanel={() => undefined}
        onZoom={() => undefined}
        onFit={() => undefined}
      />,
    );
    expect(player).toContain('Zoom in');
    expect(player).not.toContain('title="Panel"');
    // A player gets the same one control, pointed at their own screen.
    expect(player).toContain('data-testid="view-select"');
    expect(player).toContain('value="iso"');
  });
});
