// Adapter registry. Each external integration ships as a module under
// src/integrations/<slug>/index.ts that exports an Adapter.
//
// To add a new connector:
//   1. Create src/integrations/my-app/index.ts
//   2. Default-export an object that conforms to `Adapter`
//   3. Insert a row into the `integrations` table (kind, slug, config)
//   4. Register it via `registerAdapter()` at startup (see boot.ts)
//
// The adapter has hooks for inbound (translate external payload into a Lead)
// and for outbound (react to internal events).

import type { CrmEvent, IntegrationKind } from '@crm/shared';

export interface InboundLeadPayload {
  // The normalised shape we accept from any source after the adapter translates.
  phone_e164: string;
  contact_name?: string;
  product?: string;
  amount?: number | null;
  source_ref?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdapterContext {
  integrationId: string;
  config: Record<string, unknown>;
  baseUrl: string | null;
}

export interface Adapter {
  slug: string;
  kind: IntegrationKind;
  // Optional: translate an inbound POST body into a normalised lead payload.
  parseInboundLead?: (raw: unknown, ctx: AdapterContext) => InboundLeadPayload | Promise<InboundLeadPayload>;
  // Optional: react to CRM events (e.g. push contact to loan app).
  onEvent?: (event: CrmEvent, ctx: AdapterContext) => void | Promise<void>;
}

const adapters = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter) {
  adapters.set(adapter.slug, adapter);
}

export function getAdapter(slug: string): Adapter | undefined {
  return adapters.get(slug);
}

export function listAdapters(): Adapter[] {
  return [...adapters.values()];
}
