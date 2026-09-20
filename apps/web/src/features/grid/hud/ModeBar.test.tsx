/**
 * The mode row holds the three modes and nothing else — no tools, and no
 * line listing what the mode contains (§3.7). Static markup, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ModeBar from './ModeBar.js';

type Mode = 'build' | 'prep' | 'play';

const render = (mode: Mode) => renderToStaticMarkup(<ModeBar mode={mode} onMode={() => undefined} />);

const history = (undoLabel: string | null, redoLabel: string | null) => ({
  undoLabel,
  redoLabel,
  busy: false,
  onUndo: () => undefined,
  onRedo: () => undefined,
});

const withHistory = (mode: Mode, h = history('paint 12 squares', null)) =>
  renderToStaticMarkup(<ModeBar mode={mode} onMode={() => undefined} history={h} />);

describe('<ModeBar>', () => {
  it('offers all three modes and presses the current one', () => {
    const html = render('prep');
    expect(html).toContain('data-testid="mode-switch"');
    for (const m of ['build', 'prep', 'play']) expect(html).toContain(`data-testid="mode-${m}"`);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="mode-prep"/);
  });

  it('carries no tools and no line spelling the mode out', () => {
    const html = render('build');
    expect(html).not.toContain('data-testid="tool-wall"');
    // The hint is the button's tooltip only; it is never drawn as body text.
    expect(html).not.toContain('data-testid="mode-hint"');
    expect(html).not.toMatch(/>[^<]*image, floors, tiles/);
  });
});

describe('<ModeBar> undo and redo', () => {
  it('sits at the row’s other end, naming the step and the key', () => {
    const html = withHistory('build');
    expect(html).toContain('aria-label="History"');
    expect(html).toContain('Undo: paint 12 squares (Ctrl+Z)');
    expect(html).toContain('data-testid="redo"');
    expect(html).toMatch(/Nothing to redo/);
    expect(withHistory('prep')).toContain('data-testid="undo"');
  });

  it('is disabled with nothing to take back, and absent in Play', () => {
    const empty = withHistory('build', history(null, null));
    expect(empty).toMatch(/aria-label="Nothing to undo"[^>]*disabled=""/);
    expect(withHistory('play')).not.toContain('data-testid="undo"');
    // No history passed at all — nothing to draw.
    expect(render('build')).not.toContain('data-testid="undo"');
  });
});
