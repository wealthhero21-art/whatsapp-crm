# Deployment record

Greenfield deploy (no Supabase migration — the app was built from scratch on
raw Postgres). This file records the live resources so any future session can
pick up without rediscovery. **No secrets here** — those live in Coolify env
and `/data/app-db-secrets/` on the server.

## Live as of 2026-05-21

| Thing | Value |
|---|---|
| Server | Contabo VPS, `217.216.58.194` (see `~/Desktop/Value Garage/contabo/shared-infra.md`) |
| Coolify project | `whatsapp-crm` — uuid `a96v3hm9h5urb1gpxe4a4vqc` |
| Production env | uuid `e4y945bbvis94b4je47p6pkx` |
| Application | `whatsapp-crm` — uuid `b245h6se6xsbefhgkgw1xj62` |
| Build pack | docker-compose (`/docker-compose.coolify.yml`) |
| Public-facing service / port | `frontend` (Caddy) on `8080` |
| Live URL | https://crm.maximoney.in (Let's Encrypt cert via Traefik, HTTP→HTTPS redirect) |
| Fallback URL | http://b245h6se6xsbefhgkgw1xj62.217.216.58.194.sslip.io |
| Meta phone number ID | `1153735424485660` (+91 99584 21835, "Maximoney") |
| Meta WABA ID | `1356965929592330` |
| Meta business ID | `1242520374701030` |
| OTP template | `otp_template` / `en_US` (AUTHENTICATION, copy-code button) |
| Webhook verify token | `maximoney_wh_13f5b15d92a0dc8a` (paste into Meta webhook config) |
| Database | `whatsapp_crm` on shared Postgres `tod9m3eq8aady2f9ar6z8ciy`; creds in `/data/app-db-secrets/whatsapp_crm.env` |
| GitHub repo | https://github.com/wealthhero21-art/whatsapp-crm (currently public so Coolify can clone) |
| Master admin | `+919716029574` (seeded) |

## Services in the compose

- `backend` — Fastify API on :4000, runs migrations on boot, joins `coolify` net for shared Postgres, docs on a persistent volume at `/var/crm/docs`.
- `cache` — per-app Redis (named `cache`, not `redis`, to avoid the coolify-redis alias clash).
- `frontend` — Caddy on :8080, serves the SPA + reverse-proxies `/api`, `/auth`, `/webhook`, `/health` to backend. Traefik routes the domain here.

## Current state / caveats

- **Login uses a DEV bypass.** `DEV_OTP_BYPASS_CODE=123456` is set in Coolify env so the admin can log in before Meta credentials exist. The backend logs a loud warning on boot while this is set. **Remove it once Meta creds are wired.**
- **Meta WhatsApp creds are placeholders** (`WHATSAPP_TOKEN=placeholder…` etc). Real sending/receiving won't work until these are replaced and the `login_otp` template is approved.
- **HTTPS pending** — running on the sslip.io HTTP URL until the `crm.maximoney.in` A record is added and the domain is set on the Coolify app (Traefik then auto-issues a Let's Encrypt cert).
- **Offsite backups not yet wired** for this app's docs volume; shared Postgres has the nightly local dump.

## How to deploy a change

```bash
git push origin main          # then trigger via Coolify UI, or:
curl -X POST -H "Authorization: Bearer <COOLIFY_TOKEN>" \
  "http://217.216.58.194:8000/api/v1/deploy?uuid=b245h6se6xsbefhgkgw1xj62&force=true"
```

Migrations run automatically on container start (idempotent via `schema_migrations`).
