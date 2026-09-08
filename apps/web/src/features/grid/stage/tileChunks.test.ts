/**
 * The bookkeeping under the chunked tile layer (FR9.2).
 *
 * The layer itself needs pixi; what it decides does not. What is pinned here
 * is the diff — which cells changed, which chunks that dirties — because an
 * error there is either a stroke that never appears (a chunk not redrawn) or
 * the full-layer redraw the chunking exists to avoid (every chunk dirtied).
 */
import { describe, expect, it } from 'vitest';
import {
  CHUNK,
  cellSignatures,
  changedCells,
  chunkDepth,
  chunkKey,
  dirtyChunks,
} from './tileLayer.js';

describe('cellSignatures', () => {
  it('folds every layer into one string per square', () => {
    const sigs = cellSignatures({
      tilesetId: 't',
      ground: { '1,1': 'floor' },
      structure: { '1,1': 'wall' },
      object: { '2,2': 'chair' },
      defs: {},
    });
    expect(sigs.get('1,1')).toContain('g=floor');
    expect(sigs.get('1,1')).toContain('s=wall');
    expect(sigs.get('2,2')).toBe('o=chair;');
    expect(sigs.size).toBe(2);
  });
});

describe('changedCells', () => {
  const sig = (m: Record<string, string>) => new Map(Object.entries(m));

  it('sees a repaint, an addition and an erasure', () => {
    const prev = sig({ '1,1': 'g=floor;', '2,2': 'g=floor;', '3,3': 'g=floor;' });
    const next = sig({ '1,1': 'g=stain;', '2,2': 'g=floor;', '4,4': 'g=floor;' });
    expect(changedCells(prev, next).sort()).toEqual(['1,1', '3,3', '4,4']);
  });

  it('sees nothing when nothing moved, whatever the order', () => {
    const prev = sig({ '1,1': 'g=floor;', '2,2': 'g=floor;' });
    const next = sig({ '2,2': 'g=floor;', '1,1': 'g=floor;' });
    expect(changedCells(prev, next)).toEqual([]);
  });
});

describe('dirtyChunks', () => {
  it('dirties the chunk a cell is in, and the neighbours only at an edge', () => {
    // Mid-chunk: a cell and its four neighbours all share one chunk.
    expect([...dirtyChunks(['3,3'])]).toEqual([chunkKey(3, 3)]);
    // On an edge: the chunk next door is dirtied too, because a wall run
    // there turns its corner from this cell.
    const edge = dirtyChunks([`${CHUNK},4`]);
    expect(edge.has(chunkKey(CHUNK, 4))).toBe(true);
    expect(edge.has(chunkKey(CHUNK - 1, 4))).toBe(true);
    expect(edge.size).toBe(2);
  });

  it('ignores a malformed key rather than dirtying the origin', () => {
    expect(dirtyChunks(['nope', '1,2,3']).size).toBe(0);
  });
});

describe('chunkDepth', () => {
  it('orders chunks the way cells are ordered, nearer later', () => {
    expect(chunkDepth(chunkKey(0, 0))).toBeLessThan(chunkDepth(chunkKey(CHUNK, 0)));
    expect(chunkDepth(chunkKey(CHUNK, 0))).toBe(chunkDepth(chunkKey(0, CHUNK)));
    expect(chunkDepth(chunkKey(CHUNK, CHUNK))).toBeGreaterThan(chunkDepth(chunkKey(CHUNK, 0)));
  });
});
