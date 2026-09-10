/**
 * The inspector (docs/UX_MAP_BUILDER.md §3.2): one component, six kinds of
 * thing, the same shape for all of them. Static markup, no DOM: the
 * questions are "is the control there" and "does it say the right thing".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { useGridStore } from '../store.js';
import type { GeometrySelection } from '../types.js';
import Inspector, { find } from './Inspector.js';

const SCENE = {
  id: 's1',
  campaignId: 'c1',
  name: 'Bay',
  state: 'active',
  grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
  environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
  geometry: {
    walls: [{ id: 'w1', a: { x: 2, y: 2 }, b: { x: 5, y: 2 } }],
    doors: [
      { id: 'd1', a: { x: 5, y: 2 }, b: { x: 6, y: 2 }, open: false, locked: false },
      { id: 'd2', a: { x: 7, y: 2 }, b: { x: 8, y: 2 }, open: true, locked: true },
    ],
    zones: [{ id: 'z1', name: 'loading dock', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], color: '#ff0000' }],
    pins: [{ id: 'p1', at: { x: 3, y: 3 }, label: 'the safe', visibility: 'gm', wikiPageId: null, attachmentId: null }],
    cameras: [{ id: 'cam_1', at: { x: 1, y: 1 }, facing: 270, fov: 90, range: 12, level: 0, active: true, label: 'Lobby' }],
    gmNotes: [{ id: 'note_1', at: { x: 5, y: 5 }, text: 'Sniper on the roof after round 3', width: 4, color: '#f7a1c4' }],
  },
  levels: [],
  mapAttachmentIds: [],
  fog: { regions: [], revealed: [], revealedShapes: [] },
} as unknown as Scene;

function render(selection: GeometrySelection, scene: Scene = SCENE): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Inspector campaignId="c1" scene={scene} selection={selection} onCenter={() => undefined} />
    </QueryClientProvider>,
  );
}

afterEach(() => useGridStore.setState({ selected: null, losTokenId: null }));

describe('<Inspector>', () => {
  it('has the same frame for everything: a title, a centre button, a close button', () => {
    for (const kind of ['wall', 'door', 'zone', 'pin', 'camera', 'note'] as const) {
      const id = { wall: 'w1', door: 'd1', zone: 'z1', pin: 'p1', camera: 'cam_1', note: 'note_1' }[kind];
      const html = render({ kind, id });
      expect(html, kind).toContain(`data-testid="inspector" data-kind="${kind}" data-id="${id}"`);
      expect(html, kind).toContain('Centre the map on it');
      expect(html, kind).toContain('Close (Esc)');
      expect(html, kind).toContain('data-testid="inspector-delete"');
    }
  });

  it('shows a wall as its length and endpoints, with a way to make it a door', () => {
    const html = render({ kind: 'wall', id: 'w1' });
    expect(html).toMatch(/Wall.*w1 · 3 m/s);
    expect(html).toMatch(/make it a door/);
    expect(html).toContain('value="2"');
    expect(html).toContain('value="5"');
  });

  it('shows a door with open and lock, and says what the lock means', () => {
    const shut = render({ kind: 'door', id: 'd1' });
    expect(shut).toMatch(/open it/);
    expect(shut).toContain('data-testid="door-lock-d1"');
    expect(shut).toMatch(/>lock</);
    expect(shut).toMatch(/players can open and shut it/);

    const locked = render({ kind: 'door', id: 'd2' });
    expect(locked).toMatch(/shut it/);
    expect(locked).toMatch(/>unlock</);
    expect(locked).toMatch(/locked — only you can open it/);
  });

  it('shows a zone by name and colour', () => {
    const html = render({ kind: 'zone', id: 'z1' });
    expect(html).toMatch(/3 corners/);
    expect(html).toContain('value="loading dock"');
    expect(html).toContain('value="#ff0000"');
  });

  it('shows a pin with its label, codex link, handout and reveal switch', () => {
    const html = render({ kind: 'pin', id: 'p1' });
    expect(html).toMatch(/private to you/);
    expect(html).toContain('value="the safe"');
    expect(html).toMatch(/upload a handout/);
    expect(html).toContain('data-testid="pin-visibility"');
    expect(html).toMatch(/private — reveal it/);
    expect(html).toMatch(/points at nothing yet/);
  });

  it('shows a camera with its facing, field, reach and lens', () => {
    const html = render({ kind: 'camera', id: 'cam_1' });
    expect(html).toMatch(/switched on/);
    expect(html).toContain('value="Lobby"');
    expect(html).toContain('value="270"');
    expect(html).toMatch(/>N</);
    expect(html).toContain('data-testid="camera-lens"');
    expect(html).toMatch(/look through it/);
    // One floor: no floor picker.
    expect(html).not.toMatch(/Camera floor/);
  });

  it('shows a note with its text, width and paper', () => {
    const html = render({ kind: 'note', id: 'note_1' });
    expect(html).toMatch(/at 5, 5/);
    expect(html).toMatch(/Sniper on the roof after round 3/);
    expect(html).toContain('value="4"');
    expect(html).toMatch(/pink/);
  });

  it('draws nothing for a thing that is gone', () => {
    expect(render({ kind: 'wall', id: 'w9' })).toBe('');
    expect(find(SCENE.geometry, { kind: 'note', id: 'nope' })).toBeNull();
    expect(find(SCENE.geometry, { kind: 'camera', id: 'cam_1' })?.kind).toBe('camera');
  });

  it('never shows a spec id', () => {
    expect(render({ kind: 'pin', id: 'p1' })).not.toMatch(/FR\d/);
  });
});
