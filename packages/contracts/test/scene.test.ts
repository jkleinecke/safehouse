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
    // Sight starts as the whole map for players; the GM switches it per scene.
    expect(s.vision).toEqual({ playersSeeOwnSight: false });
  });

  it('mounts a camera with sensible defaults, and leaves geometry without one untouched', () => {
    // A camera is a point and a facing; everything else has a working default
    // so the GM's click is a camera, not a form.
    const s = SceneSchema.parse({
      ...scene,
      geometry: { cameras: [{ id: 'cam_1', at: { x: 3, y: 4 } }] },
    });
    expect(s.geometry.cameras).toEqual([
      { id: 'cam_1', at: { x: 3, y: 4 }, facing: 90, fov: 90, range: 12, level: 0, active: true },
    ]);
    expect(SceneSchema.parse(scene).geometry.cameras).toBeUndefined();
    // A field of view narrower than a keyhole, or a facing off the compass, is a typo.
    expect(
      SceneSchema.safeParse({ ...scene, geometry: { cameras: [{ id: 'c', at: { x: 0, y: 0 }, fov: 1 }] } })
        .success,
    ).toBe(false);
    expect(
      SceneSchema.safeParse({ ...scene, geometry: { cameras: [{ id: 'c', at: { x: 0, y: 0 }, facing: 400 }] } })
        .success,
    ).toBe(false);
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

describe('doors, notes and token layers (FR9.24–9.26)', () => {
  it('a door starts shut and unlocked; a painted door keeps its state beside its tiles', () => {
    const s = SceneSchema.parse({
      ...scene,
      geometry: { doors: [{ id: 'd1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] },
      tiles: { tilesetId: 'docklands', structure: { '3,4': 'door' }, doors: { '3,4': { open: true } } },
    });
    expect(s.geometry.doors[0]).toMatchObject({ open: false, locked: false });
    expect(s.tiles?.doors).toEqual({ '3,4': { open: true, locked: false } });
    expect(SceneSchema.parse(scene).tiles?.doors).toBeUndefined();
  });

  it('a GM note is a box of text at a point, four cells wide unless told otherwise', () => {
    const s = SceneSchema.parse({
      ...scene,
      geometry: { gmNotes: [{ id: 'n1', at: { x: 2, y: 2 }, text: 'The guard is asleep until someone shoots.' }] },
    });
    expect(s.geometry.gmNotes).toEqual([
      { id: 'n1', at: { x: 2, y: 2 }, text: 'The guard is asleep until someone shoots.', width: 4 },
    ]);
    expect(SceneSchema.safeParse({ ...scene, geometry: { gmNotes: [{ id: 'n', at: { x: 0, y: 0 }, text: 'x'.repeat(2001) }] } }).success).toBe(false);
  });

  it('a token layer names its members and starts shown', () => {
    const s = SceneSchema.parse({ ...scene, tokenLayers: [{ id: 'l1', name: 'Ambush', tokenIds: ['t1', 't2'] }] });
    expect(s.tokenLayers).toEqual([{ id: 'l1', name: 'Ambush', hidden: false, tokenIds: ['t1', 't2'] }]);
    expect(SceneSchema.parse(scene).tokenLayers).toBeUndefined();
  });
});
