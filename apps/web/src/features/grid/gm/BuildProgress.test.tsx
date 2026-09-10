/**
 * The build checklist (docs/UX_MAP_BUILDER.md §3.4): ticked from the scene
 * alone, ending in the one accent action. Static markup for the strip; the
 * steps are a pure function.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Scene } from '@safehouse/contracts';
import BuildProgress, { buildSteps } from './BuildProgress.js';

function scene(over: Partial<Scene> = {}, geometry: Partial<Scene['geometry']> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'draft',
    grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], ...geometry },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
    ...over,
  } as unknown as Scene;
}
const done = (s: Scene) => Object.fromEntries(buildSteps(s).map((x) => [x.id, x.done]));

describe('buildSteps', () => {
  it('starts with nothing ticked but the grid, which has nothing to line up with', () => {
    expect(done(scene())).toEqual({ map: false, grid: true, walls: false, fog: false });
    expect(buildSteps(scene()).find((s) => s.id === 'map')?.tab).toBe('tiles');
  });

  it('ticks the map from an image or from paint, and the grid once it is touched', () => {
    const withImage = scene({ mapAttachmentIds: ['att_1'] });
    expect(done(withImage)).toMatchObject({ map: true, grid: false });
    expect(buildSteps(withImage).find((s) => s.id === 'map')?.tab).toBe('map');
    const calibrated = scene({
      mapAttachmentIds: ['att_1'],
      grid: { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' },
    });
    expect(done(calibrated)).toMatchObject({ map: true, grid: true });
    const painted = scene({ tiles: { tilesetId: 'docklands', cells: {}, ground: { '0,0': 'floor' }, structure: {}, object: {} } });
    expect(done(painted)).toMatchObject({ map: true, grid: true });
  });

  it('ticks walls from drawn walls, drawn doors or painted structure', () => {
    expect(done(scene({}, { walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] })).walls).toBe(true);
    expect(done(scene({}, { doors: [{ id: 'd', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, open: false, locked: false }] })).walls).toBe(true);
    expect(
      done(scene({ tiles: { tilesetId: 'docklands', cells: {}, ground: {}, structure: { '2,2': 'wall' }, object: {} } })).walls,
    ).toBe(true);
  });

  it('ticks fog from a region or a brushed reveal', () => {
    expect(done(scene({ fog: { regions: [{ id: 'r', name: 'x', polygon: [] }], revealed: [], revealedShapes: [] } })).fog).toBe(true);
  });
});

describe('<BuildProgress>', () => {
  const html = (s: Scene, active: string | null) =>
    renderToStaticMarkup(
      <BuildProgress scene={s} campaignId="c1" activeSceneId={active} onStep={() => undefined} onActivate={() => undefined} />,
    );

  it('shows one chip per step with its tick, and the finish line as the accent', () => {
    const h = html(scene({ mapAttachmentIds: ['att_1'] }), null);
    expect(h).toMatch(/data-step="map" data-done="yes"/);
    expect(h).toMatch(/data-step="grid" data-done="no"/);
    expect(h).toContain('data-testid="activate-scene"');
    expect(h).toMatch(/activate-scene[^>]*title="3 steps unticked/);
    expect(h).not.toContain('data-testid="on-table"');
    expect(h).not.toMatch(/FR\d/);
  });

  it('says the scene is on the table once it is, with the TV a click away', () => {
    const h = html(scene(), 's1');
    expect(h).not.toContain('data-testid="activate-scene"');
    expect(h).toContain('data-testid="on-table"');
    expect(h).toContain('href="/tv/c1"');
  });
});
