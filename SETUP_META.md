# Meta Cloud API Setup (no BSP)

Follow these in order. Skipping a step will cost you hours of debugging.

## 1. Prerequisites

- A **Meta Business Account** at business.facebook.com
- A **phone number** dedicated to WhatsApp Business API (a personal WhatsApp number cannot use Cloud API simultaneously — if you're migrating your existing business number, you'll need to delete it from the WhatsApp Business app first)
- A **public HTTPS URL** for the webhook (use ngrok in dev, your real domain in prod)
- A **verified business** for sending template messages to users you haven't talked to (optional for testing — you get a test number that can message up to 5 verified test numbers without verification)

## 2. Create the App

1. Go to **developers.facebook.com** → My Apps → Create App
2. Type: **Business**
3. Add the **WhatsApp** product to your app
4. In WhatsApp → API Setup, you'll see:
   - A test phone number + temporary token (24-hr expiry) — good for first ping
   - Your **WhatsApp Business Account ID** (WABA ID) — save this
   - Your **Phone Number ID** — save this
   - **App ID** + **App Secret** (under Settings → Basic) — save these

## 3. Generate a Permanent Access Token (System User)

The temporary token expires in 24 hours. For production, create a System User:

1. business.facebook.com → Settings → Users → System Users → Add
   - Name: e.g. `whatsapp-crm-system`
   - Role: **Admin**
2. Click the new user → **Add Assets** → WhatsApp Accounts → select your WABA → enable **Full control**
3. Also Add Assets → Apps → select your app → enable **Full control**
4. Click **Generate New Token** on the system user:
   - App: select your app
   - Token expiration: **Never**
   - Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
5. **Copy the token immediately** — you can't see it again. This is your `WHATSAPP_TOKEN`.

## 4. Configure the Webhook

1. WhatsApp → Configuration → Webhook
2. **Callback URL**: `https://your-domain.com/webhook/whatsapp` (or your ngrok URL)
3. **Verify Token**: any random string you generate — must match `WEBHOOK_VERIFY_TOKEN` in your `.env`
4. Click **Verify and Save**. Meta sends a GET request; the backend's `verifyWebhook` handler echoes the challenge.
5. Click **Manage** next to Webhook fields → subscribe to **`messages`** (this delivers inbound text + media + statuses)

## 5. (Optional but recommended) Validate Webhook Signatures

Meta signs every POST with `X-Hub-Signature-256` using your **App Secret**. The backend verifies this automatically when `META_APP_SECRET` is set in `.env`. Always set it in production — without it, anyone who guesses your webhook URL can inject fake messages.

## 6. Add Test Numbers (during development)

Until your business is verified, you can only message numbers you've added as recipients:

1. WhatsApp → API Setup → To: → **Manage phone number list** → add your phone(s)
2. Each added number receives a WhatsApp verification code

## 7. Submit Message Templates

Outside the 24-hour customer service window, you can only send pre-approved templates.

1. WhatsApp → Message Templates → **Create Template**
2. Categories that matter for loan DSAs:
   - **MARKETING** — promotional offers (lowest priority, can be rate-limited)
   - **UTILITY** — application status, doc-pending reminders (most of your use cases)
   - **AUTHENTICATION** — OTP only
3. Templates with variables use `{{1}}`, `{{2}}` placeholders. Example:

   > Hi {{1}}, your home loan application #{{2}} requires {{3}}. Please share at your earliest convenience.

4. Approval takes minutes to a few hours. Once approved, the backend syncs them via `GET /{WABA_ID}/message_templates`.

## 8. Fill `.env`

```bash
WHATSAPP_TOKEN=EAAxxxxxxxxxx                 # from step 3
WHATSAPP_PHONE_NUMBER_ID=123456789012345      # from step 2
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765  # WABA ID, from step 2
WEBHOOK_VERIFY_TOKEN=any-random-string-you-chose
META_APP_SECRET=abcdef0123456789               # from step 2 (App Settings → Basic)
META_GRAPH_VERSION=v21.0                       # bump as Meta releases new versions
```

## 9. Smoke Test

```bash
# Send a hello to a registered test number
curl -X POST http://localhost:4000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"to":"+919999999999","type":"text","text":"Hello from the CRM"}'
```

If the number receives the message and a row appears in `messages` table with `direction='out'`, you're wired up.

## Common gotchas

- **"Recipient phone number not in allowed list"** — until verified, you can only message pre-registered test numbers.
- **Webhook verification fails** — verify token mismatch is the #1 cause. Re-check `WEBHOOK_VERIFY_TOKEN`.
- **Media download returns 401** — the temporary URL must be fetched *with* the `Authorization: Bearer` header. The backend does this in `whatsapp/media.ts`.
- **Templates not showing up** — `GET /{WABA_ID}/message_templates` only returns *approved* templates. Pending/rejected are filtered out by Meta.
- **Free-form message rejected with `(#131047) Re-engagement message`** — you're outside the 24-hour window. Send a template instead.
