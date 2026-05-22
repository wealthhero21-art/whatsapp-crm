# Maximoney CRM — mobile (Expo / React Native)

Native agent app. Talks to the same backend as the web app over HTTPS.

## What's in this scaffold

- Auth: phone → OTP (works with the `DEV_OTP_BYPASS_CODE` during setup), JWT stored in the device keychain via `expo-secure-store`.
- Chat list: agent's accessible conversations (numbers already masked by the backend).
- Chat thread: text send, quick-reply snippets, **voice notes** (hold the mic button to record, release to send).
- Shared types from `@crm/shared`.

## Run it

```bash
# from the repo root (installs the whole workspace incl. the mobile app)
pnpm install

cd apps/mobile
npx expo start            # press i (iOS sim), a (Android), or scan the QR with Expo Go
```

The API base URL is read from `app.json → expo.extra.apiBaseUrl` (currently the
sslip.io deploy). Override at runtime:

```bash
EXPO_PUBLIC_API_BASE_URL=https://crm.maximoney.in npx expo start
```

## Building store binaries (later)

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview     # APK for internal testing
eas build -p ios --profile preview         # TestFlight
```

## Still to build (next iterations)

- Lead-context panel inside the thread (status, product, doc checklist) — backend data already available via `GET /api/leads` + `/api/leads/:id/docs`.
- Internal notes lane (backend ready at `/api/contacts/:id/notes`).
- Native push notifications (APNs + FCM) for new inbound messages — needs an Expo push token + a backend `device_tokens` table + send-on-`message.received`.
- Realtime updates (currently polls every 8s; move to SSE or push).
- Document viewer for received files.
