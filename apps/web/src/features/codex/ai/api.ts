/**
 * The codex's own Fixer wiring (FR12.2/12.15/12.19, Principle 8).
 *
 * There is exactly one generative call in the app — `POST /api/fixer/chat` —
 * and it answers `503 ai_disabled` with no model configured. So "AI in the
 * codex" is not a new endpoint: it is a tightly-written turn whose contract is
 * "call `draft_wiki_page` once", plus the bookkeeping to find the row that turn
 * produced and hand it to the GM as a proposal.
 *
 * Why go through the tool at all instead of just using the reply text: the tool
 * is where the **FR12.19 spoiler guard runs**. `spoilerScan` needs the
 * campaign's GM-only names out of the database, which no browser can compute.
 * A draft that skipped the tool therefore arrives flagged `unverified` and says
 * so on the card, rather than quietly looking like a checked one.
 *
 * How a proposal becomes page text (this is the Principle 8 seam):
 *
 *  - **A new page** (`acceptAsNewPage`) goes through `POST
 *    /api/generations/:id/accept`, which is exactly what that route was built
 *    for: the server inserts the page GM-only and stamps provenance.
 *  - **An existing page** (`applyToPage`) is written by the GM's own
 *    `PATCH /api/wiki/:id`, then the generation is closed. The server's
 *    applier has no update branch — accepting a `wiki_page` draft always
 *    INSERTS — so routing an expand through it would silently create a second
 *    page with the same title instead of filling in the one the GM was
 *    editing. Closing the row is what stops the drafts inbox firing that
 *    duplicate later. Nothing is written until the GM taps accept either way.
 *
 * Every query here hydrates from REST on mount; nothing renders from a live
 * event alone (LIVE-1).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../../api/client.js';
import { spoilerFlagsOf, type AiGeneration } from '../../gm/fixer/api.js';
import type { CodexPage } from '../api.js';
import { codexKeys } from '../keys.js';
import { buildPrompt, type CodexAiAction, type MergeMode, type PromptInput } from './lib.js';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const codexAiKeys = {
  /** Pending `wiki_page` drafts — the codex's slice of the inbox. */
  drafts: (campaignId: string) => ['campaign', campaignId, 'generations', 'wiki_page'] as const,
  /** The whole inbox, dropped whenever we resolve one of its rows. */
  allDrafts: (campaignId: string) => ['campaign', campaignId, 'generations'] as const,
};

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/** One thing the Fixer suggests, sitting in front of the GM, applied to nothing. */
export interface CodexProposal {
  /** `ai_generations.id`, or null when the turn produced no draft row. */
  generationId: string | null;
  action: CodexAiAction;
  /** Where it would land. The GM can change this on the card. */
  mode: MergeMode;
  /** Set when `mode === 'section'`. */
  sectionId?: string;
  title: string;
  kind: string;
  tags: string[];
  contentMd: string;
  /** True when the GM said the table will read this — drives the spoiler scan. */
  playerFacing: boolean;
  /** FR12.19 flags, computed server-side. Empty is not the same as unverified. */
  spoilerFlags: string[];
  model: string | null;
  createdAt: string | null;
  /**
   * No `ai_generations` row backed this text, so the spoiler guard never ran on
   * it. Rendered as a warning, never hidden.
   */
  unverified: boolean;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export interface ProposalSeed {
  action: CodexAiAction;
  mode: MergeMode;
  sectionId?: string;
  playerFacing: boolean;
  fallbackTitle: string;
  fallbackKind: string;
}

/** An `ai_generations` row as the codex reads it. */
export function proposalFromDraft(gen: AiGeneration, seed: ProposalSeed): CodexProposal {
  const out = rec(gen.output);
  return {
    generationId: gen.id,
    action: seed.action,
    mode: seed.mode,
    ...(seed.sectionId !== undefined ? { sectionId: seed.sectionId } : {}),
    title: str(out['title'], seed.fallbackTitle),
    kind: str(out['kind'], seed.fallbackKind),
    tags: strings(out['tags']),
    contentMd: str(out['contentMd']),
    playerFacing: out['playerFacing'] === true || seed.playerFacing,
    spoilerFlags: spoilerFlagsOf(gen),
    model: gen.model ?? null,
    createdAt: gen.createdAt ?? null,
    unverified: false,
  };
}

// ---------------------------------------------------------------------------
// The pending drafts this campaign already has (hydrate on mount)
// ---------------------------------------------------------------------------

async function fetchWikiDrafts(campaignId: string): Promise<AiGeneration[]> {
  const res = await apiGet<{ generations: AiGeneration[] }>(
    `/api/campaigns/${campaignId}/generations?status=draft&kind=wiki_page`,
  );
  return res.generations;
}

/**
 * Codex-page drafts still waiting — including ones the GM asked for from the
 * Fixer chat two screens away. Opening the codex is how you find them now.
 */
export function useWikiDrafts(campaignId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: codexAiKeys.drafts(campaignId ?? ''),
    queryFn: () => fetchWikiDrafts(campaignId!),
    enabled: Boolean(campaignId) && enabled,
    retry: 0,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Ask the Fixer
// ---------------------------------------------------------------------------

export interface AskInput extends PromptInput {
  mode: MergeMode;
  sectionId?: string;
  /** FR12.16 — the fast slot during a live session. */
  slot?: 'primary' | 'fast';
}

interface ChatAck {
  text?: string;
  model?: string;
}

/**
 * One turn, then find what it produced.
 *
 * The chat route returns a tool TRACE, not the tool's result, so the draft is
 * identified by taking the ids before the turn and the ids after: whatever is
 * new is what this request made. That is deliberate rather than clever — it
 * also picks up a draft written during a multi-round turn, and it cannot
 * mistake somebody else's older pending draft for this one.
 */
export function useCodexAsk(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AskInput): Promise<CodexProposal> => {
      const before = new Set((await fetchWikiDrafts(campaignId)).map((d) => d.id));
      const message = buildPrompt(input);
      const ack = await apiPost<ChatAck>('/api/fixer/chat', {
        campaignId,
        message,
        ...(input.slot ? { slot: input.slot } : {}),
      });
      const after = await fetchWikiDrafts(campaignId);
      const fresh = after.filter((d) => !before.has(d.id));
      const seed: ProposalSeed = {
        action: input.action,
        mode: input.mode,
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
        playerFacing: input.playerFacing,
        fallbackTitle: input.ctx.title,
        fallbackKind: input.ctx.kind,
      };
      const gen = fresh[0];
      if (gen) return proposalFromDraft(gen, seed);

      // The model answered without calling the tool. Show the GM what it said
      // rather than swallowing it — but say plainly that no draft row exists
      // and the spoiler guard never ran, so accepting it is a deliberate act.
      return {
        generationId: null,
        action: seed.action,
        mode: seed.mode,
        ...(seed.sectionId !== undefined ? { sectionId: seed.sectionId } : {}),
        title: seed.fallbackTitle,
        kind: seed.fallbackKind,
        tags: input.ctx.tags,
        contentMd: (ack.text ?? '').trim(),
        playerFacing: seed.playerFacing,
        spoilerFlags: [],
        model: ack.model ?? null,
        createdAt: null,
        unverified: true,
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexAiKeys.allDrafts(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Accept / reject
// ---------------------------------------------------------------------------

async function closeGeneration(id: string): Promise<void> {
  // "The server did not apply this" — which is exactly true: the page was
  // written by the GM's own PATCH above, and leaving the row open would let
  // the drafts inbox apply it a SECOND time as a duplicate page.
  await apiPost<unknown>(`/api/generations/${id}/reject`);
}

export interface ApplyInput {
  proposal: CodexProposal;
  /** The merged body the GM is accepting — already what they can see. */
  contentMd: string;
  /** Tags to add alongside (the draft's own, when the GM wants them). */
  tags?: string[];
}

/** Accept into the page the GM is reading: a normal GM edit, then close the row. */
export function useApplyToPage(campaignId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposal, contentMd, tags }: ApplyInput) => {
      const page = (
        await apiPatch<{ page: CodexPage }>(`/api/wiki/${pageId}`, {
          contentMd,
          ...(tags && tags.length > 0 ? { tags } : {}),
        })
      ).page;
      if (proposal.generationId) await closeGeneration(proposal.generationId);
      return page;
    },
    onSuccess: (page) => {
      qc.setQueryData(codexKeys.page(pageId), page);
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.unresolved(campaignId) });
      void qc.invalidateQueries({ queryKey: codexAiKeys.allDrafts(campaignId) });
    },
  });
}

