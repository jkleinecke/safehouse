/**
 * Binds the live WS singleton to a mounted campaign view.
 * The socket survives route changes within one campaign; switching campaigns
 * tears it down and resets the store (handled in getLiveSocket).
 */
import { useEffect } from 'react';
import { getSession } from '../api/session.js';
import { getLiveSocket } from './socket.js';
import { useLiveStore, type SocketStatus } from './store.js';

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

  return useLiveStore((s) => s.status);
}
