/**
 * The layout list (docs/UX_MAP_BUILDER.md §3.2): one line per wall, door,
 * zone and pin, no editing — the forty-eight coordinate boxes are gone, and
 * the inspector has the four that matter.
 *
 * Static markup, no DOM. Under `renderToStaticMarkup` zustand serves its
 * initial state (see TilesTab.test.tsx), which is why the selection and the
 * tool arrive as props from the panel rather than being read from the store.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import type { GeometrySelection, GridTool } from '../types.js';
import GeometryTab, { metres } from './GeometryTab.js';

function scene(geometry: Partial<Scene['geometry']> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], ...geometry },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

function render(s: Scene, selected: GeometrySelection | null = null, tool: GridTool = 'select'): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <GeometryTab scene={s} selected={selected} tool={tool} />
    </QueryClientProvider>,
  );
}

const FULL = scene({
  walls: [
    { id: 'w1', a: { x: 2, y: 2 }, b: { x: 5, y: 2 } },
    { id: 'w2', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
  ],
  doors: [
    { id: 'd1', a: { x: 5, y: 2 }, b: { x: 6, y: 2 }, open: false, locked: true },
    { id: 'd2', a: { x: 7, y: 2 }, b: { x: 8, y: 2 }, open: true, locked: false },
  ],
  zones: [{ id: 'z1', name: 'loading dock', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] }],
  pins: [
    { id: 'p1', at: { x: 3, y: 3 }, label: 'the safe', visibility: 'gm', wikiPageId: 'pg1' },
    { id: 'p2', at: { x: 4, y: 4 }, visibility: 'public' },
  ],
});

describe('<GeometryTab>', () => {
  it('lists walls with their length, doors with their state and lock, zones and pins with a badge', () => {
    const html = render(FULL);
    expect(html).toContain('data-row="w1"');
    expect(html).toMatch(/w1.*3 m/s);
    expect(html).toMatch(/w2.*1\.4 m/s);
    expect(html).toMatch(/d1.*shut.*locked/s);
    expect(html).toMatch(/d2.*open/s);
    expect(html).not.toMatch(/d2[^]*?locked[^]*?data-row="z1"/s);
    expect(html).toMatch(/loading dock.*3 pts/s);
    expect(html).toMatch(/the safe.*private/s);
    expect(html).toMatch(/p2.*unlinked.*revealed/s);
  });

  it('edits nothing itself — no coordinate boxes, no tool buttons', () => {
    const html = render(FULL);
    expect(html).not.toContain('type="number"');
    expect(html).not.toMatch(/make it a door/);
    expect(html).not.toMatch(/back to the select tool/);
    expect(html).not.toMatch(/aria-pressed="true"/);
  });

  it('rings the picked row', () => {
    const html = render(FULL, { kind: 'door', id: 'd1' });
    expect(html).toMatch(/data-row="d1" aria-pressed="true"/);
    expect(html).toMatch(/data-row="w1" aria-pressed="false"/);
  });

  it('shows the zone drafting controls only while the zone tool is in hand', () => {
    expect(render(FULL)).not.toMatch(/New zone/);
    expect(render(FULL, null, 'wall')).not.toMatch(/New zone/);
    const html = render(FULL, null, 'zone');
    expect(html).toMatch(/New zone/);
    expect(html).toMatch(/save polygon/);
    expect(html).toMatch(/save rect/);
  });

  it('names the keys when the map is bare', () => {
    const html = render(scene());
    expect(html).toMatch(/wall tool \(W\)/);
    expect(html).toMatch(/door tool \(D\)/);
    expect(html).toMatch(/Z draws one/);
    expect(html).toMatch(/P drops one/);
  });

  it('says lengths the way the ruler does', () => {
    expect(metres({ x: 0, y: 0 }, { x: 3, y: 0 }, 1)).toBe('3 m');
    expect(metres({ x: 0, y: 0 }, { x: 3, y: 0 }, 1.5)).toBe('4.5 m');
    expect(metres({ x: 0, y: 0 }, { x: 1, y: 1 }, 1)).toBe('1.4 m');
  });
});
