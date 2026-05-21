import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';
import { listTemplates } from '../whatsapp/api.js';

interface MetaComponent {
  type: string;
  text?: string;
  parameters?: unknown[];
}

function countVariables(components: MetaComponent[]): number {
  const body = components.find((c) => c.type === 'BODY');
  if (!body?.text) return 0;
  const matches = body.text.match(/\{\{\d+\}\}/g);
  return matches ? new Set(matches).size : 0;
}

export async function registerTemplateRoutes(app: FastifyInstance) {
  // List cached templates (drives the composer dropdown)
  app.get('/api/templates', { preHandler: app.requireAuth }, async (req) => {
    const q = req.query as Record<string, string>;
    const onlyApproved = q.only_approved !== 'false';
    const where = onlyApproved ? `WHERE status = 'APPROVED'` : '';
    const { rows } = await query(
      `SELECT id, name, language, category, status, components, variable_count
         FROM templates
        ${where}
        ORDER BY name, language`
    );
    return { templates: rows };
  });

  // Manually pull latest templates from Meta and cache
  app.post('/api/templates/sync', { preHandler: [app.requireAuth, app.requireRole('admin')] }, async () => {
    const list = await listTemplates();
    let upserted = 0;
    for (const t of list) {
      const components = (t.components as MetaComponent[]) ?? [];
      const varCount = countVariables(components);
      await query(
        `INSERT INTO templates (name, language, category, status, components, variable_count, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (name, language) DO UPDATE
           SET category = EXCLUDED.category,
               status = EXCLUDED.status,
               components = EXCLUDED.components,
               variable_count = EXCLUDED.variable_count,
               synced_at = NOW()`,
        [t.name, t.language, t.category, t.status, JSON.stringify(components), varCount]
      );
      upserted++;
    }
    return { synced: upserted };
  });
}
