/**
 * Floating canvas toolbar: tool picker, snap toggle, zoom controls.
 * Phone-first — players get select/ruler/pointer only; authoring tools are GM.
 */
import type { GridProjection } from '@safehouse/contracts';
import type { GridTool, ViewProjection } from '../types.js';

interface ToolDef {
  id: GridTool;
  label: string;
  glyph: string;
  hint: string;
  gmOnly?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', glyph: '⬚', hint: 'Select / drag tokens, pan' },
  { id: 'ruler', label: 'Ruler', glyph: '📏', hint: 'Measure in metres (FR9.8)' },
  { id: 'aoe', label: 'AoE', glyph: '◎', hint: 'Place a circle template' },
  { id: 'pointer', label: 'Point', glyph: '✳', hint: 'Pointer trail for everyone' },
  { id: 'fogdef', label: 'Fog', glyph: '⬡', hint: 'Click vertices for a fog region', gmOnly: true },
  { id: 'focus', label: 'Focus', glyph: '⊕', hint: 'Pull every viewport here once', gmOnly: true },
  { id: 'wall', label: 'Wall', glyph: '▬', hint: 'Drag to draw a wall (FR9.2)', gmOnly: true },
  { id: 'door', label: 'Door', glyph: '⌷', hint: 'Drag to place a door (FR9.2)', gmOnly: true },
  { id: 'zone', label: 'Zone', glyph: '▱', hint: 'Click vertices for a named zone', gmOnly: true },
  { id: 'pin', label: 'Pin', glyph: '⚑', hint: 'Drop a map pin (FR9.3)', gmOnly: true },
  { id: 'camera', label: 'Camera', glyph: '◉', hint: 'Mount a security camera — only you see it and its cone', gmOnly: true },
];

export interface ToolbarProps {
  isGm: boolean;
  tool: GridTool;
  snapEnabled: boolean;
  gmPanelOpen: boolean;
  /** The GM's own view of the map — see `ViewProjection`. */
  viewProjection?: ViewProjection;
  /** What the scene is saved as, i.e. what the table sees. */
  sceneProjection?: GridProjection;
  onView?: (view: ViewProjection) => void;
  onTool: (tool: GridTool) => void;
  onToggleSnap: () => void;
  onToggleGmPanel: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}

function Btn({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      onClick={onClick}
      className={
        'btn px-2.5 py-1.5 text-[0.7rem] ' +
        (active ? 'border-cyan text-cyan shadow-glow-cyan' : 'text-dim')
      }
    >
      {children}
    </button>
  );
}

export default function Toolbar(props: ToolbarProps) {
  const tools = TOOLS.filter((t) => props.isGm || !t.gmOnly);
  return (
    // Positioned by the caller, not by itself. It used to place itself at the
    // canvas's top-left, and as the tool row grew it silently spread under the
    // notice stack in the top-right corner and swallowed its clicks — the
    // take-the-stairs button was on screen, correct, and unpressable.
    <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-edge bg-panel/92 p-1.5 backdrop-blur">
      {tools.map((t) => (
        <Btn key={t.id} active={props.tool === t.id} title={t.hint} onClick={() => props.onTool(t.id)}>
          <span aria-hidden>{t.glyph}</span>
          <span className="hidden sm:inline">{t.label}</span>
        </Btn>
      ))}

      <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />

      <Btn
        active={props.snapEnabled}
        title="Grid snap on drop (hold Shift to bypass for one drag)"
        onClick={props.onToggleSnap}
      >
        <span aria-hidden>⌗</span>
        <span className="hidden sm:inline">Snap</span>
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
            the table sees is set in Map ▸ View.
          */}
          {props.onView && (
            <ViewToggle
              view={props.viewProjection ?? 'scene'}
              sceneProjection={props.sceneProjection ?? 'topdown'}
              onView={props.onView}
            />
          )}
          <Btn
            active={props.gmPanelOpen}
            title="GM authoring panel"
            onClick={props.onToggleGmPanel}
          >
            <span aria-hidden>▤</span>
            <span className="hidden sm:inline">GM</span>
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
            // than pinning it, so a later change in Map ▸ View is followed.
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
