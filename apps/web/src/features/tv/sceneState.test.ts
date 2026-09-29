import { describe, expect, it } from 'vitest';
import { sceneFogOn, type Scene, type Token, type Visibility, type WsEvent } from '@safehouse/contracts';
import { cellBitsFrom, encodeCellBits } from '@safehouse/rules';
// The fog a display device is sent, shared with the server's tests (see the file for why).
import { FOG_WIRE_UNREVEALED } from '../../../../../packages/contracts/test/fog-fixtures.js';
import { metricsFor } from '../grid/geometry.js';
import { CoverMasks } from '../grid/stage3d/masks.js';
import { tvStageState } from '../grid/tvStage.js';
import {
  mergeSceneEvents,
  tvActiveSceneId,
  tvReveal,
  type TvSceneSnapshot,
} from './sceneState.js';

let nextId = 0;

function evt(type: string, payload: unknown, visibility: Visibility = 'public'): WsEvent {
  nextId += 1;
  return { id: nextId, type, payload, visibility, ts: '2076-05-12T21:00:00.000Z' };
}

function token(over: Partial<Token> & { id: string }): Token {
  return {
    sceneId: 's1',
    source: 'character',
    name: over.id,
    x: 1,
    y: 1,
    size: 1,
    rotation: 0,
    hidden: false,
    level: 0,
    barsVisibility: 'public',
    ...over,
  };
}

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Redmond rooftop',
    state: 'active',
    grid: { unitM: 1, cols: 30, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: ['map-1'],
    ...over,
  };
}

/** A REST read that landed before any of the events below existed. */
function snapshot(over: Partial<TvSceneSnapshot> = {}): TvSceneSnapshot {
  return {
    scene: scene(),
    tokens: [token({ id: 'wisp', x: 3, y: 4 }), token({ id: 'nine', x: 7, y: 2 })],
    asOfEventId: 0,
    ...over,
  };
}

const square = (n: number) => [
  { x: n, y: n },
  { x: n + 2, y: n },
  { x: n + 2, y: n + 2 },
  { x: n, y: n + 2 },
];

