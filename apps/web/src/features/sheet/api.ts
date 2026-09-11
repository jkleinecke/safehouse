/**
 * Sheet-feature data layer: character, derived values, ledger, contacts,
 * active-scene environment — TanStack Query over the REST API (DESIGN.md §12)
 * with the shared rules engine as a local fallback so the sheet stays usable
 * while the server characters plugin is still landing (Principle 5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DerivedCharacter,
  LedgerEntry,
  Modifier,
  Scene,
  SheetV1,
} from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter, environment } from '@safehouse/rules';
import { api, apiDelete, apiGet, apiPatch, apiPost } from '../../api/client.js';
import { useLiveStore } from '../../live/store.js';
import { useCampaign } from '../../api/campaigns.js';
import { getSession } from '../../api/session.js';
import { blitz, closeCall, seizeInitiative } from './edgeActions.js';
import { edgeAfter, type ConditionState, type EdgeOp } from './lib.js';
import {
  fetchMacros,
  saveMacros,
  type DiceMacro,
  type MacroSnapshot,
} from './macroStore.js';

// ---------------------------------------------------------------------------
// Character record
// ---------------------------------------------------------------------------

/**
 * GET /api/characters/:id → `characterDto` (DESIGN.md §9.2 `characters`).
 *
 * Filled monitor boxes are NOT on the sheet: they are this turn's state and
 * live in `play.monitors` (FR3.4), which is why damage does not create a
 * revision. `condition` is that, flattened for the components.
 * `balances` are ledger sums, never sheet numbers (FR3.6).
 */
export interface CharacterRecord {
  id: string;
  campaignId: string;
  ownerUserId?: string;
  name: string;
  status?: string;
  sheet: SheetV1;
  condition: ConditionState;
  /** Edge burned permanently — the loud action (FR2.3). */
  edgeBurned: number;
  balances: { karma: number; nuyen: number };
  sheetVersion?: number;
}

/** `GET /api/characters/:id` → the record the sheet renders (LIVE-1: this is
 * the whole state on mount; WebSocket events only ever refine it). */
export function normalizeCharacter(raw: unknown): CharacterRecord {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const parsed = SheetV1Schema.safeParse(r['sheet']);
  const play = (r['play'] ?? {}) as Record<string, unknown>;
  const monitors = (play['monitors'] ?? {}) as Record<string, unknown>;
  const balances = (r['balances'] ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    id: String(r['id'] ?? ''),
    campaignId: String(r['campaignId'] ?? ''),
    ownerUserId: typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : undefined,
    name: String(r['name'] ?? 'Unknown'),
    status: typeof r['status'] === 'string' ? r['status'] : undefined,
    sheet: parsed.success ? parsed.data : (r['sheet'] as SheetV1),
    condition: { physical: num(monitors['physical']), stun: num(monitors['stun']) },
    edgeBurned: num(play['edgeBurned']),
    balances: { karma: num(balances['karma']), nuyen: num(balances['nuyen']) },
    sheetVersion: typeof r['sheetVersion'] === 'number' ? r['sheetVersion'] : undefined,
  };
}

export const characterKey = (id: string) => ['character', id] as const;

/**
 * Hydration policy for every live-play query on the sheet (LIVE-1).
 *
 * The web UI used to render only what arrived over the WebSocket while it was
 * mounted, so a phone that reloaded mid-session showed an empty world. The
 * sheet's own cure is this: each of its queries refetches on mount and on
 * reconnect, so opening the sheet — or coming back to it after a lock screen —
 * always starts from the server's state and merges live events on top of that,
 * never on top of nothing.
 */
export const HYDRATE_ON_MOUNT = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnReconnect: 'always',
} as const;

export function useCharacter(characterId: string | undefined) {
  return useQuery({
    queryKey: characterKey(characterId ?? ''),
    queryFn: async () => normalizeCharacter(await apiGet<unknown>(`/api/characters/${characterId}`)),
    enabled: Boolean(characterId),
    ...HYDRATE_ON_MOUNT,
  });
}

// ---------------------------------------------------------------------------
// Derived values — GET /derived, local rules-engine fallback
// ---------------------------------------------------------------------------

function looksDerived(v: unknown): v is DerivedCharacter {
  return typeof v === 'object' && v !== null && 'pools' in v && 'limits' in v;
}

