// Thin wrapper around the Meta Graph API for WhatsApp Cloud.
// All calls use undici fetch; no SDK dependency.
import { fetch } from 'undici';
import { config, graphBase } from '../config.js';

const authHeaders = () => ({
  Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

interface SendResponse {
  messaging_product: 'whatsapp';
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

async function postMessages(payload: Record<string, unknown>): Promise<SendResponse> {
  const url = `${graphBase}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const body = (await res.json()) as SendResponse & { error?: unknown };
  if (!res.ok) {
    throw Object.assign(new Error('WhatsApp send failed'), { status: res.status, body });
  }
  return body;
}

export function sendText(to: string, body: string, previewUrl = false) {
  return postMessages({
    to,
    type: 'text',
    text: { body, preview_url: previewUrl },
  });
}

export function sendTemplate(
  to: string,
  name: string,
  language: string,
  bodyParameters: string[] = []
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
  return postMessages({
    to,
    type: 'template',
    template: { name, language: { code: language }, components },
  });
}

export function markAsRead(waMessageId: string) {
  return postMessages({
    status: 'read',
    message_id: waMessageId,
  });
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

export async function getMediaUrl(mediaId: string): Promise<MediaUrlResponse> {
  const res = await fetch(`${graphBase}/${mediaId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`getMediaUrl failed: ${res.status}`);
  return (await res.json()) as MediaUrlResponse;
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  // The URL Meta returns requires the same bearer token.
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
  });
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
  while (url) {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`listTemplates failed: ${res.status}`);
    const body = (await res.json()) as TemplateListResponse;
    all.push(...body.data);
    url = body.paging?.next;
  }
  return all;
}
