// Quick-reply snippets — personal (user_id = me) and team-wide (user_id = NULL).
// Admins can manage both; agents can manage their own and see all team-wide.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';

export async function registerSnippetRoutes(app: FastifyInstance) {
  // List: returns team-wide + personal (collapsed)
  app.get('/api/snippets', { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await query(
      `SELECT id, user_id, slug, label, body, language, created_at
         FROM quick_replies
        WHERE user_id IS NULL OR user_id = $1
        ORDER BY user_id NULLS FIRST, slug`,
      [req.user!.id]
    );
    return { snippets: rows };
  });

  // Create — personal by default; admin may pass scope='team' to make it team-wide.
  app.post('/api/snippets', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = z.object({
      slug: z.string().regex(/^[a-z0-9_-]{1,32}$/),
      label: z.string().min(1).max(120),
      body: z.string().min(1).max(2000),
      language: z.string().default('en'),
      scope: z.enum(['personal', 'team']).default('personal'),
    }).parse(req.body);

    const ownerId =
      body.scope === 'team'
        ? (req.user!.role === 'admin' ? null : req.user!.id)
        : req.user!.id;

    try {
      const { rows } = await query(
        `INSERT INTO quick_replies (user_id, slug, label, body, language)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, slug, label, body, language, created_at`,
        [ownerId, body.slug, body.label, body.body, body.language]
      );
      reply.code(201).send({ snippet: rows[0] });
      return reply;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') { reply.code(409).send({ error: 'slug_taken' }); return reply; }
      throw err;
    }
  });

  app.patch('/api/snippets/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      label: z.string().min(1).max(120).optional(),
      body: z.string().min(1).max(2000).optional(),
      language: z.string().optional(),
    }).parse(req.body);

    // Ownership: agents can only edit their own; admins can edit anything.
    const owner = await query<{ user_id: string | null }>(
      `SELECT user_id FROM quick_replies WHERE id = $1`, [id]
    );
    if (!owner.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (req.user!.role !== 'admin' && owner.rows[0].user_id !== req.user!.id) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
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
      `UPDATE quick_replies SET ${sets.join(', ')} WHERE id = $${args.length}
       RETURNING id, user_id, slug, label, body, language, created_at`,
      args
    );
    return { snippet: rows[0] };
  });

  app.delete('/api/snippets/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const owner = await query<{ user_id: string | null }>(
      `SELECT user_id FROM quick_replies WHERE id = $1`, [id]
    );
    if (!owner.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (req.user!.role !== 'admin' && owner.rows[0].user_id !== req.user!.id) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    await query(`DELETE FROM quick_replies WHERE id = $1`, [id]);
    return { ok: true };
  });
}
