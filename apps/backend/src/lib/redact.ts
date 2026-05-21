// PII redaction for agent role.
//
// Agents must never see the customer's actual phone number. Admins always
// see real values. The redaction is applied in the response serialiser —
// the DB still stores the real numbers for sending and matching, and
// internal logic continues to key off contact_id (an opaque UUID).
//
// Format: keep "+" + country code (first 2-3 digits) and last 4, mask the
// middle. "+919716029574" → "+91 ✱✱✱✱✱ 9574".

import type { UserRole } from '@crm/shared';

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Strip non-digits, keep leading +
  const plus = phone.startsWith('+') ? '+' : '';
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 6) return plus + '✱'.repeat(digits.length);
  // Country code heuristic: assume 2-3 leading digits for visible prefix.
  // For Indian +91… that's "91"; for US +1 it's "1". Keep first 2.
  const head = digits.slice(0, 2);
  const tail = digits.slice(-4);
  const maskedLen = digits.length - head.length - tail.length;
  return `${plus}${head} ${'✱'.repeat(maskedLen)} ${tail}`;
}

/**
 * If the actor is an agent, mask any phone_e164-shaped fields in `row`.
 * Returns a NEW object (does not mutate). Pass an array of phone-shaped
 * field names; defaults match the common ones we serialize.
 */
export function redactPhones<T>(
  row: T | null | undefined,
  role: UserRole,
  fields: string[] = ['phone_e164', 'contact_phone', 'wa_id']
): T | null | undefined {
  if (!row) return row;
  if (role === 'admin') return row;
  const out = { ...(row as unknown as Record<string, unknown>) };
  for (const f of fields) {
    if (typeof out[f] === 'string') out[f] = maskPhone(out[f] as string);
  }
  return out as unknown as T;
}

export function redactPhonesAll<T>(
  rows: T[],
  role: UserRole,
  fields?: string[]
): T[] {
  if (role === 'admin') return rows;
  return rows.map((r) => redactPhones(r, role, fields) as T);
}
