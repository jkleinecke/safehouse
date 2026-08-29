-- Forward-only sequence reconciliation.
--
-- WHY THIS EXISTS
-- `ws_events.id` is a bigserial, and DESIGN.md §11 makes it the replay cursor:
-- a client reconnects with `last_event_id` and asks for everything after it.
-- That contract has one hard requirement — an id is never handed out twice.
--
-- A serial column keeps its next id in a sequence that lives BESIDE the table,
-- not in it, so the two can be separated. Ordinary crash recovery cannot do it
-- (PostgreSQL WAL-logs sequence advances 32 values ahead, so an unclean exit
-- only ever skips ids FORWARD), but restoring a data directory from a file
-- copy can, and so can the ordinary way of moving this database between
-- backends — load the rows into a fresh schema with their ids intact and the
-- sequence is still sitting at 1. Every insert then collides with an existing
-- primary key, and because the collision is on the id the server never chose,
-- it repeats forever: the log freezes and nothing an operator does un-freezes
-- it. This function is the repair for that state.
--
-- WHY IT ONLY MOVES ONE WAY
-- The guard below fires only when the sequence would issue an id that already
-- exists on disk, which is exactly the condition "the new value is strictly
-- greater than the old". A healthy sequence — including one that recovery has
-- pushed ahead of the rows — is left untouched. Moving a sequence backwards
-- would re-issue ids that clients already hold as `last_event_id`, silently
-- truncating their replay; that is a worse failure than the one being fixed,
-- because it is invisible. Hence: up, or not at all.
CREATE OR REPLACE FUNCTION safehouse_resync_sequences()
RETURNS TABLE (
  seq_name text,
  tbl_name text,
  col_name text,
  previous_value bigint,
  new_value bigint
)
LANGUAGE plpgsql
AS $fn$
DECLARE
  r record;
  max_id bigint;
  last_val bigint;
  called boolean;
  next_val bigint;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS t,
           a.attname::text       AS c,
           pg_get_serial_sequence(c.oid::regclass::text, a.attname) AS s
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND pg_get_serial_sequence(c.oid::regclass::text, a.attname) IS NOT NULL
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT max(%I) FROM %s', r.c, r.t) INTO max_id;
    CONTINUE WHEN max_id IS NULL;

    EXECUTE format('SELECT last_value, is_called FROM %s', r.s) INTO last_val, called;
    -- `is_called = false` means last_value is the NEXT id to be issued;
    -- `true` means it was already used and the next id is last_value + 1.
    next_val := CASE WHEN called THEN last_val + 1 ELSE last_val END;

    IF max_id >= next_val THEN
      PERFORM setval(r.s, max_id, true);
      seq_name := r.s;
      tbl_name := r.t;
      col_name := r.c;
      previous_value := last_val;
      new_value := max_id;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;
--> statement-breakpoint
-- Apply the repair once as part of the migration itself, so a database is
-- consistent the moment it reaches this version — including one that arrived
-- here by a restore. `ensureSequences()` re-runs it on every open.
SELECT count(*) FROM safehouse_resync_sequences();
