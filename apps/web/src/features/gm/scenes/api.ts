/**
 * Data layer for the Scenes manager.
 *
 * Two halves on purpose:
 *
 *   1. **Request functions** — plain `async` calls against §12 routes. They are
 *      what the hooks run, and they are exported so the create → activate →
 *      delete round trip can be driven in a test against a stub `fetch` without
 *      a DOM (this package has no jsdom).
 *   2. **Hooks** — the React binding, hydrate-from-REST first (LIVE-1). Live
 *      events only ever *invalidate*; nothing on this screen is drawn from the
 *      event stream alone, so a refresh mid-session shows what a cold load does.
 *
 * The query keys are deliberately the Grid's keys (`['scenes', campaignId]`,
 * `['scene', sceneId]`) with the same envelopes, so opening a scene here and
 * then opening it on the canvas is one fetch, and an activation from either
 * screen updates both.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FogRegion, FogState, Scene, SceneInput } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPost, apiPatch, queryClient } from '../../../api/client.js';
import { useLiveStore } from '../../../live/store.js';
import type { AttachmentDto, ComposedScene } from '../../grid/api.js';
import type { TokenCount } from './summary.js';

export { fileUrl } from '../../grid/api.js';

export const scenesKey = (campaignId: string | undefined) => ['scenes', campaignId] as const;
export const sceneKey = (sceneId: string) => ['scene', sceneId] as const;

// ---------------------------------------------------------------------------
// Requests (§12)
// ---------------------------------------------------------------------------

export async function fetchScenes(campaignId: string): Promise<Scene[]> {
  return (await apiGet<{ scenes: Scene[] }>(`/api/campaigns/${campaignId}/scenes`)).scenes;
}

export type SceneCreateInput = Partial<SceneInput> & { name: string };

export async function createScene(campaignId: string, input: SceneCreateInput): Promise<Scene> {
  return (await apiPost<{ scene: Scene }>(`/api/campaigns/${campaignId}/scenes`, input)).scene;
}

export async function patchScene(sceneId: string, patch: Partial<SceneInput>): Promise<Scene> {
  return (await apiPatch<{ scene: Scene }>(`/api/scenes/${sceneId}`, patch)).scene;
}

/** FR9.1: exactly one active scene — the server demotes the previous one. */
export async function activateScene(sceneId: string): Promise<Scene> {
  return (await apiPost<{ scene: Scene }>(`/api/scenes/${sceneId}/activate`)).scene;
}

