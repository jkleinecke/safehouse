/**
 * The room tool lays down exactly what a GM means by "a room" (FR9.2).
 *
 * Two things are pinned. The PLAN — which cells are floor and which are
 * walls — because an off-by-one here is a room with a gap in one corner that
 * the sightline model will happily see through. And the TILE CHOICE, because
 * a room built from a window (a wall tile too, on paper) would let every
 * sightline through, and one built from the GM's currently selected chair
 * would not be a room.
 */
import { describe, expect, it } from 'vitest';
import { CLUB, DOCKLANDS } from '@safehouse/rules';
import { roomPlan, roomTileIds } from './roomFill.js';

describe('roomPlan', () => {
  it('floors every cell and walls only the edge', () => {
    const plan = roomPlan(2, 3, 5, 6, 'room');
    expect(plan.floor).toHaveLength(16);
    // 4×4: the ring is 12 cells, the inside 4.
    expect(plan.walls).toHaveLength(12);
    expect(plan.walls).not.toContain('3,4');
    expect(plan.walls).toEqual(expect.arrayContaining(['2,3', '5,6', '2,6', '5,3', '3,3', '2,4']));
  });

  it('is floor only for an area', () => {
    const plan = roomPlan(0, 0, 3, 1, 'area');
    expect(plan.floor).toHaveLength(8);
    expect(plan.walls).toHaveLength(0);
  });

  it('treats a one- or two-cell-wide room as all edge', () => {
    // A cupboard is walls all the way through; the floor still goes under it.
    const thin = roomPlan(4, 4, 5, 9, 'room');
    expect(thin.floor).toHaveLength(12);
    expect(thin.walls).toHaveLength(12);
    const single = roomPlan(7, 7, 7, 7, 'room');
    expect(single.floor).toEqual(['7,7']);
    expect(single.walls).toEqual(['7,7']);
  });
});

describe('roomTileIds', () => {
  it('uses the chosen ground and the set’s plain wall', () => {
    const ids = roomTileIds(DOCKLANDS.tiles, 'stain');
    expect(ids.floorId).toBe('stain');
    expect(ids.wallId).toBe('wall');
  });

  it('falls back to the set’s first ground when nothing suitable is chosen', () => {
    // Auto, and a selected tile that is not ground, both mean "the default
    // surface" — a room of oil drums is not a thing the GM asked for.
    expect(roomTileIds(DOCKLANDS.tiles, null).floorId).toBe('floor');
    expect(roomTileIds(DOCKLANDS.tiles, 'barrel').floorId).toBe('floor');
  });

  it('never builds a room out of a window or a door', () => {
    for (const set of [DOCKLANDS, CLUB]) {
      const { wallId } = roomTileIds(set.tiles, null);
      const wall = set.tiles.find((t) => t.id === wallId);
      expect(wall?.kind).toBe('wall');
      expect(wall?.placement?.inWall).not.toBe(true);
      expect(wall?.blocksSight).not.toBe(false);
    }
  });

  it('is honest about a set with no wall', () => {
    const { wallId, floorId } = roomTileIds([{ id: 'grass', kind: 'floor' }], null);
    expect(floorId).toBe('grass');
    expect(wallId).toBeNull();
  });
});
