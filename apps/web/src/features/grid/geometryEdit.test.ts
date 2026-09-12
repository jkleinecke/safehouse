import { describe, expect, it } from 'vitest';
import { SceneGeometrySchema, type SceneGeometry } from '@safehouse/contracts';
import {
  addDoor,
  addPin,
  addWall,
  addZone,
  convertWallToDoor,
  emptyGeometry,
  geometryCounts,
  addCamera,
  camerasOf,
  normalizeFacing,
  removeCamera,
  updateCamera,
  isDegenerateSegment,
  isPinLinked,
  isValidGeometry,
  nextGeometryId,
  normalizeGeometry,
  removeDoor,
  removePin,
  removeWall,
  removeZone,
  setDoorLocked,
  setDoorOpen,
  addNote,
  notesOf,
  removeNote,
  updateNote,
  tileDoorOpen,
  snapVertex,
  toggleDoor,
  updateDoor,
  updatePin,
  updateWall,
  updateZone,
  removeSelection,
} from './geometryEdit.js';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
];

/** Every editor result must still satisfy the wire contract. */
function expectValid(geo: SceneGeometry): void {
  expect(isValidGeometry(geo)).toBe(true);
  expect(() => SceneGeometrySchema.parse(geo)).not.toThrow();
}

describe('ids and guards', () => {
  it('numbers new ids one past the highest existing suffix', () => {
    expect(nextGeometryId('wall', [])).toBe('wall_1');
    expect(nextGeometryId('wall', [{ id: 'wall_1' }, { id: 'wall_7' }])).toBe('wall_8');
    // Ids from a seed or a hand-written PATCH do not confuse the counter.
    expect(nextGeometryId('wall', [{ id: 'seeded-north' }])).toBe('wall_1');
  });

  it('treats a click without a drag as no segment', () => {
    expect(isDegenerateSegment({ x: 1, y: 1 }, { x: 1, y: 1.1 })).toBe(true);
    expect(isDegenerateSegment({ x: 1, y: 1 }, { x: 1, y: 3 })).toBe(false);
  });

  it('snaps authoring vertices to grid intersections, or not at all', () => {
    expect(snapVertex({ x: 3.4, y: 7.8 })).toEqual({ x: 3, y: 8 });
    expect(snapVertex({ x: 3.4, y: 7.8 }, false)).toEqual({ x: 3.4, y: 7.8 });
  });

  it('normalises anything scene-shaped into a full geometry', () => {
    expect(normalizeGeometry(undefined)).toEqual(emptyGeometry());
    expect(normalizeGeometry({ walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } ] })).toEqual({
      walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
      doors: [],
      zones: [],
      pins: [],
    });
    // Garbage in the column must not take the canvas down with it.
    expect(normalizeGeometry({ walls: 'nope' })).toEqual(emptyGeometry());
  });
});

