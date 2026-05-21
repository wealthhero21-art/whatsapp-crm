import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function AdminNumbers() {
  const qc = useQueryClient();
  const numbersQ = useQuery({ queryKey: ['numbers'], queryFn: api.admin.listNumbers });

  const [form, setForm] = useState({
    brand_label: '',
    display_phone: '',
    phone_number_id: '',
    waba_id: '',
    access_token: '',
    app_secret: '',
    webhook_verify_token: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.admin.createNumber(form),
    onSuccess: () => {
      setForm({ brand_label: '', display_phone: '', phone_number_id: '', waba_id: '', access_token: '', app_secret: '', webhook_verify_token: '' });
      setErr(null);
      qc.invalidateQueries({ queryKey: ['numbers'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.admin.updateNumber(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['numbers'] }),
  });

  return (
    <section className="page">
      <header className="page-head">
        <h1>WhatsApp brand numbers</h1>
        <p className="muted">
          Each brand has its own Meta Cloud-API number, WABA, and token. Sources point to one of these so document collection happens through the right brand.
        </p>
      </header>

      <form className="card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <h3>Add a brand number</h3>
        <div className="row">
          <input placeholder="Brand label (e.g. BrandA Loans)" value={form.brand_label}
            onChange={(e) => setForm({ ...form, brand_label: e.target.value })} required />
          <input placeholder="+91 99999 99999" value={form.display_phone}
            onChange={(e) => setForm({ ...form, display_phone: e.target.value })} required />
        </div>
        <div className="row">
          <input placeholder="Phone Number ID (Meta)" value={form.phone_number_id}
            onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} required />
          <input placeholder="WABA ID" value={form.waba_id}
            onChange={(e) => setForm({ ...form, waba_id: e.target.value })} required />
        </div>
        <div className="row">
          <input placeholder="Access token (system user)" type="password" value={form.access_token}
            onChange={(e) => setForm({ ...form, access_token: e.target.value })} required />
          <input placeholder="App secret (for webhook signature)" value={form.app_secret}
            onChange={(e) => setForm({ ...form, app_secret: e.target.value })} />
        </div>
        <div className="row">
          <input placeholder="Webhook verify token (your choice)" value={form.webhook_verify_token}
            onChange={(e) => setForm({ ...form, webhook_verify_token: e.target.value })} required minLength={8} />
          <button type="submit" disabled={create.isPending}>Add brand</button>
        </div>
        {err && <div className="err">{err}</div>}
      </form>

      <table className="data">
        <thead>
          <tr><th>Brand</th><th>Number</th><th>Phone Number ID</th><th>WABA</th><th>Active</th></tr>
        </thead>
        <tbody>
          {numbersQ.data?.map((n) => (
            <tr key={n.id}>
              <td>{n.brand_label}</td>
              <td>{n.display_phone}</td>
              <td><code>{n.phone_number_id}</code></td>
              <td><code>{n.waba_id}</code></td>
              <td>
                <input
                  type="checkbox"
                  checked={n.active}
                  onChange={(e) => toggle.mutate({ id: n.id, active: e.target.checked })}
                />
              </td>
            </tr>
          ))}
          {numbersQ.data?.length === 0 && (
            <tr><td colSpan={5} className="empty">No brand numbers yet</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
