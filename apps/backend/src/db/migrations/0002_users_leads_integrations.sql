-- Multi-user (admin + agents), leads as first-class entities,
-- integrations framework, audit log.

-- ---------------------------------------------------------------------------
-- users: CRM operators (admin + agent). NOT customers — customers are in `contacts`.
-- Auth is via WhatsApp OTP, so phone is the primary identifier.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164          TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  email               TEXT UNIQUE,
  role                TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_role_active_idx ON users(role, active);

-- ---------------------------------------------------------------------------
-- otp_codes: short-lived auth codes sent over WhatsApp
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164          TEXT NOT NULL,
  code_hash           TEXT NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  consumed_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_codes_phone_idx ON otp_codes(phone_e164, created_at DESC);

-- ---------------------------------------------------------------------------
-- lead_sources: catalog of where leads come from (e.g. "website", "facebook-ads",
-- "lender-portal-X"). Each source has its own assignment strategy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  assignment_strategy TEXT NOT NULL DEFAULT 'manual' CHECK (assignment_strategy IN ('manual', 'round_robin')),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- leads: every lead that enters the CRM. A lead is a funnel-tracked instance
-- of a customer. A contact may have many leads over time (re-applications etc).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source_id           UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  source_ref          TEXT,                         -- external id from source system
  status              TEXT NOT NULL DEFAULT 'new',
  product             TEXT,                         -- home_loan|personal_loan|...
  amount              NUMERIC(14, 2),
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_assigned_to_idx ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS leads_contact_idx ON leads(contact_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
CREATE INDEX IF NOT EXISTS leads_source_idx ON leads(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_ref_uniq
  ON leads(source_id, source_ref) WHERE source_ref IS NOT NULL;

DROP TRIGGER IF EXISTS leads_touch_updated_at ON leads;
CREATE TRIGGER leads_touch_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- assignments: history of who got what (lead may be reassigned many times)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reason              TEXT,                         -- 'auto_round_robin'|'manual'|'reassigned'
  unassigned_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assignments_lead_idx ON assignments(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignments_user_idx ON assignments(user_id);

-- ---------------------------------------------------------------------------
-- integrations: external systems we talk to (lead source DBs, loan-app APIs,
-- analytics, document stores, ...). Stores config; runtime adapters live in code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,         -- maps to adapter directory: src/integrations/<slug>/
  kind                TEXT NOT NULL,                -- leads_inbound|loan_app|document_store|crm|analytics|custom
  base_url            TEXT,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-adapter options + credentials
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- api_keys: bearer keys for external systems POSTing into us. Scoped by
-- integration so revocation is granular.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id      UUID REFERENCES integrations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  key_prefix          TEXT NOT NULL,                -- first 8 chars, shown in UI
  key_hash            TEXT NOT NULL,                -- sha256 of the full key
  scopes              TEXT[] NOT NULL DEFAULT '{leads:write}',
  last_used_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);

-- ---------------------------------------------------------------------------
-- outbound_webhooks: subscriptions for downstream systems
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id      UUID REFERENCES integrations(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL,
  events              TEXT[] NOT NULL,              -- ['lead.created', 'message.received', ...]
  secret              TEXT,                         -- HMAC signing secret
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- outbound_webhook_deliveries: log of every dispatch attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id          UUID NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,
  response_status     INT,
  response_body       TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS owd_webhook_idx ON outbound_webhook_deliveries(webhook_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- idempotency_keys: dedupe POSTs into /api/leads/ingest etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key                 TEXT PRIMARY KEY,
  api_key_id          UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  response_status     INT NOT NULL,
  response_body       JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency_keys(created_at);

-- ---------------------------------------------------------------------------
-- audit_log: every privileged action (user CRUD, assignment, integration edit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id                  BIGSERIAL PRIMARY KEY,
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,                -- 'user.create'|'lead.assign'|'integration.update'|...
  entity_type         TEXT,                         -- 'user'|'lead'|'integration'|...
  entity_id           TEXT,
  before              JSONB,
  after               JSONB,
  ip                  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger touch_updated_at on users + integrations
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS integrations_touch_updated_at ON integrations;
CREATE TRIGGER integrations_touch_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Migration bookkeeping: each migration records itself so we don't re-apply.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename            TEXT PRIMARY KEY,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
