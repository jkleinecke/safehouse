/**
 * The fog's sightline parts (P6) on their way into the server's store and
 * out to the table: the GM's explored-fashion reveals, the party's sight and
 * memory, and the scene's sightlines switch.
 *
 * Pinned at the pure functions that do it (`normalizeFog`, `sceneForViewer`,
 * `tokenConcealed`), like the cameras, because the failures are invisible
 * from the GM's own screen: a region the table was never shown arriving on a
 * phone, a stored memory silently dropped at the first read, or a scene the
 * table is told is fogged still sending it the guards.
 */
import { describe, expect, it } from 'vitest';
import { SceneSchema, type FogRegion, type Point, type Scene } from '@safehouse/contracts';
import { normalizeFog, sceneForViewer, tokenConcealed } from '../src/services/scenes.js';
import { FOG_WIRE_UNREVEALED } from '../../../packages/contracts/test/fog-fixtures.js';

const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const lab: FogRegion = { id: 'reg_lab', name: 'The lab', polygon: box(0, 0, 4, 4) };
const office: FogRegion = { id: 'reg_office', name: 'Corner office', polygon: box(6, 0, 10, 4) };
const vault: FogRegion = { id: 'reg_vault', name: 'Secret vault', polygon: box(0, 6, 4, 10) };

/** The party's pooled sight for a 20 x 12 grid, as the server's sight pass stores it. */
const sight = { cols: 20, rows: 12, levels: { '0': { live: 'AQI=', explored: 'AwI=' } } };

function sceneWith(fog: unknown, vision: unknown = {}): Scene {
  return SceneSchema.parse({
    id: 'scn_1',
    campaignId: 'cmp_1',
    name: 'R&D floor',
    state: 'active',
    grid: { cols: 20, rows: 12 },
    vision,
    fog,
  });
}

const guard = { id: 'tok_guard', hidden: false, source: 'npc_template', x: 2.5, y: 8.5 }; // in the vault
const runner = { id: 'tok_runner', hidden: false, source: 'character', x: 2.5, y: 8.5 };

