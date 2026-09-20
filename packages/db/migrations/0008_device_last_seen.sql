-- Track when each device last authenticated, so the GM console can show
-- "seen 3:42 PM" instead of a bare list with no recency signal.
-- Nullable: a device that has never authenticated (just minted) has no last-seen.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
