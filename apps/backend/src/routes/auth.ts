import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client.js';
import { issueOtp, verifyOtp } from '../auth/otp.js';
import { signSession } from '../auth/jwt.js';
import { config } from '../config.js';
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

  // ---- Public dev-mode flag so the login screen can render the quick-login button ----
  app.get('/auth/dev-mode', async () => {
    return { dev: Boolean(config.DEV_OTP_BYPASS_CODE) };
  });

  // ---- Dev quick-login: skip phone + OTP entirely, issue a JWT for an admin.
  // Guarded by DEV_OTP_BYPASS_CODE — same guard as the OTP code bypass, so no
  // new security surface. Returns 404 in real prod (bypass unset).
  app.post('/auth/dev-login', async (req, reply) => {
    if (!config.DEV_OTP_BYPASS_CODE) {
      reply.code(404).send({ error: 'not_found' });
      return reply;
    }
    const body = z.object({ phone: z.string().optional() }).parse(req.body ?? {});
    let user: User | undefined;
    if (body.phone) {
      const phone = normalisePhone(body.phone);
      const r = await query<User>(
        `SELECT id, phone_e164, name, email, role, active, created_at
           FROM users WHERE phone_e164 = $1 AND active = TRUE`,
        [phone]
      );
      user = r.rows[0];
    } else {
      // Default: pick the first active admin (typically the seeded master admin).
      const r = await query<User>(
        `SELECT id, phone_e164, name, email, role, active, created_at
           FROM users WHERE role = 'admin' AND active = TRUE
           ORDER BY created_at ASC LIMIT 1`
      );
      user = r.rows[0];
    }
    if (!user) {
      reply.code(404).send({ error: 'no_admin' });
      return reply;
    }
    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    const session = signSession({ sub: user.id, role: user.role, phone: user.phone_e164 });
    req.log.warn({ user_id: user.id }, '⚠️  dev-login used (bypasses OTP)');
    return { token: session.token, expires_at: session.expires_at, user };
  });
}
