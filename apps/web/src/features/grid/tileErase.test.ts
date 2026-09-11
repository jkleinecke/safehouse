/**
 * The eraser peels (docs/UX_MAP_BUILDER.md §5, phase 4): a square's top thing
 * goes first, so the stroke buffer erases by layer — one request per layer,
 * after the paint, in order — and a plain erase is still the whole square.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { TileStrokeBuffer, type TilePaint } from './api.js';
import { topLayerAt } from './autoPlace.js';

function buffer(reply: 'ok' | 'fail' = 'ok') {
  const sent: TilePaint[] = [];
  const errors: unknown[] = [];
  const buf = new TileStrokeBuffer({
    send: (body) => {
      sent.push(body);
      return reply === 'ok' ? Promise.resolve({}) : Promise.reject(new Error('unknown_tile'));
    },
    onError: (e) => void errors.push(e),
    idleMs: 10_000,
  });
  return { buf, sent, errors };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('topLayerAt', () => {
  const tiles = {
    tilesetId: 'docklands',
    ground: { '1,1': 'floor', '2,1': 'floor', '3,1': 'floor' },
    structure: { '2,1': 'wall', '3,1': 'wall' },
    object: { '3,1': 'crates' },
    cells: { '9,9': 'legacy' },
  } as unknown as NonNullable<Scene['tiles']>;

  it('names the top thing in the square, and nothing for a bare one', () => {
    expect(topLayerAt(tiles, '3,1')).toBe('object');
    expect(topLayerAt(tiles, '2,1')).toBe('structure');
    expect(topLayerAt(tiles, '1,1')).toBe('ground');
    expect(topLayerAt(tiles, '9,9')).toBe('all');
    expect(topLayerAt(tiles, '5,5')).toBeNull();
    expect(topLayerAt(undefined, '1,1')).toBeNull();
  });
});

describe('the stroke buffer erases by layer', () => {
  it('sends the paint and the whole-square erases first, then one request per layer', async () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor');
    buf.add('s1', 'docklands', '1,0', null);
    buf.add('s1', 'docklands', '2,0', null, 0, 'object');
    buf.add('s1', 'docklands', '3,0', null, 0, 'object');
    buf.add('s1', 'docklands', '4,0', null, 0, 'structure');
    expect(buf.pending).toBe(5);
    buf.flush();
    await tick();
    await tick();
    expect(sent).toEqual([
      { sceneId: 's1', tilesetId: 'docklands', paint: { '0,0': 'floor' }, erase: ['1,0'], level: 0 },
      { sceneId: 's1', tilesetId: 'docklands', paint: {}, erase: ['2,0', '3,0'], level: 0, layer: 'object' },
      { sceneId: 's1', tilesetId: 'docklands', paint: {}, erase: ['4,0'], level: 0, layer: 'structure' },
    ]);
    expect(buf.pending).toBe(0);
  });

  it('a square erased twice in one stroke is erased once, from the latest layer named', async () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '2,0', null, 0, 'object');
    buf.add('s1', 'docklands', '2,0', null, 0, 'ground');
    buf.flush();
    await tick();
    expect(sent).toEqual([{ sceneId: 's1', tilesetId: 'docklands', paint: {}, erase: ['2,0'], level: 0, layer: 'ground' }]);
  });

  it('a refused layer erase comes back into its own bucket, not the whole-square one', async () => {
    const { buf, sent, errors } = buffer('fail');
    buf.add('s1', 'docklands', '2,0', null, 0, 'object');
    buf.flush();
    await tick();
    await tick();
    expect(errors.length).toBe(1);
    expect(buf.pending).toBe(1);
    buf.flush();
    await tick();
    expect(sent[1]).toEqual({ sceneId: 's1', tilesetId: 'docklands', paint: {}, erase: ['2,0'], level: 0, layer: 'object' });
  });
});
