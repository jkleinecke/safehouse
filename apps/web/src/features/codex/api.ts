/**
 * Codex data layer (M5 — FR5.1–5.8, DESIGN.md §12).
 *
 * Every response here is already filtered for this device by the server
 * (Principle 4): a player's page simply does not *contain* a GM-only section,
 * so nothing in this file — or anything downstream of it — needs to hide
 * anything. What arrives is what may be rendered.
 *
 *   GET/POST   /api/campaigns/:id/wiki            list + create
 *   GET        /api/campaigns/:id/wiki/unresolved dangling [[links]] (GM)
 *   GET/PATCH/DELETE /api/wiki/:id                one page
 *   POST       /api/wiki/:id/reveal               page or section → shared
 *   GET/POST/DELETE /api/wiki/:id/handouts        pin an attachment
 *   POST       /api/handouts/:attachmentId/reveal staged → live
 *   GET/POST   /api/campaigns/:id/runs · /api/runs/:id (+ /award)
 *   GET/POST/PATCH/DELETE /api/campaigns/:id/calendar
 *   GET/POST   /api/characters/:id/contacts · /api/contacts/:contactId
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Visibility } from '@safehouse/contracts';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client.js';
import type { PageListItem } from './lib.js';
import { codexKeys } from './keys.js';

// Runs, the calendar and contacts live in `records.ts`; re-exported here so the
// whole feature has one import site.
export * from './records.js';
export { codexKeys } from './keys.js';

// ---------------------------------------------------------------------------
// Types (mirrors of the server DTOs)
// ---------------------------------------------------------------------------

export interface SectionView {
  id: string;
  heading: string;
  level: number;
  visibility: Visibility;
  audience?: string[];
  /** True when the visibility was set explicitly, not inherited from the page. */
  explicit: boolean;
}

export interface LinkReport {
  resolved: Array<{ target: string; label?: string; pageId: string; title: string; kind: string }>;
  /** Targets with no page behind them — rendered as create-prompts (FR5.3). */
  unresolved: Array<{ target: string; label?: string }>;
}

export interface HandoutView {
  attachmentId: string;
  label?: string;
  kind: string;
  mime: string;
  size: number;
  visibility: Visibility;
  revealed: boolean;
  url: string;
  addedAt: string;
}

export interface CodexPage extends PageListItem {
  campaignId: string;
  contentMd: string;
  sections: SectionView[];
  links: LinkReport;
  backlinks: Array<{ id: string; title: string; kind: string }>;
  refs: Array<{ book: string; page: number; match: string }>;
  handouts: HandoutView[];
  createdAt: string;
  audience?: string[];
}

export interface UnresolvedLink {
  target: string;
  from: Array<{ id: string; title: string }>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Wiki pages (FR5.1–5.3)
// ---------------------------------------------------------------------------

export function usePages(campaignId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.pages(campaignId ?? ''),
    queryFn: async () =>
      (await apiGet<{ pages: PageListItem[] }>(`/api/campaigns/${campaignId}/wiki`)).pages,
    enabled: Boolean(campaignId),
  });
}

export function usePage(pageId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.page(pageId ?? ''),
    queryFn: async () => (await apiGet<{ page: CodexPage }>(`/api/wiki/${pageId}`)).page,
    enabled: Boolean(pageId),
    // A 404 here is an ANSWER, not a hiccup: the server returns exactly that
    // for a page this device may not read (Principle 4). Retrying it only
    // parks the view in a pending limbo where it can render neither the page
    // nor the refusal.
    retry: false,
  });
}

export function useUnresolvedLinks(campaignId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: codexKeys.unresolved(campaignId ?? ''),
    queryFn: async () =>
      (
        await apiGet<{ unresolved: UnresolvedLink[] }>(
          `/api/campaigns/${campaignId}/wiki/unresolved`,
        )
      ).unresolved,
    enabled: Boolean(campaignId) && enabled,
  });
}

export interface CreatePageBody {
  kind: string;
  title: string;
  contentMd?: string;
  tags?: string[];
  visibility?: Visibility;
}

