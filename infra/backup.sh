#!/bin/sh
# Safehouse nightly backup (DESIGN.md §15 "Data durability"): a pg_dump of the
# campaign plus a tarball of the file store (maps, token art, book PDFs),
# retained 30 days. Runs as the compose `backup` sidecar's entrypoint.
#
# Deliberately a sketch in one respect: getting the dumps OFF the laptop is a
# bind mount (BACKUP_DIR) the GM points at an external drive or a synced
# folder. A backup that never left the machine it is backing up is a rumour.
#
# Env: PGHOST/PGUSER/PGPASSWORD/PGDATABASE (libpq), BACKUP_AT (HH:MM local),
#      BACKUP_RETAIN_DAYS.
#
# RESTORING — the drill §15 asks for and nobody ever runs:
#   database    docker compose -f infra/docker-compose.yml exec -T postgres \
#                 pg_restore --clean --no-owner -U safehouse -d safehouse \
#                 < backups/db-<stamp>.dump
#   file store  tar -xzf backups/files-<stamp>.tar.gz  (into the app's /data)
# `pg_dump --format=custom` carries the sequences with it, so a restore from
# these dumps lands consistent. A hand-rolled "copy the rows, keep the ids"
# move does NOT — see apps/server/scripts/migrate-to-postgres.ts.
#
# The laptop deployment (no compose, embedded PGlite) has no dump at all: its
# backup is a file copy of DATA_DIR taken with the app stopped, and restoring is
# copying it back. That path is proved by apps/server/test/restore-boot.test.ts —
# seed, copy, boot on the copy, keep playing.
set -eu

RETAIN="${BACKUP_RETAIN_DAYS:-30}"
AT="${BACKUP_AT:-04:30}"

run_backup() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "[backup] $stamp starting"
  pg_dump --format=custom --no-owner --file="/backups/db-$stamp.dump"
  # The file store is mounted read-only; an empty one is not an error.
  tar -czf "/backups/files-$stamp.tar.gz" -C /data . 2>/dev/null || true
  find /backups -name 'db-*.dump' -mtime "+$RETAIN" -delete
  find /backups -name 'files-*.tar.gz' -mtime "+$RETAIN" -delete
  echo "[backup] $stamp done"
}

# Take one immediately, so a stack that has just come up is never a power cut
# away from having no backup at all.
run_backup || echo "[backup] initial snapshot failed; will retry at $AT"

# Seconds until the next BACKUP_AT.
#
# The sidecar runs on postgres:16-alpine, whose busybox `date` does not
# understand GNU's relative forms ("today 04:30", "tomorrow 04:30") — it failed,
# the fallback fired, and BACKUP_AT was silently ignored: the dump ran 24h after
# whenever the container happened to start. An explicit "YYYY-MM-DD hh:mm:ss" is
# the one spelling both parsers accept. (Adding a day to cross midnight is
# DST-naive twice a year; an hour's drift on a nightly dump is not worth a
# calendar library in a 40-line shell script.)
seconds_until_backup() {
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $AT:00" +%s 2>/dev/null || echo "")
  if [ -z "$target" ]; then
    echo "[backup] BACKUP_AT='$AT' is not HH:MM — falling back to every 24h" >&2
    echo 86400
    return
  fi
  if [ "$target" -le "$now" ]; then
    target=$((target + 86400))
  fi
  echo $((target - now))
}

while true; do
  sleep "$(seconds_until_backup)"
  run_backup || echo "[backup] run failed; continuing"
done
