-- 0005 — Customer-detail enrichment on contacts.
-- enrichment: arbitrary JSON pulled from / pushed by external apps
--             (KYC, bureau summary, loan status, app profile, etc.)
-- enriched_at: last time it was refreshed

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS enrichment  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
