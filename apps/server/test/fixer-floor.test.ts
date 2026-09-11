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
import { tilesetById } from '@safehouse/rules';
import { compileFloorPlan, type FloorPlanInput } from '../src/fixer/floor-plan.js';
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
});

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
    const mock = await MockLlmServer.start({ turns: [{ content: JSON.stringify(PLAN), usage: { promptTokens: 300, completionTokens: 120 } }] });
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
    expect(out.usage.totalTokens).toBe(420);
    // The palette went to the model, in the set's own ids.
    const sent = mock.requests[0]!.messages.map((m) => String(m.content)).join('\n');
    expect(sent).toContain('crates —');
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
