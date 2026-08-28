/**
 * Grid data layer: scenes/tokens/characters queries + GM authoring mutations
 * (DESIGN.md §12), and a live-event → query-cache sync hook (§11).
 *
 * Every list/detail route answers with a named envelope (`{ scenes }`,
 * `{ scene, tokens, drawings }`, `{ token }`); the hooks unwrap it here so
 * components keep dealing in plain domain objects. The scene payload is
 * already role-filtered server-side — hidden tokens and unrevealed fog never
 * reach a player socket at all (Principle 4).
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Scene, SceneInput, SheetV1, Token, TokenInput } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPatch, apiPost, queryClient } from '../../api/client.js';
import { useLiveStore } from '../../live/store.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** GM sees every scene; players see only the active one (server-filtered). */
export function useScenes(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['scenes', campaignId],
    queryFn: async () =>
      (await apiGet<{ scenes: Scene[] }>(`/api/campaigns/${campaignId}/scenes`)).scenes,
    enabled: Boolean(campaignId),
  });
}

/** Composed scene: the scene row plus its visible tokens and live drawings. */
export interface ComposedScene {
  scene: Scene;
  tokens: Token[];
  drawings: unknown[];
}

export function useComposedScene(sceneId: string | null | undefined) {
  return useQuery({
    queryKey: ['scene', sceneId],
    queryFn: () => apiGet<ComposedScene>(`/api/scenes/${sceneId}`),
    enabled: Boolean(sceneId),
  });
}

export function useScene(sceneId: string | null | undefined) {
  return useQuery({
    queryKey: ['scene', sceneId],
    queryFn: () => apiGet<ComposedScene>(`/api/scenes/${sceneId}`),
    select: (data) => data.scene,
    enabled: Boolean(sceneId),
  });
}

/**
 * Tokens ride along with the composed scene — there is no separate token list
 * route, and inventing one would give players a second door to hidden tokens.
 * Same query key, so both hooks share one fetch.
 */
export function useSceneTokens(sceneId: string | null | undefined) {
  return useQuery({
    queryKey: ['scene', sceneId],
    queryFn: () => apiGet<ComposedScene>(`/api/scenes/${sceneId}`),
    select: (data) => data.tokens,
    enabled: Boolean(sceneId),
  });
}

/** Character list row as `characterDto` serializes it. */
export interface CharacterSummary {
  id: string;
  name?: string;
  alias?: string;
  ownerUserId?: string | null;
}

export function useCharacters(campaignId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['characters', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ campaignId: string; characters: CharacterSummary[] }>(
          `/api/campaigns/${campaignId}/characters`,
        )
      ).characters,
    enabled: Boolean(campaignId) && enabled,
  });
}

/** Full character — the ruler derives movement/range data from `sheet`. */
export interface CharacterRecord {
  id: string;
  name?: string;
  sheet?: SheetV1;
}

export function useCharacter(characterId: string | null | undefined) {
  return useQuery({
    queryKey: ['character', characterId],
    queryFn: () => apiGet<CharacterRecord>(`/api/characters/${characterId}`),
    enabled: Boolean(characterId),
  });
}

/** NPC template list for token placement (GM-only prep material, FR10.1). */
export interface NpcTemplateSummary {
  id: string;
  name: string;
}

export function useNpcTemplates(campaignId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['npc-templates', campaignId],
    queryFn: async () =>
      (
        await apiGet<{ templates: NpcTemplateSummary[] }>(
          `/api/campaigns/${campaignId}/npc-templates`,
        )
      ).templates,
    enabled: Boolean(campaignId) && enabled,
    retry: 0,
  });
}

// ---------------------------------------------------------------------------
// GM authoring mutations (FR9.1/9.2)
// ---------------------------------------------------------------------------

function invalidateScene(sceneId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['scene', sceneId] });
  void queryClient.invalidateQueries({ queryKey: ['scenes'] });
}

export function useCreateScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: async (input: Partial<SceneInput> & { name: string }) =>
      (await apiPost<{ scene: Scene }>(`/api/campaigns/${campaignId}/scenes`, input)).scene,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scenes', campaignId] }),
  });
}

export function usePatchScene() {
  return useMutation({
    mutationFn: async ({ sceneId, patch }: { sceneId: string; patch: Partial<SceneInput> }) =>
      (await apiPatch<{ scene: Scene }>(`/api/scenes/${sceneId}`, patch)).scene,
    onSuccess: (_data, vars) => invalidateScene(vars.sceneId),
  });
}

