import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Meta signs every POST with X-Hub-Signature-256.
 * Returns true if the signature matches (or if no secret is configured — dev mode).
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!config.META_APP_SECRET) {
    // Dev fallback — log so it's obvious in prod.
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', config.META_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  const got = signatureHeader.slice('sha256='.length);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
