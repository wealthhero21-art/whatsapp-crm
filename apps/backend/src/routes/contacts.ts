import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { canAccessContact, contactScopeSql } from '../lib/scope.js';
import { redactPhones, redactPhonesAll } from '../lib/redact.js';
import { requireApiKey } from '../auth/apiKey.js';
import { enrichContact } from '../lib/enrichment.js';
import { emit } from '../events/bus.js';

function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return input.startsWith('+') ? `+${digits}` : `+${digits}`;
}

export async function registerContactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const search = (q.search ?? '').trim();

    const args: unknown[] = [];
    const conds: string[] = [];

    const scope = contactScopeSql(args, req.user!);
    if (scope !== 'TRUE') conds.push(scope);

    if (search) {
      args.push(`%${search}%`);
      conds.push(`(phone_e164 ILIKE $${args.length}
                OR profile_name ILIKE $${args.length}
                OR display_name ILIKE $${args.length}
                OR external_lead_id ILIKE $${args.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    args.push(limit);

    const { rows } = await query(
      `SELECT id, wa_id, phone_e164, profile_name, display_name,
              external_lead_id, external_app_id, tags,
              last_inbound_at, last_outbound_at, unread_count
         FROM contacts
        ${where}
        ORDER BY GREATEST(COALESCE(last_inbound_at, 'epoch'), COALESCE(last_outbound_at, 'epoch')) DESC
        LIMIT $${args.length}`,
      args
    );
    return { contacts: redactPhonesAll(rows, req.user!.role) };
  });

  app.get('/api/contacts/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return;
    }
    const c = await query(`SELECT * FROM contacts WHERE id = $1`, [id]);
    if (c.rows.length === 0) { reply.code(404).send({ error: 'not found' }); return; }
    return { contact: redactPhones(c.rows[0], req.user!.role) };
  });

  app.patch('/api/contacts/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return;
    }
    const body = z.object({
      display_name: z.string().optional(),
      tags: z.array(z.string()).optional(),
      external_lead_id: z.string().optional(),
      external_app_id: z.string().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v);
      sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    return { contact: redactPhones(rows[0], req.user!.role) };
  });

  app.post('/api/contacts/:id/read', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return;
    }
    await query(`UPDATE contacts SET unread_count = 0 WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Manual re-pull of customer details from the configured external app.
  app.post('/api/contacts/:id/enrich', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return;
    }
    const c = await query<{ phone_e164: string }>(`SELECT phone_e164 FROM contacts WHERE id = $1`, [id]);
    if (!c.rows[0]) { reply.code(404).send({ error: 'not_found' }); return; }
    await enrichContact(id, c.rows[0].phone_e164);
    const fresh = await query(`SELECT * FROM contacts WHERE id = $1`, [id]);
    return { contact: redactPhones(fresh.rows[0], req.user!.role) };
  });

  // ===========================================================================
  // PUSH from external apps: upsert a contact + merge customer details.
  // Auth via X-Api-Key (scope contacts:write). Matches/creates by phone.
  // Your apps call this whenever a customer's info changes so the CRM stays
  // in sync in realtime.
  // ===========================================================================
  app.post('/api/contacts/upsert', { preHandler: requireApiKey('contacts:write') }, async (req, reply) => {
    const body = z.object({
      phone: z.string().min(8),
      display_name: z.string().optional(),
      tags: z.array(z.string()).optional(),
      external_app_id: z.string().optional(),
      external_lead_id: z.string().optional(),
      // Arbitrary customer details merged into contacts.enrichment.
      enrichment: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const phoneE164 = normalisePhone(body.phone);
    const waId = phoneE164.replace(/^\+/, '');

    const ins = await query<{ id: string; is_new: boolean }>(
      `INSERT INTO contacts (wa_id, phone_e164, display_name, external_app_id, external_lead_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wa_id) DO UPDATE SET
         display_name    = COALESCE(EXCLUDED.display_name, contacts.display_name),
         external_app_id = COALESCE(EXCLUDED.external_app_id, contacts.external_app_id),
         external_lead_id= COALESCE(EXCLUDED.external_lead_id, contacts.external_lead_id)
       RETURNING id, (xmax = 0) AS is_new`,
      [waId, phoneE164, body.display_name ?? null, body.external_app_id ?? null, body.external_lead_id ?? null]
    );
    const contactId = ins.rows[0].id;

    if (body.tags) {
      await query(`UPDATE contacts SET tags = $1 WHERE id = $2`, [body.tags, contactId]);
    }
    if (body.enrichment) {
      await query(
        `UPDATE contacts SET enrichment = enrichment || $1::jsonb, enriched_at = NOW() WHERE id = $2`,
        [JSON.stringify(body.enrichment), contactId]
      );
    }

    emit(ins.rows[0].is_new ? 'contact.created' : 'contact.updated', {
      contact_id: contactId, phone_e164: phoneE164, source: 'push',
    });
    if (body.enrichment) emit('contact.enriched', { contact_id: contactId, source: 'push' });

    reply.code(200).send({ contact_id: contactId, created: ins.rows[0].is_new });
    return reply;
  });
}
