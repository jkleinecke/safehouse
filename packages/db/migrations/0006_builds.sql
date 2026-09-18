-- FR3.9 — the native character builder (docs/CHARGEN.md §4.3, §8.5).
--
-- A new table and one nullable column, so this is safe to apply to a live
-- campaign mid-season: no existing row changes shape, every Chummer import and
-- hand-typed sheet reads `characters.build` as null, and nothing in play reads
-- a build at all.
--
-- `builds` holds a runner while it is being paid for. It is a table of its own
-- rather than a status on `characters` because every reader of `characters`
-- (the roster, the encounter picker, the Fixer's party read) would otherwise
-- have to remember to skip drafts; apart, a half-built runner cannot leak into
-- any of them. `build` is the player's record. The fields only the GM or the
-- server write — `state`, the return `notes`, `returned_step`, the per-item
-- `approvals` — are columns, so no autosave body can set them. Approval writes
-- the character, copies the build onto `characters.build` as history and sets
-- `character_id` (SET NULL on delete: the build outlives a retired runner).
CREATE TABLE IF NOT EXISTS "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"build" jsonb NOT NULL,
	"notes" text,
	"returned_step" integer,
	"approvals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"character_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_campaign_owner_idx" ON "builds" USING btree ("campaign_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "build" jsonb;
