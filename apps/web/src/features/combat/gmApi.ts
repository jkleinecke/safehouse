/** The GM's hand on attack exchanges over REST, and the fight's open ones kept live. */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Exchange, ExchangeApplyRequest, ExchangeOpenRequestInput } from '@safehouse/contracts';
import { apiGet, apiPost } from '../../api/client.js';
import { useLiveStore } from '../../live/store.js';
import { openExchangesOf } from './gmModel.js';

export function openExchange(body: ExchangeOpenRequestInput): Promise<Exchange> {
  return apiPost<{ exchange: Exchange }>('/api/exchanges', body).then((r) => r.exchange);
}

export function applyExchange(id: string, body: ExchangeApplyRequest = {}): Promise<Exchange> {
  return apiPost<{ exchange: Exchange }>(`/api/exchanges/${id}/apply`, body).then((r) => r.exchange);
}

export function cancelExchange(id: string): Promise<Exchange> {
  return apiPost<{ exchange: Exchange }>(`/api/exchanges/${id}/cancel`).then((r) => r.exchange);
}

export function undoExchange(id: string): Promise<Exchange> {
  return apiPost<{ exchange: Exchange }>(`/api/exchanges/${id}/undo`).then((r) => r.exchange);
}

/** GM only: the fight's open exchanges, from its frames, the REST read until one arrives. */
export function useGmExchanges(encounterId: string | null | undefined): Exchange[] {
  const events = useLiveStore((s) => s.events);
  const rest = useQuery({
    queryKey: ['gm-exchanges', encounterId ?? null],
    queryFn: async () => {
      const asOf = useLiveStore.getState().lastEventId;
      const r = await apiGet<{ exchanges?: unknown }>(`/api/encounters/${encounterId}`);
      return { list: Array.isArray(r.exchanges) ? (r.exchanges as Exchange[]) : [], asOf };
    },
    enabled: Boolean(encounterId),
    staleTime: 30_000,
    retry: 0,
  });
  return useMemo(
    () => (encounterId ? openExchangesOf(events, encounterId, rest.data) : []),
    [events, encounterId, rest.data],
  );
}
