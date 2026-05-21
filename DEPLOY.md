# Deploying to Contabo (production)

End-to-end playbook for `crm.maximoney.in`.

```
GitHub repo  ──push to main──►  GH Actions  ──build images──►  GHCR
                                     │
                                     │ ssh + git pull + compose up
                                     ▼
                              Contabo VPS (India)
                              ├── caddy   (TLS, static SPA, proxy)
                              ├── backend (node)
                              ├── postgres
                              ├── redis
                              └── /var/crm/docs   ← all documents on NVMe
                                                    ↓
                                       Hetzner Storage Box (Germany)
                                       └── backups/postgres + backups/docs
                                          (rclone SFTP, nightly, 30d retention)
```

You'll provision four things: **GitHub repo**, **Contabo VPS**, **Hetzner Storage Box**, **Meta WhatsApp**.

---

## 1. GitHub — repo + Actions secrets

1. Create a new **private** repo: `maximoney/whatsapp-crm`.
2. Push the existing code:
   ```bash
   git remote add origin git@github.com:maximoney/whatsapp-crm.git
   git push -u origin main
   ```
3. Generate a deploy SSH keypair (one-off, on your laptop):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/crm_deploy -N ""
   ```
4. In the GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Add:

   | Secret name | Value |
   |---|---|
   | `DEPLOY_HOST` | Contabo VPS public IP |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | contents of `~/.ssh/crm_deploy` (private key) |
   | `DEPLOY_PORT` | `22` |
   | `GHCR_PAT` | a GitHub Personal Access Token with `read:packages` so the server can pull private images |

---

## 2. Contabo — provision the VPS

### 2a. Order

- Plan: **VPS S Cloud** (4 vCPU / 8 GB / 200 GB NVMe) or larger
- Region: India
- OS: Ubuntu 24.04 LTS (or 22.04)
- Contabo emails root password once provisioned

### 2b. Bootstrap

SSH in as root and run the bootstrap with the deploy public key from step 1:

```bash
ssh root@<server-ip>

# Paste the bootstrap.sh contents into /tmp/bootstrap.sh — easiest if the
# repo is private. Then:
DEPLOY_PUBKEY="ssh-ed25519 AAAA... your-deploy-pubkey" bash /tmp/bootstrap.sh
```

This installs Docker, ufw, fail2ban, creates the `deploy` user, sets up `/var/crm/docs` with the right owner (uid 999 — the backend container's user), and hardens SSH.

### 2c. Clone the repo + drop in env

```bash
sudo -u deploy git clone git@github.com:maximoney/whatsapp-crm.git /opt/crm
# (or use HTTPS with a GitHub deploy token if you didn't add an SSH key)

