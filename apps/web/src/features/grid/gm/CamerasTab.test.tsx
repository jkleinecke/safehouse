/**
 * The camera panel (FR9.23), rendered the way the other GM tabs are tested:
 * static markup, no DOM, so the questions are "is the control there" and
 * "does it say the right thing", which are the ones that go wrong.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import CamerasTab from './CamerasTab.js';

function scene(cameras: Scene['geometry']['cameras']): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Bay',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [], cameras },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

function render(s: Scene): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CamerasTab scene={s} onCenter={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('<CamerasTab>', () => {
  it('offers the mount tool and says who sees cameras', () => {
    const html = render(scene(undefined));
    expect(html).toContain('data-testid="camera-tool"');
    expect(html).toMatch(/only you see cameras/i);
    expect(html).toMatch(/no cameras on this map yet/i);
  });

  it('lists every camera by label, and marks the ones switched off', () => {
    const html = render(
      scene([
        { id: 'cam_1', at: { x: 1, y: 1 }, facing: 0, fov: 90, range: 12, level: 0, active: true, label: 'Lobby' },
        { id: 'cam_2', at: { x: 5, y: 5 }, facing: 0, fov: 90, range: 12, level: 0, active: false },
      ]),
    );
    expect(html).toContain('data-camera="cam_1"');
    expect(html).toContain('Lobby');
    expect(html).toContain('data-camera="cam_2"');
    expect(html).toMatch(/cam_2.*off/s);
  });
});
