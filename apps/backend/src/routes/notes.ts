// Internal notes pinned to a contact. Agent-only context; never sent to the
// customer. Scoped by the same contact access rules as the chat itself.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { canAccessContact } from '../lib/scope.js';

export async function registerNoteRoutes(app: FastifyInstance) {
  app.get('/api/contacts/:id/notes', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    const { rows } = await query(
      `SELECT n.id, n.contact_id, n.author_user_id, n.body, n.pinned,
              n.created_at, n.updated_at,
              u.name AS author_name
         FROM conversation_notes n
    LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.contact_id = $1
        ORDER BY n.pinned DESC, n.created_at DESC`,
      [id]
    );
    return { notes: rows };
  });

  app.post('/api/contacts/:id/notes', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    const body = z.object({
      body: z.string().min(1).max(4000),
      pinned: z.boolean().default(false),
    }).parse(req.body);

    const { rows } = await query(
      `INSERT INTO conversation_notes (contact_id, author_user_id, body, pinned)
       VALUES ($1, $2, $3, $4)
       RETURNING id, contact_id, author_user_id, body, pinned, created_at, updated_at`,
      [id, req.user!.id, body.body, body.pinned]
    );
    reply.code(201).send({ note: rows[0] });
    return reply;
  });

  app.patch('/api/notes/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      body: z.string().min(1).max(4000).optional(),
      pinned: z.boolean().optional(),
    }).parse(req.body);

    const owner = await query<{ contact_id: string; author_user_id: string | null }>(
      `SELECT contact_id, author_user_id FROM conversation_notes WHERE id = $1`,
      [id]
    );
    if (!owner.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    // Allow author or admin to edit. Other agents in the same scope can only read.
    if (req.user!.role !== 'admin' && owner.rows[0].author_user_id !== req.user!.id) {
      reply.code(403).send({ error: 'forbidden_not_author' }); return reply;
    }
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE conversation_notes SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    return { note: rows[0] };
  });

  app.delete('/api/notes/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const owner = await query<{ author_user_id: string | null }>(
      `SELECT author_user_id FROM conversation_notes WHERE id = $1`, [id]
    );
    if (!owner.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (req.user!.role !== 'admin' && owner.rows[0].author_user_id !== req.user!.id) {
      reply.code(403).send({ error: 'forbidden_not_author' }); return reply;
    }
    await query(`DELETE FROM conversation_notes WHERE id = $1`, [id]);
    return { ok: true };
  });
}
