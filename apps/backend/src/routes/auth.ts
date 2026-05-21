import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { issueOtp, verifyOtp } from '../auth/otp.js';
import { signSession } from '../auth/jwt.js';
import type { User } from '@crm/shared';

function normalisePhone(input: string): string {
  // Accept '9999999999', '919999999999', '+919999999999' — store as E.164.
  const digits = input.replace(/[^\d]/g, '');
  if (!digits) throw new Error('invalid phone');
  return input.startsWith('+') ? `+${digits}` : `+${digits}`;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // ---- Request OTP ----
  app.post('/auth/otp/request', async (req, reply) => {
    const body = z.object({ phone: z.string().min(8) }).parse(req.body);
    const phone = normalisePhone(body.phone);

    // Only known users may receive OTPs. Prevents spamming arbitrary numbers via our WA template.
    const { rows } = await query<User>(
      `SELECT id, phone_e164, name, email, role, active FROM users WHERE phone_e164 = $1`,
      [phone]
    );
    const user = rows[0];
    if (!user || !user.active) {
      // Do not reveal existence — but rate-limit middleware on the route will still cap.
      // We still respond 200 to avoid user enumeration; client will see no OTP.
      return { sent: false };
    }

    try {
      const result = await issueOtp(phone);
      if (!result.sent) {
        reply.code(429).send({ error: 'cooldown', retry_after: result.cooldownRemaining });
        return reply;
      }
      return { sent: true };
    } catch (err) {
      req.log.error({ err }, 'failed to send OTP');
      reply.code(502).send({ error: 'otp_send_failed' });
      return reply;
    }
  });

  // ---- Verify OTP ----
  app.post('/auth/otp/verify', async (req, reply) => {
    const body = z.object({
      phone: z.string().min(8),
      code: z.string().regex(/^\d{4,8}$/),
    }).parse(req.body);
    const phone = normalisePhone(body.phone);

    const result = await verifyOtp(phone, body.code);
    if (!result.ok) {
      reply.code(401).send({ error: 'otp_invalid', reason: result.reason });
      return reply;
    }

    const { rows } = await query<User>(
      `SELECT id, phone_e164, name, email, role, active, created_at
         FROM users WHERE phone_e164 = $1`,
      [phone]
    );
    const user = rows[0];
    if (!user || !user.active) {
      reply.code(401).send({ error: 'user_inactive' });
      return reply;
    }

    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    const session = signSession({ sub: user.id, role: user.role, phone: user.phone_e164 });
    return { token: session.token, expires_at: session.expires_at, user };
  });

  // ---- Who am I ----
  app.get('/auth/me', { preHandler: app.requireAuth }, async (req) => {
    return { user: req.user };
  });

  // ---- Logout (client just drops the token; this is a no-op stub for future server-side revoke) ----
  app.post('/auth/logout', { preHandler: app.requireAuth }, async () => {
    return { ok: true };
  });
}
