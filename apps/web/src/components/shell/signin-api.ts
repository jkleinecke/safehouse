/**
 * GM sign-in data layer (FR1.1/1.2).
 *
 * Four ways a GM device comes into existence, and no others:
 *   - `POST /api/campaigns`                    bootstrap a fresh install
 *   - `POST /api/campaigns/:id/gm-pair`        a short-lived pairing code + QR
 *   - `POST /api/campaigns/:id/gm-device`      a second token for this same GM
 *   - `POST /api/gm/recover`                   loopback only, on the server's
 *                                              own machine (`api/my-campaigns`)
 *
 * A pairing code is redeemed on the SPA route `/join/:code`, which calls
 * `GET /api/join/:code` — the API path, not the SPA one (LIVE-3).
 */
import { useMutation } from '@tanstack/react-query';
import type { Role } from '@safehouse/contracts';
import { apiGet, apiPost, queryClient } from '../../api/client.js';
import { saveSession, sessionFrom, type JoinResponse, type Session } from '../../api/session.js';
import { useLiveStore } from '../../live/store.js';

/**
 * Forget everything the previous device fetched.
 *
 * Switching this tab from the GM console to the player view (a normal move on
 * the GM's own laptop) must not leave GM-cached queries or a GM-filtered live
 * store rendering under a player token. The server would never have sent that
 * data to a player socket; this keeps the browser honest about it too.
 */
export function resetClientState(): void {
  queryClient.clear();
  useLiveStore.getState().reset();
}

/** `POST /api/campaigns` — 201 with the GM's own device token. */
export interface BootstrapResult extends JoinResponse {
  campaignId: string;
  role: Role;
}

export interface BootstrapBody {
  name: string;
  gmName?: string;
}

/**
 * Bootstrap. On a server that already has a campaign this route needs an
 * authenticated user, so an unpaired browser gets a 401 — the landing screen
 * turns that into "this table already exists, pair this device instead".
 */
export function useBootstrapCampaign() {
  return useMutation({
    mutationFn: async (body: BootstrapBody): Promise<Session> => {
      const res = await apiPost<BootstrapResult>('/api/campaigns', body);
      const session = sessionFrom(res);
      saveSession(session);
      return session;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

/** `POST /api/campaigns/:id/gm-pair` — code + join URL + QR data URL. */
export interface GmPairResult {
  code: string;
  role: 'gm';
  expiresAt: string | null;
  expiresInMinutes: number;
  url: string;
  dataUrl: string;
}

export function useMintPairingCode(campaignId: string) {
  return useMutation({
    mutationFn: (body: { expiresInMinutes?: number } = {}) =>
      apiPost<GmPairResult>(`/api/campaigns/${campaignId}/gm-pair`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'devices'] });
    },
  });
}

/** `POST /api/campaigns/:id/gm-device` — another token for the GM in the chair. */
export function useMintGmDevice(campaignId: string) {
  return useMutation({
    mutationFn: (body: { label?: string } = {}) =>
      apiPost<BootstrapResult>(`/api/campaigns/${campaignId}/gm-device`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'devices'] });
    },
  });
}

/**
 * Redeem a pairing/join code straight from the landing screen. Same endpoint
 * the `/join/:code` screen uses; this path exists for a typed code, where
 * navigating first would leave a dead history entry behind.
 */
export function useRedeemCode() {
  return useMutation({
    mutationFn: async (code: string): Promise<Session> => {
      const res = await apiGet<JoinResponse>(`/api/join/${encodeURIComponent(code)}`, {
        anonymous: true,
      });
      const session = sessionFrom(res);
      saveSession(session);
      return session;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

/**
 * Prove a pasted token before storing it. `GET /api/campaigns/:id` is the
 * cheapest authenticated read and it also runs the server's `assertCampaign`,
 * so a token for another campaign fails here rather than half-signing the
 * browser in. The header is passed explicitly because the stored session is,
 * by definition, not this token yet — which is also why a 401 here must not
 * retire anything: a bad paste is a bad paste, not an expired session.
 */
export async function verifyPastedSession(session: Session): Promise<{ id: string; name: string }> {
  return apiGet<{ id: string; name: string }>(`/api/campaigns/${session.campaignId}`, {
    anonymous: true,
    keepSessionOn401: true,
    headers: { Authorization: `Bearer ${session.token}` },
  });
}

/** Verify, then store — the landing screen's "paste a device token" button. */
export function useAdoptPastedSession() {
  return useMutation({
    mutationFn: async (session: Session): Promise<Session> => {
      await verifyPastedSession(session);
      saveSession(session);
      return session;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
