/**
 * GM-layer geometry authoring (FR9.2): draw, edit and delete walls, place
 * doors with an open/closed toggle, and draw named zones.
 *
 * Everything here is a call into `../geometryEdit.js` followed by one whole
 * -object `PATCH /api/scenes/:id { geometry }`. The canvas redraws from the
 * refreshed scene query, so nothing is optimistic and nothing can drift.
 */
import type { Point, Scene } from '@safehouse/contracts';
import { usePatchGeometry } from '../api.js';
import { rectPolygon } from '../geometry.js';
import {
  addZone,
  convertWallToDoor,
  removeDoor,
  removeWall,
  removeZone,
  toggleDoor,
  updateWall,
  updateZone,
} from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import type { GridTool } from '../types.js';
import { Empty, inputCls, Num, PanelSection, Row } from './ui.js';

export interface GeometryTabProps {
  scene: Scene;
  onCenter: (x: number, y: number) => void;
}

function ToolButton({
  tool,
  label,
  hint,
}: {
  tool: GridTool;
  label: string;
  hint: string;
}) {
  const active = useGridStore((s) => s.tool) === tool;
  const setTool = useGridStore((s) => s.setTool);
  return (
    <button
      type="button"
      title={hint}
      aria-pressed={active}
      className={'btn flex-1 py-1 ' + (active ? 'border-cyan text-cyan' : '')}
      onClick={() => setTool(active ? 'select' : tool)}
    >
      {label}
    </button>
  );
}

