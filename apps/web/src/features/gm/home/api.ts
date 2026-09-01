/**
 * GM home data layer: campaign settings (PATCH /api/campaigns/:id),
 * device manager with revoke (DESIGN.md §12), invite minting (FR1.1/1.3).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Role } from '@safehouse/contracts';
import { api, apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';
import type { CampaignSummary } from '../../../api/campaigns.js';

/**
 * A roster row as `GET /api/campaigns/:id/characters` serializes it
 * (`characterDto`). The list route already answers with the whole sheet and the
 * ledger-derived balances, which is why the GM roster can show who a runner is
 * without a second request per character.
 */
export interface RosterCharacter {
  id: string;
  name?: string;
  status?: string;
  /** `characters.ownerUserId` — the ONLY link between a phone and a sheet. */
  ownerUserId?: string | null;
  sheet?: {
    identity?: { alias?: string; metatype?: string };
    attributes?: Record<string, unknown>;
  };
  /** FR3.6: ledger sums, never free-floating sheet numbers. */
  balances?: { karma: number; nuyen: number };
  updatedAt?: string;
}

/**
 * The campaign roster.
 *
 * Same query key as `useMyCharacterId` and the Grid's `useCharacters`, so the
 * three share one fetch and one cache entry rather than racing each other.
 * This is the query that was missing from the GM console entirely: the roster
 * came back from the server the whole time and nothing rendered it, so opening
 * a player's sheet meant pasting a UUID into the address bar.
 */
export function useRoster(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['characters', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ campaignId: string; characters: RosterCharacter[] }>(
          `/api/campaigns/${campaignId}/characters`,
        )
      ).characters,
    enabled: Boolean(campaignId),
  });
}

/**
 * POST /api/characters — the door into an empty campaign.
 *
 * The route has taken both shapes since M3 and nothing in the browser ever
 * called it, so `pnpm seed:demo` was the only thing that had ever made a
 * character. Two ways in, because a table has both kinds of player:
 *
 *  - `{ name }`     → a blank but valid `SheetV1`, filled in on the sheet;
 *  - a `.chum5` file → the Chummer5a importer (FR3.1), which also turns the
 *    build's karma/nuyen into opening ledger entries rather than sheet numbers.
 *
 * Multipart for the file (the server reads either), so an 8 MB build does not
 * have to be base64'd through JSON.
 */
export function useCreateCharacter(campaignId: string) {
  return useMutation({
    mutationFn: (input: { name: string } | { file: File; name?: string }) => {
      if ('file' in input) {
        const form = new FormData();
        form.set('campaignId', campaignId);
        if (input.name) form.set('name', input.name);
        form.set('file', input.file, input.file.name);
        return api<RosterCharacter>('/api/characters', { method: 'POST', body: form });
      }
      return apiPost<RosterCharacter>('/api/characters', {
        campaignId,
        name: input.name,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
    },
  });
}

/**
 * PATCH /api/characters/:id/owner — hand a sheet to a joined device.
 *
 * Invites carry a role, not a character, so `characters.ownerUserId` is the
 * only link between a phone and a sheet — and until now it could only be set by
 * the seeder. Without this the player who scans the QR gets a campaign with no
 * Sheet tab at all.
 */
export function useAssignOwner(campaignId: string) {
  return useMutation({
    mutationFn: ({ characterId, ownerUserId }: { characterId: string; ownerUserId: string | null }) =>
      apiPatch<RosterCharacter>(`/api/characters/${characterId}/owner`, { ownerUserId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
    },
  });
}

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
