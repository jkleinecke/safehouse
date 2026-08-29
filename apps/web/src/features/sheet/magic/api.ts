/**
 * Data layer for the Magic tab (FR8.2–FR8.4).
 *
 * One read carries the whole surface — `GET /api/characters/:id/magic/derived`
 * answers with the character derived WITH bonded foci and spirit-sustaining in
 * the pipeline, plus the spirit list, the focus rack, the sustained report and
 * the reagent count. It hydrates on mount and on reconnect like every other
 * sheet query (LIVE-1): the tab never renders from live events alone, it
 * renders the server's state and lets events refine it.
 *
 * Writes are optimistic exactly where the table needs them to be — spending a
 * service, flipping a focus, spending a dram — and every one of them is
 * reconciled twice over: the response body replaces the guess, and the
 * `magic.updated` event that follows folds in through `useMagicLive`.
 *
 * `GET …/derived` and `GET …/magic/derived` now compose `situational` through
 * the same server-side composer (`services/magic-derive.ts`), so they agree
 * about a pool while a focus is switched on and this query is a convenience —
 * the whole magic surface in one read — rather than a correction.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SheetV1 } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../api/client.js';
import { liveKeys } from '../../../api/live.js';
import { useLiveStore } from '../../../live/store.js';
import { characterKey, HYDRATE_ON_MOUNT } from '../api.js';
import { applyMagicEvent } from './events.js';
import {
  applyFocusPatchLocal,
  replaceSpirit,
  reagentsAfterRestock,
  reagentsAfterSpend,
  spendServiceLocal,
} from './lib.js';
import { normalizeMagicView, normalizeSpirit, type MagicView } from './types.js';

export const magicKey = (characterId: string) => [...characterKey(characterId), 'magic'] as const;

const magicPath = (characterId: string) => `/api/characters/${characterId}/magic/derived`;

export function useMagicView(characterId: string | undefined) {
  return useQuery({
    queryKey: magicKey(characterId ?? ''),
    queryFn: async (): Promise<MagicView> =>
      normalizeMagicView(await apiGet<unknown>(magicPath(characterId as string)), characterId as string),
    enabled: Boolean(characterId),
    // A 403 means "not your sheet" — an answer, not something to spin on.
    retry: false,
    ...HYDRATE_ON_MOUNT,
  });
}

/** Context the optimistic focus toggle needs to re-derive locally. */
export interface PreviewContext {
  sheet: SheetV1;
  wounds: { physical: number; stun: number };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readView(qc: QueryClient, characterId: string): MagicView | undefined {
  return qc.getQueryData<MagicView>(magicKey(characterId));
}

function writeView(qc: QueryClient, characterId: string, next: MagicView): void {
  qc.setQueryData<MagicView>(magicKey(characterId), next);
}

function patchView(
  qc: QueryClient,
  characterId: string,
  fn: (view: MagicView) => MagicView,
): MagicView | undefined {
  const prev = readView(qc, characterId);
  if (!prev) return undefined;
  writeView(qc, characterId, fn(prev));
  return prev;
}

/** Replace the cached view from a route that answered with the whole thing. */
function adoptView(qc: QueryClient, characterId: string, body: unknown): void {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const derived = r['derived'];
  if (typeof derived !== 'object' || derived === null || !('foci' in derived)) return;
  writeView(qc, characterId, normalizeMagicView(derived, characterId));
}

function restore(qc: QueryClient, characterId: string, prev: MagicView | undefined): void {
  if (prev) writeView(qc, characterId, prev);
}

// ---------------------------------------------------------------------------
// Spirits (FR8.3)
// ---------------------------------------------------------------------------

const spiritPath = (campaignId: string, spiritId: string) =>
  `/api/campaigns/${campaignId}/magic/spirits/${spiritId}`;

// The bare requests, separate from the React plumbing, so the route and the
// body a table action actually sends can be asserted without a DOM.

/** `POST …/spirits/:id/services` — the one-tap countdown (FR8.3). */
export const spendSpiritService = (
  campaignId: string,
  spiritId: string,
  count = 1,
  reason?: string,
) =>
  apiPost<unknown>(`${spiritPath(campaignId, spiritId)}/services`, {
    op: 'spend',
    count,
    ...(reason ? { reason } : {}),
  });

/** `POST …/spirits/:id/join` — the spirit becomes a combatant on the tracker. */
export const sendSpiritToEncounter = (campaignId: string, spiritId: string, encounterId: string) =>
  apiPost<unknown>(`${spiritPath(campaignId, spiritId)}/join`, { encounterId });

/** `PATCH /api/characters/:id/foci/:focusId` — bond / unbond / flip (FR8.4). */
export const patchFocusRequest = (
  characterId: string,
  focusId: string,
  patch: { active?: boolean; bonded?: boolean },
) => apiPatch<unknown>(`/api/characters/${characterId}/foci/${focusId}`, patch);

/** `POST /api/characters/:id/reagents` — spend / restock / set (FR8.4). */
export const reagentRequest = (
  characterId: string,
  op: 'spend' | 'restock' | 'set',
  amount: number,
) => apiPost<unknown>(`/api/characters/${characterId}/reagents`, { op, amount });

export interface SummonInput {
  spiritType: string;
  force: number;
  services: number;
  bound: boolean;
  name?: string;
}

export function useSummonSpirit(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SummonInput) =>
      apiPost<unknown>(`/api/campaigns/${campaignId}/magic/spirits`, { characterId, ...input }),
    onSuccess: (body) => {
      const spirit = normalizeSpirit((body as { spirit?: unknown } | null)?.spirit);
      if (spirit) {
        patchView(qc, characterId, (v) => ({ ...v, spirits: replaceSpirit(v.spirits, spirit) }));
      }
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: magicKey(characterId) }),
  });
}

