// Shared types between backend and frontend.
// Keep this file dependency-free (no runtime deps) so the frontend can import it directly.

export type UserRole = 'admin' | 'agent';

export interface User {
  id: string;
  phone_e164: string;
  name: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface AuthSession {
  token: string;
  user: User;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'docs_pending'
  | 'docs_received'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'dropped';

export interface Lead {
  id: string;
  contact_id: string;
  source_id: string | null;
  source_ref: string | null;
  status: LeadStatus;
  product: string | null;
  amount: number | null;
  assigned_to: string | null;
  assigned_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;

  // Joined fields for convenience
  contact_phone?: string;
  contact_name?: string;
  assignee_name?: string | null;
  source_name?: string | null;
}

export interface LeadSource {
  id: string;
  name: string;
  slug: string;
  assignment_strategy: 'manual' | 'round_robin';
  whatsapp_number_id: string | null;
  product: string | null;
  welcome_template: string | null;
  active: boolean;
  created_at: string;
}

export interface WhatsappNumber {
  id: string;
  brand_label: string;
  display_phone: string;
  phone_number_id: string;
  waba_id: string;
  active: boolean;
  created_at: string;
  // Tokens never serialized to the client.
}

export type DocCategory =
  | 'pan' | 'aadhaar' | 'salary_slip' | 'bank_stmt' | 'itr'
  | 'cheque' | 'photo' | 'other';

export type DocSlotStatus = 'pending' | 'received' | 'verified' | 'rejected';

export interface DocRequirement {
  id: string;
  source_id: string;
  product: string | null;
  doc_category: DocCategory | string;
  required_count: number;
  display_order: number;
  label: string | null;
  description: string | null;
  optional: boolean;
}

export interface LeadDocSlot {
  id: string;
  lead_id: string;
  requirement_id: string | null;
  doc_category: string;
  required_count: number;
  label: string | null;
  description: string | null;
  optional: boolean;
  display_order: number;
  status: DocSlotStatus;
  rejection_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  files?: Array<{ id: string; filename: string | null; mime_type: string; size_bytes: number | null; created_at: string }>;
}

// ---------------------------------------------------------------------------
// Quick replies + conversation notes
// ---------------------------------------------------------------------------

export interface QuickReply {
  id: string;
  user_id: string | null;     // null = team-wide
  slug: string;
  label: string;
  body: string;
  language: string;
  created_at: string;
}

export interface ConversationNote {
  id: string;
  contact_id: string;
  author_user_id: string | null;
  author_name?: string | null;  // joined from users
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type IntegrationKind =
  | 'leads_inbound'      // external system pushes leads in
  | 'loan_app'           // we push verified data out
  | 'document_store'     // we mirror files into
  | 'crm'                // bidirectional with another CRM
  | 'analytics'          // we forward events to
  | 'custom';

export interface Integration {
  id: string;
  name: string;
  slug: string;
  kind: IntegrationKind;
  base_url: string | null;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface OutboundWebhook {
  id: string;
  integration_id: string | null;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Events emitted on the internal bus (and to outbound webhooks)
// ---------------------------------------------------------------------------

export type EventType =
  | 'lead.created'
  | 'lead.assigned'
  | 'lead.status_changed'
  | 'lead.updated'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.enriched'
  | 'message.received'
  | 'message.sent'
  | 'file.received'
  | 'file.classified'
  | 'doc.received'
  | 'doc.verified'
  | 'doc.rejected'
  | 'doc.complete';

export interface CrmEvent<T = unknown> {
  type: EventType;
  occurred_at: string;
  payload: T;
}
