import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminLeads } from './pages/admin/AdminLeads';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminSources } from './pages/admin/AdminSources';
import { AdminNumbers } from './pages/admin/AdminNumbers';
import { AdminIntegrations } from './pages/admin/AdminIntegrations';
import { AdminStats } from './pages/admin/AdminStats';
import { AdminAudit } from './pages/admin/AdminAudit';
import { AgentLayout } from './pages/agent/AgentLayout';
import { AgentInbox } from './pages/agent/AgentInbox';
import { AgentLeads } from './pages/agent/AgentLeads';
import { LeadDetail } from './pages/agent/LeadDetail';
import { useAuth } from './auth/AuthContext';
import { useEvents } from './lib/useEvents';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
}

function AuthedShell({ children }: { children: ReactNode }) {
  useEvents();
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/admin" element={
        <RequireAuth roles={['admin']}>
          <AuthedShell><AdminLayout /></AuthedShell>
        </RequireAuth>
      }>
        <Route index element={<Navigate to="leads" replace />} />
        <Route path="leads" element={<AdminLeads />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="sources" element={<AdminSources />} />
        <Route path="numbers" element={<AdminNumbers />} />
        <Route path="integrations" element={<AdminIntegrations />} />
        <Route path="stats" element={<AdminStats />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>

      <Route path="/agent" element={
        <RequireAuth roles={['agent', 'admin']}>
          <AuthedShell><AgentLayout /></AuthedShell>
        </RequireAuth>
      }>
        <Route index element={<Navigate to="leads" replace />} />
        <Route path="leads" element={<AgentLeads />} />
        <Route path="leads/:id" element={<LeadDetail />} />
        <Route path="inbox" element={<AgentInbox />} />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