/**
 * One tap: spend a service. The count drops immediately, floored at zero by the
 * engine's own arithmetic, and the server's answer (then the event) settles it.
 */
export function useSpendService(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spiritId, count = 1, reason }: { spiritId: string; count?: number; reason?: string }) =>
      spendSpiritService(campaignId, spiritId, count, reason),
    onMutate: async ({ spiritId, count = 1 }) => {
      await qc.cancelQueries({ queryKey: magicKey(characterId) });
      const prev = patchView(qc, characterId, (v) => ({
        ...v,
        spirits: spendServiceLocal(v.spirits, spiritId, count).spirits,
      }));
      return { prev };
    },
    onError: (_e, _vars, ctx) => restore(qc, characterId, ctx?.prev),
    onSuccess: (body) => {
      const spirit = normalizeSpirit((body as { spirit?: unknown } | null)?.spirit);
      if (spirit) {
        patchView(qc, characterId, (v) => ({ ...v, spirits: replaceSpirit(v.spirits, spirit) }));
      }
    },
  });
}

/** Bind / unbind / rename / re-Force a spirit (Principle 2). */
export function useSpiritPatch(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spiritId, patch }: { spiritId: string; patch: Record<string, unknown> }) =>
      apiPatch<unknown>(spiritPath(campaignId, spiritId), patch),
    onMutate: async ({ spiritId, patch }) => {
      await qc.cancelQueries({ queryKey: magicKey(characterId) });
      const prev = patchView(qc, characterId, (v) => ({
        ...v,
        spirits: v.spirits.map((s) =>
          s.id === spiritId && typeof patch['bound'] === 'boolean' ? { ...s, bound: patch['bound'] } : s,
        ),
      }));
      return { prev };
    },
    onError: (_e, _vars, ctx) => restore(qc, characterId, ctx?.prev),
    onSuccess: (body) => {
      const spirit = normalizeSpirit((body as { spirit?: unknown } | null)?.spirit);
      if (spirit) {
        patchView(qc, characterId, (v) => ({ ...v, spirits: replaceSpirit(v.spirits, spirit) }));
      }
    },
  });
}

export function useDismissSpirit(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spiritId: string) => apiPost<unknown>(`${spiritPath(campaignId, spiritId)}/dismiss`),
    // Dismissing releases whatever the spirit was holding, which puts the −2
    // back on the caster — only the server can say what the pools are now.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: magicKey(characterId) });
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/** Hand a sustained spell to a spirit, or take it back (FR8.2 × FR8.3). */
export function useSpiritSustain(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spiritId, sustainedId }: { spiritId: string; sustainedId: string | null }) =>
      apiPost<unknown>(`${spiritPath(campaignId, spiritId)}/sustain`, { sustainedId }),
    onSuccess: (body) => adoptView(qc, characterId, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: magicKey(characterId) });
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

/**
 * Send the spirit into the fight: the server adds it through the encounters
 * service's own `addCombatant`, so its initiative, monitors and pools are
 * derived by the ordinary engine and the row behaves like every other
 * combatant afterwards.
 */
export function useSpiritJoin(campaignId: string, characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spiritId, encounterId }: { spiritId: string; encounterId: string }) =>
      sendSpiritToEncounter(campaignId, spiritId, encounterId),
    onSuccess: (body, { encounterId }) => {
      const spirit = normalizeSpirit((body as { spirit?: unknown } | null)?.spirit);
      if (spirit) {
        patchView(qc, characterId, (v) => ({ ...v, spirits: replaceSpirit(v.spirits, spirit) }));
      }
      void qc.invalidateQueries({ queryKey: liveKeys.encounter(encounterId) });
      void qc.invalidateQueries({ queryKey: liveKeys.encounters(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Foci (FR8.4)
// ---------------------------------------------------------------------------

export interface FocusInput {
  name: string;
  kind?: string;
  force?: number;
  bonded?: boolean;
  active?: boolean;
  sourceKind?: 'power' | 'spell';
  targets?: string[];
  note?: string;
}

export function useAddFocus(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FocusInput) => apiPost<unknown>(`/api/characters/${characterId}/foci`, input),
    onSuccess: (body) => adoptView(qc, characterId, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: magicKey(characterId) }),
  });
}