describe('hydration without a socket', () => {
  it('draws the hydrated scene with zero WS traffic — the reboot case', () => {
    const base = snapshot({
      scene: scene({
        fog: {
          regions: [{ id: 'r1', name: 'east wing', polygon: square(2) }],
          revealed: ['r1'],
          revealedShapes: [],
        },
      }),
    });

    const merged = mergeSceneEvents(base, []);
    expect(merged).toBe(base); // nothing applied → same identity, no churn

    const state = tvStageState({
      scene: merged!.scene,
      tokens: merged!.tokens,
      bars: new Map(),
      actingTokenId: null,
    });
    expect(state.scene.mapAttachmentIds).toEqual(['map-1']);
    expect(state.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
    expect(state.scene.fog.revealed).toEqual(['r1']);
    expect(state.role).toBe('display');
  });

  it('is null before the first read rather than inventing an empty scene', () => {
    expect(mergeSceneEvents(null, [evt('token.moved', { tokenId: 'wisp', x: 9, y: 9 })])).toBeNull();
  });
});

describe('mergeSceneEvents', () => {
  it('moves a token the stream reports', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5, rotation: 90 }),
    ]);
    expect(merged?.tokens.find((t) => t.id === 'wisp')).toMatchObject({ x: 12, y: 5, rotation: 90 });
  });

  it('adds, updates and removes tokens', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.added', { token: token({ id: 'ganger', x: 20, y: 8 }) }),
      evt('token.updated', { token: token({ id: 'nine', x: 7, y: 2, name: 'Nine-Toes' }) }),
      evt('token.removed', { tokenId: 'wisp', sceneId: 's1' }),
    ]);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['nine', 'ganger']);
    expect(merged?.tokens.find((t) => t.id === 'nine')?.name).toBe('Nine-Toes');
  });

  it('reveals and hides named fog regions', () => {
    const region = { id: 'r2', name: 'the lab', polygon: square(5) };
    const revealed = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r2', region }),
    ]);
    expect(revealed?.scene.fog.revealed).toEqual(['r2']);
    expect(revealed?.scene.fog.regions.map((r) => r.name)).toEqual(['the lab']);

    const hidden = mergeSceneEvents(revealed, [
      evt('fog.updated', { sceneId: 's1', op: 'hide', regionId: 'r2' }),
    ]);
    expect(hidden?.scene.fog.revealed).toEqual([]);
    expect(hidden?.scene.fog.regions).toEqual([]);
  });

  it('appends freeform reveals once, however often they replay', () => {
    const shape = square(9);
    const once = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape }),
    ]);
    expect(once?.scene.fog.revealedShapes).toHaveLength(1);
    // The same polygon arriving again (replay after reconnect) is not a second
    // brush stroke — an unbounded list on a six-hour kiosk is a leak.
    const twice = mergeSceneEvents(once, [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape }),
    ]);
    expect(twice?.scene.fog.revealedShapes).toHaveLength(1);
  });

  it('takes an environment change from scene.updated', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('scene.updated', {
        sceneId: 's1',
        changed: ['environment'],
        environment: { light: 3, visibility: 2, glare: 0, wind: 0 },
        vision: { playersSeeOwnSight: false },
      }),
    ]);
    expect(merged?.scene.environment.light).toBe(3);
  });

  it('IGNORES a gm-visibility event in the stream', () => {
    const base = snapshot();
    const merged = mergeSceneEvents(base, [
      evt('token.added', { token: token({ id: 'ambusher', x: 25, y: 3 }) }, 'gm'),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'secret' }, 'gm'),
      evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 99, y: 99 }, 'gm'),
    ]);
    expect(merged).toBe(base);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
    expect(merged?.scene.fog.revealed).toEqual([]);
  });

  it('ignores events belonging to another scene', () => {
    const base = snapshot();
    expect(
      mergeSceneEvents(base, [
        evt('token.moved', { tokenId: 'wisp', sceneId: 'other', x: 99, y: 99 }),
        evt('fog.updated', { sceneId: 'other', op: 'reveal', regionId: 'x' }),
      ]),
    ).toBe(base);
  });

  it('never lets a hidden token through, even if one is somehow relayed', () => {
    const merged = mergeSceneEvents(snapshot(), [
      evt('token.added', { token: token({ id: 'sneak', hidden: true }) }),
    ]);
    expect(merged?.tokens.map((t) => t.id)).toEqual(['wisp', 'nine']);
  });

  it('keeps the fashion of a reveal: seen-before apart from live, moved across, and hidden out of both (P6)', () => {
    // The GM's two reveal fashions (the GM, 2026-09-27). The TV folds each
    // reveal into the list its `as` names, so its fog comes out as exactly
    // the copy a fresh read would give: remembered ground drawn dimmed, live
    // ground open.
    const region = { id: 'r2', name: 'the lab', polygon: square(5) };
    const remembered = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r2', region, as: 'explored', active: true }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape: square(9), as: 'explored', active: true }),
    ]);
    expect(remembered?.scene.fog).toEqual({
      regions: [region],
      revealed: [],
      revealedShapes: [],
      exploredRegionIds: ['r2'],
      exploredShapes: [square(9)],
      active: true,
    });

    // Revealed live: the lab moves across, and is never in both lists. An
    // event from before explored reveals, which says no `as`, is live.
    const live = mergeSceneEvents(remembered, [evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r2', active: true })]);
    expect(live?.scene.fog.revealed).toEqual(['r2']);
    expect(live?.scene.fog).not.toHaveProperty('exploredRegionIds');
    expect(live?.scene.fog.exploredShapes).toEqual([square(9)]);

    // Dropped back to seen before, then hidden: out of both.
    const back = mergeSceneEvents(live, [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r2', region, as: 'explored', active: true }),
    ]);
    expect(back?.scene.fog.revealed).toEqual([]);
    expect(back?.scene.fog.exploredRegionIds).toEqual(['r2']);
    const hidden = mergeSceneEvents(back, [evt('fog.updated', { sceneId: 's1', op: 'hide', regionId: 'r2', active: true })]);
    expect(hidden?.scene.fog).toEqual({ regions: [], revealed: [], revealedShapes: [], exploredShapes: [square(9)], active: true });

    // The GM's reset takes back every reveal of both fashions.
    const reset = mergeSceneEvents(hidden, [evt('fog.updated', { sceneId: 's1', op: 'hide', active: true })]);
    expect(reset?.scene.fog).toEqual(FOG_WIRE_UNREVEALED);
  });

  it('files the same painted shape once per fashion, however often it replays', () => {
    const shape = square(9);
    const both = mergeSceneEvents(snapshot(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape, as: 'explored' }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape, as: 'explored' }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape, as: 'live' }),
    ]);
    expect(both?.scene.fog.exploredShapes).toEqual([shape]);
    expect(both?.scene.fog.revealedShapes).toEqual([shape]);
  });

  it("carries the read's explored reveals and the party's sight through events that do not touch them", () => {
    // A fold that rebuilt the fog from the three old lists alone dropped
    // the remembered ground, and every square the party had seen, at the
    // first token that moved.
    const region = { id: 'r2', name: 'the lab', polygon: square(5) };
    const sight = { cols: 30, rows: 20, levels: { '0': { live: 'AQ==', explored: 'Aw==' } } };
    const fog: Scene['fog'] = {
      regions: [region],
      revealed: [],
      revealedShapes: [],
      exploredRegionIds: ['r2'],
      exploredShapes: [square(9)],
      sight,
      active: true,
    };
    const base = snapshot({ scene: scene({ fog }) });
    const moved = mergeSceneEvents(base, [evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5 })]);
    expect(moved).not.toBe(base);
    expect(moved?.scene.fog).toEqual(fog);
  });

  it('skips events the snapshot already reflects', () => {
    const base = snapshot({ asOfEventId: 1_000 });
    const stale = { ...evt('token.moved', { tokenId: 'wisp', x: 99, y: 99 }), id: 900 };
    expect(mergeSceneEvents(base, [stale])).toBe(base);
  });
});

