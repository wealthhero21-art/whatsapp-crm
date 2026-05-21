import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function AdminAudit() {
  const auditQ = useQuery({ queryKey: ['audit'], queryFn: () => api.admin.audit(200), refetchInterval: 30_000 });
  return (
    <section className="page">
      <header className="page-head"><h1>Audit log</h1></header>
      <table className="data">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>
          {auditQ.data?.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td>{row.actor_name ?? 'system'}</td>
              <td><code>{row.action}</code></td>
              <td>{row.entity_type ?? '—'} {row.entity_id ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
