import { query } from '../db/client.js';

export async function audit(opts: {
  actorUserId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}) {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.actorUserId,
      opts.action,
      opts.entityType ?? null,
      opts.entityId ?? null,
      opts.before ?? null,
      opts.after ?? null,
      opts.ip ?? null,
    ]
  );
}
