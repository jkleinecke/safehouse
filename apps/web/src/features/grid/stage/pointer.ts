/**
 * Pointer/wheel state machine for the scene canvas: pan, wheel + pinch zoom,
 * token drag with grid snap, ruler drag, ping double-tap, pointer trail, and
 * the single-click tools (AoE, fog vertex, focus, door toggle).
 *
 * All handling lives on the DOM canvas — pixi's interaction tree is never
 * engaged, so there are no hit-area rebuilds and no per-frame event allocs.
 */
import type { Point } from '@safehouse/contracts';
import {
  gridFromWorld,
  isDegenerateSegment,
  metersBetween,
  snapCenter,
  snapVertex,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import type { StageCallbacks, StageSceneState, TileRectMode } from '../types.js';
import { Camera, wheelZoomFactor } from './camera.js';
import { hitCamera, hitDoor, hitPin, hitToken, isDoubleTap, worldTolerance, type TapRecord } from './hit.js';

type Mode =
  | 'idle'
  | 'pan'
  | 'token'
  | 'ruler'
  | 'trail'
  | 'pinch'
  | 'segment'
  | 'painting'
  | 'rect';

/** React-facing ruler updates are rate-limited; the pixi line is not. */
const RULER_REPORT_MS = 50;

export interface PointerHost {
  readonly camera: Camera;
  metrics(): SceneMetrics;
  state(): StageSceneState;
  readonly callbacks: StageCallbacks;
  /** Drive one token's view straight from the pointer (no lerp). */
  localDrag(tokenId: string | null, world: Point | null): void;
  /** Local echo so the actor sees their own ping/trail without a round trip. */
  echoPing(world: Point): void;
  echoTrail(world: Point): void;
  drawRuler(from: Point, to: Point, meters: number): void;
  clearRuler(): void;
  /** Rubber band while drawing a wall/door (optional — the TV never draws). */
  drawSegment?(kind: 'wall' | 'door', from: Point, to: Point): void;
  clearSegment?(): void;
  /** The cell rectangle a room/area drag is about to fill (FR9.2). */
  drawRect?(mode: TileRectMode, from: Cell, to: Cell): void;
  clearRect?(): void;
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

export class PointerController {
  private mode: Mode = 'idle';
  /** Cells already sent this stroke, so a wandering drag sends each once. */
  private readonly painted = new Set<string>();
  private paintErase = false;
  /** Last cell this stroke touched, so the gap to the next sample can be filled. */
  private lastCell: { col: number; row: number } | null = null;
  private readonly pointers = new Map<number, ActivePointer>();
  private rect: DOMRect | null = null;
  private lastTap: TapRecord | null = null;
  private moved = false;

  // token drag
  private dragTokenId: string | null = null;
  private dragGrab: Point = { x: 0, y: 0 };
  private dragSize = 1;
  private dragAt: Point = { x: 0, y: 0 };

  // ruler
  private rulerFrom: Point = { x: 0, y: 0 };
  private rulerTokenId: string | null = null;
  private rulerReportedAt = 0;

  // wall/door authoring (FR9.2)
  private segmentKind: 'wall' | 'door' = 'wall';
  private segmentFrom: Point = { x: 0, y: 0 };
  private segmentTo: Point = { x: 0, y: 0 };

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
    this.host.callbacks.onTileStrokeEnd?.();
  }

  private toGrid(screen: Point): Point {
    const world = this.host.camera.toWorld(screen.x, screen.y);
    return gridFromWorld(this.host.metrics(), world);
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
    const state = this.host.state();
    const m = this.host.metrics();
    const grid = this.toGrid(screen);

    // Double-tap anywhere flashes a ping for everyone (FR9.15).
    const tap: TapRecord = { x: screen.x, y: screen.y, t: e.timeStamp || Date.now() };
    if (isDoubleTap(this.lastTap, tap)) {
      this.lastTap = null;
      this.mode = 'idle';
      this.host.echoPing(worldFromGrid(m, grid));
      this.host.callbacks.onPing(grid.x, grid.y);
      return;
    }
    this.lastTap = tap;

    // Middle/right button always pans, whatever tool is selected.
    if (e.button === 1 || e.button === 2) {
      this.mode = 'pan';
      return;
    }

    switch (state.tool) {
      case 'ruler':
        this.beginRuler(grid, state, m);
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
        this.host.echoTrail(worldFromGrid(m, grid));
        this.host.callbacks.onPointer(grid.x, grid.y);
        return;
      case 'wall':
      case 'door':
        this.beginSegment(state.tool, grid, state, e.shiftKey);
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
        this.painted.clear();
        // A new stroke has no previous cell: starting one across the map must
        // not draw a line from wherever the last one ended.
        this.lastCell = null;
        this.paintCell(grid);
        return;
      default:
        this.beginSelect(grid, state, m);
    }
  }

  /** Walls and doors sit on cell edges, so authoring snaps to intersections. */
  private vertex(grid: Point, state: StageSceneState, raw: boolean): Point {
    return snapVertex(grid, state.snapEnabled && !raw);
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

  private beginRuler(grid: Point, state: StageSceneState, m: SceneMetrics): void {
    const token = hitToken(m, state.tokens, grid);
    this.rulerTokenId = token?.id ?? null;
    this.rulerFrom = token ? { x: token.x, y: token.y } : grid;
    this.mode = 'ruler';
    this.rulerReportedAt = 0;
    this.updateRuler(grid, true);
  }

  private beginSelect(grid: Point, state: StageSceneState, m: SceneMetrics): void {
    // A pin head sits above the tokens it annotates — check it first, and only
    // for the GM (players' payloads only ever contain public pins anyway).
    if (state.role === 'gm' && this.host.callbacks.onPinSelect) {
      // 14 screen px of slop around the head, floored so a zoomed-out map does
      // not shrink the target to nothing.
      const pinTol = Math.max(14, worldTolerance(this.host.camera.scale, 14));
      const pinId = hitPin(m, state.scene, grid, pinTol);
      if (pinId) {
        this.mode = 'idle';
        this.host.callbacks.onPinSelect(pinId);
        return;
      }
    }
    // A camera's eye, likewise — the GM's own payload is the only one that
    // has cameras in it at all (FR9.23).
    if (state.role === 'gm' && this.host.callbacks.onCameraSelect) {
      const camTol = Math.max(14, worldTolerance(this.host.camera.scale, 14));
      const cameraId = hitCamera(m, state.scene, grid, camTol);
      if (cameraId) {
        this.mode = 'idle';
        this.host.callbacks.onCameraSelect(cameraId);
        return;
      }
    }

    const token = hitToken(m, state.tokens, grid);
    if (token) {
      this.host.callbacks.onSelectToken(token.id);
      if (state.draggableIds.has(token.id)) {
        this.mode = 'token';
        this.dragTokenId = token.id;
        this.dragSize = token.size;
        this.dragGrab = { x: grid.x - token.x, y: grid.y - token.y };
        this.dragAt = { x: token.x, y: token.y };
        this.host.localDrag(token.id, worldFromGrid(m, this.dragAt));
      } else {
        this.mode = 'pan';
      }
      return;
    }

    // GM: a click near a door's knob toggles it (FR9.2).
    if (state.role === 'gm') {
      const tol = Math.max(12, worldTolerance(this.host.camera.scale, 12));
      const doorId = hitDoor(m, state.scene, grid, tol);
      if (doorId) {
        this.mode = 'idle';
        this.host.callbacks.onDoorToggle(doorId);
        return;
      }
    }
    this.mode = 'pan';
  }

  // -------------------------------------------------------------------------

  private handleMove(e: PointerEvent): void {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;
    const screen = this.local(e);
    const dx = screen.x - tracked.x;
    const dy = screen.y - tracked.y;
    tracked.x = screen.x;
    tracked.y = screen.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.moved = true;

    if (this.mode === 'pinch') {
      this.updatePinch();
      return;
    }

    if (this.mode === 'painting') {
      this.paintCell(this.toGrid(screen));
      return;
    }

    switch (this.mode) {
      case 'pan':
        this.host.camera.panBy(dx, dy);
        return;
      case 'token':
        this.updateTokenDrag(this.toGrid(screen), e.shiftKey);
        return;
      case 'ruler':
        this.updateRuler(this.toGrid(screen), false);
        return;
      case 'trail': {
        const grid = this.toGrid(screen);
        this.host.echoTrail(worldFromGrid(this.host.metrics(), grid));
        this.host.callbacks.onPointer(grid.x, grid.y);
        return;
      }
      case 'segment': {
        this.segmentTo = this.vertex(this.toGrid(screen), this.host.state(), e.shiftKey);
        this.host.drawSegment?.(this.segmentKind, this.segmentFrom, this.segmentTo);
        return;
      }
      case 'rect': {
        const grid = this.toGrid(screen);
        this.rectTo = { col: Math.floor(grid.x), row: Math.floor(grid.y) };
        this.host.drawRect?.(this.rectMode, this.rectFrom, this.rectTo);
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

  private updateTokenDrag(grid: Point, raw: boolean): void {
    if (!this.dragTokenId) return;
    const free = { x: grid.x - this.dragGrab.x, y: grid.y - this.dragGrab.y };
    const at = this.snapped(free, this.dragSize, raw);
    this.dragAt = at;
    this.host.localDrag(this.dragTokenId, worldFromGrid(this.host.metrics(), at));
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
    } else if (this.mode === 'rect') {
      this.host.clearRect?.();
      const b = this.rectBounds();
      // A single cell is still a fill — a click with the area tool paints
      // one square, which is what a click with any brush does.
      if (b) this.host.callbacks.onTileRect?.(b.c0, b.r0, b.c1, b.r1, this.rectMode);
    } else if (this.mode === 'pan' && !this.moved) {
      this.host.callbacks.onSelectToken(null);
    }
    this.mode = 'idle';
  }

  // -------------------------------------------------------------------------

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Abandon any single-pointer gesture cleanly.
    if (this.mode === 'token' && this.dragTokenId) {
      this.host.localDrag(null, null);
      this.dragTokenId = null;
    }
    if (this.mode === 'ruler') this.host.clearRuler();
    if (this.mode === 'segment') this.host.clearSegment?.();
    // A rectangle is abandoned, not filled: unlike a stroke it has laid
    // nothing down yet, so a pinch simply takes it away.
    if (this.mode === 'rect') this.host.clearRect?.();
    // A second finger ends the stroke rather than abandoning its cells: the
    // GM painted them, and pinching to zoom mid-floor is a normal thing to do.
    if (this.mode === 'painting') this.endStroke();
    this.mode = 'pinch';
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
