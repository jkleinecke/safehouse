/**
 * Campaign-level queries used by the shell (header, join-QR modal).
 * Feature agents add their own query modules under src/features/.
 */
import { useQuery } from '@tanstack/react-query';
import type { Role } from '@safehouse/contracts';
import { apiGet } from './client.js';
import { getSession } from './session.js';

/**
 * GET /api/campaigns/:id — name, the in-game clock (FR5.7), and what is
 * currently live. `settings` is present only for a GM device: it can hold the
 * campaign's Discord webhook, so it is filtered out server-side rather than
 * hidden in the client (Principle 4).
 */
export interface CampaignSummary {
  id: string;
  name: string;
  /** Sixth World date, ISO `YYYY-MM-DD` (campaign opens 2076-05-12). */
  ingameDate?: string | null;
  gmUserId?: string;
  createdAt?: string;
  activeSceneId?: string | null;
  activeSessionId?: string | null;
  settings?: Record<string, unknown>;
}

export function useCampaign(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => apiGet<CampaignSummary>(`/api/campaigns/${campaignId}`),
    enabled: Boolean(campaignId),
  });
}

/**
 * GET /api/campaigns/:id/join-qr — mints a fresh role-scoped invite and
 * renders it against the laptop's CURRENT LAN address (FR1.1, §16 "Join QR"),
 * so a new venue's Wi-Fi just means showing a new QR. Nobody types an IP.
 */
export interface JoinQrInfo {
  /** Full URL encoded in the QR: http://<lan-ip>:8787/join/<code>. */
  url: string;
  code: string;
  role: Role;
  /** Pre-rendered PNG data URL of the QR itself. */
  dataUrl: string;
}

export function useJoinQr(campaignId: string | undefined, role: Role, enabled: boolean) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'join-qr', role],
    queryFn: () => apiGet<JoinQrInfo>(`/api/campaigns/${campaignId}/join-qr?role=${role}`),
    enabled: Boolean(campaignId) && enabled,
    staleTime: 0,
  });
}

/**
 * This device's own character, resolved from the campaign roster by owner.
 *
 * Invites are not character-bound (the server mints a fresh user per join), so
 * the link between a phone and a sheet is `characters.ownerUserId` — which is
 * also the only place it can safely live: a client-declared character id would
 * let any device claim any sheet.
 */
export function useMyCharacterId(campaignId: string | undefined): string | null {
  const session = getSession();
  const { data } = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ characters: Array<{ id: string; ownerUserId?: string | null }> }>(
          `/api/campaigns/${campaignId}/characters`,
        )
      ).characters,
    enabled: Boolean(campaignId && session?.userId),
    staleTime: 60_000,
  });
  if (!session?.userId) return null;
  return data?.find((c) => c.ownerUserId === session.userId)?.id ?? null;
}
