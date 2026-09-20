/**
 * The tool row: the current mode's tools, as icons.
 *
 * It sits directly under the mode row (`ModeBar`), the two of them forming
 * the Map's header — mode above, that mode's tools below it. The map itself
 * carries no toolbar: what is drawn on the canvas is the scene.
 *
 * The mode — Build · Prep · Play (docs/UX_MAP_BUILDER.md §3.1) — is not a
 * tool: it decides what this row and the panel offer at all, so it is picked
 * a row up. What is left here is only what the GM does to the map, five or
 * six of them, never fourteen. Each button is its icon alone; its name, what
 * it does and the single key that picks it (§3.3) are in the tooltip, on
 * demand, rather than written out under the row (§3.7).
 *
 * Players get select / ruler / AoE / pointer in every mode, because players
 * have no modes — for them this row is the whole header. The view controls —
 * snap, zoom, fit, Plan/Iso, the panel — are not tools and live in
 * `ViewControls`, over the canvas's top-right corner, and undo and redo are
 * in the mode row above — they are not tools either.
 */
import type { GridProjection } from '@safehouse/contracts';
import HudButton, { HudIcon } from './HudButton.js';
import type { GridTool, ViewProjection } from '../types.js';
import {
  BUILD_TOOLS,
  MODE_TOOLS,
  PLAYER_TOOLS,
  shortcutFor,
  type GridMode,
} from './modes.js';

interface ToolDef {
  id: GridTool;
  label: string;
  glyph: string;
}

const TOOL_DEFS: Record<GridTool, Omit<ToolDef, 'id'>> = {
  select: { label: 'Select', glyph: '↖' },
  ruler: { label: 'Measure', glyph: '📏' },
  aoe: { label: 'AoE', glyph: '◎' },
  pointer: { label: 'Point', glyph: '☞' },
  focus: { label: 'Focus', glyph: '⌖' },
  'tile-room': { label: 'Room', glyph: '▣' },
  'tile-area': { label: 'Area', glyph: '▭' },
  tile: { label: 'Brush', glyph: '🖌' },
  'tile-erase': { label: 'Erase', glyph: '⌫' },
  wall: { label: 'Wall line', glyph: '⟋' },
  door: { label: 'Doorway', glyph: '⌷' },
  zone: { label: 'Zone', glyph: '▱' },
  pin: { label: 'Pin', glyph: '⚑' },
  fogdef: { label: 'Fog', glyph: '⬡' },
  camera: { label: 'Camera', glyph: '◉' },
  note: { label: 'Note', glyph: '🗒' },
};

/**
 * The tooltip: the tool's name and the key that picks it, and nothing more.
 *
 * It used to carry a sentence of explanation as well, which made hovering a
 * row of icons a reading exercise. A name is what the icon is missing; how
 * the tool works is learnt by using it.
 *
 * It is the `aria-label` too — what a screen reader reads out, and what a
 * test asks for by name.
 */
export function toolTitle(tool: GridTool): string {
  const { label } = TOOL_DEFS[tool];
  const key = shortcutFor(tool);
  return key ? `${label} (${key})` : label;
}

export interface ToolbarProps {
  isGm: boolean;
  /** Which mode's tools to show; the mode itself is switched in `ModeBar`. */
  mode: GridMode;
  tool: GridTool;
  onTool: (tool: GridTool) => void;
  /**
   * Build mode's first step — what is being placed, each subject carrying the
   * tile it will lay. Supplied by the page rather than built here, because it
   * reads the tileset catalogue and the store while this row stays a pure
   * render of its props. Absent for a player, and in Prep and Play.
   */
  placing?: React.ReactNode;
}

/** A labelled run of tool buttons. The label is for a screen reader; the eye gets the gap. */
function ToolGroup({
  label,
  tools,
  tool,
  onTool,
}: {
  label: string;
  tools: readonly GridTool[];
  tool: GridTool;
  onTool: (tool: GridTool) => void;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      {tools.map((id) => (
        <HudButton
          key={id}
          active={tool === id}
          title={toolTitle(id)}
          onClick={() => onTool(id)}
          testId={`tool-${id}`}
        >
          {/* Icon alone — the name and what it does are in the tooltip. */}
          <HudIcon>{TOOL_DEFS[id].glyph}</HudIcon>
        </HudButton>
      ))}
    </div>
  );
}

