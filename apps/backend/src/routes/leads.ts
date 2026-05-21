import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTx } from '../db/client.js';
import { requireApiKey } from '../auth/apiKey.js';
import { applyAssignment, resolveAutoAssignee } from '../lib/assignment.js';
import { audit } from '../lib/audit.js';
import { emit } from '../events/bus.js';
import { getAdapter } from '../integrations/registry.js';
import { leadScopeSql, canAccessLead } from '../lib/scope.js';
import { instantiateLeadSlots } from '../lib/docs.js';
import type { Lead, LeadStatus } from '@crm/shared';

const STATUS_VALUES: LeadStatus[] = [
  'new', 'contacted', 'qualified', 'docs_pending', 'docs_received',
  'submitted', 'approved', 'rejected', 'dropped',
];

function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  if (!digits) throw new Error('invalid phone');
  return input.startsWith('+') ? `+${digits}` : `+${digits}`;
}

const ingestSchema = z.object({
  // Either give us a known source slug, or a source_id (UUID).
  source_slug: z.string().optional(),
  source_id: z.string().uuid().optional(),
  source_ref: z.string().optional(),
  // Raw payload from external system. If integration has an adapter, we run
  // it through parseInboundLead; otherwise we expect normalised fields below.
  raw: z.record(z.unknown()).optional(),
  phone: z.string().min(8).optional(),
  contact_name: z.string().optional(),
  product: z.string().optional(),
  amount: z.number().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function registerLeadRoutes(app: FastifyInstance) {
  // ===========================================================================
  // INGEST — external systems POST here with an API key.
  // ===========================================================================
  app.post(
    '/api/leads/ingest',
    { preHandler: requireApiKey('leads:write') },
    async (req, reply) => {
      const body = ingestSchema.parse(req.body);
      const idemKey = (req.headers['idempotency-key'] as string | undefined)?.trim();

      // Idempotency: replay the cached response for repeats.
      if (idemKey) {
        const cached = await query<{ response_status: number; response_body: unknown }>(
          `SELECT response_status, response_body FROM idempotency_keys WHERE key = $1`,
          [idemKey]
        );
        if (cached.rows[0]) {
          reply.code(cached.rows[0].response_status).send(cached.rows[0].response_body);
          return reply;
        }
      }

      // Resolve source
      let sourceId: string | null = null;
      if (body.source_id) sourceId = body.source_id;
      else if (body.source_slug) {
        const r = await query<{ id: string }>(
          `SELECT id FROM lead_sources WHERE slug = $1`,
          [body.source_slug]
        );
        sourceId = r.rows[0]?.id ?? null;
      }

      // If integration's API key has a linked integration with an adapter,
      // give the adapter a chance to translate `raw` into a normalised payload.
      let phone = body.phone;
      let contactName = body.contact_name;
      let product = body.product;
      let amount = body.amount ?? null;
      let sourceRef = body.source_ref ?? null;
      let metadata: Record<string, unknown> = body.metadata ?? {};

      if (body.raw && req.apiKey?.integrationId) {
        const { rows } = await query<{ slug: string; config: Record<string, unknown>; base_url: string | null }>(
          `SELECT slug, config, base_url FROM integrations WHERE id = $1`,
          [req.apiKey.integrationId]
        );
        const intg = rows[0];
        const adapter = intg ? getAdapter(intg.slug) : undefined;
        if (adapter?.parseInboundLead) {
          const translated = await adapter.parseInboundLead(body.raw, {
            integrationId: req.apiKey.integrationId,
            config: intg!.config,
            baseUrl: intg!.base_url,
          });
          phone ??= translated.phone_e164;
          contactName ??= translated.contact_name;
          product ??= translated.product;
          amount ??= translated.amount ?? null;
          sourceRef ??= translated.source_ref ?? null;
          metadata = { ...translated.metadata, ...metadata };
        }
      }

      if (!phone) {
        reply.code(400).send({ error: 'phone_required' });
        return reply;
      }
      const phoneE164 = normalisePhone(phone);
      const waId = phoneE164.replace(/^\+/, '');

      // Resolve source's WA number + default product, so the lead carries the brand
      let sourceWaNumberId: string | null = null;
      let sourceDefaultProduct: string | null = null;
      if (sourceId) {
        const r = await query<{ whatsapp_number_id: string | null; product: string | null }>(
          `SELECT whatsapp_number_id, product FROM lead_sources WHERE id = $1`,
          [sourceId]
        );
        sourceWaNumberId = r.rows[0]?.whatsapp_number_id ?? null;
        sourceDefaultProduct = r.rows[0]?.product ?? null;
      }
      const effectiveProduct = product ?? sourceDefaultProduct;

      const { leadId, wasNew } = await withTx(async (client) => {
        // Upsert contact
        const c = await client.query<{ id: string }>(
          `INSERT INTO contacts (wa_id, phone_e164, profile_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (wa_id) DO UPDATE
             SET profile_name = COALESCE(EXCLUDED.profile_name, contacts.profile_name)
           RETURNING id`,
          [waId, phoneE164, contactName ?? null]
        );
        const contactId = c.rows[0].id;

        // Insert lead — dedupe on (source_id, source_ref) via partial unique idx
        const l = await client.query<{ id: string; xmax: string }>(
          `INSERT INTO leads (contact_id, source_id, source_ref, product, amount, metadata, whatsapp_number_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source_id, source_ref) WHERE source_ref IS NOT NULL
           DO UPDATE SET metadata = leads.metadata || EXCLUDED.metadata
           RETURNING id, xmax::text`,
          [contactId, sourceId, sourceRef, effectiveProduct, amount, metadata, sourceWaNumberId]
        );
        // xmax = '0' on a fresh insert; non-zero on UPDATE conflict path.
        return { leadId: l.rows[0].id, wasNew: l.rows[0].xmax === '0' };
      });

      // First time we've seen this lead — instantiate the doc checklist
      if (wasNew && sourceId) {
        await instantiateLeadSlots(leadId, sourceId, effectiveProduct);
      }

      // Auto-assign per source strategy
      const assign = await resolveAutoAssignee(sourceId);
      if (assign.assigned_to && assign.reason) {
        await applyAssignment({
          leadId,
          userId: assign.assigned_to,
          assignedBy: null,
          reason: assign.reason,
        });
        emit('lead.assigned', { lead_id: leadId, assigned_to: assign.assigned_to, reason: assign.reason });
      }

      emit('lead.created', { lead_id: leadId, source_id: sourceId, source_ref: sourceRef });

      const responseBody = { lead_id: leadId, assigned_to: assign.assigned_to };
      if (idemKey) {
        await query(
          `INSERT INTO idempotency_keys (key, api_key_id, response_status, response_body)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO NOTHING`,
          [idemKey, req.apiKey?.apiKeyId ?? null, 201, responseBody]
        );
      }
      reply.code(201).send(responseBody);
      return reply;
    }
  );

  // ===========================================================================
  // LIST / GET / UPDATE / ASSIGN — used by both admin and agent UIs
  // ===========================================================================
  app.get('/api/leads', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const status = q.status;
    const sourceId = q.source_id;
    const assignedTo = q.assigned_to;          // 'me' | userId | 'unassigned' | undefined
    const search = (q.search ?? '').trim();

    const args: unknown[] = [];
    const conds: string[] = [];

    // Source-based scoping: agents see leads from their sources + leads assigned to them.
    const scope = leadScopeSql(args, req.user!, 'l');
    if (scope !== 'TRUE') conds.push(scope);

    if (assignedTo === 'me') {
      args.push(req.user!.id);
      conds.push(`l.assigned_to = $${args.length}`);
    } else if (assignedTo === 'unassigned') {
      conds.push(`l.assigned_to IS NULL`);
    } else if (assignedTo && req.user!.role === 'admin') {
      args.push(assignedTo);
      conds.push(`l.assigned_to = $${args.length}`);
    }

    if (status) {
      args.push(status);
      conds.push(`l.status = $${args.length}`);
    }
    if (sourceId) {
      args.push(sourceId);
      conds.push(`l.source_id = $${args.length}`);
    }
    if (search) {
      args.push(`%${search}%`);
      conds.push(`(c.phone_e164 ILIKE $${args.length}
                OR c.profile_name ILIKE $${args.length}
                OR c.display_name ILIKE $${args.length}
                OR l.source_ref ILIKE $${args.length})`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    args.push(limit);

    const { rows } = await query<Lead>(
      `SELECT l.id, l.contact_id, l.source_id, l.source_ref, l.status, l.product,
              l.amount, l.assigned_to, l.assigned_at, l.metadata,
              l.created_at, l.updated_at,
              c.phone_e164 AS contact_phone,
              COALESCE(c.display_name, c.profile_name) AS contact_name,
              u.name AS assignee_name,
              s.name AS source_name
         FROM leads l
         JOIN contacts c ON c.id = l.contact_id
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN lead_sources s ON s.id = l.source_id
        ${where}
        ORDER BY l.updated_at DESC
        LIMIT $${args.length}`,
      args
    );
    return { leads: rows };
  });

  app.get('/api/leads/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await query<Lead>(
      `SELECT l.*, c.phone_e164 AS contact_phone,
              COALESCE(c.display_name, c.profile_name) AS contact_name,
              u.name AS assignee_name, s.name AS source_name
         FROM leads l
         JOIN contacts c ON c.id = l.contact_id
    LEFT JOIN users u ON u.id = l.assigned_to
    LEFT JOIN lead_sources s ON s.id = l.source_id
        WHERE l.id = $1`,
      [id]
    );
    const lead = rows[0];
    if (!lead) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (!(await canAccessLead(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }
    return { lead };
  });

  // Update status / metadata / product
  app.patch('/api/leads/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      status: z.enum(STATUS_VALUES as [LeadStatus, ...LeadStatus[]]).optional(),
      product: z.string().nullable().optional(),
      amount: z.number().nullable().optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const owner = await query<{ status: LeadStatus }>(
      `SELECT status FROM leads WHERE id = $1`, [id]);
    if (!owner.rows[0]) { reply.code(404).send({ error: 'not_found' }); return reply; }
    if (!(await canAccessLead(req.user!, id))) {
      reply.code(403).send({ error: 'forbidden' }); return reply;
    }

    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      args.push(v);
      sets.push(`${k} = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true };
    args.push(id);
    const { rows } = await query<Lead>(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
      args
    );

    await audit({
      actorUserId: req.user!.id,
      action: 'lead.update',
      entityType: 'lead',
      entityId: id,
      before: owner.rows[0],
      after: body,
    });

    if (body.status && body.status !== owner.rows[0].status) {
      emit('lead.status_changed', { lead_id: id, from: owner.rows[0].status, to: body.status });
    }
    emit('lead.updated', { lead_id: id, changes: body });
    return { lead: rows[0] };
  });

  // Manual assignment (admin only). Agents may "claim" via separate endpoint later.
  app.post('/api/leads/:id/assign',
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ user_id: z.string().uuid() }).parse(req.body);

      const u = await query<{ id: string; role: string; active: boolean }>(
        `SELECT id, role, active FROM users WHERE id = $1`,
        [body.user_id]
      );
      if (!u.rows[0] || !u.rows[0].active) {
        reply.code(400).send({ error: 'invalid_user' }); return reply;
      }

      await applyAssignment({
        leadId: id,
        userId: body.user_id,
        assignedBy: req.user!.id,
        reason: 'manual',
      });
      await audit({
        actorUserId: req.user!.id,
        action: 'lead.assign',
        entityType: 'lead',
        entityId: id,
        after: { assigned_to: body.user_id },
      });
      emit('lead.assigned', { lead_id: id, assigned_to: body.user_id, reason: 'manual' });
      return { ok: true };
    }
  );
}
