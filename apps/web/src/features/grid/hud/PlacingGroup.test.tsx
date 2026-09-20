/**
 * The Build row's first step: one split button per kind of thing, each
 * carrying the tile it lays. No DOM in this package, so the render half
 * asserts on static markup — where the menus are shut and zustand serves its
 * initial state — and the rules that decide what each button offers are pure
 * functions asserted directly.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TILESETS } from '@safehouse/rules';
import type { TilesetDef } from '../api.js';
import { DEFAULT_TILESET_ID } from '../store.js';
import { categoryOf } from '../tileCategories.js';
import PlacingGroup, { armedLabel, tilesFor } from './PlacingGroup.js';
import { SUBJECTS, subjectDef, subjectOf, tileIsSubject } from './subjects.js';

const SERVED = TILESETS as unknown as TilesetDef[];
const SET = SERVED.find((s) => s.id === DEFAULT_TILESET_ID)!;

function render(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['tilesets'], SERVED);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <PlacingGroup />
    </QueryClientProvider>,
  );
}

describe('what am I placing', () => {
  it('offers every category, with Wall and Door split out of building', () => {
    const html = render();
    for (const s of ['ground', 'wall', 'door', 'stairs', 'interior', 'decoration']) {
      expect(html, s).toContain(`data-testid="placing-${s}"`);
    }
    // Select is a tool, not a subject: it leads the row on its own.
    expect(html).not.toContain('data-testid="placing-select"');
    // "Building" is not how a GM says it.
    expect(html).not.toContain('title="Building"');
    expect(html).toContain('title="Wall"');
    expect(html).toContain('title="Door"');
  });

  it('hangs a tile menu off every subject', () => {
    const html = render();
    for (const s of ['ground', 'wall', 'door', 'interior', 'decoration']) {
      expect(html, s).toContain(`data-testid="placing-menu-${s}"`);
    }
    // Shut means shut: no menu over the map until one is asked for.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="placing-open-ground"');
  });

  it('reads the chosen subject back out of the tool, the category and the armed tile', () => {
    // Select is an answer to the same question: nothing, I'm picking things up.
    expect(subjectOf('select', 'ground', undefined)).toBe('select');
    expect(subjectOf('tile', 'ground', undefined)).toBe('ground');
    expect(subjectOf('tile-room', 'interior', undefined)).toBe('interior');
    // Only `building` needs the tile to say which half of it this is, and with
    // nothing armed it reads as Wall — a room needs walls.
    expect(subjectOf('tile', 'building', undefined)).toBe('wall');
    expect(subjectOf('tile', 'building', 'wall')).toBe('wall');
    expect(subjectOf('tile', 'building', 'door')).toBe('door');
  });

  it('sorts the set’s building tiles into Wall and Door with none left over', () => {
    const building = SET.tiles.filter((t) => categoryOf(t) === 'building');
    expect(building.length).toBeGreaterThan(1);
    const walls = building.filter((t) => tileIsSubject(subjectDef('wall'), t, categoryOf));
    const doors = building.filter((t) => tileIsSubject(subjectDef('door'), t, categoryOf));
    expect(walls.length).toBeGreaterThan(0);
    expect(doors.length).toBeGreaterThan(0);
    expect(walls.length + doors.length).toBe(building.length);
  });
});

describe('which tile of it', () => {
  it('gives each subject only the tiles that answer it', () => {
    const grounds = tilesFor(SET, subjectDef('ground'));
    expect(grounds.length).toBeGreaterThan(0);
    expect(grounds.every((t) => categoryOf(t) === 'ground')).toBe(true);
    expect(tilesFor(SET, subjectDef('wall')).every((t) => t.kind === 'wall')).toBe(true);
    expect(tilesFor(SET, subjectDef('door')).every((t) => t.kind === 'door')).toBe(true);
    // Select lays nothing, so it has nothing to offer.
    expect(tilesFor(SET, subjectDef('select'))).toEqual([]);
    expect(tilesFor(undefined, subjectDef('ground'))).toEqual([]);
  });

  it('names the armed tile, and falls back to Auto for one the set does not have', () => {
    const floor = SET.tiles.find((t) => t.kind === 'floor')!;
    expect(armedLabel(SET, floor.id)).toBe(floor.name);
    expect(armedLabel(SET, null)).toBe('Auto');
    expect(armedLabel(SET, 'no-such-tile')).toBe('Auto');
    expect(armedLabel(undefined, floor.id)).toBe('Auto');
  });
});

describe('the subjects themselves', () => {
  it('give every one an icon, a short name and a category to narrow to', () => {
    for (const s of SUBJECTS) {
      expect(s.glyph.length, s.id).toBeGreaterThan(0);
      // A name, not a sentence: the tooltip is all the icon is missing.
      expect(s.label.length, s.id).toBeLessThan(12);
      expect(s.category, s.id).toBeTruthy();
    }
    // Select lays nothing, so it is not one of these.
    expect(SUBJECTS.map((s) => s.id)).not.toContain('select');
    expect(subjectDef('select')).toBeUndefined();
  });
});
