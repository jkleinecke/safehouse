-- Two additive tables. Nothing existing is touched, so this migration is safe
-- to apply to a live campaign directory mid-season.
--
-- `ai_usage` — the durable half of the usage meter (FR12.15/12.16). Chat turns
-- that produce no draft have no row in `ai_generations`, so before this table
-- the meter was a per-process accumulator that reset on every restart. One row
-- per completed Fixer turn; tokens and latency, never money.
--
-- `user_macros` — personal quick rolls (FR2.8), keyed on the PERSON rather than
-- the handset. The unique index on (user_id, campaign_id, label) is load-bearing:
-- it is what lets the web app's one-time migration off localStorage be POSTed
-- more than once — from a second phone, or after a failed first attempt —
-- without doubling the rack.

CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"model" text DEFAULT 'unknown' NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_macros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_macros" ADD CONSTRAINT "user_macros_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_macros" ADD CONSTRAINT "user_macros_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_campaign_created_idx" ON "ai_usage" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_macros_owner_label_idx" ON "user_macros" USING btree ("user_id","campaign_id","label");--> statement-breakpoint
CREATE INDEX "user_macros_owner_idx" ON "user_macros" USING btree ("user_id","campaign_id","sort_order");
