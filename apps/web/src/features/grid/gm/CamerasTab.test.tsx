/**
 * The cameras-and-notes list (docs/UX_MAP_BUILDER.md §3.2), rendered the way
 * the other GM tabs are tested: static markup, no DOM, so the questions are
 * "is the row there" and "does it say the right thing". Editing is the
 * inspector's job and tested there. The selection and the lens arrive as
 * props: under `renderToStaticMarkup` zustand serves its initial state (see
 * TilesTab.test.tsx), so the panel owns them and the list only reads them.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import type { GeometrySelection } from '../types.js';
import { cameraLensId } from '../useShroud.js';
import CamerasTab, { headline } from './CamerasTab.js';

function scene(cameras: Scene['geometry']['cameras'], notes?: Scene['geometry']['gmNotes']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], cameras, gmNotes: notes },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

function render(s: Scene, selected: GeometrySelection | null = null, lens: string | null = null): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CamerasTab scene={s} selected={selected} lens={lens} />
    </QueryClientProvider>,
  );
}

const TWO_NOTES: Scene['geometry']['gmNotes'] = [
  { id: 'note_1', at: { x: 1, y: 1 }, text: ['Sniper on the roof after round 3', 'Then the HTR team.'].join('\n'), width: 4 },
  { id: 'note_2', at: { x: 5, y: 5 }, text: '', width: 4 },
];

describe('<CamerasTab>', () => {
  it('points at the toolbar keys when the map is bare, and says who sees these', () => {
    const html = render(scene(undefined));
    expect(html).not.toContain('data-testid="camera-tool"');
    expect(html).toMatch(/C mounts one/);
    expect(html).toMatch(/N drops one/);
    expect(html).toMatch(/only you see cameras and notes/i);
  });

  it('lists every camera by label, marks the ones switched off and the one looked through', () => {
    const html = render(
      scene([
        { id: 'cam_1', at: { x: 1, y: 1 }, facing: 0, fov: 90, range: 12, level: 0, active: true, label: 'Lobby' },
        { id: 'cam_2', at: { x: 5, y: 5 }, facing: 0, fov: 90, range: 12, level: 0, active: false },
      ]),
      null,
      cameraLensId('cam_1'),
    );
    expect(html).toContain('data-camera="cam_1"');
    expect(html).toContain('Lobby');
    expect(html).toMatch(/cam_1.*looking/s);
    expect(html).toContain('data-camera="cam_2"');
    expect(html).toMatch(/cam_2.*off/s);
    expect(html).not.toMatch(/cam_2.*looking/s);
  });

  it('lists every note by its first line, and rings the picked one', () => {
    const html = render(scene(undefined, TWO_NOTES), { kind: 'note', id: 'note_2' });
    expect(html).toContain('data-note="note_1"');
    expect(html).toContain('Sniper on the roof after round 3');
    expect(html).not.toContain('Then the HTR team');
    expect(html).toMatch(/data-note="note_1" data-selected="no"/);
    expect(html).toMatch(/data-note="note_2" data-selected="yes"/);
    expect(html).toContain('(empty)');
  });

  it('headlines a note by its first non-blank line, clipped', () => {
    expect(headline(['', '', '  first', 'second'].join('\n'))).toBe('first');
    expect(headline('x'.repeat(60))).toBe(`${'x'.repeat(47)}…`);
    expect(headline('')).toBe('(empty)');
  });
});
