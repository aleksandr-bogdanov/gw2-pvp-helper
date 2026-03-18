#!/usr/bin/env bash
#
# Database backup script — pg_dump + gzip, keeps last 4 weekly backups.
# Designed to be triggered by Railway cron or external scheduler.
#
# Required env var: DATABASE_URL
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/app/screenshots/backups}"
MAX_BACKUPS=4
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/gw2-pvp-helper-${TIMESTAMP}.sql.gz"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting database backup at ${TIMESTAMP}"

# Run pg_dump and compress with gzip
pg_dump "${DATABASE_URL}" | gzip > "${BACKUP_FILE}"

echo "[backup] Backup saved to ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Retention: keep only the last N backups, delete older ones
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/gw2-pvp-helper-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "${BACKUP_COUNT}" -gt "${MAX_BACKUPS}" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  echo "[backup] Pruning ${DELETE_COUNT} old backup(s) (keeping last ${MAX_BACKUPS})"
  ls -1t "${BACKUP_DIR}"/gw2-pvp-helper-*.sql.gz | tail -n "${DELETE_COUNT}" | xargs rm -f
fi

echo "[backup] Done. ${BACKUP_COUNT} backup(s) in ${BACKUP_DIR}"
