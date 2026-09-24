/**
 * The tokens panel's layers (FR9.26), as static markup: the layer list, its
 * switches, and the badge that tells the GM a token is off the table because
 * of its layer rather than its own flag.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene, Token } from '@safehouse/contracts';
import TokensTab from './TokensTab.js';

function scene(tokenLayers?: Scene['tokenLayers']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Stuffer Shack',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
    ...(tokenLayers ? { tokenLayers } : {}),
  } as unknown as Scene;
}

function token(id: string, name: string, hidden = false): Token {
  return {
    id,
    sceneId: 's1',
    source: 'npc_template',
    sourceId: null,
    name,
    x: 1,
    y: 1,
    size: 1,
    rotation: 0,
    hidden,
    level: 0,
    barsVisibility: 'gm',
  };
}

function render(s: Scene, tokens: Token[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <TokensTab campaignId="c1" scene={s} tokens={tokens} onCenter={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('<TokensTab> layers', () => {
  it('manages no layers: the stack icon on the map does that now', () => {
    const html = render(scene(), []);
    expect(html).not.toContain('data-testid="layer-add"');
    expect(html).not.toMatch(/hide the ambush/i);
  });

  it('badges the tokens a hidden layer holds back, and puts each on a layer', () => {
    const html = render(
      scene([
        { id: 'layer_1', name: 'Ambush', hidden: true, tokenIds: ['t1'] },
        { id: 'layer_2', name: 'Guards', hidden: false, tokenIds: ['t2'] },
      ]),
      [token('t1', 'Halloweener'), token('t2', 'Rent-a-cop'), token('t3', 'Wraith', true)],
    );
    // The switch itself is on the map; what stays here is what the list
    // says about a token whose layer is off.
    expect(html).not.toContain('data-testid="layer-toggle-layer_1"');
    // The ganger is off the table by layer; the wraith by its own flag.
    expect(html).toMatch(/Halloweener.*layer hidden/s);
    expect(html).not.toMatch(/Rent-a-cop<[^>]*>[^<]*<span[^>]*>layer hidden/);
    expect(html).toMatch(/Wraith<span[^>]*>hidden</);
    // Every token gets a layer picker naming both layers.
    expect(html).toContain('aria-label="layer for Halloweener"');
    expect(html).toMatch(/<option value="layer_2"[^>]*>Guards<\/option>/);
  });
});
