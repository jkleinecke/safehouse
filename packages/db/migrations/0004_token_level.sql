-- FR9.22 — a scene can have floors, and a token stands on one of them.
--
-- One column with a default, so this is safe to apply to a live campaign
-- mid-season: every existing token is on level 0, which is the ground floor,
-- which is the only floor every existing scene has. No scene changes shape and
-- no token moves.
--
-- The level lives on the TOKEN rather than being derived from its position,
-- because two tokens can stand on the same square of two different storeys and
-- the map has to tell them apart. `x`/`y` say where in the footprint; `level`
-- says which floor of the building.
--
-- NOT NULL with a default rather than nullable: "which floor is this on" has
-- an answer for every token that has ever existed, and a null would push that
-- question onto every reader.
ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 0;

-- Scene floors above the ground one live in the scenes row's existing JSONB
-- alongside the tile layer, so there is no column for them here. That is the
-- same place the painted floor already lives, and it keeps a scene's map in
-- one document rather than spread across a table nobody queries separately.
