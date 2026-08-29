/**
 * Binds the live WS singleton to a mounted campaign view, and hydrates the
 * live store from REST on mount and after every reconnect (LIVE-1).
 *
 * These two belong together: the socket is a delta feed, and a delta feed on
 * its own renders an empty world to anyone who loads the page mid-session.
 * Every view that opens the connection therefore also asks the server what it
 * already holds — one chokepoint rather than a hydration call bolted onto
 * each screen.
 *
 * The socket survives route changes within one campaign; switching campaigns
 * tears it down and resets the store (handled in getLiveSocket).
 */
import { useEffect } from 'react';
import { getSession } from '../api/session.js';
import { useLiveHydration } from './hydrate.js';
import { getLiveSocket } from './socket.js';
import { useLiveStore, type HydrationMap, type SocketStatus } from './store.js';

export function useLiveConnection(campaignId: string | undefined): SocketStatus {
  useEffect(() => {
    if (!campaignId) return;
    const session = getSession();
    if (!session || session.campaignId !== campaignId) return;
    const socket = getLiveSocket({ campaignId, token: session.token });
    socket.connect();
    // Deliberately no close on unmount: the singleton persists across route
    // changes; a campaign switch closes it in getLiveSocket.
  }, [campaignId]);

  // Declared after the connect effect on purpose: React runs effects in
  // declaration order, so the socket is already registering with the hub
  // before the REST read goes out. The two overlap, and `mergeEvents` makes
  // the overlap idempotent — hydrating first would leave a real gap.
  useLiveHydration(campaignId);

  return useLiveStore((s) => s.status);
}

/**
 * Same connection, plus the per-slice hydration state a view needs to tell
 * "the server returned nothing" apart from "we have not asked yet".
 */
export function useLiveConnectionState(campaignId: string | undefined): {
  status: SocketStatus;
  hydration: HydrationMap;
} {
  const status = useLiveConnection(campaignId);
  const hydration = useLiveStore((s) => s.hydration);
  return { status, hydration };
}
