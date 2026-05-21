import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

export function AgentLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">CRM · {user?.role === 'admin' ? 'Admin' : 'Agent'}</div>
        <nav>
          <NavLink to="leads" className={({ isActive }) => isActive ? 'active' : ''}>My leads</NavLink>
          <NavLink to="inbox" className={({ isActive }) => isActive ? 'active' : ''}>Inbox</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">← Admin panel</NavLink>}
        </nav>
        <div className="me">
          <div>{user?.name}</div>
          <button className="link" onClick={() => { logout(); location.href = '/login'; }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
