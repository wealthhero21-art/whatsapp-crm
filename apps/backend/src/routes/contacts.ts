import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { canAccessContact, contactScopeSql } from '../lib/scope.js';
import { redactPhones, redactPhonesAll } from '../lib/redact.js';

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
}
