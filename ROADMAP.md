# Roadmap — Phases 2 to 5

Phase 1 (foundation + chat UI) is shipped in this codebase. The pieces below are scoped but not yet built.

## Phase 2 — Inbound integration with your leads DB

**Goal:** when a customer messages, auto-link to existing lead, and surface lead context in the chat UI.

- New table `lead_sync_config` — store base URL + auth header for each downstream leads DB
- Worker job `lead-sync` — on new contact, call your leads-DB API by phone number to find a match; write `external_lead_id` back to contacts
- Webhook out: emit `contact.created` and `message.received` events so your loan apps can react
- UI: expand the right-hand panel header to show lead status, current loan product, application stage

## Phase 3 — Document classification

**Goal:** auto-tag every incoming file as PAN / Aadhaar / Salary Slip / Bank Stmt / ITR / etc.

- Queue `classify` (already stubbed in `queue.ts`)
- Step 1: OCR with `tesseract.js` for images, `pdf-parse` for PDFs
- Step 2: rule pass — regex patterns:
  - PAN: `/[A-Z]{5}[0-9]{4}[A-Z]/` plus the word "Income Tax"
  - Aadhaar: `/\b\d{4}\s?\d{4}\s?\d{4}\b/` plus "GOVERNMENT OF INDIA"
  - Salary slip: "Net Pay", "Gross Earnings", employer name
  - Bank stmt: "Opening Balance", "Closing Balance", IFSC pattern
- Step 3 (fallback): LLM call with OCR text + filename → returns category + confidence + extracted PII (PAN number, account number, etc.) → writes to `files.metadata`
- UI: badge on file card showing confidence; operators can override (already supported)

## Phase 4 — REST integration with your loan app(s)

**Goal:** push verified documents and customer details into your loan origination system on demand.

- New table `loan_app_destinations` — name, base URL, auth, field mapping
- `POST /api/contacts/:id/push-to/:destination` — bundles contact + classified files + recent transcript, POSTs to destination
- Webhook subscribers (`outbound_webhooks` table): destinations get notified on `file.classified`, `contact.tagged`, `message.received`
- UI: "Push to loan app" button in the files panel header with progress and result

## Phase 5 — Outbound workflows + templates UI

**Goal:** make template management and broadcast/drip campaigns first-class.

- Template CRUD UI — create/edit/submit-for-approval directly from CRM (uses `POST /{WABA_ID}/message_templates`)
- Scheduled sends, broadcast lists by tag, drip cadence
- Doc-pending nudges: a worker scans contacts with `external_lead_id` but missing categories and auto-sends the appropriate template
- Analytics: response rate, time-to-doc-collection, conversion funnel

## Operational additions worth doing early

- Auth on the CRM (single-tenant: just basic auth; multi-tenant later)
- Audit log table for all human actions
- Daily backup of `media/` to a second bucket
- Rate-limit guard on `/api/messages` to stay within Meta tier limits
- Phone-number-quality monitoring (Meta downgrades quality on too many complaints)
