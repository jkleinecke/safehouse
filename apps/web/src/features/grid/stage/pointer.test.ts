/**
 * The paint-stroke state machine (FR9.2).
 *
 * Painting is the one pointer mode with no natural end-of-gesture signal in the
 * data it produces: a stroke is N independent `onTilePaint` calls, and React
 * has to know when they stop in order to send them as one request. So what is
 * pinned here is the machine's edges rather than its middle —
 *
 *   - the stroke ends on pointerup, pointercancel AND pointerleave, so a drag
 *     that finishes off the canvas neither strands the controller in
 *     'painting' nor loses its cells;
 *   - a second finger (pinch to zoom mid-floor) ends the stroke rather than
 *     abandoning it;
 *   - the per-cell de-duplication resets between strokes, so painting the same
 *     cell twice in two strokes really does send it twice.
 *
 * The controller talks to a DOM element and a host object, both of which are
 * small enough to fake — no jsdom, in a package that has none.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Point, Scene } from '@safehouse/contracts';
import { metricsFor, CELL } from '../geometry.js';
import type { StageCallbacks, StageSceneState } from '../types.js';
import { Camera } from './camera.js';
import { PointerController, type PointerHost, cellsBetween } from './pointer.js';

const M = metricsFor({ unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

interface FakeEl {
  el: HTMLElement;
  fire(type: string, event: Record<string, unknown>): void;
}

/**
 * Just enough element. `setPointerCapture` is deliberately absent: the
 * controller already guards it for exactly this case (synthetic events), and
 * leaving it out proves that guard still holds.
 */
function fakeElement(): FakeEl {
  const handlers = new Map<string, (e: never) => void>();
  const el = {
    addEventListener: (type: string, fn: (e: never) => void) => void handlers.set(type, fn),
    removeEventListener: (type: string) => void handlers.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect,
  };
  return {
    el: el as unknown as HTMLElement,
    fire(type, event) {
      handlers.get(type)?.(event as never);
    },
  };
}

function harness(tool: StageSceneState['tool']) {
  const onTilePaint = vi.fn<(col: number, row: number, erase: boolean) => void>();
  const onTileStrokeEnd = vi.fn<() => void>();
  const onTileRect =
    vi.fn<(c0: number, r0: number, c1: number, r1: number, mode: 'area' | 'room') => void>();
  const drawRect = vi.fn();
  const clearRect = vi.fn();
  const onCameraPlace = vi.fn<(x: number, y: number) => void>();
  const onCameraSelect = vi.fn<(id: string) => void>();
  const onDoorToggle = vi.fn<(id: string) => void>();
  const onTileDoorToggle = vi.fn<(cell: string, level: number) => void>();
  const onNotePlace = vi.fn<(x: number, y: number) => void>();
  const onNoteSelect = vi.fn<(id: string) => void>();
  const noop = (): void => {};
  const cb: StageCallbacks = {
    onTokenMove: noop,
    onTokenDrag: noop,
    onSelectToken: noop,
    onPing: noop,
    onPointer: noop,
    onRuler: noop,
    onDoorToggle,
    onTileDoorToggle,
    onNotePlace,
    onNoteSelect,
    onAoePlace: noop,
    onFogVertex: noop,
    onFocus: noop,
    onSegmentDraw: noop,
    onPinPlace: noop,
    onPinSelect: noop,
    onCameraPlace,
    onCameraSelect,
    onTilePaint,
    onTileStrokeEnd,
    onTileRect,
  };
  const state = {
    scene: { id: 's1', geometry: { walls: [], doors: [], zones: [], pins: [] } } as unknown as Scene,
    tokens: [],
    role: 'gm',
    draggableIds: new Set<string>(),
    bars: new Map(),
    actingTokenId: null,
    selectedTokenId: null,
    tool,
    snapEnabled: true,
    aoe: null,
    scatter: null,
    fogDraft: null,
  } as unknown as StageSceneState;

  const host: PointerHost = {
    camera: new Camera(),
    metrics: () => M,
    state: () => state,
    callbacks: cb,
    localDrag: () => {},
    echoPing: () => {},
    echoTrail: () => {},
    drawRuler: () => {},
    clearRuler: () => {},
    drawRect,
    clearRect,
  };

  const dom = fakeElement();
  const controller = new PointerController(dom.el, host);
  let clock = 1000;

  /** Screen px at the centre of a grid cell (camera is identity by default). */
  const at = (col: number, row: number): Point => ({
    x: col * CELL + CELL / 2,
    y: row * CELL + CELL / 2,
  });

  const send = (type: string, col: number, row: number, id = 1): void => {
    // Timestamps well past the 320ms double-tap window, so consecutive strokes
    // on one cell are two strokes and not a ping.
    clock += 1000;
    const p = at(col, row);
    dom.fire(type, {
      pointerId: id,
      clientX: p.x,
      clientY: p.y,
      button: 0,
      timeStamp: clock,
      shiftKey: false,
    });
  };

  const cells = (): Array<[number, number, boolean]> => onTilePaint.mock.calls.map((c) => [...c]);

  return {
    onTilePaint,
    onTileStrokeEnd,
    onTileRect,
    drawRect,
    clearRect,
    onCameraPlace,
    onCameraSelect,
    onDoorToggle,
    onTileDoorToggle,
    onNotePlace,
    onNoteSelect,
    state,
    controller,
    send,
    cells,
  };
}

