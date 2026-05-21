import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { UserRole } from '@crm/shared';

export interface JwtClaims {
  sub: string;        // user id
  role: UserRole;
  phone: string;
}

export function signSession(claims: JwtClaims): { token: string; expires_at: string } {
  const token = jwt.sign(claims, config.JWT_SECRET, {
    expiresIn: config.JWT_TTL_SECONDS,
  });
  const expires_at = new Date(Date.now() + config.JWT_TTL_SECONDS * 1000).toISOString();
  return { token, expires_at };
}

export function verifySession(token: string): JwtClaims {
  return jwt.verify(token, config.JWT_SECRET) as JwtClaims;
}
