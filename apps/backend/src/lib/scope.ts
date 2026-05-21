// Centralised access scoping. The rules:
//
//   admin  → sees everything
//   agent  → sees a lead if (a) they're in source_agents for the lead's source,
//                          OR (b) the lead is directly assigned_to them
//          → sees a contact if at least one of its leads passes the lead rule
//          → sees a file if its contact passes the contact rule
//
// All scoping is implemented as SQL fragments returned by these helpers so we
// avoid the N+1 trap of doing per-row authorisation in JS.

import { query } from '../db/client.js';
import type { UserRole } from '@crm/shared';

/**
 * Returns a SQL fragment that, when used as a WHERE-clause condition on a
 * `leads` table aliased `l`, restricts to leads visible to the agent.
 * Appends parameters to `args`. For admins, returns `'TRUE'` and adds nothing.
 */
export function leadScopeSql(args: unknown[], user: { id: string; role: UserRole }, leadAlias = 'l'): string {
  if (user.role === 'admin') return 'TRUE';
  args.push(user.id);
  const userParam = `$${args.length}`;
  return `(${leadAlias}.assigned_to = ${userParam}
       OR ${leadAlias}.source_id IN (SELECT source_id FROM source_agents WHERE user_id = ${userParam}))`;
}

/**
 * Returns SQL that checks a contact is visible — i.e. has at least one
 * visible lead.
 */
export function contactScopeSql(args: unknown[], user: { id: string; role: UserRole }, contactAlias = 'contacts'): string {
  if (user.role === 'admin') return 'TRUE';
  args.push(user.id);
  const userParam = `$${args.length}`;
  return `EXISTS (
    SELECT 1 FROM leads l
     WHERE l.contact_id = ${contactAlias}.id
       AND (l.assigned_to = ${userParam}
            OR l.source_id IN (SELECT source_id FROM source_agents WHERE user_id = ${userParam}))
  )`;
}

/**
 * One-shot check used by route guards: can the current user access this contact?
 */
export async function canAccessContact(user: { id: string; role: UserRole }, contactId: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  const r = await query(
    `SELECT 1 FROM leads l
      WHERE l.contact_id = $1
        AND (l.assigned_to = $2
             OR l.source_id IN (SELECT source_id FROM source_agents WHERE user_id = $2))
      LIMIT 1`,
    [contactId, user.id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function canAccessLead(user: { id: string; role: UserRole }, leadId: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  const r = await query(
    `SELECT 1 FROM leads l
      WHERE l.id = $1
        AND (l.assigned_to = $2
             OR l.source_id IN (SELECT source_id FROM source_agents WHERE user_id = $2))
      LIMIT 1`,
    [leadId, user.id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function canAccessFile(user: { id: string; role: UserRole }, fileId: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  const r = await query<{ contact_id: string }>(
    `SELECT contact_id FROM files WHERE id = $1`,
    [fileId]
  );
  const contactId = r.rows[0]?.contact_id;
  if (!contactId) return false;
  return canAccessContact(user, contactId);
}
