-- A prop the GM marks as a combatant (a turret, a drone) joins the fight on
-- its scene like a runner or an NPC token does. False is every token so far.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS combatant boolean NOT NULL DEFAULT false;
