/**
 * Build · Prep · Play, on their own row across the top of the Map.
 *
 * These three are not tools. They are what the GM is *doing* — each one
 * changes which tools the toolbar offers and which sections the panel shows
 * (docs/UX_MAP_BUILDER.md §3.1). Sitting inside the canvas toolbar they read
 * as three more buttons among fourteen, so a GM reached for Play the way
 * they reach for the ruler. Here they are a header: one row, three words,
 * nothing else on it. No line spelling out what the chosen mode contains —
 * the toolbar and the panel below already show exactly that (see
 * docs/UX_MAP_BUILDER.md §3.7).
 *
 * Undo and redo ride along at the row's other end: not modes either, but
 * like the modes they are about the map as a whole rather than about the
 * square under the cursor.
 *
 * A player never sees this row — players have no modes.
 */
import HudButton, { HudIcon } from './HudButton.js';
import { MODES, type GridMode } from './modes.js';

/** The next step each way, for the row's Undo and Redo. */
export interface ModeHistory {
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export interface ModeBarProps {
  mode: GridMode;
  onMode: (mode: GridMode) => void;
  /** Undo and redo, for a GM building or prepping; absent in Play. */
  history?: ModeHistory;
}

export default function ModeBar(props: ModeBarProps) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge bg-panel px-3 py-2"
      data-testid="mode-bar"
    >
      <div role="group" aria-label="Mode" className="flex items-center gap-1" data-testid="mode-switch">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            aria-pressed={props.mode === m.id}
            data-testid={`mode-${m.id}`}
            onClick={() => props.onMode(m.id)}
            className={
              'min-h-9 rounded px-4 py-1.5 font-label text-xs uppercase tracking-wide ' +
              (props.mode === m.id
                ? 'border border-cyan bg-raised text-cyan shadow-glow-cyan'
                : 'border border-transparent text-faint hover:text-ink')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      {/*
        Undo and redo at the far end of the mode row. They belong here rather
        than among the tools: you do not pick one up and then use it, and in
        the run of tool icons they read as a tenth and an eleventh — the GM
        reaching for Pin found Undo. Up here they hold one place while the
        tools below change with the mode, and the whitespace between is the
        separator (Law of Proximity).
      */}
      {props.history && props.mode !== 'play' && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5" role="group" aria-label="History">
          <HudButton
            title={props.history.undoLabel ? `Undo: ${props.history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
            disabled={props.history.busy || props.history.undoLabel === null}
            onClick={props.history.onUndo}
            testId="undo"
          >
            <HudIcon>↶</HudIcon>
          </HudButton>
          <HudButton
            title={props.history.redoLabel ? `Redo: ${props.history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
            disabled={props.history.busy || props.history.redoLabel === null}
            onClick={props.history.onRedo}
            testId="redo"
          >
            <HudIcon>↷</HudIcon>
          </HudButton>
        </div>
      )}
    </div>
  );
}
