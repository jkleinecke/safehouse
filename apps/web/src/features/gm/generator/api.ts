/**
 * Generator data layer (M10): archetype templates CRUD, seeded generation
 * (POST /api/generator/npc | /group per DESIGN.md §12), promote-to-template
 * (FR10.3), encounter building (FR10.4), and PC sheets for the threat
 * readout (FR10.5).
 *
 * Request/response shapes follow the server's GeneratorService
 * (apps/server/src/services/generator.ts): generation answers with
 * `{ seed, prevSeed?, npc | group }`, encounters are built from `parts`.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NpcTemplate, Persona, SheetV1 } from '@safehouse/contracts';
import type { GeneratedGruntGroup, GeneratedNpc } from '@safehouse/rules';
import { apiDelete, apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';
import type { BuildPart } from './roster.js';

// --- Archetype templates (GM-only prep material, FR10.1) --------------------

export function useNpcTemplates(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'npc-templates'],
    queryFn: async () =>
      (await apiGet<{ templates: NpcTemplate[] }>(`/api/campaigns/${campaignId}/npc-templates`))
        .templates,
    enabled: Boolean(campaignId),
  });
}

export type NpcTemplateDraft = Omit<NpcTemplate, 'id'> & { id?: string };

export function useSaveTemplate(campaignId: string) {
  return useMutation({
    mutationFn: async (tpl: NpcTemplateDraft) =>
      (
        await (tpl.id
          ? apiPatch<{ template: NpcTemplate }>(`/api/npc-templates/${tpl.id}`, tpl)
          : apiPost<{ template: NpcTemplate }>(
              `/api/campaigns/${campaignId}/npc-templates`,
              tpl,
            ))
      ).template,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'npc-templates'] });
    },
  });
}

export function useDeleteTemplate(campaignId: string) {
  return useMutation({
    mutationFn: (id: string) => apiDelete<unknown>(`/api/npc-templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'npc-templates'] });
    },
  });
}

// --- Generation (server-authoritative; rules types describe the output) -----

/** Lock aspects the server understands (`LOCK_ASPECTS`, FR10.2). */
export const LOCK_ASPECTS = ['stats', 'metatype', 'name', 'flavor', 'loadout'] as const;
export type LockAspect = (typeof LOCK_ASPECTS)[number];

export interface GenerateNpcBody {
  templateId: string;
  tierId: string;
  seed?: number;
  locks?: LockAspect[];
  /** The roll whose locked aspects to keep — required whenever locks are set. */
  prevSeed?: number;
}

export interface GenerateGroupBody {
  templateId: string;
  tierId: string;
  size: number;
  seed?: number;
}

export interface GenerateNpcResponse {
  seed: number;
  prevSeed?: number;
  npc: GeneratedNpc;
}

export interface GenerateGroupResponse {
  seed: number;
  group: GeneratedGruntGroup;
}

function hasKey<K extends string>(v: unknown, key: K): v is Record<K, unknown> {
  return typeof v === 'object' && v !== null && key in v;
}

/** Tolerate a bare GeneratedNpc as well as the `{ seed, npc }` envelope. */
export function normalizeNpcResponse(raw: unknown): GenerateNpcResponse {
  if (hasKey(raw, 'npc')) return raw as unknown as GenerateNpcResponse;
  const npc = raw as GeneratedNpc;
  return { seed: npc.seed, npc };
}

export function normalizeGroupResponse(raw: unknown): GenerateGroupResponse {
  if (hasKey(raw, 'group')) return raw as unknown as GenerateGroupResponse;
  const group = raw as GeneratedGruntGroup;
  return { seed: group.seed, group };
}

export function useGenerateNpc() {
  return useMutation({
    mutationFn: async (body: GenerateNpcBody) =>
      normalizeNpcResponse(await apiPost<unknown>('/api/generator/npc', body)),
  });
}

export function useGenerateGroup() {
  return useMutation({
    mutationFn: async (body: GenerateGroupBody) =>
      normalizeGroupResponse(await apiPost<unknown>('/api/generator/group', body)),
  });
}

