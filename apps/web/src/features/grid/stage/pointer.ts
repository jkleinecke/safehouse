/**
 * Pointer/wheel state machine for the scene canvas: pan, wheel + pinch zoom,
 * token drag with grid snap, ruler drag, ping double-tap, pointer trail, and
 * the single-click tools (AoE, fog vertex, focus, door toggle).
 *
 * All handling lives on the DOM — the renderer's own event handling is never
 * engaged (pixi's interaction tree on the 2D map was not either), so there
 * are no hit-area rebuilds and no per-frame event allocs.
 *
 * Renderer-neutral: the screen is reached only through the host's
 * `ViewCamera` (pick, project, pxPerUnit, pan, zoom), and everything handed
 * back to the host is in grid units, so the same controller drove the 2D map
 * and drives the 3D one — and, in the tests, a host with the flat `Camera`
 * (`camera.ts`).
 */
import type { Point, Token } from '@safehouse/contracts';
import { bulgeThrough } from '@safehouse/rules';
import {
  isDegenerateSegment,
  metersBetween,
  snapCenter,
  snapVertex,
  type SceneMetrics,
} from '../geometry.js';
import { pointInPolygon } from '../geometry.js';
import type { ContextTarget, StageCallbacks, StageSceneState, TileRectMode } from '../types.js';
import { wheelZoomFactor } from './camera.js';
import {
  hitCamera,
  hitLight,
  hitDoor,
  hitNote,
  hitPin,
  hitTileDoor,
  hitToken,
  hitWall,
  isDoubleTap,
  screenHitSlop,
  screenTolerance,
  type TapRecord,
} from './hit.js';
import type { ViewCamera } from './viewCamera.js';
import {
  applyEdit,
  handlesOf,
  objectForSelection,
  paintedId,
  pickPainted,
  type EditOp,
  type EditResult,
  type PaintedObject,
} from '../paintedObjects.js';
import { allCells, containsCell, moveSelection, pastedSet, pasteBodies, tilesetOf } from '../cellSelection.js';
import { walkDragTarget } from './walkDrag.js';

type Mode =
  | 'idle'
  | 'pan'
  | 'token'
  | 'ruler'
  | 'trail'
  | 'pinch'
  | 'segment'
  | 'painting'
  | 'rect'
  | 'painted'
  | 'marquee'
  | 'group'
  // An arc wall: dragging its ends, then (no button held) pulling its bulge.
  | 'arc'
  | 'bend';

/** React-facing ruler updates are rate-limited; the line on the map is not. */
const RULER_REPORT_MS = 50;


export interface PointerHost {
  /** The view the pointer is resolved through: screen ↔ grid, and pan/zoom. */
  readonly camera: ViewCamera;
  metrics(): SceneMetrics;
  state(): StageSceneState;
  readonly callbacks: StageCallbacks;
  /** Drive one token's view straight from the pointer (no lerp), at `grid` (grid units). */
  localDrag(tokenId: string | null, grid: Point | null): void;
  /** Local echo so the actor sees their own ping/trail without a round trip (grid units). */
  echoPing(grid: Point): void;
  echoTrail(grid: Point): void;
  drawRuler(from: Point, to: Point, meters: number): void;
  clearRuler(): void;
  /** Rubber band while drawing a wall/door (optional — the TV never draws). */
  drawSegment?(kind: 'wall' | 'door', from: Point, to: Point): void;
  clearSegment?(): void;
  /** The arc wall being placed (rules: arcs.ts). */
  drawArc?(a: Point, b: Point, bulge: number): void;
  clearArc?(): void;
  /** The cell rectangle a room/area drag is about to fill (FR9.2). */
  drawRect?(mode: TileRectMode, from: Cell, to: Cell): void;
  clearRect?(): void;
  /**
   * Where a painted object will land while it is being dragged or pasted
   * (Build) — and, for a renderer that stands the ghost up, what the drag or
   * paste will paint there (`fill`), so each square's ghost is as tall as
   * what is on its way to it. The 2D map drew the squares alone.
   */
  drawPaintedGhost?(cells: readonly string[] | null, fill?: readonly GhostFill[]): void;
  /**
   * The token whose drawn body is under host point `screen`, when the
   * renderer can tell from what it drew — the 3D map raycasts its figures, so
   * a press on a runner's head takes the runner however tall it stands and
   * from whatever angle. Asked before the disc test (`hitToken`), which stays
   * the fallback. Absent on a flat host (the 2D map was one), where the disc
   * IS what is drawn.
   */
  pickToken?(screen: Point): string | null;
  /**
   * The painted door (its `"col,row"` cell) whose drawn, shut leaf is the
   * first thing standing under host point `screen` on the floor in view, when
   * the renderer can tell from what it drew — never a leaf behind a wall in
   * front of it. The 3D map raycasts its leaves with everything else standing
   * there: a leaf stands a storey tall, so in its iso view most of it covers
   * the squares behind its own, and the floor point under a press on it is
   * rarely its cell. Asked
   * before the cell test (`hitTileDoor`), which stays the fallback (an open
   * door has no leaf; its doorway is its cell). Absent on a flat host (the
   * 2D map was one).
   */
  pickTileDoor?(screen: Point): string | null;
  /**
   * The square of the thing whose drawn body is the first standing under
   * host point `screen` on the floor in view — a wall, an opening, a prop,
   * stairs, or a traced wall or door (`pickTraced` says when it is one) —
   * when the renderer can tell from what it drew; null where the floor
   * itself shows there. The 3D map raycasts its world: in its iso view a wall
   * a storey tall covers the squares behind its own, so the floor point under
   * a press on its upper half is a square or two behind it. Asked where a
   * press picks a THING by its square (a painted object in Build, a painted
   * door, the context menu's target), never where it marks a place on the
   * floor (painting, a rectangle's corner, where a token or a pin goes, how
   * far a drag has come), which stays the floor point — and asked whether
   * anything stands in front of that floor point at all: what lies on the
   * floor behind a wall (a note, a traced line's foot) is hidden there, and
   * not what the press is on. Absent on a flat host (the 2D map was one),
   * where the square under the pointer IS what is drawn there.
   */
  pickCell?(screen: Point): Cell | null;
  /**
   * The GM's traced wall or door (`scene.geometry.walls`, `doors`) whose
   * drawn body is the first standing under host point `screen`, when the
   * renderer stands them up: the 3D map raycasts them with everything else
   * standing there, so a press on a wall's face or a door's leaf takes it,
   * where the line test (`hitDoor`, `hitWall`) measures from the line on the
   * floor at its foot — and a press on a painted wall in front of one does
   * not. Asked before the line test, which stays the fallback where nothing
   * stands. Absent on a flat host (the 2D map was one), where the line IS
   * what is drawn.
   */
  pickTraced?(screen: Point): { kind: 'wall' | 'door'; id: string } | null;
  /**
   * Whether the GM's light markers are drawn over the tokens: the 3D map
   * hangs each at its lamp's height, over everything, so a press on one is
   * the light's before it is the token's under it. Absent (a flat host, as
   * the 2D map was) they lie under the tokens, and a token standing on a lamp takes the press.
   */
  readonly lightsOverTokens?: boolean;
}

