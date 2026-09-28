-- Attack exchanges (SR5 p.173): one row per attack, from the defense to the
-- damage. A new table, safe mid-season.
CREATE TABLE IF NOT EXISTS "exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'awaiting_defense' NOT NULL,
	"body" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_target_id_combatants_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."combatants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchanges_encounter_state_idx" ON "exchanges" USING btree ("encounter_id","state");
