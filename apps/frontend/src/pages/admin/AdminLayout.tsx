import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const navItems = [
  { to: 'leads', label: 'Leads' },
  { to: 'users', label: 'Users' },
  { to: 'sources', label: 'Sources' },
  { to: 'numbers', label: 'WhatsApp numbers' },
  { to: 'integrations', label: 'Integrations' },
  { to: 'stats', label: 'Stats' },
  { to: 'audit', label: 'Audit' },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">CRM · Admin</div>
        <nav>
          {navItems.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}>
              {n.label}
            </NavLink>
          ))}
          <NavLink to="/agent">Open inbox →</NavLink>
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
