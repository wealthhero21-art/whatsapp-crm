import type { FastifyInstance } from 'fastify';
import { addClient, removeClient } from '../lib/sse.js';
import { verifySession } from '../auth/jwt.js';
import { query } from '../db/client.js';
import type { User } from '@crm/shared';

// EventSource can't set Authorization headers, so we accept ?token=... here.
export async function registerEventStream(app: FastifyInstance) {
  app.get('/api/events', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = q.token;
    if (!token) { reply.code(401).send({ error: 'unauthorized' }); return; }
    let claims;
    try { claims = verifySession(token); }
    catch { reply.code(401).send({ error: 'invalid_token' }); return; }

    const u = await query<User>(
      `SELECT id, role, active FROM users WHERE id = $1`,
      [claims.sub]
    );
    if (!u.rows[0] || !u.rows[0].active) {
      reply.code(401).send({ error: 'user_inactive' }); return;
    }

    reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('Connection', 'keep-alive')
      .header('X-Accel-Buffering', 'no');

    reply.raw.write('retry: 5000\n\n');
    const client = addClient(reply, u.rows[0].id, u.rows[0].role);

    const ping = setInterval(() => {
      try { reply.raw.write(`: ping ${Date.now()}\n\n`); }
      catch { clearInterval(ping); }
    }, 25_000);

    req.raw.on('close', () => {
      clearInterval(ping);
      removeClient(client);
    });
  });
}
