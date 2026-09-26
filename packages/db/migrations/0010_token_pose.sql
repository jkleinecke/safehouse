-- A token on the isometric map is drawn as a figure, and a figure has a
-- pose: standing, crouched behind cover, or prone. Walking is drawn from
-- motion and "down" from the condition monitor, so neither is stored.
--
-- One column with a default, safe mid-season: every existing token stands.
ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS pose text NOT NULL DEFAULT 'stand';
