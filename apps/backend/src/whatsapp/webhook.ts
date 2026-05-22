// GET /webhook/whatsapp  → Meta verification handshake
// POST /webhook/whatsapp → inbound events (messages, statuses)
//
// Strategy:
//   1. Validate signature
//   2. Persist raw event to webhook_events (so nothing is ever lost)
//   3. Acknowledge 200 to Meta immediately (must respond <20s)
//   4. Process asynchronously: upsert contact, insert message, queue media download
//
// Meta will retry for several hours on non-2xx, so once we have the raw row
// persisted we are safe.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { query } from '../db/client.js';
import { verifySignature } from './signature.js';
import { mediaQueue } from '../lib/queue.js';
import { sseBroadcast } from '../lib/sse.js';
import { emit } from '../events/bus.js';
import { enrichContact } from '../lib/enrichment.js';

interface WaWebhookEntry {
  changes: Array<{
    field: string;
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
      messages?: Array<WaInboundMessage>;
      statuses?: Array<WaStatus>;
    };
  }>;
}

interface WaInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type:
    | 'text'
    | 'image'
    | 'document'
    | 'audio'
    | 'video'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'reaction'
    | 'interactive'
    | 'button';
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256?: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; sha256?: string; caption?: string };
  audio?: { id: string; mime_type: string; voice?: boolean };
  video?: { id: string; mime_type: string; caption?: string };
  sticker?: { id: string; mime_type: string };
}

interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

export async function registerWebhook(app: FastifyInstance) {
  // ---- GET: Meta verify handshake ----
  // Meta sends the verify token from whichever app's webhook page is being
  // saved. We accept the env-default OR any active whatsapp_numbers row's
  // verify token so that adding a brand later doesn't need a redeploy.
  app.get('/webhook/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (mode !== 'subscribe' || !token) {
      reply.code(403).send({ error: 'bad request' });
      return;
    }
    if (token === config.WEBHOOK_VERIFY_TOKEN) {
      reply.code(200).type('text/plain').send(challenge);
      return;
    }
    const { rowCount } = await query(
      `SELECT 1 FROM whatsapp_numbers WHERE webhook_verify_token = $1 AND active = TRUE LIMIT 1`,
      [token]
    );
    if ((rowCount ?? 0) > 0) {
      reply.code(200).type('text/plain').send(challenge);
      return;
    }
    reply.code(403).send({ error: 'verify token mismatch' });
  });

  // ---- POST: inbound events ----
  // We need the raw body to verify signature. Replace Fastify's default JSON
  // parser with one that stashes the buffer on req.rawBody before parsing.
  app.removeContentTypeParser(['application/json']);
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      try {
        const parsed = body.length ? JSON.parse(body.toString('utf8')) : {};
        (req as any).rawBody = body;
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    }
  );

  app.post('/webhook/whatsapp', async (req, reply) => {
    const rawBody: Buffer = (req as any).rawBody ?? Buffer.alloc(0);
    const payload = req.body as { entry?: WaWebhookEntry[] };

    // Pluck the phone_number_id out of the first change (Meta always sends
    // one entry per webhook delivery, but be defensive).
    const phoneNumberId =
      payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;

    // Find which brand row owns this phone_number_id so we can pick the
    // right app secret for signature verification + the right whatsapp_number_id
    // to stamp on the resulting messages.
    let brand: { id: string; app_secret: string | null } | null = null;
    if (phoneNumberId) {
      const { rows } = await query<{ id: string; app_secret: string | null }>(
        `SELECT id, app_secret FROM whatsapp_numbers
          WHERE phone_number_id = $1 AND active = TRUE`,
        [phoneNumberId]
      );
      brand = rows[0] ?? null;
    }

    const sigOk = verifySignature(
      rawBody,
      req.headers['x-hub-signature-256'] as string | undefined,
      brand?.app_secret ?? config.META_APP_SECRET ?? null
    );

    const eventRow = await query<{ id: number }>(
      `INSERT INTO webhook_events (signature_valid, payload) VALUES ($1, $2) RETURNING id`,
      [sigOk, payload]
    );

    if (!sigOk) {
      req.log.warn({ eventId: eventRow.rows[0].id, phoneNumberId }, 'webhook signature mismatch');
      reply.code(401).send({ error: 'bad signature' });
      return;
    }

    // Acknowledge immediately — Meta requires <20s, we want to ack in <100ms.
    reply.code(200).send({ ok: true });

    setImmediate(() => {
      processWebhook(payload, eventRow.rows[0].id, brand?.id ?? null).catch((err) => {
        req.log.error({ err, eventId: eventRow.rows[0].id }, 'webhook processing failed');
      });
    });
  });
}

