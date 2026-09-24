/**
 * Building a floor from a description (FR12.11, lane 3).
 *
 * Two halves. The compiler is pure: a plan on a grid with a set always paints
 * the same squares, and everything the model got wrong is a warning the GM
 * reads — never a silent fix. The route is the model in the loop: the answer
 * comes back as slots the paint route already accepts, nothing is painted,
 * the usage meter ticks, and without a model the lane says so.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toSlot, tilesetById } from '@safehouse/rules';
import { compileFloorPlan, floorPalette, outsideGroundFor, type FloorPlanInput } from '../src/fixer/floor-plan.js';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { bootstrapCampaign, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';
import { disableAi, enableAi } from './fixer-helpers.js';

const dock = tilesetById('docklands')!;
const GRID = { cols: 20, rows: 15 };

const PLAN: FloorPlanInput = {
  title: 'Two-room clinic',
  rooms: [
    { name: 'waiting room', kind: 'lobby', x: 0, y: 0, w: 6, h: 5, props: [{ tile: 'crates', x: 2, y: 2 }] },
    // Shares the waiting room's east wall (x = 5).
    { name: 'exam room', kind: 'room', x: 5, y: 0, w: 5, h: 5, floor: 'stain', props: [{ tile: 'barrel', x: 7, y: 2 }] },
  ],
  openings: [
    { room: 'waiting room', wall: 's', offset: 2, width: 1, kind: 'door' },
    { room: 'exam room', wall: 'w', offset: 2, kind: 'door' },
    { room: 'exam room', wall: 'n', offset: 1, width: 2, kind: 'window' },
  ],
  stairs: [{ x: 3, y: 3, direction: 'up' }],
  notes: 'The exam room has a stained floor.',
};

describe('compileFloorPlan', () => {
  const out = compileFloorPlan(PLAN, GRID, dock);

  it('paints a room as floor with a wall ring, in slots', () => {
    expect(out.layers.ground['0,0']).toBe('ground/1');
    expect(out.layers.ground['2,2']).toBe('ground/1');
    expect(out.layers.structure['0,0']).toBe('building/wall');
    expect(out.layers.structure['5,2']).toBe('building/door'); // the shared wall's door
    expect(out.layers.structure['2,2']).toBeUndefined(); // inside is floor only
    expect(out.rooms.map((r) => r.name)).toEqual(['waiting room', 'exam room']);
  });

  it('gives a room its own floor when it names a ground tile', () => {
    expect(out.layers.ground['7,2']).toBe('ground/2'); // stain
    expect(out.layers.ground['5,2']).toBe('ground/2'); // the shared wall square takes the later room's floor
  });

  it('cuts doors and windows into the named wall, never at a corner', () => {
    expect(out.layers.structure['2,4']).toBe('building/door'); // waiting room, south wall
    expect(out.layers.structure['6,0']).toBe('building/window');
    expect(out.layers.structure['7,0']).toBe('building/window');
    expect(out.layers.structure['5,0']).toBe('building/wall'); // the corner stays
    expect(out.counts).toMatchObject({ door: 2, window: 2 });
  });

  it('places props and stairs on floor squares only', () => {
    expect(out.layers.object['2,2']).toBe('interior/1'); // crates
    expect(out.layers.object['7,2']).toBe('decoration/1'); // barrel
    expect(out.layers.structure['3,3']).toBe('stairs/up');
    expect(out.counts).toMatchObject({ prop: 2, stair: 1 });
    expect(out.warnings).toEqual([]);
  });

  it('warns about everything it had to drop or move, and keeps going', () => {
    const messy = compileFloorPlan(
      {
        title: 'Messy',
        rooms: [
          { name: 'big', x: 18, y: 13, w: 6, h: 6 }, // hangs off the grid
          { name: 'ok', x: 0, y: 0, w: 4, h: 4, props: [{ tile: 'wall', x: 1, y: 1 }, { tile: 'crates', x: 0, y: 0 }] },
          { name: 'ok', x: 10, y: 10, w: 3, h: 3 },
        ],
        openings: [
          { room: 'nowhere', wall: 'n' },
          { room: 'ok', wall: 'n', offset: 0, width: 9 },
        ],
        stairs: [{ x: 0, y: 0, direction: 'down' }],
      },
      GRID,
      dock,
    );
    expect(messy.warnings.join('\n')).toMatch(/"big" clamped/);
    expect(messy.warnings.join('\n')).toMatch(/two rooms are called "ok"/);
    expect(messy.warnings.join('\n')).toMatch(/"wall" is not a prop/);
    expect(messy.warnings.join('\n')).toMatch(/not on a floor square inside "ok"/);
    expect(messy.warnings.join('\n')).toMatch(/unknown room "nowhere"/);
    expect(messy.warnings.join('\n')).toMatch(/snapped onto the wall: offset 0→1, width 9→2/);
    expect(messy.warnings.join('\n')).toMatch(/stairs down at 0,0 are not on a floor square/);
    // The salvageable parts still compiled.
    expect(messy.layers.structure['1,0']).toBe('building/door');
    expect(messy.layers.structure['2,0']).toBe('building/door');
  });

  it('every square it paints is a slot the set answers', () => {
    for (const layer of ['ground', 'structure', 'object'] as const) {
      for (const slot of Object.values(out.layers[layer])) expect(slot).toMatch(/^[a-z]+\//);
    }
  });

  it('paints every square of the grid on the first pass — the outside too', () => {
    expect(Object.keys(out.layers.ground)).toHaveLength(GRID.cols * GRID.rows);
    // Outside the two rooms: the set's best guess at an exterior ground.
    const outside = outsideGroundFor(dock)!;
    // Docklands has no road, yard or walk ("catwalk" is not a walk), so the
    // outside is its first ground: poured concrete.
    expect(outside.id).toBe('floor');
    expect(out.layers.ground['15,12']).toBe('ground/1');
    // A set with a street knows it.
    expect(outsideGroundFor(tilesetById('sprawl')!)?.id).toBe('road');
    expect(outsideGroundFor(tilesetById('park')!)?.id).toBe('path');
    expect(outsideGroundFor(tilesetById('lake')!)?.id).toBe('shore');
    expect(out.counts.outside).toBe(GRID.cols * GRID.rows - 6 * 5 - 5 * 5 + 5);
    expect(out.counts.floor).toBe(GRID.cols * GRID.rows);
  });

  it('tells the model which ground is water and how the land beside it meets it', () => {
    // The renderer draws painted water as one body and drops the land to the
    // waterline by its shore; a model that cannot see that paints a beach
    // where a pier wall belongs.
    const marina = floorPalette(tilesetById('marina')!);
    expect(marina).toContain('harbour — Harbour water (deep water');
    expect(marina).toContain('shallows — Shallows (shallow water)');
    expect(marina).toContain('pierwall — Pier wall (meets water as a pier wall)');
    expect(marina).toContain('beach — Beach front (runs into water as a beach)');
    expect(marina).toContain('quay — Concrete quay (meets water as a quay wall)');
    expect(floorPalette(tilesetById('lake')!)).toContain('reeds — Reed bed (shallow water)');
    // A dry set says nothing about water.
    expect(floorPalette(tilesetById('corp')!)).not.toMatch(/water/u);
  });

  it('honours a named outside ground and scatters decoration on it, clear of doors', () => {
    const plan: FloorPlanInput = {
      ...PLAN,
      outside: { ground: 'grate', scatter: ['barrel', 'pallet', 'nothing-such'] },
    };
    const built = compileFloorPlan(plan, GRID, dock);
    expect(built.layers.ground['15,12']).toBe('ground/3'); // grate
    expect(built.warnings.join('\n')).toMatch(/"nothing-such" is not a tile/);
    // Scatter lands only outside, only on empty squares, never beside a door.
    const scattered = Object.keys(built.layers.object).filter((k) => !PLAN.rooms.some((r) => inside(r, k)));
    expect(scattered.length).toBe(built.counts.scatter);
    expect(built.counts.scatter).toBeGreaterThan(0);
    const doors = Object.entries(built.layers.structure).filter(([, s]) => s === 'building/door').map(([k]) => k);
    for (const k of scattered) {
      const [c, r] = k.split(',').map(Number) as [number, number];
      expect(built.layers.structure[k]).toBeUndefined();
      for (const d of doors) {
        const [dc, dr] = d.split(',').map(Number) as [number, number];
        expect(Math.max(Math.abs(dc - c), Math.abs(dr - r)), `${k} is beside door ${d}`).toBeGreaterThan(1);
      }
      expect(['decoration/1', 'decoration/4']).toContain(built.layers.object[k]); // barrel, pallet
    }
    // Deterministic: the same plan scatters the same squares.
    expect(compileFloorPlan(plan, GRID, dock).layers.object).toEqual(built.layers.object);
  });

  it('dresses a room the plan left bare, walls first, and leaves a furnished one alone', () => {
    const bare: FloorPlanInput = {
      title: 'Bare',
      rooms: [{ name: 'hall', x: 0, y: 0, w: 10, h: 8 }], // 8x6 = 48 floor squares → 4 props
      openings: [{ room: 'hall', wall: 's', offset: 4, kind: 'door' }],
    };
    const built = compileFloorPlan(bare, GRID, dock);
    expect(built.counts.dressed).toBe(4);
    expect(built.counts.prop).toBe(0);
    const placed = Object.keys(built.layers.object).filter((k) => inside(bare.rooms[0]!, k));
    expect(placed).toHaveLength(4);
    for (const k of placed) {
      const [c, r] = k.split(',').map(Number) as [number, number];
      // Inside the ring, and not on the door's doorstep.
      expect(c).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(0);
      expect(Math.max(Math.abs(c - 4), Math.abs(r - 7))).toBeGreaterThan(1);
      expect(built.layers.object[k]).toMatch(/^interior\//);
    }
    // The clinic's rooms already carry a prop each for their size: untouched.
    expect(out.counts.dressed).toBe(0);
  });
});

describe('areas: the ground outside the rooms is not one ground', () => {
  // "A dock with a pier out into the harbour" is three grounds at least, and
  // the renderer only draws a quay wall, a pier's pilings or a beach running
  // under when water and land are painted side by side.
  const marina = tilesetById('marina')!;
  const WATERFRONT = { cols: 30, rows: 20 };
  const slot = (id: string) => toSlot(marina, id)!;
  const office = { name: 'harbour office', x: 2, y: 2, w: 6, h: 5 };
  const HARBOUR: FloorPlanInput = {
    title: 'Pier 23',
    rooms: [office],
    outside: {
      ground: 'quay',
      areas: [
        { ground: 'harbour', x: 0, y: 12, w: 30, h: 8 },
        { ground: 'pierwall', x: 0, y: 11, w: 30, h: 1 },
        { ground: 'planking', x: 13, y: 11, w: 3, h: 6 },
      ],
    },
  };
  const built = compileFloorPlan(HARBOUR, WATERFRONT, marina);

  it('paints the areas in order, so a later one lies on top of an earlier one', () => {
    expect(built.warnings).toEqual([]);
    expect(built.counts.areas).toBe(3);
    expect(built.layers.ground['20,5']).toBe(slot('quay')); // the outside ground
    expect(built.layers.ground['5,15']).toBe(slot('harbour'));
    expect(built.layers.ground['5,11']).toBe(slot('pierwall')); // one square wide is a legal area
    // The pier comes after the water AND after the pier wall: it wins both.
    expect(built.layers.ground['14,14']).toBe(slot('planking'));
    expect(built.layers.ground['14,11']).toBe(slot('planking'));
    expect(built.layers.ground['14,17']).toBe(slot('harbour')); // past the pier's end
    expect(Object.keys(built.layers.ground)).toHaveLength(WATERFRONT.cols * WATERFRONT.rows);
    expect(built.counts.outside).toBe(WATERFRONT.cols * WATERFRONT.rows - office.w * office.h);
  });

  it('builds rooms over the areas: a room keeps its own squares', () => {
    const plan: FloorPlanInput = {
      ...HARBOUR,
      rooms: [{ ...office, floor: 'planking' }],
      outside: { ground: 'quay', areas: [{ ground: 'harbour', x: 0, y: 0, w: 12, h: 12 }] },
    };
    const b = compileFloorPlan(plan, WATERFRONT, marina);
    expect(b.layers.ground['4,4']).toBe(slot('planking')); // inside the room
    expect(b.layers.ground['2,2']).toBe(slot('planking')); // the room's own wall square
    expect(b.layers.structure['2,2']).toBe('building/wall');
    expect(b.layers.ground['10,10']).toBe(slot('harbour')); // the area around it
  });

  it('warns about an area whose ground is not a ground tile, and shows the outside there', () => {
    const plan: FloorPlanInput = {
      ...HARBOUR,
      outside: {
        ground: 'quay',
        areas: [
          { ground: 'boat', x: 20, y: 0, w: 5, h: 5 },
          { ground: 'nonesuch', x: 20, y: 6, w: 5, h: 5 },
        ],
      },
    };
    const b = compileFloorPlan(plan, WATERFRONT, marina);
    expect(b.warnings.join('\n')).toMatch(/area 1 \(boat\): "boat" is not a ground tile/);
    expect(b.warnings.join('\n')).toMatch(/area 2 \(nonesuch\): "nonesuch" is not a ground tile/);
    expect(b.counts.areas).toBe(0);
    expect(b.layers.ground['22,2']).toBe(slot('quay'));
    expect(b.layers.ground['22,8']).toBe(slot('quay'));
  });

  it('clamps an area that hangs off the grid, and drops one that is wholly off it', () => {
    const plan: FloorPlanInput = {
      ...HARBOUR,
      outside: {
        ground: 'quay',
        areas: [
          { ground: 'harbour', x: 25, y: 15, w: 10, h: 10 },
          { ground: 'harbour', x: 30, y: 0, w: 4, h: 4 },
          { ground: 'harbour', x: 0, y: 20, w: 4, h: 4 },
        ],
      },
    };
    const b = compileFloorPlan(plan, WATERFRONT, marina);
    const said = b.warnings.join('\n');
    expect(said).toMatch(/area 1 \(harbour\) clamped to the grid: 10x10 at 25,15 → 5x5 at 25,15/);
    expect(said).toMatch(/area 2 \(harbour\) falls outside the 30x20 grid — dropped/);
    expect(said).toMatch(/area 3 \(harbour\) falls outside the 30x20 grid — dropped/);
    expect(b.counts.areas).toBe(1);
    expect(b.layers.ground['29,19']).toBe(slot('harbour')); // painted to the corner
    expect(b.layers.ground['24,19']).toBe(slot('quay'));
  });

  /** Every object the scatter put on water, with the water it is on. */
  const onWater = (b: ReturnType<typeof compileFloorPlan>) =>
    Object.entries(b.layers.object)
      .map(([k, s]) => ({ k, tile: marina.tiles.find((t) => toSlot(marina, t.id) === s)!, ground: marina.tiles.find((t) => toSlot(marina, t.id) === b.layers.ground[k])! }))
      .filter((x) => x.ground.liquid !== undefined);

  it('scatters nothing on the water that does not float there', () => {
    // The set's own decoration: none of it floats but the buoy, and the buoy
    // is a light, which the default pool never scatters.
    expect(built.counts.scatter).toBeGreaterThan(0);
    expect(onWater(built)).toEqual([]);
    // How much comes from the land something can stand on (the quay, the pier
    // wall, the pier), not from a grid that is mostly harbour.
    const standable = built.counts.outside - 30 * 8 + 3 * 5; // the harbour squares, minus the pier over them
    expect(built.counts.scatter).toBeLessThanOrEqual(Math.floor(standable / 16));
  });

  it('puts a floating thing on the water it is meant for, and land things on the land', () => {
    const plan: FloorPlanInput = { ...HARBOUR, outside: { ...HARBOUR.outside, scatter: ['boat', 'barrel', 'bollard'] } };
    const b = compileFloorPlan(plan, WATERFRONT, marina);
    expect(b.counts.scatter).toBeGreaterThan(0);
    for (const x of onWater(b)) {
      expect(x.tile.id, `${x.tile.id} on ${x.ground.id} at ${x.k}`).toBe('boat');
      expect(x.tile.placement?.on).toContain(x.ground.id);
    }
    for (const [k, s] of Object.entries(b.layers.object)) {
      const g = marina.tiles.find((t) => toSlot(marina, t.id) === b.layers.ground[k])!;
      if (s === slot('bollard')) expect(g.id, `bollard at ${k}`).toBe('quay');
      if (s === slot('barrel')) expect(g.liquid, `barrel at ${k}`).toBeUndefined();
    }
    expect(onWater(b).length).toBeGreaterThan(0);
    // Deterministic, areas and all.
    expect(compileFloorPlan(plan, WATERFRONT, marina).layers.object).toEqual(b.layers.object);
  });

  it('says so when a named decoration fits none of the ground outside', () => {
    const dry: FloorPlanInput = { ...HARBOUR, outside: { ground: 'quay', scatter: ['buoy', 'barrel'] } };
    const b = compileFloorPlan(dry, WATERFRONT, marina);
    expect(b.warnings.join('\n')).toMatch(/Channel buoy fits none of the ground outside \(it stands on harbour\)/);
    expect(Object.values(b.layers.object)).not.toContain(slot('buoy'));
  });

  it('says nothing about fit when the rooms fill the grid and there is no outside', () => {
    const indoors: FloorPlanInput = {
      title: 'Boathouse',
      rooms: [{ name: 'boathouse', x: 0, y: 0, w: 30, h: 20 }],
      openings: [{ room: 'boathouse', wall: 's', offset: 5, kind: 'door' }],
      outside: { ground: 'quay', scatter: ['barrel', 'cleat', 'cleat', 'buoy'] },
    };
    const b = compileFloorPlan(indoors, WATERFRONT, marina);
    expect(b.counts.outside).toBe(0);
    expect(b.warnings).toEqual([]);
  });

  it('names a mismatch once, however often the model repeated the id', () => {
    const dry: FloorPlanInput = { ...HARBOUR, outside: { ground: 'quay', scatter: ['buoy', 'buoy'] } };
    const said = compileFloorPlan(dry, WATERFRONT, marina).warnings.filter((w) => w.includes('Channel buoy'));
    expect(said).toHaveLength(1);
  });

  // The rule 7 example is the HARBOUR plan above, id for id, so a renamed
  // marina tile fails the areas tests; this pins the heading the model reads.
  it('tells the model an area takes a ground tile from the palette', () => {
    expect(floorPalette(marina)).toContain('Ground tiles (a room\'s "floor", "outside.ground", and an area\'s "ground"):');
  });
});

