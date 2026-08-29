-- FR5.6 — templates live in the codex.
--
-- One nullable column, so this is safe to apply to a live campaign directory
-- mid-season: every existing template keeps working, unlinked.
--
-- `npc_templates.wiki_page_id` is the CANONICAL link between an archetype
-- template (FR10.1, the thing M10 generates from) and the codex page that
-- describes it (FR5.1). It is deliberately one column rather than two: a page
-- finds its templates by reverse lookup, so the two directions can never
-- disagree. With this in place FR9.3's map pins, FR10.1's templates and FR5.1's
-- pages are one graph instead of three — a pin opens a page, the page names the
-- template, the template rolls the NPC.
--
-- ON DELETE SET NULL, not CASCADE: deleting the lore page must not delete the
-- stat block. The template is the playable thing.
--
-- Declared on the shared drizzle table as
--     wikiPageId: uuid('wiki_page_id').references(() => wikiPages.id, { onDelete: 'set null' }),
-- in `packages/db/src/schema.ts`; read and written through
-- `apps/server/src/services/codex-templates.ts`.

ALTER TABLE "npc_templates" ADD COLUMN "wiki_page_id" uuid;--> statement-breakpoint
ALTER TABLE "npc_templates" ADD CONSTRAINT "npc_templates_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "npc_templates_wiki_page_idx" ON "npc_templates" USING btree ("wiki_page_id");
