import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ThemeToggle } from '../../components/ThemeToggle';

const navItems = [
  { to: 'leads', label: 'Leads' },
  { to: 'users', label: 'Users' },
  { to: 'sources', label: 'Sources' },
  { to: 'numbers', label: 'WhatsApp numbers' },
  { to: 'integrations', label: 'Integrations' },
  { to: 'stats', label: 'Stats' },
  { to: 'audit', label: 'Audit' },
];

// Absolute link straight to the chat inbox (admin sees all conversations there).

export function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">CRM · Admin</div>
        <nav>
          <NavLink to="/agent/inbox" className="nav-chats">💬 Chats</NavLink>
          {navItems.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div>{user?.name}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <ThemeToggle />
            <button className="link" onClick={() => { logout(); location.href = '/login'; }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