sudo -u deploy cp /opt/crm/deploy/.env.prod.example /opt/crm/.env.prod
sudo chmod 600 /opt/crm/.env.prod
sudo nano /opt/crm/.env.prod    # fill in everything
```

Generate the secrets once:
```bash
openssl rand -hex 24     # POSTGRES_PASSWORD
openssl rand -hex 16     # WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32     # JWT_SECRET
```

### 2d. Install rclone + backup cron

```bash
sudo bash /opt/crm/deploy/scripts/install-backup-cron.sh
```

### 2e. Point DNS at the box

In your DNS provider, add an A record:
```
crm.maximoney.in.    A    <server-ip>    (TTL 300)
```

Wait for it to resolve (`dig crm.maximoney.in`). Caddy needs DNS to work before it can fetch a Let's Encrypt cert.

---

## 3. Hetzner Storage Box (offsite backups)

1. https://accounts.hetzner.com → Storage Box → Order
2. Plan: **BX11** (1 TB, ~€3.85/month). Single Storage Box, no need for snapshots.
3. Hetzner emails the connection details. You'll see:
   - Host: `uXXXXXX.your-storagebox.de`
   - Username: `uXXXXXX`
   - Password: shown once in the Hetzner Robot UI

4. **In the Hetzner Robot UI for this Storage Box**, enable:
   - ✓ External reachability
   - ✓ SSH support
   - ✓ Reset to a strong password you choose

5. Drop these into `.env.prod` on the Contabo box:
   ```
   HETZNER_SB_HOST=uXXXXXX.your-storagebox.de
   HETZNER_SB_USER=uXXXXXX
   HETZNER_SB_PASSWORD=<your password>
   HETZNER_SB_PORT=23
   ```

6. Test the backup right away:
   ```bash
   sudo bash /opt/crm/deploy/scripts/backup.sh
   ```
   Should finish in under a minute and you should see `backups/postgres/*.sql.gz` in the Hetzner Storage Box web UI.

---

## 4. Meta — WhatsApp Cloud API

Follow [`SETUP_META.md`](SETUP_META.md) for the full walkthrough. Specifically you need:

- Per brand number: a System-User permanent access token, phone number ID, WABA ID, app secret.
- A `login_otp` template **approved by Meta**:
  - Category: AUTHENTICATION
  - Body: e.g. `Your CRM verification code is {{1}}. It expires in 5 minutes.`
  - Without this, no one can log in.
- Subscribe the `messages` webhook field. Callback URL: `https://crm.maximoney.in/webhook/whatsapp`. Verify token: same as `WEBHOOK_VERIFY_TOKEN` in `.env.prod`.

Drop the credentials into `.env.prod`, then `docker compose restart backend`.

---

## 5. First deploy

The cleanest first deploy is via the CI pipeline:

```bash
# From your laptop
git push origin main
```

GitHub Actions will:
1. Type-check both apps.
2. Build backend + frontend images and push to `ghcr.io/<owner>/<repo>/{backend,frontend}`.
3. SSH into the server, `git pull`, `docker compose pull`, `docker compose up -d`.

Caddy starts and fetches a Let's Encrypt cert on first HTTPS request to `crm.maximoney.in` (5–30 seconds).

### Seed the first admin (once)

```bash
ssh deploy@<server-ip>
cd /opt/crm
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec backend node dist/db/seed.js
```

Then open https://crm.maximoney.in/login, enter the bootstrap admin phone, and you'll receive an OTP on WhatsApp.

---

## 6. Day-to-day operations

| Action | Command |
|---|---|
| Ship code | `git push origin main` (CI does the rest) |
| View logs | `ssh deploy@…  && docker compose -f /opt/crm/docker-compose.prod.yml logs -f backend` |
| Restart | `docker compose -f /opt/crm/docker-compose.prod.yml restart backend` |
| Manual migration | `docker compose … exec backend node dist/db/migrate.js` |
| Test backup | `sudo bash /opt/crm/deploy/scripts/backup.sh` |
| Check backup log | `tail -f /var/log/crm-backup.log` |
| Restore DB from backup | `gunzip < dump.sql.gz \| docker compose … exec -T postgres psql -U crm whatsapp_crm` |
| Postgres shell | `docker compose … exec postgres psql -U crm whatsapp_crm` |
| Add new brand WA number | Admin UI → WhatsApp numbers → Add (no redeploy needed) |
| Add new user | Admin UI → Users (no redeploy needed) |
| Rotate JWT_SECRET | Edit `.env.prod` → `docker compose … up -d backend` (logs everyone out) |

---

## What to send me to finish setup

1. **GitHub:** repo URL + a Personal Access Token (`repo` + `workflow` scope) so I can push code and add Actions secrets.
2. **Contabo:** server IP + root password (one-time, to run bootstrap; I'll then operate as the `deploy` user).
3. **Hetzner Storage Box:** host, user, password (after you order one).
4. **Meta:** values for `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`. Confirm the `login_otp` template is approved.
5. **DNS:** confirm you can edit `maximoney.in` DNS (or just add the A record yourself once we have the IP).
6. **Admin phone:** the `+91…` number that should get the first admin login.

I'll fill in `.env.prod`, run the bootstrap + first deploy, and hand you the working URL.
