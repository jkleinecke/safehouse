/**
 * Campaign codex service (M5 — FR5.1–5.4, FR5.7): the wiki's model.
 *
 * Content model. A page is ONE markdown document. Its `##`/`###` headings are
 * its sections; `wiki_pages.sections` holds only *metadata* about them — a
 * sparse list of per-section visibilities keyed by heading slug. That keeps the
 * GM editing a single document while FR5.2 gets per-section secrecy, and it
 * means a section's visibility survives a rewrite of its prose.
 *
 * Secrecy (Principle 4). Filtering happens HERE, server-side: a viewer who may
 * not see a section never receives its heading, its body, its wiki-links, its
 * book refs, or a backlink from it. `renderForViewer` cuts the markdown before
 * anything else in this module looks at it, so every derived thing (links,
 * refs, backlinks, search snippets) is computed from the *filtered* text.
 *
 * This file is the pure half — no db, no I/O. Row loading, revisions and DTO
 * assembly live in `services/codex-store.ts`.
 *
 * Storage shape: DESIGN.md §9.2 gives `wiki_pages` a single `sections` JSONB
 * and no handout-link table, so this module keeps `{ v, sections, handouts,
 * audience }` in that column. A bare array — what the Fixer's draft apply
 * writes — is read as `sections`, so pages that predate the envelope still
 * open. A dedicated `wiki_handouts` table would be a lift from
 * `PageMeta.handouts` and nothing else.
 */
import type { Visibility } from '@safehouse/contracts';
import type { attachments, wikiPages } from '@safehouse/db';
import { findRefs } from './books.js';

/** Typed page kinds (FR5.1). `page` is tolerated: the Fixer's drafts use it. */
export const WIKI_KINDS = ['npc', 'faction', 'location', 'run', 'item', 'lore', 'page'] as const;
export type WikiKind = (typeof WIKI_KINDS)[number];

export type WikiPageRow = typeof wikiPages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

/** Enough of an AuthContext to answer "may this device see it?" */
export interface Viewer {
  role: string;
  userId: string;
  campaignId: string | null;
}

// ---------------------------------------------------------------------------
// Page metadata blob (the `sections` column)
// ---------------------------------------------------------------------------

/** Per-section visibility. Absent ⇒ the section inherits the page (FR5.2). */
export interface SectionMeta {
  /** Heading slug — stable across prose edits. */
  id: string;
  /** Heading text at the time visibility was set (for the GM's reveal UI). */
  heading?: string;
  visibility: Visibility;
  /** User ids for `gm_owner` = "per-player" visibility. */
  audience?: string[];
}

/** A handout: an existing attachment pinned to this page (FR5.4). */
export interface HandoutLink {
  attachmentId: string;
  label?: string;
  addedAt: string;
}

export interface PageMeta {
  v: 1;
  sections: SectionMeta[];
  handouts: HandoutLink[];
  /** Page-level per-player audience (used when visibility is `gm_owner`). */
  audience: string[];
}

const EMPTY_META: PageMeta = { v: 1, sections: [], handouts: [], audience: [] };

function asVisibility(value: unknown): Visibility | null {
  return value === 'public' || value === 'gm' || value === 'gm_owner' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function readSectionMeta(value: unknown): SectionMeta | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  const id = typeof rec['id'] === 'string' ? rec['id'] : null;
  const visibility = asVisibility(rec['visibility']);
  if (!id || !visibility) return null;
  const audience = stringArray(rec['audience']);
  return {
    id,
    visibility,
    ...(typeof rec['heading'] === 'string' ? { heading: rec['heading'] } : {}),
    ...(audience.length > 0 ? { audience } : {}),
  };
}

function readHandout(value: unknown): HandoutLink | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  const attachmentId = typeof rec['attachmentId'] === 'string' ? rec['attachmentId'] : null;
  if (!attachmentId) return null;
  return {
    attachmentId,
    ...(typeof rec['label'] === 'string' ? { label: rec['label'] } : {}),
    addedAt: typeof rec['addedAt'] === 'string' ? rec['addedAt'] : new Date(0).toISOString(),
  };
}

