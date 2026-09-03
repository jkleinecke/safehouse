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
import type {
  Encounter,
  Scene,
  SceneGeometry,
  SceneInput,
  SheetV1,
  Token,
  TokenInput,
} from '@safehouse/contracts';
import type { TilePattern } from '@safehouse/rules';
import { apiDelete, apiGet, apiPatch, apiPost, queryClient } from '../../api/client.js';
import { getToken } from '../../api/session.js';
import { useLiveStore } from '../../live/store.js';
import { normalizeGeometry } from './geometryEdit.js';
import { mapImageId } from './mapImage.js';
import { tileDefKey, type TileDrawDef, tileDefsFromSets } from './types.js';

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

/**
 * URL for a stored attachment (map images, token art). Map refs may carry a
 * `#rot=…` adjustment fragment (see `mapImage.ts`); the file route wants the
 * bare id.
 *
 * The token rides as a query parameter because the consumers are `<img src>`,
 * pixi's texture loader and an `<a href>` — none of which can set an
 * `Authorization` header, and `/files/:id` is authenticated (`app.ts`'s
 * `QUERY_TOKEN_PREFIXES`). Without it every map image on the GM's own screens
 * answered 401: the Grid drew a blank floor and the Scenes list drew a broken
 * thumbnail, on a campaign whose map was sitting right there in the file
 * store. `TvStageView` already did this for the kiosk; this is the same rule at
 * the one helper the GM surfaces share.
 *
 * The query string leaves the URL without a file extension, which pixi needs a
 * parser hint for — `stage/assetUrl.ts` already registers one for every stage.
 */
export function fileUrl(attachmentId: string): string {
  const token = getToken();
  const id = mapImageId(attachmentId);
  return token ? `/files/${id}?token=${encodeURIComponent(token)}` : `/files/${id}`;
}

// ---------------------------------------------------------------------------
// Geometry authoring (FR9.2 walls/doors/zones, FR9.3 pins)
// ---------------------------------------------------------------------------

/**
 * Whole-object geometry replacement — that is the shape `PATCH /api/scenes/:id`
 * takes. Everything is normalised through the contract first, so a half-typed
 * editor field can never post a body the server rejects.
 */
export function usePatchGeometry() {
  return useMutation({
    mutationFn: async ({ sceneId, geometry }: { sceneId: string; geometry: SceneGeometry }) =>
      (
        await apiPatch<{ scene: Scene }>(`/api/scenes/${sceneId}`, {
          geometry: normalizeGeometry(geometry),
        })
      ).scene,
    onSuccess: (_data, vars) => invalidateScene(vars.sceneId),
  });
}

/** Codex pages a pin can link to (FR9.3 → FR5.3). GM-facing picker. */
export interface WikiPageSummary {
  id: string;
  title: string;
  kind: string;
  visibility: string;
}

export function useWikiPages(campaignId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['wiki-pages', campaignId],
    queryFn: async () =>
      (await apiGet<{ pages: WikiPageSummary[] }>(`/api/campaigns/${campaignId}/wiki`)).pages,
    enabled: Boolean(campaignId) && enabled,
    // The codex module may not be mounted on every deployment; a 404 here must
    // degrade the pin editor to "paste an id", not spam retries.
    retry: 0,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Hydrate-on-mount (LIVE-1): the encounter behind the token decorations
// ---------------------------------------------------------------------------

/** Encounter headers for the campaign (no combatants — see `useEncounter`). */
export function useCampaignEncounters(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: async () =>
      (await apiGet<{ encounters: Encounter[] }>(`/api/campaigns/${campaignId}/encounters`))
        .encounters,
    enabled: Boolean(campaignId),
    staleTime: 30_000,
  });
}

/**
 * One encounter with its combatants. The route hoists `state/turn/pass` and
 * `combatants` alongside the encounter object; we fold them back into a single
 * `Encounter` so the grid's projections take the same shape as the live
 * store's `encounter.updated` payload.
 */
interface EncounterDetailDto {
  encounter: Encounter;
  combatants?: Encounter['combatants'];
  activeCombatantId?: string | null;
}

