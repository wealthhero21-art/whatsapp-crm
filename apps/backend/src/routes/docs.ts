// /api/leads/:id/docs   list slots with attached files
// /api/leads/:id/docs   POST add ad-hoc slot
// /api/doc-slots/:id    PATCH status / details
// /api/doc-slots/:id/attach { file_id }    add an existing file to a slot
// /api/doc-slots/:id/verify
// /api/doc-slots/:id/reject { reason }

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { canAccessLead, canAccessContact } from '../lib/scope.js';
import { attachFileToSlot, setSlotStatus } from '../lib/docs.js';
import { audit } from '../lib/audit.js';

export async function registerDocRoutes(app: FastifyInstance) {
  // List slots for a lead, with attached files inlined.
  app.get('/api/leads/:id/docs', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessLead(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    const { rows } = await query<{
      id: string;
      lead_id: string;
      doc_category: string;
      required_count: number;
      label: string | null;
      description: string | null;
      optional: boolean;
      display_order: number;
      status: string;
      rejection_reason: string | null;
      verified_by: string | null;
      verified_at: string | null;
      created_at: string;
      updated_at: string;
      files: unknown;
    }>(
      `SELECT s.id, s.lead_id, s.doc_category, s.required_count,
              s.label, s.description, s.optional, s.display_order,
              s.status, s.rejection_reason, s.verified_by, s.verified_at,
              s.created_at, s.updated_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'id', f.id,
                          'filename', f.filename,
                          'mime_type', f.mime_type,
                          'size_bytes', f.size_bytes,
                          'created_at', f.created_at,
                          'attached_at', ldf.attached_at
                        ) ORDER BY ldf.attached_at)
                   FROM lead_doc_files ldf
                   JOIN files f ON f.id = ldf.file_id
                  WHERE ldf.slot_id = s.id),
                '[]'::json
              ) AS files
         FROM lead_doc_slots s
        WHERE s.lead_id = $1
        ORDER BY s.display_order, s.created_at`,
      [id]
    );
    return { slots: rows };
  });

  // Add a one-off slot (e.g. agent needs an extra doc not in the checklist)
  app.post('/api/leads/:id/docs', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessLead(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    const body = z.object({
      doc_category: z.string().min(1),
      required_count: z.number().int().positive().default(1),
      label: z.string().optional(),
      description: z.string().optional(),
      optional: z.boolean().default(false),
    }).parse(req.body);
    const { rows } = await query(
      `INSERT INTO lead_doc_slots
         (lead_id, doc_category, required_count, label, description, optional, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(display_order) + 1 FROM lead_doc_slots WHERE lead_id = $1), 0))
       RETURNING *`,
      [id, body.doc_category, body.required_count, body.label ?? null, body.description ?? null, body.optional]
    );
    await audit({ actorUserId: req.user!.id, action: 'doc.slot.create', entityType: 'lead_doc_slot', entityId: rows[0].id });
    reply.code(201).send({ slot: rows[0] });
    return reply;
  });

  // Attach a file (already uploaded — either via WhatsApp media or direct upload)
  app.post('/api/doc-slots/:id/attach', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ file_id: z.string().uuid() }).parse(req.body);

    // Slot must belong to a lead the user can see, and file must belong to the
    // same contact so an agent can't poach a file from outside their scope.
    const ctx = await query<{ lead_id: string; contact_id: string; file_contact: string }>(
      `SELECT s.lead_id, l.contact_id, f.contact_id AS file_contact
         FROM lead_doc_slots s
         JOIN leads l ON l.id = s.lead_id
         JOIN files f ON f.id = $1
        WHERE s.id = $2`,
      [body.file_id, id]
    );
    const row = ctx.rows[0];
    if (!row) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (row.contact_id !== row.file_contact) {
      reply.code(400).send({ error: 'file_belongs_to_different_contact' }); return reply;
    }
    if (!(await canAccessContact(req.user!, row.contact_id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }

    await attachFileToSlot({ slotId: id, fileId: body.file_id, attachedBy: req.user!.id });
    await audit({ actorUserId: req.user!.id, action: 'doc.attach', entityType: 'lead_doc_slot', entityId: id, after: { file_id: body.file_id } });
    return { ok: true };
  });

  app.post('/api/doc-slots/:id/verify', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const slot = await query<{ lead_id: string }>(
      `SELECT lead_id FROM lead_doc_slots WHERE id = $1`, [id]
    );
    if (!slot.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (!(await canAccessLead(req.user!, slot.rows[0].lead_id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    await setSlotStatus({ slotId: id, status: 'verified', byUserId: req.user!.id });
    await audit({ actorUserId: req.user!.id, action: 'doc.verify', entityType: 'lead_doc_slot', entityId: id });
    return { ok: true };
  });

  app.post('/api/doc-slots/:id/reject', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
    const slot = await query<{ lead_id: string }>(
      `SELECT lead_id FROM lead_doc_slots WHERE id = $1`, [id]
    );
    if (!slot.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (!(await canAccessLead(req.user!, slot.rows[0].lead_id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    await setSlotStatus({ slotId: id, status: 'rejected', reason: body.reason, byUserId: req.user!.id });
    await audit({ actorUserId: req.user!.id, action: 'doc.reject', entityType: 'lead_doc_slot', entityId: id, after: { reason: body.reason } });
    return { ok: true };
  });
}
