/**
 * The half of tile painting that happens between the pointer and the wire:
 * which set a cell was painted with, which scene it belongs to, and what
 * happens to a stroke the server refuses.
 *
 * All three used to be wrong in ways that cost the GM work silently. The
 * buffer stamped itself with whatever tileset was selected at that instant, so
 * switching sets mid-stroke either 400'd the whole stroke away or repainted it
 * with the wrong tiles; it cleared itself before the request resolved, so any
 * failure ate the stroke with no feedback; and it had no unmount path, so
 * navigating away inside the idle window dropped the last cells painted.
 *
 * None of it needs a canvas or a server — the buffer takes a `send` function.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILESETS } from '@safehouse/rules';
import { TileStrokeBuffer, tileDefsFrom, type TilePaint, type TilesetDef } from './api.js';
import { DEFAULT_TILESET_ID, useGridStore } from './store.js';
import { tileDefKey } from './types.js';

// ---------------------------------------------------------------------------
// The stroke buffer
// ---------------------------------------------------------------------------

function buffer(reply: 'ok' | 'fail' = 'ok') {
  const sent: TilePaint[] = [];
  const errors: unknown[] = [];
  const buf = new TileStrokeBuffer({
    send: (body) => {
      sent.push(body);
      return reply === 'ok' ? Promise.resolve({}) : Promise.reject(new Error('unknown_tile'));
    },
    onError: (e) => void errors.push(e),
  });
  return { buf, sent, errors };
}

/** Let the `send` promise settle under fake timers. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('TileStrokeBuffer coalesces a drag into one request', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends every cell of a stroke in one body when the stroke ends', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor');
    buf.add('s1', 'docklands', '1,0', 'floor');
    buf.add('s1', 'docklands', '2,0', 'wall');
    expect(sent).toHaveLength(0); // nothing goes out mid-stroke
    buf.flush();
    expect(sent).toEqual([
      {
        sceneId: 's1',
        tilesetId: 'docklands',
        paint: { '0,0': 'floor', '1,0': 'floor', '2,0': 'wall' },
        erase: [],
        // The floor is part of every stroke; 0 is the ground, which is where
        // a scene with no upper storeys paints.
        level: 0,
      },
    ]);
  });

  it('drains itself if the gesture never reports an end', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor');
    vi.advanceTimersByTime(139);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
  });

  it('does not send the same stroke twice when the flush beats the timer', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor');
    buf.flush();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing when there is nothing buffered', () => {
    const { buf, sent } = buffer();
    buf.flush();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
  });

  it('nets a paint and an erase of the same cell down to the later one', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '4,4', 'floor');
    buf.add('s1', 'docklands', '4,4', null);
    buf.flush();
    expect(sent[0]).toMatchObject({ paint: {}, erase: ['4,4'] });

    buf.add('s1', 'docklands', '5,5', null);
    buf.add('s1', 'docklands', '5,5', 'wall');
    buf.flush();
    expect(sent[1]).toMatchObject({ paint: { '5,5': 'wall' }, erase: [] });
  });
});

describe('a stroke belongs to one scene and one tileset', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never submits set-A tile ids under set B', () => {
    // The bug: the buffer restamped its tilesetId on every cell, so a set
    // switch mid-buffer sent docklands ids to the corp set — a 400 that
    // dropped the stroke, or, for `wall`/`door`/`floor`, the wrong tile.
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'crates');
    buf.add('s1', 'corp', '1,0', 'desk');
    expect(sent).toHaveLength(1); // the switch flushed set A first
    expect(sent[0]).toMatchObject({ tilesetId: 'docklands', paint: { '0,0': 'crates' } });
    buf.flush();
    expect(sent[1]).toMatchObject({ tilesetId: 'corp', paint: { '1,0': 'desk' } });
  });

  it('never sends cells painted on one scene to another', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor');
    buf.add('s2', 'docklands', '0,0', 'floor');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.sceneId).toBe('s1');
    buf.flush();
    expect(sent[1]?.sceneId).toBe('s2');
  });
});

describe('a stroke the GM did is not thrown away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes on dispose instead of dropping the pending timer', () => {
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '3,3', 'floor');
    buf.dispose(); // component unmounting inside the idle window
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ paint: { '3,3': 'floor' } });
  });

  it('puts a refused stroke back in the buffer and says so', async () => {
    const { buf, sent, errors } = buffer('fail');
    buf.add('s1', 'docklands', '1,1', 'floor');
    buf.add('s1', 'docklands', '2,2', null);
    buf.flush();
    await settle();

    expect(errors).toHaveLength(1);
    expect(buf.pending).toBe(2); // the cells survived the rejection

    // …and it does NOT retry on its own: a deterministic 400 would loop.
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it('carries the recovered cells out with the next stroke', async () => {
    const sent: TilePaint[] = [];
    let fail = true;
    const buf = new TileStrokeBuffer({
      send: (body) => {
        sent.push(body);
        if (fail) return Promise.reject(new Error('offline'));
        return Promise.resolve({});
      },
    });
    buf.add('s1', 'docklands', '1,1', 'floor');
    buf.flush();
    await settle();

    fail = false;
    buf.add('s1', 'docklands', '2,2', 'wall');
    buf.flush();
    expect(sent[1]).toMatchObject({ paint: { '1,1': 'floor', '2,2': 'wall' } });
  });

  it('lets a cell the GM re-edited win over the one that failed', async () => {
    const { buf } = buffer('fail');
    buf.add('s1', 'docklands', '1,1', 'floor');
    buf.flush();
    buf.add('s1', 'docklands', '1,1', 'stain'); // repainted while the POST was out
    await settle();
    buf.flush();
    // The restore must not resurrect `floor` over the newer `stain`.
    expect(buf.pending).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The palette projection
// ---------------------------------------------------------------------------

describe('tileDefsFrom keeps every set’s tiles apart', () => {
  const served = TILESETS as unknown as TilesetDef[];

  it('produces an entry for every tile of every set', () => {
    const defs = tileDefsFrom(served);
    const total = served.reduce((n, s) => n + s.tiles.length, 0);
    expect(Object.keys(defs)).toHaveLength(total);
    for (const set of served) {
      for (const t of set.tiles) {
        // `toMatchObject`, not `toEqual`: this is asserting that every tile
        // survives the flattening with its OWN pattern and palette, not that
        // a tile definition never grows a field. Pinning the exact shape made
        // adding `height` fail a test about set-keying.
        expect(defs[tileDefKey(set.id, t.id)]).toMatchObject({
          pattern: t.pattern,
          colors: t.colors,
        });
      }
    }
  });

  it('carries height and emissive through, because the canvas needs both', () => {
    // The cold-load failure this guards: a def stripped of `height` draws a
    // full-height wall as a flat floor tile, which on the isometric
    // projection is the entire feature missing rather than a colour being off.
    const defs = tileDefsFrom(served);
    let heights = 0;
    let lights = 0;
    for (const set of served) {
      for (const t of set.tiles) {
        const def = defs[tileDefKey(set.id, t.id)]!;
        expect(def.height, `${set.id}/${t.id} height`).toBe(t.height);
        expect(def.emissive, `${set.id}/${t.id} emissive`).toBe(t.emissive);
        if (t.height !== undefined) heights += 1;
        if (t.emissive !== undefined) lights += 1;
      }
    }
    // Guard against the assertions above passing vacuously on a catalogue that
    // happens to define neither.
    expect(heights).toBeGreaterThan(0);
    expect(lights).toBeGreaterThan(0);
  });

  it('does not let the last set loaded win the colliding ids', () => {
    // Keyed by tile id alone this map held 38 tiles in 30 slots and a
    // Docklands warehouse rendered in Club purple.
    const defs = tileDefsFrom(served);
    const ids = new Set(served.flatMap((s) => s.tiles.map((t) => t.id)));
    expect(Object.keys(defs).length).toBeGreaterThan(ids.size);
    expect(defs[tileDefKey('docklands', 'wall')]).not.toEqual(defs[tileDefKey('club', 'wall')]);
    expect(defs[tileDefKey('docklands', 'floor')]).not.toEqual(defs[tileDefKey('club', 'floor')]);
  });
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

describe('the paint tool’s UI state', () => {
  const initial = useGridStore.getState();
  afterEach(() => useGridStore.setState(initial, true));

  it('opens on a set the catalogue actually contains', () => {
    // A literal default here used to 400 `unknown_tileset` the moment anyone
    // renamed or reordered the sets in @safehouse/rules.
    expect(TILESETS.some((t) => t.id === DEFAULT_TILESET_ID)).toBe(true);
    expect(useGridStore.getState().tilesetId).toBe(DEFAULT_TILESET_ID);
  });

  it('picking a tile picks up the brush', () => {
    useGridStore.getState().setTileId('crates');
    expect(useGridStore.getState()).toMatchObject({ tileId: 'crates', tool: 'tile' });
  });

  it('switching tileset drops the selected tile', () => {
    // Tile ids only mean anything inside their own set; carrying `crates` into
    // the corp set is a stroke the server rejects.
    useGridStore.getState().setTileId('crates');
    useGridStore.getState().setTilesetId('corp');
    expect(useGridStore.getState()).toMatchObject({ tilesetId: 'corp', tileId: null });
  });

  it('adopting the paint tool clears the drafts the other tools left behind', () => {
    const s = useGridStore.getState();
    s.setTool('fogdef');
    s.addFogVertex(1, 1);
    expect(useGridStore.getState().fogDraft?.points).toHaveLength(1);
    useGridStore.getState().setTileId('floor');
    expect(useGridStore.getState().fogDraft).toBeNull();
  });

  it('clearing the tile selection does not change the tool', () => {
    useGridStore.getState().setTileId('crates');
    useGridStore.getState().setTool('tile-erase');
    useGridStore.getState().setTileId(null);
    expect(useGridStore.getState().tool).toBe('tile-erase');
  });
});

describe('a stroke belongs to one floor', () => {
  it('flushes when the GM changes storey mid-buffer', () => {
    // The floor is part of a stroke's identity, exactly like the scene and the
    // tileset. Without that, cells painted on the catwalk would ride along in
    // the same request as the warehouse floor and land on the wrong level —
    // one request, the wrong storey, nothing on screen to explain it.
    const { buf, sent } = buffer();
    buf.add('s1', 'docklands', '0,0', 'floor', 0);
    buf.add('s1', 'docklands', '1,0', 'floor', 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 0, paint: { '0,0': 'floor' } });

    buf.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ level: 1, paint: { '1,0': 'floor' } });
  });

  it('keeps a whole stroke together while the floor does not change', () => {
    const { buf, sent } = buffer();
    for (const col of [0, 1, 2]) buf.add('s1', 'docklands', `${col},0`, 'floor', 2);
    expect(sent).toHaveLength(0);
    buf.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 2 });
    expect(Object.keys((sent[0] as { paint: Record<string, string> }).paint)).toHaveLength(3);
  });
});
