/**
 * Describe the floor to the Fixer (FR12.11 lane 3): the panel is on the tiles
 * tab, says what it needs when the Fixer is off, and sums a plan up in the
 * GM's words before anything is built.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import BuildWithAi, { describePlan } from './BuildWithAi.js';
import type { FloorPlanResult } from '../api.js';

const SCENE = {
  id: 's1',
  campaignId: 'c1',
  name: 'Clinic',
  state: 'draft',
  grid: { unitM: 1, cols: 20, rows: 15, offset: { x: 0, y: 0 }, projection: 'topdown' },
  environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
  vision: { playersSeeOwnSight: false },
  geometry: { walls: [], doors: [], zones: [], pins: [] },
  fog: { regions: [], revealed: [], revealedShapes: [] },
  levels: [],
  mapAttachmentIds: [],
} as unknown as Scene;

const PLAN: FloorPlanResult['plan'] = {
  title: 'Two-room clinic',
  notes: '',
  tilesetId: 'docklands',
  rooms: [
    { name: 'waiting room', kind: 'lobby', rect: { x: 0, y: 0, w: 6, h: 5 } },
    { name: 'exam room', kind: 'room', rect: { x: 5, y: 0, w: 5, h: 5 } },
  ],
  layers: { ground: {}, structure: {}, object: {} },
  counts: { floor: 50, wall: 26, door: 2, window: 2, prop: 1, stair: 0 },
  warnings: [],
};

function render(node: React.ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('describePlan', () => {
  it('sums the plan up in the order the GM checks it', () => {
    expect(describePlan(PLAN)).toBe('2 rooms · 50 floor squares · 26 wall · 2 doors · 2 windows · 1 prop');
    expect(describePlan({ ...PLAN, rooms: PLAN.rooms.slice(0, 1), counts: { floor: 1, wall: 0, door: 1, window: 0, prop: 0, stair: 1 } })).toBe(
      '1 room · 1 floor square · 0 wall · 1 door · 1 stair',
    );
  });
});

describe('the panel', () => {
  it('offers a description box and says nothing is painted until built', () => {
    const html = render(<BuildWithAi scene={SCENE} tilesetId="docklands" level={0} />, (qc) =>
      qc.setQueryData(['fixer', 'status'], { enabled: true, models: { primary: 'big', fast: 'small' } }),
    );
    expect(html).toContain('data-testid="build-with-ai"');
    expect(html).toContain('aria-label="Describe this floor"');
    expect(html).toContain('data-testid="build-with-ai-draft"');
    expect(html).toContain('nothing is painted until you build it');
    expect(html).toContain('floor 0 · docklands');
    // No plan yet, so nothing to build by accident.
    expect(html).not.toContain('data-testid="build-with-ai-build"');
  });

  it('goes quiet with the Fixer, and says what brings it back', () => {
    const html = render(<BuildWithAi scene={SCENE} tilesetId="docklands" level={1} />, (qc) =>
      qc.setQueryData(['fixer', 'status'], { enabled: false, models: null }),
    );
    expect(html).toContain('data-testid="build-with-ai-offline"');
    expect(html).not.toContain('aria-label="Describe this floor"');
    expect(html).toContain('inference endpoint');
  });
});
