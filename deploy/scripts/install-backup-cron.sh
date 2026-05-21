#!/usr/bin/env bash
# Installs the daily backup cron entry. Must run as root.
# Idempotent — re-run safely.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2; exit 1
fi

# Install awscli if missing (Ubuntu) — official `aws` v2 via the bundled installer.
if ! command -v aws >/dev/null; then
  echo "▸ installing awscli v2"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
  apt-get install -y -qq unzip
  unzip -q /tmp/awscli.zip -d /tmp/awscli
  /tmp/awscli/aws/install
  rm -rf /tmp/awscli /tmp/awscli.zip
fi

CRON_LINE="30 2 * * * /opt/crm/deploy/scripts/backup.sh >> /var/log/crm-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'crm/deploy/scripts/backup.sh' ; echo "$CRON_LINE" ) | crontab -

touch /var/log/crm-backup.log
chmod 0640 /var/log/crm-backup.log

echo "✓ backup cron installed (runs daily at 02:30 UTC)"
echo "  log: tail -f /var/log/crm-backup.log"
