#!/usr/bin/env bash
# Installs rclone + the daily backup cron. Must run as root.
# Idempotent — re-run safely.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2; exit 1
fi

if ! command -v rclone >/dev/null; then
  echo "▸ installing rclone"
  curl -fsSL https://rclone.org/install.sh | bash
fi

CRON_LINE="30 2 * * * /opt/crm/deploy/scripts/backup.sh >> /var/log/crm-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'crm/deploy/scripts/backup.sh' ; echo "$CRON_LINE" ) | crontab -

touch /var/log/crm-backup.log
chmod 0640 /var/log/crm-backup.log

echo "✓ backup cron installed (runs daily at 02:30 server time)"
echo "  log: tail -f /var/log/crm-backup.log"
echo
echo "Test it now with: bash /opt/crm/deploy/scripts/backup.sh"
