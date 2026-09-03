/**
 * The tile palette, judged the way the GM meets it: can they see what they can
 * paint with, and are they told — before they click — that the next stroke
 * destroys the floor already on the canvas?
 *
 * Two things shape how this is written.
 *
 * There is no DOM in this package (no jsdom, no testing-library), so the render
 * half asserts on static markup, the same as `sceneManager.test.tsx`.
 *
 * And under `renderToStaticMarkup`, zustand serves `getInitialState()` — a
 * server render deliberately cannot see state set after the store was created.
 * So the store-coupled rules are tested where they live instead: the palette's
 * two adoption rules are pure functions below, and "picking a tile picks up the
 * brush" is a store invariant asserted in `tilePaint.test.ts`. What is left
 * here is exactly what the markup can prove.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { TILESETS } from '@safehouse/rules';
import type { TilesetDef } from '../api.js';
import { DEFAULT_TILESET_ID } from '../store.js';
import TilesTab, { paintedTilesetToAdopt, resolveTileset } from './TilesTab.js';

const SERVED = TILESETS as unknown as TilesetDef[];

function scene(tiles?: Scene['tiles']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Aztechnology loading dock',
    state: 'draft',
    grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
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
      <TilesTab scene={s} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

describe('the palette shows the GM what they can build with', () => {
  it('offers every served set and opens on the one the store is holding', () => {
    const html = render(scene());
    for (const set of SERVED) expect(html).toContain(`value="${set.id}"`);
    expect(html).toContain(`data-tileset="${DEFAULT_TILESET_ID}"`);
    // The blurb is the whole reason a set has a name a GM can choose between.
    // Taken from the catalogue rather than restated here: the words describe a
    // palette, and pinning a copy of them means every art revision fails a
    // test about the palette UI, which is not what this is checking.
    const opened = SERVED.find((s) => s.id === DEFAULT_TILESET_ID)!;
    expect(opened.blurb.length).toBeGreaterThan(0);
    expect(html).toContain(opened.blurb);
  });

  it('offers the four tools, and shows the palette for the open one', () => {
    // The palette is now tool-scoped rather than one long list under four
    // headings: a GM placing a tree should not be scrolling past walls. Under
    // `renderToStaticMarkup` the store serves its initial state, so the open
    // tool is Ground and Ground's tiles are the ones on screen.
    const html = render(scene());
    for (const category of ['ground', 'building', 'interior', 'decoration']) {
      expect(html, category).toContain(`data-tile-category="${category}"`);
    }

    const docklands = SERVED.find((s) => s.id === 'docklands')!;
    const ground = docklands.tiles.filter((t) => (t.category ?? 'x') === 'ground');
    expect(ground.length).toBeGreaterThan(0);
    for (const t of ground) {
      expect(html, t.id).toContain(`data-tile-id="${t.id}"`);
      expect(html).toContain(t.name);
    }

    // …and the other tools' tiles are NOT, which is the whole point.
    const wall = docklands.tiles.find((t) => t.id === 'wall');
    expect(wall?.category).toBe('building');
    expect(html).not.toContain('data-tile-id="wall"');
  });

  it('opens on Auto, so one click already does something sensible', () => {
    // Auto is the default and the reason the tools are worth having: it reads
    // the square rather than making the GM name a tile first.
    const html = render(scene());
    expect(html).toContain('data-tile-id="__auto__"');
    expect(html).toMatch(/data-tile-id="__auto__"[^>]*aria-pressed="true"/);
  });

  it('says what it is waiting for before anything is painted', () => {
    const html = render(scene());
    expect(html).toContain('Pick a tile, then drag on the canvas to lay it down.');
  });

  it('says there is nothing to paint with rather than rendering an empty grid', () => {
    // (The "Loading tilesets…" branch needs a query mid-flight, which a server
    // render never has — it is not reachable from here.)
    expect(render(scene(), [])).toContain('No tilesets available.');
    expect(render(scene(), [])).not.toContain('data-testid="tiles-tab"');
  });
});

// ---------------------------------------------------------------------------
// The warning that stands between the GM and a wiped floor
// ---------------------------------------------------------------------------

describe('switching sets is destructive, and says so first', () => {
  it('warns with the set and the count when the next stroke would replace a floor', () => {
    // The server keeps no merge across sets: a stroke under another tileset
    // discards the whole existing layer, with no `clear` flag and no undo.
    const html = render(scene({ tilesetId: 'club', cells: {}, ground: cells(20), structure: {}, object: {} }));
    expect(html).toContain('data-testid="tiles-switch-warning"');
    expect(html).toContain('club');
    expect(html).toContain('20 cells');
  });

  it('stays quiet when the scene is painted with the set already selected', () => {
    const html = render(scene({ tilesetId: DEFAULT_TILESET_ID, cells: {}, ground: cells(20), structure: {}, object: {} }));
    expect(html).not.toContain('data-testid="tiles-switch-warning"');
  });

  it('stays quiet when another set is filed but nothing is painted with it', () => {
    // Erasing the last cell leaves `{tilesetId, cells:{}}` behind forever;
    // that is not work worth warning about losing.
    const html = render(
      scene({ tilesetId: 'club', cells: {}, ground: {}, structure: {}, object: {} }),
    );
    expect(html).not.toContain('data-testid="tiles-switch-warning"');
  });
});

describe('clearing the floor', () => {
  /** The `Clear floor` tag alone — `disabled:opacity-40` lives in its class. */
  const clearButton = (html: string): string =>
    /<button[^>]*data-testid="clear-floor"[^>]*>/.exec(html)?.[0] ?? '';

  it('is refused when there is no floor to clear', () => {
    expect(clearButton(render(scene()))).toContain('disabled=""');
  });

  it('is offered once something is painted, and counts it', () => {
    const html = render(scene({ tilesetId: DEFAULT_TILESET_ID, cells: {}, ground: cells(7), structure: {}, object: {} }));
    expect(clearButton(html)).not.toContain('disabled=""');
    expect(html).toContain('7 cells painted');
  });
});

