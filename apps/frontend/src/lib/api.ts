import type {
  Lead, LeadSource, Integration, OutboundWebhook, User, UserRole,
  WhatsappNumber, DocRequirement, LeadDocSlot,
  QuickReply, ConversationNote,
} from '@crm/shared';

// ---------------------------------------------------------------------------
// Auth token plumbing. The fetch wrapper reads from localStorage so it works
// for everything including SSE (which needs the token in a query param).
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'crm.session';

export function getToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { token: string }).token : null;
  } catch { return null; }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    if (location.pathname !== '/login') location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Domain types echoed from backend (kept loose; @crm/shared is the source of truth)
// ---------------------------------------------------------------------------
export interface Contact {
  id: string;
  wa_id: string;
  phone_e164: string;
  profile_name: string | null;
  display_name: string | null;
  external_lead_id: string | null;
  external_app_id: string | null;
  tags: string[];
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  wa_message_id: string | null;
  direction: 'in' | 'out';
  msg_type: string;
  body: string | null;
  template_name: string | null;
  template_params: string[] | null;
  file_id: string | null;
  status: string;
  created_at: string;
  file_mime?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  doc_category?: string | null;
  download_status?: string | null;
}

export interface FileRow {
  id: string;
  mime_type: string;
  filename: string | null;
  size_bytes: number | null;
  doc_category: string | null;
  classifier_confidence: number | null;
  download_status: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface Template {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: Array<{ type: string; text?: string; format?: string }>;
  variable_count: number;
}

export const api = {
  // ----- Auth -----
  requestOtp: (phone: string) =>
    http<{ sent: boolean }>(`/auth/otp/request`, {
      method: 'POST', body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string) =>
    http<{ token: string; expires_at: string; user: User }>(`/auth/otp/verify`, {
      method: 'POST', body: JSON.stringify({ phone, code }),
    }),

  // ----- Contacts / Messages / Files / Templates (chat UI) -----
  listContacts: (search?: string) =>
    http<{ contacts: Contact[] }>(
      `/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`
    ).then((r) => r.contacts),
  getContact: (id: string) =>
    http<{ contact: Contact }>(`/api/contacts/${id}`).then((r) => r.contact),
  patchContact: (id: string, body: Partial<Contact>) =>
    http<{ contact: Contact }>(`/api/contacts/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.contact),
  markRead: (id: string) => http(`/api/contacts/${id}/read`, { method: 'POST' }),
  listMessages: (id: string) =>
    http<{ messages: Message[] }>(`/api/contacts/${id}/messages`).then((r) => r.messages),
  listFiles: (id: string) =>
    http<{ files: FileRow[] }>(`/api/contacts/${id}/files`).then((r) => r.files),
  patchFile: (id: string, body: Partial<FileRow>) =>
    http<{ file: FileRow }>(`/api/files/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.file),
  sendText: (contactId: string, text: string) =>
    http<{ message: Message }>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, type: 'text', text }),
    }).then((r) => r.message),
  sendTemplate: (contactId: string, name: string, language: string, body_params: string[]) =>
    http<{ message: Message }>(`/api/messages`, {
      method: 'POST',
      body: JSON.stringify({
        contact_id: contactId, type: 'template',
        template: { name, language, body_params },
      }),
    }).then((r) => r.message),
  listTemplates: () =>
    http<{ templates: Template[] }>(`/api/templates`).then((r) => r.templates),
  syncTemplates: () => http<{ synced: number }>(`/api/templates/sync`, { method: 'POST' }),

  // ----- Leads -----
  listLeads: (params: { status?: string; source_id?: string; assigned_to?: string; search?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return http<{ leads: Lead[] }>(`/api/leads${qs ? `?${qs}` : ''}`).then((r) => r.leads);
  },
  getLead: (id: string) =>
    http<{ lead: Lead }>(`/api/leads/${id}`).then((r) => r.lead),
  patchLead: (id: string, body: Partial<Lead>) =>
    http<{ lead: Lead }>(`/api/leads/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.lead),
  assignLead: (id: string, user_id: string) =>
    http(`/api/leads/${id}/assign`, {
      method: 'POST', body: JSON.stringify({ user_id }),
    }),

  // ----- Admin -----
  admin: {
    listUsers: () => http<{ users: User[] }>(`/api/admin/users`).then((r) => r.users),
    createUser: (body: { phone: string; name: string; email?: string; role: UserRole }) =>
      http<{ user: User }>(`/api/admin/users`, {
        method: 'POST', body: JSON.stringify(body),
      }).then((r) => r.user),
    updateUser: (id: string, body: Partial<User>) =>
      http<{ user: User }>(`/api/admin/users/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.user),

    listSources: () =>
      http<{ sources: LeadSource[] }>(`/api/admin/sources`).then((r) => r.sources),
    createSource: (body: { name: string; slug: string; assignment_strategy: 'manual' | 'round_robin' }) =>
      http<{ source: LeadSource }>(`/api/admin/sources`, {
        method: 'POST', body: JSON.stringify(body),
      }).then((r) => r.source),
    updateSource: (id: string, body: Partial<LeadSource>) =>
      http<{ source: LeadSource }>(`/api/admin/sources/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.source),

    listIntegrations: () =>
      http<{ integrations: Integration[] }>(`/api/admin/integrations`).then((r) => r.integrations),
    createIntegration: (body: Partial<Integration> & { name: string; slug: string; kind: string }) =>
      http<{ integration: Integration }>(`/api/admin/integrations`, {
        method: 'POST', body: JSON.stringify(body),
      }).then((r) => r.integration),
    updateIntegration: (id: string, body: Partial<Integration>) =>
      http<{ integration: Integration }>(`/api/admin/integrations/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.integration),

    listKeys: (integrationId: string) =>
      http<{ keys: Array<{ id: string; name: string; key_prefix: string; scopes: string[]; created_at: string; revoked_at: string | null }> }>(
        `/api/admin/integrations/${integrationId}/keys`
      ).then((r) => r.keys),
    createKey: (integrationId: string, body: { name: string; scopes?: string[] }) =>
      http<{ key: { id: string; plaintext: string; key_prefix: string; name: string; scopes: string[] } }>(
        `/api/admin/integrations/${integrationId}/keys`,
        { method: 'POST', body: JSON.stringify(body) }
      ).then((r) => r.key),
    revokeKey: (id: string) =>
      http(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),

    listWebhooks: () =>
      http<{ webhooks: OutboundWebhook[] }>(`/api/admin/webhooks`).then((r) => r.webhooks),
    createWebhook: (body: { url: string; events: string[]; integration_id?: string; secret?: string }) =>
      http<{ webhook: OutboundWebhook }>(`/api/admin/webhooks`, {
        method: 'POST', body: JSON.stringify(body),
      }).then((r) => r.webhook),
    updateWebhook: (id: string, body: Partial<OutboundWebhook>) =>
      http<{ webhook: OutboundWebhook }>(`/api/admin/webhooks/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.webhook),

    stats: () => http<{
      by_status: Array<{ status: string; count: number }>;
      by_source: Array<{ source: string; count: number }>;
      by_agent: Array<{ id: string; name: string; open_leads: number }>;
      unassigned: number;
    }>(`/api/admin/stats`),

    audit: (limit = 100) =>
      http<{ audit: Array<{ id: number; action: string; entity_type: string | null; entity_id: string | null; actor_name: string | null; created_at: string; before: unknown; after: unknown }> }>(
        `/api/admin/audit?limit=${limit}`
      ).then((r) => r.audit),

    // WhatsApp numbers (brands)
    listNumbers: () =>
      http<{ numbers: WhatsappNumber[] }>(`/api/admin/whatsapp-numbers`).then((r) => r.numbers),
    createNumber: (body: {
      brand_label: string;
      display_phone: string;
      phone_number_id: string;
      waba_id: string;
      access_token: string;
      app_secret?: string;
      webhook_verify_token: string;
    }) => http<{ number: WhatsappNumber }>(`/api/admin/whatsapp-numbers`, {
      method: 'POST', body: JSON.stringify(body),
    }).then((r) => r.number),
    updateNumber: (id: string, body: Partial<WhatsappNumber> & { access_token?: string; webhook_verify_token?: string }) =>
      http<{ number: WhatsappNumber }>(`/api/admin/whatsapp-numbers/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.number),

    // Source <-> agent membership
    listSourceAgents: (sourceId: string) =>
      http<{ agents: Array<{ id: string; name: string; phone_e164: string; role: UserRole }> }>(
        `/api/admin/sources/${sourceId}/agents`
      ).then((r) => r.agents),
    setSourceAgents: (sourceId: string, user_ids: string[]) =>
      http(`/api/admin/sources/${sourceId}/agents`, {
        method: 'PUT', body: JSON.stringify({ user_ids }),
      }),

    // Doc requirements per source
    listDocRequirements: (sourceId: string) =>
      http<{ requirements: DocRequirement[] }>(`/api/admin/sources/${sourceId}/doc-requirements`)
        .then((r) => r.requirements),
    createDocRequirement: (sourceId: string, body: Partial<DocRequirement> & { doc_category: string }) =>
      http<{ requirement: DocRequirement }>(`/api/admin/sources/${sourceId}/doc-requirements`, {
        method: 'POST', body: JSON.stringify(body),
      }).then((r) => r.requirement),
    updateDocRequirement: (id: string, body: Partial<DocRequirement>) =>
      http<{ requirement: DocRequirement }>(`/api/admin/doc-requirements/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }).then((r) => r.requirement),
    deleteDocRequirement: (id: string) =>
      http(`/api/admin/doc-requirements/${id}`, { method: 'DELETE' }),
  },

  // ----- Doc workflow (used by agent UI) -----
  listLeadDocs: (leadId: string) =>
    http<{ slots: LeadDocSlot[] }>(`/api/leads/${leadId}/docs`).then((r) => r.slots),
  addLeadDocSlot: (leadId: string, body: { doc_category: string; required_count?: number; label?: string; description?: string; optional?: boolean }) =>
    http<{ slot: LeadDocSlot }>(`/api/leads/${leadId}/docs`, {
      method: 'POST', body: JSON.stringify(body),
    }).then((r) => r.slot),
  attachToSlot: (slotId: string, file_id: string) =>
    http(`/api/doc-slots/${slotId}/attach`, {
      method: 'POST', body: JSON.stringify({ file_id }),
    }),
  verifySlot: (slotId: string) =>
    http(`/api/doc-slots/${slotId}/verify`, { method: 'POST' }),
  rejectSlot: (slotId: string, reason: string) =>
    http(`/api/doc-slots/${slotId}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  // ----- Quick-replies -----
  listSnippets: () =>
    http<{ snippets: QuickReply[] }>(`/api/snippets`).then((r) => r.snippets),
  createSnippet: (body: { slug: string; label: string; body: string; language?: string; scope?: 'personal' | 'team' }) =>
    http<{ snippet: QuickReply }>(`/api/snippets`, {
      method: 'POST', body: JSON.stringify(body),
    }).then((r) => r.snippet),
  updateSnippet: (id: string, body: Partial<QuickReply>) =>
    http<{ snippet: QuickReply }>(`/api/snippets/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.snippet),
  deleteSnippet: (id: string) =>
    http(`/api/snippets/${id}`, { method: 'DELETE' }),

  // ----- Internal notes (per contact) -----
  listNotes: (contactId: string) =>
    http<{ notes: ConversationNote[] }>(`/api/contacts/${contactId}/notes`)
      .then((r) => r.notes),
  addNote: (contactId: string, body: string, pinned = false) =>
    http<{ note: ConversationNote }>(`/api/contacts/${contactId}/notes`, {
      method: 'POST', body: JSON.stringify({ body, pinned }),
    }).then((r) => r.note),
  updateNote: (id: string, body: Partial<ConversationNote>) =>
    http<{ note: ConversationNote }>(`/api/notes/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.note),
  deleteNote: (id: string) =>
    http(`/api/notes/${id}`, { method: 'DELETE' }),

  uploadFile: async (contactId: string, file: File): Promise<{ id: string }> => {
    const token = getToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/contacts/${contactId}/files/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const data = await res.json() as { file: { id: string } };
    return data.file;
  },
};
