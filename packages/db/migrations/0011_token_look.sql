-- A token's figure can be dressed: archetype, metatype, outfit, colours —
-- by hand or by describing it to the AI. A runner's look lives on the
-- character too, so it follows them into every scene and onto new tokens.
--
-- Nullable columns, safe mid-season: null is "chosen for it", as before.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS look jsonb;--> statement-breakpoint
ALTER TABLE characters ADD COLUMN IF NOT EXISTS token_look jsonb;
