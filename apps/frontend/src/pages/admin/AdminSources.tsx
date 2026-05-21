import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { LeadSource } from '@crm/shared';

const DOC_CATEGORIES = ['pan', 'aadhaar', 'salary_slip', 'bank_stmt', 'itr', 'cheque', 'photo', 'other'];

export function AdminSources() {
  const qc = useQueryClient();
  const sourcesQ = useQuery({ queryKey: ['sources'], queryFn: api.admin.listSources });
  const numbersQ = useQuery({ queryKey: ['numbers'], queryFn: api.admin.listNumbers });

  const [form, setForm] = useState({
    name: '', slug: '', assignment_strategy: 'manual' as 'manual' | 'round_robin',
    whatsapp_number_id: '', product: '', welcome_template: '',
  });

  const create = useMutation({
    mutationFn: () => api.admin.createSource({
      name: form.name,
      slug: form.slug,
      assignment_strategy: form.assignment_strategy,
      whatsapp_number_id: form.whatsapp_number_id || undefined,
      product: form.product || undefined,
      welcome_template: form.welcome_template || undefined,
    } as never),
    onSuccess: () => {
      setForm({ name: '', slug: '', assignment_strategy: 'manual', whatsapp_number_id: '', product: '', welcome_template: '' });
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  return (
    <section className="page">
      <header className="page-head">
        <h1>Lead sources</h1>
        <p className="muted">
          Each source is tied to one brand WhatsApp number. Agents are granted per-source access; they see all leads from their sources.
        </p>
      </header>

      <form className="card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <h3>Add source</h3>
        <div className="row">
          <input placeholder="Name (e.g. Website – Home Loan)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="slug" pattern="[a-z0-9_-]+" value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
        </div>
        <div className="row">
          <select value={form.assignment_strategy}
            onChange={(e) => setForm({ ...form, assignment_strategy: e.target.value as 'manual' | 'round_robin' })}>
            <option value="manual">Manual assignment</option>
            <option value="round_robin">Round-robin</option>
          </select>
          <select value={form.whatsapp_number_id}
            onChange={(e) => setForm({ ...form, whatsapp_number_id: e.target.value })}>
            <option value="">— select brand —</option>
            {numbersQ.data?.map((n) => <option key={n.id} value={n.id}>{n.brand_label}</option>)}
          </select>
          <input placeholder="Default product (e.g. home_loan)" value={form.product}
            onChange={(e) => setForm({ ...form, product: e.target.value })} />
          <input placeholder="Welcome template name (optional)" value={form.welcome_template}
            onChange={(e) => setForm({ ...form, welcome_template: e.target.value })} />
          <button type="submit">Create source</button>
        </div>
      </form>

      <div className="card">
        <h3>Sources</h3>
        {sourcesQ.data?.map((s) => <SourceRow key={s.id} source={s} brands={numbersQ.data ?? []} />)}
        {sourcesQ.data?.length === 0 && <div className="empty">No sources yet</div>}
      </div>
    </section>
  );
}

function SourceRow({ source, brands }: { source: LeadSource; brands: Array<{ id: string; brand_label: string }> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const update = useMutation({
    mutationFn: (body: Partial<LeadSource>) => api.admin.updateSource(source.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  return (
    <div className="integration-row">
      <div className="integration-head" onClick={() => setOpen(!open)}>
        <strong>{source.name}</strong>
        <span className="muted"><code>{source.slug}</code> · {source.assignment_strategy}</span>
        <span style={{ marginLeft: 'auto' }}>{source.active ? 'active' : 'paused'}</span>
      </div>
      {open && (
        <div className="integration-body">
          <div className="row">
            <select value={source.whatsapp_number_id ?? ''}
              onChange={(e) => update.mutate({ whatsapp_number_id: e.target.value || null } as never)}>
              <option value="">— pick brand number —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_label}</option>)}
            </select>
            <select value={source.assignment_strategy}
              onChange={(e) => update.mutate({ assignment_strategy: e.target.value as 'manual' | 'round_robin' })}>
              <option value="manual">Manual</option>
              <option value="round_robin">Round-robin</option>
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={source.active}
                onChange={(e) => update.mutate({ active: e.target.checked })} />
              Active
            </label>
          </div>
          <SourceAgentsEditor sourceId={source.id} />
          <DocRequirementsEditor sourceId={source.id} />
        </div>
      )}
    </div>
  );
}

function SourceAgentsEditor({ sourceId }: { sourceId: string }) {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: api.admin.listUsers });
  const agentsQ = useQuery({
    queryKey: ['source-agents', sourceId],
    queryFn: () => api.admin.listSourceAgents(sourceId),
  });
  const set = useMutation({
    mutationFn: (ids: string[]) => api.admin.setSourceAgents(sourceId, ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['source-agents', sourceId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const currentIds = new Set(agentsQ.data?.map((a) => a.id) ?? []);
  const agents = (usersQ.data ?? []).filter((u) => u.role === 'agent' && u.active);

  return (
    <div>
      <h4>Agents with access</h4>
      <div className="row">
        {agents.map((a) => (
          <label key={a.id} className="chip">
            <input
              type="checkbox"
              checked={currentIds.has(a.id)}
              onChange={(e) => {
                const next = new Set(currentIds);
                if (e.target.checked) next.add(a.id); else next.delete(a.id);
                set.mutate([...next]);
              }}
            />
            {a.name}
          </label>
        ))}
        {agents.length === 0 && <span className="muted">No agents yet</span>}
      </div>
    </div>
  );
}

function DocRequirementsEditor({ sourceId }: { sourceId: string }) {
  const qc = useQueryClient();
  const reqsQ = useQuery({
    queryKey: ['doc-reqs', sourceId],
    queryFn: () => api.admin.listDocRequirements(sourceId),
  });
  const [form, setForm] = useState({
    doc_category: 'pan',
    required_count: 1,
    product: '',
    label: '',
    optional: false,
  });
  const add = useMutation({
    mutationFn: () => api.admin.createDocRequirement(sourceId, {
      doc_category: form.doc_category,
      required_count: form.required_count,
      product: form.product || undefined,
      label: form.label || undefined,
      optional: form.optional,
    } as never),
    onSuccess: () => {
      setForm({ doc_category: 'pan', required_count: 1, product: '', label: '', optional: false });
      qc.invalidateQueries({ queryKey: ['doc-reqs', sourceId] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.admin.deleteDocRequirement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-reqs', sourceId] }),
  });

  return (
    <div>
      <h4>Document checklist</h4>
      <p className="muted" style={{ marginTop: 0 }}>
        Each row becomes a slot on every new lead from this source.
      </p>
      <table className="data">
        <thead>
          <tr><th>Doc</th><th>Count</th><th>Product</th><th>Label</th><th>Optional</th><th></th></tr>
        </thead>
        <tbody>
          {reqsQ.data?.map((r) => (
            <tr key={r.id}>
              <td><code>{r.doc_category}</code></td>
              <td>{r.required_count}</td>
              <td>{r.product ?? '— any —'}</td>
              <td>{r.label ?? '—'}</td>
              <td>{r.optional ? 'optional' : 'required'}</td>
              <td><button className="link" onClick={() => del.mutate(r.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <select value={form.doc_category} onChange={(e) => setForm({ ...form, doc_category: e.target.value })}>
          {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min={1} value={form.required_count}
          onChange={(e) => setForm({ ...form, required_count: Number(e.target.value) })} style={{ maxWidth: 80 }} />
        <input placeholder="Product (blank = any)" value={form.product}
          onChange={(e) => setForm({ ...form, product: e.target.value })} />
        <input placeholder="Label shown to agents" value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <label className="chip">
          <input type="checkbox" checked={form.optional}
            onChange={(e) => setForm({ ...form, optional: e.target.checked })} />
          Optional
        </label>
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