/**
 * The TV's fog, folded from the public events (FR9.13).
 *
 * The TV reads the scene once and then folds the stream onto it, so whether
 * the wall screen is covered depends on what the fold keeps. The server's
 * public fog events never carry an unrevealed region. A scene fogged with
 * nothing revealed, or reset, therefore folds down to no regions at all, and
 * the one thing that keeps the TV covered is `active`, the bit each of those
 * events carries. Before it existed the TV was never even told a scene had
 * been fogged: the `define` went to the GM alone.
 *
 * The folded copy must come out as exactly the copy a fresh read would give
 * (`FOG_WIRE_UNREVEALED`, the fixture the server's tests assert), and the
 * TV's own stage must cover it (`CoverMasks` as `display`, which in node
 * takes its fail-closed path; see stage3d/masks.test.ts).
 */
describe('the fog on the TV (FR9.13)', () => {
  /** How covered the centre of every square is on the TV's stage, drawn from `snap`. */
  function tvCover(masks: CoverMasks, snap: TvSceneSnapshot): number[] {
    masks.update(tvStageState({ scene: snap.scene, tokens: snap.tokens }), metricsFor(snap.scene.grid));
    const { cols, rows } = snap.scene.grid;
    const out: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) out.push(masks.coveredAt({ x: col + 0.5, y: row + 0.5 }, 'fog'));
    }
    return out;
  }
  const squares = (s: TvSceneSnapshot) => s.scene.grid.cols * s.scene.grid.rows;

  it('stays covered through a define, a reveal and a hide, and opens when an event says the fog is off', () => {
    // An open scene, as a fresh read of one says it.
    const open = snapshot({
      scene: scene({ fog: { regions: [], revealed: [], revealedShapes: [], active: false } }),
    });
    const region = { id: 'r1', name: 'east wing', polygon: square(2) };

    // The GM fogs it: the table's word is one bit.
    const fogged = mergeSceneEvents(open, [evt('fog.updated', { sceneId: 's1', op: 'define', active: true })]);
    expect(fogged?.scene.fog).toEqual(FOG_WIRE_UNREVEALED);

    // A region revealed and hidden again: the hole comes and goes, the fog stays.
    const revealed = mergeSceneEvents(fogged, [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'r1', region, active: true }),
    ]);
    expect(revealed?.scene.fog).toEqual({ ...FOG_WIRE_UNREVEALED, regions: [region], revealed: ['r1'] });
    const hidden = mergeSceneEvents(revealed, [evt('fog.updated', { sceneId: 's1', op: 'hide', regionId: 'r1', active: true })]);
    expect(hidden?.scene.fog).toEqual(FOG_WIRE_UNREVEALED);

    const masks = new CoverMasks('low');
    try {
      expect(tvCover(masks, hidden!)).toEqual(new Array<number>(squares(hidden!)).fill(1));

      // The GM switches the fog off: the TV folds `active: false` and the
      // whole map is on the wall again.
      const off = mergeSceneEvents(hidden, [evt('fog.updated', { sceneId: 's1', op: 'disable', active: false })]);
      expect(off?.scene.fog).toEqual({ ...FOG_WIRE_UNREVEALED, active: false });
      expect(tvCover(masks, off!)).toEqual(new Array<number>(squares(off!)).fill(0));
    } finally {
      masks.dispose();
    }
  });

  it("keeps a copy that says the fog with the GM's switch (`enabled`) as it was through a token move", () => {
    // The GM's read has `enabled` and no `active`. The rebuild after the
    // first move dropped the switch, and the GM's TV view opened.
    const move = () => evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5 });
    const on = snapshot({ scene: scene({ fog: { regions: [], revealed: [], revealedShapes: [], enabled: true } }) });
    const moved = mergeSceneEvents(on, [move()]);
    expect(moved).not.toBe(on);
    expect(sceneFogOn(moved!.scene)).toBe(true);
    const masks = new CoverMasks('low');
    try {
      expect(tvCover(masks, moved!)).toEqual(new Array<number>(squares(moved!)).fill(1));
    } finally {
      masks.dispose();
    }

    // And switched off with a region drawn stays open.
    const region = { id: 'r1', name: 'east wing', polygon: square(2) };
    const off = snapshot({ scene: scene({ fog: { regions: [region], revealed: [], revealedShapes: [], enabled: false } }) });
    expect(sceneFogOn(mergeSceneEvents(off, [move()])!.scene)).toBe(false);
  });
});

