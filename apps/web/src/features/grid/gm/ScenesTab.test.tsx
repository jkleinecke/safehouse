/**
 * The Grid's Scenes tab starts the fight (FR9.10): one button on the map the
 * GM is already looking at, and — once a fight is linked to the scene — the
 * way to it and the way to add the tokens placed since.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Encounter, Scene } from '@safehouse/contracts';
import ScenesTab, { fightForScene } from './ScenesTab.js';

const scene = {
  id: 's1',
  campaignId: 'c1',
  name: 'Pier 23 Warehouse',
  state: 'active',
  grid: { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 } },
  environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
  vision: { playersSeeOwnSight: false },
  geometry: { walls: [], doors: [], zones: [], pins: [] },
  fog: { regions: [], revealed: [], revealedShapes: [] },
  levels: [],
  mapAttachmentIds: [],
} as unknown as Scene;

function fight(over: Partial<Encounter> = {}): Encounter {
  return { id: 'e1', campaignId: 'c1', name: 'Pier 23 — the Halo ambush', state: 'prep', turn: 0, pass: 0, sceneId: 's1', ...over };
}

function render(encounters: Encounter[] | undefined): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['scenes', 'c1'], [scene]);
  if (encounters) qc.setQueryData(['encounters', 'c1'], encounters);
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ScenesTab campaignId="c1" scene={scene} activeSceneId="s1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('fightForScene', () => {
  it('prefers the live fight on this scene, then a prepped one, and ignores fights that are over', () => {
    const prep = fight({ id: 'p' });
    const live = fight({ id: 'l', state: 'live' });
    const done = fight({ id: 'd', state: 'done' });
    const elsewhere = fight({ id: 'x', state: 'live', sceneId: 's2' });
    expect(fightForScene([done, prep, live, elsewhere], 's1')?.id).toBe('l');
    expect(fightForScene([done, prep], 's1')?.id).toBe('p');
    expect(fightForScene([done, elsewhere], 's1')).toBeNull();
    expect(fightForScene(undefined, 's1')).toBeNull();
  });
});

describe('<ScenesTab> fight section', () => {
  it('offers to start a fight from the scene’s tokens when none is linked', () => {
    const html = render([]);
    expect(html).toContain('data-testid="start-fight"');
    expect(html).toMatch(/start a fight from this scene/);
    expect(html).not.toContain('open the tracker');
  });

  it('names the linked fight, offers the tracker and the way to add new tokens', () => {
    const html = render([fight({ state: 'live' })]);
    expect(html).toContain('Pier 23 — the Halo ambush');
    expect(html).toContain('open the tracker');
    expect(html).toContain('href="/c/c1/table"');
    expect(html).toContain('add new tokens');
    expect(html).not.toContain('data-testid="start-fight"');
  });
});