export async function deleteScene(sceneId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/scenes/${sceneId}`);
}

export interface FogOpVars {
  sceneId: string;
  op: 'reveal' | 'hide';
  /** Omit on `hide` to re-fog the whole scene (the server clears every reveal). */
  regionId?: string;
  /** Post "Revealed: <name>" to the table log (FR9.14). */
  announce?: boolean;
}

export async function fogOp(vars: FogOpVars): Promise<FogState> {
  return (
    await apiPost<{ fog: FogState }>(`/api/scenes/${vars.sceneId}/fog`, {
      op: vars.op,
      ...(vars.regionId ? { regionId: vars.regionId } : {}),
      ...(vars.announce ? { announce: true } : {}),
    })
  ).fog;
}

export async function uploadMapImage(file: File): Promise<AttachmentDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  return (await apiPost<{ attachment: AttachmentDto }>('/api/attachments', form)).attachment;
}

/**
 * Duplicate = a new scene carrying the parts that took work to author: the map
 * images with their scan adjustments, the calibration, the environment, the
 * walls/doors/zones/pins, and the fog regions by name.
 *
 * What it deliberately does NOT carry: tokens (a second staging of the same
 * fight is a different fight) and revealed fog — a copy starts closed, the only
 * safe default for a secrecy surface (Principle 4). The card says so up front.
 *
 * Fog regions need a second round of calls because `POST /scenes` has no `fog`
 * field; `POST /scenes/:id/fog` with `op: 'define'` is the only way to put a
 * named region on a scene, and it accepts the source's region id verbatim.
 */
export async function duplicateScene(
  campaignId: string,
  source: Scene,
  name: string,
): Promise<Scene> {
  const created = await createScene(campaignId, {
    name,
    grid: source.grid,
    environment: source.environment,
    geometry: source.geometry,
    mapAttachmentIds: source.mapAttachmentIds,
    ...(source.notes !== undefined ? { notes: source.notes } : {}),
  });
  for (const region of source.fog.regions) {
    const body: FogRegion = { id: region.id, name: region.name, polygon: region.polygon };
    await apiPost<{ fog: FogState }>(`/api/scenes/${created.id}/fog`, { op: 'define', region: body });
  }
  return created;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The GM's full inventory; players only ever get the active scene (server-side). */
export function useScenes(campaignId: string | undefined) {
  return useQuery({
    queryKey: scenesKey(campaignId),
    queryFn: () => fetchScenes(campaignId ?? ''),
    enabled: Boolean(campaignId),
  });
}

/**
 * "How many figures are standing on this map" is the one number the scene list
 * route does not carry, so each card asks for its own composed scene — the same
 * query key the Grid uses, so nothing is fetched twice and a token dropped on
 * the canvas updates this screen without a second endpoint.
 *
 * The result is `null` for a scene whose read has not landed: a card must say
 * "counting" rather than a confident "0 tokens" it never verified.
 */
export function useSceneTokenCounts(
  sceneIds: readonly string[],
): Record<string, TokenCount | null> {
  return useQueries({
    queries: sceneIds.map((id) => ({
      queryKey: sceneKey(id),
      queryFn: () => apiGet<ComposedScene>(`/api/scenes/${id}`),
      staleTime: 15_000,
    })),
    combine: (results) => {
      const out: Record<string, TokenCount | null> = {};
      sceneIds.forEach((id, i) => {
        const data = results[i]?.data as ComposedScene | undefined;
        out[id] = data
          ? { total: data.tokens.length, hidden: data.tokens.filter((t) => t.hidden).length }
          : null;
      });
      return out;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function invalidateList(campaignId: string | undefined): void {
  void queryClient.invalidateQueries({ queryKey: scenesKey(campaignId) });
  void queryClient.invalidateQueries({ queryKey: ['scenes'] });
}

function invalidateScene(sceneId: string, campaignId: string | undefined): void {
  void queryClient.invalidateQueries({ queryKey: sceneKey(sceneId) });
  invalidateList(campaignId);
}

export function useCreateScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (input: SceneCreateInput) => createScene(campaignId ?? '', input),
    onSuccess: () => invalidateList(campaignId),
  });
}

export function usePatchScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: ({ sceneId, patch }: { sceneId: string; patch: Partial<SceneInput> }) =>
      patchScene(sceneId, patch),
    onSuccess: (_scene, vars) => invalidateScene(vars.sceneId, campaignId),
  });
}

export function useActivateScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (sceneId: string) => activateScene(sceneId),
    onSuccess: (_scene, sceneId) => invalidateScene(sceneId, campaignId),
  });
}

export function useDeleteScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (sceneId: string) => deleteScene(sceneId),
    onSuccess: (_v, sceneId) => {
      queryClient.removeQueries({ queryKey: sceneKey(sceneId) });
      invalidateList(campaignId);
    },
  });
}

export function useDuplicateScene(campaignId: string | undefined) {
  return useMutation({
    mutationFn: ({ source, name }: { source: Scene; name: string }) =>
      duplicateScene(campaignId ?? '', source, name),
    onSuccess: () => invalidateList(campaignId),
  });
}

/**
 * Staged reveals of NAMED regions (FR9.14) — the list-level half of fog.
 * Painting and naming a region is canvas work and stays in the Grid; flipping
 * one that already exists is a button, and the GM is standing here.
 */
export function useFogOp(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (vars: FogOpVars) => fogOp(vars),
    onSuccess: (_fog, vars) => invalidateScene(vars.sceneId, campaignId),
  });
}

export function useUploadMapImage() {
  return useMutation({ mutationFn: (file: File) => uploadMapImage(file) });
}

// ---------------------------------------------------------------------------
// Live sync (events invalidate; REST answers)
// ---------------------------------------------------------------------------

const LIST_EVENTS = new Set(['scene.updated', 'scene.activated']);

/**
 * Events that change what a CARD says. `token.moved` is absent on purpose — a
 * drag emits a stream of them and none changes a count, so watching it here
 * would refetch every scene on the screen for the length of the drag.
 */
const SCENE_EVENTS = new Set(['fog.updated', 'token.added', 'token.removed', 'token.updated']);

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** `token.*` payloads carry the id under `sceneId` or inside `token`. */
export function sceneIdOfEvent(payload: unknown): string | null {
  const record = asRecord(payload);
  const direct = record['sceneId'];
  if (typeof direct === 'string') return direct;
  const nested = asRecord(record['token'])['sceneId'];
  return typeof nested === 'string' ? nested : null;
}

/**
 * Keep the manager honest while it is open: another device activating a scene,
 * the Fixer revealing fog, or a token dropped on the canvas in the next tab all
 * land here as an invalidation, and the REST read that follows is what renders.
 */
export function useScenesLiveSync(campaignId: string | undefined): void {
  const qc = useQueryClient();
  const events = useLiveStore((s) => s.events);
  const cursor = useRef(0);

  useEffect(() => {
    if (!campaignId) return;
    const fresh = events.filter((e) => e.id > cursor.current);
    if (fresh.length === 0) return;
    const last = fresh[fresh.length - 1];
    if (last) cursor.current = last.id;

    let refetchList = false;
    const scenesToRefetch = new Set<string>();

    for (const event of fresh) {
      const sceneId = sceneIdOfEvent(event.payload);
      if (LIST_EVENTS.has(event.type)) {
        refetchList = true;
        if (sceneId) scenesToRefetch.add(sceneId);
      } else if (SCENE_EVENTS.has(event.type)) {
        if (sceneId) scenesToRefetch.add(sceneId);
        else refetchList = true;
      }
    }

    if (refetchList) void qc.invalidateQueries({ queryKey: scenesKey(campaignId) });
    for (const id of scenesToRefetch) void qc.invalidateQueries({ queryKey: sceneKey(id) });
  }, [events, campaignId, qc]);
}
