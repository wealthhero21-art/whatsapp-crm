// Thin wrapper around the Meta Graph API for WhatsApp Cloud.
//
// Multi-brand support: every send takes an optional `WaContext` describing
// which phone_number_id + access_token to use. If omitted, we fall back to
// the env-based defaults. This lets the rest of the app simply pass
// `getNumberContext(whatsappNumberId)` to route a message via the correct
// brand.

import { fetch, FormData } from 'undici';
// Blob comes from Node's WHATWG globals (Node 18+); undici's FormData accepts it.
import { config, graphBase } from '../config.js';
import { query } from '../db/client.js';

export interface WaContext {
  phoneNumberId: string;
  token: string;
}

const envContext: WaContext = {
  phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  token: config.WHATSAPP_TOKEN,
};

const ctxCache = new Map<string, WaContext>();

/**
 * Resolve a WaContext for a given whatsapp_numbers.id. Memoised in-process
 * to avoid hitting the DB on every send. Returns null if the id doesn't
 * exist or the row is inactive.
 */
export async function getNumberContext(numberId: string | null | undefined): Promise<WaContext | null> {
  if (!numberId) return null;
  const cached = ctxCache.get(numberId);
  if (cached) return cached;
  const { rows } = await query<{ phone_number_id: string; access_token: string; active: boolean }>(
    `SELECT phone_number_id, access_token, active FROM whatsapp_numbers WHERE id = $1`,
    [numberId]
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  const ctx = { phoneNumberId: row.phone_number_id, token: row.access_token };
  ctxCache.set(numberId, ctx);
  return ctx;
}

/** Drop the cache (call after admin updates a number row). */
export function invalidateNumberContext(numberId?: string) {
  if (numberId) ctxCache.delete(numberId);
  else ctxCache.clear();
}

interface SendResponse {
  messaging_product: 'whatsapp';
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

async function postMessages(payload: Record<string, unknown>, ctx?: WaContext | null): Promise<SendResponse> {
  const c = ctx ?? envContext;
  const url = `${graphBase}/${c.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const body = (await res.json()) as SendResponse & { error?: unknown };
  if (!res.ok) {
    throw Object.assign(new Error('WhatsApp send failed'), { status: res.status, body });
  }
  return body;
}

export function sendText(
  to: string,
  body: string,
  opts: { previewUrl?: boolean; ctx?: WaContext | null } = {}
) {
  return postMessages(
    {
      to,
      type: 'text',
      text: { body, preview_url: opts.previewUrl ?? false },
    },
    opts.ctx
  );
}

export function sendTemplate(
  to: string,
  name: string,
  language: string,
  bodyParameters: string[] = [],
  opts: { ctx?: WaContext | null } = {}
) {
  const components =
    bodyParameters.length > 0
      ? [
          {
            type: 'body',
            parameters: bodyParameters.map((text) => ({ type: 'text', text })),
          },
        ]
      : [];
  return postMessages(
    {
      to,
      type: 'template',
      template: { name, language: { code: language }, components },
    },
    opts.ctx
  );
}

// Authentication-category templates with a "Copy code" button need the code
// in the URL button component (#132000 if omitted). The body may have one or
// more variables; for our `otp_template` it's [code, purpose]. Pass the full
// body params array plus the button (copy-code) param explicitly.
export function sendAuthTemplate(
  to: string,
  name: string,
  language: string,
  opts: { bodyParams: string[]; buttonParam: string; ctx?: WaContext | null }
) {
  return postMessages(
    {
      to,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: [
          { type: 'body', parameters: opts.bodyParams.map((text) => ({ type: 'text', text })) },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: opts.buttonParam }],
          },
        ],
      },
    },
    opts.ctx
  );
}

// Upload bytes to Meta's media endpoint and return the media_id.
// Required as the first step before sending audio/image/video/document by id.
export async function uploadMedia(
  bytes: Buffer,
  mimeType: string,
  filename: string,
  ctx?: WaContext | null
): Promise<{ id: string }> {
  const c = ctx ?? envContext;
  const url = `${graphBase}/${c.phoneNumberId}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}` },
    body: form,
  });
  const body = (await res.json()) as { id?: string; error?: unknown };
  if (!res.ok || !body.id) {
    throw Object.assign(new Error('Meta media upload failed'), { status: res.status, body });
  }
  return { id: body.id };
}

/**
 * Send a previously-uploaded media item as an audio/document/image/video message.
 */
export function sendMediaById(
  to: string,
  mediaId: string,
  type: 'audio' | 'document' | 'image' | 'video',
  opts: { caption?: string; filename?: string; ctx?: WaContext | null } = {}
) {
  const payload: Record<string, unknown> = { id: mediaId };
  if (opts.caption && (type === 'image' || type === 'video' || type === 'document')) {
    payload.caption = opts.caption;
  }
  if (opts.filename && type === 'document') payload.filename = opts.filename;
  return postMessages({ to, type, [type]: payload }, opts.ctx);
}

export function markAsRead(waMessageId: string, ctx?: WaContext | null) {
  return postMessages({ status: 'read', message_id: waMessageId }, ctx);
}

// --- Media ---
interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256?: string;
  file_size: number;
  id: string;
  messaging_product: 'whatsapp';
}

export async function getMediaUrl(mediaId: string, ctx?: WaContext | null): Promise<MediaUrlResponse> {
  const token = (ctx ?? envContext).token;
  const res = await fetch(`${graphBase}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`getMediaUrl failed: ${res.status}`);
  return (await res.json()) as MediaUrlResponse;
}

export async function downloadMedia(mediaUrl: string, ctx?: WaContext | null): Promise<Buffer> {
  const token = (ctx ?? envContext).token;
  const res = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`downloadMedia failed: ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

// --- Templates sync ---
interface TemplateListResponse {
  data: Array<{
    name: string;
    language: string;
    status: string;
    category: string;
    components: unknown[];
  }>;
  paging?: { next?: string };
}

export async function listTemplates(): Promise<TemplateListResponse['data']> {
  const all: TemplateListResponse['data'] = [];
  let url: string | undefined =
    `${graphBase}/${config.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?limit=200`;
  const headers = { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` };
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`listTemplates failed: ${res.status}`);
    const body = (await res.json()) as TemplateListResponse;
    all.push(...body.data);
    url = body.paging?.next;
  }
  return all;
}
