/**
 * The GM's fog bar (2026-09-27): the controls in the order the GM approved,
 * one of each, and what they say about the scene. Static markup, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import { GridCommands } from '../commands.js';
import FogBar from './FogBar.js';

function scene(over: { fog?: Partial<Scene['fog']>; vision?: Scene['vision'] } = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Dock',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: over.vision ?? { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [], ...over.fog },
  } as unknown as Scene;
}

function render(s: Scene): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <FogBar scene={s} commands={new GridCommands(null, null)} />
    </QueryClientProvider>,
  );
}

/** Whether the bar's button `testId` reads pressed. */
function pressed(html: string, testId: string): boolean | null {
  const m = new RegExp(`aria-pressed="(true|false)" data-testid="${testId}"`).exec(html);
  return m ? m[1] === 'true' : null;
}

describe('<FogBar>', () => {
  it('holds each fog control once, in the order the GM approved', () => {
    const html = render(scene());
    const order = [
      'fog-bar-fog',
      'fog-bar-sight',
      'fog-bar-brush',
      'fog-bar-paint',
      'fog-bar-size',
      'fog-bar-refog',
      'fog-bar-see-as-players',
      'fog-bar-hint',
    ].map((id) => {
      const at = html.indexOf(`data-testid="${id}"`);
      expect(at, id).toBeGreaterThanOrEqual(0);
      expect(html.indexOf(`data-testid="${id}"`, at + 1), `${id} once`).toBe(-1);
      return at;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The three paints, the size from one to ten, and no named-region drawing tool.
    expect(html).toContain('>Reveal<');
    expect(html).toContain('>Reveal as seen before<');
    expect(html).toContain('>Fog again<');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
    expect(html).not.toContain('Reveal area');
  });

  it('reads the fog off on an open scene, and on when the switch or the party’s sight fogs it', () => {
    const open = render(scene());
    expect(pressed(open, 'fog-bar-fog')).toBe(false);
    expect(pressed(open, 'fog-bar-sight')).toBe(false);
    expect(open).toContain('The players and the TV see the whole map.');

    const fogged = render(scene({ fog: { enabled: true } }));
    expect(pressed(fogged, 'fog-bar-fog')).toBe(true);
    expect(fogged).toContain('The players and the TV see only what you reveal.');

    // Sightlines on with the switch never flipped: the table is fogged, and the bar says so.
    const bySight = render(scene({ vision: { playersSeeOwnSight: false, sight: 'on' } }));
    expect(pressed(bySight, 'fog-bar-fog')).toBe(true);
    expect(pressed(bySight, 'fog-bar-sight')).toBe(true);
  });

  it('opens with the brush down, revealing, three squares across, and the GM’s own view', () => {
    // What the bar says with the brush in hand, or through the players' eyes,
    // is the sentence's (`fogBarHint`, fogBar.test.ts): a static render reads
    // the store as it starts.
    const html = render(scene({ fog: { enabled: true } }));
    expect(pressed(html, 'fog-bar-brush')).toBe(false);
    expect(html).toMatch(/<option value="live" selected="">Reveal<\/option>/);
    expect(html).toMatch(/data-testid="fog-bar-size"[^>]*value="3"/);
    expect(pressed(html, 'fog-bar-see-as-players')).toBe(false);
  });
});
