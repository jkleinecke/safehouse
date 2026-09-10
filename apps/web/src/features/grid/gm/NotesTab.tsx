/**
 * GM notes (FR9.25): the things a GM used to keep on paper beside the screen,
 * pinned to the map instead. "The guard is asleep until someone shoots."
 * "Sniper on the roof after round 3." "This door leads to scene 4."
 *
 * Only the GM ever sees any of it: a player's scene carries no notes at all
 * (`sceneForViewer`), so a note is not a pin with a privacy setting — it is
 * a thing that does not exist for the table.
 */
import type { Note, Scene } from '@safehouse/contracts';
import { usePatchGeometry } from '../api.js';
import { NOTE_MAX_CHARS, notesOf, removeNote, updateNote, type NotePatch } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import { Empty, inputCls, Num, PanelSection, Row } from './ui.js';

export interface NotesTabProps {
  scene: Scene;
  onCenter: (x: number, y: number) => void;
}

/** A few papers to pick from; the contract takes any hex. */
const PAPERS: ReadonlyArray<{ label: string; color: string | null }> = [
  { label: 'yellow', color: null },
  { label: 'pink', color: '#f7a1c4' },
  { label: 'green', color: '#a8e6a1' },
  { label: 'blue', color: '#9fd0f5' },
];

export default function NotesTab({ scene, onCenter }: NotesTabProps) {
  const patch = usePatchGeometry();
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const selectedNoteId = useGridStore((s) => s.selectedNoteId);
  const selectNote = useGridStore((s) => s.selectNote);

  const geo = scene.geometry;
  const notes = notesOf(geo);
  const save = (next: typeof geo) => patch.mutate({ sceneId: scene.id, geometry: next });

  return (
    <>
      <PanelSection title="Drop a note">
        <button
          type="button"
          aria-pressed={tool === 'note'}
          data-testid="note-tool"
          className={'btn w-full py-1 ' + (tool === 'note' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool(tool === 'note' ? 'select' : 'note')}
        >
          {tool === 'note' ? 'stop dropping notes' : 'click the map to drop a note'}
        </button>
        <Empty>
          only you ever see notes — they never reach a player, a display or the table TV. With the
          select tool, clicking a note on the map opens it here.
        </Empty>
        {patch.isError && <p className="mono-label text-danger">note not saved — retry</p>}
      </PanelSection>

      <PanelSection title="Notes" hint={`${notes.length}`}>
        {notes.length === 0 && <Empty>no notes on this map yet</Empty>}
        <ul className="space-y-2" data-testid="note-list">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              onSelect={() => selectNote(note.id === selectedNoteId ? null : note.id)}
              onCenter={() => onCenter(note.at.x, note.at.y)}
              onPatch={(p) => save(updateNote(geo, note.id, p))}
              onDelete={() => {
                if (selectedNoteId === note.id) selectNote(null);
                save(removeNote(geo, note.id));
              }}
            />
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

interface NoteRowProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onCenter: () => void;
  onPatch: (patch: NotePatch) => void;
  onDelete: () => void;
}

/** The first line of a note, as its name in the list. */
function headline(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || '(empty)';
}

function NoteRow(props: NoteRowProps) {
  const { note } = props;
  return (
    <li
      data-note={note.id}
      data-selected={props.selected ? 'yes' : 'no'}
      className={'rounded border px-2 py-2 ' + (props.selected ? 'border-magenta' : 'border-edge')}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm"
          onClick={props.onSelect}
          title="open this note"
        >
          <span className="text-warn">▤</span> {headline(note.text)}
        </button>
        <button type="button" className="btn px-2 py-0.5" onClick={props.onCenter} title="centre the map here">
          ⌖
        </button>
      </div>

      {props.selected && (
        <div className="mt-2 space-y-2">
          <textarea
            className={inputCls + ' min-h-24 w-full'}
            value={note.text}
            maxLength={NOTE_MAX_CHARS}
            aria-label="note text"
            onChange={(e) => props.onPatch({ text: e.target.value })}
          />
          <Row label="width">
            <Num
              value={note.width}
              min={1}
              max={20}
              step={1}
              title="How many cells wide the note is drawn"
              onChange={(n) => props.onPatch({ width: n })}
            />
          </Row>
          <Row label="paper">
            <div className="flex gap-1">
              {PAPERS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={
                    'btn flex-1 py-0.5 ' + ((note.color ?? null) === p.color ? 'border-cyan text-cyan' : '')
                  }
                  onClick={() => props.onPatch({ color: p.color })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Row>
          <div className="flex gap-2">
            <span className="mono-label flex-1 text-faint">
              at {note.at.x}, {note.at.y}
            </span>
            <button type="button" className="btn py-0.5 text-danger" onClick={props.onDelete}>
              delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
