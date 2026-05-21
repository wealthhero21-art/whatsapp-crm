import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Verify Meta's X-Hub-Signature-256.
 *
 * @param rawBody          the exact bytes the request body had on the wire
 * @param signatureHeader  the value of X-Hub-Signature-256 from the request
 * @param appSecret        the brand's app secret; falls back to env META_APP_SECRET
 *                         if not provided; returns true with no secret at all
 *                         (dev-only escape hatch)
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret?: string | null
): boolean {
  const secret = appSecret ?? config.META_APP_SECRET;
  if (!secret) {
    // No secret anywhere — dev fallback. Production always sets one.
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = signatureHeader.slice('sha256='.length);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