/**
 * The party's sight on the TV (sightlines, P6).
 *
 * After every committed change that moves it — a runner's step, a door, a
 * light — the server sends one public `fog.updated {op: 'sight', cols, rows,
 * levels, active}` carrying the WHOLE record, and the TV folds it in place
 * of its own. The GM's `forget` comes first as `{op: 'forget', level?}`,
 * and the TV wipes the floor's memory back to what the runners see now, as
 * the server does, whether or not a `sight` event follows it. Either way the
 * sight must then survive every event that is not about it, and the TV's
 * own stage must draw it: live clear, remembered dimmed, the rest covered.
 */
describe("the party's sight on the TV (P6)", () => {
  type Cells = [number, number][];
  const COLS = 30;
  const ROWS = 20;
  const bits = (cells: Cells): string => encodeCellBits(cellBitsFrom(COLS, ROWS, cells.map(([col, row]) => ({ col, row }))));

  /** A scene fogged by its sightlines, as a fresh read of it gives it to the TV: nothing seen yet. */
  const dark = (): TvSceneSnapshot =>
    snapshot({ scene: scene({ fog: { regions: [], revealed: [], revealedShapes: [], active: true } }) });

  /** The server's sight event: every floor's live and explored squares, whole. */
  function sightEvent(floors: Record<string, { live: Cells; explored: Cells }>): WsEvent {
    const levels: Record<string, { live: string; explored: string }> = {};
    for (const [level, f] of Object.entries(floors)) levels[level] = { live: bits(f.live), explored: bits(f.explored) };
    return evt('fog.updated', { sceneId: 's1', op: 'sight', cols: COLS, rows: ROWS, levels, active: true });
  }

  /** How covered one square's centre is on the TV's stage, drawn from `snap`. */
  function tvAt(snap: TvSceneSnapshot, col: number, row: number): number {
    const masks = new CoverMasks('low');
    try {
      masks.update(tvStageState({ scene: snap.scene, tokens: snap.tokens }), metricsFor(snap.scene.grid));
      return masks.coveredAt({ x: col + 0.5, y: row + 0.5 }, 'fog');
    } finally {
      masks.dispose();
    }
  }

  it('takes the sight an event carries, whole, and draws it: live clear, remembered dimmed, the rest covered', () => {
    const seen = sightEvent({ '0': { live: [[3, 4]], explored: [[3, 4], [10, 10]] } });
    const folded = mergeSceneEvents(dark(), [seen]);
    expect(folded?.scene.fog.sight).toEqual({
      cols: COLS,
      rows: ROWS,
      levels: { '0': { live: bits([[3, 4]]), explored: bits([[3, 4], [10, 10]]) } },
    });
    expect(folded?.scene.fog.active).toBe(true);
    expect(tvAt(folded!, 3, 4)).toBe(0);
    expect(tvAt(folded!, 10, 10)).toBeGreaterThan(0.3);
    expect(tvAt(folded!, 10, 10)).toBeLessThan(0.9);
    expect(tvAt(folded!, 20, 15)).toBe(1);

    // The next step replaces it, not adds to it: the event is the record.
    const stepped = mergeSceneEvents(folded, [sightEvent({ '0': { live: [[4, 4]], explored: [[3, 4], [4, 4], [10, 10]] } })]);
    expect(stepped?.scene.fog.sight?.levels['0']).toEqual({ live: bits([[4, 4]]), explored: bits([[3, 4], [4, 4], [10, 10]]) });
    expect(tvAt(stepped!, 3, 4)).toBeGreaterThan(0.3);
    expect(tvAt(stepped!, 4, 4)).toBe(0);
  });

  it('keeps the sight through every event that is not about it', () => {
    const folded = mergeSceneEvents(dark(), [
      sightEvent({ '0': { live: [[3, 4]], explored: [[3, 4]] } }),
      evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 3.5, y: 4.5 }),
      evt('fog.updated', { sceneId: 's1', op: 'hide', active: true }),
      evt('scene.updated', { sceneId: 's1', environment: { light: 2 } }),
    ]);
    expect(folded?.scene.fog.sight?.levels['0']?.live).toBe(bits([[3, 4]]));
  });

  it('takes the sight away when an event says there is none left', () => {
    const folded = mergeSceneEvents(dark(), [sightEvent({ '0': { live: [[3, 4]], explored: [[3, 4]] } })]);
    const gone = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'sight', cols: COLS, rows: ROWS, levels: {}, active: false })]);
    expect(gone?.scene.fog).not.toHaveProperty('sight');
    expect(gone?.scene.fog.active).toBe(false);
  });

  it('ignores a sight it cannot read, rather than guess at one', () => {
    const base = dark();
    // A grid past the cap, and a floor that is not a floor: refused whole.
    const huge = evt('fog.updated', { sceneId: 's1', op: 'sight', cols: 1e9, rows: 1e9, levels: { '0': { live: '', explored: '' } }, active: true });
    const odd = evt('fog.updated', { sceneId: 's1', op: 'sight', cols: COLS, rows: ROWS, levels: { roof: { live: '', explored: '' } }, active: true });
    expect(mergeSceneEvents(base, [huge, odd])).toBe(base);
  });

  it("forgets one floor's memory back to what the runners see now, or every floor's", () => {
    const folded = mergeSceneEvents(dark(), [
      sightEvent({
        '0': { live: [[3, 4]], explored: [[3, 4], [10, 10]] },
        '1': { live: [], explored: [[5, 5]] },
      }),
    ]);
    const groundForgotten = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'forget', level: 0, active: true })]);
    expect(groundForgotten?.scene.fog.sight?.levels).toEqual({
      '0': { live: bits([[3, 4]]), explored: bits([[3, 4]]) },
      '1': { live: '', explored: bits([[5, 5]]) },
    });
    // The room left behind goes back under the fog; the one she stands in stays.
    expect(tvAt(groundForgotten!, 10, 10)).toBe(1);
    expect(tvAt(groundForgotten!, 3, 4)).toBe(0);

    const allForgotten = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'forget', active: true })]);
    expect(allForgotten?.scene.fog.sight?.levels).toEqual({
      '0': { live: bits([[3, 4]]), explored: bits([[3, 4]]) },
      '1': { live: '', explored: '' },
    });

    // Forgetting what is not remembered changes nothing at all.
    expect(mergeSceneEvents(allForgotten, [evt('fog.updated', { sceneId: 's1', op: 'forget', active: true })])).toBe(allForgotten);
  });

  it('never folds a sight meant for the GM alone, or for another scene', () => {
    const base = dark();
    const levels = { '0': { live: bits([[3, 4]]), explored: bits([[3, 4]]) } };
    expect(
      mergeSceneEvents(base, [
        evt('fog.updated', { sceneId: 's1', op: 'sight', cols: COLS, rows: ROWS, levels, active: true }, 'gm'),
        evt('fog.updated', { sceneId: 's2', op: 'sight', cols: COLS, rows: ROWS, levels, active: true }),
      ]),
    ).toBe(base);
  });

  it("takes the GM's brush an event carries, whole, draws it over the rest, and loses it to the reset (P6)", () => {
    // The square-by-square brush (FR9.13): `fog.updated {op: 'brush'}` is the
    // whole record, as the sight is, and a mark wins over the memory.
    const brush = {
      cols: COLS,
      rows: ROWS,
      levels: { '0': { live: bits([[12, 12]]), explored: bits([[13, 12]]), hidden: bits([[10, 10]]) } },
    };
    const folded = mergeSceneEvents(dark(), [
      sightEvent({ '0': { live: [[3, 4]], explored: [[3, 4], [10, 10]] } }),
      evt('fog.updated', { sceneId: 's1', op: 'brush', level: 0, ...brush, active: true }),
    ]);
    expect(folded?.scene.fog.brush).toEqual(brush);
    expect(tvAt(folded!, 12, 12)).toBe(0);
    expect(tvAt(folded!, 13, 12)).toBeGreaterThan(0.3);
    expect(tvAt(folded!, 13, 12)).toBeLessThan(0.9);
    expect(tvAt(folded!, 10, 10)).toBe(1); // remembered, fogged again
    // Kept through events that are not about it.
    const moved = mergeSceneEvents(folded, [sightEvent({ '0': { live: [[4, 4]], explored: [[3, 4], [4, 4], [10, 10]] } })]);
    expect(moved?.scene.fog.brush).toEqual(brush);
    // Gone when an event says none is left, and with the GM's reset.
    const cleared = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'brush', cols: COLS, rows: ROWS, levels: {}, active: true })]);
    expect(cleared?.scene.fog).not.toHaveProperty('brush');
    const reset = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'hide', active: true })]);
    expect(reset?.scene.fog).not.toHaveProperty('brush');
    // One it cannot read changes nothing.
    expect(mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'brush', cols: 1e9, rows: 1, levels: {}, active: true })])).toBe(folded);
  });

  it('starts over on the GM’s "Fog everything": every reveal, the brush and the memory go, and only what the runners see stays', () => {
    // A TV that had the lab revealed, a painted shape, the brush and the
    // party's memory, before the GM pressed "Fog everything" (`refog`, the
    // fog bar): the op's own event is bare, `{op, active}`, and must be
    // enough on its own, whatever else follows it.
    const lab = { id: 'lab', name: 'the lab', polygon: square(5) };
    const folded = mergeSceneEvents(dark(), [
      evt('fog.updated', { sceneId: 's1', op: 'reveal', regionId: 'lab', region: lab, active: true }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', shape: square(15), as: 'explored', active: true }),
      sightEvent({ '0': { live: [[3, 4]], explored: [[3, 4], [10, 10]] } }),
      evt('fog.updated', {
        sceneId: 's1',
        op: 'brush',
        level: 0,
        cols: COLS,
        rows: ROWS,
        levels: { '0': { live: bits([[12, 12]]), explored: '', hidden: '' } },
        active: true,
      }),
    ]);
    // (The regions and shapes are drawn on a canvas, which node has none of,
    // so their holes are checked in the fog itself below; the squares the
    // brush and the party's sight decide are stamped without one.)
    expect(folded!.scene.fog.revealed).toEqual(['lab']);
    expect(folded!.scene.fog.exploredShapes).toHaveLength(1);
    expect(tvAt(folded!, 12, 12)).toBe(0);
    expect(tvAt(folded!, 10, 10)).toBeGreaterThan(0.3);
    expect(tvAt(folded!, 10, 10)).toBeLessThan(0.9);

    const refogged = mergeSceneEvents(folded, [evt('fog.updated', { sceneId: 's1', op: 'refog', active: true })]);
    const fog = refogged!.scene.fog;
    expect(fog.regions).toEqual([]);
    expect(fog.revealed).toEqual([]);
    expect(fog.revealedShapes).toEqual([]);
    expect(fog.exploredShapes ?? []).toEqual([]);
    expect(fog).not.toHaveProperty('brush');
    expect(fog.sight?.levels['0']).toEqual({ live: bits([[3, 4]]), explored: bits([[3, 4]]) });
    expect(fog.active).toBe(true);
    // Covered everywhere but where the runner looks now.
    expect(tvAt(refogged!, 3, 4)).toBe(0);
    for (const [col, row] of [[12, 12], [10, 10]] as const) expect(tvAt(refogged!, col, row), `${col},${row}`).toBe(1);
  });
});

