-- A token can carry a light: a runner's flashlight, a guard's torch, a
-- spirit's own glow. It moves with the token and lights its floor like any
-- other light (docs/VISION.md §4.1). The lights a GM places on the map ride
-- in the scene's geometry and need no column.
--
-- One nullable column, safe mid-season: null is "carries no light", as before.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS light jsonb;
