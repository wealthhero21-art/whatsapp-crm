# Deploying to Contabo (production)

End-to-end playbook for `crm.maximoney.in` on a Contabo India VPS.

```
GitHub repo  ──push to main──►  GH Actions  ──build images──►  GHCR
                                     │
                                     │ ssh + git pull + compose up
                                     ▼
                              Contabo VPS (India)
                              ├── caddy   (TLS, static SPA, proxy)
                              ├── backend (node)
                              ├── postgres
                              └── redis

  + AWS S3 (Mumbai, ap-south-1)  ←── all documents (SSE-KMS encrypted)
                                  ←── nightly Postgres backups
```

You'll provision four things in parallel: **AWS (S3 + KMS + IAM)**,
**Contabo (VPS)**, **GitHub (repo + secrets)**, **Meta (WhatsApp creds + template)**.
The DEPLOY.md walks each.

---

## 1. AWS — S3 bucket + KMS key + IAM user

Region: **`ap-south-1` (Mumbai)** — lowest latency for Indian users.

### 1a. Create a KMS key

```
AWS console → KMS → Customer managed keys → Create key
- Type: Symmetric
- Key spec: SYMMETRIC_DEFAULT
- Alias: alias/maximoney-crm-docs
- Description: SSE-KMS for WhatsApp CRM documents
- Key administrators: your IAM user
- Key users: (leave blank, we add the app's IAM user below)
- Save the key ARN — goes in S3_KMS_KEY_ID
```

### 1b. Create the documents bucket

```
S3 → Create bucket
- Name: maximoney-crm-docs                 (must be globally unique)
- Region: ap-south-1
- Block ALL public access: ✓
- Default encryption: SSE-KMS, use the key from 1a
- Versioning: enabled (optional but recommended)
```

### 1c. Create the backups bucket

```
- Name: maximoney-crm-backups
- Same region, same encryption settings
- Lifecycle rule: expire objects under backups/ after 30 days
```

### 1d. Create the app IAM user

```
IAM → Users → Create user → name: crm-app
- No console access
- Programmatic access: yes
- Permissions: attach this inline JSON policy (replace ACCOUNT_ID + key id):
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DocsBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::maximoney-crm-docs/*"
    },
    {
      "Sid": "BackupsBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::maximoney-crm-backups/*"
    },
    {
      "Sid": "UseKMSKey",
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "arn:aws:kms:ap-south-1:ACCOUNT_ID:key/THE-KEY-ID"
    }
  ]
}
```

Create an access key for this user. Save:
- `S3_ACCESS_KEY_ID` = `AKIA…`
- `S3_SECRET_ACCESS_KEY` = `…`

---

## 2. Meta — WhatsApp Cloud API

Follow [`SETUP_META.md`](SETUP_META.md) for the full walkthrough. Specifically you need:

- Per brand number: a System-User permanent access token, phone number ID, WABA ID, app secret.
- A `login_otp` template **approved by Meta**:
  - Category: AUTHENTICATION
  - Body: e.g. `Your CRM verification code is {{1}}. It expires in 5 minutes.`
  - Without this, no one can log in.
- Subscribe the `messages` webhook field. Callback URL: `https://crm.maximoney.in/webhook/whatsapp`. Verify token: same as `WEBHOOK_VERIFY_TOKEN` in `.env.prod`.

---

## 3. GitHub — repo + secrets

1. Create a new **private** repo (e.g. `maximoney/whatsapp-crm`).
2. Push the local code:
   ```bash
   git init
   git add -A
   git commit -m "Initial commit"
   git remote add origin git@github.com:maximoney/whatsapp-crm.git
   git push -u origin main
   ```
