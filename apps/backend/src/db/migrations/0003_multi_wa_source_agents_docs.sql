-- 0003 — Multi WhatsApp brand numbers, source-based agent access,
-- per-source document requirements + per-lead doc slots/files.

-- ---------------------------------------------------------------------------
-- whatsapp_numbers: each brand's registered Cloud API number.
-- Tokens stored here so we can rotate / use multiple WABAs without env edits.
-- Outbound sends look up the row by id (or by phone_number_id when receiving).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_label              TEXT NOT NULL,                    -- "BrandA Personal Loans"
  display_phone            TEXT NOT NULL,                    -- "+91 99999 99999" for UI
  phone_number_id          TEXT NOT NULL UNIQUE,             -- Meta's id; matches webhook payload
  waba_id                  TEXT NOT NULL,
  access_token             TEXT NOT NULL,                    -- System-User permanent token
  app_secret               TEXT,                             -- for X-Hub-Signature-256
  webhook_verify_token     TEXT NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS whatsapp_numbers_touch_updated_at ON whatsapp_numbers;
CREATE TRIGGER whatsapp_numbers_touch_updated_at
  BEFORE UPDATE ON whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sources are tied to a single WhatsApp brand number.
-- ---------------------------------------------------------------------------
ALTER TABLE lead_sources
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product TEXT,                    -- optional default product for leads
  ADD COLUMN IF NOT EXISTS welcome_template TEXT;           -- WA template name sent on lead creation

-- ---------------------------------------------------------------------------
-- Leads carry their brand for outbound + a denormalised source_slug
-- ---------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_wa_num_idx ON leads(whatsapp_number_id);

-- ---------------------------------------------------------------------------
-- source_agents: which agents can access which sources.
-- Agents see ALL leads from sources they're a member of (plus admin sees all).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_agents (
  source_id      UUID NOT NULL REFERENCES lead_sources(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, user_id)
);

CREATE INDEX IF NOT EXISTS source_agents_user_idx ON source_agents(user_id);

-- ---------------------------------------------------------------------------
-- conversations: per (contact, whatsapp_number) thread. Lets the same
-- customer talk to multiple brands without merging the chats.
-- Optional: messages can carry conversation_id once we backfill; for now
-- we maintain it alongside the existing contact-keyed messages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  whatsapp_number_id  UUID NOT NULL REFERENCES whatsapp_numbers(id) ON DELETE CASCADE,
  last_inbound_at     TIMESTAMPTZ,
  last_outbound_at    TIMESTAMPTZ,
  unread_count        INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id, whatsapp_number_id)
);

CREATE INDEX IF NOT EXISTS conversations_contact_idx ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS conversations_wa_idx ON conversations(whatsapp_number_id);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- doc_requirements: per-source (and optional product) checklist of documents
-- a lead must collect. Slots are instantiated when a lead is created.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doc_requirements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES lead_sources(id) ON DELETE CASCADE,
  product         TEXT,                                  -- NULL = applies to any product of this source
  doc_category    TEXT NOT NULL,                         -- pan|aadhaar|salary_slip|bank_stmt|itr|cheque|photo|other
  required_count  INT NOT NULL DEFAULT 1 CHECK (required_count >= 1),
  display_order   INT NOT NULL DEFAULT 0,
  label           TEXT,                                  -- "PAN card", "Last 3 salary slips"
  description     TEXT,                                  -- helper text shown to agents
  optional        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS doc_requirements_source_idx ON doc_requirements(source_id, product);

-- ---------------------------------------------------------------------------
-- lead_doc_slots: an instance of a requirement on a specific lead.
-- Slots transition pending → received → verified | rejected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_doc_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  requirement_id    UUID REFERENCES doc_requirements(id) ON DELETE SET NULL,
  doc_category      TEXT NOT NULL,
  required_count    INT NOT NULL DEFAULT 1,
  label             TEXT,
  description       TEXT,
  optional          BOOLEAN NOT NULL DEFAULT FALSE,
  display_order     INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'received', 'verified', 'rejected')),
  rejection_reason  TEXT,
  verified_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_doc_slots_lead_idx ON lead_doc_slots(lead_id, display_order);
CREATE INDEX IF NOT EXISTS lead_doc_slots_status_idx ON lead_doc_slots(status);

DROP TRIGGER IF EXISTS lead_doc_slots_touch_updated_at ON lead_doc_slots;
CREATE TRIGGER lead_doc_slots_touch_updated_at
  BEFORE UPDATE ON lead_doc_slots
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- lead_doc_files: join — multiple files can satisfy a single slot
-- (e.g. 3 salary slips = 3 file rows under one slot).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_doc_files (
  slot_id     UUID NOT NULL REFERENCES lead_doc_slots(id) ON DELETE CASCADE,
  file_id     UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  attached_by UUID REFERENCES users(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slot_id, file_id)
);

CREATE INDEX IF NOT EXISTS lead_doc_files_file_idx ON lead_doc_files(file_id);
