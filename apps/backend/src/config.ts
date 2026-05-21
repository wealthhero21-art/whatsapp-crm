import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  WHATSAPP_TOKEN: z.string().min(1, 'WHATSAPP_TOKEN is required'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v21.0'),

  // Default template names — sources may override these via lead_sources.welcome_template etc.
  DOC_REREQUEST_TEMPLATE: z.string().default('doc_rerequest'),
  DOC_REREQUEST_LANGUAGE: z.string().default('en'),

  // OTP login over WhatsApp
  OTP_TEMPLATE_NAME: z.string().default('login_otp'),
  OTP_TEMPLATE_LANGUAGE: z.string().default('en'),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),

  // DEV-ONLY escape hatch: if set, this code logs in any registered + active
  // user without going through Meta. Used during initial setup before the
  // login_otp template is approved. ALWAYS unset in real production.
  DEV_OTP_BYPASS_CODE: z.string().optional(),

  // JWT
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_TTL_SECONDS: z.coerce.number().default(60 * 60 * 12),

  // Outbound webhook dispatch
  WEBHOOK_DELIVERY_RETRIES: z.coerce.number().default(5),

  DISK_STORAGE_PATH: z.string().default('./storage'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const config = schema.parse(process.env);

export const graphBase = `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;