export function useEncounter(encounterId: string | null | undefined) {
  return useQuery({
    queryKey: ['encounter', encounterId],
    queryFn: async (): Promise<Encounter> => {
      const dto = await apiGet<EncounterDetailDto>(`/api/encounters/${encounterId}`);
      return {
        ...dto.encounter,
        combatants: dto.combatants ?? dto.encounter.combatants ?? [],
        activeCombatantId: dto.activeCombatantId ?? dto.encounter.activeCombatantId ?? null,
      };
    },
    enabled: Boolean(encounterId),
    staleTime: 5_000,
  });
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

/**
 * LIVE-1, second half: a socket that dropped and came back replays persisted
 * events, but anything the client only ever learned by REST (the scene body,
 * the token list, the encounter roster) is now however stale the outage was.
 * Every offline→online transition re-reads them.
 */
export function useRefetchOnReconnect(
  campaignId: string | undefined,
  sceneId: string | null | undefined,
): void {
  const qc = useQueryClient();
  const status = useLiveStore((s) => s.status);
  const wasOffline = useRef(false);

  useEffect(() => {
    // Only a real drop arms the refetch — the first `connecting → online` of a
    // mount must not re-fire the queries that just resolved.
    if (status === 'offline') {
      wasOffline.current = true;
      return;
    }
    if (status !== 'online' || !wasOffline.current) return;
    wasOffline.current = false;
    void qc.invalidateQueries({ queryKey: ['scenes', campaignId] });
    void qc.invalidateQueries({ queryKey: ['encounters', campaignId] });
    void qc.invalidateQueries({ queryKey: ['encounter'] });
    if (sceneId) void qc.invalidateQueries({ queryKey: ['scene', sceneId] });
  }, [status, campaignId, sceneId, qc]);
}

/** A tile definition as served by `GET /api/tilesets` (source: @safehouse/rules). */
export interface TileDef {
  id: string;
  name: string;
  kind: 'floor' | 'wall' | 'door' | 'feature';
  pattern: TilePattern;
  colors: [string, string];
  /**
   * Extrusion in cells — 0 flat, 0.5 waist-high, 1 full. Read by BOTH the
   * isometric renderer (the silhouette) and `@safehouse/rules`' line of sight
   * (cover and sight blocking), which is the point: one number, so a tile that
   * looks waist-high cannot behave like a full wall.
   */
  height?: number;
  /** Colour the tile gives off — neon, sodium light, a barrel fire. */
  emissive?: string;
  /**
   * Which of the four tools offers it — Ground, Building, Interior, Decor —
   * and so which layer it lands on. Absent on a set that predates the tools;
   * the palette falls back to `kind`.
   */
  category?: 'ground' | 'building' | 'interior' | 'decoration';
  /** Where it belongs, for single-click placement (see `pickTile` in rules). */
  placement?: { againstWall?: boolean; inWall?: boolean; on?: readonly string[] };
  /**
   * Sight and movement blocking. Derived from `height` unless the tile says
   * otherwise (glass is full height and see-through), so these are only set
   * for the exceptions — see `stopsSight` / `stopsMovement` in the rules.
   */
  blocksMovement?: boolean;
  blocksSight?: boolean;
  hint?: string;
}
export interface TilesetDef {
  id: string;
  name: string;
  blurb: string;
  tiles: TileDef[];
}

/**
 * Flatten the served catalogue into the canvas's palette (`StageApi.setTileDefs`).
 *
 * Keyed by `tileDefKey`, not by tile id: `wall` exists in every set, `door` in
 * four and `floor` in two, and the flat map this replaces silently kept only
 * the last one loaded.
 */
export function tileDefsFrom(tilesets: readonly TilesetDef[]): Record<string, TileDrawDef> {
  return tileDefsFromSets(tilesets);
}

/**
 * The built-in tilesets (FR9.2). Served rather than imported so the palette
 * cannot drift from what the server will accept, and cached indefinitely
 * because the catalogue ships with the build.
 */
export function useTilesets() {
  return useQuery({
    queryKey: ['tilesets'],
    queryFn: async () => (await apiGet<{ tilesets: TilesetDef[] }>('/api/tilesets')).tilesets,
    staleTime: Infinity,
  });
}

/**
 * One stroke's worth of delta. The scene rides in the body rather than being
 * baked into the hook: a stroke buffered while the GM switches scenes must go
 * to the scene it was painted on, not to whichever one is on screen when the
 * timer fires.
 */
export interface TilePaint {
  sceneId: string;
  tilesetId: string;
  paint: Record<string, string>;
  erase: string[];
  clear?: boolean;
}

/**
 * Paint or erase cells as a delta — one request per stroke, not per cell.
 *
 * The response carries the whole updated scene, so it is written straight into
 * the composed-scene cache: the floor appears the moment the POST lands. The
 * old `invalidateScene` threw that payload away and refetched, and then the
 * server's own `scene.updated` broadcast invalidated the same key again — one
 * stroke cost a POST plus up to two full composed-scene GETs, and the paint
 * did not show until the first of them came back.
 */
export function usePaintTiles() {
  return useMutation({
    mutationFn: async ({ sceneId, ...body }: TilePaint) =>
      (await apiPost<{ scene: Scene; painted: number }>(`/api/scenes/${sceneId}/tiles`, body)).scene,
    onSuccess: (scene, vars) => {
      queryClient.setQueryData<ComposedScene>(['scene', vars.sceneId], (old) =>
        old ? { ...old, scene } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['scenes'] });
    },
  });
}

