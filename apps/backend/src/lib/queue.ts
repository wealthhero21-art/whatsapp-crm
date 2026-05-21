import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createHash, createHmac } from 'node:crypto';
import { fetch } from 'undici';
import mime from 'mime-types';
import { config } from '../config.js';
import { downloadMedia, getMediaUrl, getNumberContext } from '../whatsapp/api.js';
import { storage } from '../storage/index.js';
import { query } from '../db/client.js';
import { sseBroadcast } from './sse.js';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const mediaQueue = new Queue('media', { connection });
export const webhookQueue = new Queue('webhook', { connection });

interface MediaJob {
  fileId: string;
  mediaId: string;
  contactId: string;
  brandWaNumberId?: string | null;
}

interface WebhookJob {
  deliveryId: string;
}

export function startWorkers() {
  new Worker<MediaJob>(
    'media',
    async (job) => {
      const { fileId, mediaId, contactId, brandWaNumberId } = job.data;
      try {
        const ctx = await getNumberContext(brandWaNumberId ?? null);
        const meta = await getMediaUrl(mediaId, ctx);
        const bytes = await downloadMedia(meta.url, ctx);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const ext = mime.extension(meta.mime_type) || 'bin';
        const key = `media/${contactId}/${fileId}.${ext}`;
        await storage.put(key, bytes, meta.mime_type);
        await query(
          `UPDATE files
             SET storage_key = $1,
                 size_bytes = $2,
                 sha256 = $3,
                 download_status = 'downloaded'
           WHERE id = $4`,
          [key, bytes.length, sha256, fileId]
        );
        sseBroadcast({ type: 'file.downloaded', fileId, contactId });
      } catch (err) {
        await query(
          `UPDATE files SET download_status = 'failed' WHERE id = $1`,
          [fileId]
        );
        throw err;
      }
    },
    { connection, concurrency: 5 }
  );

  // Outbound webhook dispatcher: each event we want to deliver becomes
  // a row in outbound_webhook_deliveries plus a job here. BullMQ handles
  // retries with exponential backoff; we cap attempts at config.WEBHOOK_DELIVERY_RETRIES.
  new Worker<WebhookJob>(
    'webhook',
    async (job) => {
      const { deliveryId } = job.data;
      const { rows } = await query<{
        id: string;
        webhook_id: string;
        event_type: string;
        payload: unknown;
        attempts: number;
        url: string;
        secret: string | null;
        active: boolean;
      }>(
        `SELECT d.id, d.webhook_id, d.event_type, d.payload, d.attempts,
                w.url, w.secret, w.active
           FROM outbound_webhook_deliveries d
           JOIN outbound_webhooks w ON w.id = d.webhook_id
          WHERE d.id = $1`,
        [deliveryId]
      );
      const row = rows[0];
      if (!row || !row.active) return;

      const body = JSON.stringify({
        type: row.event_type,
        delivery_id: row.id,
        payload: row.payload,
        occurred_at: new Date().toISOString(),
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-CRM-Event': row.event_type,
        'X-CRM-Delivery': row.id,
      };
      if (row.secret) {
        headers['X-CRM-Signature'] =
          'sha256=' + createHmac('sha256', row.secret).update(body).digest('hex');
      }

      const res = await fetch(row.url, { method: 'POST', headers, body });
      const text = await res.text().catch(() => '');
      await query(
        `UPDATE outbound_webhook_deliveries
           SET attempts = attempts + 1,
               response_status = $1,
               response_body = $2,
               delivered_at = CASE WHEN $1 BETWEEN 200 AND 299 THEN NOW() ELSE delivered_at END
         WHERE id = $3`,
        [res.status, text.slice(0, 2000), row.id]
      );
      if (!res.ok) throw new Error(`webhook ${row.url} returned ${res.status}`);
    },
    {
      connection,
      concurrency: 10,
    }
  );

  console.log('✓ media + webhook workers started');
}
