import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { generateApiKey } from '../auth/apiKey.js';
import { invalidateNumberContext } from '../whatsapp/api.js';
import type { Integration, LeadSource, User } from '@crm/shared';

function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return input.startsWith('+') ? `+${digits}` : `+${digits}`;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.requireAuth, app.requireRole('admin')] };

  // ----------------------------- USERS -----------------------------
  app.get('/api/admin/users', adminGuard, async () => {
    const { rows } = await query<User>(
      `SELECT id, phone_e164, name, email, role, active, created_at, last_login_at
         FROM users ORDER BY created_at DESC`
    );
    return { users: rows };
  });

  app.post('/api/admin/users', adminGuard, async (req, reply) => {
    const body = z.object({
      phone: z.string().min(8),
      name: z.string().min(1),
      email: z.string().email().optional(),
      role: z.enum(['admin', 'agent']),
    }).parse(req.body);
    const phone = normalisePhone(body.phone);
    try {
      const { rows } = await query<User>(
        `INSERT INTO users (phone_e164, name, email, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, phone_e164, name, email, role, active, created_at`,
        [phone, body.name, body.email ?? null, body.role]
      );
      await audit({
        actorUserId: req.user!.id,
        action: 'user.create',
        entityType: 'user',
        entityId: rows[0].id,
        after: rows[0],
      });
      reply.code(201).send({ user: rows[0] });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') {
        reply.code(409).send({ error: 'phone_or_email_taken' });
        return;
      }
      throw err;
    }
  });

  app.patch('/api/admin/users/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      email: z.string().email().nullable().optional(),
      role: z.enum(['admin', 'agent']).optional(),
      active: z.boolean().optional(),
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
    const { rows } = await query<User>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length}
       RETURNING id, phone_e164, name, email, role, active, created_at`,
      args
    );
    await audit({ actorUserId: req.user!.id, action: 'user.update', entityType: 'user', entityId: id, after: body });
    return { user: rows[0] };
  });

  // ----------------------------- LEAD SOURCES -----------------------------
  app.get('/api/admin/sources', adminGuard, async () => {
    const { rows } = await query<LeadSource>(
      `SELECT * FROM lead_sources ORDER BY created_at DESC`
    );
    return { sources: rows };
  });

  app.post('/api/admin/sources', adminGuard, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9_-]+$/),
      assignment_strategy: z.enum(['manual', 'round_robin']).default('manual'),
      whatsapp_number_id: z.string().uuid().nullable().optional(),
      product: z.string().nullable().optional(),
      welcome_template: z.string().nullable().optional(),
    }).parse(req.body);
    try {
      const { rows } = await query<LeadSource>(
        `INSERT INTO lead_sources (name, slug, assignment_strategy, whatsapp_number_id, product, welcome_template)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [body.name, body.slug, body.assignment_strategy,
         body.whatsapp_number_id ?? null, body.product ?? null, body.welcome_template ?? null]
      );
      await audit({ actorUserId: req.user!.id, action: 'source.create', entityType: 'lead_source', entityId: rows[0].id, after: rows[0] });
      reply.code(201).send({ source: rows[0] });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') { reply.code(409).send({ error: 'slug_taken' }); return; }
      throw err;
    }
  });

  app.patch('/api/admin/sources/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      assignment_strategy: z.enum(['manual', 'round_robin']).optional(),
      whatsapp_number_id: z.string().uuid().nullable().optional(),
      product: z.string().nullable().optional(),
      welcome_template: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query<LeadSource>(
      `UPDATE lead_sources SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    await audit({ actorUserId: req.user!.id, action: 'source.update', entityType: 'lead_source', entityId: id, after: body });
    return { source: rows[0] };
  });

  // ----------------------------- INTEGRATIONS -----------------------------
  app.get('/api/admin/integrations', adminGuard, async () => {
    const { rows } = await query<Integration>(
      `SELECT * FROM integrations ORDER BY created_at DESC`
    );
    return { integrations: rows };
  });

  app.post('/api/admin/integrations', adminGuard, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9_-]+$/),
      kind: z.enum(['leads_inbound', 'loan_app', 'document_store', 'crm', 'analytics', 'custom']),
      base_url: z.string().url().nullable().optional(),
      config: z.record(z.unknown()).default({}),
    }).parse(req.body);
    try {
      const { rows } = await query<Integration>(
        `INSERT INTO integrations (name, slug, kind, base_url, config)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.name, body.slug, body.kind, body.base_url ?? null, body.config]
      );
      await audit({ actorUserId: req.user!.id, action: 'integration.create', entityType: 'integration', entityId: rows[0].id, after: rows[0] });
      reply.code(201).send({ integration: rows[0] });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') { reply.code(409).send({ error: 'slug_taken' }); return; }
      throw err;
    }
  });

  app.patch('/api/admin/integrations/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      base_url: z.string().url().nullable().optional(),
      config: z.record(z.unknown()).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query<Integration>(
      `UPDATE integrations SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    await audit({ actorUserId: req.user!.id, action: 'integration.update', entityType: 'integration', entityId: id, after: body });
    return { integration: rows[0] };
  });

  // ----------------------------- API KEYS (per integration) -----------------------------
  app.get('/api/admin/integrations/:id/keys', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query(
      `SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_at
         FROM api_keys WHERE integration_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    return { keys: rows };
  });

  app.post('/api/admin/integrations/:id/keys', adminGuard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(1),
      scopes: z.array(z.string()).default(['leads:write']),
    }).parse(req.body);
    const { plaintext, prefix, hash } = generateApiKey();
    const { rows } = await query(
      `INSERT INTO api_keys (integration_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, key_prefix, scopes, created_at`,
      [id, body.name, prefix, hash, body.scopes]
    );
    await audit({ actorUserId: req.user!.id, action: 'api_key.create', entityType: 'integration', entityId: id, after: { key_id: rows[0].id } });
    // plaintext is only ever returned at creation time.
    reply.code(201).send({ key: { ...rows[0], plaintext } });
  });

  app.delete('/api/admin/api-keys/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    await query(`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, [id]);
    await audit({ actorUserId: req.user!.id, action: 'api_key.revoke', entityType: 'api_key', entityId: id });
    return { ok: true };
  });

  // ----------------------------- OUTBOUND WEBHOOKS -----------------------------
  app.get('/api/admin/webhooks', adminGuard, async () => {
    const { rows } = await query(
      `SELECT * FROM outbound_webhooks ORDER BY created_at DESC`
    );
    return { webhooks: rows };
  });

  app.post('/api/admin/webhooks', adminGuard, async (req, reply) => {
    const body = z.object({
      integration_id: z.string().uuid().nullable().optional(),
      url: z.string().url(),
      events: z.array(z.string()).min(1),
      secret: z.string().min(16).nullable().optional(),
    }).parse(req.body);
    const { rows } = await query(
      `INSERT INTO outbound_webhooks (integration_id, url, events, secret)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.integration_id ?? null, body.url, body.events, body.secret ?? null]
    );
    await audit({ actorUserId: req.user!.id, action: 'webhook.create', entityType: 'outbound_webhook', entityId: rows[0].id, after: rows[0] });
    reply.code(201).send({ webhook: rows[0] });
  });

  app.patch('/api/admin/webhooks/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      active: z.boolean().optional(),
      secret: z.string().min(16).nullable().optional(),
    }).parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE outbound_webhooks SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    await audit({ actorUserId: req.user!.id, action: 'webhook.update', entityType: 'outbound_webhook', entityId: id, after: body });
    return { webhook: rows[0] };
  });

  // ----------------------------- STATS -----------------------------
  app.get('/api/admin/stats', adminGuard, async () => {
    const [byStatus, bySource, byAgent, unread] = await Promise.all([
      query(`SELECT status, COUNT(*)::int AS count FROM leads GROUP BY status`),
      query(`SELECT s.name AS source, COUNT(l.*)::int AS count
               FROM lead_sources s LEFT JOIN leads l ON l.source_id = s.id
              GROUP BY s.id, s.name ORDER BY count DESC`),
      query(`SELECT u.id, u.name, COUNT(l.*)::int AS open_leads
               FROM users u LEFT JOIN leads l
                 ON l.assigned_to = u.id
                AND l.status NOT IN ('approved','rejected','dropped')
              WHERE u.role = 'agent' AND u.active = TRUE
              GROUP BY u.id, u.name ORDER BY open_leads DESC`),
      query<{ unassigned: number }>(`SELECT COUNT(*)::int AS unassigned FROM leads WHERE assigned_to IS NULL AND status NOT IN ('approved','rejected','dropped')`),
    ]);
    return {
      by_status: byStatus.rows,
      by_source: bySource.rows,
      by_agent: byAgent.rows,
      unassigned: unread.rows[0]?.unassigned ?? 0,
    };
  });

  // ----------------------------- AUDIT LOG -----------------------------
  app.get('/api/admin/audit', adminGuard, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const { rows } = await query(
      `SELECT a.*, u.name AS actor_name
         FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    return { audit: rows };
  });

  // ----------------------------- WHATSAPP NUMBERS -----------------------------
  app.get('/api/admin/whatsapp-numbers', adminGuard, async () => {
    const { rows } = await query(
      `SELECT id, brand_label, display_phone, phone_number_id, waba_id,
              active, created_at
         FROM whatsapp_numbers ORDER BY created_at DESC`
    );
    return { numbers: rows };
  });

  app.post('/api/admin/whatsapp-numbers', adminGuard, async (req, reply) => {
    const body = z.object({
      brand_label: z.string().min(1),
      display_phone: z.string().min(4),
      phone_number_id: z.string().min(1),
      waba_id: z.string().min(1),
      access_token: z.string().min(20),
      app_secret: z.string().optional(),
      webhook_verify_token: z.string().min(8),
    }).parse(req.body);
    try {
      const { rows } = await query(
        `INSERT INTO whatsapp_numbers
           (brand_label, display_phone, phone_number_id, waba_id,
            access_token, app_secret, webhook_verify_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, brand_label, display_phone, phone_number_id, waba_id, active, created_at`,
        [body.brand_label, body.display_phone, body.phone_number_id, body.waba_id,
         body.access_token, body.app_secret ?? null, body.webhook_verify_token]
      );
      await audit({ actorUserId: req.user!.id, action: 'whatsapp_number.create', entityType: 'whatsapp_number', entityId: rows[0].id });
      reply.code(201).send({ number: rows[0] });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') { reply.code(409).send({ error: 'phone_number_id_taken' }); return; }
      throw err;
    }
  });

  app.patch('/api/admin/whatsapp-numbers/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      brand_label: z.string().optional(),
      display_phone: z.string().optional(),
      access_token: z.string().min(20).optional(),
      app_secret: z.string().nullable().optional(),
      webhook_verify_token: z.string().min(8).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE whatsapp_numbers SET ${sets.join(', ')} WHERE id = $${args.length}
       RETURNING id, brand_label, display_phone, phone_number_id, waba_id, active, created_at`,
      args
    );
    invalidateNumberContext(id);
    await audit({ actorUserId: req.user!.id, action: 'whatsapp_number.update', entityType: 'whatsapp_number', entityId: id });
    return { number: rows[0] };
  });

  // ----------------------------- SOURCE AGENTS -----------------------------
  app.get('/api/admin/sources/:id/agents', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query(
      `SELECT u.id, u.name, u.phone_e164, u.role
         FROM source_agents sa
         JOIN users u ON u.id = sa.user_id
        WHERE sa.source_id = $1
        ORDER BY u.name`,
      [id]
    );
    return { agents: rows };
  });

  app.put('/api/admin/sources/:id/agents', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ user_ids: z.array(z.string().uuid()) }).parse(req.body);
    // Replace the full membership set in one transaction.
    await query(`DELETE FROM source_agents WHERE source_id = $1`, [id]);
    for (const uid of body.user_ids) {
      await query(
        `INSERT INTO source_agents (source_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, uid]
      );
    }
    await audit({
      actorUserId: req.user!.id,
      action: 'source_agents.set',
      entityType: 'lead_source',
      entityId: id,
      after: { user_ids: body.user_ids },
    });
    return { ok: true };
  });

  // ----------------------------- DOC REQUIREMENTS (per source) ---------------
  app.get('/api/admin/sources/:id/doc-requirements', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query(
      `SELECT * FROM doc_requirements WHERE source_id = $1
        ORDER BY display_order, doc_category`,
      [id]
    );
    return { requirements: rows };
  });

  app.post('/api/admin/sources/:id/doc-requirements', adminGuard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      doc_category: z.string().min(1),
      required_count: z.number().int().positive().default(1),
      product: z.string().nullable().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      optional: z.boolean().default(false),
      display_order: z.number().int().default(0),
    }).parse(req.body);
    const { rows } = await query(
      `INSERT INTO doc_requirements
         (source_id, product, doc_category, required_count, label,
          description, optional, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, body.product ?? null, body.doc_category, body.required_count,
       body.label ?? null, body.description ?? null, body.optional, body.display_order]
    );
    await audit({ actorUserId: req.user!.id, action: 'doc_requirement.create', entityType: 'doc_requirement', entityId: rows[0].id });
    reply.code(201).send({ requirement: rows[0] });
    return reply;
  });

  app.patch('/api/admin/doc-requirements/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      doc_category: z.string().optional(),
      required_count: z.number().int().positive().optional(),
      product: z.string().nullable().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      optional: z.boolean().optional(),
      display_order: z.number().int().optional(),
    }).parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v); sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query(
      `UPDATE doc_requirements SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );
    await audit({ actorUserId: req.user!.id, action: 'doc_requirement.update', entityType: 'doc_requirement', entityId: id });
    return { requirement: rows[0] };
  });

  app.delete('/api/admin/doc-requirements/:id', adminGuard, async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM doc_requirements WHERE id = $1`, [id]);
    await audit({ actorUserId: req.user!.id, action: 'doc_requirement.delete', entityType: 'doc_requirement', entityId: id });
    return { ok: true };
  });
}
