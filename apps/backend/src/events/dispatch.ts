// Wires the in-process event bus to two consumers:
//   1. Outbound webhook subscriptions in the DB (fan out to external systems)
//   2. Registered adapters that opt in via onEvent
//
// Called once from server boot.

import { on } from './bus.js';
import { query } from '../db/client.js';
import { webhookQueue } from '../lib/queue.js';
import { listAdapters } from '../integrations/registry.js';
import { config } from '../config.js';
import { sendTemplateToLead } from '../whatsapp/outbound.js';
import type { CrmEvent } from '@crm/shared';

export function startEventDispatch() {
  on('*', async (event: CrmEvent) => {
    await fanOutToWebhooks(event);
    await fanOutToAdapters(event);
  });

  // doc.rejected → send re-request template to the customer.
  on('doc.rejected', async (event) => {
    const p = event.payload as { lead_id: string; slot_id: string; reason: string | null };
    const { rows } = await query<{ label: string | null; doc_category: string }>(
      `SELECT label, doc_category FROM lead_doc_slots WHERE id = $1`,
      [p.slot_id]
    );
    const slot = rows[0];
    if (!slot) return;
    const docName = slot.label ?? slot.doc_category.replace(/_/g, ' ');
    await sendTemplateToLead({
      leadId: p.lead_id,
      templateName: config.DOC_REREQUEST_TEMPLATE,
      language: config.DOC_REREQUEST_LANGUAGE,
      bodyParams: [docName, p.reason ?? 'Please re-upload a clear copy.'],
    });
  });
}

async function fanOutToWebhooks(event: CrmEvent) {
  // Pick subscriptions interested in this event type.
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM outbound_webhooks
      WHERE active = TRUE
        AND $1 = ANY(events)`,
    [event.type]
  );
  for (const sub of rows) {
    const insert = await query<{ id: string }>(
      `INSERT INTO outbound_webhook_deliveries (webhook_id, event_type, payload)
       VALUES ($1, $2, $3) RETURNING id`,
      [sub.id, event.type, event.payload as object]
    );
    await webhookQueue.add(
      'deliver',
      { deliveryId: insert.rows[0].id },
      {
        attempts: config.WEBHOOK_DELIVERY_RETRIES,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }
    );
  }
}

async function fanOutToAdapters(event: CrmEvent) {
  const adapters = listAdapters().filter((a) => a.onEvent);
  if (adapters.length === 0) return;

  // Load active integration rows once; pick rows matching adapter slugs.
  const { rows } = await query<{
    id: string;
    slug: string;
    config: Record<string, unknown>;
    base_url: string | null;
  }>(
    `SELECT id, slug, config, base_url FROM integrations
      WHERE active = TRUE AND slug = ANY($1)`,
    [adapters.map((a) => a.slug)]
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  for (const adapter of adapters) {
    const row = bySlug.get(adapter.slug);
    if (!row) continue;
    try {
      await adapter.onEvent!(event, {
        integrationId: row.id,
        config: row.config,
        baseUrl: row.base_url,
      });
    } catch (err) {
      console.error(`[adapter:${adapter.slug}] failed on ${event.type}:`, err);
    }
  }
}
