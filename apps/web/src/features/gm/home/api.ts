/**
 * GM home data layer: campaign settings (PATCH /api/campaigns/:id),
 * device manager with revoke (DESIGN.md §12), invite minting (FR1.1/1.3).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Role } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';
import type { CampaignSummary } from '../../../api/campaigns.js';

/** PATCH /api/campaigns/:id body — all fields optional. */
export interface CampaignPatch {
  name?: string;
  /** In-game Sixth World date, ISO `YYYY-MM-DD` (FR5.7 clock advance). */
  ingameDate?: string;
  /**
   * settings JSONB (§9.2): house-rule flags + the campaign's own Discord
   * webhook (FR1.5), which overrides `DISCORD_WEBHOOK_URL`. Keys are merged;
   * an explicit `null` deletes one. GM-only — a player's campaign read never
   * includes `settings` at all.
   */
  settings?: {
    discordWebhookUrl?: string | null;
    mirrorRollsToDiscord?: boolean;
    [key: string]: unknown;
  };
}

export function useUpdateCampaign(campaignId: string) {
  return useMutation({
    mutationFn: (patch: CampaignPatch) =>
      apiPatch<CampaignSummary>(`/api/campaigns/${campaignId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });
}

/** A joined device (§9.2 `devices`): revocable per device (FR1.3). */
export interface DeviceInfo {
  id: string;
  label?: string;
  role: Role;
  userId?: string;
  userName?: string;
  createdAt?: string;
  lastSeenAt?: string;
  revokedAt?: string | null;
}

/** GM-only: every device bound to this campaign, revoked ones included. */
export function useDevices(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'devices'],
    queryFn: () => apiGet<DeviceInfo[]>(`/api/campaigns/${campaignId}/devices`),
    enabled: Boolean(campaignId),
  });
}

export function useRevokeDevice(campaignId: string) {
  return useMutation({
    mutationFn: (deviceId: string) => apiPost<unknown>(`/api/devices/${deviceId}/revoke`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'devices'] });
    },
  });
}

/** POST /api/campaigns/:id/invites result (FR1.3). */
export interface InviteResult {
  code: string;
  role: Role;
  /** ISO timestamp, or null for a code that does not expire. */
  expiresAt: string | null;
  /** Full LAN join URL, composed against the laptop's current address. */
  url: string;
}

export interface CreateInviteBody {
  /** Anything but `gm` — the GM device is minted with the campaign. */
  role: Exclude<Role, 'gm'>;
  expiresInMinutes?: number;
  maxUses?: number;
}

export function useCreateInvite(campaignId: string) {
  return useMutation({
    mutationFn: (body: CreateInviteBody) =>
      apiPost<InviteResult>(`/api/campaigns/${campaignId}/invites`, body),
  });
}