3. Generate a deploy SSH keypair **on your laptop** (one-off):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/crm_deploy -N ""
   ```
4. In the GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Add:

   | Secret name | Value |
   |---|---|
   | `DEPLOY_HOST` | the Contabo VPS public IP |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | contents of `~/.ssh/crm_deploy` (private key) |
   | `DEPLOY_PORT` | `22` (or whatever you chose) |
   | `GHCR_PAT` | a GitHub Personal Access Token with `read:packages` scope, used by the server to pull private images |

---

## 4. Contabo — provision the VPS

### 4a. Order

- Plan: **VPS S** (4 vCPU, 8 GB, 200 GB NVMe) or larger. Region: India.
- OS: Ubuntu 24.04 LTS (or 22.04).
- Take SSH access as `root` with the password Contabo emails you, or upload an SSH key during ordering.

### 4b. First login + bootstrap

SSH in as root and run the bootstrap. Replace `DEPLOY_PUBKEY` with the **public** key from step 3:

```bash
ssh root@<server-ip>

# pull the bootstrap script
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/scripts/bootstrap.sh \
  -o /tmp/bootstrap.sh

# OR, if the repo is private, just paste the script after `cat > /tmp/bootstrap.sh`

DEPLOY_PUBKEY="ssh-ed25519 AAAA... your-deploy-pubkey" bash /tmp/bootstrap.sh
```

This:
- installs Docker + Compose
- creates the `deploy` user with the SSH key
- enables ufw (22, 80, 443 only)
- enables fail2ban + unattended-upgrades
- creates a 2 GB swapfile
- disables SSH password auth

### 4c. Clone the repo + drop in env

```bash
sudo -u deploy git clone git@github.com:maximoney/whatsapp-crm.git /opt/crm

# Or for a private repo, generate a read-only deploy key in GitHub
# and add it to /home/deploy/.ssh/id_ed25519 first.

sudo -u deploy cp /opt/crm/deploy/.env.prod.example /opt/crm/.env.prod
sudo chmod 600 /opt/crm/.env.prod
sudo nano /opt/crm/.env.prod              # fill in everything
```

Generate the secret values once:
```bash
openssl rand -hex 24     # POSTGRES_PASSWORD
openssl rand -hex 16     # WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32     # JWT_SECRET
```

### 4d. Install the backup cron

```bash
sudo bash /opt/crm/deploy/scripts/install-backup-cron.sh
```

### 4e. Point DNS at the box

In your DNS provider, add an A record:
```
crm.maximoney.in.    A    <server-ip>    (TTL 300)
```

Wait for it to resolve (`dig crm.maximoney.in`). Caddy needs DNS to work before it can fetch a Let's Encrypt cert.

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

Caddy starts and fetches an Let's Encrypt cert on first HTTPS request to `crm.maximoney.in` (this can take 5–30 seconds).

### Seed the first admin

Once the backend is up, seed the master admin row (only do this once):

```bash
ssh deploy@<server-ip>
cd /opt/crm
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend node dist/db/seed.js
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
| Check backups | `tail -f /var/log/crm-backup.log` |
| Postgres shell | `docker compose … exec postgres psql -U crm whatsapp_crm` |
| Add new brand WA number | Admin UI → WhatsApp numbers → Add (no redeploy needed) |
| Add new user | Admin UI → Users (no redeploy needed) |
| Rotate JWT_SECRET | Edit `.env.prod` → `docker compose … up -d backend` (logs everyone out) |

---

## What to send me to finish setup

Once you've done steps 1, 2, and 4 above, ping me with:

1. **AWS:** S3 bucket name, KMS key ARN, IAM access key + secret
2. **Contabo:** server IP, root access (one-time, to run bootstrap)
3. **Meta:** values for `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`. Confirm `login_otp` template is approved.
4. **GitHub:** the new private repo URL, and confirmation you can add Actions secrets.
5. **DNS:** confirm you can edit `maximoney.in` DNS (or just add the A record yourself once we have the IP).
6. **Admin phone:** the `+91…` number that should get the first admin login.

I'll fill in `.env.prod`, run the bootstrap + first deploy, and hand you the working URL.
