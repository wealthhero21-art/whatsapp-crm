// Per-user SSE broadcast. Each connected client is tagged with a userId + role;
// events optionally carry a contactId, in which case only admins and the
// assigned agent see them.
//
// For multi-instance deployments swap the in-memory map for Redis pub/sub.

import type { FastifyReply } from 'fastify';
import { query } from '../db/client.js';
import type { UserRole } from '@crm/shared';

interface Client {
  id: number;
  userId: string;
  role: UserRole;
  reply: FastifyReply;
}

const clients = new Set<Client>();
let nextId = 1;

export function addClient(reply: FastifyReply, userId: string, role: UserRole): Client {
  const c: Client = { id: nextId++, userId, role, reply };
  clients.add(c);
  return c;
}

export function removeClient(c: Client) {
  clients.delete(c);
}

export interface BroadcastEvent {
  type: string;
  contactId?: string;
  [key: string]: unknown;
}

/**
 * Push an event to all clients allowed to see it.
 * Filtering rule:
 *   - admins always receive everything
 *   - agents receive an event only if contactId is unassigned-aware:
 *       * no contactId  → drop for agents (it's system-level)
 *       * contactId set → agent receives if any of their leads point at that contact
 */
export async function sseBroadcast(event: BroadcastEvent) {
  if (clients.size === 0) return;

  const line = `data: ${JSON.stringify(event)}\n\n`;
  const admins: Client[] = [];
  const agents: Client[] = [];
  for (const c of clients) (c.role === 'admin' ? admins : agents).push(c);

  for (const c of admins) {
    try { c.reply.raw.write(line); } catch { clients.delete(c); }
  }

  if (agents.length === 0) return;
  if (!event.contactId) return;

  // Which agents can see this contact? Two paths:
  //   1. Lead is directly assigned to them
  //   2. They're a member of source_agents for the lead's source
  const { rows } = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
        SELECT assigned_to AS user_id FROM leads
         WHERE contact_id = $1 AND assigned_to IS NOT NULL
        UNION
        SELECT sa.user_id FROM leads l
          JOIN source_agents sa ON sa.source_id = l.source_id
         WHERE l.contact_id = $1
     ) t`,
    [event.contactId]
  );
  const allowed = new Set(rows.map((r) => r.user_id));
  for (const c of agents) {
    if (!allowed.has(c.userId)) continue;
    try { c.reply.raw.write(line); } catch { clients.delete(c); }
  }
}
