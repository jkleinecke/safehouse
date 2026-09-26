/**
 * Everything placed on the floor on screen, when nothing is picked — Prep's
 * panel at rest.
 *
 * The map shows where things are; this is how a GM finds what the map does
 * NOT show well: a hidden token, a fog region not yet revealed, a camera in
 * a corner, a note under a crate. One list, four kinds, each row a click
 * that picks the thing up and brings the map to it. It replaces the Tokens,
 * Fog and Cams & notes tabs' lists — the same rows, in one place.
 */
import type { Scene, Token } from '@safehouse/contracts';
import type { GridCommands } from '../commands.js';
import { useGridStore } from '../store.js';
import { hiddenLayerTokenIds, layersOf } from '../tokenLayers.js';
import { Empty, PanelSection } from './ui.js';

function Line({
  name,
  tag,
  tagTone = 'text-faint',
  onClick,
  children,
}: {
  name: string;
  tag?: string | undefined;
  tagTone?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-raised">
      <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-ink" onClick={onClick}>
        {name}
        {tag && <span className={`mono-label ml-2 ${tagTone}`}>{tag}</span>}
      </button>
      {children}
    </li>
  );
}

export default function PrepOutline({
  scene,
  tokens,
  commands,
  onCenter,
}: {
  scene: Scene;
  tokens: readonly Token[];
  commands: GridCommands;
  onCenter: (x: number, y: number) => void;
}) {
  const level = useGridStore((s) => s.activeLevel);
  const select = useGridStore((s) => s.select);
  const selectToken = useGridStore((s) => s.selectToken);
  const here = tokens.filter((t) => (t.level ?? 0) === level);
  const layerHidden = hiddenLayerTokenIds(layersOf(scene));
  const revealed = new Set(scene.fog.revealed);
  const cameras = (scene.geometry.cameras ?? []).filter((c) => (c.level ?? 0) === level);
  const notes = scene.geometry.gmNotes ?? [];
  const centre = (poly: ReadonlyArray<{ x: number; y: number }>) => ({
    x: poly.reduce((n, p) => n + p.x, 0) / Math.max(1, poly.length),
    y: poly.reduce((n, p) => n + p.y, 0) / Math.max(1, poly.length),
  });
  const nothing = here.length + scene.fog.regions.length + cameras.length + notes.length === 0;

  return (
    <div data-testid="prep-outline">
      {nothing && (
        <div className="p-3">
          <Empty>nothing placed on this floor yet — pick Token, Fog, Camera or Note on the toolbar</Empty>
        </div>
      )}
      {here.length > 0 && (
        <PanelSection title="Tokens" hint={`${here.length}`}>
          <ul>
            {here.map((t) => (
              <Line
                key={t.id}
                name={t.name}
                tag={t.hidden ? 'hidden' : layerHidden.has(t.id) ? 'layer hidden' : undefined}
                tagTone="text-magenta"
                onClick={() => {
                  selectToken(t.id);
                  onCenter(t.x, t.y);
                }}
              />
            ))}
          </ul>
        </PanelSection>
      )}
      {scene.fog.regions.length > 0 && (
        <PanelSection title="Fog" hint={`${scene.fog.regions.length}`}>
          <ul>
            {scene.fog.regions.map((r) => {
              const open = revealed.has(r.id);
              return (
                <Line
                  key={r.id}
                  name={r.name}
                  tag={open ? 'revealed' : undefined}
                  tagTone="text-ok"
                  onClick={() => {
                    selectToken(null);
                    select({ kind: 'fog', id: r.id });
                    const c = centre(r.polygon);
                    onCenter(c.x, c.y);
                  }}
                >
                  <button
                    type="button"
                    className={'btn px-2 py-0.5 text-xs ' + (open ? '' : 'btn-accent')}
                    title={open ? 'Fog it again' : 'Reveal to the table'}
                    onClick={() => (open ? commands.fogHide(scene.id, r.id) : commands.fogReveal(scene.id, r.id, true))}
                  >
                    {open ? 'hide' : 'reveal'}
                  </button>
                </Line>
              );
            })}
          </ul>
        </PanelSection>
      )}
      {cameras.length > 0 && (
        <PanelSection title="Cameras" hint={`${cameras.length}`}>
          <ul>
            {cameras.map((c) => (
              <Line
                key={c.id}
                name={c.label ?? c.id}
                tag={c.active ? undefined : 'off'}
                onClick={() => {
                  selectToken(null);
                  select({ kind: 'camera', id: c.id });
                  onCenter(c.at.x, c.at.y);
                }}
              />
            ))}
          </ul>
        </PanelSection>
      )}
      {notes.length > 0 && (
        <PanelSection title="Notes" hint={`${notes.length}`}>
          <ul>
            {notes.map((n) => (
              <Line
                key={n.id}
                name={n.text.split('\n')[0]?.slice(0, 60) || 'Note'}
                onClick={() => {
                  selectToken(null);
                  select({ kind: 'note', id: n.id });
                  onCenter(n.at.x, n.at.y);
                }}
              />
            ))}
          </ul>
        </PanelSection>
      )}
    </div>
  );
}
