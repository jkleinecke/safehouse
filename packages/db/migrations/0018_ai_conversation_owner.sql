-- A Fixer or NPC chat belongs to the user who started it; nobody else can list
-- or open it. Only GM devices reach the Fixer, and every GM device of a
-- campaign is its owner of record (campaigns.gm_user_id), so an existing chat
-- goes to that user when the campaign has exactly one GM member and it is that
-- user. Otherwise it stays unowned, and an unowned chat is shown only to the
-- campaign's owner of record.
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "ai_conversations" AS c SET "owner_user_id" = p."gm_user_id"
FROM "campaigns" AS p
WHERE c."campaign_id" = p."id"
  AND c."owner_user_id" IS NULL
  AND (SELECT count(*) FROM "memberships" m WHERE m."campaign_id" = p."id" AND m."role" = 'gm') = 1
  AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."campaign_id" = p."id" AND m."user_id" = p."gm_user_id" AND m."role" = 'gm'
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_owner_updated_idx" ON "ai_conversations" ("campaign_id", "owner_user_id", "updated_at");