export interface AcceptAsPageInput {
  proposal: CodexProposal;
  /** What the GM is accepting — may differ from the draft if they edited it. */
  contentMd: string;
  title: string;
  kind: string;
}

/**
 * Accept as a brand-new page.
 *
 * Unedited, it goes through the server's own applier so the row is marked
 * accepted and the page carries provenance. Edited, the text is no longer the
 * model's, so the page is created directly and the row is closed — the server
 * ignores an edited body on accept, and writing the un-edited draft after the
 * GM rewrote it would be the one thing Principle 8 exists to prevent.
 */
export function useAcceptAsNewPage(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposal, contentMd, title, kind }: AcceptAsPageInput): Promise<string> => {
      const untouched =
        contentMd.trim() === proposal.contentMd.trim() &&
        title.trim() === proposal.title.trim() &&
        kind === proposal.kind;
      if (proposal.generationId && untouched) {
        const res = await apiPost<{ applied?: { id?: string } }>(
          `/api/generations/${proposal.generationId}/accept`,
        );
        const id = res.applied?.id;
        if (id) return id;
      }
      const page = (
        await apiPost<{ page: CodexPage }>(`/api/campaigns/${campaignId}/wiki`, {
          title: title.trim() || proposal.title,
          kind,
          contentMd,
          tags: proposal.tags,
          // GM-only until deliberately revealed — the codex defaults to secret.
          visibility: 'gm',
        })
      ).page;
      if (proposal.generationId) await closeGeneration(proposal.generationId);
      return page.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.unresolved(campaignId) });
      void qc.invalidateQueries({ queryKey: codexAiKeys.allDrafts(campaignId) });
    },
  });
}

/** Throw it away. The page is untouched — it always was. */
export function useRejectProposal(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposal: CodexProposal) => {
      if (proposal.generationId) await closeGeneration(proposal.generationId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexAiKeys.allDrafts(campaignId) });
    },
  });
}