export function useCreatePage(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePageBody) =>
      (await apiPost<{ page: CodexPage }>(`/api/campaigns/${campaignId}/wiki`, body)).page,
    onSuccess: (page) => {
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.unresolved(campaignId) });
      qc.setQueryData(codexKeys.page(page.id), page);
    },
  });
}

export interface PatchPageBody {
  kind?: string;
  title?: string;
  contentMd?: string;
  tags?: string[];
  visibility?: Visibility;
  /** Per-section visibility (FR5.2). Sent whole; the server replaces the list. */
  sections?: Array<{ id: string; heading?: string; visibility: Visibility; audience?: string[] }>;
  audience?: string[];
}

export function useUpdatePage(campaignId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PatchPageBody) =>
      (await apiPatch<{ page: CodexPage }>(`/api/wiki/${pageId}`, body)).page,
    onSuccess: (page) => {
      qc.setQueryData(codexKeys.page(pageId), page);
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.unresolved(campaignId) });
    },
  });
}

export function useDeletePage(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => apiDelete<{ deleted: string }>(`/api/wiki/${pageId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
      void qc.invalidateQueries({ queryKey: codexKeys.unresolved(campaignId) });
    },
  });
}

export interface RevealBody {
  /** Section slug; omitted reveals the whole page (FR5.2). */
  section?: string;
  visibility?: Visibility;
  audience?: string[];
  /** Announce in the session log — the "and the table hears about it" half. */
  announce?: boolean;
}

/**
 * One click flips a page or section to shared AND announces it
 * (`wiki.revealed`, §11 catalog). The announcement is the point: a reveal the
 * table does not notice is a reveal that did not happen.
 */
export function useRevealPage(campaignId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RevealBody) =>
      (await apiPost<{ page: CodexPage }>(`/api/wiki/${pageId}/reveal`, body)).page,
    onSuccess: (page) => {
      qc.setQueryData(codexKeys.page(pageId), page);
      void qc.invalidateQueries({ queryKey: codexKeys.pages(campaignId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Handouts (FR5.4)
// ---------------------------------------------------------------------------

export function useHandouts(campaignId: string | undefined) {
  return useQuery({
    queryKey: codexKeys.handouts(campaignId ?? ''),
    queryFn: async () =>
      (await apiGet<{ handouts: HandoutView[] }>(`/api/campaigns/${campaignId}/handouts`)).handouts,
    enabled: Boolean(campaignId),
  });
}

/** Upload staged-private by default: a handout is revealed deliberately. */
export function useUploadHandout(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await apiPost<{ attachment: { id: string; url: string; mime: string } }>(
        `/api/attachments?campaign=${campaignId}&kind=handout&visibility=gm`,
        form,
      );
      return res.attachment;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.handouts(campaignId) });
    },
  });
}

export function useAttachHandout(campaignId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { attachmentId: string; label?: string }) =>
      apiPost<{ handout: HandoutView }>(`/api/wiki/${pageId}/handouts`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.page(pageId) });
      void qc.invalidateQueries({ queryKey: codexKeys.handouts(campaignId) });
    },
  });
}

export function useDetachHandout(campaignId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiDelete<unknown>(`/api/wiki/${pageId}/handouts/${attachmentId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.page(pageId) });
      void qc.invalidateQueries({ queryKey: codexKeys.handouts(campaignId) });
    },
  });
}

/** Staged → live: flips the attachment's visibility and announces it. */
export function useRevealHandout(campaignId: string, pageId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { attachmentId: string; visibility?: Visibility; note?: string }) =>
      apiPost<{ handout: HandoutView }>(`/api/handouts/${body.attachmentId}/reveal`, {
        visibility: body.visibility ?? 'public',
        ...(pageId ? { pageId } : {}),
        ...(body.note ? { note: body.note } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codexKeys.handouts(campaignId) });
      if (pageId) void qc.invalidateQueries({ queryKey: codexKeys.page(pageId) });
    },
  });
}
