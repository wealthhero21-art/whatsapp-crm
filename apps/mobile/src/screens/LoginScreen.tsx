import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { theme } from '../theme';

export function LoginScreen() {
  const { signIn } = useAuth();
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function requestOtp() {
    setBusy(true); setErr(null);
    try {
      await api.requestOtp(phone.trim());
      setPhase('code');
    } catch (e) {
      setErr('Could not send code. Check the number.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); setErr(null);
    try {
      const { token, user } = await api.verifyOtp(phone.trim(), code.trim());
      await signIn(token, user);
    } catch {
      setErr('Invalid or expired code.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Maximoney CRM</Text>
        <Text style={styles.sub}>Sign in with your registered WhatsApp number.</Text>

        {phase === 'phone' ? (
          <>
            <Text style={styles.label}>WhatsApp number</Text>
            <TextInput
              style={styles.input}
              placeholder="+91 99999 99999"
              placeholderTextColor={theme.textFaint}
              keyboardType="phone-pad"
              autoFocus
              value={phone}
              onChangeText={setPhone}
            />
            <TouchableOpacity style={styles.btn} onPress={requestOtp} disabled={busy}>
              {busy ? <ActivityIndicator color="#0a1612" /> : <Text style={styles.btnText}>Send code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.label}>Enter the 6-digit code</Text>
            <TextInput
              style={styles.input}
              placeholder="123456"
              placeholderTextColor={theme.textFaint}
              keyboardType="number-pad"
              autoFocus
              value={code}
              onChangeText={setCode}
            />
            <TouchableOpacity style={styles.btn} onPress={verify} disabled={busy}>
              {busy ? <ActivityIndicator color="#0a1612" /> : <Text style={styles.btnText}>Sign in</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPhase('phone'); setCode(''); }}>
              <Text style={styles.link}>Change number</Text>
            </TouchableOpacity>
          </>
        )}

        {err && <Text style={styles.err}>{err}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: theme.panel, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 24 },
  title: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textDim, marginTop: 4, marginBottom: 20 },
  label: { color: theme.textDim, marginBottom: 6 },
  input: {
    backgroundColor: theme.panel2, borderColor: theme.border, borderWidth: 1,
    borderRadius: 8, color: theme.text, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 14, fontSize: 16,
  },
  btn: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: '#0a1612', fontWeight: '700', fontSize: 16 },
  link: { color: theme.textDim, textAlign: 'center', marginTop: 14 },
  err: { color: theme.danger, marginTop: 14, textAlign: 'center' },
});
