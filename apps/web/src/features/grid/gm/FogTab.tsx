/**
 * Named fog regions + staged reveals (FR9.13/9.14).
 * Fog is authoritative on the server: these buttons send `fog.reveal` and the
 * canvas redraws when `fog.updated` comes back, never optimistically.
 */
import { useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { rectPolygon } from '../geometry.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, newId, PanelSection } from './ui.js';

export default function FogTab({ scene, commands }: { scene: Scene; commands: GridCommands }) {
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const fogDraft = useGridStore((s) => s.fogDraft);
  const clearFogDraft = useGridStore((s) => s.clearFogDraft);
  const [name, setName] = useState('');
  const [announce, setAnnounce] = useState(true);

  const revealed = new Set(scene.fog.revealed);
  const points = fogDraft?.points ?? [];

  const save = (polygon: { x: number; y: number }[]) => {
    commands.fogDefine(scene.id, {
      id: newId('fog'),
      name: name.trim() || `Region ${scene.fog.regions.length + 1}`,
      polygon,
    });
    setName('');
    clearFogDraft();
  };

  const first = points[0];
  const second = points[1];
  const canRect = points.length === 2 && first !== undefined && second !== undefined;

  return (
    <>
      <PanelSection title="Regions" hint={`${scene.fog.regions.length}`}>
        {scene.fog.regions.length === 0 && <Empty>no named regions yet</Empty>}
        <ul className="space-y-1">
          {scene.fog.regions.map((r) => {
            const open = revealed.has(r.id);
            return (
              <li key={r.id} className="flex items-center gap-2">
                <span
                  className={'min-w-0 flex-1 truncate text-xs ' + (open ? 'text-ok' : 'text-ink')}
                >
                  {r.name}
                </span>
                {open ? (
                  <button
                    type="button"
                    className="btn py-1"
                    onClick={() => commands.fogHide(scene.id, r.id)}
                  >
                    hide
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-accent py-1"
                    onClick={() => commands.fogReveal(scene.id, r.id, announce)}
                  >
                    reveal
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={announce}
            onChange={(e) => setAnnounce(e.target.checked)}
          />
          <span className="mono-label">announce reveals in the log</span>
        </label>
      </PanelSection>

      <PanelSection title="Define region" hint={`${points.length} pts`}>
        <button
          type="button"
          className={'btn w-full py-1 ' + (tool === 'fogdef' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool(tool === 'fogdef' ? 'select' : 'fogdef')}
        >
          {tool === 'fogdef' ? 'stop clicking vertices' : 'click vertices on the map'}
        </button>
        <input
          className={inputCls}
          placeholder="east wing, the lab…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-accent flex-1 py-1"
            disabled={points.length < 3}
            onClick={() => save(points)}
            title="Save the clicked vertices as a polygon"
          >
            save polygon
          </button>
          <button
            type="button"
            className="btn flex-1 py-1"
            disabled={!canRect}
            onClick={() => {
              if (first && second) save(rectPolygon(first, second));
            }}
            title="Two clicks = opposite corners of a rectangle"
          >
            save rect
          </button>
          <button type="button" className="btn py-1" disabled={points.length === 0} onClick={clearFogDraft}>
            clear
          </button>
        </div>
        <Empty>
          two clicks make a rectangle, three or more a polygon; players see unrevealed area as
          solid, you see a 40% tint with region outlines
        </Empty>
      </PanelSection>
    </>
  );
}
