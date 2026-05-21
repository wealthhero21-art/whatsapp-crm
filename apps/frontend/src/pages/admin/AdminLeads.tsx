import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

const STATUSES = ['new','contacted','qualified','docs_pending','docs_received','submitted','approved','rejected','dropped'];

export function AdminLeads() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [search, setSearch] = useState('');

  const leadsQ = useQuery({
    queryKey: ['leads', { statusFilter, assignedFilter, search }],
    queryFn: () => api.listLeads({
      status: statusFilter || undefined,
      assigned_to: assignedFilter || undefined,
      search: search || undefined,
    }),
  });
  const usersQ = useQuery({ queryKey: ['users'], queryFn: api.admin.listUsers });

  const assign = useMutation({
    mutationFn: ({ id, user_id }: { id: string; user_id: string }) => api.assignLead(id, user_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const agents = (usersQ.data ?? []).filter((u) => u.role === 'agent' && u.active);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Leads</h1>
        <div className="filters">
          <input placeholder="Search phone, name, ref…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)}>
            <option value="">All agents</option>
            <option value="unassigned">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </header>
      <table className="data">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Phone</th>
            <th>Source</th>
            <th>Product</th>
            <th>Status</th>
            <th>Assigned</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {leadsQ.data?.map((l) => (
            <tr key={l.id}>
              <td>{l.contact_name ?? '—'}</td>
              <td>{l.contact_phone}</td>
              <td>{l.source_name ?? '—'}</td>
              <td>{l.product ?? '—'}</td>
              <td><span className={`pill pill-${l.status}`}>{l.status}</span></td>
              <td>
                <select
                  value={l.assigned_to ?? ''}
                  onChange={(e) => e.target.value && assign.mutate({ id: l.id, user_id: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </td>
              <td>{new Date(l.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {leadsQ.data?.length === 0 && (
            <tr><td colSpan={7} className="empty">No leads yet</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
