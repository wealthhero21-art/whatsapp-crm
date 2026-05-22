import type {
  User, Lead, LeadDocSlot, QuickReply, ConversationNote,
} from '@crm/shared';
import { API_BASE_URL } from './config';
import { getToken, clearToken } from './auth-store';

export interface Contact {
  id: string;
  wa_id: string;
  phone_e164: string;     // already masked by the backend for agents
  profile_name: string | null;
  display_name: string | null;
  unread_count: number;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
}

export interface Message {
  id: string;
  direction: 'in' | 'out';
  msg_type: string;
  body: string | null;
  template_name: string | null;
  file_id: string | null;
  status: string;
  created_at: string;
  file_mime?: string | null;
  file_name?: string | null;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    await clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  requestOtp: (phone: string) =>
    http<{ sent: boolean }>(`/auth/otp/request`, {
      method: 'POST', body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string) =>
    http<{ token: string; expires_at: string; user: User }>(`/auth/otp/verify`, {
      method: 'POST', body: JSON.stringify({ phone, code }),
    }),
  me: () => http<{ user: User }>(`/auth/me`).then((r) => r.user),

  listContacts: (search?: string) =>
    http<{ contacts: Contact[] }>(
      `/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`
    ).then((r) => r.contacts),

  listMessages: (contactId: string) =>
    http<{ messages: Message[] }>(`/api/contacts/${contactId}/messages`).then((r) => r.messages),

  sendText: (contactId: string, text: string) =>
    http<{ message: Message }>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, type: 'text', text }),
    }).then((r) => r.message),

  sendTemplate: (contactId: string, name: string, language: string, body_params: string[]) =>
    http<{ message: Message }>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, type: 'template', template: { name, language, body_params } }),
    }).then((r) => r.message),

  listLeads: (params: { assigned_to?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return http<{ leads: Lead[] }>(`/api/leads${qs ? `?${qs}` : ''}`).then((r) => r.leads);
  },
  getLead: (id: string) => http<{ lead: Lead }>(`/api/leads/${id}`).then((r) => r.lead),
  listLeadDocs: (leadId: string) =>
    http<{ slots: LeadDocSlot[] }>(`/api/leads/${leadId}/docs`).then((r) => r.slots),

  listSnippets: () => http<{ snippets: QuickReply[] }>(`/api/snippets`).then((r) => r.snippets),

  listNotes: (contactId: string) =>
    http<{ notes: ConversationNote[] }>(`/api/contacts/${contactId}/notes`).then((r) => r.notes),
  addNote: (contactId: string, body: string) =>
    http<{ note: ConversationNote }>(`/api/contacts/${contactId}/notes`, {
      method: 'POST', body: JSON.stringify({ body }),
    }).then((r) => r.note),

  // Voice note — multipart upload of a recorded audio file.
  sendVoice: async (contactId: string, fileUri: string) => {
    const token = await getToken();
    const form = new FormData();
    // React Native FormData file shape
    form.append('file', {
      uri: fileUri,
      name: 'voice.m4a',
      type: 'audio/mp4',
    } as unknown as Blob);
    form.append('contact_id', contactId);
    const res = await fetch(`${API_BASE_URL}/api/messages/voice`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`voice send failed: ${res.status}`);
    return res.json();
  },

  fileDownloadUrl: (fileId: string) => `${API_BASE_URL}/api/files/${fileId}/download`,
};
