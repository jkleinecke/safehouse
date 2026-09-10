/**
 * The build checklist (docs/UX_MAP_BUILDER.md §3.4): a strip of chips on the
 * canvas, in Build mode, that ticks itself from the scene's own data and ends
 * in the one button that matters — *activate for the table*.
 *
 * Goal-Gradient and Zeigarnik: the GM sees what is left and is pulled to
 * finish. Serial Position and Peak-End: the last item is the finish line,
 * and pressing it says so. Each step opens the tab where it is done.
 */
import type { Scene } from '@safehouse/contracts';
import type { GmTab } from '../store.js';
import { paintedCells } from './TilesTab.js';

export interface BuildStep {
  id: 'map' | 'grid' | 'walls' | 'fog';
  label: string;
  done: boolean;
  /** The tab where this step is done. */
  tab: GmTab;
  /** One line for the tooltip: what is done, or what to do. */
  hint: string;
}

/** What `ScenesTab` creates a scene with; a grid still at these has not been calibrated. */
const CREATED_GRID = { cols: 40, rows: 30, unitM: 1 };

/** The steps, ticked from the scene alone — no state of its own to get stale. */
export function buildSteps(scene: Scene): BuildStep[] {
  const images = scene.mapAttachmentIds.length > 0;
  const painted = paintedCells(scene.tiles) > 0;
  const g = scene.grid;
  const gridTouched =
    g.cols !== CREATED_GRID.cols ||
    g.rows !== CREATED_GRID.rows ||
    g.unitM !== CREATED_GRID.unitM ||
    g.offset.x !== 0 ||
    g.offset.y !== 0;
  const paintedWalls = Object.keys(scene.tiles?.structure ?? {}).length > 0;
  const walls = scene.geometry.walls.length + scene.geometry.doors.length > 0 || paintedWalls;
  const fog = scene.fog.regions.length > 0 || scene.fog.revealedShapes.length > 0;
  const map = images || painted;
  return [
    {
      id: 'map',
      label: 'Map',
      done: map,
      tab: map ? 'map' : 'tiles',
      hint: map ? 'The map is on the canvas' : 'Upload a floor plan on Map, or paint one on Tiles',
    },
    {
      id: 'grid',
      label: 'Grid',
      done: !images || gridTouched,
      tab: 'map',
      hint: !images
        ? 'No image to line up — the painted grid is the grid'
        : gridTouched
          ? 'Columns, rows and metres per square are set'
          : 'Set columns, rows and offset so the grid sits on the image',
    },
    {
      id: 'walls',
      label: 'Walls',
      done: walls,
      tab: 'geo',
      hint: walls ? 'Sight lines have something to stop them' : 'Draw walls and doors (W, D), or paint them from Building',
    },
    {
      id: 'fog',
      label: 'Fog',
      done: fog,
      tab: 'fog',
      hint: fog ? 'Players see what you reveal' : 'Define fog regions so players see only what you reveal — optional',
    },
  ];
}

export interface BuildProgressProps {
  scene: Scene;
  campaignId: string;
  activeSceneId: string | null;
  activating?: boolean;
  onStep: (tab: GmTab) => void;
  onActivate: () => void;
}

export default function BuildProgress(p: BuildProgressProps) {
  const steps = buildSteps(p.scene);
  const onTable = p.scene.id === p.activeSceneId;
  const left = steps.filter((s) => !s.done).length;
  return (
    <div
      role="group"
      aria-label="Build checklist"
      data-testid="build-progress"
      className="pointer-events-auto flex flex-wrap items-center justify-end gap-1"
    >
      {steps.map((s) => (
        <button
          key={s.id}
          type="button"
          data-step={s.id}
          data-done={s.done ? 'yes' : 'no'}
          title={s.hint}
          onClick={() => p.onStep(s.tab)}
          className={'chip bg-panel/90 ' + (s.done ? 'text-ok' : 'text-dim hover:text-ink')}
        >
          <span aria-hidden>{s.done ? '☑' : '☐'}</span> {s.label}
        </button>
      ))}
      {onTable ? (
        <>
          <span className="chip border-ok/60 bg-panel/90 text-ok" data-testid="on-table">
            ✓ on the table
          </span>
          <a
            className="chip bg-panel/90 text-cyan hover:border-cyan"
            href={`/tv/${p.campaignId}`}
            target="_blank"
            rel="noreferrer"
            title="Open the table display in another window"
          >
            TV ↗
          </a>
        </>
      ) : (
        <button
          type="button"
          data-testid="activate-scene"
          disabled={p.activating}
          onClick={p.onActivate}
          title={
            left > 0
              ? `${left} step${left === 1 ? '' : 's'} unticked — activate anyway; the table sees the scene as it is`
              : 'Push this scene to every player device and the TV'
          }
          className="chip border-cyan bg-panel/90 text-cyan hover:border-cyan disabled:opacity-50"
        >
          activate for the table →
        </button>
      )}
    </div>
  );
}
