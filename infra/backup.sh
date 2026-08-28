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

while true; do
  now=$(date +%s)
  target=$(date -d "today $AT" +%s 2>/dev/null || echo "")
  if [ -z "$target" ] || [ "$target" -le "$now" ]; then
    target=$(date -d "tomorrow $AT" +%s 2>/dev/null || echo $((now + 86400)))
  fi
  sleep $((target - now))
  run_backup || echo "[backup] run failed; continuing"
done