// ---------------------------------------------------------------------------

describe('a hand on a door (FR9.24)', () => {
  // Through the centre of column 4, where the test clicks land.
  const door = { id: 'd1', a: { x: 4.5, y: 2 }, b: { x: 4.5, y: 4 }, open: false, locked: false };

  it('the GM and a player both ask for the door under a select click; a display does not', () => {
    for (const role of ['gm', 'player'] as const) {
      const h = harness('select');
      (h.state as { role: string }).role = role;
      h.state.scene.geometry.doors = [door];
      h.send('pointerdown', 4, 3);
      h.send('pointerup', 4, 3);
      expect(h.onDoorToggle, role).toHaveBeenCalledWith('d1');
    }
    const d = harness('select');
    (d.state as { role: string }).role = 'display';
    d.state.scene.geometry.doors = [door];
    d.send('pointerdown', 4, 3);
    d.send('pointerup', 4, 3);
    expect(d.onDoorToggle).not.toHaveBeenCalled();
  });

  it('a painted door is its whole cell, on the floor being looked at', () => {
    const h = harness('select');
    (h.state as { role: string }).role = 'player';
    (h.state.scene as { tiles?: unknown }).tiles = { tilesetId: 'docklands', structure: { '6,6': 'door', '6,5': 'wall' } };
    h.send('pointerdown', 6, 6);
    h.send('pointerup', 6, 6);
    expect(h.onTileDoorToggle).toHaveBeenCalledWith('6,6', 0);
    h.onTileDoorToggle.mockClear();
    h.send('pointerdown', 6, 5);
    h.send('pointerup', 6, 5);
    expect(h.onTileDoorToggle).not.toHaveBeenCalled();
  });
});

describe('a room or area drag', () => {
  it('fills nothing until the button comes up, then once, corners in order', () => {
    const h = harness('tile-room');
    h.send('pointerdown', 6, 5);
    h.send('pointermove', 3, 2);
    h.send('pointermove', 2, 3);
    // The rubber band followed the drag; the fill did not.
    expect(h.drawRect).toHaveBeenCalled();
    expect(h.onTileRect).not.toHaveBeenCalled();
    h.send('pointerup', 2, 3);
    // Dragged up and to the left: the callback still gets min→max.
    expect(h.onTileRect).toHaveBeenCalledWith(2, 3, 6, 5, 'room');
    expect(h.onTileRect).toHaveBeenCalledTimes(1);
    expect(h.clearRect).toHaveBeenCalled();
    // …and the brush's per-cell path was never involved.
    expect(h.onTilePaint).not.toHaveBeenCalled();
  });

  it('paints one square for a click, like any brush would', () => {
    const h = harness('tile-area');
    h.send('pointerdown', 4, 4);
    h.send('pointerup', 4, 4);
    expect(h.onTileRect).toHaveBeenCalledWith(4, 4, 4, 4, 'area');
  });

  it('is abandoned, not filled, by a second finger', () => {
    const h = harness('tile-room');
    h.send('pointerdown', 1, 1, 1);
    h.send('pointermove', 5, 5, 1);
    h.send('pointerdown', 8, 8, 2);
    h.send('pointerup', 5, 5, 1);
    h.send('pointerup', 8, 8, 2);
    expect(h.onTileRect).not.toHaveBeenCalled();
    expect(h.clearRect).toHaveBeenCalled();
  });

  it('clamps a drag that runs off the map to the cells that exist', () => {
    const h = harness('tile-area');
    h.send('pointerdown', 18, 18);
    h.send('pointermove', 25, 25);
    h.send('pointerup', 25, 25);
    // The metrics are 20×20, so the far corner is 19,19.
    expect(h.onTileRect).toHaveBeenCalledWith(18, 18, 19, 19, 'area');
  });
});

// ---------------------------------------------------------------------------