/** The one break in the row, between what goes on the map and what puts it there. */
function Divider() {
  return <span className="mx-2.5 h-7 w-px shrink-0 bg-edge-bright" aria-hidden />;
}

export default function Toolbar(props: ToolbarProps) {
  /*
    Build mode reads left to right as the sentence does (hud/subjects.ts):

      select · erase   |   what am I placing (and which one)   |   how do I put it down

    Select and Erase first and apart — one stops building and picks things
    up, the other takes things off — then the two halves of building: the
    subjects are what goes on the map, the tools are what does the putting. Prep and Play ask only the last
    question, so they keep one run of tools after Select, and so does a
    player.
  */
  const build = props.isGm && props.mode === 'build';
  /*
    Select, and in Build mode Erase, lead the row apart from everything else:
    one puts the tools down and the other takes things off the map, and
    neither is an answer to "what am I placing". Among the tools they read as
    two more of them.
  */
  const lead: readonly GridTool[] = build ? ['select', 'tile-erase'] : ['select'];
  const rest = (props.isGm ? MODE_TOOLS[props.mode] : PLAYER_TOOLS).filter(
    (t) => !lead.includes(t),
  );
  return (
    // A row in the header, not a card floating on the canvas. It used to sit
    // at the canvas's top-left, and as the tool row grew it spread under the
    // notice stack in the top-right corner and swallowed its clicks — the
    // take-the-stairs button was on screen, correct, and unpressable. Docked
    // under the mode row it has the whole width, overlaps nothing, and the
    // map underneath is never covered by its own controls.
    <div className="flex w-full min-w-0 border-b border-edge bg-panel px-3 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ToolGroup
          label={build ? 'Select and erase' : 'Select'}
          tools={lead}
          tool={props.tool}
          onTool={props.onTool}
        />
        <Divider />
        {build ? (
          <>
            {props.placing}
            <Divider />
            <ToolGroup label="Tools" tools={BUILD_TOOLS} tool={props.tool} onTool={props.onTool} />
          </>
        ) : (
          <ToolGroup label="Tools" tools={rest} tool={props.tool} onTool={props.onTool} />
        )}
      </div>
    </div>
  );
}

export interface ViewControlsProps {
  isGm: boolean;
  snapEnabled: boolean;
  gmPanelOpen: boolean;
  /** This screen's own view of the map — see `ViewProjection`. */
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
      <HudButton
        active={props.snapEnabled}
        title="Snap to grid"
        onClick={props.onToggleSnap}
      >
        <span aria-hidden>⌗</span>
      </HudButton>
      <HudButton title="Zoom in" onClick={() => props.onZoom(1.25)}>
        +
      </HudButton>
      <HudButton title="Zoom out" onClick={() => props.onZoom(0.8)}>
        −
      </HudButton>
      <HudButton title="Fit" onClick={props.onFit}>
        <span aria-hidden>⤢</span>
      </HudButton>

      {/*
        Plan or isometric, one click apart, for anyone at the table. It is
        this screen's OWN view: flipping it never touches the scene, so the
        GM laying rooms out in plan does not flip a player's phone, and a
        player who prefers plan does not flip anyone else. The scene's
        default is set in Setup ▸ View.
      */}
      {props.onView && (
        <>
          <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
          <ViewToggle
            view={props.viewProjection ?? 'scene'}
            sceneProjection={props.sceneProjection ?? 'topdown'}
            onView={props.onView}
          />
        </>
      )}
      {props.isGm && (
        <>
          <HudButton active={props.gmPanelOpen} title="Panel" onClick={props.onToggleGmPanel}>
            <span aria-hidden>▤</span>
          </HudButton>
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
          <HudButton
            key={c.id}
            active={effective === c.id}
            title={tableSees ? `${c.label} (table)` : `${c.label} (this screen)`}
            // Picking the scene's own projection drops the override rather
            // than pinning it, so a later change in Setup ▸ View is followed.
            onClick={() => onView(c.id === sceneProjection ? 'scene' : c.id)}
          >
            <span aria-hidden>{c.id === 'iso' ? '◈' : '▦'}</span>
            <span className="hidden sm:inline">{c.label}</span>
            {tableSees && <span className="sr-only">(table)</span>}
          </HudButton>
        );
      })}
    </div>
  );
}
