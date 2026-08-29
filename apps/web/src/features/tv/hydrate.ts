/**
 * Hydrate-on-mount for the table display (FR9.19–9.21).
 *
 * The rule the whole kiosk hangs off: **a live view must never be built from
 * the WebSocket alone.** A TV that only renders events received while mounted
 * shows an empty world after any reboot, refresh, or mid-session power cut —
 * "no scene", "no combatants" — while the table is three passes into a
 * firefight (LIVE-1).
 *
 * Most of that is not solved here. `useLiveHydration` (src/live/hydrate.ts) is
 * the campaign-wide backfill — log, campaign, live encounter, session mode —
 * and the TV uses it exactly as the phone views do, so a rebooted display gets
 * the GM's standing `display.updated` steering and the in-game clock back with
 * everything else. This module adds the two things the shared pass does not
 * cover:
 *
 *  1. **The scene.** `GET /api/scenes/:id` — the map, its visible tokens and
 *     the revealed fog. There is no scene slice in the live store, and this is
 *     the entire content of the TV.
 *  2. **The roster, live.** The store's `encounter.updated` handler keeps only
 *     `payload.encounter`, and on a display socket the combatants ride *beside*
 *     it. Hydration writes a good roster; the next delta would blank it. So the
 *     TV re-reads the roster from the raw event (`tvEncounterFromEvents`) with
 *     the hydrated snapshot as its base.
 *
 * Read-only by construction: these are the same player-visible endpoints a
 * phone calls, and the TV never touches a GM route (FR9.19).
 */
import { useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Scene, Token } from '@safehouse/contracts';
import { useCampaign } from '../../api/campaigns.js';
import { apiGet } from '../../api/client.js';
import { useLiveHydration } from '../../live/hydrate.js';
import { useLiveStore } from '../../live/store.js';
import { tvEncounterFrom, tvEncounterFromEvents, type TvEncounter } from './encounterState.js';
import { mergeSceneEvents, tvActiveSceneId, type TvSceneSnapshot } from './sceneState.js';

/**
 * Slow drift guard: one re-read every ten minutes. Reconnects re-read on their
 * own; this is for the session where nothing ever disconnects and one event
 * went missing anyway. One timer, cleared on unmount.
 */
export const TV_REHYDRATE_MS = 10 * 60_000;

/** Query key root for the TV's own reads (the scene). */
export const TV_SCENE_KEY = ['tv', 'scene'] as const;

interface ComposedSceneRead {
  scene: Scene;
  tokens?: Token[];
}

/**
 * The composed scene as a display socket may see it, plus the stream position
 * the read reflects.
 *
 * `asOfEventId` is captured BEFORE the request goes out, deliberately
 * pessimistically: an event that lands mid-flight is folded in again
 * afterwards, and every fold in `sceneState` is a set rather than an
 * increment, so re-application is a no-op.
 */
export function useTvScene(sceneId: string | null) {
  return useQuery<TvSceneSnapshot>({
    queryKey: [...TV_SCENE_KEY, sceneId],
    queryFn: async () => {
      const asOfEventId = useLiveStore.getState().lastEventId;
      const composed = await apiGet<ComposedSceneRead>(`/api/scenes/${sceneId}`);
      return { scene: composed.scene, tokens: composed.tokens ?? [], asOfEventId };
    },
    enabled: Boolean(sceneId),
    staleTime: 15_000,
    // Switching scenes must not blank a wall-sized screen for the length of a
    // fetch: the outgoing map holds until the incoming one is ready.
    placeholderData: keepPreviousData,
  });
}

/**
 * Re-read the scene when the socket comes back, and slowly on a timer.
 *
 * Replay from `last_event_id` closes most gaps on its own, but not all: the
 * buffer is capped, an event older than the cap is gone, and a TV that was off
 * for an hour reconnects into a world it has no snapshot of. Re-reading is
 * cheap and unconditionally correct, so the kiosk just does it.
 */
export function useTvSceneRefresh(campaignId: string | undefined): void {
  const qc = useQueryClient();
  const reconnectEpoch = useLiveStore((s) => s.reconnectEpoch);

  useEffect(() => {
    if (!campaignId || reconnectEpoch === 0) return;
    void qc.invalidateQueries({ queryKey: TV_SCENE_KEY });
  }, [campaignId, reconnectEpoch, qc]);

  useEffect(() => {
    if (!campaignId) return;
    const timer = setInterval(() => {
      void qc.invalidateQueries({ queryKey: TV_SCENE_KEY });
    }, TV_REHYDRATE_MS);
    return () => clearInterval(timer);
  }, [campaignId, qc]);
}

/** Everything the kiosk draws, hydrated from REST and merged with the stream. */
export interface TvWorld {
  campaignName: string;
  ingameDate: string | null;
  sceneId: string | null;
  /** REST snapshot with live events folded on top; null before the first read. */
  scene: TvSceneSnapshot | null;
  encounter: TvEncounter | null;
  /** True once the server has answered about the scene — an honest empty. */
  hydrated: boolean;
}

/**
 * Compose the kiosk's world. Order matters: the REST snapshot is the base and
 * the event stream is the delta, never the other way round.
 */
export function useTvWorld(campaignId: string | undefined): TvWorld {
  // Campaign-wide backfill: log (so the GM's standing display steering and the
  // in-game clock survive a reboot), the live encounter, the active scene id.
  const hydration = useLiveHydration(campaignId);
  useTvSceneRefresh(campaignId);

  const events = useLiveStore((s) => s.events);
  const storeSceneId = useLiveStore((s) => s.activeSceneId);
  const storeEncounter = useLiveStore((s) => s.encounter);
  const { data: campaign } = useCampaign(campaignId);

  const sceneId = tvActiveSceneId(events, storeSceneId ?? campaign?.activeSceneId ?? null);
  const sceneQuery = useTvScene(sceneId);

  const scene = useMemo(
    () => mergeSceneEvents(sceneQuery.data ?? null, events),
    [sceneQuery.data, events],
  );
  const encounterBase = useMemo(() => tvEncounterFrom(storeEncounter), [storeEncounter]);
  const encounter = useMemo(
    () => tvEncounterFromEvents(events, encounterBase),
    [events, encounterBase],
  );

  return {
    campaignName: campaign?.name ?? 'Safehouse',
    ingameDate: campaign?.ingameDate ?? null,
    sceneId,
    scene,
    encounter,
    // "Settled", not "succeeded": an error is still an answer, and a kiosk
    // that waits forever on a failed read shows a lie instead of an empty.
    hydrated:
      (hydration.campaign === 'ready' || hydration.campaign === 'error') &&
      (!sceneId || sceneQuery.isFetched),
  };
}