// ---------------------------------------------------------------------------
// The sentence a GM plans cover from
// ---------------------------------------------------------------------------

describe('the footer describes what a painted wall actually does', () => {
  it('does not promise blocking that nothing in the repo implements', () => {
    const html = render(scene({ tilesetId: DEFAULT_TILESET_ID, cells: {}, ground: cells(3), structure: {}, object: {} }));
    // The old copy: "walls and doors you paint block movement the same way
    // drawn geometry does." Nothing reads `blocksMovement`/`blocksSight`, and
    // drawn geometry does not block either.
    expect(html).not.toMatch(/block movement/i);
    expect(html).toContain('nothing blocks movement or sight yet');
  });
});

// ---------------------------------------------------------------------------
// The two adoption rules, as pure functions
// ---------------------------------------------------------------------------

describe('resolveTileset keeps the dropdown and the brush on the same set', () => {
  it('leaves a known id alone', () => {
    expect(resolveTileset(SERVED, 'corp')).toEqual({
      tileset: SERVED.find((s) => s.id === 'corp'),
      adopt: null,
    });
  });

  it('reports the fallback as something the STORE must adopt, not just display', () => {
    // The bug: the panel fell back to `tilesets[0]` for display while the
    // canvas kept painting with the stale id, so the GM watched a set they
    // were not using stay selected while every stroke 400'd and vanished.
    const out = resolveTileset(SERVED, 'a-set-that-was-renamed');
    expect(out.tileset?.id).toBe(SERVED[0]?.id);
    expect(out.adopt).toBe(SERVED[0]?.id);
  });

  it('asks for nothing when there is nothing to offer', () => {
    expect(resolveTileset([], 'docklands')).toEqual({ tileset: undefined, adopt: null });
  });
});

describe('paintedTilesetToAdopt opens a painted scene on its own set', () => {
  it('adopts the set the scene is already painted with', () => {
    expect(paintedTilesetToAdopt(SERVED, 'docklands', 'club')).toBe('club');
  });

  it('leaves the GM alone when the scene is unpainted or already matches', () => {
    expect(paintedTilesetToAdopt(SERVED, 'docklands', undefined)).toBeNull();
    expect(paintedTilesetToAdopt(SERVED, 'club', 'club')).toBeNull();
  });

  it('does not adopt a set the catalogue no longer serves', () => {
    // Otherwise reading an old scene would poison the store with an id that
    // 400s `unknown_tileset` on the next stroke.
    expect(paintedTilesetToAdopt(SERVED, 'docklands', 'retired-set')).toBeNull();
  });
});