describe('reconnect', () => {
  it('a fresh read replaces the merged state and retires the old deltas', () => {
    const moved = evt('token.moved', { tokenId: 'wisp', sceneId: 's1', x: 12, y: 5 });
    const before = mergeSceneEvents(snapshot(), [moved]);
    expect(before?.tokens.find((t) => t.id === 'wisp')?.x).toBe(12);

    // The socket dropped and came back; REST is re-read and now includes the
    // move, plus everything the TV missed while it was gone.
    const rehydrated = snapshot({
      scene: scene({ fog: { regions: [], revealed: ['r9'], revealedShapes: [] } }),
      tokens: [token({ id: 'wisp', x: 12, y: 5 }), token({ id: 'nine', x: 7, y: 2 })],
      asOfEventId: moved.id,
    });
    const after = mergeSceneEvents(rehydrated, [moved]);
    expect(after).toBe(rehydrated); // the replayed delta applies nothing new
    expect(after?.scene.fog.revealed).toEqual(['r9']);
    expect(after?.tokens.find((t) => t.id === 'wisp')?.x).toBe(12);
  });
});

describe('tvActiveSceneId', () => {
  it('prefers the newest activation over the cached read', () => {
    expect(
      tvActiveSceneId(
        [evt('scene.activated', { sceneId: 's1' }), evt('scene.activated', { sceneId: 's2' })],
        'cached',
      ),
    ).toBe('s2');
  });

  it('picks by event id, not array position', () => {
    const older = evt('scene.activated', { sceneId: 's1' });
    const newer = evt('scene.activated', { sceneId: 's2' });
    expect(tvActiveSceneId([newer, older], null)).toBe('s2');
    expect(tvActiveSceneId([older, newer], null)).toBe('s2');
  });

  it('falls back to the REST value when the stream is silent', () => {
    expect(tvActiveSceneId([], 'cached')).toBe('cached');
    expect(tvActiveSceneId([], null)).toBeNull();
  });

  it('will not follow a gm-only activation', () => {
    expect(tvActiveSceneId([evt('scene.activated', { sceneId: 'staged' }, 'gm')], 's1')).toBe('s1');
  });
});

