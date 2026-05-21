-- WhatsApp CRM schema
-- Designed so it can be the source of truth, while still linking out to
-- an external leads DB and external loan application(s).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- contacts: one row per WhatsApp identity (phone number)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id               TEXT NOT NULL UNIQUE,        -- WhatsApp's internal id (digits, no +)
  phone_e164          TEXT NOT NULL,                -- normalised display number
  profile_name        TEXT,                         -- name reported by WhatsApp
  display_name        TEXT,                         -- name overridden in CRM
  external_lead_id    TEXT,                         -- FK to your leads DB (e.g. "LEAD-12345")
  external_app_id     TEXT,                         -- FK to loan-app applicant id, if any
  tags                TEXT[] DEFAULT '{}',          -- ["home-loan","follow-up","hot"]
  last_inbound_at     TIMESTAMPTZ,                  -- last time customer messaged (drives 24-h window)
  last_outbound_at    TIMESTAMPTZ,
  unread_count        INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_external_lead_id_idx ON contacts(external_lead_id);
CREATE INDEX IF NOT EXISTS contacts_last_inbound_at_idx  ON contacts(last_inbound_at DESC);

-- ---------------------------------------------------------------------------
-- files: media + their classification
-- (Defined BEFORE messages because messages.file_id references files.id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  wa_media_id           TEXT,                       -- Meta media id (temporary on their side)
  mime_type             TEXT NOT NULL,
  filename              TEXT,                       -- original or inferred
  size_bytes            BIGINT,
  storage_key           TEXT NOT NULL,              -- path in S3/disk
  sha256                TEXT,                       -- for de-duplication
  doc_category          TEXT,                       -- pan|aadhaar|salary_slip|bank_stmt|itr|cheque|photo|other|unknown
  classifier_confidence NUMERIC(4,3),
  ocr_text              TEXT,                       -- extracted text
  metadata              JSONB DEFAULT '{}'::jsonb,  -- extra fields (e.g. PAN number extracted)
  download_status       TEXT NOT NULL DEFAULT 'pending', -- pending|downloaded|failed
  classified_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS files_contact_id_idx ON files(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS files_doc_category_idx ON files(doc_category);
CREATE UNIQUE INDEX IF NOT EXISTS files_sha256_uniq ON files(sha256) WHERE sha256 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- messages: every inbound + outbound message
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  wa_message_id       TEXT UNIQUE,                  -- Meta's message id (wamid.xxx)
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  msg_type            TEXT NOT NULL,                -- text, image, document, audio, video, sticker, location, template, interactive, reaction
  body                TEXT,                         -- text content, or caption
  template_name       TEXT,                         -- if msg_type='template'
  template_params     JSONB,                        -- variables passed
  file_id             UUID REFERENCES files(id),    -- if a media message
  status              TEXT NOT NULL DEFAULT 'received',  -- received|sent|delivered|read|failed
  error               JSONB,                        -- last error payload from Meta, if any
  raw                 JSONB,                        -- full webhook payload for audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_contact_id_created_at_idx
  ON messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_wa_message_id_idx ON messages(wa_message_id);

-- ---------------------------------------------------------------------------
-- templates: cache of approved WhatsApp templates (synced from Meta)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  language            TEXT NOT NULL,
  category            TEXT,                         -- MARKETING|UTILITY|AUTHENTICATION
  status              TEXT,                         -- APPROVED|PENDING|REJECTED
  components          JSONB NOT NULL,               -- raw component definition from Meta
  variable_count      INT NOT NULL DEFAULT 0,       -- count of {{n}} placeholders in body
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, language)
);

-- ---------------------------------------------------------------------------
-- webhook_events: raw event log for debugging + reprocessing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id                  BIGSERIAL PRIMARY KEY,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_valid     BOOLEAN NOT NULL,
  payload             JSONB NOT NULL,
  processed           BOOLEAN NOT NULL DEFAULT FALSE,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events(received_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger to bump contacts.updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_touch_updated_at ON contacts;
CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
