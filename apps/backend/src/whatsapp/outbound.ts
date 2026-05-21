// High-level outbound helpers — send a template to a contact, picking the
// right brand WA number based on the lead (or contact). Persists the
// outgoing message row so it appears in the chat UI just like any other.

import { query } from '../db/client.js';
import { sendTemplate, getNumberContext } from './api.js';
import { sseBroadcast } from '../lib/sse.js';
import { emit } from '../events/bus.js';

export interface SendTemplateToLeadOpts {
  leadId: string;
  templateName: string;
  language?: string;
  bodyParams?: string[];
}

/**
 * Send a template to the customer associated with a lead, using that lead's
 * brand WA number. Best-effort: failures are logged but do not throw, so
 * automated journeys don't bomb out a transaction.
 */
export async function sendTemplateToLead(opts: SendTemplateToLeadOpts): Promise<void> {
  const { rows } = await query<{
    contact_id: string;
    wa_id: string;
    whatsapp_number_id: string | null;
  }>(
    `SELECT l.contact_id, c.wa_id, l.whatsapp_number_id
       FROM leads l JOIN contacts c ON c.id = l.contact_id
      WHERE l.id = $1`,
    [opts.leadId]
  );
  const row = rows[0];
  if (!row) return;

  const ctx = await getNumberContext(row.whatsapp_number_id);

  try {
    const res = await sendTemplate(
      row.wa_id,
      opts.templateName,
      opts.language ?? 'en',
      opts.bodyParams ?? [],
      { ctx }
    );
    const waMessageId = res.messages?.[0]?.id;
    const inserted = await query<{ id: string }>(
      `INSERT INTO messages
         (contact_id, wa_message_id, direction, msg_type, body,
          template_name, template_params, status, raw, whatsapp_number_id)
       VALUES ($1, $2, 'out', 'template', NULL, $3, $4, 'sent', $5, $6)
       RETURNING id`,
      [
        row.contact_id,
        waMessageId,
        opts.templateName,
        opts.bodyParams ?? [],
        res,
        row.whatsapp_number_id,
      ]
    );
    await query(`UPDATE contacts SET last_outbound_at = NOW() WHERE id = $1`, [row.contact_id]);
    sseBroadcast({ type: 'message.new', contactId: row.contact_id, messageId: inserted.rows[0].id });
    emit('message.sent', {
      message_id: inserted.rows[0].id,
      contact_id: row.contact_id,
      lead_id: opts.leadId,
      template: opts.templateName,
    });
  } catch (err) {
    console.error(`[outbound] template send to lead ${opts.leadId} failed:`, err);
  }
}
