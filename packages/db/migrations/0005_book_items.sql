-- The catalogue (FR11.2 / §14): items, spells, powers and qualities read out
-- of the GM's own book pages at seed time, so a sheet can pick one by name
-- and carry its stats and its page reference.
--
-- Derived from `book_pages.text`, never shipped: the table is empty until the
-- GM seeds their own PDFs, and it goes with the book (ON DELETE cascade). A
-- new table with no changes to existing ones, so this is safe to apply to a
-- live campaign mid-season; recompiling the catalogue is a seeder flag, not a
-- migration.
CREATE TABLE IF NOT EXISTS "book_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"printed_page" integer NOT NULL,
	"kind" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avail" text,
	"cost" integer,
	"cost_text" text,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "name" || ' ' || "category")) STORED
);
--> statement-breakpoint
ALTER TABLE "book_items" ADD CONSTRAINT "book_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_items_book_idx" ON "book_items" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_items_kind_idx" ON "book_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_items_tsv_idx" ON "book_items" USING gin ("tsv");
