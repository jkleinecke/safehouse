/**
 * A fog region's properties, in Prep's panel when one is picked (FR9.13/9.14):
 * its name, whether the table can see into it, and taking it away. Fog is
 * the server's: every button here asks, and the canvas redraws when
 * `fog.updated` comes back.
 */
import { useEffect, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { useGridStore } from '../store.js';
import { inputCls, PanelSection } from './ui.js';

export default function FogInspector({
  scene,
  regionId,
  commands,
  onCenter,
}: {
  scene: Scene;
  regionId: string;
  commands: GridCommands;
  onCenter: (x: number, y: number) => void;
}) {
  const select = useGridStore((s) => s.select);
  const region = scene.fog.regions.find((r) => r.id === regionId);
  const [name, setName] = useState(region?.name ?? '');
  const [announce, setAnnounce] = useState(true);
  useEffect(() => setName(region?.name ?? ''), [region?.name]);
  if (!region) return null;
  const open = scene.fog.revealed.includes(region.id);
  const centre = {
    x: region.polygon.reduce((n, p) => n + p.x, 0) / region.polygon.length,
    y: region.polygon.reduce((n, p) => n + p.y, 0) / region.polygon.length,
  };
  const rename = () => {
    const next = name.trim();
    if (next && next !== region.name) commands.fogDefine(scene.id, { ...region, name: next });
  };
  return (
    <section data-testid="fog-inspector" className="bg-raised/40">
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="mono-label text-magenta">Fog region</span>
        <span className={'mono-label flex-1 ' + (open ? 'text-ok' : 'text-faint')}>{open ? 'revealed' : 'hidden'}</span>
        <button type="button" className="btn px-2 py-1" title="Centre on it" onClick={() => onCenter(centre.x, centre.y)}>
          ⌖
        </button>
      </div>
      <PanelSection title="Region">
        <input
          className={inputCls}
          value={name}
          aria-label="Region name"
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {open ? (
          <button type="button" className="btn w-full py-1" onClick={() => commands.fogHide(scene.id, region.id)}>
            fog it again
          </button>
        ) : (
          <button type="button" className="btn btn-accent w-full py-1" onClick={() => commands.fogReveal(scene.id, region.id, announce)}>
            reveal to the table
          </button>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          <span className="mono-label">announce reveals in the log</span>
        </label>
      </PanelSection>
      <div className="flex justify-end px-3 pb-3">
        <button
          type="button"
          className="btn py-1 text-danger"
          onClick={() => {
            select(null);
            commands.fogRemove(scene.id, region.id);
          }}
        >
          delete the region
        </button>
      </div>
    </section>
  );
}
