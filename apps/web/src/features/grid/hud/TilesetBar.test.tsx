/**
 * The set the scene is drawn in, and Clear floor, on the mode bar.
 *
 * Both act on the whole map at once, so they sit at the mode's altitude
 * rather than in a panel (docs/UX_MAP_BUILDER.md §3.7b). No DOM in this
 * package, so this asserts on static markup; the rules with the sharp edges
 * are pure and tested in `TilesTab.test.tsx` beside `resolveTileset`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { TILESETS } from '@safehouse/rules';
import type { TilesetDef } from '../api.js';
import { DEFAULT_TILESET_ID } from '../store.js';
import TilesetBar from './TilesetBar.js';

const SERVED = TILESETS as unknown as TilesetDef[];

function scene(tiles?: Scene['tiles']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Aztechnology loading dock',
    state: 'draft',
    grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: [],
    tiles,
  } as Scene;
}

function cells(n: number, tileId = 'floor'): Record<string, string> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${i},0`, tileId]));
}

function render(s: Scene, tilesets: TilesetDef[] | undefined = SERVED): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (tilesets) qc.setQueryData(['tilesets'], tilesets);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <TilesetBar scene={s} />
    </QueryClientProvider>,
  );
}

describe('the set the scene is drawn in', () => {
  it('offers every served set and opens on the one the store is holding', () => {
    const html = render(scene());
    for (const set of SERVED) expect(html).toContain(`value="${set.id}"`);
    expect(html).toContain(`data-tileset="${DEFAULT_TILESET_ID}"`);
    expect(html).toContain('data-testid="tileset-select"');
  });

  it('draws nothing at all when the catalogue is empty', () => {
    // Better an absent control than an empty dropdown on the mode bar.
    expect(render(scene(), [])).toBe('');
  });
});

describe('switching sets is a render decision, so nothing warns against it', () => {
  it('shows no data-loss warning when the floor is painted with another set', () => {
    // Every square holds a slot (rules/tilesets/slots.ts); the server changes
    // one field per floor and the map redraws with every square as it was.
    const html = render(scene({ tilesetId: 'club', cells: {}, ground: cells(20), structure: {}, object: {} }));
    expect(html).not.toContain('data-testid="tiles-switch-warning"');
    expect(html).not.toContain('replaces');
  });

  it('still offers every set while a floor is painted', () => {
    const html = render(scene({ tilesetId: 'club', cells: {}, ground: cells(20), structure: {}, object: {} }));
    for (const set of SERVED) expect(html).toContain(`value="${set.id}"`);
  });
});

describe('clearing the floor', () => {
  /** The `Clear floor` tag alone — `disabled:opacity-40` lives in its class. */
  const clearButton = (html: string): string =>
    /<button[^>]*data-testid="clear-floor"[^>]*>/.exec(html)?.[0] ?? '';

  it('is refused when there is no floor to clear', () => {
    expect(clearButton(render(scene()))).toContain('disabled=""');
  });

  it('is offered once something is painted, and counts it in the confirm', () => {
    const html = render(scene({ tilesetId: DEFAULT_TILESET_ID, cells: {}, ground: cells(7), structure: {}, object: {} }));
    expect(clearButton(html)).not.toContain('disabled=""');
    expect(html).toContain('Clear floor');
  });
});

describe('the grid behind the gear', () => {
  it('rides beside the set, shut, with the numbers out of the way until asked for', () => {
    const html = render(scene());
    expect(html).toContain('data-testid="calibrate-menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="calibrate-open"');
    // Calibration is not a panel section any more, so its numbers are not
    // sitting in the row either.
    expect(html).not.toContain('data-testid="calibrate-size"');
  });
});
