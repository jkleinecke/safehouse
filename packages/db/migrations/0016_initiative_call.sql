-- A fight gathering initiative: the GM called for it and has not started the turn yet.
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS gathering boolean NOT NULL DEFAULT false;
