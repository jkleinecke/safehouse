/**
 * Cameras and notes (docs/UX_MAP_BUILDER.md §3.2): the two things on a map
 * only the GM ever sees, listed one line each. Pick a row and the inspector
 * opens it — the same inspector a click on the canvas opens. The tools that
 * place them (C, N) live on the toolbar.
 *
 * A camera is a point with a facing and a field of view; the canvas draws
 * its cone — the cells it actually sees, cut by walls and tiles — the moment
 * it is placed. A note is what a GM used to keep on paper beside the screen,
 * pinned to the map instead. Neither reaches a player, a display or the
 * table TV: a player's scene carries no cameras and no notes at all
 * (`sceneForViewer`), so a note is not a pin with a privacy setting — it is
 * a thing that does not exist for the table.
 */
import type { Scene } from '@safehouse/contracts';
import type { ReactNode } from 'react';
import { camerasOf, notesOf } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import type { GeometrySelection } from '../types.js';
import { cameraLensId } from '../useShroud.js';
import { Empty, PanelSection } from './ui.js';

export interface CamerasTabProps {
  scene: Scene;
  /** What the inspector has open — the panel owns it, the list only rings it. */
  selected: GeometrySelection | null;
  /** The LOS lens in use, if any: a camera being looked through says so in its row. */
  lens: string | null;
}

/** The first line of a note, as its name in the list. */
export function headline(text: string): string {
  const line = (text.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || '(empty)';
}

export default function CamerasTab({ scene, selected, lens }: CamerasTabProps) {
  const select = useGridStore((s) => s.select);

  const cameras = camerasOf(scene.geometry);
  const notes = notesOf(scene.geometry);

  const on = (kind: GeometrySelection['kind'], id: string) =>
    selected !== null && selected.kind === kind && selected.id === id;
  const pick = (kind: GeometrySelection['kind'], id: string) =>
    select(on(kind, id) ? null : { kind, id });

  return (
    <>
      <PanelSection title="Cameras" hint={`${cameras.length}`}>
        {cameras.length === 0 && <Empty>no cameras on this map yet — C mounts one</Empty>}
        <ul className="space-y-1" data-testid="camera-list">
          {cameras.map((cam) => (
            <Line
              key={cam.id}
              attr={{ 'data-camera': cam.id }}
              on={on('camera', cam.id)}
              onPick={() => pick('camera', cam.id)}
            >
              <span className={cam.active ? 'text-warn' : 'text-faint'} aria-hidden>
                ◉
              </span>
              <span className="min-w-0 flex-1 truncate">{cam.label ?? cam.id}</span>
              {lens === cameraLensId(cam.id) && (
                <span className="mono-label text-cyan">looking</span>
              )}
              {!cam.active && <span className="mono-label text-faint">off</span>}
            </Line>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Notes" hint={`${notes.length}`}>
        {notes.length === 0 && <Empty>no notes on this map yet — N drops one</Empty>}
        <ul className="space-y-1" data-testid="note-list">
          {notes.map((note) => (
            <Line
              key={note.id}
              attr={{ 'data-note': note.id }}
              on={on('note', note.id)}
              onPick={() => pick('note', note.id)}
            >
              <span className="text-warn" aria-hidden>
                ▤
              </span>
              <span className="min-w-0 flex-1 truncate">{headline(note.text)}</span>
            </Line>
          ))}
        </ul>
      </PanelSection>

      <p className="mono-label px-3 pb-3 text-faint">
        only you see cameras and notes — a player’s map has neither, and a camera the table can
        see is one the runners have already found
      </p>
    </>
  );
}

function Line({
  attr,
  on,
  onPick,
  children,
}: {
  attr: Record<string, string>;
  on: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <li {...attr} data-selected={on ? 'yes' : 'no'}>
      <button
        type="button"
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
