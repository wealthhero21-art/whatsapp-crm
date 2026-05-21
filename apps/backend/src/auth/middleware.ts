import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySession, type JwtClaims } from './jwt.js';
import { query } from '../db/client.js';
import type { User, UserRole } from '@crm/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    claims?: JwtClaims;
  }
}

export function registerAuthDecorators(app: FastifyInstance) {
  // requireAuth: must be a signed-in CRM user
  app.decorate('requireAuth', async function (req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
    const token = header.slice('Bearer '.length).trim();
    let claims: JwtClaims;
    try {
      claims = verifySession(token);
    } catch {
      reply.code(401).send({ error: 'invalid_token' });
      return reply;
    }
    const { rows } = await query<User>(
      `SELECT id, phone_e164, name, email, role, active, created_at
         FROM users WHERE id = $1`,
      [claims.sub]
    );
    const user = rows[0];
    if (!user || !user.active) {
      reply.code(401).send({ error: 'user_inactive' });
      return reply;
    }
    req.user = user;
    req.claims = claims;
  });

  // requireRole(...roles): must be one of the listed roles
  app.decorate('requireRole', function (...roles: UserRole[]) {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) {
        reply.code(401).send({ error: 'unauthorized' });
        return reply;
      }
      if (!roles.includes(req.user.role)) {
        reply.code(403).send({ error: 'forbidden' });
        return reply;
      }
    };
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireRole: (...roles: UserRole[]) =>
      (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