/** Is a "col,row" key inside a room's rectangle (walls included)? */
function inside(room: { x: number; y: number; w: number; h: number }, k: string): boolean {
  const [c, r] = k.split(',').map(Number) as [number, number];
  return c >= room.x && c < room.x + room.w && r >= room.y && r < room.y + room.h;
}

describe('POST /api/fixer/build-floor', () => {
  let t: TestApp;
  let boot: BootstrapResult;
  let sceneId = '';
  const mocks: MockLlmServer[] = [];

  beforeAll(async () => {
    t = await makeTestApp('fixer-floor');
    boot = await bootstrapCampaign(t.app, 'Clinic Job');
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/scenes`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { name: 'Clinic' },
    });
    sceneId = (created.json() as { scene: { id: string } }).scene.id;
  }, 180_000);

  afterEach(async () => {
    disableAi();
    for (const m of mocks.splice(0)) await m.close();
  });

  afterAll(async () => {
    await t.close();
  });

  function ask(payload: Record<string, unknown>) {
    return t.app.inject({
      method: 'POST',
      url: '/api/fixer/build-floor',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { sceneId, tilesetId: 'docklands', prompt: 'a two-room clinic with a waiting room', ...payload },
    });
  }

  it('says the Fixer is off when there is no model, and paints nothing', async () => {
    const res = await ask({});
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ai_disabled');
  });

  it('turns the model’s plan into slots the paint route takes, and nothing is painted yet', async () => {
    // Two passes: the building, then its furniture (both rooms fit one batch).
    const furniture = {
      rooms: [
        { name: 'waiting room', props: [{ tile: 'crates', x: 2, y: 2 }] },
        { name: 'exam room', props: [{ tile: 'barrel', x: 7, y: 2 }] },
      ],
    };
    const mock = await MockLlmServer.start({
      turns: [
        { content: JSON.stringify(PLAN), usage: { promptTokens: 300, completionTokens: 120 } },
        { content: JSON.stringify(furniture), usage: { promptTokens: 200, completionTokens: 40 } },
      ],
    });
    mocks.push(mock);
    enableAi(mock.baseUrl);
    const res = await ask({});
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as {
      plan: { title: string; layers: { ground: Record<string, string>; structure: Record<string, string> }; counts: { door: number } };
      level: number;
      model: string;
      usage: { totalTokens: number };
    };
    expect(out.plan.title).toBe('Two-room clinic');
    expect(out.plan.layers.structure['5,2']).toBe('building/door');
    expect(out.plan.counts.door).toBe(2);
    expect(out.level).toBe(0);
    // Both passes are counted.
    expect(out.usage.totalTokens).toBe(660);
    expect(mock.requests).toHaveLength(2);
    // The palette went to the model, in the set's own ids.
    const sent = mock.requests[0]!.messages.map((m) => String(m.content)).join('\n');
    // The first pass lays the building out bare; the second furnishes it.
    expect(sent).toContain('Do NOT place props');
    const furnish = mock.requests[1]!.messages.map((m) => String(m.content)).join('\n');
    expect(furnish).toContain('"waiting room" (lobby)');
    expect(furnish).toContain('"exam room" (room)');
    expect(sent).toContain('crates —');
    expect(sent).toContain('"outside.areas" are rectangles of OTHER ground');
    expect(sent).toContain('a two-room clinic');
    // Still an empty scene: the GM has not built it.
    const scene = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: { authorization: `Bearer ${boot.gmToken}` } });
    expect((scene.json() as { scene: { tiles?: unknown } }).scene.tiles).toBeUndefined();
  });

  it('refuses a floor the scene does not have, and a set that does not exist', async () => {
    const mock = await MockLlmServer.start({ turns: [{ content: JSON.stringify(PLAN) }] });
    mocks.push(mock);
    enableAi(mock.baseUrl);
    expect((await ask({ level: 3 })).statusCode).toBe(400);
    expect((await ask({ tilesetId: 'atlantis' })).statusCode).toBe(400);
  });

  it('answers 502 when the model does not return a plan', async () => {
    const mock = await MockLlmServer.start({ turns: [{ content: 'Sure! Here is a lovely clinic.' }] });
    mocks.push(mock);
    enableAi(mock.baseUrl);
    const res = await ask({});
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ai_error');
  });
});