/**
 * What a paint ghost's squares will hold (`PointerHost.drawPaintedGhost`):
 * stored slots by `"col,row"`, in the tileset they are painted in.
 */
export interface GhostFill {
  tilesetId: string;
  slots: Readonly<Record<string, string>>;
}

interface ActivePointer {
  id: number;
  x: number;
  y: number;
}

/** A grid cell, as integer column/row. */
export interface Cell {
  col: number;
  row: number;
}

/**
 * Every cell on the straight line from `from` to `to`, EXCLUDING `from` and
 * including `to`.
 *
 * Integer Bresenham, so a diagonal drag yields a connected 8-way line rather
 * than a staircase with holes in it. `from` is excluded because the caller has
 * already painted it — the previous sample of the same stroke.
 */
export function cellsBetween(from: Cell, to: Cell): Cell[] {
  const out: Cell[] = [];
  let { col, row } = from;
  const dx = Math.abs(to.col - col);
  const dy = -Math.abs(to.row - row);
  const sx = col < to.col ? 1 : -1;
  const sy = row < to.row ? 1 : -1;
  let err = dx + dy;
  // Bounded by construction — every step moves col or row at least one toward
  // the target — but a guard costs nothing and a runaway loop here would hang
  // the canvas on a bad coordinate.
  for (let guard = dx - dy + 2; guard > 0; guard -= 1) {
    if (col === to.col && row === to.row) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      col += sx;
    }
    if (e2 <= dx) {
      err += dx;
      row += sy;
    }
    out.push({ col, row });
  }
  return out;
}

/** A touch held still this long is a right-click (the map's context menu). */
const LONG_PRESS_MS = 500;

export class PointerController {
  /** The arc wall being placed: its ends, and how far its middle stands off the line between them. */
  private arcA: Point = { x: 0, y: 0 };
  private arcB: Point = { x: 0, y: 0 };
  private arcBulge = 0;
  private mode: Mode = 'idle';
  /** Cells already sent this stroke, so a wandering drag sends each once. */
  private readonly painted = new Set<string>();
  private paintErase = false;
  /**
   * The stroke is the fog brush's, not the tiles' (Prep): its squares go to
   * `onFogBrush`, and the squares it has crossed are shown as a flat ghost
   * (`drawPaintedGhost`) until it ends, since nothing on the map changes
   * until the server has the whole stroke.
   */
  private paintFog = false;
  private fogStroke: string[] = [];
  /** Last cell this stroke touched, so the gap to the next sample can be filled. */
  private lastCell: { col: number; row: number } | null = null;
  private readonly pointers = new Map<number, ActivePointer>();
  private rect: DOMRect | null = null;
  private lastTap: TapRecord | null = null;
  /**
   * Whether the last tap landed on a token. A double-tap is a ping only when
   * neither tap did: a player's second try at their own runner is a select,
   * not a flash for the whole table (B6).
   */
  private lastTapOnToken = false;
  /** 'mouse' | 'pen' | 'touch' of the pointer that started the gesture. */
  private pointerType: string | undefined;
  private moved = false;
  /** Shift was held at the press — Shift+click toggles a painted object. */
  private shiftDown = false;
  /** The gesture began with the right button: a still release opens the menu. */
  private rightButton = false;
  /** A finger held still this long opens the menu too — phones have no right button. */
  private longPress: ReturnType<typeof setTimeout> | null = null;

  // token drag
  private dragTokenId: string | null = null;
  private dragGrab: Point = { x: 0, y: 0 };
  private dragSize = 1;
  /** The floor the dragged token stands on: the one its walk is judged on (`walkDragTarget`). */
  private dragLevel = 0;
  /** Where the dragged token stood when the drag began: where the server walks its drop from. */
  private dragOrigin: Point = { x: 0, y: 0 };
  private dragAt: Point = { x: 0, y: 0 };

  // ruler
  private rulerFrom: Point = { x: 0, y: 0 };
  private rulerTokenId: string | null = null;
  private rulerReportedAt = 0;

  // wall/door authoring (FR9.2)
  private segmentKind: 'wall' | 'door' = 'wall';
  private segmentFrom: Point = { x: 0, y: 0 };
  private segmentTo: Point = { x: 0, y: 0 };

  // a painted wall, door or prop being dragged (Build) — nothing is sent
  // until release, so a GM who changes their mind mid-drag has changed nothing
  private paintedObj: PaintedObject | null = null;
  private paintedOp: EditOp = { kind: 'move' };
  private paintedFrom: Cell = { col: 0, row: 0 };
  private paintedResult: EditResult | null = null;

  // a box being dragged on open floor, and a multi-selection being moved
  // (Build) — both in whole squares
  private boxFrom: Cell = { col: 0, row: 0 };
  private boxTo: Cell = { col: 0, row: 0 };
  private groupDelta: Cell = { col: 0, row: 0 };

  // room/area rectangle (FR9.2) — in CELLS, not grid units: a rectangle of
  // tiles is a set of whole squares, and snapping happens at the corner the
  // GM pressed rather than wherever the pointer ends up inside the last one.
  private rectMode: TileRectMode = 'area';
  private rectFrom: Cell = { col: 0, row: 0 };
  private rectTo: Cell = { col: 0, row: 0 };

  // pinch
  private pinchDist = 0;

  private readonly onDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onUp = (e: PointerEvent) => this.handleUp(e);
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onContext = (e: Event) => e.preventDefault();

