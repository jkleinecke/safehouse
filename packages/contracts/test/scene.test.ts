import { describe, expect, it } from 'vitest';
import { SceneSchema, TokenSchema, FogStateSchema, GridSchema } from '../src/index.js';

const scene = {
  id: 'scn_1',
  campaignId: 'cmp_1',
  name: 'Dockside Warehouse',
  state: 'active',
  grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0.5, y: 0 }, projection: 'topdown' as const },
  environment: { light: 2, visibility: 1, glare: 0, wind: 0, note: 'dim, drizzle' },
  geometry: {
    walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 12, y: 0 } }],
    doors: [{ id: 'd1', a: { x: 12, y: 0 }, b: { x: 13, y: 0 }, open: false }],
    zones: [
      {
        id: 'z1',
        name: 'loading bay',
        polygon: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
      },
    ],
    pins: [{ id: 'p1', at: { x: 5, y: 5 }, label: 'crates', visibility: 'gm' }],
  },
  fog: {
    regions: [
      {
        id: 'east-wing',
        name: 'east wing',
        polygon: [
          { x: 20, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 30 },
          { x: 20, y: 30 },
        ],
      },
    ],
    revealed: ['east-wing'],
    revealedShapes: [
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 2, y: 4 },
      ],
    ],
  },
  mapAttachmentIds: ['att_map_1'],
};

describe('SceneSchema', () => {
  it('round-trips a full scene', () => {
    const once = SceneSchema.parse(scene);
    const twice = SceneSchema.parse(once);
    expect(twice).toEqual(once);
    expect(once.fog.revealed).toContain('east-wing');
  });

  it('defaults grid/environment/geometry/fog pieces', () => {
    const s = SceneSchema.parse({
      id: 's2',
      campaignId: 'c1',
      name: 'Blank',
      grid: { cols: 10, rows: 10 },
    });
    expect(s.state).toBe('draft');
    expect(s.grid.unitM).toBe(1);
    expect(s.grid.offset).toEqual({ x: 0, y: 0 });
    expect(s.environment).toMatchObject({ light: 0, visibility: 0, glare: 0, wind: 0 });
    expect(s.geometry).toEqual({ walls: [], doors: [], zones: [], pins: [] });
    expect(s.fog).toEqual({ regions: [], revealed: [], revealedShapes: [] });
  });

  it('rejects env levels outside 0..3 and zones with <3 points', () => {
    expect(
      SceneSchema.safeParse({ ...scene, environment: { light: 4, visibility: 0, glare: 0, wind: 0 } })
        .success,
    ).toBe(false);
    expect(
      SceneSchema.safeParse({
        ...scene,
        geometry: { walls: [], doors: [], zones: [{ id: 'z', name: 'bad', polygon: [{ x: 0, y: 0 }] }], pins: [] },
      }).success,
    ).toBe(false);
  });

  it('GridSchema requires positive dimensions', () => {
    expect(GridSchema.safeParse({ cols: 0, rows: 10 }).success).toBe(false);
  });

  it('FogStateSchema round-trips independently', () => {
    const fog = FogStateSchema.parse(scene.fog);
    expect(FogStateSchema.parse(fog)).toEqual(fog);
  });
});

describe('TokenSchema', () => {
  it('round-trips a token and applies defaults', () => {
    const tok = TokenSchema.parse({
      id: 'tok_1',
      sceneId: 'scn_1',
      source: 'character',
      sourceId: 'chr_1',
      name: 'Static',
      x: 4,
      y: 7,
    });
    expect(tok.size).toBe(1);
    expect(tok.hidden).toBe(false);
    expect(tok.barsVisibility).toBe('owner');
    expect(TokenSchema.parse(tok)).toEqual(tok);
  });

  it('supports hidden GM tokens with auras', () => {
    const tok = TokenSchema.parse({
      id: 'tok_2',
      sceneId: 'scn_1',
      source: 'npc_template',
      name: 'Rooftop Watcher',
      x: 30,
      y: 2,
      size: 1,
      hidden: true,
      aura: { radiusM: 6, label: 'Force 6' },
    });
    expect(tok.hidden).toBe(true);
    expect(tok.aura?.radiusM).toBe(6);
  });

  it('rejects unknown sources', () => {
    expect(
      TokenSchema.safeParse({ id: 't', sceneId: 's', source: 'vehicle', name: 'x', x: 0, y: 0 })
        .success,
    ).toBe(false);
  });
});
