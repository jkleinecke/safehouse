/**
 * Live-store taps the Grid needs: remote interim drag ghosts and the ephemeral
 * ping / pointer / focus mark stream (§11 ephemeral messages).
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Encounter } from '@safehouse/contracts';
import { useLiveStore } from '../../live/store.js';
import { useCampaignEncounters, useEncounter } from './api.js';
import { displayFromEvents, mergeEncounter, pickEncounterId, type DisplayState } from './hydration.js';
import { classifyMark, focusFromEvent, type MarkKind, type MarkSample } from './projection.js';

export type MarkHandler = (kind: MarkKind, x: number, y: number) => void;

/** tokenId → interim grid position, relayed while someone else drags (FR9.5). */
export function useRemoteDrags(): Record<string, { x: number; y: number }> {
  return useLiveStore((s) => s.drags);
}

/**
 * Calls `handler` for every incoming ephemeral mark on this scene.
 *
 * `live/store` funnels `ping`, `pointer` and the focus relay into one
 * `lastPing` slot, but each carries the server's explicit `kind`, so
 * `classifyMark` honours it outright; the cadence heuristic behind it only
 * ever fires for a mark from an older server.
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

/**
 * "Focus here" arriving as a persisted event — the belt to `useMarkStream`'s
 * braces (see `focusFromEvent`). Only marks that arrive AFTER mount recentre:
 * a replayed backlog must not yank a viewport that just framed the scene.
 */
export function useFocusStream(
  sceneId: string | null | undefined,
  handler: (x: number, y: number) => void,
): void {
  const events = useLiveStore((s) => s.events);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const cursor = useRef<number | null>(null);

  useEffect(() => {
    const highest = events.length > 0 ? (events[events.length - 1]?.id ?? 0) : 0;
    if (cursor.current === null) {
      cursor.current = highest;
      return;
    }
    let latest: { x: number; y: number } | null = null;
    for (const event of events) {
      if (event.id <= cursor.current) continue;
      const mark = focusFromEvent(event, sceneId ?? null);
      if (mark) latest = mark;
    }
    cursor.current = Math.max(cursor.current, highest);
    if (latest) handlerRef.current(latest.x, latest.y);
  }, [events, sceneId]);
}

/** The live encounter (acting-combatant glow + token bars, FR4.10/FR9.10). */
export function useLiveEncounter() {
  return useLiveStore((s) => s.encounter);
}

/**
 * LIVE-1: the encounter the canvas decorates with, hydrated from REST on mount
 * and then kept current by `encounter.updated`.
 *
 * The live store starts empty on every page load, so a refresh mid-fight used
 * to lose the acting-token glow and every condition bar until the GM happened
 * to advance the turn. Now the roster is fetched, and live events merge on top.
 */
export function useHydratedEncounter(
  campaignId: string | undefined,
  sceneId: string | null | undefined,
): Encounter | null {
  const live = useLiveEncounter();
  const list = useCampaignEncounters(campaignId);
  const restId = useMemo(
    () => pickEncounterId(list.data, sceneId ?? null),
    [list.data, sceneId],
  );
  // Once live events name a fight, follow that one — it is the fight in play.
  const detail = useEncounter(live?.id ?? restId);
  return useMemo(() => mergeEncounter(live, detail.data), [live, detail.data]);
}

/** The campaign's currently active scene id, pushed by `scene.activated`. */
export function useActiveSceneId(): string | null {
  return useLiveStore((s) => s.activeSceneId);
}

/**
 * What the table display is currently doing (FR9.21), read back out of the
 * `display.updated` stream so the GM console is not merely optimistic.
 */
export function useDisplayState(): DisplayState {
  const events = useLiveStore((s) => s.events);
  return useMemo(() => displayFromEvents(events), [events]);
}
