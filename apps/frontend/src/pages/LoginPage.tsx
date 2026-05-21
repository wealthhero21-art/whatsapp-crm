import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.requestOtp(phone.trim());
      setPhase('code');
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { token, user } = await api.verifyOtp(phone.trim(), code.trim());
      login(token, user);
      // Force a route re-eval via location change. Router will redirect by role.
      location.href = user.role === 'admin' ? '/admin' : '/agent';
    } catch (e: unknown) {
      setErr('Invalid or expired code.');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>WhatsApp CRM</h1>
        <p className="muted">
          Sign in with the WhatsApp number registered as a CRM user.
        </p>
        {phase === 'phone' ? (
          <form onSubmit={requestOtp}>
            <label>WhatsApp number</label>
            <input
              type="tel"
              placeholder="+91 99999 99999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send code via WhatsApp'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <label>Enter the 6-digit code we sent on WhatsApp</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{4,8}"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => { setPhase('phone'); setCode(''); }}
              disabled={busy}
            >
              Change number
            </button>
          </form>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
