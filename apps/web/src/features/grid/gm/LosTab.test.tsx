/**
 * The LOS tab's viewpoint list while the GM looks through the players' eyes
 * (the fog bar's "See as players", the review of 2026-09-27). The players'
 * lens is the fog bar's, and the list does not offer it a second time; but
 * while it is on the list says so, rather than reading "Nobody — show the
 * whole map" over a map under the players' fog, where picking Nobody did
 * nothing because Nobody was what it already said.
 *
 * Static markup, no DOM. Under `renderToStaticMarkup` zustand serves its
 * initial state (see CamerasTab.test.tsx), so the store is stood in for here
 * with the one lens each test needs.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { PARTY_LENS } from '../useShroud.js';
import LosTab from './LosTab.js';

// The lens in hand, set by each test before it renders.
const lens = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../store.js', () => ({
  useGridStore: <T,>(pick: (s: Record<string, unknown>) => T): T =>
    pick({
      losTokenId: lens.id,
      setLosTokenId: () => undefined,
      selectedTokenId: null,
      coverOverride: null,
      setCoverOverride: () => undefined,
    }),
}));

function scene(): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Dock',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

function render(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <LosTab scene={scene()} tokens={[]} />
    </QueryClientProvider>,
  );
}

describe('<LosTab> viewpoint', () => {
  it('reads the players’ lens as the players, never as nobody, and leaves Nobody to pick', () => {
    lens.id = PARTY_LENS;
    const html = render();
    expect(html).toMatch(/<option value="party"[^>]*disabled=""[^>]*>The players — from the fog bar<\/option>/);
    expect(html).toMatch(/<option value="party"[^>]*selected=""/);
    expect(html).not.toMatch(/<option value=""[^>]*selected=""/);
  });

  it('offers no players’ row when their lens is off: it is the fog bar’s to switch on', () => {
    lens.id = null;
    const html = render();
    expect(html).not.toContain('The players');
    expect(html).toMatch(/<option value=""[^>]*selected="">Nobody — show the whole map<\/option>/);
  });
});
