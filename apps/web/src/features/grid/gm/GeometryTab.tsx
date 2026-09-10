/**
 * The layout list (docs/UX_MAP_BUILDER.md §3.2): every wall, door, zone and
 * pin on the map, one line each. Pick a row and the inspector opens it — the
 * same inspector a click on the canvas opens — so there is one way to edit a
 * thing, and this list is only for finding it. The tools that draw live on
 * the toolbar; the zone tool's drafting controls are the one exception here,
 * because a polygon is saved when the GM says so, not dropped on a click.
 */
import type { Point, Scene } from '@safehouse/contracts';
import type { ReactNode } from 'react';
import { usePatchGeometry } from '../api.js';
import { rectPolygon } from '../geometry.js';
import { addZone, isPinLinked, segmentLength } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import type { GeometrySelection, GridTool } from '../types.js';
import { Empty, inputCls, PanelSection } from './ui.js';

export interface GeometryTabProps {
  scene: Scene;
  /** What the inspector has open — the panel owns it, the list only rings it. */
  selected: GeometrySelection | null;
  /** The tool in hand: the zone tool brings its drafting controls with it. */
  tool: GridTool;
}

/** A segment's length in metres, the way the ruler would say it. */
export function metres(a: Point, b: Point, unitM: number): string {
  const n = segmentLength(a, b) * unitM;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} m`;
}

export default function GeometryTab({ scene, selected, tool }: GeometryTabProps) {
  const patch = usePatchGeometry();
  const draft = useGridStore((s) => s.fogDraft);
  const clearDraft = useGridStore((s) => s.clearFogDraft);
  const zoneName = useGridStore((s) => s.zoneName);
  const setZoneName = useGridStore((s) => s.setZoneName);
  const select = useGridStore((s) => s.select);

  const geo = scene.geometry;
  const unit = scene.grid.unitM;
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

  const on = (kind: GeometrySelection['kind'], id: string) =>
    selected !== null && selected.kind === kind && selected.id === id;
  const pick = (kind: GeometrySelection['kind'], id: string) =>
    select(on(kind, id) ? null : { kind, id });

  return (
    <>
      {tool === 'zone' && (
        <PanelSection title="New zone" hint={`${points.length} vertices`}>
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
              save polygon
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
            <button type="button" className="btn py-1" disabled={points.length === 0} onClick={clearDraft}>
              clear
            </button>
          </div>
          <Empty>click the map for each corner; a name is how the zone reads on your map</Empty>
        </PanelSection>
      )}
      {patch.isError && (
        <p className="mono-label px-3 pt-2 text-danger">geometry not saved — retry</p>
      )}

      <PanelSection title="Walls" hint={`${geo.walls.length}`}>
        {geo.walls.length === 0 && <Empty>drag with the wall tool (W) to block a sight line</Empty>}
        <ul className="space-y-1" data-testid="wall-list">
          {geo.walls.map((wall) => (
            <Line key={wall.id} id={wall.id} on={on('wall', wall.id)} onPick={() => pick('wall', wall.id)}>
              <span className="min-w-0 flex-1 truncate">{wall.id}</span>
              <span className="mono-label text-faint">{metres(wall.a, wall.b, unit)}</span>
            </Line>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Doors" hint={`${geo.doors.length}`}>
        {geo.doors.length === 0 && (
          <Empty>draw one with the door tool (D), or turn a wall into one</Empty>
        )}
        <ul className="space-y-1" data-testid="door-list">
          {geo.doors.map((door) => (
            <Line key={door.id} id={door.id} on={on('door', door.id)} onPick={() => pick('door', door.id)}>
              <span className="min-w-0 flex-1 truncate">{door.id}</span>
              <span className={'mono-label ' + (door.open ? 'text-ok' : 'text-dim')}>
                {door.open ? 'open' : 'shut'}
              </span>
              {door.locked && <span className="mono-label text-warn">locked</span>}
            </Line>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Zones" hint={`${geo.zones.length}`}>
        {geo.zones.length === 0 && <Empty>named areas label the map for you alone — Z draws one</Empty>}
        <ul className="space-y-1" data-testid="zone-list">
          {geo.zones.map((zone) => (
            <Line key={zone.id} id={zone.id} on={on('zone', zone.id)} onPick={() => pick('zone', zone.id)}>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: zone.color ?? '#1596ab' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{zone.name || zone.id}</span>
              <span className="mono-label text-faint">{zone.polygon.length} pts</span>
            </Line>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Pins" hint={`${geo.pins.length}`}>
        {geo.pins.length === 0 && <Empty>no pins on this map yet — P drops one</Empty>}
        <ul className="space-y-1" data-testid="pin-list">
          {geo.pins.map((pin) => (
            <Line key={pin.id} id={pin.id} on={on('pin', pin.id)} onPick={() => pick('pin', pin.id)}>
              <span className="min-w-0 flex-1 truncate">{pin.label || pin.id}</span>
              {!isPinLinked(pin) && <span className="mono-label text-faint">unlinked</span>}
              <span className={'mono-label ' + (pin.visibility === 'public' ? 'text-ok' : 'text-dim')}>
                {pin.visibility === 'public' ? 'revealed' : 'private'}
              </span>
            </Line>
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

/** One row: the whole line is the button, and the picked one is ringed like its thing on the map. */
function Line({ id, on, onPick, children }: { id: string; on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        data-row={id}
        aria-pressed={on}
        title={on ? 'Close the inspector' : 'Open it in the inspector'}
        className={
          'flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ' +
          (on ? 'border-magenta bg-raised/60 text-ink' : 'border-edge text-ink hover:border-edge-bright')
        }
        onClick={onPick}
      >
        {children}
      </button>
    </li>
  );
}
