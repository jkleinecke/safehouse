/**
 * React lifecycle for the lazily-loaded map stage.
 * `loadStage` (`stageLoader.ts`) is the ONLY way to the map: it reaches the
 * 3D stage by dynamic import, so three lands in its own chunk and never
 * enters the initial bundle (D9). It also says when a running map stops
 * (`stopped`) and when it comes back, which the page shows over the map with
 * a Reload map button (`remountKey`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStage } from './stageLoader.js';
import type { MovementThresholds, StageApi, StageCallbacks, StageSceneState, StageStop } from './types.js';

export interface UseStageResult {
  /** Attach to the canvas host element. */
  hostRef: (el: HTMLDivElement | null) => void;
  api: StageApi | null;
  loading: boolean;
  /** Why the map could not start, in words the page can show as they are. */
  error: string | null;
  /**
   * Why the running map stopped drawing (`StageStop`), or null while it
   * draws. A lost GPU context that comes back clears it by itself; the other
   * stops last until the stage is remounted.
   */
  stopped: StageStop | null;
}

export interface UseStageParams {
  /** Null until the scene has loaded — the stage mounts on the first state. */
  state: StageSceneState | null;
  callbacks: StageCallbacks;
  urlFor: (attachmentId: string) => string;
  thresholds: MovementThresholds | null;
  /** Remote interim drag ghosts (tokenId → grid position). */
  drags: Record<string, { x: number; y: number }>;
  /**
   * Change it to tear the stage down and mount a fresh one in the same host,
   * from the current state: the page's Reload map button, after the map
   * stopped or could not start. It also clears `error` and `stopped`.
   */
  remountKey?: number;
}

export function useStage(params: UseStageParams): UseStageResult {
  const [api, setApi] = useState<StageApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<StageStop | null>(null);

  const hostEl = useRef<HTMLDivElement | null>(null);
  const [hostReady, setHostReady] = useState(0);
  const stateRef = useRef<StageSceneState | null>(params.state);
  stateRef.current = params.state;

  // Callbacks change identity every render; the stage keeps one stable shim.
  const cbRef = useRef<StageCallbacks>(params.callbacks);
  cbRef.current = params.callbacks;
  const urlRef = useRef(params.urlFor);
  urlRef.current = params.urlFor;

  const hostRef = useCallback((el: HTMLDivElement | null) => {
    hostEl.current = el;
    setHostReady((n) => n + 1);
  }, []);

  const hasState = params.state !== null;
  const remountKey = params.remountKey ?? 0;

  useEffect(() => {
    const host = hostEl.current;
    const initial = stateRef.current;
    if (!host || !initial) return;

    let cancelled = false;
    let created: StageApi | null = null;
    setLoading(true);
    setError(null);
    setStopped(null);

    // `Required`, not `StageCallbacks`: this shim is a hand-copied key list, and
    // every member added to the interface after it was written is optional, so a
    // forgotten line here compiles clean and the stage simply never raises that
    // callback. Tile painting shipped that way — `onTilePaint` reached
    // `PointerController` as `undefined` and no stroke ever left the canvas.
    // `Required` turns the next omission into a compile error instead.
    const stable: Required<StageCallbacks> = {
      onTokenMove: (id, x, y) => cbRef.current.onTokenMove(id, x, y),
      onTokenDrag: (id, x, y) => cbRef.current.onTokenDrag(id, x, y),
      onSelectToken: (id) => cbRef.current.onSelectToken(id),
      onPing: (x, y) => cbRef.current.onPing(x, y),
      onPointer: (x, y) => cbRef.current.onPointer(x, y),
      onRuler: (r) => cbRef.current.onRuler(r),
      onDoorToggle: (id) => cbRef.current.onDoorToggle(id),
      onAoePlace: (x, y) => cbRef.current.onAoePlace(x, y),
      onFogVertex: (x, y) => cbRef.current.onFogVertex(x, y),
      onFocus: (x, y) => cbRef.current.onFocus(x, y),
      onSegmentDraw: (kind, a, b) => cbRef.current.onSegmentDraw?.(kind, a, b),
      onArcDraw: (a, b, bulge) => cbRef.current.onArcDraw?.(a, b, bulge),
      onTokenPlace: (x, y) => cbRef.current.onTokenPlace?.(x, y),
      onPinPlace: (x, y) => cbRef.current.onPinPlace?.(x, y),
      onPinSelect: (id) => cbRef.current.onPinSelect?.(id),
      onCameraPlace: (x, y) => cbRef.current.onCameraPlace?.(x, y),
      onCameraSelect: (id) => cbRef.current.onCameraSelect?.(id),
      onLightPlace: (x, y) => cbRef.current.onLightPlace?.(x, y),
      onLightSelect: (id) => cbRef.current.onLightSelect?.(id),
      onNotePlace: (x, y) => cbRef.current.onNotePlace?.(x, y),
      onNoteSelect: (id) => cbRef.current.onNoteSelect?.(id),
      onWallSelect: (id) => cbRef.current.onWallSelect?.(id),
      onZoneSelect: (id) => cbRef.current.onZoneSelect?.(id),
      onSelectClear: () => cbRef.current.onSelectClear?.(),
      onTileDoorToggle: (cell, level) => cbRef.current.onTileDoorToggle?.(cell, level),
      onTilePaint: (col, row, erase) => cbRef.current.onTilePaint?.(col, row, erase),
      onTileStrokeEnd: () => cbRef.current.onTileStrokeEnd?.(),
      onTileRect: (c0, r0, c1, r1, mode) => cbRef.current.onTileRect?.(c0, r0, c1, r1, mode),
      onContextMenu: (request) => cbRef.current.onContextMenu?.(request),
      onPaintedSelect: (id) => cbRef.current.onPaintedSelect?.(id),
      onPaintedEdit: (delta, anchorId, tilesetId) => cbRef.current.onPaintedEdit?.(delta, anchorId, tilesetId),
      onBoxSelect: (a, b, everything) => cbRef.current.onBoxSelect?.(a, b, everything),
      onPaintedToggle: (id) => cbRef.current.onPaintedToggle?.(id),
      onCellSelectionMove: (dc, dr) => cbRef.current.onCellSelectionMove?.(dc, dr),
      onPaste: (at) => cbRef.current.onPaste?.(at),
    };

    void loadStage(
      {
        host,
        state: initial,
        callbacks: stable,
        urlFor: (id) => urlRef.current(id),
      },
      {
        role: initial.role,
        onStopped: (stop) => {
          if (!cancelled) setStopped(stop);
        },
        onResumed: () => {
          if (!cancelled) setStopped(null);
        },
      },
    )
      .then((stage) => {
        if (cancelled) {
          stage.destroy();
          return;
        }
        created = stage;
        setApi(stage);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Could not start the canvas renderer.');
      });

    return () => {
      cancelled = true;
      created?.destroy();
      setApi(null);
    };
    // Mount once the host node and the first scene state both exist, and
    // again whenever the page asks for a fresh stage (`remountKey`).
  }, [hostReady, hasState, remountKey]);

  // Push state / ghosts / thresholds every render — all cheap, diffed inside.
  useEffect(() => {
    if (api && params.state) api.update(params.state);
  }, [api, params.state]);

  useEffect(() => {
    api?.setDrags(params.drags);
  }, [api, params.drags]);

  useEffect(() => {
    api?.setRulerThresholds(params.thresholds);
  }, [api, params.thresholds]);

  return { hostRef, api, loading, error, stopped };
}