describe('a paint stroke', () => {
  it('emits the cell under the press, then each new cell of the drag once', () => {
    const h = harness('tile');
    h.send('pointerdown', 2, 3);
    h.send('pointermove', 3, 3);
    h.send('pointermove', 4, 3);
    expect(h.cells()).toEqual([
      [2, 3, false],
      [3, 3, false],
      [4, 3, false],
    ]);
  });

  it('costs nothing to drag back over your own line', () => {
    const h = harness('tile');
    h.send('pointerdown', 2, 3);
    h.send('pointermove', 3, 3);
    h.send('pointermove', 2, 3);
    h.send('pointermove', 3, 3);
    expect(h.cells()).toEqual([
      [2, 3, false],
      [3, 3, false],
    ]);
  });

  it('reports the erase flag from the tool, not from the cell', () => {
    const h = harness('tile-erase');
    h.send('pointerdown', 1, 1);
    h.send('pointermove', 2, 1);
    expect(h.cells()).toEqual([
      [1, 1, true],
      [2, 1, true],
    ]);
  });

  it('ends on pointerup and hands React the flush signal', () => {
    const h = harness('tile');
    h.send('pointerdown', 2, 3);
    expect(h.onTileStrokeEnd).not.toHaveBeenCalled();
    h.send('pointerup', 2, 3);
    expect(h.onTileStrokeEnd).toHaveBeenCalledTimes(1);
  });

  it('stops painting once it has ended', () => {
    const h = harness('tile');
    h.send('pointerdown', 2, 3);
    h.send('pointerup', 2, 3);
    h.send('pointermove', 9, 9);
    expect(h.cells()).toEqual([[2, 3, false]]);
  });

  it('de-duplicates within a stroke, never between them', () => {
    // Two deliberate strokes over the same cell are two edits. If `painted`
    // survived the stroke, the second would silently do nothing.
    const h = harness('tile');
    h.send('pointerdown', 5, 5);
    h.send('pointerup', 5, 5);
    h.send('pointerdown', 5, 5);
    h.send('pointerup', 5, 5);
    expect(h.cells()).toEqual([
      [5, 5, false],
      [5, 5, false],
    ]);
    expect(h.onTileStrokeEnd).toHaveBeenCalledTimes(2);
  });
});

describe('a stroke that does not end with a clean pointerup', () => {
  for (const ender of ['pointercancel', 'pointerleave'] as const) {
    it(`${ender} ends it, flushes it, and leaves the controller idle`, () => {
      const h = harness('tile');
      h.send('pointerdown', 2, 2);
      h.send(ender, 2, 2);
      expect(h.onTileStrokeEnd).toHaveBeenCalledTimes(1);

      // Idle, not stuck in 'painting': a bare move paints nothing…
      h.send('pointermove', 7, 7);
      expect(h.cells()).toEqual([[2, 2, false]]);
      // …and the next stroke works normally.
      h.send('pointerdown', 8, 8);
      expect(h.cells()).toEqual([
        [2, 2, false],
        [8, 8, false],
      ]);
    });
  }

  it('a second finger ends the stroke rather than abandoning its cells', () => {
    const h = harness('tile');
    h.send('pointerdown', 3, 3);
    h.send('pointerdown', 6, 6, 2); // pinch to zoom mid-floor
    expect(h.onTileStrokeEnd).toHaveBeenCalledTimes(1);
    // The second finger starts a pinch, not a second painted cell.
    expect(h.cells()).toEqual([[3, 3, false]]);
    h.send('pointermove', 9, 9, 2);
    expect(h.cells()).toEqual([[3, 3, false]]);
  });
});