/** Tolerant read of the `sections` JSONB (bare array = legacy section list). */
export function readPageMeta(raw: unknown): PageMeta {
  if (Array.isArray(raw)) {
    return { ...EMPTY_META, sections: raw.map(readSectionMeta).filter((s): s is SectionMeta => s !== null) };
  }
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_META };
  const rec = raw as Record<string, unknown>;
  const sections = Array.isArray(rec['sections'])
    ? rec['sections'].map(readSectionMeta).filter((s): s is SectionMeta => s !== null)
    : [];
  const handouts = Array.isArray(rec['handouts'])
    ? rec['handouts'].map(readHandout).filter((h): h is HandoutLink => h !== null)
    : [];
  return { v: 1, sections, handouts, audience: stringArray(rec['audience']) };
}

// ---------------------------------------------------------------------------
// Visibility (Principle 4)
// ---------------------------------------------------------------------------

/**
 * May this viewer read something with this visibility? Extends the hub's
 * `canSee` with a per-player *audience* (FR5.2's third mode), which the single
 * `ownerUserId` on a ws_event cannot express.
 */
export function canView(viewer: Viewer, visibility: Visibility, audience: string[] = []): boolean {
  if (viewer.role === 'gm') return true;
  if (visibility === 'public') return true;
  if (visibility === 'gm_owner') return audience.includes(viewer.userId);
  return false;
}

// ---------------------------------------------------------------------------
// Section parsing — markdown headings are the sections
// ---------------------------------------------------------------------------

export interface SectionBlock {
  /** Heading slug; `''` for the intro block above the first heading. */
  id: string;
  heading: string;
  /** 0 for the intro block, else the ATX heading level. */
  level: number;
  /** Line range `[start, end)` covering the heading and its body. */
  start: number;
  end: number;
}

export function slugify(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 80) : 'section';
}

/** Split a page's markdown into its intro block plus one block per heading. */
export function parseSections(contentMd: string): { lines: string[]; blocks: SectionBlock[] } {
  const lines = contentMd.split(/\r?\n/);
  const blocks: SectionBlock[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  let current: SectionBlock = { id: '', heading: '', level: 0, start: 0, end: lines.length };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    current.end = i;
    if (current.level > 0 || current.end > current.start) blocks.push(current);
    const heading = m[2]!.trim();
    const base = slugify(heading);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    current = {
      id: n === 1 ? base : `${base}-${n}`,
      heading,
      level: m[1]!.length,
      start: i,
      end: lines.length,
    };
  }
  if (current.level > 0 || current.end > current.start) blocks.push(current);
  return { lines, blocks };
}

// ---------------------------------------------------------------------------
// Server-side filtering
// ---------------------------------------------------------------------------

export interface SectionView {
  id: string;
  heading: string;
  level: number;
  visibility: Visibility;
  /** Present for GMs only (players never learn who else can see a section). */
  audience?: string[];
  /** True when the visibility came from an explicit per-section setting. */
  explicit: boolean;
}

export interface RenderedPage {
  /** Markdown with every section this viewer may not see removed outright. */
  contentMd: string;
  /** Sections the viewer may see (GMs additionally get the hidden ones). */
  sections: SectionView[];
  /** How many sections were cut (GM-facing bookkeeping; 0 for GMs). */
  hiddenCount: number;
}

function metaFor(meta: PageMeta, id: string): SectionMeta | undefined {
  return meta.sections.find((s) => s.id === id);
}

/**
 * Cut the page down to what `viewer` may read. Hiding a section hides its
 * subsections too: a `###` under a GM-only `##` is part of that secret.
 */
