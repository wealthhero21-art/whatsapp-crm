import Constants from 'expo-constants';

// API base comes from app.json → expo.extra.apiBaseUrl, overridable at
// runtime by setting EXPO_PUBLIC_API_BASE_URL.
const fromExtra =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  fromExtra ??
  'http://b245h6se6xsbefhgkgw1xj62.217.216.58.194.sslip.io';