export function useActivateScene() {
  return useMutation({
    mutationFn: async (sceneId: string) =>
      (await apiPost<{ scene: Scene }>(`/api/scenes/${sceneId}/activate`)).scene,
    onSuccess: (_data, sceneId) => invalidateScene(sceneId),
  });
}

export function usePlaceToken() {
  return useMutation({
    mutationFn: async ({
      sceneId,
      token,
    }: {
      sceneId: string;
      token: Omit<TokenInput, 'id' | 'sceneId'>;
    }) => (await apiPost<{ token: Token }>(`/api/scenes/${sceneId}/tokens`, token)).token,
    onSuccess: (_data, vars) => invalidateScene(vars.sceneId),
  });
}

export function usePatchToken(sceneId: string | null | undefined) {
  return useMutation({
    mutationFn: async ({ tokenId, patch }: { tokenId: string; patch: Partial<TokenInput> }) =>
      (await apiPatch<{ token: Token }>(`/api/tokens/${tokenId}`, patch)).token,
    onSuccess: () => {
      if (sceneId) invalidateScene(sceneId);
    },
  });
}

export function useDeleteToken(sceneId: string | null | undefined) {
  return useMutation({
    mutationFn: (tokenId: string) => apiDelete<void>(`/api/tokens/${tokenId}`),
    onSuccess: () => {
      if (sceneId) invalidateScene(sceneId);
    },
  });
}

/** Upload a map image → attachment (POST /api/attachments, multipart, GM). */
export interface AttachmentDto {
  id: string;
  campaignId: string | null;
  kind: string;
  mime: string;
  size: number;
  visibility: string;
  url: string;
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return (await apiPost<{ attachment: AttachmentDto }>(`/api/attachments`, form)).attachment;
    },
  });
}

/** URL for a stored attachment (map images, token art). */
export function fileUrl(attachmentId: string): string {
  return `/files/${attachmentId}`;
}

// ---------------------------------------------------------------------------
// Live sync: WS events → query cache (DESIGN.md §11 "commands up, events down")
// ---------------------------------------------------------------------------

const TOKEN_EVENTS = new Set(['token.added', 'token.moved', 'token.updated', 'token.removed']);
const SCENE_EVENTS = new Set(['scene.updated', 'fog.updated', 'drawing.added', 'drawing.cleared']);

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * Watches the persisted-event stream and keeps this scene's queries fresh.
 * `token.moved` patches the composed-scene cache in place (no refetch churn
 * per drop); everything else invalidates. Scene and tokens share one cache
 * entry, so a token patch rewrites the `tokens` array inside it.
 */
export function useGridLiveSync(sceneId: string | null | undefined): void {
  const qc = useQueryClient();
  const events = useLiveStore((s) => s.events);
  const cursor = useRef(0);

  useEffect(() => {
    if (!sceneId) return;
    const fresh = events.filter((e) => e.id > cursor.current);
    if (fresh.length === 0) return;
    const last = fresh[fresh.length - 1];
    if (last) cursor.current = last.id;

    let refetchScene = false;
    let refetchList = false;

    for (const event of fresh) {
      const payload = asRecord(event.payload);
      if (TOKEN_EVENTS.has(event.type)) {
        if (event.type === 'token.moved') {
          const token = asRecord(payload['token']);
          const tokenId = (payload['tokenId'] ?? token['id']) as string | undefined;
          const x = (payload['x'] ?? token['x']) as number | undefined;
          const y = (payload['y'] ?? token['y']) as number | undefined;
          if (tokenId && typeof x === 'number' && typeof y === 'number') {
            qc.setQueryData<ComposedScene>(['scene', sceneId], (old) =>
              old
                ? {
                    ...old,
                    tokens: old.tokens.map((t) => (t.id === tokenId ? { ...t, x, y } : t)),
                  }
                : old,
            );
          } else {
            refetchScene = true;
          }
        } else {
          refetchScene = true;
        }
      } else if (SCENE_EVENTS.has(event.type)) {
        refetchScene = true;
      } else if (event.type === 'scene.activated') {
        refetchScene = true;
        refetchList = true;
      }
    }

    if (refetchScene) void qc.invalidateQueries({ queryKey: ['scene', sceneId] });
    if (refetchList) void qc.invalidateQueries({ queryKey: ['scenes'] });
  }, [events, sceneId, qc]);
}
