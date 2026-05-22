# CLAUDE.md — Maximoney CRM

> ⚠️ **This session works on MAXIMONEY ONLY.**
> This is one of several CRM apps in a fleet. Do **not** edit or deploy any other
> brand from here. Kashew CRM is a **separate repo** (`kashew-crm`) in a separate
> folder (`../Kashew CRM/`) with its own session. Changes here do NOT propagate
> to other brands (they are independent forks).

## Identity

| | |
|---|---|
| App | **Maximoney CRM** |
| Repo | `github.com/wealthhero21-art/whatsapp-crm` |
| Live URL | https://crm.maximoney.in |
| WhatsApp number | Maximoney (+91 99584 21835) |

## What this is

A self-hosted WhatsApp CRM for a loan DSA. Direct Meta WhatsApp Cloud API (no BSP).
Monorepo:
- `apps/backend` — Fastify + TypeScript + Postgres (`pg`), BullMQ (Redis), SSE
- `apps/frontend` — React + Vite SPA (served by Caddy in prod)
- `packages/shared` — types shared by both

Auth = WhatsApp OTP → JWT. Roles: admin, agent. Agents are scoped per lead-source.
Customer phone numbers are masked for agents.

## Hosting / deploy

Runs on a shared Contabo VPS under **Coolify** (Traefik routes the domain,
shared Postgres, per-app DB). Deploy = push to `main`, then trigger the Coolify
deploy via API. Migrations run automatically on container boot.

**Server access, Coolify API token, per-app Coolify UUID + DB name, and Meta
credentials are NOT in this repo.** They live in:
`~/Desktop/Value Garage/contabo/shared-infra.md` and
`~/Desktop/Value Garage/contabo/.secrets/app-handoff-credentials.md`.

## Conventions

- Always run `tsc --noEmit` for both apps before deploying.
- Never commit secrets. `.env*` is gitignored.
- New DB changes = a new file in `apps/backend/src/db/migrations/` (forward-only;
  `schema_migrations` dedupes). They auto-apply on boot.
- The compose for Coolify is `docker-compose.coolify.yml`. On the shared
  `coolify` Docker network, service names must be app-unique to avoid DNS
  collisions across brands.
