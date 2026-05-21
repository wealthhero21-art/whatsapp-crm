import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { LeadStatus } from '@crm/shared';

const STATUSES: LeadStatus[] = ['new','contacted','qualified','docs_pending','docs_received','submitted','approved','rejected','dropped'];

export function AgentLeads() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('');

  const leadsQ = useQuery({
    queryKey: ['leads', { mine: true, status: statusFilter }],
    queryFn: () => api.listLeads({ assigned_to: 'me', status: statusFilter || undefined }),
    refetchInterval: 20_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      api.patchLead(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  return (
    <section className="page">
      <header className="page-head">
        <h1>My leads</h1>
        <div className="filters">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </header>
      <table className="data">
        <thead>
          <tr>
            <th>Contact</th><th>Phone</th><th>Product</th><th>Status</th><th>Updated</th><th></th>
          </tr>
        </thead>
        <tbody>
          {leadsQ.data?.map((l) => (
            <tr key={l.id}>
              <td>{l.contact_name ?? '—'}</td>
              <td>{l.contact_phone}</td>
              <td>{l.product ?? '—'}</td>
              <td>
                <select
                  value={l.status}
                  onChange={(e) => setStatus.mutate({ id: l.id, status: e.target.value as LeadStatus })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>{new Date(l.updated_at).toLocaleString()}</td>
              <td>
                <button className="link" onClick={() => navigate(`/agent/leads/${l.id}`)}>
                  Open →
                </button>
              </td>
            </tr>
          ))}
          {leadsQ.data?.length === 0 && (
            <tr><td colSpan={6} className="empty">No leads assigned yet</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