describe('walls', () => {
  it('adds, edits and deletes, staying contract-valid throughout', () => {
    let geo = addWall(emptyGeometry(), { x: 0, y: 0 }, { x: 6, y: 0 });
    expectValid(geo);
    expect(geo.walls).toHaveLength(1);
    expect(geo.walls[0]).toMatchObject({ id: 'wall_1', a: { x: 0, y: 0 }, b: { x: 6, y: 0 } });

    geo = updateWall(geo, 'wall_1', { b: { x: 6, y: 3 } });
    expect(geo.walls[0]?.b).toEqual({ x: 6, y: 3 });
    expectValid(geo);

    geo = removeWall(geo, 'wall_1');
    expect(geo.walls).toHaveLength(0);
    expectValid(geo);
  });

  it('refuses a degenerate drag and leaves the geometry untouched', () => {
    const geo = emptyGeometry();
    expect(addWall(geo, { x: 2, y: 2 }, { x: 2, y: 2 })).toBe(geo);
  });

  it('never lets a patch rewrite an id', () => {
    const geo = addWall(emptyGeometry(), { x: 0, y: 0 }, { x: 3, y: 0 });
    const rogue = { id: 'hijacked' } as unknown as Parameters<typeof updateWall>[2];
    const patched = updateWall(geo, 'wall_1', rogue);
    expect(patched.walls[0]?.id).toBe('wall_1');
  });

  it('does not mutate the geometry it was handed', () => {
    const before = addWall(emptyGeometry(), { x: 0, y: 0 }, { x: 3, y: 0 });
    const snapshot = JSON.stringify(before);
    addWall(before, { x: 0, y: 1 }, { x: 3, y: 1 });
    removeWall(before, 'wall_1');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('doors', () => {
  it('places closed by default and toggles open and shut', () => {
    let geo = addDoor(emptyGeometry(), { x: 2, y: 0 }, { x: 3, y: 0 });
    expectValid(geo);
    expect(geo.doors[0]).toMatchObject({ id: 'door_1', open: false });

    geo = toggleDoor(geo, 'door_1');
    expect(geo.doors[0]?.open).toBe(true);
    geo = toggleDoor(geo, 'door_1');
    expect(geo.doors[0]?.open).toBe(false);

    geo = setDoorOpen(geo, 'door_1', true);
    expect(geo.doors[0]?.open).toBe(true);
    expectValid(geo);
  });

  it('ignores a toggle for a door that is not there', () => {
    const geo = addDoor(emptyGeometry(), { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(toggleDoor(geo, 'door_9')).toBe(geo);
  });

  it('notes survive an edit and deletion removes only the target', () => {
    let geo = addDoor(emptyGeometry(), { x: 0, y: 0 }, { x: 1, y: 0 }, { note: 'maglock' });
    geo = addDoor(geo, { x: 4, y: 0 }, { x: 5, y: 0 });
    geo = updateDoor(geo, 'door_2', { note: 'fire exit' });
    expect(geo.doors.map((d) => d.note)).toEqual(['maglock', 'fire exit']);
    geo = removeDoor(geo, 'door_1');
    expect(geo.doors.map((d) => d.id)).toEqual(['door_2']);
    expectValid(geo);
  });

  it('promotes a wall into a door in place', () => {
    let geo = addWall(emptyGeometry(), { x: 1, y: 1 }, { x: 4, y: 1 }, { note: 'north face' });
    geo = convertWallToDoor(geo, 'wall_1');
    expect(geo.walls).toHaveLength(0);
    expect(geo.doors[0]).toMatchObject({
      a: { x: 1, y: 1 },
      b: { x: 4, y: 1 },
      open: false,
      note: 'north face',
    });
    expectValid(geo);
  });
});

describe('zones', () => {
  it('needs three vertices', () => {
    const geo = emptyGeometry();
    expect(addZone(geo, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(geo);
    expectValid(addZone(geo, square));
  });

  it('names itself when the GM does not', () => {
    const geo = addZone(emptyGeometry(), square, { name: '   ' });
    expect(geo.zones[0]?.name).toBe('Zone 1');
  });

  it('edits and deletes', () => {
    let geo = addZone(emptyGeometry(), square, { name: 'loading dock', color: '#ff2d95' });
    geo = updateZone(geo, 'zone_1', { name: 'the vault' });
    expect(geo.zones[0]).toMatchObject({ name: 'the vault', color: '#ff2d95' });
    expectValid(geo);
    geo = removeZone(geo, 'zone_1');
    expect(geo.zones).toHaveLength(0);
  });
});

describe('pins (FR9.3)', () => {
  it('drops private by default — the GM reveals deliberately', () => {
    const geo = addPin(emptyGeometry(), { x: 5, y: 6 });
    expectValid(geo);
    expect(geo.pins[0]).toEqual({ id: 'pin_1', at: { x: 5, y: 6 }, visibility: 'gm' });
    expect(isPinLinked(geo.pins[0]!)).toBe(false);
  });

  it('links a codex page and a handout, then unlinks them', () => {
    let geo = addPin(emptyGeometry(), { x: 1, y: 1 }, { label: '  the safe  ' });
    expect(geo.pins[0]?.label).toBe('the safe');

    geo = updatePin(geo, 'pin_1', { wikiPageId: 'wiki_7', attachmentId: 'att_3' });
    expect(isPinLinked(geo.pins[0]!)).toBe(true);
    expectValid(geo);

    geo = updatePin(geo, 'pin_1', { wikiPageId: null });
    expect(geo.pins[0]?.wikiPageId).toBeUndefined();
    expect(geo.pins[0]?.attachmentId).toBe('att_3');

    // An empty string from a cleared text field unlinks too.
    geo = updatePin(geo, 'pin_1', { attachmentId: '' });
    expect(isPinLinked(geo.pins[0]!)).toBe(false);
    expectValid(geo);
  });

  it('reveals a pin by flipping visibility, and moves it', () => {
    let geo = addPin(emptyGeometry(), { x: 1, y: 1 });
    geo = updatePin(geo, 'pin_1', { visibility: 'public', at: { x: 9.0001, y: 2 } });
    expect(geo.pins[0]?.visibility).toBe('public');
    expect(geo.pins[0]?.at).toEqual({ x: 9, y: 2 });
    expectValid(geo);
  });

  it('deletes one pin without disturbing the rest', () => {
    let geo = addPin(emptyGeometry(), { x: 0, y: 0 }, { label: 'a' });
    geo = addPin(geo, { x: 1, y: 1 }, { label: 'b' });
    geo = removePin(geo, 'pin_1');
    expect(geo.pins.map((p) => p.label)).toEqual(['b']);
    expectValid(geo);
  });
});

describe('geometryCounts', () => {
  it('counts what the GM has authored', () => {
    let geo = addWall(emptyGeometry(), { x: 0, y: 0 }, { x: 4, y: 0 });
    geo = addDoor(geo, { x: 4, y: 0 }, { x: 5, y: 0 });
    geo = addZone(geo, square);
    geo = addPin(geo, { x: 2, y: 2 });
    expect(geometryCounts(geo)).toEqual({ wall: 1, door: 1, zone: 1, pin: 1, camera: 0, note: 0 });
    expect(geometryCounts(addNote(geo, { x: 1, y: 1 })).note).toBe(1);
    expect(geometryCounts(addCamera(geo, { x: 3, y: 3 })).camera).toBe(1);
  });
});

describe('door locks (FR9.24)', () => {
  it('a new door is unlocked; the GM locks it, and it stays a valid door', () => {
    let geo = addDoor(emptyGeometry(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(geo.doors[0]?.locked).toBe(false);
    geo = setDoorLocked(geo, 'door_1', true);
    expect(geo.doors[0]).toMatchObject({ open: false, locked: true });
    expectValid(geo);
    expect(setDoorLocked(geo, 'door_1', false).doors[0]?.locked).toBe(false);
    expect(addDoor(emptyGeometry(), { x: 0, y: 0 }, { x: 2, y: 0 }, { locked: true }).doors[0]?.locked).toBe(true);
  });

  it('reads a painted door as shut unless its floor says open', () => {
    const base = { id: 's', campaignId: 'c', name: 'n', state: 'draft', grid: { cols: 4, rows: 4 } };
    const scene = {
      ...base,
      tiles: { tilesetId: 'docklands', structure: { '1,1': 'door' }, doors: { '1,1': { open: true, locked: false } } },
      levels: [{ id: 'l2', name: 'Up', tiles: { tilesetId: 'docklands', structure: { '2,2': 'door' } } }],
    } as never;
    expect(tileDoorOpen(scene, 0, '1,1')).toBe(true);
    expect(tileDoorOpen(scene, 0, '2,2')).toBe(false);
    expect(tileDoorOpen(scene, 1, '2,2')).toBe(false);
    expect(tileDoorOpen(scene, 5, '1,1')).toBe(false);
    expect(tileDoorOpen({ ...base } as never, 0, '1,1')).toBe(false);
  });
});

describe('GM notes (FR9.25)', () => {
  it('drops one with a placeholder, four cells wide, numbered like the rest', () => {
    const geo = addNote(emptyGeometry(), { x: 3.2, y: 4.7 });
    expect(notesOf(geo)).toEqual([{ id: 'note_1', at: { x: 3.2, y: 4.7 }, text: 'GM note', width: 4 }]);
    expect(notesOf(addNote(geo, { x: 1, y: 1 }, { text: 'Sniper after round 3', width: 6 }))[1]).toMatchObject({
      id: 'note_2',
      text: 'Sniper after round 3',
      width: 6,
    });
    expectValid(geo);
  });

  it('reads an old scene with no note list as having none', () => {
    expect(notesOf(emptyGeometry())).toEqual([]);
    expect(notesOf(removeNote(emptyGeometry(), 'note_9'))).toEqual([]);
  });

  it('edits text, width and paper within the contract, and forgets', () => {
    let geo = addNote(emptyGeometry(), { x: 2, y: 2 });
    geo = updateNote(geo, 'note_1', { text: 'x'.repeat(3000), width: 99, color: '#f7a1c4' });
    expect(notesOf(geo)[0]?.text).toHaveLength(2000);
    expect(notesOf(geo)[0]).toMatchObject({ width: 20, color: '#f7a1c4' });
    expectValid(geo);
    geo = updateNote(geo, 'note_1', { width: 0, color: null, at: { x: 5, y: 5 } });
    expect(notesOf(geo)[0]).toMatchObject({ width: 1, at: { x: 5, y: 5 } });
    expect('color' in notesOf(geo)[0]!).toBe(false);
    expect(notesOf(removeNote(geo, 'note_1'))).toEqual([]);
  });
});

describe('cameras (FR9.23)', () => {
  it('mounts one with working defaults, numbered like every other geometry', () => {
    const geo = addCamera(emptyGeometry(), { x: 3.2, y: 4.7 });
    expect(camerasOf(geo)).toEqual([
      { id: 'cam_1', at: { x: 3.2, y: 4.7 }, facing: 90, fov: 90, range: 12, level: 0, active: true },
    ]);
    expect(camerasOf(addCamera(geo, { x: 1, y: 1 }))[1]?.id).toBe('cam_2');
    expectValid(geo);
  });

  it('reads an old scene with no camera list as having none', () => {
    expect(camerasOf(emptyGeometry())).toEqual([]);
    expect(camerasOf(removeCamera(emptyGeometry(), 'cam_9'))).toEqual([]);
  });

  it('keeps every dial inside the contract, whatever the GM types', () => {
    let geo = addCamera(emptyGeometry(), { x: 2, y: 2 });
    geo = updateCamera(geo, 'cam_1', { facing: -30, fov: 1, range: 900, level: -2 });
    expect(camerasOf(geo)[0]).toMatchObject({ facing: 330, fov: 5, range: 200, level: 0 });
    geo = updateCamera(geo, 'cam_1', { facing: 720, fov: 999 });
    expect(camerasOf(geo)[0]).toMatchObject({ facing: 0, fov: 360 });
    expectValid(geo);
    expect(normalizeFacing(-90)).toBe(270);
    expect(normalizeFacing(450.04)).toBe(90);
  });

  it('labels, switches off, and forgets', () => {
    let geo = addCamera(emptyGeometry(), { x: 2, y: 2 });
    geo = updateCamera(geo, 'cam_1', { label: '  Lobby cam ', active: false });
    expect(camerasOf(geo)[0]).toMatchObject({ label: 'Lobby cam', active: false });
    geo = updateCamera(geo, 'cam_1', { label: null });
    expect(camerasOf(geo)[0]?.label).toBeUndefined();
    expect(camerasOf(removeCamera(geo, 'cam_1'))).toEqual([]);
    // Patching a camera that is not there changes nothing.
    expect(updateCamera(geo, 'cam_2', { fov: 30 })).toEqual(geo);
  });
});

describe('removeSelection', () => {
  it('removes the selected thing whatever its kind, and returns the same geometry when there is nothing to remove', () => {
    const geo = {
      walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }],
      doors: [{ id: 'd1', a: { x: 1, y: 0 }, b: { x: 2, y: 0 } }],
      zones: [],
      pins: [{ id: 'p1', at: { x: 2, y: 2 }, label: 'crate', visibility: 'gm' as const }],
    } as unknown as Parameters<typeof removeSelection>[0];
    expect(removeSelection(geo, { kind: 'wall', id: 'w1' }).walls).toEqual([]);
    expect(removeSelection(geo, { kind: 'door', id: 'd1' }).doors).toEqual([]);
    expect(removeSelection(geo, { kind: 'pin', id: 'p1' }).pins).toEqual([]);
    expect(removeSelection(geo, null)).toBe(geo);
    expect(removeSelection(geo, { kind: 'wall', id: 'nope' }).walls).toHaveLength(1);
  });
});
