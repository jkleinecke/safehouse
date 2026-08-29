/**
 * FR5.6 — the codex↔template link, db half.
 *
 * `services/codex.ts` holds the pure shape (`TemplateLink`, `templateLinkView`);
 * this file is the four queries behind it: read a page's templates, read one
 * template's link, set it, and clear it. Nothing here is AI-adjacent — the link
 * is plain GM data — but it is what lets an accepted `generate_npc` draft
 * (FR10.3) and the codex page describing that archetype refer to each other
 * instead of sitting in two disconnected tables.
 *
 * The column itself is `npc_templates.wiki_page_id`, added by migration
 * `0003_npc_template_wiki_link.sql` and declared on the shared drizzle table in
 * `@safehouse/db`.
 */
import { and, asc, eq } from 'drizzle-orm';
import { npcTemplates, wikiPages, type Db } from '@safehouse/db';
import { httpError } from './auth.js';
import { templateLinkView, type TemplateLink } from './codex.js';

/**
 * Kept as a name so the queries below read as "the link side of the table";
 * it is the shared `npcTemplates` definition, not a second one.
 */
const npcTemplateLinks = npcTemplates;

/** Every template that names this page, ordered so the UI is stable. */
export async function templatesForPage(
  db: Db,
  campaignId: string,
  wikiPageId: string,
): Promise<TemplateLink[]> {
  const rows = await db
    .select()
    .from(npcTemplateLinks)
    .where(
      and(
        eq(npcTemplateLinks.campaignId, campaignId),
        eq(npcTemplateLinks.wikiPageId, wikiPageId),
      ),
    )
    .orderBy(asc(npcTemplateLinks.name));
  return rows.map(templateLinkView);
}

/** One template's link row, scoped to the campaign (404s across campaigns). */
export async function templateLink(
  db: Db,
  campaignId: string,
  templateId: string,
): Promise<TemplateLink> {
  const row = (
    await db.select().from(npcTemplateLinks).where(eq(npcTemplateLinks.id, templateId)).limit(1)
  )[0];
  if (!row || row.campaignId !== campaignId) {
    throw httpError(404, 'not_found', 'unknown npc template');
  }
  return templateLinkView(row);
}

/**
 * Point a template at a codex page, or (with `null`) unlink it. Both sides are
 * checked against the same campaign first: a link that crossed campaigns would
 * be a hole in the only boundary the app has.
 */
export async function setTemplatePage(
  db: Db,
  campaignId: string,
  templateId: string,
  wikiPageId: string | null,
): Promise<TemplateLink> {
  await templateLink(db, campaignId, templateId);
  if (wikiPageId !== null) {
    const page = (
      await db
        .select({ id: wikiPages.id, campaignId: wikiPages.campaignId })
        .from(wikiPages)
        .where(eq(wikiPages.id, wikiPageId))
        .limit(1)
    )[0];
    if (!page || page.campaignId !== campaignId) {
      throw httpError(404, 'not_found', 'unknown codex page');
    }
  }
  const updated = (
    await db
      .update(npcTemplateLinks)
      .set({ wikiPageId })
      .where(eq(npcTemplateLinks.id, templateId))
      .returning()
  )[0];
  if (!updated) throw httpError(500, 'internal', 'template link update returned no row');
  return templateLinkView(updated);
}
