#!/usr/bin/env bash
# Nightly backup → Hetzner Storage Box (SFTP).
#
# Two artefacts each run:
#   1. Postgres dump      → backups/postgres/yyyy-mm-dd_HHMMSS.sql.gz
#   2. Documents snapshot → backups/docs/yyyy-mm-dd_HHMMSS.tar.gz
#
# Both pushed via rclone (which speaks SFTP natively). Storage Box keeps a
# 30-day retention; we additionally delete remote files older than 30 days
# at the end of the run so old leakage doesn't accumulate.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
ENV_FILE="$APP_DIR/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2; exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${HETZNER_SB_HOST:?HETZNER_SB_HOST not set}"
: "${HETZNER_SB_USER:?HETZNER_SB_USER not set}"
: "${HETZNER_SB_PASSWORD:?HETZNER_SB_PASSWORD not set}"
: "${POSTGRES_USER:?}"; : "${POSTGRES_DB:?}"; : "${POSTGRES_PASSWORD:?}"
: "${DISK_STORAGE_PATH:?DISK_STORAGE_PATH not set}"

TS="$(date -u +%Y-%m-%d_%H%M%S)"

# ---- 1. Build a one-off rclone config for this run ----
# Using --sftp-host etc inline flags keeps the password out of any config file.
RCLONE_REMOTE="sb"
export RCLONE_CONFIG_SB_TYPE=sftp
export RCLONE_CONFIG_SB_HOST="$HETZNER_SB_HOST"
export RCLONE_CONFIG_SB_USER="$HETZNER_SB_USER"
export RCLONE_CONFIG_SB_PORT="${HETZNER_SB_PORT:-23}"
# rclone wants the password obscured. obscure once at runtime.
export RCLONE_CONFIG_SB_PASS="$(rclone obscure "$HETZNER_SB_PASSWORD")"

# ---- 2. Postgres dump ----
DUMP="$(mktemp -t crm-pg.XXXXXX.sql.gz)"
trap 'rm -f "$DUMP"' EXIT

echo "[$TS] dumping postgres"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$(docker compose -f "$APP_DIR/docker-compose.prod.yml" ps -q postgres)" \
  pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$POSTGRES_DB" \
  | gzip -9 > "$DUMP"

PG_SIZE=$(stat -c%s "$DUMP")
echo "[$TS] postgres dump: $PG_SIZE bytes"
rclone copyto --no-traverse "$DUMP" "$RCLONE_REMOTE:backups/postgres/${TS}.sql.gz"

# ---- 3. Documents snapshot ----
# Tar the entire docs directory. For very large doc sets (>10 GB) switch this
# to an incremental approach (rclone sync of the live tree to backups/docs-live/).
if [[ -d "$DISK_STORAGE_PATH" ]]; then
  echo "[$TS] streaming docs tar to storage box"
  tar -C "$DISK_STORAGE_PATH" -czf - . \
    | rclone rcat "$RCLONE_REMOTE:backups/docs/${TS}.tar.gz"
else
  echo "[$TS] skipping docs (storage path $DISK_STORAGE_PATH does not exist yet)"
fi

# ---- 4. Prune anything older than 30 days ----
echo "[$TS] pruning old backups (>30d)"
rclone delete --min-age 30d "$RCLONE_REMOTE:backups/postgres"
rclone delete --min-age 30d "$RCLONE_REMOTE:backups/docs"

echo "[$TS] ✓ backup complete"
