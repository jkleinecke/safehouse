/**
 * Live-store taps the Grid needs: remote interim drag ghosts and the ephemeral
 * ping / pointer / focus mark stream (§11 ephemeral messages).
 */
import { useEffect, useRef } from 'react';
import { useLiveStore } from '../../live/store.js';
import { classifyMark, type MarkKind, type MarkSample } from './projection.js';

export type MarkHandler = (kind: MarkKind, x: number, y: number) => void;

/** tokenId → interim grid position, relayed while someone else drags (FR9.5). */
export function useRemoteDrags(): Record<string, { x: number; y: number }> {
  return useLiveStore((s) => s.drags);
}

/**
 * Calls `handler` for every incoming ephemeral mark on this scene.
 * INTEGRATION: `live/store` funnels `ping`, `pointer` (and any future focus
 * relay) into one `lastPing` slot without the ephemeral's type; `classifyMark`
 * guesses from cadence and honours an explicit `kind` the moment one appears.
 */
export function useMarkStream(sceneId: string | null | undefined, handler: MarkHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const sceneRef = useRef(sceneId);
  sceneRef.current = sceneId;

  useEffect(() => {
    let prev: MarkSample | null = null;
    let lastTs = 0;
    return useLiveStore.subscribe((state) => {
      const mark = state.lastPing;
      if (!mark || mark.ts === lastTs) return;
      lastTs = mark.ts;
      // A mark carrying a scene id that is not the one on screen is not ours.
      if (mark.sceneId && sceneRef.current && mark.sceneId !== sceneRef.current) return;
      const sample: MarkSample = {
        x: mark.x,
        y: mark.y,
        ts: mark.ts,
        kind: (mark as { kind?: string }).kind,
      };
      const kind = classifyMark(prev, sample);
      prev = sample;
      handlerRef.current(kind, sample.x, sample.y);
    });
  }, []);
}

/** The live encounter (acting-combatant glow + token bars, FR4.10/FR9.10). */
export function useLiveEncounter() {
  return useLiveStore((s) => s.encounter);
}

/** The campaign's currently active scene id, pushed by `scene.activated`. */
export function useActiveSceneId(): string | null {
  return useLiveStore((s) => s.activeSceneId);
}
