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

  // JWT
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_TTL_SECONDS: z.coerce.number().default(60 * 60 * 12),

  // Outbound webhook dispatch
  WEBHOOK_DELIVERY_RETRIES: z.coerce.number().default(5),

  STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
  DISK_STORAGE_PATH: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_KMS_KEY_ID: z.string().optional(),       // SSE-KMS key id/arn — required when STORAGE_DRIVER=s3
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const config = schema.parse(process.env);

export const graphBase = `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;
