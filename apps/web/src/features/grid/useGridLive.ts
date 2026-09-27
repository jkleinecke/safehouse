/**
 * Live-store taps the Grid needs: remote interim drag ghosts, the ephemeral
 * ping / pointer / focus mark stream (§11 ephemeral messages), and the
 * server's refusals of this screen's own commands.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Encounter } from '@safehouse/contracts';
import { useLiveStore, type LiveErrorFrame } from '../../live/store.js';
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
 * Calls `handler` for every refusal with code `code` the server sends this
 * socket AFTER mount (`LiveState.lastError`): a player's drop through a wall
 * (`blocked`) is the map's. One that was already in the store when the page
 * mounted belongs to whatever screen was open then, and is not repeated.
 * Told apart by the frame itself rather than its number, because the store
 * starts its numbering again when the campaign changes.
 */
export function useServerRefusals(code: string, handler: (frame: LiveErrorFrame) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => watchServerRefusals(code, (frame) => handlerRef.current(frame)), [code]);
}

/**
 * The subscription behind `useServerRefusals`, outside React: `handler` is
 * called for each refusal with code `code` that reaches the live store from
 * now on, and not for the one already there. Returns the unsubscribe.
 */
export function watchServerRefusals(code: string, handler: (frame: LiveErrorFrame) => void): () => void {
  let last = useLiveStore.getState().lastError;
  return useLiveStore.subscribe((state) => {
    const frame = state.lastError;
    if (frame === last) return;
    last = frame;
    if (frame === null || frame.code !== code) return;
    handler(frame);
  });
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
