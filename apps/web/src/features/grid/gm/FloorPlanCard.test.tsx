/**
 * A floor plan the Fixer drafted, shown in the chat (FR12.11 lane 3): summed
 * up in the GM's words before anything is built, with Build and Discard and
 * the promise that it is one undo step.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FloorPlanCard, { describePlan } from './FloorPlanCard.js';
import type { FloorPlanResult } from '../api.js';

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

describe('describePlan', () => {
  it('sums the plan up in the order the GM checks it', () => {
    expect(describePlan(PLAN)).toBe('2 rooms · 50 floor squares · 26 wall · 2 doors · 2 windows · 1 prop');
    expect(describePlan({ ...PLAN, rooms: PLAN.rooms.slice(0, 1), counts: { floor: 1, wall: 0, door: 1, window: 0, prop: 0, stair: 1 } })).toBe(
      '1 room · 1 floor square · 0 wall · 1 door · 1 stair',
    );
    // Areas of other ground — the harbour, the pier — are named with the outside.
    expect(
      describePlan({ ...PLAN, rooms: PLAN.rooms.slice(0, 1), counts: { floor: 600, wall: 18, door: 1, window: 0, prop: 0, stair: 0, outside: 570, areas: 3 } }),
    ).toBe('1 room · 600 floor squares · 18 wall · 1 door · 570 outside · 3 areas');
  });
});

describe('the card', () => {
  const render = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <FloorPlanCard sceneId="s1" level={1} plan={PLAN} />
      </QueryClientProvider>,
    );

  it('names the plan, its rooms and what it holds', () => {
    const html = render();
    expect(html).toContain('data-testid="floor-plan-card"');
    expect(html).toContain('Two-room clinic');
    expect(html).toContain('waiting room');
    expect(html).toContain('2 rooms · 50 floor squares');
    // Read back from an old thread: shown, with a way to build it again —
    // never built by merely being drawn.
    expect(html).toContain('data-testid="floor-plan-build"');
    expect(html).toContain('floor 1 · from earlier in the thread');
  });

  it('asks nothing when the plan has just arrived: it goes straight to building', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <FloorPlanCard sceneId="s1" level={0} plan={PLAN} autoBuildKey="call-1" />
      </QueryClientProvider>,
    );
    expect(html).not.toContain('data-testid="floor-plan-build"');
  });

  it('lists every warning, so nothing is built blind', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <FloorPlanCard sceneId="s1" level={0} plan={{ ...PLAN, warnings: ['the stair has nowhere to go'] }} />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="floor-plan-warnings"');
    expect(html).toContain('the stair has nowhere to go');
  });
});
