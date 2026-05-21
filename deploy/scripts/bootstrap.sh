#!/usr/bin/env bash
# One-shot bootstrap for a fresh Ubuntu 22.04 / 24.04 server (Contabo VPS).
#
# Run as root the first time you log into the server:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/scripts/bootstrap.sh \
#     | DEPLOY_PUBKEY="ssh-ed25519 AAAA…" bash
#
# Or after cloning the repo locally on the server:
#   sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA…" bash deploy/scripts/bootstrap.sh
#
# What it does:
#   - Sets up unattended security upgrades
#   - Installs Docker + Compose plugin
#   - Adds ufw firewall (only 22, 80, 443)
#   - Installs fail2ban with SSH jail
#   - Creates a 2 GB swap file (small VPS friendliness)
#   - Creates a non-root `deploy` user with passwordless sudo for docker
#   - Authorises DEPLOY_PUBKEY for that user so CI can SSH in
#   - Hardens sshd (disables password auth, root login)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2; exit 1
fi

if [[ -z "${DEPLOY_PUBKEY:-}" ]]; then
  echo "Set DEPLOY_PUBKEY env var to the SSH public key that CI will use." >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/crm}"

echo "▸ updating apt"
apt-get update -qq
apt-get upgrade -y -qq

echo "▸ installing baseline packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release \
  ufw fail2ban unattended-upgrades \
  postgresql-client gzip

echo "▸ enabling unattended security upgrades"
dpkg-reconfigure -plow unattended-upgrades || true

echo "▸ installing Docker Engine"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

echo "▸ configuring ufw"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "▸ configuring fail2ban (sshd jail)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "▸ creating 2 GB swap (if missing)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "▸ creating deploy user"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p "/home/$DEPLOY_USER/.ssh"
echo "$DEPLOY_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 700 "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

echo "▸ enabling passwordless sudo for deploy user (docker, systemctl-restart only)"
cat > /etc/sudoers.d/deploy <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart docker, /usr/bin/journalctl
EOF

echo "▸ hardening sshd"
SSHD=/etc/ssh/sshd_config
sed -i \
  -e 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' \
  -e 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
  -e 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' \
  "$SSHD"
systemctl reload ssh || systemctl reload sshd

echo "▸ creating app + docs directories"
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# Docs volume mounted into the backend container. Owned by uid/gid 999 because
# that's the node user inside our backend image (uncommon, but the safe move).
# We chmod 770 because docs are sensitive — only the container + root can read.
mkdir -p /var/crm/docs
chown -R 999:999 /var/crm/docs
chmod 770 /var/crm/docs

echo
echo "✓ bootstrap complete"
echo
echo "Next steps:"
echo "  1. As the deploy user, clone the repo into $APP_DIR:"
echo "       sudo -u $DEPLOY_USER git clone <repo-url> $APP_DIR"
echo "  2. Put the .env.prod file into $APP_DIR/.env.prod (see deploy/.env.prod.example)"
echo "  3. Install the backup cron entry:"
echo "       sudo $APP_DIR/deploy/scripts/install-backup-cron.sh"
echo "  4. First deploy (from your laptop, push to main) or manually:"
echo "       cd $APP_DIR && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
