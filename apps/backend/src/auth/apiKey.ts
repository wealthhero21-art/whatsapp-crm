import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/client.js';

export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  // "crm_" + 32 hex chars. The DB stores only the sha256.
  const raw = 'crm_' + randomBytes(24).toString('hex');
  return {
    plaintext: raw,
    prefix: raw.slice(0, 12),
    hash: createHash('sha256').update(raw).digest('hex'),
  };
}

export interface ApiKeyContext {
  apiKeyId: string;
  integrationId: string | null;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
  }
}

/**
 * preHandler that authenticates a request via X-Api-Key header.
 * Sets req.apiKey on success; replies 401 on failure.
 */
export function requireApiKey(scope: string) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers['x-api-key'];
    if (typeof header !== 'string' || !header) {
      reply.code(401).send({ error: 'missing_api_key' });
      return reply;
    }
    const hash = createHash('sha256').update(header).digest('hex');
    const { rows } = await query<{
      id: string;
      integration_id: string | null;
      scopes: string[];
      revoked_at: Date | null;
    }>(
      `SELECT id, integration_id, scopes, revoked_at
         FROM api_keys WHERE key_hash = $1`,
      [hash]
    );
    const row = rows[0];
    if (!row || row.revoked_at) {
      reply.code(401).send({ error: 'invalid_api_key' });
      return reply;
    }
    if (!row.scopes.includes(scope) && !row.scopes.includes('*')) {
      reply.code(403).send({ error: 'scope_denied', required: scope });
      return reply;
    }
    await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]);
    req.apiKey = {
      apiKeyId: row.id,
      integrationId: row.integration_id,
      scopes: row.scopes,
    };
  };
}
