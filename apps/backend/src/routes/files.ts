import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import mime from 'mime-types';
import { query } from '../db/client.js';
import { storage } from '../storage/index.js';

const DOC_CATEGORIES = [
  'pan',
  'aadhaar',
  'salary_slip',
  'bank_stmt',
  'itr',
  'cheque',
  'photo',
  'other',
  'unknown',
] as const;

import { canAccessContact, canAccessFile } from '../lib/scope.js';

export async function registerFileRoutes(app: FastifyInstance) {
  // All files for a contact (used by the right-hand panel)
  app.get('/api/contacts/:id/files', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, id))) { reply.code(403).send({ error: 'forbidden' }); return; }
    const q = req.query as Record<string, string>;
    const args: unknown[] = [id];
    let categoryFilter = '';
    if (q.category) {
      args.push(q.category);
      categoryFilter = `AND doc_category = $${args.length}`;
    }
    const { rows } = await query(
      `SELECT id, mime_type, filename, size_bytes, doc_category,
              classifier_confidence, download_status, created_at, metadata
         FROM files
        WHERE contact_id = $1
        ${categoryFilter}
        ORDER BY created_at DESC`,
      args
    );
    return { files: rows };
  });

  // Download a file (streams from disk/S3)
  app.get('/api/files/:id/download', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessFile(req.user!, id))) { reply.code(403).send({ error: 'forbidden' }); return; }
    const { rows } = await query(
      `SELECT mime_type, filename, storage_key, download_status FROM files WHERE id = $1`,
      [id]
    );
    const f = rows[0];
    if (!f) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    if (f.download_status !== 'downloaded') {
      reply.code(409).send({ error: 'not_ready', status: f.download_status });
      return;
    }
    const stream = await storage.stream(f.storage_key);
    reply
      .header('Content-Type', f.mime_type)
      .header('Content-Disposition', `inline; filename="${f.filename ?? id}"`)
      .send(stream);
  });

  // Manually re-classify (until Phase 3 ML lands, operators set the category)
  app.patch('/api/files/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessFile(req.user!, id))) { reply.code(403).send({ error: 'forbidden' }); return; }
    const body = z
      .object({
        doc_category: z.enum(DOC_CATEGORIES).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);

    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.doc_category) {
      args.push(body.doc_category);
      sets.push(`doc_category = $${args.length}`);
      sets.push('classified_at = NOW()');
      sets.push('classifier_confidence = 1.000'); // human verdict
    }
    if (body.metadata) {
      args.push(body.metadata);
      sets.push(`metadata = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE files SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    return { file: rows[0] };
  });

  // Direct upload from agent (multipart). Stores file under the given contact.
  app.post('/api/contacts/:id/files/upload', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id: contactId } = req.params as { id: string };
    if (!(await canAccessContact(req.user!, contactId))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    const data = await (req as unknown as { file: () => Promise<{
      filename: string;
      mimetype: string;
      toBuffer: () => Promise<Buffer>;
    } | undefined> }).file();
    if (!data) { reply.code(400).send({ error: 'no_file' }); return reply; }

    const buffer = await data.toBuffer();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = mime.extension(data.mimetype) || 'bin';

    const inserted = await query<{ id: string }>(
      `INSERT INTO files
         (contact_id, mime_type, filename, size_bytes, storage_key,
          sha256, download_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'downloaded')
       RETURNING id`,
      [contactId, data.mimetype, data.filename, buffer.length,
       `pending`, sha256]
    );
    const fileId = inserted.rows[0].id;
    const key = `media/${contactId}/${fileId}.${ext}`;
    await storage.put(key, buffer, data.mimetype);
    await query(`UPDATE files SET storage_key = $1 WHERE id = $2`, [key, fileId]);

    const { rows } = await query(`SELECT * FROM files WHERE id = $1`, [fileId]);
    reply.code(201).send({ file: rows[0] });
    return reply;
  });
}
