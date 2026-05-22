# Maximoney → WhatsApp CRM: "Send to CRM" integration

Hand this file to the Claude session building the Maximoney app. It's the full
contract for the **Send to CRM** button: one HTTP call adds the customer to the
CRM with all their details and creates a lead that agents can engage over WhatsApp.

## Endpoint

```
POST https://crm.maximoney.in/api/leads/ingest
```

## Headers

| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | |
| `X-Api-Key` | `crm_6ebaaa9a5561159518b8984ff46ff1128ec9c9c61b0420cf` | Secret. Store server-side (env var), never in the mobile/web client. |
| `Idempotency-Key` | a **stable** id per customer, e.g. the Maximoney customer id | Pressing the button twice won't create duplicates. |

> ⚠️ Call this from the **Maximoney backend**, not the browser/app client — the API key must stay secret. The "Send to CRM" button hits your own backend, which then calls this endpoint.

## Request body

```jsonc
{
  "source_slug": "maximoney-app",        // fixed — attributes the lead to Maximoney
  "source_ref": "MAXI-CUST-9001",        // the customer's unique id in Maximoney (dedupe key)
  "phone": "+919876543210",              // E.164 with country code
  "contact_name": "Asha Verma",
  "product": "personal_loan",            // optional: loan product
  "amount": 250000,                       // optional: requested amount (number)

  // Everything in `customer` shows in the CRM chat's "Customer details" panel.
  // Put whatever you have — KYC, bureau, profile, etc. Free-form keys.
  "customer": {
    "kyc_status": "verified",
    "pan": "ABCDE1234F",
    "aadhaar_last4": "1234",
    "bureau_score": 742,
    "monthly_income": 85000,
    "employer": "Acme Corp",
    "city": "Mumbai",
    "maximoney_id": "MAXI-CUST-9001",
    "application_stage": "kyc_done",
    "profile_url": "https://app.maximoney.in/customers/9001"
  }
}
```

Only `source_slug` + `phone` are strictly required. Everything else is optional.

## Response

```json
{ "lead_id": "662a0021-...", "assigned_to": "agent-uuid-or-null" }
```

- `200/201` → success. `assigned_to` is the agent it was auto-routed to (round-robin across agents who have access to the Maximoney source), or `null` if no agents are assigned to the source yet.
- `401` → bad/missing API key.
- `400` → missing phone.

## Example (server-side)

```bash
curl -X POST https://crm.maximoney.in/api/leads/ingest \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $CRM_API_KEY" \
  -H "Idempotency-Key: $MAXIMONEY_CUSTOMER_ID" \
  -d '{
    "source_slug": "maximoney-app",
    "source_ref": "'"$MAXIMONEY_CUSTOMER_ID"'",
    "phone": "'"$CUSTOMER_PHONE_E164"'",
    "contact_name": "'"$CUSTOMER_NAME"'",
    "product": "personal_loan",
    "amount": 250000,
    "customer": { "kyc_status": "verified", "bureau_score": 742, "...": "..." }
  }'
```

```ts
// Node/TS example for the Maximoney backend
async function sendToCRM(customer) {
  const res = await fetch('https://crm.maximoney.in/api/leads/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.CRM_API_KEY!,
      'Idempotency-Key': customer.id,
    },
    body: JSON.stringify({
      source_slug: 'maximoney-app',
      source_ref: customer.id,
      phone: customer.phoneE164,
      contact_name: customer.name,
      product: customer.product,
      amount: customer.requestedAmount,
      customer: {
        kyc_status: customer.kycStatus,
        pan: customer.pan,
        bureau_score: customer.bureauScore,
        monthly_income: customer.monthlyIncome,
        employer: customer.employer,
        city: customer.city,
        maximoney_id: customer.id,
        application_stage: customer.stage,
      },
    }),
  });
  if (!res.ok) throw new Error(`CRM ingest failed: ${res.status} ${await res.text()}`);
  return res.json(); // { lead_id, assigned_to }
}
```

## Keeping the CRM in sync after the first send (optional)

Whenever the customer's details change in Maximoney (KYC completes, bureau pulled,
stage advances), call the same endpoint again with the same `source_ref` /
`Idempotency-Key` reuse is NOT needed for updates — drop the `Idempotency-Key`
header (or use a new one) so the update goes through. The `customer` object is
merged into the existing record, so the CRM chat panel always shows the latest.

Alternatively, push contact-only updates (no new lead) to:
```
POST https://crm.maximoney.in/api/contacts/upsert
  body: { "phone": "+91...", "enrichment": { ...changed fields... } }
```

## Notes for the CRM side (already configured)

- Integration: **Maximoney App** (`maximoney-app`)
- Lead source: **Maximoney App** (`maximoney-app`), assignment = round-robin,
  tied to the Maximoney WhatsApp number (+91 99584 21835)
- API key scopes: `leads:write`, `contacts:write`
- To route these leads to specific agents: Admin → Sources → Maximoney App →
  add agents. Until then leads land unassigned (admin can assign manually).
- Rotate the API key anytime: Admin → Integrations → Maximoney App → API keys.
