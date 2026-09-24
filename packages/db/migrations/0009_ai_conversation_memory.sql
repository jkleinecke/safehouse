-- The Fixer chat keeps a curated memory beside its transcript: the running
-- session brief that older turns are folded into, how far that folding has
-- got, and the files the GM attached. The transcript stays whole in
-- "messages"; "memory" is what the model is handed instead of all of it.
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "memory" jsonb NOT NULL DEFAULT '{}'::jsonb;
