// Document workflow helpers.
//
// Lifecycle:
//   1. When a lead is created from a source, instantiateLeadSlots seeds one
//      lead_doc_slots row per matching doc_requirement (per source + product).
//   2. Files come in (via WhatsApp media or direct upload) and get attached to
//      a slot via lead_doc_files. attachFileToSlot bumps the slot to 'received'.
//   3. Agents verify (→ 'verified') or reject (→ 'rejected' + reason).
//      Rejection emits an event so a re-request template can be sent.
//   4. When every non-optional slot is 'verified', emit doc.complete and
//      transition the lead to docs_received.

import { query, withTx } from '../db/client.js';
import { emit } from '../events/bus.js';

export async function instantiateLeadSlots(
  leadId: string,
  sourceId: string,
  product: string | null
): Promise<number> {
  const { rows } = await query<{
    id: string;
    doc_category: string;
    required_count: number;
    display_order: number;
    label: string | null;
    description: string | null;
    optional: boolean;
  }>(
    // Match requirements that apply to this source, where product is either
    // unspecified (NULL = applies to all) or matches the lead's product.
    `SELECT id, doc_category, required_count, display_order, label, description, optional
       FROM doc_requirements
      WHERE source_id = $1
        AND (product IS NULL OR product = $2)
      ORDER BY display_order, doc_category`,
    [sourceId, product]
  );
  if (rows.length === 0) return 0;

  await withTx(async (client) => {
    for (const r of rows) {
      await client.query(
        `INSERT INTO lead_doc_slots
           (lead_id, requirement_id, doc_category, required_count,
            label, description, optional, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [leadId, r.id, r.doc_category, r.required_count, r.label, r.description, r.optional, r.display_order]
      );
    }
  });
  return rows.length;
}

/**
 * Attach a file to a slot. Bumps slot to 'received' if not yet verified.
 * Returns the updated slot.
 */
export async function attachFileToSlot(opts: {
  slotId: string;
  fileId: string;
  attachedBy: string | null;
}): Promise<void> {
  await withTx(async (client) => {
    await client.query(
      `INSERT INTO lead_doc_files (slot_id, file_id, attached_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [opts.slotId, opts.fileId, opts.attachedBy]
    );

    // Only auto-bump to 'received' if not already verified — agent verdict wins.
    await client.query(
      `UPDATE lead_doc_slots
          SET status = 'received',
              rejection_reason = NULL,
              verified_by = NULL,
              verified_at = NULL
        WHERE id = $1 AND status IN ('pending', 'rejected')`,
      [opts.slotId]
    );
  });

  const { rows } = await query<{ lead_id: string; status: string }>(
    `SELECT lead_id, status FROM lead_doc_slots WHERE id = $1`,
    [opts.slotId]
  );
  if (rows[0]) {
    emit('doc.received', {
      lead_id: rows[0].lead_id,
      slot_id: opts.slotId,
      file_id: opts.fileId,
    });
  }
}

export async function setSlotStatus(opts: {
  slotId: string;
  status: 'verified' | 'rejected';
  reason?: string | null;
  byUserId: string;
}): Promise<{ lead_id: string }> {
  const { rows } = await query<{ lead_id: string }>(
    `UPDATE lead_doc_slots
        SET status = $1,
            rejection_reason = $2,
            verified_by = $3,
            verified_at = NOW()
      WHERE id = $4
      RETURNING lead_id`,
    [opts.status, opts.status === 'rejected' ? (opts.reason ?? null) : null, opts.byUserId, opts.slotId]
  );
  if (!rows[0]) throw new Error('slot_not_found');

  emit(opts.status === 'verified' ? 'doc.verified' : 'doc.rejected', {
    lead_id: rows[0].lead_id,
    slot_id: opts.slotId,
    reason: opts.reason ?? null,
  });

  // If all non-optional slots are now verified, flip the lead's status.
  if (opts.status === 'verified') await maybeFlipLeadToDocsReceived(rows[0].lead_id);

  return rows[0];
}

async function maybeFlipLeadToDocsReceived(leadId: string) {
  const { rows } = await query<{ pending_count: number }>(
    `SELECT COUNT(*)::int AS pending_count
       FROM lead_doc_slots
      WHERE lead_id = $1
        AND optional = FALSE
        AND status <> 'verified'`,
    [leadId]
  );
  if ((rows[0]?.pending_count ?? 0) === 0) {
    const upd = await query<{ status: string }>(
      `UPDATE leads
          SET status = 'docs_received'
        WHERE id = $1
          AND status IN ('new', 'contacted', 'qualified', 'docs_pending')
        RETURNING status`,
      [leadId]
    );
    if (upd.rows[0]) {
      emit('doc.complete', { lead_id: leadId });
      emit('lead.status_changed', { lead_id: leadId, to: 'docs_received', reason: 'all_docs_verified' });
    }
  }
}
