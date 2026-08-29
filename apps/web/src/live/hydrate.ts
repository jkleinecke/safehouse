/**
 * Live-state hydration (LIVE-1).
 *
 * The bug this closes: every live view rendered ONLY the WebSocket events it
 * received while mounted. Seconds after a real roll persisted, the table log
 * still read "the log is empty"; an encounter with eight staged combatants in
 * the database rendered "no combatants yet"; a refresh mid-session showed an
 * empty world. The socket is a delta feed — it was being used as the whole
 * truth.
 *
 * The fix is structural rather than per-screen: `hydrateCampaign` reads the
 * server's held state over REST and folds it into the same live store the
 * socket writes to, so every view that already reads the store (log, tracker,
 * grid, sheet, TV, recap) is backfilled at once. It runs on mount and again on
 * every reconnect.
 *
 * Ordering note: the socket connects FIRST and hydration follows. The overlap
 * is deliberate — everything up to the REST read comes from the snapshot,
 * everything from the socket's registration onward arrives live, and
 * `mergeEvents` makes the overlap idempotent. Hydrating first and connecting
 * second would leave a genuine hole between the two.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchCampaign,
  fetchLiveEncounter,
  fetchLiveMode,
  fetchRollTables,
  fetchSessionLog,
  liveKeys,
  LOG_BACKFILL_LIMIT,
} from '../api/live.js';
import { queryClient as sharedQueryClient } from '../api/client.js';
import { getSession } from '../api/session.js';
import { useLiveStore, type HydrationMap, type HydrationSlice } from './store.js';

export interface HydrateOptions {
  /** Defaults to the app's shared client (App.tsx provides the same one). */
  qc?: QueryClient;
  /** Reconnect / manual refresh: ignore cached snapshots and re-read. */
  force?: boolean;
  /** How many log events to backfill. */
  logLimit?: number;
  /** Drop results instead of applying them (unmounted, campaign switched). */
  isCancelled?: () => boolean;
}

/** How long a hydration read stays fresh on a normal mount. */
const HYDRATION_STALE_MS = 10_000;

type Task = { slice: HydrationSlice; run: () => Promise<void> };

/**
 * Read the server's live state for one campaign and merge it into the store.
 *
 * Every slice is independent: an observer who may not read the encounter list
 * still gets the log, and a 403 on one read marks that slice `error` rather
 * than blanking the screen. Resolves once every slice has settled.
 */
export async function hydrateCampaign(
  campaignId: string,
  opts: HydrateOptions = {},
): Promise<HydrationMap> {
  const qc = opts.qc ?? sharedQueryClient;
  const staleTime = opts.force ? 0 : HYDRATION_STALE_MS;
  const logLimit = opts.logLimit ?? LOG_BACKFILL_LIMIT;
  const cancelled = () => opts.isCancelled?.() === true;

  // Captured BEFORE any request goes out: a snapshot may only write a
  // projected slice if no newer socket event has already written it.
  const asOfEventId = useLiveStore.getState().lastEventId;

  const store = () => useLiveStore.getState();

  const tasks: Task[] = [
    {
      slice: 'log',
      run: async () => {
        const events = await qc.fetchQuery({
          queryKey: liveKeys.log(campaignId),
          queryFn: () => fetchSessionLog(campaignId, logLimit),
          staleTime,
        });
        if (cancelled()) return;
        store().hydrate({ events });
      },
    },
    {
      slice: 'encounter',
      run: async () => {
        const encounter = await qc.fetchQuery({
          queryKey: liveKeys.encounter(campaignId),
          queryFn: () => fetchLiveEncounter(campaignId),
          staleTime,
        });
        if (cancelled()) return;
        store().hydrate({ encounter, asOfEventId });
      },
    },
    {
      slice: 'campaign',
      run: async () => {
        const campaign = await qc.fetchQuery({
          queryKey: liveKeys.campaign(campaignId),
          queryFn: () => fetchCampaign(campaignId),
          staleTime,
        });
        if (cancelled()) return;
        store().hydrate({
          activeSceneId: campaign.activeSceneId ?? null,
          activeSessionId: campaign.activeSessionId ?? null,
          asOfEventId,
        });
      },
    },
    {
      slice: 'session',
      run: async () => {
        const mode = await qc.fetchQuery({
          queryKey: liveKeys.session(campaignId),
          queryFn: () => fetchLiveMode(campaignId),
          staleTime,
        });
        if (cancelled()) return;
        store().hydrate({
          sessionLive: mode.live,
          connectedCount: mode.connected,
          ...(mode.sessionId ? { activeSessionId: mode.sessionId } : {}),
        });
      },
    },
    {
      slice: 'tables',
      run: async () => {
        // Nothing in the store to fill — this warms the cache `useRollTables`
        // reads, so the tables pane is populated on first paint too.
        await qc.fetchQuery({
          queryKey: liveKeys.rollTables(campaignId),
          queryFn: () => fetchRollTables(campaignId),
          staleTime,
        });
      },
    },
  ];

  for (const t of tasks) store().setHydration(t.slice, 'loading');

  await Promise.all(
    tasks.map(async (t) => {
      try {
        await t.run();
        if (!cancelled()) store().setHydration(t.slice, 'ready');
      } catch {
        // An error is a distinct, honest state: "we asked and could not get
        // it" must never render as "there is nothing here".
        if (!cancelled()) store().setHydration(t.slice, 'error');
      }
    }),
  );

  return store().hydration;
}

/**
 * Hydrate on mount and after every reconnect.
 *
 * `reconnectEpoch` is bumped by the store when the socket reaches `online`
 * having been online before — i.e. a true reconnect, not the first connect.
 * The hub replays persisted events from `last_event_id` on its own; what it
 * cannot replay is derived state (which encounter is live, which scene is
 * active), so a reconnect re-reads REST as well.
 */
export function useLiveHydration(campaignId: string | undefined): HydrationMap {
  const qc = useQueryClient();
  const reconnectEpoch = useLiveStore((s) => s.reconnectEpoch);

  useEffect(() => {
    if (!campaignId) return;
    const session = getSession();
    if (!session || session.campaignId !== campaignId) return;
    let cancelled = false;
    void hydrateCampaign(campaignId, {
      qc,
      force: reconnectEpoch > 0,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reconnectEpoch, qc]);

  return useLiveStore((s) => s.hydration);
}

export interface BackfillState {
  /** The server has answered — an empty list now honestly means "nothing". */
  asked: boolean;
  failed: boolean;
}

/**
 * Session-log backfill for a view that must not depend on someone else having
 * hydrated first. It shares `liveKeys.log` with `hydrateCampaign`, so the two
 * collapse into one request; merging the result twice is a no-op.
 */
export function useSessionLogHydration(campaignId: string | undefined): BackfillState {
  const query = useQuery({
    queryKey: liveKeys.log(campaignId ?? ''),
    queryFn: () => fetchSessionLog(campaignId as string, LOG_BACKFILL_LIMIT),
    enabled: Boolean(campaignId),
    staleTime: HYDRATION_STALE_MS,
  });

  const events = query.data;
  useEffect(() => {
    if (events && events.length > 0) useLiveStore.getState().hydrate({ events });
  }, [events]);

  return { asked: query.isFetched, failed: query.isError };
}
