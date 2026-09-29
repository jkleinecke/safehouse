-- The Fixer's chat list sorts by the last save, not the first message.
-- Existing chats take their creation time; every save moves it on.
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE "ai_conversations" SET "updated_at" = "created_at";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_campaign_updated_idx" ON "ai_conversations" ("campaign_id", "updated_at");
