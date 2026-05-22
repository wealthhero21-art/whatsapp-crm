import { randomInt, createHash } from 'node:crypto';
import { query } from '../db/client.js';
import { config } from '../config.js';
import { sendAuthTemplate } from '../whatsapp/api.js';

function hashCode(code: string): string {
  return createHash('sha256').update(code + config.JWT_SECRET).digest('hex');
}

function generateCode(): string {
  // 6-digit numeric. randomInt is cryptographically secure.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issue a fresh OTP for a phone, send it via WhatsApp template,
 * and persist the hash. Enforces a resend cooldown.
 */
export async function issueOtp(phoneE164: string): Promise<{ sent: boolean; cooldownRemaining?: number }> {
  // DEV bypass — accept any login, no Meta call. The verify step will let
  // through DEV_OTP_BYPASS_CODE, so we don't even need to persist a row.
  if (config.DEV_OTP_BYPASS_CODE) {
    return { sent: true };
  }

  // Cooldown: refuse if the previous unconsumed OTP for this phone is younger than the window.
  const recent = await query<{ created_at: Date }>(
    `SELECT created_at FROM otp_codes
      WHERE phone_e164 = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [phoneE164]
  );
  if (recent.rows[0]) {
    const ageSec = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
    if (ageSec < config.OTP_RESEND_COOLDOWN_SECONDS) {
      return { sent: false, cooldownRemaining: Math.ceil(config.OTP_RESEND_COOLDOWN_SECONDS - ageSec) };
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + config.OTP_TTL_SECONDS * 1000);

  await query(
    `INSERT INTO otp_codes (phone_e164, code_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [phoneE164, codeHash, expiresAt]
  );

  // Send via WhatsApp AUTHENTICATION template (body + copy-code button both
  // carry the code). Template name/lang from env (otp_template / en_US).
  const waId = phoneE164.replace(/^\+/, '');
  await sendAuthTemplate(waId, config.OTP_TEMPLATE_NAME, config.OTP_TEMPLATE_LANGUAGE, code);

  return { sent: true };
}

export interface OtpVerifyResult {
  ok: boolean;
  reason?: 'no_otp' | 'expired' | 'too_many_attempts' | 'bad_code';
}

export async function verifyOtp(phoneE164: string, code: string): Promise<OtpVerifyResult> {
  // DEV bypass — accept the configured code for any phone. The caller still
  // checks that the phone belongs to a registered+active user, so a random
  // phone can't log in even with the bypass.
  if (config.DEV_OTP_BYPASS_CODE && code === config.DEV_OTP_BYPASS_CODE) {
    return { ok: true };
  }

  const { rows } = await query<{
    id: string;
    code_hash: string;
    attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes
      WHERE phone_e164 = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [phoneE164]
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'no_otp' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= config.OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  if (hashCode(code) !== row.code_hash) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return { ok: false, reason: 'bad_code' };
  }

  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
  return { ok: true };
}
