# Shared Infrastructure — Coolify on Contabo

This document is a handoff for any Claude session (or human) that needs to deploy a new consumer app onto the shared server. Read end-to-end before deploying.

---

## Server

| | |
|---|---|
| Provider | Contabo VPS S (Mumbai) |
| Public IP | `217.216.58.194` |
| IPv6 | `2400:d321:2331:5203::1/64` |
| OS | Ubuntu 24.04 LTS |
| Specs | 6 vCPU · 23 GB RAM · 174 GB disk · 8 GB swap |
| SSH | `ssh root@217.216.58.194` (password auth, see secrets store) |

### Hardening already in place
- **UFW** active. Open ports: `22, 80, 443, 8000, 6001, 6002`. Anything else is dropped.
- **fail2ban** guards SSH (5 failed attempts → 1 h ban).
- **Unattended security upgrades** enabled.
- **Weekly Docker image prune** (`/etc/cron.weekly/docker-prune`).

If a new app needs an inbound port other than 80/443, add a UFW rule (`ufw allow <port>/tcp`) — but **prefer routing through Traefik on 80/443 with a domain** over opening fresh ports.

---

## Coolify

| | |
|---|---|
| Version | 4.0.0 |
| Dashboard | http://217.216.58.194:8000 |
| API base | http://217.216.58.194:8000/api/v1 |
| API token | Generate in dashboard: avatar → Keys & Tokens → API Tokens. Store in your local secrets manager. |
| Install path | `/data/coolify/` |
| `.env` (Coolify's own) | `/data/coolify/source/.env` — backed up at `.secrets/coolify.env.backup` in this repo (NOT committed) |

### Server registered in Coolify
- Name: `localhost`
- UUID: `btjukww4cnzyp3v3cv7x36qr`
- Network: Docker network `coolify` — every Coolify-managed container joins this network and can reach every other container by container name as hostname.

### `shared-infra` project
- UUID: `jijmjio567vsxnfwvhpwuhvj`
- Environment: `production` (UUID: `tp1o225ospzn16d7skhbmvmz`)
- Holds the shared Postgres. **Do not delete this project.**

---

## Shared Postgres

| | |
|---|---|
| Image | `postgres:16-alpine` |
| Container name (== internal hostname) | `tod9m3eq8aady2f9ar6z8ciy` |
| Coolify resource UUID | `tod9m3eq8aady2f9ar6z8ciy` |
| Port (internal) | `5432` |
| Network | `coolify` (Docker) |
| Public exposure | **none** — internal-only, not on the public internet |
| Admin user | `postgres` / password stored in `/data/coolify/.../<resource>/.env` on the server; also retrievable via Coolify dashboard or API |

### Connecting to it from an app
Apps deployed via Coolify on this server automatically join the `coolify` Docker network, so they reach Postgres by container name:

```
DATABASE_URL=postgres://<app_user>:<app_password>@tod9m3eq8aady2f9ar6z8ciy:5432/<app_db>
```

⚠️ **Do not use `localhost` or `127.0.0.1`** in the connection string — apps are containers, not on the host network. The hostname must be the Postgres container name.

### Provisioning a database for your app
SSH into the server and run the helper script:

```bash
ssh root@217.216.58.194
create-app-db <your-app-name>
```

Examples:

```bash
create-app-db whatsapp-crm        # → db: whatsapp_crm, user: whatsapp_crm
create-app-db notes-api           # → db: notes_api, user: notes_api
```

The script:
- Sanitizes the name (lowercase, hyphens → underscores)
- Creates a database
- Creates a least-privilege role that only has access to that database
- Generates a 32-char password
- Prints the full `DATABASE_URL` ready to paste into Coolify env vars
- Saves a copy to `/data/app-db-secrets/<app>.env` (mode 600, root-only)
- **Is idempotent** — running it twice for the same name returns the existing credentials, doesn't overwrite. To rotate the password, pass `--rotate-password`.

Other helpers:
- `list-app-dbs` — list all provisioned databases with size and owner
- `drop-app-db <name>` — destructive, requires typed confirmation

### Backups
- **Local daily dump**: `/usr/local/bin/backup-shared-postgres.sh` runs nightly at **02:30 UTC** via `/etc/cron.d/postgres-backup`.
- Output: `/data/backups/postgres/<UTC-timestamp>/<db>.dump.gz` (custom format, `pg_dump -Fc`) + `globals.sql.gz` (roles/permissions).
- Retention: **14 days** locally.
- Logs: `/var/log/backups/postgres-YYYYMMDD.log` (logrotated, 30 days).
- **Offsite**: not yet configured. To add Hetzner Storage Box (BX11), order one, then uncomment the rclone block at the bottom of `/usr/local/bin/backup-shared-postgres.sh` and run `rclone config` once.

### Restore (any specific DB)
```bash
# 1. Pick a backup
ls /data/backups/postgres/

# 2. Restore (replaces existing data — be careful)
gunzip -c /data/backups/postgres/<TS>/<db>.dump.gz \
  | docker exec -i tod9m3eq8aady2f9ar6z8ciy pg_restore -U postgres -d <db> --clean --if-exists --no-owner
```

---

## Deploying a new app (the standard playbook)

For each consumer app, follow these steps in order. Tweak only if you have a specific reason.

### 1. Provision the database
```bash
ssh root@217.216.58.194
create-app-db <app-name>
# Copy the printed DATABASE_URL — you'll paste it in step 4.
```

### 2. Create the Coolify project
Either via UI (Projects → + Add → name = `<app-name>`) or via API:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  http://217.216.58.194:8000/api/v1/projects \
  -d '{"name":"<app-name>","description":"<short blurb>"}'
```

Note the returned `uuid` and the default `production` environment's `uuid`.

### 3. Add the application resource

UI: project → production → + New Resource → Application → pick source type (Public/Private Git, Dockerfile, Docker Compose, etc.).

For a public GitHub repo, the API call is:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  http://217.216.58.194:8000/api/v1/applications/public \
  -d '{
    "project_uuid": "<project-uuid>",
    "environment_uuid": "<env-uuid>",
    "server_uuid": "btjukww4cnzyp3v3cv7x36qr",
    "name": "<app-name>",
    "git_repository": "https://github.com/you/repo",
    "git_branch": "main",
    "build_pack": "nixpacks",
    "ports_exposes": "3000",
    "instant_deploy": false
  }'
```

For Coolify's full set of source types and fields, see the in-dashboard "API Documentation" link (bottom-left → docs icon).

### 4. Set env vars
The DATABASE_URL from step 1 plus anything else the app needs:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  http://217.216.58.194:8000/api/v1/applications/<app-uuid>/envs \
  -d '{"key":"DATABASE_URL","value":"<paste from step 1>","is_preview":false}'
```

Repeat for every secret. **Never** commit these to the repo.

### 5. Set a domain (when ready to go live)
1. At your DNS provider, add an A record:
   ```
   <subdomain>.yourdomain.com  A  217.216.58.194  TTL 600
   ```
2. Wait 1–5 minutes for propagation. Verify: `dig +short <subdomain>.yourdomain.com` → `217.216.58.194`.
3. In Coolify dashboard → app → General → "Domains" field → paste full URL: `https://<subdomain>.yourdomain.com`
4. Save. Coolify's Traefik will request a Let's Encrypt cert automatically within ~30 s.

While testing without a domain, Coolify can expose the app on a random host port; check the app's Configuration tab.

### 6. Deploy
- UI: Deploy button (top right)
- API:
  ```bash
  curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "http://217.216.58.194:8000/api/v1/deploy?uuid=<app-uuid>&force=false"
  ```

### 7. Verify
- Check deploy logs in Coolify UI (Deployments tab)
- Hit the URL
- Tail container logs: `docker logs -f <coolify-app-container>` from SSH

---

## Conventions across all apps

These keep the server tidy when 5–6 apps share it. Please follow.

- **One Coolify project per app**, named `<app-name>` in kebab-case.
- **One database per app**, created via `create-app-db <app-name>` — never share databases between apps.
- **Always go through Traefik** (i.e. use a domain, not a raw host port) once the app has any non-dev traffic.
- **Resource limits**: by default Coolify doesn't cap memory per container. If your app is CPU/RAM-heavy, set limits in the app's Advanced settings to prevent it starving the others. Reasonable defaults for a typical web app: `512m` memory, no CPU cap.
- **Logs**: prefer stdout/stderr. Coolify captures container logs automatically.
- **Secrets**: only in Coolify env vars (encrypted at rest) or `/data/app-db-secrets/`. Never in repo, never in image layers.
- **Container naming**: let Coolify auto-name. The UUID-based names look ugly but make cleanup safe.

---

## Quick reference — useful SSH commands

```bash
# All running containers
docker ps

# Coolify's own containers (should always be healthy)
docker ps --filter "label=coolify.managed=true"

# Postgres CLI as admin
docker exec -it tod9m3eq8aady2f9ar6z8ciy psql -U postgres

# Postgres CLI as a specific app's user
docker exec -it tod9m3eq8aady2f9ar6z8ciy psql -U <app_name> -d <app_name>

# Disk usage by docker
docker system df

# Top 10 biggest things on disk
du -h --max-depth=1 /data | sort -h | tail -10

# Server-wide metrics
htop      # CPU/RAM (install if missing: apt install htop)
df -h     # disk
free -h   # memory
```

---

## When something breaks

1. **App won't start**: Coolify UI → Deployments → click the failed run → read logs end-to-end. Most failures are env-var or build-command mistakes.
2. **DB connection refused**: check the hostname is the container name (not `localhost`), and that the app container is on the `coolify` Docker network (`docker inspect <container> | grep coolify`).
3. **Cert never issues**: DNS isn't pointing at the server, or port 80 isn't reachable from the public internet. Check `dig +short <domain>` and `ufw status`.
4. **Out of disk**: `docker system prune -af` to free image layers; `find /data/backups -mtime +14 -delete` to trim old backups.
5. **Coolify dashboard down**: `cd /data/coolify/source && docker compose ps` — restart with `docker compose restart` if needed.

---

## What's still TODO (deliberately left for later)

- **Offsite backups** (Hetzner Storage Box BX11). Local-only is fine for short-term; do not run real consumer traffic without offsite.
- **Per-domain Let's Encrypt certs** — wired automatically once you set a domain on an app.
- **Monitoring / alerting** beyond Coolify Sentinel. If you want Slack/email alerts on disk/CPU/down apps, configure in Coolify Settings → Notifications.
- **Per-app resource limits** — set as apps grow; don't pre-optimize.
