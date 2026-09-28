-- The initiative order a GM arranges by hand, and whether the table rolls
-- its own initiative dice — both on the fight, so the GM's laptop, the
-- players' phones and the TV all read the same thing (FR4.2, FR4.8).
--
-- manual_order: combatant ids, first to act first, for this Combat Turn.
-- It moves PLACES only; no score is ever rewritten by it (SR5 p.159-161).
-- Null is the book's order, and every new Combat Turn sets it back to null.
--
-- hand_rolls: a new Combat Turn opens with blank scores for the table's dice
-- instead of the server rolling for everyone. False is what every fight did
-- before this column.
--
-- Two additive columns, safe mid-season: every existing fight keeps the
-- book's order and the server's dice.
ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS manual_order jsonb;
--> statement-breakpoint
ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS hand_rolls boolean NOT NULL DEFAULT false;