export interface TileStrokeOptions {
  send(body: TilePaint): Promise<unknown>;
  /** A stroke the server refused; its cells are back in the buffer. */
  onError?(error: unknown): void;
  /** Idle window before an un-ended stroke drains itself. */
  idleMs?: number;
}

/**
 * Coalesces a paint drag into one request.
 *
 * A stroke raises one callback per cell; the server wants one per stroke,
 * because each write is a full read-modify-write of the layer and two in
 * flight lose each other's cells. This lived inline in `GridPage` as a bare
 * `setTimeout` and got four things wrong, all of which cost the GM work:
 *
 *   1. it stamped the buffer with whatever tileset was selected AT THAT MOMENT,
 *      on every cell. Switching sets mid-stroke submitted set-A tile ids under
 *      set B — a 400 `unknown_tile` that silently dropped the whole stroke, or,
 *      for the ids that exist in several sets (`wall`, `door`, `floor`), cells
 *      painted with the wrong tile. A stroke belongs to one scene and one
 *      tileset; changing either flushes what is buffered first.
 *   2. it cleared the buffer synchronously before the request resolved, and
 *      the mutation declared no error path, so any 400/500/offline answer ate
 *      the stroke with no feedback at all. A refused stroke now comes BACK into
 *      the buffer and is reported.
 *   3. it had no unmount cleanup: navigating away within the idle window
 *      dropped the timer and the cells with it. `dispose()` flushes.
 *   4. it re-armed on every cell, making it a debounce over painting ACTIVITY
 *      rather than a per-stroke flush. `flush()` is now called on pointerup
 *      (`StageCallbacks.onTileStrokeEnd`); the timer is the fallback for a
 *      gesture that never reports an end.
 */
export class TileStrokeBuffer {
  private sceneId: string | null = null;
  private tilesetId: string | null = null;
  private readonly paint = new Map<string, string>();
  private readonly erase = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TileStrokeOptions) {}

  /** Cells waiting to be sent. */
  get pending(): number {
    return this.paint.size + this.erase.size;
  }

  /** Buffer one cell. `tileId` null erases it. */
  add(sceneId: string, tilesetId: string, key: string, tileId: string | null): void {
    if (
      (this.sceneId !== null && this.sceneId !== sceneId) ||
      (this.tilesetId !== null && this.tilesetId !== tilesetId)
    ) {
      this.flush();
    }
    this.sceneId = sceneId;
    this.tilesetId = tilesetId;
    if (tileId === null) {
      this.erase.add(key);
      this.paint.delete(key);
    } else {
      this.paint.set(key, tileId);
      this.erase.delete(key);
    }
    this.arm();
  }

  /** Send what is buffered: stroke end, scene/tileset change, unmount. */
  flush(): void {
    this.cancelTimer();
    const sceneId = this.sceneId;
    const tilesetId = this.tilesetId;
    if (sceneId === null || tilesetId === null || this.pending === 0) return;
    const body: TilePaint = {
      sceneId,
      tilesetId,
      paint: Object.fromEntries(this.paint),
      erase: [...this.erase],
    };
    this.paint.clear();
    this.erase.clear();
    this.sceneId = null;
    this.tilesetId = null;
    void this.opts.send(body).catch((error: unknown) => {
      this.restore(body);
      this.opts.onError?.(error);
    });
  }

  /** Flush anything outstanding; the component is going away. */
  dispose(): void {
    this.flush();
  }

  /**
   * Put a refused stroke's cells back, WITHOUT re-arming the timer: a
   * deterministic 400 would otherwise retry forever. They ride out with the
   * GM's next stroke, and the notice tells them to make one. Cells the GM has
   * since re-edited win — the buffer holds their latest intent, not ours.
   */
  private restore(body: TilePaint): void {
    if (this.sceneId !== null && (this.sceneId !== body.sceneId || this.tilesetId !== body.tilesetId)) {
      return; // the GM moved to another scene or set; these cells cannot merge
    }
    this.sceneId = body.sceneId;
    this.tilesetId = body.tilesetId;
    for (const [key, tileId] of Object.entries(body.paint)) {
      if (!this.erase.has(key) && !this.paint.has(key)) this.paint.set(key, tileId);
    }
    for (const key of body.erase) {
      if (!this.paint.has(key) && !this.erase.has(key)) this.erase.add(key);
    }
  }

  private arm(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.opts.idleMs ?? 140);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
