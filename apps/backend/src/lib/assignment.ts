// Assignment strategy resolver.
// Sources are configured per-source; assignLead picks the right strategy
// and returns the agent user id (or null if manual / no agents available).

import { query, withTx } from '../db/client.js';

export type AssignmentReason = 'auto_round_robin' | 'manual' | 'reassigned';

export interface AssignmentResult {
  assigned_to: string | null;
  reason: AssignmentReason | null;
}

/**
 * Choose an agent for a new lead based on the lead source's strategy.
 * Returns null if strategy is 'manual' (admin will assign) or no agents exist.
 */
export async function resolveAutoAssignee(sourceId: string | null): Promise<AssignmentResult> {
  if (!sourceId) return { assigned_to: null, reason: null };

  const { rows: sources } = await query<{ assignment_strategy: string }>(
    `SELECT assignment_strategy FROM lead_sources WHERE id = $1`,
    [sourceId]
  );
  const source = sources[0];
  if (!source || source.assignment_strategy === 'manual') {
    return { assigned_to: null, reason: null };
  }

  if (source.assignment_strategy === 'round_robin') {
    // Round-robin: pick the active agent with the fewest currently-assigned active leads.
    // Tiebreaker: oldest last assignment.
    const { rows } = await query<{ id: string }>(
      `SELECT u.id
         FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
                     AND l.status NOT IN ('approved','rejected','dropped')
        WHERE u.role = 'agent' AND u.active = TRUE
     GROUP BY u.id
     ORDER BY COUNT(l.id) ASC, MAX(l.assigned_at) NULLS FIRST
        LIMIT 1`
    );
    if (!rows[0]) return { assigned_to: null, reason: null };
    return { assigned_to: rows[0].id, reason: 'auto_round_robin' };
  }

  return { assigned_to: null, reason: null };
}

/**
 * Apply an assignment within a transaction: updates leads + writes an assignments row.
 */
export async function applyAssignment(opts: {
  leadId: string;
  userId: string;
  assignedBy: string | null;
  reason: AssignmentReason;
}) {
  await withTx(async (client) => {
    await client.query(
      `UPDATE assignments SET unassigned_at = NOW()
        WHERE lead_id = $1 AND unassigned_at IS NULL`,
      [opts.leadId]
    );
    await client.query(
      `INSERT INTO assignments (lead_id, user_id, assigned_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [opts.leadId, opts.userId, opts.assignedBy, opts.reason]
    );
    await client.query(
      `UPDATE leads SET assigned_to = $1, assigned_at = NOW() WHERE id = $2`,
      [opts.userId, opts.leadId]
    );
  });
}
