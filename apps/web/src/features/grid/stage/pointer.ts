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
  metersBetween,
  snapCenter,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import type { StageCallbacks, StageSceneState } from '../types.js';
import { Camera, wheelZoomFactor } from './camera.js';
import { gridTolerance, hitDoor, hitToken, isDoubleTap, type TapRecord } from './hit.js';

type Mode = 'idle' | 'pan' | 'token' | 'ruler' | 'trail' | 'pinch';

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
}

interface ActivePointer {
  id: number;
  x: number;
  y: number;
}

export class PointerController {
  private mode: Mode = 'idle';
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
        this.beginRuler(grid, state);
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
      default:
        this.beginSelect(grid, state, m);
    }
  }

  private beginRuler(grid: Point, state: StageSceneState): void {
    const token = hitToken(state.tokens, grid);
    this.rulerTokenId = token?.id ?? null;
    this.rulerFrom = token ? { x: token.x, y: token.y } : grid;
    this.mode = 'ruler';
    this.rulerReportedAt = 0;
    this.updateRuler(grid, true);
  }

  private beginSelect(grid: Point, state: StageSceneState, m: SceneMetrics): void {
    const token = hitToken(state.tokens, grid);
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
      const tol = gridTolerance(m, this.host.camera.scale, 12);
      const doorId = hitDoor(state.scene, grid, Math.max(0.35, tol));
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
      default:
        return;
    }
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