describe('tvReveal', () => {
  it('announces the newest named region reveal', () => {
    const reveal = tvReveal([
      evt('fog.updated', { sceneId: 's1', op: 'reveal', region: { id: 'r1', name: 'east wing' } }),
      evt('fog.updated', { sceneId: 's1', op: 'reveal', region: { id: 'r2', name: 'the lab' } }),
    ]);
    expect(reveal?.name).toBe('the lab');
  });

  it('picks by event id, not array position', () => {
    const older = evt('fog.updated', { op: 'reveal', region: { id: 'r1', name: 'east wing' } });
    const newer = evt('fog.updated', { op: 'reveal', region: { id: 'r2', name: 'the lab' } });
    expect(tvReveal([newer, older])?.name).toBe('the lab');
    expect(tvReveal([older, newer])?.name).toBe('the lab');
  });

  it('says nothing for a hide, an unnamed brush reveal, or a gm event', () => {
    expect(tvReveal([evt('fog.updated', { op: 'hide', regionId: 'r1' })])).toBeNull();
    expect(tvReveal([evt('fog.updated', { op: 'reveal', shape: square(1) })])).toBeNull();
    expect(
      tvReveal([evt('fog.updated', { op: 'reveal', region: { id: 'r', name: 'vault' } }, 'gm')]),
    ).toBeNull();
  });
});
