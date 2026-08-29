/**
 * Codex storage (M5 — FR5.1–5.4): the db half of the campaign wiki.
 *
 * `services/codex.ts` holds the pure model — section parsing, visibility,
 * links, refs. This file is everything that touches rows: loading pages,
 * resolving handout attachments, snapshotting revisions, and assembling the
 * DTO a given viewer is allowed to receive.
 *
 * Every DTO here is built from markdown that `renderForViewer` has already cut
 * down (Principle 4), so links, refs and backlinks can never carry a fact out
 * of a section the caller may not read.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { attachments, wikiPages, wikiRevisions, type Db } from '@safehouse/db';
import { httpError } from './auth.js';
import {
  canView,
  handoutView,
  normalizeTitle,
  pageSummary,
  parseWikiLinks,
  readPageMeta,
  refChips,
  renderForViewer,
  resolveLinks,
  visiblePages,
  type HandoutLink,
  type HandoutView,
  type LinkReport,
  type PageMeta,
  type PageSummary,
  type SectionView,
  type Viewer,
  type WikiPageRow,
} from './codex.js';

export async function loadPage(db: Db, id: string): Promise<WikiPageRow | null> {
  const rows = await db.select().from(wikiPages).where(eq(wikiPages.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Load or 404. Callers pass the viewer so an invisible page answers exactly
 * like a nonexistent one — the route must never become an existence oracle.
 */
export async function requireVisiblePage(
  db: Db,
  id: string,
  viewer: Viewer,
): Promise<{ row: WikiPageRow; meta: PageMeta }> {
  const row = await loadPage(db, id);
  const notFound = () => httpError(404, 'not_found', 'unknown codex page');
  if (!row) throw notFound();
  if (viewer.campaignId !== row.campaignId) throw notFound();
  const meta = readPageMeta(row.sections);
  if (!canView(viewer, row.visibility, meta.audience)) throw notFound();
  return { row, meta };
}

export async function listPageRows(db: Db, campaignId: string): Promise<WikiPageRow[]> {
  return db
    .select()
    .from(wikiPages)
    .where(eq(wikiPages.campaignId, campaignId))
    .orderBy(asc(wikiPages.title));
}

/** Snapshot content+metadata as the next revision (wired on every edit). */
export async function recordWikiRevision(
  db: Db,
  page: Pick<WikiPageRow, 'id' | 'contentMd' | 'sections'>,
  createdBy: string | null,
): Promise<number> {
  const rows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${wikiRevisions.seq}), 0)::int` })
    .from(wikiRevisions)
    .where(eq(wikiRevisions.wikiPageId, page.id));
  const seq = (rows[0]?.maxSeq ?? 0) + 1;
  await db.insert(wikiRevisions).values({
    wikiPageId: page.id,
    seq,
    contentMd: page.contentMd,
    sections: page.sections ?? [],
    createdBy,
  });
  return seq;
}

/** Resolve handout links, dropping any this viewer may not see (Principle 4). */
export async function resolveHandouts(
  db: Db,
  links: HandoutLink[],
  viewer: Viewer,
): Promise<HandoutView[]> {
  if (links.length === 0) return [];
  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.id, links.map((l) => l.attachmentId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: HandoutView[] = [];
  for (const link of links) {
    const row = byId.get(link.attachmentId);
    if (!row) continue;
    if (row.campaignId && viewer.campaignId !== row.campaignId) continue;
    if (!canView(viewer, row.visibility)) continue;
    out.push(handoutView(link, row));
  }
  return out;
}

export interface PageDto extends PageSummary {
  contentMd: string;
  sections: SectionView[];
  links: LinkReport;
  backlinks: Array<{ id: string; title: string; kind: string }>;
  refs: Array<{ book: string; page: number; match: string }>;
  handouts: HandoutView[];
  createdAt: string;
  /** GM-only: the per-player audience on the page itself. */
  audience?: string[];
}

/**
 * Build the page a viewer is allowed to see. Everything derived — links, refs,
 * backlinks — comes from the FILTERED markdown, so a `[[link]]` that only
 * exists inside a GM-only section is invisible to players in both directions.
 */
export async function buildPageDto(
  db: Db,
  row: WikiPageRow,
  meta: PageMeta,
  viewer: Viewer,
  allRows?: WikiPageRow[],
): Promise<PageDto> {
  const rows = allRows ?? (await listPageRows(db, row.campaignId));
  const readable = visiblePages(rows, viewer);
  const rendered = renderForViewer(row, meta, viewer);

  const backlinks: Array<{ id: string; title: string; kind: string }> = [];
  const self = normalizeTitle(row.title);
  for (const other of readable) {
    if (other.id === row.id) continue;
    const otherMd = renderForViewer(other, readPageMeta(other.sections), viewer).contentMd;
    if (parseWikiLinks(otherMd).some((l) => normalizeTitle(l.target) === self)) {
      backlinks.push({ id: other.id, title: other.title, kind: other.kind });
    }
  }

  return {
    ...pageSummary(row, viewer),
    contentMd: rendered.contentMd,
    sections: rendered.sections,
    links: resolveLinks(rendered.contentMd, readable),
    backlinks,
    refs: refChips(rendered.contentMd),
    handouts: await resolveHandouts(db, meta.handouts, viewer),
    createdAt: row.createdAt.toISOString(),
    ...(viewer.role === 'gm' && meta.audience.length > 0 ? { audience: meta.audience } : {}),
  };
}