export default function GeometryTab({ scene, onCenter }: GeometryTabProps) {
  const patch = usePatchGeometry();
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const draft = useGridStore((s) => s.fogDraft);
  const clearDraft = useGridStore((s) => s.clearFogDraft);
  const zoneName = useGridStore((s) => s.zoneName);
  const setZoneName = useGridStore((s) => s.setZoneName);

  const geo = scene.geometry;
  const save = (next: typeof geo) => patch.mutate({ sceneId: scene.id, geometry: next });

  const points = draft?.points ?? [];
  const first = points[0];
  const second = points[1];
  const canRect = points.length === 2 && first !== undefined && second !== undefined;

  const saveZone = (polygon: Point[]) => {
    save(addZone(geo, polygon, { name: zoneName }));
    setZoneName('');
    clearDraft();
  };

  return (
    <>
      <PanelSection title="Draw" hint="drag for segments">
        <div className="flex gap-2">
          <ToolButton tool="wall" label="wall" hint="Drag a wall segment (snaps to grid corners)" />
          <ToolButton tool="door" label="door" hint="Drag a door segment; click its knob to open it" />
          <ToolButton tool="zone" label="zone" hint="Click vertices for a named area" />
        </div>
        {(tool === 'wall' || tool === 'door') && (
          <Empty>
            drag from corner to corner; hold Shift to place a vertex off the grid, and a click that
            never moves draws nothing
          </Empty>
        )}
        {tool === 'zone' && (
          <>
            <input
              className={inputCls}
              placeholder="loading dock, the vault…"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-accent flex-1 py-1"
                disabled={points.length < 3}
                onClick={() => saveZone(points)}
              >
                save polygon ({points.length})
              </button>
              <button
                type="button"
                className="btn flex-1 py-1"
                disabled={!canRect}
                title="Two clicks = opposite corners"
                onClick={() => {
                  if (first && second) saveZone(rectPolygon(first, second));
                }}
              >
                save rect
              </button>
              <button
                type="button"
                className="btn py-1"
                disabled={points.length === 0}
                onClick={clearDraft}
              >
                clear
              </button>
            </div>
          </>
        )}
        {patch.isError && <p className="mono-label text-danger">geometry not saved — retry</p>}
      </PanelSection>

      <PanelSection title="Walls" hint={`${geo.walls.length}`}>
        {geo.walls.length === 0 && <Empty>drag with the wall tool to block a sight line</Empty>}
        <ul className="space-y-2">
          {geo.walls.map((wall) => (
            <li key={wall.id} className="rounded border border-edge p-2">
              <div className="flex items-center gap-2">
                <span className="mono-label min-w-0 flex-1 truncate text-dim">{wall.id}</span>
                <button
                  type="button"
                  className="btn py-1"
                  title="Centre the canvas here"
                  onClick={() => onCenter((wall.a.x + wall.b.x) / 2, (wall.a.y + wall.b.y) / 2)}
                >
                  find
                </button>
                <button
                  type="button"
                  className="btn py-1"
                  title="Turn this segment into a door"
                  onClick={() => save(convertWallToDoor(geo, wall.id))}
                >
                  → door
                </button>
                <button
                  type="button"
                  className="btn py-1 text-danger"
                  onClick={() => save(removeWall(geo, wall.id))}
                >
                  delete
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Row label="from x">
                  <Num
                    value={wall.a.x}
                    step={0.5}
                    onChange={(n) => save(updateWall(geo, wall.id, { a: { ...wall.a, x: n } }))}
                  />
                </Row>
                <Row label="from y">
                  <Num
                    value={wall.a.y}
                    step={0.5}
                    onChange={(n) => save(updateWall(geo, wall.id, { a: { ...wall.a, y: n } }))}
                  />
                </Row>
                <Row label="to x">
                  <Num
                    value={wall.b.x}
                    step={0.5}
                    onChange={(n) => save(updateWall(geo, wall.id, { b: { ...wall.b, x: n } }))}
                  />
                </Row>
                <Row label="to y">
                  <Num
                    value={wall.b.y}
                    step={0.5}
                    onChange={(n) => save(updateWall(geo, wall.id, { b: { ...wall.b, y: n } }))}
                  />
                </Row>
              </div>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Doors" hint={`${geo.doors.length}`}>
        {geo.doors.length === 0 && <Empty>doors toggle open and shut mid-fight</Empty>}
        <ul className="space-y-1">
          {geo.doors.map((door) => (
            <li key={door.id} className="flex items-center gap-2">
              <span className={'min-w-0 flex-1 truncate text-xs ' + (door.open ? 'text-ok' : 'text-ink')}>
                {door.id} {door.open ? 'open' : 'closed'}
              </span>
              <button
                type="button"
                className="btn py-1"
                title="Centre the canvas here"
                onClick={() => onCenter((door.a.x + door.b.x) / 2, (door.a.y + door.b.y) / 2)}
              >
                find
              </button>
              <button
                type="button"
                className={'btn py-1 ' + (door.open ? '' : 'btn-accent')}
                aria-pressed={door.open}
                onClick={() => save(toggleDoor(geo, door.id))}
              >
                {door.open ? 'close' : 'open'}
              </button>
              <button
                type="button"
                className="btn py-1 text-danger"
                onClick={() => save(removeDoor(geo, door.id))}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Zones" hint={`${geo.zones.length}`}>
        {geo.zones.length === 0 && <Empty>named areas label the map for you alone</Empty>}
        <ul className="space-y-2">
          {geo.zones.map((zone) => (
            <li key={zone.id} className="rounded border border-edge p-2">
              <div className="flex items-center gap-2">
                <input
                  className={inputCls}
                  value={zone.name}
                  aria-label={`Zone name (${zone.id})`}
                  onChange={(e) => save(updateZone(geo, zone.id, { name: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn py-1 text-danger"
                  onClick={() => save(removeZone(geo, zone.id))}
                >
                  delete
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Zone colour (${zone.id})`}
                  className="h-7 w-10 rounded border border-edge bg-deck"
                  value={zone.color ?? '#1596ab'}
                  onChange={(e) => save(updateZone(geo, zone.id, { color: e.target.value }))}
                />
                <span className="mono-label text-faint">{zone.polygon.length} vertices</span>
              </div>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Play" hint="FR9.2">
        <button
          type="button"
          className={'btn w-full py-1 ' + (tool === 'select' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool('select')}
        >
          back to the select tool
        </button>
        <Empty>with select, clicking a door&apos;s knob on the map opens or shuts it</Empty>
      </PanelSection>
    </>
  );
}
