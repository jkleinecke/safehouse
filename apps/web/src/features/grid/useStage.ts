/**
 * React lifecycle for the lazily-imported PixiJS stage.
 * `import('./stage/index.js')` is the ONLY reference to the stage subtree, so
 * pixi lands in its own chunk and never enters the initial bundle (D9).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MovementThresholds, StageApi, StageCallbacks, StageSceneState } from './types.js';

export interface UseStageResult {
  /** Attach to the canvas host element. */
  hostRef: (el: HTMLDivElement | null) => void;
  api: StageApi | null;
  loading: boolean;
  error: string | null;
}

export interface UseStageParams {
  /** Null until the scene has loaded — the stage mounts on the first state. */
  state: StageSceneState | null;
  callbacks: StageCallbacks;
  urlFor: (attachmentId: string) => string;
  thresholds: MovementThresholds | null;
  /** Remote interim drag ghosts (tokenId → grid position). */
  drags: Record<string, { x: number; y: number }>;
}

export function useStage(params: UseStageParams): UseStageResult {
  const [api, setApi] = useState<StageApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    const host = hostEl.current;
    const initial = stateRef.current;
    if (!host || !initial) return;

    let cancelled = false;
    let created: StageApi | null = null;
    setLoading(true);
    setError(null);

    const stable: StageCallbacks = {
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
    };

    void import('./stage/index.js')
      .then(({ createStage }) =>
        createStage({
          host,
          state: initial,
          callbacks: stable,
          urlFor: (id) => urlRef.current(id),
        }),
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
    // Mount once the host node and the first scene state both exist.
  }, [hostReady, hasState]);

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

  return { hostRef, api, loading, error };
}
