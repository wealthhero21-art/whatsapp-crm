#!/usr/bin/env bash
# Daily Postgres backup → S3 (SSE-KMS encrypted).
#
# Reads connection + AWS creds from $APP_DIR/.env.prod.
# Object key: backups/postgres/yyyy-mm-dd_HHMMSS.sql.gz
# Lifecycle: configure the bucket to expire objects under backups/ after 30d.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
ENV_FILE="$APP_DIR/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2; exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${S3_BUCKET:?S3_BUCKET not set}"
: "${S3_KMS_KEY_ID:?S3_KMS_KEY_ID not set}"
: "${S3_REGION:?S3_REGION not set}"
: "${POSTGRES_USER:?}"; : "${POSTGRES_DB:?}"

TS="$(date -u +%Y-%m-%d_%H%M%S)"
TMP="$(mktemp -t crm-backup.XXXXXX.sql.gz)"
trap 'rm -f "$TMP"' EXIT

echo "[$TS] dumping postgres from container"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$(docker compose -f "$APP_DIR/docker-compose.prod.yml" ps -q postgres)" \
  pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$POSTGRES_DB" \
  | gzip -9 > "$TMP"

SIZE=$(stat -c%s "$TMP")
echo "[$TS] dump size: $SIZE bytes"

KEY="backups/postgres/${TS}.sql.gz"
echo "[$TS] uploading s3://$S3_BUCKET/$KEY (SSE-KMS)"

AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
AWS_REGION="$S3_REGION" \
aws s3 cp "$TMP" "s3://$S3_BUCKET/$KEY" \
  --sse aws:kms \
  --sse-kms-key-id "$S3_KMS_KEY_ID"

echo "[$TS] ✓ backup uploaded"
