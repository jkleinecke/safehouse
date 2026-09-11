/**
 * The canvas toolbar: the mode switch, the mode's tools, and one hint line.
 *
 * Build · Prep · Play (docs/UX_MAP_BUILDER.md §3.1): a GM picks what they are
 * doing once, and the row shows only that mode's tools — five or six, never
 * fourteen. Every tool has a single key (§3.3), named in its tooltip, and the
 * line under the row says the one thing the tool in hand wants.
 *
 * Players get select / ruler / AoE / pointer in every mode, because players
 * have no modes. The view controls — snap, zoom, fit, Plan/Iso, the panel —
 * are not tools and live in `ViewControls`, on the canvas's other corner.
 */
import type { GridProjection } from '@safehouse/contracts';
import type { GridTool, ViewProjection } from '../types.js';
import { MODE_TOOLS, MODES, PLAYER_TOOLS, shortcutFor, TOOL_HINTS, type GridMode } from './modes.js';

interface ToolDef {
  id: GridTool;
  label: string;
  glyph: string;
  hint: string;
}

const TOOL_DEFS: Record<GridTool, Omit<ToolDef, 'id'>> = {
  select: { label: 'Select', glyph: '⬚', hint: 'Select, drag tokens, open doors, pan' },
  ruler: { label: 'Measure', glyph: '📏', hint: 'Measure in metres' },
  aoe: { label: 'AoE', glyph: '◎', hint: 'Place a circle template' },
  pointer: { label: 'Point', glyph: '✳', hint: 'Pointer trail for everyone' },
  focus: { label: 'Focus', glyph: '⊕', hint: 'Pull every screen here, once' },
  'tile-room': { label: 'Room', glyph: '▣', hint: 'Drag a room: floor inside, walls around' },
  'tile-area': { label: 'Area', glyph: '▦', hint: 'Drag a rectangle of floor' },
  tile: { label: 'Brush', glyph: '🖌', hint: 'Paint squares with the chosen material' },
  'tile-erase': { label: 'Erase', glyph: '◫', hint: 'Clear painted squares' },
  wall: { label: 'Wall', glyph: '▬', hint: 'Drag to draw a wall' },
  door: { label: 'Door', glyph: '⌷', hint: 'Drag to place a door' },
  zone: { label: 'Zone', glyph: '▱', hint: 'Click corners for a named area' },
  pin: { label: 'Pin', glyph: '⚑', hint: 'Drop a map pin' },
  fogdef: { label: 'Fog', glyph: '⬡', hint: 'Click corners for a fog region' },
  camera: { label: 'Camera', glyph: '◉', hint: 'Mount a security camera only you see' },
  note: { label: 'Note', glyph: '🗒', hint: 'Drop a note only you ever see' },
};

/** The tooltip: what the tool does, and the key that picks it. */
export function toolTitle(tool: GridTool): string {
  const key = shortcutFor(tool);
  return key ? `${TOOL_DEFS[tool].hint} (${key})` : TOOL_DEFS[tool].hint;
}

export interface ToolbarProps {
  isGm: boolean;
  mode: GridMode;
  tool: GridTool;
  onMode: (mode: GridMode) => void;
  onTool: (tool: GridTool) => void;
  /** Undo and redo, for a GM building or prepping; absent for a player. */
  history?: ToolbarHistory;
}

function Btn({
  active,
  title,
  onClick,
  children,
  testId,
  disabled,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={
        'btn px-2.5 py-1.5 text-[0.7rem] disabled:opacity-40 ' +
        (active ? 'border-cyan text-cyan shadow-glow-cyan' : 'text-dim')
      }
    >
      {children}
    </button>
  );
}

