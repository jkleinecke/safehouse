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
import { ApiError, apiGet, apiPatch, apiPost } from '../../api/client.js';
import { useLiveStore } from '../../live/store.js';
import { useCampaign } from '../../api/campaigns.js';
import { edgeAfter, type ConditionState, type EdgeOp } from './lib.js';

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

function normalizeCharacter(raw: unknown): CharacterRecord {
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

export function useCharacter(characterId: string | undefined) {
  return useQuery({
    queryKey: characterKey(characterId ?? ''),
    queryFn: async () => normalizeCharacter(await apiGet<unknown>(`/api/characters/${characterId}`)),
    enabled: Boolean(characterId),
  });
}

// ---------------------------------------------------------------------------
// Derived values — GET /derived, local rules-engine fallback
// ---------------------------------------------------------------------------

function looksDerived(v: unknown): v is DerivedCharacter {
  return typeof v === 'object' && v !== null && 'pools' in v && 'limits' in v;
}

/**
 * GET /api/characters/:id/derived → `{ characterId, name, derived, monitors,
 * wounds, edge, … }` (FR3.3). The server folds live wound state in but leaves
 * scene modifiers out — the roll dialog layers scene env as removable chips
 * per DESIGN.md §10.1. Falls back to running @safehouse/rules in the browser
 * if the request fails, so the sheet stays readable offline (Principle 5).
 */
export function useDerived(character: CharacterRecord | undefined) {
  return useQuery({
    queryKey: [...characterKey(character?.id ?? ''), 'derived'],
    queryFn: async (): Promise<DerivedCharacter> => {
      try {
        const raw = await apiGet<unknown>(`/api/characters/${character?.id}/derived`);
        const body =
          typeof raw === 'object' && raw !== null && 'derived' in raw
            ? (raw as { derived: unknown }).derived
            : raw;
        if (looksDerived(body)) return body;
      } catch {
        // fall through to the local engine
      }
      const c = character as CharacterRecord;
      return deriveCharacter(c.sheet, { wounds: c.condition });
    },
    enabled: Boolean(character?.id && character?.sheet),
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

// ---------------------------------------------------------------------------
// Contacts (FR5.8, read-only on the sheet)
// ---------------------------------------------------------------------------

/** INTEGRATION: GET /api/characters/:id/contacts assumed (DESIGN.md §9.2). */
export interface ContactRecord {
  id: string;
  name: string;
  archetype?: string;
  connection: number;
  loyalty: number;
  notes?: string;
  npcPageId?: string | null;
}

export function useContacts(characterId: string | undefined) {
  return useQuery({
    queryKey: [...characterKey(characterId ?? ''), 'contacts'],
    queryFn: async (): Promise<ContactRecord[]> => {
      try {
        const raw = await apiGet<unknown>(`/api/characters/${characterId}/contacts`);
        if (Array.isArray(raw)) return raw as ContactRecord[];
        const c = (raw as { contacts?: unknown })?.contacts;
        return Array.isArray(c) ? (c as ContactRecord[]) : [];
      } catch {
        return []; // contacts endpoint not up yet — render an empty section
      }
    },
    enabled: Boolean(characterId),
  });
}

// ---------------------------------------------------------------------------
// Active scene environment → situational modifier chips (FR9.11)
// ---------------------------------------------------------------------------

export interface SceneEnvInfo {
  sceneId: string;
  sceneName: string;
  mods: Modifier[];
}

/**
 * The active scene's environment as `scene` Modifiers for the roll dialog.
 * Scene id comes from the live store (scene.activated) with the campaign
 * record as fallback; env → modifiers via the shared rules engine.
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
