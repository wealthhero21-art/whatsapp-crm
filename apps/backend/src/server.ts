import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerWebhook } from './whatsapp/webhook.js';
import { registerAuthDecorators } from './auth/middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerFileRoutes } from './routes/files.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerEventStream } from './routes/events.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerDocRoutes } from './routes/docs.js';
import { registerSnippetRoutes } from './routes/snippets.js';
import { registerNoteRoutes } from './routes/notes.js';
import { startWorkers } from './lib/queue.js';
import { startEventDispatch } from './events/dispatch.js';
import { loadAdapters } from './integrations/index.js';

const app = Fastify({
  logger: { level: config.LOG_LEVEL },
});

await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
await app.register(sensible);
await app.register(rateLimit, {
  global: false,
  max: 5,
  timeWindow: '1 minute',
});
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

registerAuthDecorators(app);

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

// Webhook: registers its own raw-body parser; must be FIRST.
await registerWebhook(app);

// Auth (login is rate-limited inside the route file).
await registerAuthRoutes(app);

// App routes
await registerEventStream(app);
await registerContactRoutes(app);
await registerMessageRoutes(app);
await registerFileRoutes(app);
await registerTemplateRoutes(app);
await registerLeadRoutes(app);
await registerAdminRoutes(app);
await registerDocRoutes(app);
await registerSnippetRoutes(app);
await registerNoteRoutes(app);

// Wire the internal event bus to outbound webhooks + adapters
startEventDispatch();
loadAdapters();

// Start in-process workers for dev. In prod, run `npm run worker` in its own process.
startWorkers();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`🚀 WhatsApp CRM backend on http://${config.HOST}:${config.PORT}`);
  if (config.DEV_OTP_BYPASS_CODE) {
    app.log.warn(
      '⚠️  DEV_OTP_BYPASS_CODE is set — login is INSECURE. ' +
      'Anyone with a registered phone can log in using the bypass code. ' +
      'Unset this env var the moment Meta credentials are wired in.'
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