export function useRemoveFocus(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (focusId: string) =>
      apiDelete<unknown>(`/api/characters/${characterId}/foci/${focusId}`),
    onSuccess: (body) => adoptView(qc, characterId, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: magicKey(characterId) }),
  });
}

/**
 * The toggle FR8.4 is about. The optimistic half re-derives the character in
 * the browser with the new rack, through the SAME engine the server uses, so
 * the pool moves on the tap and its breakdown names the focus — and the
 * response replaces the preview with the authoritative answer a beat later.
 */
export function useFocusToggle(characterId: string, ctx: PreviewContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ focusId, patch }: { focusId: string; patch: { active?: boolean; bonded?: boolean } }) =>
      patchFocusRequest(characterId, focusId, patch),
    onMutate: async ({ focusId, patch }) => {
      await qc.cancelQueries({ queryKey: magicKey(characterId) });
      const prev = patchView(qc, characterId, (view) =>
        applyFocusPatchLocal(view, focusId, patch, ctx),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx2) => restore(qc, characterId, ctx2?.prev),
    onSuccess: (body) => adoptView(qc, characterId, body),
  });
}

// ---------------------------------------------------------------------------
// Reagents (FR8.4) — the counter that cannot go below zero
// ---------------------------------------------------------------------------

export function useReagentOp(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ op, amount }: { op: 'spend' | 'restock' | 'set'; amount: number }) =>
      reagentRequest(characterId, op, amount),
    onMutate: async ({ op, amount }) => {
      await qc.cancelQueries({ queryKey: magicKey(characterId) });
      const prev = patchView(qc, characterId, (v) => ({
        ...v,
        reagents:
          op === 'spend'
            ? reagentsAfterSpend(v.reagents, amount).after
            : op === 'restock'
              ? reagentsAfterRestock(v.reagents, amount).after
              : Math.max(0, Math.trunc(amount)),
      }));
      return { prev };
    },
    onError: (_e, _vars, ctx) => restore(qc, characterId, ctx?.prev),
    onSuccess: (body) => {
      const after = (body as { after?: unknown } | null)?.after;
      if (typeof after === 'number') {
        patchView(qc, characterId, (v) => ({ ...v, reagents: Math.max(0, Math.trunc(after)) }));
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Sustained spells (FR8.2) — first-class server state, so a spirit can hold one
// ---------------------------------------------------------------------------

export interface SustainedOp {
  op: 'add' | 'remove' | 'toggle' | 'clear';
  id?: string;
  name?: string;
  exempt?: boolean;
}

export function useSustainedOp(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SustainedOp) =>
      apiPost<unknown>(`/api/characters/${characterId}/sustained`, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: magicKey(characterId) });
      void qc.invalidateQueries({ queryKey: characterKey(characterId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Live merge (§11) — events refine the hydrated view, never replace it
// ---------------------------------------------------------------------------

/**
 * Fold `magic.updated` frames into the cached view. A service spend arrives as
 * a number and simply lands; anything that moves a pool (a focus, a spirit
 * picking a spell up or being dismissed) re-reads the authoritative view
 * instead of guessing.
 */
export function useMagicLive(characterId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!characterId) return;
    let seen = useLiveStore.getState().lastEventId;
    return useLiveStore.subscribe((state) => {
      if (state.lastEventId <= seen) return;
      const fresh = state.events.filter((e) => e.id > seen && e.type === 'magic.updated');
      seen = state.lastEventId;
      if (fresh.length === 0) return;

      const hydrated = qc.getQueryData<MagicView>(magicKey(characterId));
      if (!hydrated) {
        // Nothing hydrated yet: an event is never a substitute for the read
        // (LIVE-1). Go and get the state instead of assembling it from frames.
        void qc.invalidateQueries({ queryKey: magicKey(characterId) });
        return;
      }

      let view = hydrated;
      let rederive = false;
      let changed = false;
      for (const event of fresh) {
        const effect = applyMagicEvent(view, event);
        view = effect.view;
        rederive = rederive || effect.rederive;
        changed = changed || effect.changed;
      }
      if (changed) qc.setQueryData<MagicView>(magicKey(characterId), view);
      if (rederive) void qc.invalidateQueries({ queryKey: magicKey(characterId) });
    });
  }, [characterId, qc]);
}