  constructor(
    private readonly el: HTMLElement,
    private readonly host: PointerHost,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('pointerleave', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('pointerleave', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
    this.cancelLongPress();
    this.pointers.clear();
  }

  invalidateRect(): void {
    this.rect = null;
  }

  // -------------------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): Point {
    if (!this.rect) this.rect = this.el.getBoundingClientRect();
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }

  /**
   * Send the cells of a paint stroke (FR9.2), joining consecutive samples.
   *
   * Pointer moves do NOT arrive one per cell. A quick drag, a coarse device, a
   * browser coalescing moves into one event — any of them puts the next sample
   * several cells from the last, and painting only where the samples landed
   * draws a dotted line. Observed live: one horizontal drag laid down columns
   * 4, 6 and 8 and left 5 and 7 bare, which reads as a broken tool rather than
   * a fast hand.
   *
   * So the gap between two samples is walked and filled. Cells already covered
   * by this stroke are skipped, so dragging back over your own line is still
   * free rather than a second request.
   */
  private paintCell(grid: Point): void {
    const col = Math.floor(grid.x);
    const row = Math.floor(grid.y);
    const from = this.lastCell;
    this.lastCell = { col, row };
    if (from === null) {
      this.emitCell(col, row);
      return;
    }
    for (const cell of cellsBetween(from, { col, row })) this.emitCell(cell.col, cell.row);
  }

  /** One cell, at most once per stroke. */
  private emitCell(col: number, row: number): void {
    const key = `${col},${row}`;
    if (this.painted.has(key)) return;
    this.painted.add(key);
    if (this.paintFog) {
      this.fogStroke.push(key);
      this.host.drawPaintedGhost?.(this.fogStroke);
      this.host.callbacks.onFogBrush?.(col, row);
      return;
    }
    this.host.callbacks.onTilePaint?.(col, row, this.paintErase);
  }

  /**
   * The stroke is over — button up, gesture abandoned, or a second finger
   * arriving. React coalesces a stroke into one request, and until this existed
   * it had no idea when one ended: the buffer drained on a 140ms idle timer, so
   * a stroke with a pause in it became several full-layer writes and the last
   * cell of every stroke sat unsent after the GM had already let go.
   */
  private endStroke(): void {
    this.painted.clear();
    this.lastCell = null;
    if (this.paintFog) {
      this.paintFog = false;
      this.fogStroke = [];
      this.host.drawPaintedGhost?.(null);
      this.host.callbacks.onFogBrushEnd?.();
      return;
    }
    this.host.callbacks.onTileStrokeEnd?.();
  }

  /**
   * The grid point on the floor in view under a screen point, or null where
   * the view shows no floor (a 3D camera's sky). Every caller guards.
   */
  private toGrid(screen: Point): Point | null {
    return this.host.camera.pick(screen);
  }

  /** A click tolerance of `screenPx` screen px (world-px floored), at `at`. */
  private tolerance(screenPx: number, at: Point): number {
    return screenTolerance(this.host.camera, this.host.metrics(), screenPx, at);
  }

  /** The token slop for a pointer of type `pointerType`, in screen px. */
  private hitSlop(pointerType: string | undefined, at: Point): number {
    return screenHitSlop(this.host.camera, this.host.metrics(), pointerType, at);
  }

  /**
   * The token under the pointer: the one the renderer says its drawn body is
   * under `screen` (`PointerHost.pickToken`), else the topmost disc around
   * `grid` (`hitToken`, with `minHitPx` of slop when given).
   */
  private tokenAt(screen: Point, grid: Point, minHitPx?: number): Token | null {
    const state = this.host.state();
    const picked = this.host.pickToken?.(screen) ?? null;
    if (picked !== null) {
      const token = state.tokens.find((t) => t.id === picked);
      if (token) return token;
    }
    return hitToken(
      this.host.camera,
      this.host.metrics(),
      state.tokens,
      grid,
      minHitPx === undefined ? {} : { minHitPx },
    );
  }

  /**
   * The painted door under the pointer on floor `level`: the one whose leaf
   * the renderer says is under `screen` (`PointerHost.pickTileDoor`), as
   * long as the scene still has a door painted there, else the door painted
   * in the cell of the thing under `screen` (`thingCell`: a door frame's
   * lintel, never the door behind a tall wall), else in the cell under
   * `grid` (`hitTileDoor`).
   */
  private tileDoorAt(screen: Point, grid: Point, level: number): string | null {
    const scene = this.host.state().scene;
    const leaf = this.host.pickTileDoor?.(screen) ?? null;
    if (leaf !== null) {
      const [col, row] = leaf.split(',').map(Number);
      if (col !== undefined && row !== undefined && Number.isFinite(col) && Number.isFinite(row)) {
        const cell = hitTileDoor(scene, { x: col + 0.5, y: row + 0.5 }, level);
        if (cell !== null) return cell;
      }
    }
    const at = this.thingCell(screen, grid);
    if (at === null) return null;
    return hitTileDoor(scene, { x: at.col + 0.5, y: at.row + 0.5 }, level);
  }

  /**
   * The cell a press at `screen` means when it picks a painted thing by its
   * square: the square of whatever the renderer drew standing there
   * (`PointerHost.pickCell`), else the square under the floor point `grid`.
   * Null when what stands there is a traced wall or door (`pickTraced`): no
   * painted thing is under the press then, whatever stands behind it or at
   * its foot. Only for picking: where a drag starts or ends is always
   * `cellAt(grid)`, so it moves by what the pointer moved across the floor.
   */
  private thingCell(screen: Point, grid: Point): Cell | null {
    if ((this.host.pickTraced?.(screen) ?? null) !== null) return null;
    return this.host.pickCell?.(screen) ?? this.cellAt(grid);
  }

  /**
   * Whether the renderer drew something standing under `screen` in front of
   * the floor point under it (`PointerHost.pickCell`): a painted wall, a
   * prop, a door's leaf, a traced wall. What lies on the floor behind it — a
   * note, a traced line's foot — is hidden there, and is not what the press
   * is on. Never on a flat host (the 2D map was one), where nothing stands.
   */
  private standsInFront(screen: Point): boolean {
    return (this.host.pickCell?.(screen) ?? null) !== null;
  }

  /**
   * The traced door under the pointer: the one whose standing leaf or lintel
   * the renderer says is under `screen` (`PointerHost.pickTraced`), else the
   * one whose line passes within `tol` screen px of `grid` (`hitDoor`) where
   * nothing else stands in front of that point. A traced wall standing
   * there, or a painted one, is what the press lands on: no door, then.
   */
  private doorAt(screen: Point, grid: Point, tol: number): string | null {
    const scene = this.host.state().scene;
    const picked = this.host.pickTraced?.(screen) ?? null;
    if (picked?.kind === 'door' && scene.geometry.doors.some((d) => d.id === picked.id)) return picked.id;
    if (picked?.kind === 'wall' || this.standsInFront(screen)) return null;
    return hitDoor(this.host.camera, this.host.metrics(), scene, grid, tol);
  }

  /** The traced wall under the pointer, as `doorAt` finds a door: a standing door there, or a painted thing, is no wall. */
  private wallAt(screen: Point, grid: Point, tol: number): string | null {
    const scene = this.host.state().scene;
    const picked = this.host.pickTraced?.(screen) ?? null;
    if (picked?.kind === 'wall' && scene.geometry.walls.some((w) => w.id === picked.id)) return picked.id;
    if (picked?.kind === 'door' || this.standsInFront(screen)) return null;
    return hitWall(this.host.camera, this.host.metrics(), scene, grid, tol);
  }

  /** A GM light's marker under `grid` (the GM's own lamps, on this floor), selected: true when there was one. */
  private selectLight(grid: Point, state: StageSceneState, m: SceneMetrics): boolean {
    if (state.role !== 'gm' || !this.host.callbacks.onLightSelect) return false;
    const lightTol = this.tolerance(14, grid);
    const lightId = hitLight(this.host.camera, m, state.scene, grid, state.level ?? 0, lightTol);
    if (!lightId) return false;
    this.mode = 'idle';
    this.host.callbacks.onLightSelect(lightId);
    return true;
  }

  private snapped(p: Point, size: number, raw: boolean): Point {
    if (raw || !this.host.state().snapEnabled) return p;
    return snapCenter(p, size);
  }

  // -------------------------------------------------------------------------

  private handleDown(e: PointerEvent): void {
    const screen = this.local(e);
    this.pointers.set(e.pointerId, { id: e.pointerId, x: screen.x, y: screen.y });
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // capture unsupported (synthetic events in tests)
    }

    if (this.pointers.size === 2) {
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    this.moved = false;
    this.shiftDown = e.shiftKey;
    const state = this.host.state();
    const m = this.host.metrics();
    const grid = this.toGrid(screen);
    this.pointerType = e.pointerType;
    this.rightButton = e.button === 2;
    this.cancelLongPress();
    // A finger held still for half a second is the phone's right-click. It
    // is armed on every touch down and disarmed by the first real movement,
    // so a drag or a pan never opens it.
    if (e.pointerType === 'touch' && e.button === 0 && this.host.callbacks.onContextMenu) {
      this.longPress = setTimeout(() => {
        this.longPress = null;
        if (this.moved || this.pointers.size !== 1) return;
        // The press became a menu: whatever it started is let go, as a
        // second finger lets it go — above all a token drag, whose renderer
        // would otherwise go on holding that token where the press found it.
        this.abandonGesture();
        this.mode = 'idle';
        this.host.clearRuler?.();
        const under = this.toGrid(screen);
        if (under) this.openContextMenu(screen, under);
      }, LONG_PRESS_MS);
    }

    // Double-tap on empty floor flashes a ping for everyone (FR9.15). On a
    // token it is two taps at a token — the second one selects like the first,
    // because on a phone the second tap is usually the player trying again.
    const tap: TapRecord = { x: screen.x, y: screen.y, t: e.timeStamp || Date.now() };
    const onToken = grid !== null && this.tokenAt(screen, grid, this.hitSlop(e.pointerType, grid)) !== null;
    if (grid && isDoubleTap(this.lastTap, tap) && !onToken && !this.lastTapOnToken) {
      this.lastTap = null;
      this.lastTapOnToken = false;
      this.mode = 'idle';
      this.host.echoPing(grid);
      this.host.callbacks.onPing(grid.x, grid.y);
      return;
    }
    this.lastTap = tap;
    this.lastTapOnToken = onToken;

    // An arc being bent: a click places it where it is; any other button
    // lets it go.
    if (this.mode === 'bend') {
      this.host.clearArc?.();
      this.mode = 'idle';
      if (e.button === 0 && state.tool === 'arc') this.host.callbacks.onArcDraw?.(this.arcA, this.arcB, this.arcBulge);
      return;
    }

    // Middle/right button always pans, whatever tool is selected. The view
    // never turns: the GM wants a fixed angle that pans and zooms
    // (2026-09-26), on the 3D map as on the 2D one before it.
    if (e.button === 1 || e.button === 2) {
      this.mode = 'pan';
      return;
    }

    // A press where the view shows no floor (a 3D camera's sky) has nothing
    // under it to place, hit or paint: all it can do is move the view.
    if (grid === null) {
      this.mode = 'pan';
      return;
    }

    // Ctrl+V is waiting: this press says where the copy goes, whatever tool
    // is in hand — the GM asked to paste, not to use the tool.
    if (state.role === 'gm' && state.paintEdit && state.pasting) {
      this.mode = 'idle';
      this.host.drawPaintedGhost?.(null);
      this.host.callbacks.onPaste?.(this.cellAt(grid));
      return;
    }

    switch (state.tool) {
      case 'ruler':
        this.beginRuler(grid, screen);
        return;
      case 'aoe':
        this.mode = 'idle';
        this.host.callbacks.onAoePlace(grid.x, grid.y);
        return;
      case 'fogdef':
        this.mode = 'idle';
        this.host.callbacks.onFogVertex(grid.x, grid.y);
        return;
      case 'focus':
        this.mode = 'idle';
        this.host.callbacks.onFocus(grid.x, grid.y);
        return;
      case 'pointer':
        this.mode = 'trail';
        this.host.echoTrail(grid);
        this.host.callbacks.onPointer(grid.x, grid.y);
        return;
      case 'door':
        this.beginSegment(state.tool, grid, state, e.shiftKey);
        return;
      case 'token':
        this.mode = 'idle';
        this.host.callbacks.onTokenPlace?.(grid.x, grid.y);
        return;
      case 'arc':
        this.arcA = this.vertex(grid, state, e.shiftKey);
        this.arcB = this.arcA;
        this.arcBulge = 0;
        this.mode = 'arc';
        this.host.drawArc?.(this.arcA, this.arcB, 0);
        return;
      case 'zone':
        // Zones and fog regions share one polygon draft (FR9.2 / FR9.14).
        this.mode = 'idle';
        this.host.callbacks.onFogVertex(grid.x, grid.y);
        return;
      case 'pin':
        this.mode = 'idle';
        this.host.callbacks.onPinPlace?.(grid.x, grid.y);
        return;
      case 'camera':
        this.mode = 'idle';
        this.host.callbacks.onCameraPlace?.(grid.x, grid.y);
        return;
      case 'light':
        this.mode = 'idle';
        this.host.callbacks.onLightPlace?.(grid.x, grid.y);
        return;
      case 'note':
        this.mode = 'idle';
        this.host.callbacks.onNotePlace?.(grid.x, grid.y);
        return;
      case 'tile-area':
      case 'tile-room': {
        // A rectangle, not a stroke: the drag picks two corners and the fill
        // happens on release. Nothing is sent until then, so a GM who changes
        // their mind mid-drag has changed nothing.
        this.mode = 'rect';
        this.rectMode = state.tool === 'tile-room' ? 'room' : 'area';
        this.rectFrom = { col: Math.floor(grid.x), row: Math.floor(grid.y) };
        this.rectTo = this.rectFrom;
        this.host.drawRect?.(this.rectMode, this.rectFrom, this.rectTo);
        return;
      }
      case 'tile':
      case 'tile-erase':
        // Painting continues while the button is held: a floor is a drag, not
        // a hundred clicks. `paintTile` de-duplicates per cell, so the stroke
        // that crosses one cell twice still sends it once.
        this.mode = 'painting';
        this.paintErase = state.tool === 'tile-erase';
        this.paintFog = false;
        this.painted.clear();
        // A new stroke has no previous cell: starting one across the map must
        // not draw a line from wherever the last one ended.
        this.lastCell = null;
        this.paintCell(grid);
        return;
      case 'fogbrush':
        // The fog brush (Prep; FR9.13's square-by-square brush) is a stroke
        // like the tile brush: every square the drag crosses, once, with the
        // gaps between samples filled. It paints the fog, not the floor, so
        // its squares go to their own callback and the stroke is sent whole
        // when it ends (`endStroke`).
        this.mode = 'painting';
        this.paintErase = false;
        this.paintFog = true;
        this.fogStroke = [];
        this.painted.clear();
        this.lastCell = null;
        this.paintCell(grid);
        return;
      default:
        this.beginSelect(grid, screen, state, m);
    }
  }

  /** Walls and doors sit on cell edges, so authoring snaps to intersections. */
  private vertex(grid: Point, state: StageSceneState, raw: boolean): Point {
    return snapVertex(grid, state.snapEnabled && !raw);
  }

  /**
   * Where the arc's middle goes: through the pointer, in half squares so a
   * curve lands on the grid it is drawn over (Shift for any amount), and dead
   * straight when the pointer is near the line between its ends.
   */
  private bendTo(grid: Point, raw: boolean): void {
    let bulge = bulgeThrough(this.arcA, this.arcB, grid);
    if (!raw) bulge = Math.round(bulge * 2) / 2;
    if (Math.abs(bulge) < 0.25) bulge = 0;
    this.arcBulge = bulge;
    this.host.drawArc?.(this.arcA, this.arcB, bulge);
  }

  private beginSegment(
    kind: 'wall' | 'door',
    grid: Point,
    state: StageSceneState,
    raw: boolean,
  ): void {
    this.segmentKind = kind;
    this.segmentFrom = this.vertex(grid, state, raw);
    this.segmentTo = this.segmentFrom;
    this.mode = 'segment';
    this.host.drawSegment?.(kind, this.segmentFrom, this.segmentTo);
  }

  private beginRuler(grid: Point, screen: Point): void {
    const token = this.tokenAt(screen, grid);
    this.rulerTokenId = token?.id ?? null;
    this.rulerFrom = token ? { x: token.x, y: token.y } : grid;
    this.mode = 'ruler';
    this.rulerReportedAt = 0;
    this.updateRuler(grid, true);
  }

  private beginSelect(grid: Point, screen: Point, state: StageSceneState, m: SceneMetrics): void {
    // A selected painted object's handles, before anything else: they are
    // small, deliberate targets on its outer edge, and a GM reaching for one
    // meant it rather than the token standing next to the wall.
    if (state.role === 'gm' && state.paintEdit && this.beginPaintedHandle(grid, state)) return;

    // No painted thing is under a press on a traced wall (`thingCell`).
    const pressed = state.role === 'gm' && state.paintEdit ? this.thingCell(screen, grid) : null;
    if (pressed !== null) {
      // Shift+click puts an object in or takes it out of the multi-selection.
      if (this.shiftDown) {
        const obj = pickPainted(state.scene, state.level ?? 0, pressed);
        if (obj) {
          this.mode = 'idle';
          this.host.callbacks.onPaintedToggle?.(paintedId(obj.layer, pressed));
          return;
        }
      }
      // A press inside the multi-selection picks the whole of it up. The
      // move is measured on the floor, from the floor square pressed.
      if (!this.shiftDown && containsCell(state.cellSelection ?? null, pressed)) {
        this.mode = 'group';
        this.boxFrom = this.cellAt(grid);
        this.groupDelta = { col: 0, row: 0 };
        return;
      }
    }

    // A pin head sits above the tokens it annotates — check it first, and only
    // for the GM (players' payloads only ever contain public pins anyway).
    if (state.role === 'gm' && this.host.callbacks.onPinSelect) {
      // 14 screen px of slop around the head, floored so a zoomed-out map does
      // not shrink the target to nothing.
      const pinTol = this.tolerance(14, grid);
      const pinId = hitPin(this.host.camera, m, state.scene, grid, pinTol);
      if (pinId) {
        this.mode = 'idle';
        this.host.callbacks.onPinSelect(pinId);
        return;
      }
    }
    // A camera's eye, likewise — the GM's own payload is the only one that
    // has cameras in it at all (FR9.23).
    if (state.role === 'gm' && this.host.callbacks.onCameraSelect) {
      const camTol = this.tolerance(14, grid);
      const cameraId = hitCamera(this.host.camera, m, state.scene, grid, camTol);
      if (cameraId) {
        this.mode = 'idle';
        this.host.callbacks.onCameraSelect(cameraId);
        return;
      }
    }

    // A light's marker, where the renderer draws it over the tokens (the 3D
    // map hangs it at its lamp's height): what is seen on top takes the press.
    const lightsFirst = this.host.lightsOverTokens === true;
    if (lightsFirst && this.selectLight(grid, state, m)) return;

    // A finger gets a bigger target than a mouse, and both grow as the map
    // zooms out (B6: a phone's default fit left tokens four pixels wide).
    const token = this.tokenAt(screen, grid, this.hitSlop(this.pointerType, grid));
    if (token) {
      this.host.callbacks.onSelectToken(token.id);
      if (state.draggableIds.has(token.id)) {
        this.mode = 'token';
        this.dragTokenId = token.id;
        this.dragSize = token.size;
        this.dragLevel = token.level ?? state.level ?? 0;
        this.dragGrab = { x: grid.x - token.x, y: grid.y - token.y };
        this.dragAt = { x: token.x, y: token.y };
        this.dragOrigin = this.dragAt;
        this.host.localDrag(token.id, this.dragAt);
      } else {
        this.mode = 'pan';
      }
      return;
    }

    // A light's marker: the GM's own lamps, on this floor. Under the tokens,
    // as the 2D map drew it — a lamp sits on a square's centre, which is
    // where a guard stands, and a click on the guard is a click on the guard.
    if (!lightsFirst && this.selectLight(grid, state, m)) return;

    // A GM note's box (FR9.25) — under the tokens, so a runner standing on
    // a note is still the runner. The GM's payload is the only one with notes.
    // It lies on the floor, where a wall or a table standing in front hides
    // it: a press there is on what hides it.
    if (state.role === 'gm' && this.host.callbacks.onNoteSelect) {
      const noteId = hitNote(this.host.camera, m, state.scene, grid);
      if (noteId && !this.standsInFront(screen)) {
        this.mode = 'idle';
        this.host.callbacks.onNoteSelect(noteId);
        return;
      }
    }

    // A click near a door's knob opens or shuts it (FR9.2, FR9.24): the GM's
    // hand or a player's. The server knows the lock and says no to a player
    // at a locked one; a painted door is its whole cell.
    if (state.role === 'gm' || state.role === 'player') {
      const tol = this.tolerance(12, grid);
      const doorId = this.doorAt(screen, grid, tol);
      if (doorId) {
        this.mode = 'idle';
        this.host.callbacks.onDoorToggle(doorId);
        return;
      }
      const level = state.level ?? 0;
      // While building, a painted door is a thing to pick up and stretch,
      // not a door to walk through — so it is left to the painted-object
      // check below rather than opened.
      const cell = state.paintEdit ? null : this.tileDoorAt(screen, grid, level);
      if (cell && this.host.callbacks.onTileDoorToggle) {
        this.mode = 'idle';
        this.host.callbacks.onTileDoorToggle(cell, level);
        return;
      }
    }

    // A wall, for the GM's inspector (docs/UX_MAP_BUILDER.md §3.2). After the
    // doors: a door's knob sits on the same line as the walls either side of
    // it, and the knob is the smaller target.
    if (state.role === 'gm' && this.host.callbacks.onWallSelect) {
      const wallId = this.wallAt(screen, grid, this.tolerance(12, grid));
      if (wallId) {
        this.mode = 'idle';
        this.host.callbacks.onWallSelect(wallId);
        return;
      }
    }
    // A painted wall, door or piece of furniture (Build). Last, because it is
    // a whole square: every thinner target above it had to miss first.
    if (state.role === 'gm' && state.paintEdit && this.beginPaintedBody(grid, screen, state)) return;
    // Open floor while building: a drag draws a selection box. Right- and
    // middle-drag still pan, and a click without a drag still clears.
    if (state.role === 'gm' && state.paintEdit) {
      this.mode = 'marquee';
      this.boxFrom = this.cellAt(grid);
      this.boxTo = this.boxFrom;
      return;
    }
    this.mode = 'pan';
  }

  /** The cell a grid point falls in. */
  private cellAt(grid: Point): Cell {
    return { col: Math.floor(grid.x), row: Math.floor(grid.y) };
  }

  /** Grab a handle of the selected painted object, if the pointer is on one. */
  private beginPaintedHandle(grid: Point, state: StageSceneState): boolean {
    const sel = state.selection;
    if (sel?.kind !== 'painted') return false;
    const level = state.level ?? 0;
    const obj = objectForSelection(state.scene, level, sel.id);
    if (!obj) return false;
    // Measured on the screen, where the handles are drawn (on the floor).
    const tol = this.tolerance(10, grid);
    const at = this.host.camera.project(grid);
    for (const h of handlesOf(obj)) {
      const hs = this.host.camera.project(h.at);
      if (Math.hypot(hs.x - at.x, hs.y - at.y) > tol) continue;
      this.startPaintedDrag(
        obj,
        h.id === 'corner' ? { kind: 'resize' } : { kind: 'stretch', handle: h.id },
        this.cellAt(grid),
      );
      return true;
    }
    return false;
  }

  /**
   * Pick up the painted object under the pointer, if there is one: the one
   * drawn under `screen` (`thingCell`), dragged from the floor square under
   * `grid`.
   */
  private beginPaintedBody(grid: Point, screen: Point, state: StageSceneState): boolean {
    const level = state.level ?? 0;
    const cell = this.thingCell(screen, grid);
    const obj = cell === null ? null : pickPainted(state.scene, level, cell);
    if (!obj || cell === null) return false;
    this.host.callbacks.onPaintedSelect?.(paintedId(obj.layer, cell));
    // A door's body does not move — a door lives where its wall is. Its
    // handles widen it; pressing it only selects it.
    if (obj.role === 'door') {
      this.mode = 'idle';
      return true;
    }
    // The drag is measured on the floor: the moves are floor squares too.
    this.startPaintedDrag(obj, obj.role === 'wall' ? { kind: 'slide' } : { kind: 'move' }, this.cellAt(grid));
    return true;
  }

  private startPaintedDrag(obj: PaintedObject, op: EditOp, from: Cell): void {
    this.mode = 'painted';
    this.paintedObj = obj;
    this.paintedOp = op;
    this.paintedFrom = from;
    this.paintedResult = null;
  }

  /**
   * A click — not a drag — on open floor with the select tool. For the GM it
   * opens the zone under it in the inspector, or closes the inspector when
   * there is none. Decided on the way UP, because a drag that starts inside a
   * zone is a pan, and a zone can be most of the map.
   */
  private clickOnFloor(e: PointerEvent): void {
    const state = this.host.state();
    if (state.role !== 'gm' || state.tool !== 'select') return;
    const grid = this.toGrid(this.local(e));
    const zones = state.scene.geometry.zones;
    // Later zones draw on top, so the last one containing the click wins.
    // A click off the floor is a click on nothing.
    for (let i = zones.length - 1; i >= 0 && grid; i -= 1) {
      const zone = zones[i];
      if (zone && pointInPolygon(grid, zone.polygon)) {
        this.host.callbacks.onZoneSelect?.(zone.id);
        return;
      }
    }
    this.host.callbacks.onSelectClear?.();
  }

  // -------------------------------------------------------------------------

  private handleMove(e: PointerEvent): void {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked && this.mode === 'bend') {
      // No button held: the pointer pulls the arc's middle out.
      const grid = this.toGrid(this.local(e));
      if (grid) this.bendTo(grid, e.shiftKey);
      return;
    }
    if (!tracked) {
      // No button held: the only thing a hover does is carry a paste around.
      const state = this.host.state();
      if (state.role === 'gm' && state.paintEdit && state.pasting) {
        const grid = this.toGrid(this.local(e));
        if (!grid) return;
        const at = this.cellAt(grid);
        const level = state.level ?? 0;
        // What the paste will lay down, in the floor's own tileset (`pasteBodies`).
        const tilesetId = tilesetOf(state.scene, level);
        const fill =
          tilesetId === null
            ? undefined
            : pasteBodies(state.pasting, at, level, tilesetId).map((b) => ({ tilesetId: b.tilesetId, slots: b.paint }));
        this.host.drawPaintedGhost?.(allCells(pastedSet(state.pasting, at, level)), fill);
      }
      return;
    }
    const screen = this.local(e);
    const dx = screen.x - tracked.x;
    const dy = screen.y - tracked.y;
    tracked.x = screen.x;
    tracked.y = screen.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      this.moved = true;
      this.cancelLongPress();
    }

