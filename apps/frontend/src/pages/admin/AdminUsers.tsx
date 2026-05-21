import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { UserRole } from '@crm/shared';

export function AdminUsers() {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: api.admin.listUsers });

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('agent');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.admin.createUser({ phone, name, email: email || undefined, role }),
    onSuccess: () => {
      setPhone(''); setName(''); setEmail(''); setErr(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e: Error) => setErr(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.admin.updateUser(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <section className="page">
      <header className="page-head"><h1>Users</h1></header>
      <form className="card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <h3>Add user</h3>
        <div className="row">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={create.isPending}>Create</button>
        </div>
        {err && <div className="err">{err}</div>}
      </form>
      <table className="data">
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th></tr>
        </thead>
        <tbody>
          {usersQ.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.phone_e164}</td>
              <td>{u.email ?? '—'}</td>
              <td><span className={`pill pill-${u.role}`}>{u.role}</span></td>
              <td>
                <input
                  type="checkbox"
                  checked={u.active}
                  onChange={(e) => toggle.mutate({ id: u.id, active: e.target.checked })}
                />
              </td>
              <td>{(u as unknown as { last_login_at?: string }).last_login_at
                ? new Date((u as unknown as { last_login_at: string }).last_login_at).toLocaleString()
                : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
