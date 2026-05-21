# WhatsApp CRM (multi-tenant, integration-first)

A self-hosted CRM that connects directly to Meta's WhatsApp Cloud API (no BSP), with:

- **Master admin panel** — leads land here, get assigned to agents, integrations are managed here
- **Per-agent dashboard** — each agent signs in and sees only their assigned leads + WhatsApp inbox
- **WhatsApp OTP login** — no passwords; the same WA channel you use to talk to customers
- **Integration framework** — drop-in adapters for any number of external self-hosted apps (lead sources, loan origination, document stores, analytics…)

## Monorepo layout

```
apps/
  backend/          Fastify API + workers (Node 20+, TypeScript)
  frontend/         React + Vite (TypeScript)
packages/
  shared/           Types shared between BE and FE (User, Lead, Integration, EventType, …)
docker-compose.yml  Postgres + Redis for dev
```

## Architecture

```
                       ┌───────────────────────────────────┐
   WhatsApp user ──►   │ Meta Cloud API                    │
                       └────────────┬──────────────────────┘
                                    ▼
   external app ──API key──► /api/leads/ingest
                                    ▼
                       ┌───────────────────────────────────┐
                       │  Fastify backend                  │
                       │   webhook → DB                    │
                       │   /auth/otp/*  (WA OTP login)     │
                       │   /api/leads   (role-scoped)      │
                       │   /api/admin/* (admin only)       │
                       │   event bus  ──► outbound webhooks│
                       │              ──► adapters         │
                       └────────┬───────────┬──────────────┘
                                ▼           ▼
                          Postgres        BullMQ jobs (media + webhook delivery)
                                ▲
        React UI ◄── REST/SSE ──┘   (admin panel · agent dashboard)
```

## Roles

- **Admin** — full access. Sees all leads, manages users, lead sources, integrations, webhooks, API keys; reads audit log.
- **Agent** — sees only leads assigned to them and the WhatsApp conversations for those contacts. Can update lead status and chat with customers.

## Quick start

```bash
# 1. Bring up Postgres + Redis
docker compose up -d

# 2. Install
pnpm install

# 3. Backend env
cd apps/backend
cp .env.example .env
# Fill in Meta creds (see SETUP_META.md), JWT_SECRET, BOOTSTRAP_ADMIN_PHONE.
# Create an approved WhatsApp template named `login_otp` (AUTHENTICATION category,
# single body variable for the code) — see SETUP_META.md §7.

# 4. Apply migrations and seed your first admin
pnpm db:migrate
pnpm db:seed         # creates the admin row using BOOTSTRAP_ADMIN_PHONE

# 5. Run everything
cd ../..
pnpm dev             # starts backend on :4000 and frontend on :5173

# 6. Expose webhook in dev
ngrok http 4000      # point Meta webhook + login_otp template at this URL
```

Open http://localhost:5173, sign in with the admin phone you seeded. You'll get a 6-digit code on WhatsApp.

## Adding a new external integration

1. Create `apps/backend/src/integrations/<slug>/index.ts` exporting an `Adapter`:
   ```ts
   import type { Adapter } from '../registry';
   const adapter: Adapter = {
     slug: 'my-loan-app',
     kind: 'loan_app',
     async parseInboundLead(raw, ctx) { /* translate vendor → InboundLeadPayload */ },
     async onEvent(event, ctx) {
       if (event.type === 'file.classified') { /* push doc to loan app */ }
     },
   };
   export default adapter;
   ```
2. Import + `registerAdapter(adapter)` in `apps/backend/src/integrations/index.ts`.
3. In the admin panel → Integrations, create a row with that same `slug`. Generate an API key for inbound use, and/or add an outbound-webhook subscription.

That's it — no other code changes.

## Inbound lead ingestion

```bash
curl -X POST https://your-crm.example.com/api/leads/ingest \
  -H 'X-Api-Key: crm_xxxxxxxxxxxxxxxxxxxxxxxx' \
  -H 'Idempotency-Key: uuid-from-source-system' \
  -H 'Content-Type: application/json' \
  -d '{
    "source_slug": "website-form",
    "phone": "+919999999999",
    "contact_name": "Asha",
    "product": "home_loan",
    "amount": 5000000,
    "metadata": { "lead_quality": "hot" }
  }'
```

If the source's `assignment_strategy = round_robin`, the lead is auto-assigned to the agent with the fewest open leads. Otherwise it sits in the unassigned pool until the admin assigns it.

## Outbound webhook delivery

Every subscribed URL receives:

```http
POST /your-endpoint
X-CRM-Event: lead.created
X-CRM-Delivery: 0a1f…
X-CRM-Signature: sha256=<HMAC of body with your secret>
Content-Type: application/json

{ "type":"lead.created", "delivery_id":"…", "payload":{…}, "occurred_at":"…" }
```

Retried with exponential backoff up to `WEBHOOK_DELIVERY_RETRIES` (default 5).

## Events

| Event | When |
|-------|------|
| `lead.created` | A lead row is inserted (via ingest or chat upsert) |
| `lead.assigned` | An agent is set (auto or manual) |
| `lead.status_changed` | Status transition |
| `lead.updated` | Any other field changed |
| `message.received` | Inbound WhatsApp message |
| `message.sent` | Outbound WhatsApp message |
| `file.received` | Media attached to inbound message |
| `file.classified` | Document categorised (Phase 3) |