/** The next step each way, for the toolbar's Undo and Redo. */
export interface ToolbarHistory {
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function Toolbar(props: ToolbarProps) {
  const tools = props.isGm ? MODE_TOOLS[props.mode] : PLAYER_TOOLS;
  return (
    // Positioned by the caller, not by itself. It used to place itself at the
    // canvas's top-left, and as the tool row grew it silently spread under the
    // notice stack in the top-right corner and swallowed its clicks — the
    // take-the-stairs button was on screen, correct, and unpressable.
    <div className="pointer-events-auto flex min-w-0 max-w-full flex-col gap-1 rounded-lg border border-edge bg-panel/92 p-1.5 backdrop-blur">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {props.isGm && (
          <>
            <div role="group" aria-label="Mode" className="flex items-center gap-0.5" data-testid="mode-switch">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.hint}
                  aria-pressed={props.mode === m.id}
                  onClick={() => props.onMode(m.id)}
                  className={
                    'min-h-9 rounded px-2 py-1 font-label text-[0.7rem] uppercase tracking-wide ' +
                    (props.mode === m.id ? 'bg-raised text-cyan' : 'text-faint hover:text-ink')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
          </>
        )}
        {tools.map((id) => (
          <Btn key={id} active={props.tool === id} title={toolTitle(id)} onClick={() => props.onTool(id)} testId={`tool-${id}`}>
            <span aria-hidden>{TOOL_DEFS[id].glyph}</span>
            <span className="hidden sm:inline">{TOOL_DEFS[id].label}</span>
          </Btn>
        ))}
        {props.isGm && props.mode !== 'play' && props.history && (
          <>
            <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
            <Btn
              title={props.history.undoLabel ? `Undo: ${props.history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
              disabled={props.history.busy || props.history.undoLabel === null}
              onClick={props.history.onUndo}
              testId="undo"
            >
              <span aria-hidden>↶</span>
              <span className="hidden sm:inline">Undo</span>
            </Btn>
            <Btn
              title={props.history.redoLabel ? `Redo: ${props.history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
              disabled={props.history.busy || props.history.redoLabel === null}
              onClick={props.history.onRedo}
              testId="redo"
            >
              <span aria-hidden>↷</span>
              <span className="hidden sm:inline">Redo</span>
            </Btn>
          </>
        )}
      </div>
      <p className="mono-label hidden px-1 text-faint sm:block" data-testid="tool-hint">
        {TOOL_HINTS[props.tool]}
      </p>
    </div>
  );
}

export interface ViewControlsProps {
  isGm: boolean;
  snapEnabled: boolean;
  gmPanelOpen: boolean;
  /** The GM's own view of the map — see `ViewProjection`. */
  viewProjection?: ViewProjection;
  /** What the scene is saved as, i.e. what the table sees. */
  sceneProjection?: GridProjection;
  onView?: (view: ViewProjection) => void;
  onToggleSnap: () => void;
  onToggleGmPanel: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}

/** Snap, zoom, fit, Plan/Iso and the panel toggle: how the map is looked at, not what is done to it. */
export function ViewControls(props: ViewControlsProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-edge bg-panel/92 p-1 backdrop-blur"
      role="group"
      aria-label="View"
    >
      <Btn
        active={props.snapEnabled}
        title="Grid snap on drop (hold Shift to bypass for one drag)"
        onClick={props.onToggleSnap}
      >
        <span aria-hidden>⌗</span>
      </Btn>
      <Btn title="Zoom in" onClick={() => props.onZoom(1.25)}>
        +
      </Btn>
      <Btn title="Zoom out" onClick={() => props.onZoom(0.8)}>
        −
      </Btn>
      <Btn title="Fit the whole scene" onClick={props.onFit}>
        <span aria-hidden>⤢</span>
      </Btn>

      {props.isGm && (
        <>
          <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
          {/*
            The map builder's two views, one click apart. Plan is where rooms
            are laid out — a rectangle is a rectangle — and isometric is what
            the table is shown. This is the GM's OWN view: flipping it never
            touches the scene, so the table does not flip mid-session. What
            the table sees is set in Setup ▸ View.
          */}
          {props.onView && (
            <ViewToggle
              view={props.viewProjection ?? 'scene'}
              sceneProjection={props.sceneProjection ?? 'topdown'}
              onView={props.onView}
            />
          )}
          <Btn active={props.gmPanelOpen} title="GM authoring panel" onClick={props.onToggleGmPanel}>
            <span aria-hidden>▤</span>
          </Btn>
        </>
      )}
    </div>
  );
}

/** Plan / Iso, showing which one the table is on. */
function ViewToggle({
  view,
  sceneProjection,
  onView,
}: {
  view: ViewProjection;
  sceneProjection: GridProjection;
  onView: (view: ViewProjection) => void;
}) {
  const effective: GridProjection = view === 'scene' ? sceneProjection : view;
  const choices: Array<{ id: GridProjection; label: string }> = [
    { id: 'topdown', label: 'Plan' },
    { id: 'iso', label: 'Iso' },
  ];
  return (
    <div
      role="group"
      aria-label="Your view of the map"
      className="flex items-center gap-1"
      data-testid="view-toggle"
    >
      {choices.map((c) => {
        const tableSees = c.id === sceneProjection;
        return (
          <Btn
            key={c.id}
            active={effective === c.id}
            title={
              tableSees
                ? `${c.label} view — what the table sees`
                : `${c.label} view on this screen only; the table stays on ${sceneProjection === 'iso' ? 'iso' : 'plan'}`
            }
            // Picking the scene's own projection drops the override rather
            // than pinning it, so a later change in Setup ▸ View is followed.
            onClick={() => onView(c.id === sceneProjection ? 'scene' : c.id)}
          >
            <span aria-hidden>{c.id === 'iso' ? '◈' : '▦'}</span>
            <span className="hidden sm:inline">{c.label}</span>
            {tableSees && <span className="sr-only">(table)</span>}
          </Btn>
        );
      })}
    </div>
  );
}
