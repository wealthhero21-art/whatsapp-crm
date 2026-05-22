// Token persistence via expo-secure-store (Keychain on iOS, Keystore on Android).
import * as SecureStore from 'expo-secure-store';

const KEY = 'crm.session.token';

export async function getToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(KEY); }
  catch { return null; }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