async function processWebhook(
  payload: { entry?: WaWebhookEntry[] },
  eventId: number,
  brandWaNumberId: string | null
) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;

      const profileByWaId = new Map<string, string | undefined>();
      for (const c of value.contacts ?? []) profileByWaId.set(c.wa_id, c.profile?.name);

      for (const msg of value.messages ?? []) {
        await handleInboundMessage(msg, profileByWaId.get(msg.from), brandWaNumberId);
      }

      for (const st of value.statuses ?? []) {
        await handleStatus(st);
      }
    }
  }

  await query(`UPDATE webhook_events SET processed = TRUE WHERE id = $1`, [eventId]);
}

async function upsertContact(waId: string, profileName?: string) {
  const phoneE164 = waId.startsWith('+') ? waId : `+${waId}`;
  // xmax = '0' on a fresh INSERT; non-zero when the ON CONFLICT update path ran.
  const res = await query<{ id: string; is_new: boolean }>(
    `INSERT INTO contacts (wa_id, phone_e164, profile_name, last_inbound_at, unread_count)
     VALUES ($1, $2, $3, NOW(), 1)
     ON CONFLICT (wa_id) DO UPDATE
       SET profile_name = COALESCE(EXCLUDED.profile_name, contacts.profile_name),
           last_inbound_at = NOW(),
           unread_count = contacts.unread_count + 1
     RETURNING id, (xmax = 0) AS is_new`,
    [waId, phoneE164, profileName ?? null]
  );
  const { id, is_new } = res.rows[0];
  if (is_new) {
    // New customer — notify downstream apps and trigger realtime enrichment.
    emit('contact.created', { contact_id: id, phone_e164: phoneE164, profile_name: profileName ?? null });
    void enrichContact(id, phoneE164);
  }
  return id;
}

async function handleInboundMessage(
  msg: WaInboundMessage,
  profileName: string | undefined,
  brandWaNumberId: string | null
) {
  const contactId = await upsertContact(msg.from, profileName);

  // Upsert a (contact, brand) conversation so per-brand inbox stays distinct.
  if (brandWaNumberId) {
    await query(
      `INSERT INTO conversations (contact_id, whatsapp_number_id, last_inbound_at, unread_count)
       VALUES ($1, $2, NOW(), 1)
       ON CONFLICT (contact_id, whatsapp_number_id) DO UPDATE
         SET last_inbound_at = NOW(),
             unread_count = conversations.unread_count + 1`,
      [contactId, brandWaNumberId]
    );
  }

  // Pull media info if applicable
  let fileId: string | null = null;
  let mediaId: string | undefined;
  let mimeType: string | undefined;
  let filename: string | undefined;
  let caption: string | undefined;

  switch (msg.type) {
    case 'image':
      mediaId = msg.image?.id;
      mimeType = msg.image?.mime_type;
      caption = msg.image?.caption;
      break;
    case 'document':
      mediaId = msg.document?.id;
      mimeType = msg.document?.mime_type;
      filename = msg.document?.filename;
      caption = msg.document?.caption;
      break;
    case 'audio':
      mediaId = msg.audio?.id;
      mimeType = msg.audio?.mime_type;
      break;
    case 'video':
      mediaId = msg.video?.id;
      mimeType = msg.video?.mime_type;
      caption = msg.video?.caption;
      break;
    case 'sticker':
      mediaId = msg.sticker?.id;
      mimeType = msg.sticker?.mime_type;
      break;
  }

  if (mediaId && mimeType) {
    const fileRow = await query<{ id: string }>(
      `INSERT INTO files (contact_id, wa_media_id, mime_type, filename, storage_key, download_status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [contactId, mediaId, mimeType, filename ?? null, `pending/${mediaId}`]
    );
    fileId = fileRow.rows[0].id;
    // Pass the brand so the worker uses that brand's token to fetch the media URL.
    await mediaQueue.add('download', { fileId, mediaId, contactId, brandWaNumberId });
  }

  const body = msg.text?.body ?? caption ?? null;

  const inserted = await query<{ id: string }>(
    `INSERT INTO messages
       (contact_id, wa_message_id, direction, msg_type, body, file_id,
        status, raw, whatsapp_number_id)
     VALUES ($1, $2, 'in', $3, $4, $5, 'received', $6, $7)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [contactId, msg.id, msg.type, body, fileId, msg, brandWaNumberId]
  );

  if (inserted.rows.length > 0) {
    // Notify connected UIs
    sseBroadcast({
      type: 'message.new',
      contactId,
      messageId: inserted.rows[0].id,
    });
  }
}

async function handleStatus(st: WaStatus) {
  await query(
    `UPDATE messages
       SET status = $1,
           error = $2
     WHERE wa_message_id = $3`,
    [st.status, st.errors ? JSON.stringify(st.errors) : null, st.id]
  );
  sseBroadcast({ type: 'message.status', waMessageId: st.id, status: st.status });
}