describe('the paint tool does not fire when it is not selected', () => {
  it('the select tool paints nothing', () => {
    const h = harness('select');
    h.send('pointerdown', 2, 2);
    h.send('pointermove', 3, 2);
    h.send('pointerup', 3, 2);
    expect(h.onTilePaint).not.toHaveBeenCalled();
    expect(h.onTileStrokeEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stroke continuity
// ---------------------------------------------------------------------------

/**
 * Pointer moves do not arrive one per cell. Found by driving the real canvas:
 * a single horizontal drag painted columns 4, 6 and 8 and left 5 and 7 bare,
 * because each sample painted only the cell under it. A paint tool that draws
 * a dotted line reads as broken, so the gap between samples is filled.
 */
describe('cellsBetween', () => {
  it('is empty when the stroke has not left the cell', () => {
    expect(cellsBetween({ col: 3, row: 3 }, { col: 3, row: 3 })).toEqual([]);
  });

  it('excludes the start, because the caller already painted it', () => {
    const out = cellsBetween({ col: 4, row: 5 }, { col: 5, row: 5 });
    expect(out).toEqual([{ col: 5, row: 5 }]);
  });

  it('fills a horizontal gap — the exact case seen on the canvas', () => {
    expect(cellsBetween({ col: 4, row: 5 }, { col: 8, row: 5 })).toEqual([
      { col: 5, row: 5 },
      { col: 6, row: 5 },
      { col: 7, row: 5 },
      { col: 8, row: 5 },
    ]);
  });

  it('fills a vertical gap', () => {
    expect(cellsBetween({ col: 2, row: 1 }, { col: 2, row: 4 })).toEqual([
      { col: 2, row: 2 },
      { col: 2, row: 3 },
      { col: 2, row: 4 },
    ]);
  });

  it('walks backwards as happily as forwards', () => {
    expect(cellsBetween({ col: 8, row: 5 }, { col: 5, row: 5 })).toEqual([
      { col: 7, row: 5 },
      { col: 6, row: 5 },
      { col: 5, row: 5 },
    ]);
  });

  it('yields a connected diagonal, every step touching the last', () => {
    const out = cellsBetween({ col: 0, row: 0 }, { col: 4, row: 4 });
    expect(out).toEqual([
      { col: 1, row: 1 },
      { col: 2, row: 2 },
      { col: 3, row: 3 },
      { col: 4, row: 4 },
    ]);
  });

  it('never leaves a hole on a shallow diagonal', () => {
    // The property that matters, asserted rather than the exact path: each
    // step is 8-connected to the one before it, and the run ends on target.
    const from = { col: 0, row: 0 };
    const to = { col: 9, row: 3 };
    const out = cellsBetween(from, to);
    expect(out[out.length - 1]).toEqual(to);
    let prev = from;
    for (const cell of out) {
      expect(Math.abs(cell.col - prev.col)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.row - prev.row)).toBeLessThanOrEqual(1);
      expect(cell).not.toEqual(prev);
      prev = cell;
    }
  });

  it('handles negative coordinates, which the grid allows', () => {
    expect(cellsBetween({ col: -2, row: -1 }, { col: 0, row: -1 })).toEqual([
      { col: -1, row: -1 },
      { col: 0, row: -1 },
    ]);
  });
});

describe('the camera tool (FR9.23)', () => {
  it('mounts a camera where the GM clicks, and nothing else', () => {
    const h = harness('camera');
    h.send('pointerdown', 4, 3);
    h.send('pointerup', 4, 3);
    expect(h.onCameraPlace).toHaveBeenCalledTimes(1);
    const [x, y] = h.onCameraPlace.mock.calls[0]!;
    expect(Math.floor(x)).toBe(4);
    expect(Math.floor(y)).toBe(3);
    expect(h.onTilePaint).not.toHaveBeenCalled();
    expect(h.onTileRect).not.toHaveBeenCalled();
  });

  it('opens a camera under a select-tool click, for the GM', () => {
    const h = harness('select');
    (h.state.scene.geometry as { cameras?: unknown[] }).cameras = [
      { id: 'cam_1', at: { x: 4.5, y: 3.5 }, facing: 90, fov: 90, range: 12, level: 0, active: true },
    ];
    h.send('pointerdown', 4, 3);
    h.send('pointerup', 4, 3);
    expect(h.onCameraSelect).toHaveBeenCalledWith('cam_1');
    expect(h.onCameraPlace).not.toHaveBeenCalled();
  });

  it('drops a GM note under the note tool, and opens one under a select click', () => {
    const h = harness('note');
    h.send('pointerdown', 2, 2);
    h.send('pointerup', 2, 2);
    expect(h.onNotePlace).toHaveBeenCalledTimes(1);

    const s = harness('select');
    (s.state.scene.geometry as { gmNotes?: unknown[] }).gmNotes = [
      // Three lines tall, so the box reaches the middle of the cell the test clicks.
      { id: 'note_1', at: { x: 2, y: 2 }, text: 'Sniper on the roof after round 3.\nThen the HTR team.\nThen Lone Star.', width: 4 },
    ];
    s.send('pointerdown', 2, 2);
    s.send('pointerup', 2, 2);
    expect(s.onNoteSelect).toHaveBeenCalledWith('note_1');
    // …but not for a player, even if a note somehow reached their state.
    (s.state as { role: string }).role = 'player';
    s.onNoteSelect.mockClear();
    s.send('pointerdown', 2, 2);
    s.send('pointerup', 2, 2);
    expect(s.onNoteSelect).not.toHaveBeenCalled();
  });

  it('never opens one for a player, even if a camera somehow reached their state', () => {
    const h = harness('select');
    (h.state as { role: string }).role = 'player';
    (h.state.scene.geometry as { cameras?: unknown[] }).cameras = [
      { id: 'cam_1', at: { x: 4.5, y: 3.5 }, facing: 90, fov: 90, range: 12, level: 0, active: true },
    ];
    h.send('pointerdown', 4, 3);
    h.send('pointerup', 4, 3);
    expect(h.onCameraSelect).not.toHaveBeenCalled();
  });
});