/**
 * The whole live-play picture behind `GET /api/characters/:id/derived`
 * (`services/characters.ts DerivedView`), not just the numbers.
 *
 * `combatantId` is what makes Seize the Initiative and Blitz offerable — it is
 * non-null exactly when this character has a row in a running encounter.
 * `situational` is the list of modifiers the server ALREADY applied (scene
 * environment, sustained spells); the roll dialog shows them as context and
 * must never add them again (LIVE-2).
 */
export interface DerivedView {
  derived: DerivedCharacter;
  situational: Modifier[];
  activeSceneId: string | null;
  encounterId: string | null;
  combatantId: string | null;
  wounds: { physical: number; stun: number; overflow: number };
  edge?: { max: number; current: number; burned: number };
  /** False when this came from the browser's own engine, not the server. */
  authoritative: boolean;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export function normalizeDerivedView(raw: unknown): DerivedView | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const body = 'derived' in r ? r['derived'] : raw;
  if (!looksDerived(body)) return null;
  const wounds = (r['wounds'] ?? {}) as Record<string, unknown>;
  const edge = r['edge'] as { max: number; current: number; burned: number } | undefined;
  return {
    derived: body,
    situational: Array.isArray(r['situational']) ? (r['situational'] as Modifier[]) : [],
    activeSceneId: typeof r['activeSceneId'] === 'string' ? r['activeSceneId'] : null,
    encounterId: typeof r['encounterId'] === 'string' ? r['encounterId'] : null,
    combatantId: typeof r['combatantId'] === 'string' ? r['combatantId'] : null,
    wounds: {
      physical: num(wounds['physical']),
      stun: num(wounds['stun']),
      overflow: num(wounds['overflow']),
    },
    ...(edge && typeof edge === 'object' ? { edge } : {}),
    authoritative: true,
  };
}

/**
 * GET /api/characters/:id/derived (FR3.3). Falls back to running
 * @safehouse/rules in the browser if the request fails, so the sheet stays
 * readable offline (Principle 5) — and the fallback is given the SAME scene
 * environment the server would have applied, so the offline pool matches the
 * online one instead of quietly reading a point high.
 */
export function useDerivedView(character: CharacterRecord | undefined) {
  const sceneEnv = useActiveSceneEnv(character?.campaignId);
  return useQuery({
    // The scene is deliberately NOT part of the key: the online path does not
    // read it, and re-keying on it would refetch the whole sheet every time a
    // scene event landed. `useSheetLive` invalidates this query on
    // scene.activated / scene.updated instead, which re-runs the fallback with
    // the fresh environment.
    queryKey: [...characterKey(character?.id ?? ''), 'derived'],
    queryFn: async (): Promise<DerivedView> => {
      try {
        const view = normalizeDerivedView(
          await apiGet<unknown>(`/api/characters/${character?.id}/derived`),
        );
        if (view) return view;
      } catch {
        // fall through to the local engine
      }
      const c = character as CharacterRecord;
      const situational = sceneEnv?.mods ?? [];
      return {
        derived: deriveCharacter(c.sheet, { situational, wounds: c.condition }),
        situational,
        activeSceneId: sceneEnv?.sceneId ?? null,
        encounterId: null,
        combatantId: null,
        wounds: { physical: c.condition.physical, stun: c.condition.stun, overflow: 0 },
        authoritative: false,
      };
    },
    enabled: Boolean(character?.id && character?.sheet),
    ...HYDRATE_ON_MOUNT,
  });
}

// ---------------------------------------------------------------------------
// Sheet mutations (PATCH /api/characters/:id — mutations create revisions)
// ---------------------------------------------------------------------------

