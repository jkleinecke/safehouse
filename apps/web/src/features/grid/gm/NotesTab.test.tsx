/**
 * The notes panel (FR9.25), rendered the way the other GM tabs are tested:
 * static markup, no DOM, so the questions are "is the control there" and
 * "does it say the right thing".
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import NotesTab from './NotesTab.js';

function scene(notes: Scene['geometry']['gmNotes']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], gmNotes: notes },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

function render(s: Scene): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NotesTab scene={s} onCenter={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('<NotesTab>', () => {
  it('offers the note tool and says who sees notes', () => {
    const html = render(scene(undefined));
    expect(html).toContain('data-testid="note-tool"');
    expect(html).toMatch(/only you ever see notes/i);
    expect(html).toMatch(/no notes on this map yet/i);
  });

  it('lists every note by its first line', () => {
    const html = render(
      scene([
        { id: 'note_1', at: { x: 1, y: 1 }, text: 'Sniper on the roof after round 3\nThen the HTR team.', width: 4 },
        { id: 'note_2', at: { x: 5, y: 5 }, text: '', width: 4 },
      ]),
    );
    expect(html).toContain('data-note="note_1"');
    expect(html).toContain('Sniper on the roof after round 3');
    expect(html).not.toContain('Then the HTR team');
    expect(html).toContain('data-note="note_2"');
    expect(html).toContain('(empty)');
  });
});