// --- Promote to template (FR10.3: one click, edits round-trip) --------------

/**
 * POST /api/generator/promote. The server re-derives exactly the roll the GM
 * is looking at from `templateId + tierId + seed`, so a hand-edited
 * `statblock` is an override rather than the only record of what was rolled
 * (FR10.3 — edits round-trip). The promoted copy inherits the source's gen
 * params server-side; the client never has to carry them.
 */
export interface PromoteBody {
  kind?: 'npc' | 'group';
  templateId: string;
  tierId: string;
  seed: number;
  prevSeed?: number;
  locks?: LockAspect[];
  size?: number;
  name?: string;
  statblock?: SheetV1;
  persona?: Partial<Persona>;
}

export interface PromoteResponse {
  template: NpcTemplate;
  promotedFrom: { templateId: string; tierId: string; seed: number; kind: string };
}

export function usePromoteToTemplate(campaignId: string) {
  return useMutation({
    mutationFn: (body: PromoteBody) => apiPost<PromoteResponse>('/api/generator/promote', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'npc-templates'] });
    },
  });
}

// --- Encounters (M10 planning; M4 owns live play) ---------------------------

export interface EncounterCreateBody {
  campaignId: string;
  name: string;
  /** When set, the build also stages hidden tokens on that scene (FR9.10). */
  sceneId?: string | null;
  /** Template + tier + seed parts — the server rolls them (server-authoritative). */
  parts: BuildPart[];
}

export interface EncounterBuildResult {
  encounter: { id: string; name: string; sceneId: string | null };
  combatants: unknown[];
  tokens: unknown[];
}

/**
 * POST /api/encounters/build — one call rolls every part, creates the
 * encounter and its combatants, and (with a sceneId) stages them as hidden
 * tokens. There is no separate stage step for a generated encounter.
 */
export function useCreateEncounter(campaignId: string) {
  return useMutation({
    mutationFn: (body: EncounterCreateBody) =>
      apiPost<EncounterBuildResult>('/api/encounters/build', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'encounters'] });
      void queryClient.invalidateQueries({ queryKey: ['encounters', campaignId] });
    },
  });
}

/**
 * Stage an EXISTING encounter's combatants onto a scene as hidden tokens
 * (FR9.10) — the scenes plugin owns this, keyed by scene.
 */
export function useStageEncounter() {
  return useMutation({
    mutationFn: ({ sceneId, encounterId }: { sceneId: string; encounterId: string }) =>
      apiPost<unknown>(`/api/scenes/${sceneId}/stage-encounter`, { encounterId }),
  });
}

// --- Party sheets for the readout -------------------------------------------

export interface CharacterWithSheet {
  id: string;
  name: string;
  sheet: SheetV1;
}

interface CharacterListEntry {
  id: string;
  name?: string;
  sheet?: SheetV1;
}

export function usePartySheets(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'party-sheets'],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<CharacterWithSheet[]> => {
      // The list already carries `sheet`; the per-character fetch is a
      // fallback in case a future list trims it.
      const { characters: list } = await apiGet<{ characters: CharacterListEntry[] }>(
        `/api/campaigns/${campaignId}/characters`,
      );
      const out: CharacterWithSheet[] = [];
      for (const entry of list) {
        let sheet = entry.sheet;
        let name = entry.name;
        if (!sheet) {
          const full = await apiGet<CharacterListEntry>(`/api/characters/${entry.id}`);
          sheet = full.sheet;
          name = name ?? full.name;
        }
        if (sheet) out.push({ id: entry.id, name: name ?? entry.id, sheet });
      }
      return out;
    },
  });
}

// INTEGRATION: the server also computes the readout authoritatively
// (GeneratorService.threatReadout / threatRecompute). The builder recomputes
// locally with the same heuristics so levers are instant; wire a
// GET/POST /api/encounters/:id/threat here if the plugin exposes one.