describe('the fog sightlines added, on the wire and in the store (P6)', () => {
  it('sends a scene without any of it to the table exactly as before', () => {
    const scene = sceneWith({ regions: [vault], revealed: [], revealedShapes: [], enabled: true });
    const seen = sceneForViewer(scene, false);
    expect(seen.fog).toEqual(FOG_WIRE_UNREVEALED);
    // Not even empty lists: nothing on the wire says the new parts exist.
    expect(Object.keys(seen.fog).sort()).toEqual(['active', 'regions', 'revealed', 'revealedShapes']);
  });

  it('sends explored regions with their fashion said, the sight whole, and never a region the table was not shown', () => {
    const scene = sceneWith({
      regions: [lab, office, vault],
      revealed: [lab.id],
      revealedShapes: [],
      exploredRegionIds: [office.id, 'reg_since_removed'],
      exploredShapes: [box(12, 0, 14, 2)],
      sight,
      enabled: true,
    });
    const seen = sceneForViewer(scene, false);
    expect(seen.fog.regions.map((r) => r.id)).toEqual([lab.id, office.id]);
    expect(seen.fog.revealed).toEqual([lab.id]);
    expect(seen.fog.exploredRegionIds).toEqual([office.id]); // the office is remembered, not open
    expect(seen.fog.exploredShapes).toEqual([box(12, 0, 14, 2)]);
    expect(seen.fog.sight).toEqual(sight);
    expect(seen.fog.active).toBe(true);
    const wire = JSON.stringify(seen);
    expect(wire).not.toContain(vault.id);
    expect(wire).not.toContain(vault.name);
    // The GM's copy is the whole store.
    const gm = sceneForViewer(scene, true);
    expect(gm.fog.regions.map((r) => r.id)).toEqual([lab.id, office.id, vault.id]);
    expect(gm.fog.exploredRegionIds).toEqual([office.id, 'reg_since_removed']);
  });

  it('keeps every part through a read, and drops only a damaged one', () => {
    const stored = {
      regions: [lab, office],
      revealed: [lab.id],
      revealedShapes: [],
      exploredRegionIds: [office.id],
      exploredShapes: [box(12, 0, 14, 2)],
      sight,
      enabled: true,
      active: true, // never stored: a read drops it
    };
    const read = normalizeFog(stored);
    expect(read).toEqual({ ...stored, active: undefined });
    expect('active' in read).toBe(false);
    // A sight record that does not parse costs the party's memory, and only that.
    const damaged = normalizeFog({ ...stored, sight: { cols: 20, rows: 12, levels: { roof: { live: '!!' } } } });
    expect(damaged.sight).toBeUndefined();
    expect(damaged.regions.map((r) => r.id)).toEqual([lab.id, office.id]);
    expect(damaged.revealed).toEqual([lab.id]);
    expect(damaged.exploredRegionIds).toEqual([office.id]);
    expect(damaged.enabled).toBe(true);
    const badIds = normalizeFog({ ...stored, exploredRegionIds: 'reg_office' });
    expect(badIds.exploredRegionIds).toBeUndefined();
    expect(badIds.sight).toEqual(sight);
  });

  it('fogs a scene with sightlines on even with its fog switch off, for the wire and for the tokens alike', () => {
    const fog = { regions: [vault], revealed: [], revealedShapes: [], enabled: false };
    const off = sceneWith(fog);
    expect(sceneForViewer(off, false).fog.active).toBe(false);
    expect(tokenConcealed(guard, off)).toBe(false);

    const on = sceneWith(fog, { sight: 'on' });
    expect(sceneForViewer(on, false).fog.active).toBe(true);
    expect(tokenConcealed(guard, on)).toBe(true);
    // A runner is on the table's screens wherever they stand.
    expect(tokenConcealed(runner, on)).toBe(false);
    // The old "dim outside own sight" switch is not sightlines and fogs nothing.
    const dim = sceneWith(fog, { playersSeeOwnSight: true });
    expect(sceneForViewer(dim, false).fog.active).toBe(false);
    expect(tokenConcealed(guard, dim)).toBe(false);
  });

  it('withholds a guard on ground revealed only as explored, and shows him on ground revealed live', () => {
    // Explored is the map remembered, with nobody on it: the table is sent
    // the vault's outline, and never the guard standing in it.
    const remembered = sceneWith({ regions: [vault], revealed: [], revealedShapes: [], exploredRegionIds: [vault.id], enabled: true });
    expect(sceneForViewer(remembered, false).fog.regions.map((r) => r.id)).toEqual([vault.id]);
    expect(tokenConcealed(guard, remembered)).toBe(true);
    expect(tokenConcealed(runner, remembered)).toBe(false);
    // A shape painted as explored over him is the same.
    const painted = sceneWith({ regions: [], revealed: [], revealedShapes: [], exploredShapes: [box(0, 6, 4, 10)], enabled: true });
    expect(tokenConcealed(guard, painted)).toBe(true);

    // Live, by region or by shape: he is on the table.
    const live = sceneWith({ regions: [vault], revealed: [vault.id], revealedShapes: [], enabled: true });
    expect(tokenConcealed(guard, live)).toBe(false);
    const liveShape = sceneWith({ regions: [], revealed: [], revealedShapes: [box(0, 6, 4, 10)], exploredShapes: [box(0, 6, 4, 10)], enabled: true });
    expect(tokenConcealed(guard, liveShape)).toBe(false); // live beats explored

    // A two-square van is on the table when any square of it is live: its
    // left half in the vault, its right half in the dark.
    const van = { id: 'tok_van', hidden: false, source: 'prop', x: 4, y: 8, size: 2 };
    expect(tokenConcealed(van, live)).toBe(false);
    expect(tokenConcealed(van, remembered)).toBe(true);
    // And on its own floor: fog has no floors for the GM's reveals, so a
    // guard upstairs over the vault is as open as one on the ground.
    expect(tokenConcealed({ ...guard, level: 1 }, live)).toBe(false);
  });
});
