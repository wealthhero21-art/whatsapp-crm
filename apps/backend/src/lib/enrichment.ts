// Customer-detail enrichment.
//
// PULL: when a new contact appears, we call an external "customer lookup" URL
// (configured on an integration row) with the phone number, and merge the
// returned JSON into contacts.enrichment. This is the "fetch details of the
// customer in realtime from my other app" flow.
//
// Configure by creating an integration (admin → Integrations) with:
//   kind:   'crm' (or 'custom')
//   config: {
//     "customer_lookup_url": "https://app.maximoney.in/api/customer?phone={phone}",
//     "customer_lookup_method": "GET",            // GET (default) or POST
//     "customer_lookup_auth_header": "Bearer xxxxx" // optional
//   }
// {phone} in the URL is replaced with the E.164 number (URL-encoded). For POST,
// the body is { phone } JSON.
//
// PUSH is handled separately in routes/contacts.ts (POST /api/contacts/upsert).

import { fetch } from 'undici';
import { query } from '../db/client.js';
import { emit } from '../events/bus.js';

interface LookupConfig {
  customer_lookup_url?: string;
  customer_lookup_method?: string;
  customer_lookup_auth_header?: string;
}

async function getLookupConfig(): Promise<{ url: string; method: string; authHeader?: string } | null> {
  const { rows } = await query<{ config: LookupConfig }>(
    `SELECT config FROM integrations
      WHERE active = TRUE
        AND config ? 'customer_lookup_url'
      ORDER BY updated_at DESC
      LIMIT 1`
  );
  const cfg = rows[0]?.config;
  if (!cfg?.customer_lookup_url) return null;
  return {
    url: cfg.customer_lookup_url,
    method: (cfg.customer_lookup_method || 'GET').toUpperCase(),
    authHeader: cfg.customer_lookup_auth_header,
  };
}

/**
 * Fetch customer details from the configured external app and merge into the
 * contact's enrichment. Best-effort: never throws to callers.
 */
export async function enrichContact(contactId: string, phoneE164: string): Promise<void> {
  try {
    const cfg = await getLookupConfig();
    if (!cfg) return; // no lookup configured — nothing to do

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (cfg.authHeader) headers.Authorization = cfg.authHeader;

    let res;
    if (cfg.method === 'POST') {
      res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ phone: phoneE164 }) });
    } else {
      const url = cfg.url.includes('{phone}')
        ? cfg.url.replace('{phone}', encodeURIComponent(phoneE164))
        : `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}phone=${encodeURIComponent(phoneE164)}`;
      res = await fetch(url, { method: 'GET', headers });
    }
    if (!res.ok) {
      console.warn(`[enrich] lookup for ${phoneE164} returned ${res.status}`);
      return;
    }
    const data = (await res.json()) as Record<string, unknown>;

    await query(
      `UPDATE contacts
          SET enrichment = enrichment || $1::jsonb,
              enriched_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(data), contactId]
    );
    emit('contact.enriched', { contact_id: contactId, source: 'lookup' });
  } catch (err) {
    console.error(`[enrich] failed for ${phoneE164}:`, err);
  }
}