    if (this.mode === 'pinch') {
      this.updatePinch();
      return;
    }

    if (this.mode === 'pan') {
      this.host.camera.panBy(dx, dy);
      return;
    }

    // Every other gesture follows the floor point under the pointer. Where
    // the view shows no floor (a 3D camera's sky) it holds where it last was.
    const grid = this.toGrid(screen);
    if (grid === null) return;

    if (this.mode === 'painting') {
      this.paintCell(grid);
      return;
    }

    switch (this.mode) {
      case 'token':
        this.updateTokenDrag(grid, e.shiftKey);
        return;
      case 'ruler':
        this.updateRuler(grid, false);
        return;
      case 'trail': {
        this.host.echoTrail(grid);
        this.host.callbacks.onPointer(grid.x, grid.y);
        return;
      }
      case 'segment': {
        this.segmentTo = this.vertex(grid, this.host.state(), e.shiftKey);
        this.host.drawSegment?.(this.segmentKind, this.segmentFrom, this.segmentTo);
        return;
      }
      case 'arc': {
        this.arcB = this.vertex(grid, this.host.state(), e.shiftKey);
        this.host.drawArc?.(this.arcA, this.arcB, 0);
        return;
      }
      case 'rect': {
        this.rectTo = { col: Math.floor(grid.x), row: Math.floor(grid.y) };
        this.host.drawRect?.(this.rectMode, this.rectFrom, this.rectTo);
        return;
      }
      case 'marquee': {
        if (!this.moved) return;
        this.boxTo = this.cellAt(grid);
        this.host.drawRect?.('area', this.boxFrom, this.boxTo);
        return;
      }
      case 'group': {
        const sel = this.host.state().cellSelection;
        if (!sel) return;
        const at = this.cellAt(grid);
        this.groupDelta = { col: at.col - this.boxFrom.col, row: at.row - this.boxFrom.row };
        const { col, row } = this.groupDelta;
        // The ghost is what the move will paint — the stretched walls
        // included, not just the selection slid along.
        if (col === 0 && row === 0) {
          this.host.drawPaintedGhost?.(null);
          return;
        }
        const move = moveSelection(this.host.state().scene, sel, col, row);
        this.host.drawPaintedGhost?.(
          move.ghost,
          move.bodies.map((b) => ({ tilesetId: b.tilesetId, slots: b.paint })),
        );
        return;
      }
      case 'painted': {
        if (!this.paintedObj) return;
        const state = this.host.state();
        const result = applyEdit(
          state.scene,
          state.level ?? 0,
          this.paintedObj,
          this.paintedOp,
          this.paintedFrom,
          this.cellAt(grid),
        );
        this.paintedResult = result;
        if (result.noop) this.host.drawPaintedGhost?.(null);
        else {
          this.host.drawPaintedGhost?.(result.cells, [
            { tilesetId: this.paintedObj.tilesetId, slots: result.delta.paint },
          ]);
        }
        return;
      }
      default:
        return;
    }
  }

  /** The dragged rectangle with its corners put in order, clamped to the grid. */
  private rectBounds(): { c0: number; r0: number; c1: number; r1: number } | null {
    const m = this.host.metrics();
    const c0 = Math.max(0, Math.min(this.rectFrom.col, this.rectTo.col));
    const c1 = Math.min(m.cols - 1, Math.max(this.rectFrom.col, this.rectTo.col));
    const r0 = Math.max(0, Math.min(this.rectFrom.row, this.rectTo.row));
    const r1 = Math.min(m.rows - 1, Math.max(this.rectFrom.row, this.rectTo.row));
    // A drag that started and ended off the map has nothing to fill.
    if (c0 > c1 || r0 > r1) return null;
    return { c0, r0, c1, r1 };
  }

  /**
   * One frame of a token drag: the token goes where the pointer puts it,
   * snapped — unless the one dragging is not the GM and a wall is in the way
   * (the GM's rule, 2026-09-27: only the GM moves tokens through walls). Then
   * the runner walks toward the pointer from where it was last drawn and
   * stops at the wall, or at the map's edge (`walkDragTarget`), so what is
   * drawn is what the drop will send and what the server will accept.
   * Asked of the scene as it stands on this frame, so a door opened mid-drag
   * lets the runner through on the next one.
   */
  private updateTokenDrag(grid: Point, raw: boolean): void {
    if (!this.dragTokenId) return;
    const free = { x: grid.x - this.dragGrab.x, y: grid.y - this.dragGrab.y };
    const state = this.host.state();
    const at = walkDragTarget({
      role: state.role,
      scene: state.scene,
      level: this.dragLevel,
      size: this.dragSize,
      origin: this.dragOrigin,
      from: this.dragAt,
      want: this.snapped(free, this.dragSize, raw),
    });
    this.dragAt = at;
    this.host.localDrag(this.dragTokenId, at);
    this.host.callbacks.onTokenDrag(this.dragTokenId, at.x, at.y);
  }

  private updateRuler(to: Point, force: boolean): void {
    const m = this.host.metrics();
    const meters = metersBetween(m, this.rulerFrom, to);
    this.host.drawRuler(this.rulerFrom, to, meters);
    const now = Date.now();
    if (!force && now - this.rulerReportedAt < RULER_REPORT_MS) return;
    this.rulerReportedAt = now;
    this.host.callbacks.onRuler({
      from: this.rulerFrom,
      to,
      meters,
      fromTokenId: this.rulerTokenId,
    });
  }

  // -------------------------------------------------------------------------

  private handleUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (this.mode === 'pinch') {
      // Second finger lifted → fall back to a one-finger pan.
      this.mode = this.pointers.size === 1 ? 'pan' : 'idle';
      return;
    }
    if (this.pointers.size > 0) return;

    if (this.mode === 'token' && this.dragTokenId) {
      const id = this.dragTokenId;
      const at = this.dragAt;
      this.dragTokenId = null;
      this.host.localDrag(null, null);
      this.host.callbacks.onTokenMove(id, at.x, at.y);
    } else if (this.mode === 'arc') {
      // The ends are down; now the pointer pulls the middle out, and the next
      // click places it. A click that never moved is not a wall.
      if (isDegenerateSegment(this.arcA, this.arcB)) {
        this.host.clearArc?.();
      } else {
        this.mode = 'bend';
        this.host.drawArc?.(this.arcA, this.arcB, 0);
        return;
      }
    } else if (this.mode === 'segment') {
      this.host.clearSegment?.();
      // A click that never moved is not a wall — the editor stays untouched.
      if (!isDegenerateSegment(this.segmentFrom, this.segmentTo)) {
        this.host.callbacks.onSegmentDraw?.(this.segmentKind, this.segmentFrom, this.segmentTo);
      }
    } else if (this.mode === 'painting') {
      // pointerup, pointercancel and pointerleave all land here, so a stroke
      // that ends off-canvas still flushes and still returns to 'idle'.
      this.endStroke();
    } else if (this.mode === 'marquee') {
      this.host.clearRect?.();
      if (this.moved) {
        // Ctrl+Shift as the box is let go: take the floor too. Read at the
        // release, so the keys can go down mid-drag.
        this.host.callbacks.onBoxSelect?.(this.boxFrom, this.boxTo, e.ctrlKey && e.shiftKey);
      } else {
        // A click on open floor, not a box: let go of everything, as before.
        this.host.callbacks.onSelectToken(null);
        this.clickOnFloor(e);
      }
    } else if (this.mode === 'group') {
      this.host.drawPaintedGhost?.(null);
      const { col, row } = this.groupDelta;
      if (this.moved && (col !== 0 || row !== 0)) this.host.callbacks.onCellSelectionMove?.(col, row);
    } else if (this.mode === 'painted') {
      this.host.drawPaintedGhost?.(null);
      const obj = this.paintedObj;
      const result = this.paintedResult;
      this.paintedObj = null;
      this.paintedResult = null;
      // A press that never moved was a select, and it already happened.
      if (obj && result && this.moved && !result.noop) {
        this.host.callbacks.onPaintedEdit?.(
          result.delta,
          paintedId(obj.layer, result.anchor),
          obj.tilesetId,
        );
      }
    } else if (this.mode === 'rect') {
      this.host.clearRect?.();
      const b = this.rectBounds();
      // A single cell is still a fill — a click with the area tool paints
      // one square, which is what a click with any brush does.
      if (b) this.host.callbacks.onTileRect?.(b.c0, b.r0, b.c1, b.r1, this.rectMode);
    } else if (this.mode === 'pan' && !this.moved && this.rightButton) {
      // A right button pressed and released in place: the menu, about
      // whatever is under the pointer. A right-drag stayed a pan.
      this.cancelLongPress();
      const screen = this.local(e);
      const grid = this.toGrid(screen);
      if (grid) this.openContextMenu(screen, grid);
    } else if (this.mode === 'pan' && !this.moved) {
      this.host.callbacks.onSelectToken(null);
      this.clickOnFloor(e);
    }
    this.cancelLongPress();
    this.rightButton = false;
    this.mode = 'idle';
  }

  private cancelLongPress(): void {
    if (this.longPress !== null) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
  }

  /**
   * What a context menu is about, resolved the way a left-click resolves
   * its target: token first (with the pointer's own slop), then a door's
   * knob, a painted door, a wall for the GM, and otherwise the floor.
   */
  private contextTarget(screen: Point, grid: Point): ContextTarget {
    const state = this.host.state();
    const token = this.tokenAt(screen, grid, this.hitSlop(this.pointerType, grid));
    if (token) return { kind: 'token', id: token.id };
    const tol = this.tolerance(12, grid);
    const doorId = this.doorAt(screen, grid, tol);
    if (doorId) return { kind: 'door', id: doorId };
    const level = state.level ?? 0;
    const cell = this.tileDoorAt(screen, grid, level);
    if (cell) return { kind: 'tileDoor', cell, level };
    if (state.role === 'gm') {
      const wallId = this.wallAt(screen, grid, tol);
      if (wallId) return { kind: 'wall', id: wallId };
      // A painted wall's square, while building — last, because it is a
      // whole cell and every thinner target above had to miss first.
      if (state.paintEdit) {
        const c = this.thingCell(screen, grid);
        const obj = c === null ? null : pickPainted(state.scene, level, c, 'structure');
        if (c !== null && obj?.role === 'wall') return { kind: 'paintedWall', cell: `${c.col},${c.row}`, level };
      }
    }
    return { kind: 'floor' };
  }

  private openContextMenu(screen: Point, grid: Point): void {
    const open = this.host.callbacks.onContextMenu;
    if (!open) return;
    const target = this.contextTarget(screen, grid);
    // The menu is about a token: select it too, so "range from the selected
    // runner" on the next menu and the inspector both point at the same thing.
    if (target.kind === 'token') this.host.callbacks.onSelectToken(target.id);
    open({ target, grid, screen });
  }

  // -------------------------------------------------------------------------

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.abandonGesture();
    this.mode = 'pinch';
  }

  /**
   * Let go of the single-pointer gesture under way, cleanly: a second finger
   * arrived, or a held finger became the context menu. A dragged token is
   * released where it stands (no move is sent), drafts are taken away, and
   * a paint stroke is ended rather than abandoned. The caller sets the mode.
   */
  private abandonGesture(): void {
    if (this.mode === 'token' && this.dragTokenId) {
      this.host.localDrag(null, null);
      this.dragTokenId = null;
    }
    if (this.mode === 'ruler') this.host.clearRuler();
    if (this.mode === 'segment') this.host.clearSegment?.();
    if (this.mode === 'arc' || this.mode === 'bend') this.host.clearArc?.();
    // A rectangle is abandoned, not filled: unlike a stroke it has laid
    // nothing down yet, so letting go of it simply takes it away.
    if (this.mode === 'rect') this.host.clearRect?.();
    if (this.mode === 'painted' || this.mode === 'group') {
      this.host.drawPaintedGhost?.(null);
      this.paintedObj = null;
      this.paintedResult = null;
    }
    if (this.mode === 'marquee') this.host.clearRect?.();
    // A second finger ends the stroke rather than abandoning its cells: the
    // GM painted them, and pinching to zoom mid-floor is a normal thing to do.
    if (this.mode === 'painting') this.endStroke();
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.host.camera.zoomAt(mid.x, mid.y, dist / this.pinchDist);
    this.pinchDist = dist;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const screen = this.local(e);
    this.host.camera.zoomAt(screen.x, screen.y, wheelZoomFactor(e.deltaY, e.deltaMode));
  }
}
