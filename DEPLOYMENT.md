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

- **Real WhatsApp OTP login is LIVE.** Dev bypass removed. `otp_template` (en_US,
  body params `[code, "Login"]` + copy-code button) sends via the Maximoney number.
- **⚠️ The access token is a TEMPORARY 24-hour user token** (generated 2026-05-22
  from the WhatsApp API Setup "Generate access token" flow). **It expires ~2026-05-23
  and login/sending will break.** Replace `WHATSAPP_TOKEN` in Coolify with a
  **permanent System-User token** before then: business.facebook.com → Settings →
  Users → System users → add the app + Maximoney WABA assets → Generate token
  (expiration: Never, scopes `whatsapp_business_messaging` + `whatsapp_business_management`).
- **App Secret, Phone Number ID, WABA ID** all set from the real values.
- **HTTPS live** at https://crm.maximoney.in (Let's Encrypt via Traefik).
- **Webhook** — subscribe in Meta (WhatsApp → Configuration): callback
  `https://crm.maximoney.in/webhook/whatsapp`, verify token `maximoney_wh_13f5b15d92a0dc8a`,
  subscribe the `messages` field. Needed for inbound messages.
- **Offsite backups not yet wired** for this app's docs volume; shared Postgres
  has the nightly local dump.

## How to deploy a change

```bash
git push origin main          # then trigger via Coolify UI, or:
curl -X POST -H "Authorization: Bearer <COOLIFY_TOKEN>" \
  "http://217.216.58.194:8000/api/v1/deploy?uuid=b245h6se6xsbefhgkgw1xj62&force=true"
```

Migrations run automatically on container start (idempotent via `schema_migrations`).
