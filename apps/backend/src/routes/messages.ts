import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { createHash } from 'node:crypto';
import mime from 'mime-types';
import { sendText, sendTemplate, getNumberContext, uploadMedia, sendMediaById } from '../whatsapp/api.js';
import { storage } from '../storage/index.js';
import { sseBroadcast } from '../lib/sse.js';
import { canAccessContact } from '../lib/scope.js';

const SESSION_WINDOW_HOURS = 24;

export async function registerMessageRoutes(app: FastifyInstance) {
  // List messages for a contact (newest first, paginated)
  app.get('/api/contacts/:id/messages', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) { reply.code(403).send({ error: 'forbidden' }); return; }
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const before = q.before; // ISO timestamp cursor

    const args: unknown[] = [id];
    let cursor = '';
    if (before) {
      args.push(before);
      cursor = `AND created_at < $${args.length}`;
    }
    args.push(limit);
    const { rows } = await query(
      `SELECT m.id, m.wa_message_id, m.direction, m.msg_type, m.body,
              m.template_name, m.template_params,
              m.file_id, m.status, m.created_at,
              f.mime_type AS file_mime, f.filename AS file_name,
              f.size_bytes AS file_size, f.doc_category, f.download_status
         FROM messages m
    LEFT JOIN files f ON f.id = m.file_id
        WHERE m.contact_id = $1
        ${cursor}
        ORDER BY m.created_at DESC
        LIMIT $${args.length}`,
      args
    );
    return { messages: rows.reverse() }; // chronological for the UI
  });

  // Send a message (text or template)
  const sendSchema = z.object({
    contact_id: z.string().uuid().optional(),
    to: z.string().optional(),  // either contact_id or to (E.164) required
    // Override the brand WA number to send from. If omitted, we pick the
    // most-recent lead's brand for this contact, or fall back to env defaults.
    whatsapp_number_id: z.string().uuid().optional(),
    type: z.enum(['text', 'template']),
    text: z.string().optional(),
    template: z
      .object({
        name: z.string(),
        language: z.string().default('en'),
        body_params: z.array(z.string()).default([]),
      })
      .optional(),
  });

  app.post('/api/messages', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = sendSchema.parse(req.body);

    if (body.contact_id && !(await canAccessContact(req.user!, body.contact_id))) {
      reply.code(403).send({ error: 'forbidden' }); return;
    }

    // Resolve contact
    type ContactRow = { id: string; wa_id: string; last_inbound_at: Date | null };
    let contact: ContactRow | undefined;
    if (body.contact_id) {
      const { rows } = await query<ContactRow>(
        `SELECT id, wa_id, last_inbound_at FROM contacts WHERE id = $1`,
        [body.contact_id]
      );
      contact = rows[0];
    } else if (body.to) {
      const waId = body.to.replace(/^\+/, '');
      const phoneE164 = body.to.startsWith('+') ? body.to : `+${body.to}`;
      const { rows } = await query<ContactRow>(
        `INSERT INTO contacts (wa_id, phone_e164) VALUES ($1, $2)
         ON CONFLICT (wa_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
         RETURNING id, wa_id, last_inbound_at`,
        [waId, phoneE164]
      );
      contact = rows[0];
    }
    if (!contact) {
      reply.code(400).send({ error: 'contact_id or to is required' });
      return;
    }

    // Enforce 24-hour session window for freeform text
    if (body.type === 'text') {
      const lastIn = contact.last_inbound_at;
      const withinWindow =
        lastIn && Date.now() - new Date(lastIn).getTime() < SESSION_WINDOW_HOURS * 3600 * 1000;
      if (!withinWindow) {
        reply.code(409).send({
          error: 'outside_session_window',
          message:
            'No inbound message from this contact in the last 24 hours. Use a template instead.',
        });
        return;
      }
      if (!body.text) {
        reply.code(400).send({ error: 'text is required for type=text' });
        return;
      }
    }

    if (body.type === 'template' && !body.template) {
      reply.code(400).send({ error: 'template is required for type=template' });
      return;
    }

    // Resolve which brand WA number to send from.
    // Precedence: explicit override → contact's most recent lead's brand → env default.
    let numberId = body.whatsapp_number_id ?? null;
    if (!numberId) {
      const { rows } = await query<{ whatsapp_number_id: string | null }>(
        `SELECT whatsapp_number_id FROM leads
          WHERE contact_id = $1 AND whatsapp_number_id IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [contact.id]
      );
      numberId = rows[0]?.whatsapp_number_id ?? null;
    }
    const ctx = await getNumberContext(numberId);

    // Send via Meta
    let waResponse;
    try {
      if (body.type === 'text') {
        waResponse = await sendText(contact.wa_id, body.text!, { ctx });
      } else {
        const t = body.template!;
        waResponse = await sendTemplate(contact.wa_id, t.name, t.language, t.body_params, { ctx });
      }
    } catch (err: unknown) {
      const e = err as { status?: number; body?: unknown };
      reply.code(502).send({ error: 'whatsapp_api_error', detail: e.body ?? String(err) });
      return;
    }

    const waMessageId = waResponse.messages?.[0]?.id;
    const inserted = await query(
      `INSERT INTO messages
         (contact_id, wa_message_id, direction, msg_type, body,
          template_name, template_params, status, raw, whatsapp_number_id)
       VALUES ($1, $2, 'out', $3, $4, $5, $6, 'sent', $7, $8)
       RETURNING *`,
      [
        contact.id,
        waMessageId,
        body.type,
        body.type === 'text' ? body.text : null,
        body.type === 'template' ? body.template!.name : null,
        body.type === 'template' ? body.template!.body_params : null,
        waResponse,
        numberId,
      ]
    );
    await query(`UPDATE contacts SET last_outbound_at = NOW() WHERE id = $1`, [contact.id]);

    sseBroadcast({ type: 'message.new', contactId: contact.id, messageId: inserted.rows[0].id });

    return { message: inserted.rows[0] };
  });

  // ---------------------------------------------------------------------
  // Voice notes (and other audio): multipart upload + send as WhatsApp audio.
  // POST /api/messages/voice  (multipart)
  //   fields: contact_id (required), whatsapp_number_id (optional override)
  //   file:   audio/ogg, audio/mpeg, audio/aac, audio/amr (Meta-supported)
  // ---------------------------------------------------------------------
  app.post('/api/messages/voice', { preHandler: app.requireAuth }, async (req, reply) => {
    type MultipartReq = typeof req & {
      parts: () => AsyncIterable<{
        type: 'file' | 'field';
        fieldname: string;
        filename?: string;
        mimetype?: string;
        toBuffer?: () => Promise<Buffer>;
        value?: string;
      }>;
    };
    let contactId: string | null = null;
    let numberId: string | null = null;
    let audio: { buffer: Buffer; mimetype: string; filename: string } | null = null;
    for await (const part of (req as unknown as MultipartReq).parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'contact_id') contactId = String(part.value);
        if (part.fieldname === 'whatsapp_number_id') numberId = String(part.value);
      } else if (part.type === 'file' && part.toBuffer) {
        const buf = await part.toBuffer();
        audio = {
          buffer: buf,
          mimetype: part.mimetype ?? 'audio/ogg',
          filename: part.filename ?? 'voice.ogg',
        };
      }
    }
    if (!contactId) { reply.code(400).send({ error: 'contact_id required' }); return reply; }
    if (!audio) { reply.code(400).send({ error: 'no_audio' }); return reply; }
    if (!(await canAccessContact(req.user!, contactId))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }

    // Resolve brand
    if (!numberId) {
      const r = await query<{ whatsapp_number_id: string | null }>(
        `SELECT whatsapp_number_id FROM leads
          WHERE contact_id = $1 AND whatsapp_number_id IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [contactId]
      );
      numberId = r.rows[0]?.whatsapp_number_id ?? null;
    }
    const ctx = await getNumberContext(numberId);

    // Persist the file (so the chat UI can replay it later).
    const sha = createHash('sha256').update(audio.buffer).digest('hex');
    const ext = mime.extension(audio.mimetype) || 'ogg';
    const file = await query<{ id: string; wa_id: string }>(
      `WITH c AS (SELECT wa_id FROM contacts WHERE id = $1)
       INSERT INTO files (contact_id, mime_type, filename, size_bytes,
                          storage_key, sha256, download_status)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'downloaded')
       RETURNING id, (SELECT wa_id FROM c) AS wa_id`,
      [contactId, audio.mimetype, audio.filename, audio.buffer.length, sha]
    );
    const fileId = file.rows[0].id;
    const waId = file.rows[0].wa_id;
    const key = `media/${contactId}/${fileId}.${ext}`;
    await storage.put(key, audio.buffer, audio.mimetype);
    await query(`UPDATE files SET storage_key = $1 WHERE id = $2`, [key, fileId]);

    // Upload to Meta, then send by id
    let waResponse;
    try {
      const up = await uploadMedia(audio.buffer, audio.mimetype, audio.filename, ctx);
      waResponse = await sendMediaById(waId, up.id, 'audio', { ctx });
    } catch (err: unknown) {
      const e = err as { status?: number; body?: unknown };
      reply.code(502).send({ error: 'whatsapp_api_error', detail: e.body ?? String(err) });
      return reply;
    }

    const waMessageId = waResponse.messages?.[0]?.id;
    const msg = await query(
      `INSERT INTO messages
         (contact_id, wa_message_id, direction, msg_type, body, file_id,
          status, raw, whatsapp_number_id)
       VALUES ($1, $2, 'out', 'audio', NULL, $3, 'sent', $4, $5)
       RETURNING *`,
      [contactId, waMessageId, fileId, waResponse, numberId]
    );
    await query(`UPDATE contacts SET last_outbound_at = NOW() WHERE id = $1`, [contactId]);
    sseBroadcast({ type: 'message.new', contactId, messageId: msg.rows[0].id });
    return { message: msg.rows[0] };
  });
}