export function useSheetMutation(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sheet: SheetV1) =>
      apiPatch<unknown>(`/api/characters/${characterId}`, { sheet }),
    onMutate: async (sheet) => {
      await qc.cancelQueries({ queryKey: characterKey(characterId) });
      const prev = qc.getQueryData<CharacterRecord>(characterKey(characterId));
      if (prev) qc.setQueryData<CharacterRecord>(characterKey(characterId), { ...prev, sheet });
      return { prev };
    },
    onError: (_err, _sheet, ctx) => {
      if (ctx?.prev) qc.setQueryData(characterKey(characterId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/**
 * The picture that stands for this character on the battle map (FR9.4).
 *
 * Its own route rather than a sheet PATCH, for three reasons that all live on
 * the server and are worth knowing here: the attachment has to be stored
 * PUBLIC or every player and the TV get a 404 they cannot see; tokens already
 * on the map have to be repointed, since they snapshot the portrait when they
 * were placed; and a change of picture must not burn a sheet revision, which
 * is the rollback history for a character's build.
 *
 * Guarded by the same owner-or-GM rule as the sheet itself, so a player
 * dresses their own runner and the GM can do it for anybody.
 */
export interface PortraitResult {
  portraitId: string | null;
  /** How many tokens already on a map followed the change. */
  tokens: number;
}

export function useUploadPortrait(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<PortraitResult>(`/api/characters/${characterId}/portrait`, {
        method: 'POST',
        body: form,
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

export function useClearPortrait(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete<PortraitResult>(`/api/characters/${characterId}/portrait`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/**
 * May this device change that character's picture?
 *
 * Mirrors the server's `assertCanEdit` — owner or GM — so we do not offer a
 * control that would 403. The server is still the one that decides; this is a
 * courtesy, not a boundary, and it is written to fail in the courteous
 * direction.
 *
 * UNKNOWN COUNTS AS MAYBE. `Session.userId` is optional: a device that signed
 * in by pasting a token has a role and a campaign and no user id at all, which
 * is a supported way in. Treating that as "not the owner" hid the control from
 * the person it belongs to and said nothing about why — a silent, inexplicable
 * absence. Showing it costs at worst one 403 with a sentence attached, which
 * is a failure somebody can actually read.
 */
export function canEditCharacter(character: {
  ownerUserId?: string | null | undefined;
}): boolean {
  const session = getSession();
  if (!session) return false;
  if (session.role === 'gm') return true;
  if (session.role !== 'player') return false;
  // No user id on this device: we cannot tell, so let the server answer.
  if (session.userId === undefined) return true;
  return character.ownerUserId === session.userId;
}

/**
 * Tap-to-damage/heal (FR3.4) via POST /api/characters/:id/damage `{ monitor,
 * boxes, op }`. Monitors are live-play state, not a sheet edit, so this
 * deliberately does NOT go through PATCH and does not snapshot a revision.
 * The absolute box count is sent with `op: 'set'` — the tap UI already
 * computed the target, and a delta would drift against concurrent damage.
 */
export function useConditionMutation(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (condition: ConditionState) => {
      const prev = qc.getQueryData<CharacterRecord>(characterKey(characterId))?.condition;
      const calls: Array<Promise<unknown>> = [];
      if (!prev || prev.physical !== condition.physical) {
        calls.push(
          apiPost<unknown>(`/api/characters/${characterId}/damage`, {
            monitor: 'physical',
            boxes: condition.physical,
            op: 'set',
          }),
        );
      }
      if (!prev || prev.stun !== condition.stun) {
        calls.push(
          apiPost<unknown>(`/api/characters/${characterId}/damage`, {
            monitor: 'stun',
            boxes: condition.stun,
            op: 'set',
          }),
        );
      }
      return Promise.all(calls);
    },
    onMutate: async (condition) => {
      await qc.cancelQueries({ queryKey: characterKey(characterId) });
      const prev = qc.getQueryData<CharacterRecord>(characterKey(characterId));
      if (prev)
        qc.setQueryData<CharacterRecord>(characterKey(characterId), { ...prev, condition });
      return { prev };
    },
    onError: (_e, _c, ctx) => {
      if (ctx?.prev) qc.setQueryData(characterKey(characterId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/**
 * Edge spend / burn / regain (FR2.3, FR3.4) via POST /api/characters/:id/edge.
 * The server's vocabulary is spend | burn | refresh | set; the UI's "regain"
 * is one point back, which is `set` to current+1 — `refresh` restores the
 * whole pool and belongs to the between-runs beat, not a tap.
 */
export function useEdgeMutation(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: EdgeOp) => {
      const prev = qc.getQueryData<CharacterRecord>(characterKey(characterId));
      if (op === 'regain') {
        const edg = prev?.sheet.attributes.edg;
        const next = edg ? edgeAfter(edg, 'regain').current : 1;
        return apiPost<unknown>(`/api/characters/${characterId}/edge`, {
          op: 'set',
          amount: next,
        });
      }
      return apiPost<unknown>(`/api/characters/${characterId}/edge`, { op, amount: 1 });
    },
    onMutate: async (op) => {
      await qc.cancelQueries({ queryKey: characterKey(characterId) });
      const prev = qc.getQueryData<CharacterRecord>(characterKey(characterId));
      if (prev) {
        qc.setQueryData<CharacterRecord>(characterKey(characterId), {
          ...prev,
          sheet: {
            ...prev.sheet,
            attributes: {
              ...prev.sheet.attributes,
              edg: edgeAfter(prev.sheet.attributes.edg, op),
            },
          },
        });
      }
      return { prev };
    },
    onError: (_e, _op, ctx) => {
      if (ctx?.prev) qc.setQueryData(characterKey(characterId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Ledger (FR3.6)
// ---------------------------------------------------------------------------

function normalizeEntries(raw: unknown): LedgerEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: unknown[] }).entries
      : [];
  return list as LedgerEntry[];
}

/** GET /api/characters/:id/ledger → `{ characterId, entries, balances }`. */
export function useLedger(characterId: string | undefined) {
  return useQuery({
    queryKey: [...characterKey(characterId ?? ''), 'ledger'],
    queryFn: async () =>
      normalizeEntries(await apiGet<unknown>(`/api/characters/${characterId}/ledger`)),
    enabled: Boolean(characterId),
    ...HYDRATE_ON_MOUNT,
  });
}

export interface SpendProposal {
  currency: 'karma' | 'nuyen';
  /** Positive amount; sent as a negative delta (a spend). */
  amount: number;
  reason: string;
}

export function useProposeSpend(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: SpendProposal) =>
      apiPost<unknown>(`/api/characters/${characterId}/ledger`, {
        currency: p.currency,
        delta: -Math.abs(p.amount),
        reason: p.reason,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...characterKey(characterId), 'ledger'] });
    },
  });
}

// Contacts (FR3.2 tab / FR5.8) live in `./contacts.ts`.

// ---------------------------------------------------------------------------
// Edge actions beyond the dice (FR2.3/FR4.4) — POST /api/edge/*
// ---------------------------------------------------------------------------

/**
 * Seize the Initiative / Blitz / Close Call. The server debits the point,
 * moves the tracker and posts the loud log line; all this does is fire the
 * call and re-hydrate the sheet so the Edge track catches up immediately
 * rather than waiting for the event to come back round.
 */
export function useEdgeActionMutation(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      req:
        | { action: 'seize_initiative' | 'blitz'; combatantId: string }
        | { action: 'close_call'; rollId: string; combatantId?: string | null },
    ) => {
      if (req.action === 'close_call') return closeCall(req.rollId, req.combatantId ?? null);
      return req.action === 'blitz' ? blitz(req.combatantId) : seizeInitiative(req.combatantId);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Personal macros (FR2.8) — server-backed, local mirror (see macroStore.ts)
// ---------------------------------------------------------------------------

export const macroKeyFor = (campaignId: string, userId: string | undefined) =>
  ['macros', campaignId, userId ?? 'device'] as const;

export function useMacros(campaignId: string | undefined) {
  const userId = getSession()?.userId;
  return useQuery({
    queryKey: macroKeyFor(campaignId ?? '', userId),
    queryFn: () => fetchMacros(campaignId as string, userId),
    enabled: Boolean(campaignId),
    ...HYDRATE_ON_MOUNT,
  });
}

export function useMacroMutation(campaignId: string | undefined) {
  const qc = useQueryClient();
  const userId = getSession()?.userId;
  const key = macroKeyFor(campaignId ?? '', userId);
  return useMutation({
    mutationFn: (macros: DiceMacro[]) => saveMacros(campaignId as string, userId, macros),
    onMutate: async (macros) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MacroSnapshot>(key);
      qc.setQueryData<MacroSnapshot>(key, {
        macros,
        hasRemote: prev?.hasRemote ?? false,
        ...(prev?.degraded ? { degraded: true } : {}),
      });
      return { prev };
    },
    onError: (_e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (snapshot) => qc.setQueryData<MacroSnapshot>(key, snapshot),
  });
}

// ---------------------------------------------------------------------------
// Active scene environment (FR9.11) — CONTEXT ONLY on the sheet.
//
// LIVE-2: these modifiers are already inside every pool `GET …/derived`
// returns, so nothing may add them to a roll a second time. The roll dialog
// reads the scene lines out of the pool's own breakdown and labels them
// "already in this pool"; this hook survives to name the scene and to feed the
// offline fallback derive the same environment the server would have used.
// ---------------------------------------------------------------------------

export interface SceneEnvInfo {
  sceneId: string;
  sceneName: string;
  mods: Modifier[];
}

/**
 * The active scene's environment as `scene` Modifiers. Scene id comes from the
 * live store (scene.activated) with the campaign record as fallback; env →
 * modifiers via the shared rules engine.
 */
export function useActiveSceneEnv(campaignId: string | undefined): SceneEnvInfo | null {
  const liveSceneId = useLiveStore((s) => s.activeSceneId);
  const { data: campaign } = useCampaign(campaignId);
  const sceneId = liveSceneId ?? campaign?.activeSceneId ?? null;

  const { data } = useQuery({
    // Same route and key as the Grid's composed-scene query, so the two share
    // one fetch; `select` narrows it to the env chips this feature needs.
    queryKey: ['scene', sceneId],
    queryFn: () => apiGet<{ scene: Scene }>(`/api/scenes/${sceneId}`),
    select: (data): SceneEnvInfo | null => {
      const scene = data?.scene;
      if (!scene?.environment) return null;
      return {
        sceneId: scene.id,
        sceneName: scene.name,
        mods: environment(scene.environment),
      };
    },
    // A player with no active scene gets a 404 here; that is not an error
    // worth retrying, it just means no env chip.
    retry: false,
    enabled: Boolean(sceneId),
    staleTime: 30_000,
  });

  return data ?? null;
}

// ---------------------------------------------------------------------------
// History — GET /revisions, GET /revisions/:seq, POST /rollback (FR3.8), and
// POST /import (FR3.1 re-import, diff first). Routes as old as the sheet; the
// History tab is their first caller (docs/UX_AUDIT.md).
// ---------------------------------------------------------------------------

/** One row of `GET /api/characters/:id/revisions` (`services/characters.ts RevisionSummary`). */
export interface RevisionSummary {
  seq: number;
  cause: string;
  createdBy: string | null;
  createdAt: string;
}

/** One field's change, `services/chummer.ts diffSheets`: arrays keyed by item name. */
export interface SheetDiffEntry {
  path: string;
  op: 'added' | 'removed' | 'changed';
  from?: unknown;
  to?: unknown;
}

/** `GET /revisions/:seq`: that sheet, and what rolling back to it would change. */
export interface RevisionDetail {
  characterId: string;
  seq: number;
  sheet: SheetV1;
  diff: SheetDiffEntry[];
}

/** `POST /import`: the diff, applied or not; the import report either way. */
export interface ReimportResult {
  applied: boolean;
  diff: SheetDiffEntry[];
  report?: unknown;
  /** The new revision's seq once applied (`commit()` answers with the number). */
  revision?: number | null;
}

export const revisionsKey = (characterId: string) => [...characterKey(characterId), 'revisions'] as const;

export function useRevisions(characterId: string) {
  return useQuery({
    queryKey: revisionsKey(characterId),
    queryFn: async () =>
      (await apiGet<{ revisions: RevisionSummary[] }>(`/api/characters/${characterId}/revisions`))
        .revisions,
    enabled: Boolean(characterId),
    ...HYDRATE_ON_MOUNT,
  });
}

export function useRevision(characterId: string, seq: number | null) {
  return useQuery({
    queryKey: [...revisionsKey(characterId), seq ?? 0],
    queryFn: () => apiGet<RevisionDetail>(`/api/characters/${characterId}/revisions/${seq}`),
    enabled: Boolean(characterId) && seq !== null,
    staleTime: 0,
  });
}

/** A rollback is a NEW revision (history stays append-only), so everything under the character refetches. */
export function useRollback(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seq: number) =>
      apiPost<{ rolledBackTo: number; revision: number | null }>(
        `/api/characters/${characterId}/rollback`,
        { seq },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/**
 * Re-import a Chummer file over this sheet. Without `confirm` the server
 * answers with the diff and applies nothing; with it, the merged sheet (manual
 * overrides kept) becomes the next revision. One hook, two calls.
 */
export function useReimport(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, confirm }: { file: File; confirm: boolean }) => {
      const form = new FormData();
      form.set('file', file, file.name);
      if (confirm) form.set('confirm', 'true');
      return api<ReimportResult>(`/api/characters/${characterId}/import`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: (result) => {
      if (result.applied) void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}