export function renderForViewer(
  row: Pick<WikiPageRow, 'contentMd' | 'visibility'>,
  meta: PageMeta,
  viewer: Viewer,
): RenderedPage {
  const { lines, blocks } = parseSections(row.contentMd);
  const isGm = viewer.role === 'gm';
  const kept: string[] = [];
  const sections: SectionView[] = [];
  let hiddenCount = 0;
  let hiddenAtLevel: number | null = null;

  for (const block of blocks) {
    if (hiddenAtLevel !== null && block.level > hiddenAtLevel) {
      // A subsection of a hidden section is part of that secret (never a GM:
      // nothing is ever hidden from the GM, so this branch cannot cut theirs).
      hiddenCount += 1;
      continue;
    }
    hiddenAtLevel = null;
    const sectionMeta = block.level > 0 ? metaFor(meta, block.id) : undefined;
    const visibility = sectionMeta?.visibility ?? row.visibility;
    const audience = sectionMeta?.audience ?? meta.audience;
    const visible = canView(viewer, visibility, audience);
    if (!visible) {
      hiddenCount += 1;
      hiddenAtLevel = block.level;
      continue;
    }
    if (block.level > 0) {
      sections.push({
        id: block.id,
        heading: block.heading,
        level: block.level,
        visibility,
        ...(isGm && audience.length > 0 ? { audience } : {}),
        explicit: sectionMeta !== undefined,
      });
    }
    kept.push(...lines.slice(block.start, block.end));
  }

  return { contentMd: kept.join('\n').trim(), sections, hiddenCount: isGm ? 0 : hiddenCount };
}

// ---------------------------------------------------------------------------
// [[Wiki-links]] and book refs (FR5.3)
// ---------------------------------------------------------------------------

export const WIKI_LINK_PATTERN = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

export interface WikiLink {
  target: string;
  label?: string;
  index: number;
}

export function parseWikiLinks(md: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of md.matchAll(WIKI_LINK_PATTERN)) {
    const target = m[1]!.trim();
    if (target.length === 0) continue;
    const label = m[2]?.trim();
    out.push({ target, ...(label ? { label } : {}), index: m.index });
  }
  return out;
}

/** Titles compare case- and whitespace-insensitively (create-prompts, FR5.3). */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ResolvedLink {
  target: string;
  label?: string;
  pageId: string;
  title: string;
  kind: string;
}

export interface LinkReport {
  resolved: ResolvedLink[];
  /** Link targets with no page — the client renders these as create-prompts. */
  unresolved: Array<{ target: string; label?: string }>;
}

/** Resolve a page's links against the pages this viewer is allowed to see. */
export function resolveLinks(md: string, visiblePages: WikiPageRow[]): LinkReport {
  const byTitle = new Map(visiblePages.map((p) => [normalizeTitle(p.title), p]));
  const resolved: ResolvedLink[] = [];
  const unresolved: Array<{ target: string; label?: string }> = [];
  const seen = new Set<string>();
  for (const link of parseWikiLinks(md)) {
    const key = normalizeTitle(link.target);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = byTitle.get(key);
    if (hit) {
      resolved.push({
        target: link.target,
        ...(link.label ? { label: link.label } : {}),
        pageId: hit.id,
        title: hit.title,
        kind: hit.kind,
      });
    } else {
      unresolved.push({ target: link.target, ...(link.label ? { label: link.label } : {}) });
    }
  }
  return { resolved, unresolved };
}

