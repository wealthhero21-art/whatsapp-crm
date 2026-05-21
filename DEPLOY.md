# Deploying to Coolify

End-to-end playbook for `crm.maximoney.in` on the shared Contabo server.

```
GitHub push to main
   │
   ▼  webhook (Coolify "Deploy on push" toggle)
┌─────────────────────────────────────────────────────────────┐
│  Coolify on Contabo Mumbai (217.216.58.194)                │
│                                                              │
│  Traefik  ◄── crm.maximoney.in  ──TLS via Let's Encrypt──┐  │
│      │                                                    │  │
│      ▼                                                       │
│  frontend (caddy:8080)  ──/api/* /auth/* /webhook/*──┐      │
│      static SPA                                       ▼      │
│                                                  backend(:4000)
│                                                       │      │
│                                                       ▼      │
│                                                redis (per-app)
│                                                              │
│                                          shared postgres  ───┘
│                                          (coolify network)   │
└─────────────────────────────────────────────────────────────┘
```

See [`shared-infra.md`](shared-infra.md) for the underlying server, Coolify install, shared Postgres, and conventions.

---

## What gets deployed

`docker-compose.coolify.yml` defines three services:

| Service | What it does |
|---|---|
| **backend** | Fastify API. Runs migrations on startup. Connects to shared Postgres + local redis. Stores docs in a Coolify-managed persistent volume at `/var/crm/docs`. |
| **redis** | Per-app BullMQ queue + cache. |
| **frontend** | Caddy serving the built SPA on `:8080`. Reverse-proxies `/api/*`, `/auth/*`, `/webhook/*` to the backend. Traefik points at this. |

Public Postgres + TLS + domain routing are handled by the shared layer (see `shared-infra.md`).

---

## First-time setup

### 1. Provision the database

SSH to the server and use the shared helper:

```bash
ssh root@217.216.58.194
create-app-db whatsapp-crm
```

Copy the printed `DATABASE_URL` — looks like
`postgres://whatsapp_crm:<password>@tod9m3eq8aady2f9ar6z8ciy:5432/whatsapp_crm`.

### 2. Create the Coolify project

Coolify UI → Projects → **+ Add** → name: `whatsapp-crm`. Pick the existing `production` environment.

### 3. Add the application

Inside the project → **+ New Resource** → **Application** → **Public Repository** (or **Private** if you've connected the GitHub app):

| Field | Value |
|---|---|
| Repository | `https://github.com/maximoney/whatsapp-crm` |
| Branch | `main` |
| Build Pack | **Docker Compose** |
| Compose File | `docker-compose.coolify.yml` |
| Ports Exposes | `8080` |
| Service to expose | `frontend` |
| Instant deploy | **off** for now (we need env vars first) |

### 4. Set environment variables

Application → **Environment Variables** → paste each line from [`deploy/.env.prod.example`](deploy/.env.prod.example) as a separate row.

Generate secrets first:
```bash
openssl rand -hex 16    # WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32    # JWT_SECRET
```

The most critical ones to get right at first deploy:
- `DATABASE_URL` (from step 1)
- `JWT_SECRET`
- `CORS_ORIGIN=https://crm.maximoney.in`
- `BOOTSTRAP_ADMIN_PHONE` (the master admin's WhatsApp number)

WhatsApp credentials can be left blank initially — login won't work until they're in, but everything else will.

### 5. Persistent volume for documents

Application → **Storages** → **+ Add Persistent Storage**:

| Field | Value |
|---|---|
| Name | `docs` |
| Source path | (auto-managed by Coolify; leave blank) |
| Destination path in container | `/var/crm/docs` |
| Service | `backend` |

Coolify maps this to a host path under `/data/coolify/applications/<uuid>/storage/docs/`.

### 6. Domain

1. At your DNS provider, add an A record:
   ```
   crm.maximoney.in.   A   217.216.58.194   TTL 300
   ```
2. Wait until `dig +short crm.maximoney.in` returns `217.216.58.194`.
3. Application → **General** → **Domains** → enter `https://crm.maximoney.in` → Save.
4. Coolify-Traefik fetches a Let's Encrypt cert within ~30 seconds.

### 7. First deploy

Application → **Deploy** button (top right). Watch the build logs.

Expect:
- pnpm install + tsc build (~2 min first time, cached after)
- Compose up
- `node dist/db/migrate.js` runs and applies the three migrations
- Backend starts listening on `:4000`
- Caddy starts listening on `:8080`
- Traefik picks up the domain

Visit `https://crm.maximoney.in/health` — should return `{"ok":true,...}`.

### 8. Seed the first admin (one-time)

```bash
ssh root@217.216.58.194
docker exec -it $(docker ps --format '{{.Names}}' | grep whatsapp-crm | grep backend) \
  node dist/db/seed.js
```

Open `https://crm.maximoney.in/login`, enter the bootstrap admin phone, OTP arrives on WhatsApp (once the `login_otp` template is approved + the env values are set).

---

## Day-to-day

| Action | How |
|---|---|
| Ship code | `git push origin main` (Coolify auto-deploys if the toggle is on, else click Deploy in the UI) |
| Tail logs | Coolify UI → Logs, or `docker logs -f <container>` from SSH |
| Open Postgres | `docker exec -it tod9m3eq8aady2f9ar6z8ciy psql -U whatsapp_crm -d whatsapp_crm` |
| Manual migration | Click Redeploy (migrations re-run automatically), or `docker exec … node dist/db/migrate.js` |
| Add a brand WA number | Admin UI → WhatsApp numbers |
| Rotate `JWT_SECRET` | Coolify env var → Redeploy (logs everyone out) |
| Restore DB from nightly backup | See `shared-infra.md` § Restore |

---

## What still needs an offsite backup

The shared Postgres has nightly local dumps (14-day retention) — done. **Documents** in `/var/crm/docs` are NOT yet backed up offsite. When you order the Hetzner Storage Box, add a cron entry on the host that rclones the application storage dir nightly. I'll wire it the moment the Storage Box exists.

---

## What to send me to deploy

Once you've created the Coolify project and added me to the server, send:

1. **Coolify API token** (Coolify UI → avatar → Keys & Tokens → API Tokens) — so I can drive deploys via API
2. **Confirmation the GitHub repo is created** at `maximoney/whatsapp-crm` and pushed
3. **Meta WhatsApp credentials** (token, phone number ID, WABA ID, app secret) — drop into Coolify env
4. **Master admin phone** in `+91…` form
5. **Confirmation of DNS record** for `crm.maximoney.in`

I'll create the Coolify project, set env vars, run the first deploy, seed the admin, and hand you the working URL.
