import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Integration, IntegrationKind } from '@crm/shared';

const KINDS: IntegrationKind[] = ['leads_inbound', 'loan_app', 'document_store', 'crm', 'analytics', 'custom'];

export function AdminIntegrations() {
  const qc = useQueryClient();
  const integrationsQ = useQuery({ queryKey: ['integrations'], queryFn: api.admin.listIntegrations });
  const webhooksQ = useQuery({ queryKey: ['webhooks'], queryFn: api.admin.listWebhooks });

  return (
    <section className="page">
      <header className="page-head">
        <h1>Integrations</h1>
        <p className="muted">
          Each external app (lead source, loan-origination system, doc store…) is registered here.
          Issue an API key for inbound. Subscribe to events for outbound.
        </p>
      </header>

      <NewIntegrationForm
        onCreated={() => qc.invalidateQueries({ queryKey: ['integrations'] })}
      />

      <div className="card">
        <h3>Registered integrations</h3>
        {integrationsQ.data?.length === 0 && <div className="empty">None yet.</div>}
        {integrationsQ.data?.map((i) => (
          <IntegrationRow key={i.id} integration={i} />
        ))}
      </div>

      <div className="card">
        <h3>Outbound webhooks</h3>
        <p className="muted">
          Subscribed URLs receive POST requests when events occur. Signed with HMAC-SHA256 in <code>X-CRM-Signature</code>.
        </p>
        <NewWebhookForm
          integrations={integrationsQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ['webhooks'] })}
        />
        <table className="data">
          <thead><tr><th>URL</th><th>Events</th><th>Integration</th><th>Active</th></tr></thead>
          <tbody>
            {webhooksQ.data?.map((w) => (
              <tr key={w.id}>
                <td><code>{w.url}</code></td>
                <td>{w.events.join(', ')}</td>
                <td>{integrationsQ.data?.find((i) => i.id === w.integration_id)?.name ?? '—'}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={w.active}
                    onChange={(e) => api.admin.updateWebhook(w.id, { active: e.target.checked })
                      .then(() => qc.invalidateQueries({ queryKey: ['webhooks'] }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NewIntegrationForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<IntegrationKind>('leads_inbound');
  const [baseUrl, setBaseUrl] = useState('');
  const [lookupUrl, setLookupUrl] = useState('');
  const [lookupAuth, setLookupAuth] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const config: Record<string, unknown> = {};
        if (lookupUrl) {
          config.customer_lookup_url = lookupUrl;
          config.customer_lookup_method = lookupUrl.includes('{phone}') ? 'GET' : 'GET';
          if (lookupAuth) config.customer_lookup_auth_header = lookupAuth;
        }
        await api.admin.createIntegration({
          name, slug, kind, base_url: baseUrl || undefined, config,
        } as never);
        setName(''); setSlug(''); setBaseUrl(''); setLookupUrl(''); setLookupAuth(''); setErr(null);
        onCreated();
      } catch (err: unknown) {
        setErr((err as Error).message);
      }
    }}>
      <h3>Register integration</h3>
      <div className="row">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="slug" pattern="[a-z0-9_-]+" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        <select value={kind} onChange={(e) => setKind(e.target.value as IntegrationKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </div>
      <p className="muted" style={{ margin: '10px 0 4px' }}>
        Realtime customer lookup (optional) — the CRM calls this when a new customer messages, to pull their details.
        Use <code>{'{phone}'}</code> for the E.164 number.
      </p>
      <div className="row">
        <input placeholder="https://app.maximoney.in/api/customer?phone={phone}" value={lookupUrl} onChange={(e) => setLookupUrl(e.target.value)} />
        <input placeholder="Auth header (e.g. Bearer xxx) — optional" value={lookupAuth} onChange={(e) => setLookupAuth(e.target.value)} />
        <button type="submit">Add</button>
      </div>
      {err && <div className="err">{err}</div>}
    </form>
  );
}

function IntegrationRow({ integration }: { integration: Integration }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const keysQ = useQuery({
    queryKey: ['keys', integration.id],
    queryFn: () => api.admin.listKeys(integration.id),
    enabled: open,
  });
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  return (
    <div className="integration-row">
      <div className="integration-head" onClick={() => setOpen(!open)}>
        <strong>{integration.name}</strong>
        <span className="muted">{integration.kind} · <code>{integration.slug}</code></span>
        <span style={{ marginLeft: 'auto' }}>{integration.active ? 'active' : 'paused'}</span>
      </div>
      {open && (
        <div className="integration-body">
          <h4>API keys (inbound)</h4>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const k = await api.admin.createKey(integration.id, { name: keyName });
              setNewKey(k.plaintext);
              setKeyName('');
              qc.invalidateQueries({ queryKey: ['keys', integration.id] });
            }}
            className="row"
          >
            <input placeholder="Key name (e.g. prod-server)" value={keyName} onChange={(e) => setKeyName(e.target.value)} required />
            <button type="submit">Generate</button>
          </form>
          {newKey && (
            <div className="callout">
              Copy this key now — it won't be shown again: <code>{newKey}</code>
              <button className="link" onClick={() => setNewKey(null)}>Dismiss</button>
            </div>
          )}
          <ul>
            {keysQ.data?.map((k) => (
              <li key={k.id}>
                <code>{k.key_prefix}…</code> · {k.name} ·{' '}
                {k.revoked_at ? 'revoked' : (
                  <button className="link" onClick={async () => {
                    await api.admin.revokeKey(k.id);
                    qc.invalidateQueries({ queryKey: ['keys', integration.id] });
                  }}>Revoke</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewWebhookForm({
  integrations,
  onCreated,
}: { integrations: Integration[]; onCreated: () => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('lead.created,lead.assigned');
  const [integrationId, setIntegrationId] = useState('');
  const [secret, setSecret] = useState('');
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        await api.admin.createWebhook({
          url,
          events: events.split(',').map((s) => s.trim()).filter(Boolean),
          integration_id: integrationId || undefined,
          secret: secret || undefined,
        });
        setUrl(''); setEvents('lead.created,lead.assigned'); setSecret('');
        onCreated();
      }}
    >
      <input placeholder="https://your-app.example.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <input placeholder="lead.created, lead.assigned…" value={events} onChange={(e) => setEvents(e.target.value)} />
      <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
        <option value="">(no integration)</option>
        {integrations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <input placeholder="HMAC secret (≥16 chars)" value={secret} onChange={(e) => setSecret(e.target.value)} minLength={16} />
      <button type="submit">Subscribe</button>
    </form>
  );
}