/** `SR5 p.426` → a structured ref chip, reusing the books parser (FR5.3/11.4). */
export function refChips(md: string): Array<{ book: string; page: number; match: string }> {
  const seen = new Set<string>();
  const out: Array<{ book: string; page: number; match: string }> = [];
  for (const ref of findRefs(md)) {
    const key = `${ref.book}:${ref.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ book: ref.book, page: ref.page, match: ref.match });
  }
  return out;
}

/** The subset of a campaign's pages `viewer` may open at all (page-level). */
export function visiblePages(rows: WikiPageRow[], viewer: Viewer): WikiPageRow[] {
  return rows.filter((row) => canView(viewer, row.visibility, readPageMeta(row.sections).audience));
}

// ---------------------------------------------------------------------------
// Handouts (FR5.4)
// ---------------------------------------------------------------------------

export interface HandoutView {
  attachmentId: string;
  label?: string;
  kind: string;
  mime: string;
  size: number;
  visibility: Visibility;
  /** Staged handouts are `gm`; revealing flips them to `public` (FR5.4). */
  revealed: boolean;
  url: string;
  addedAt: string;
}

export function handoutView(link: HandoutLink, row: AttachmentRow): HandoutView {
  return {
    attachmentId: row.id,
    ...(link.label ? { label: link.label } : {}),
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    visibility: row.visibility,
    revealed: row.visibility === 'public',
    url: `/files/${row.id}`,
    addedAt: link.addedAt,
  };
}

// ---------------------------------------------------------------------------
// Page summaries (the full DTO is assembled in services/codex-store.ts)
// ---------------------------------------------------------------------------

export interface PageSummary {
  id: string;
  campaignId: string;
  kind: string;
  title: string;
  tags: string[];
  visibility: Visibility;
  updatedAt: string;
  /** GM-only: how many sections are hidden from players right now. */
  gmOnlySections?: number;
}

export function pageSummary(row: WikiPageRow, viewer: Viewer): PageSummary {
  const meta = readPageMeta(row.sections);
  const base: PageSummary = {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    title: row.title,
    tags: row.tags,
    visibility: row.visibility,
    updatedAt: row.updatedAt.toISOString(),
  };
  if (viewer.role !== 'gm') return base;
  const hidden = parseSections(row.contentMd).blocks.filter((b) => {
    if (b.level === 0) return false;
    const sm = meta.sections.find((s) => s.id === b.id);
    return (sm?.visibility ?? row.visibility) !== 'public';
  }).length;
  return { ...base, gmOnlySections: hidden };
}

// ---------------------------------------------------------------------------
// The template link (FR5.6)
// ---------------------------------------------------------------------------

/**
 * FR5.6 asks for archetype templates to *live in the codex* — user-entered and
 * page-referenced. The link is one column, `npc_templates.wiki_page_id`
 * (migration 0003), deliberately singular so the two directions cannot
 * disagree: a template names its page, a page finds its templates by reverse
 * lookup. That is what turns FR9.3's pins, FR10.1's templates and FR5.1's pages
 * into one graph — a pin opens a page, the page names the template, the
 * template rolls the NPC (FR10.2).
 *
 * The pure half only: the shape a page reports. Queries live in
 * `services/codex-templates.ts` so this module stays free of I/O.
 */
export interface TemplateLink {
  templateId: string;
  name: string;
  /** From `npc_templates.gen.roleTags` — what the template is for (FR10.1). */
  roleTags: string[];
  /** The page this template says it belongs to; null when unlinked. */
  wikiPageId: string | null;
  /** True when the template carries a `{book,page}` ref as well (FR11.2). */
  hasPageRef: boolean;
}

/** Tolerant read of `npc_templates.gen.roleTags`. */
export function readRoleTags(gen: unknown): string[] {
  if (typeof gen !== 'object' || gen === null) return [];
  const tags = (gen as Record<string, unknown>)['roleTags'];
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

/** One `npc_templates` row → the link view a codex page reports. */
export function templateLinkView(row: {
  id: string;
  name: string;
  gen: unknown;
  wikiPageId: string | null;
  pageRef?: unknown;
}): TemplateLink {
  return {
    templateId: row.id,
    name: row.name,
    roleTags: readRoleTags(row.gen),
    wikiPageId: row.wikiPageId,
    hasPageRef: row.pageRef !== null && row.pageRef !== undefined,
  };
}

/**
 * Campaign-wide unresolved-link report (FR5.3): every `[[target]]` with no
 * page behind it, and who points at it. GM-facing — it is computed over the
 * unfiltered corpus.
 */
export function unresolvedReport(
  rows: WikiPageRow[],
): Array<{ target: string; from: Array<{ id: string; title: string }> }> {
  const titles = new Set(rows.map((r) => normalizeTitle(r.title)));
  const byTarget = new Map<string, { target: string; from: Array<{ id: string; title: string }> }>();
  for (const row of rows) {
    for (const link of parseWikiLinks(row.contentMd)) {
      const key = normalizeTitle(link.target);
      if (titles.has(key)) continue;
      const entry = byTarget.get(key) ?? { target: link.target, from: [] };
      if (!entry.from.some((f) => f.id === row.id)) entry.from.push({ id: row.id, title: row.title });
      byTarget.set(key, entry);
    }
  }
  return [...byTarget.values()].sort((a, b) => a.target.localeCompare(b.target));
}
