# Deploying Chatcart and connecting WhatsApp

This guide takes Chatcart from GitHub to a live WhatsApp number. It's in three parts:

1. Put the app online on Railway (about 30 minutes)
2. Connect WhatsApp in Meta (about an hour, plus Meta's review time)
3. Test, then go live

WhatsApp can only send messages to a public HTTPS address, so part 1 has to come first.

## 1. Put the app online (Railway)

### 1.1 Create the project

1. In Railway, click **New project → Deploy from GitHub repo** and pick `xrthabethe-source/Chatcart`.
2. In the same project, click **New → Database → PostgreSQL**.
3. Open the Chatcart service. Under **Settings → Networking**, click **Generate domain**. This gives you an address like `https://chatcart-production.up.railway.app`, called *your app URL* below.

`railway.json` in the repo already tells Railway what to do:

- **Build:** installs packages and builds the app.
- **Before each release:** updates the database (`prisma migrate deploy`).
- **Start:** runs the app.
- **Health check:** `/api/health`, which also checks the database.

### 1.2 Set the variables

In the Chatcart service, open **Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills it in from the database) |
| `APP_BASE_URL` | your app URL, e.g. `https://chatcart-production.up.railway.app` |
| `DELIVERY_CREDENTIALS_KEY` | 32 random bytes: run `openssl rand -base64 32` and paste the output. Keep a copy: if it changes, sellers have to re-enter their courier API keys. |
| `CRON_SECRET` | any long random string, e.g. another `openssl rand -base64 32` |
| `PLATFORM_ADMIN_EMAILS` | your own seller login email. Admins can link WhatsApp numbers and import the PAXI Point list. |

Do **not** set `APP_ENV=development` in production. It turns on the fake "Simulate payment" button and relaxes cookie security.

Railway redeploys when variables change. When it's finished, `https://<your app URL>/api/health` should show `{"ok":true,"database":"up"}`.

### 1.3 Add the tracking job (every 15 minutes)

This job checks couriers for tracking updates and sends any queued WhatsApp messages.

1. In the same project, click **New → GitHub repo** and pick `Chatcart` again. This creates a second service from the same code.
2. In that service's **Settings**, set **Config file path** to `railway.cron.json`. That file makes it a cron job that runs every 15 minutes and then stops.
3. Give it two variables:
   - `APP_BASE_URL`: the same app URL
   - `CRON_SECRET`: the same value as the web service

The job's logs should show `Tracking sync OK` every 15 minutes.

### 1.4 Set up the platform and invite associates

1. Open your app URL and click **Open a shop**. Register with the email you put in `PLATFORM_ADMIN_EMAILS`. That makes you the platform admin.
2. Under **Admin**, upload the product catalogue CSV and save the default PEP / PAXI prices.
3. **Load the real PAXI Point list** before customers use PEP / PAXI. The seed script's `DEMO-*` points are samples. As a platform admin, `POST /api/v1/admin/delivery-locations/import` with `{ "providerCode": "PAXI", "locations": [ … ] }` (fields are listed in `src/server/services/locations.ts`).
4. Under **Admin → Invite an associate**, create a link and send it on WhatsApp. They set up their own shop in about 5 minutes.

## 2. Connect WhatsApp (Meta)

### 2.1 Create the Meta app and number

1. At [developers.facebook.com](https://developers.facebook.com), click **My Apps → Create app** and choose type **Business**. Link it to your Meta Business account (create one if asked).
2. Add the **WhatsApp** product to the app.
3. Under **WhatsApp → API Setup**, add your business phone number and verify it by SMS or call. The number must **not** currently be registered on the WhatsApp or WhatsApp Business app on a phone. Use a new SIM, or delete WhatsApp from that phone first.
4. On the same page, copy the **Phone number ID**. It's a long number like `106540352242922`, not the phone number itself.

### 2.2 Create a permanent access token

The token on the API Setup page expires after 24 hours. For production:

1. In **Business settings → Users → System users**, add a system user with the **Admin** role.
2. Click **Add assets**, choose your app, and give it full control.
3. Click **Generate new token** for your app. Tick `whatsapp_business_messaging` and `whatsapp_business_management`, and set the expiry to **Never**.
4. Copy the token. Meta only shows it once.

### 2.3 Give the app the WhatsApp keys

Add these to the Chatcart web service's variables in Railway:

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_META_ACCESS_TOKEN` | the system user token from 2.2 |
| `WHATSAPP_META_APP_SECRET` | Meta app → **App settings → Basic → App secret** |
| `WHATSAPP_META_VERIFY_TOKEN` | a word you make up, e.g. `chatcart-verify-7391`. You'll enter the same word in Meta next. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en`, or whatever language code your templates are approved in (see 2.6) |
| `WHATSAPP_PLATFORM_PHONE_ID` | the Phone number ID of **your shared Chatcart number**. Associates who haven't connected their own number get their customer updates and new-order alerts from this number. |

Wait for Railway to redeploy.

### 2.4 Point Meta's webhook at the app

1. In the Meta app, open **WhatsApp → Configuration → Webhook → Edit**.
2. Set **Callback URL** to `https://<your app URL>/api/v1/whatsapp/webhook`.
3. Set **Verify token** to the word you chose for `WHATSAPP_META_VERIFY_TOKEN`, then click **Verify and save**. If this fails, the app hasn't redeployed yet or the two words don't match.
4. Under **Webhook fields**, subscribe to **messages**.

### 2.5 Link a number to a specific shop (optional)

Skip this for associates in share-link mode: they don't need their own number connected.

In Chatcart, open **Shop settings**. Paste the **Phone number ID** from 2.1 into **WhatsApp phone number ID** and save. The app checks the ID with Meta and shows the phone number it belongs to.

Only platform admins (the `PLATFORM_ADMIN_EMAILS` list) see this field. Incoming messages go to whichever shop holds a number, so sellers can't link numbers themselves.

### 2.6 Submit the message templates

Delivery updates such as "ready for collection" often arrive days after the customer last messaged you. WhatsApp only allows those through **pre-approved templates**. Create every template in [whatsapp-templates.md](whatsapp-templates.md) under **WhatsApp Manager → Message templates**, with category **Utility**, and use the exact names and text given there. Approval usually takes minutes to a day.

If a template isn't approved yet, Meta rejects that message. The dashboard still works; the customer just doesn't get that particular update.

## 3. Test, then go live

1. From your personal phone, send "I want 2 Product A" to the business number.
2. Go through PEP / PAXI: choose a point, reply PAY, then check the order appears under **Orders**.
3. Mark it paid (**Mark as paid**). You should get the payment confirmation on WhatsApp.
4. Enter a PAXI reference on the order, set it to **Ready for collection**, and check each update arrives.
5. Send "Track".

While the Meta app is in development mode, it can only message numbers added as testers under **API Setup → To**. To serve real customers:

- **Business verification.** In **Business settings → Security centre**, submit your company documents. It usually takes a few days, so start early.
- **Display name.** WhatsApp reviews the name customers see.
- **Switch the app to Live** in the Meta app dashboard.
- **Payments.** "Pay securely" currently leads to a placeholder page. Connect a payment gateway (PayFast, Yoco or Ozow) before taking real orders.

## Troubleshooting

| Symptom | Check |
|---|---|
| Meta says the callback URL couldn't be verified | `WHATSAPP_META_VERIFY_TOKEN` matches in both places, and the app has redeployed |
| Messages arrive but the shop never replies | The Phone number ID is linked in **Shop settings**. Railway logs show `Invalid signature` if `WHATSAPP_META_APP_SECRET` is wrong. |
| Replies work, but delivery updates don't arrive | Templates aren't approved yet, or `WHATSAPP_TEMPLATE_LANGUAGE` doesn't match their language. Failed sends are kept in `outbound_messages` with the error. |
| Tracking never updates for The Courier Guy orders | The cron service's logs show `Tracking sync OK`, and its `CRON_SECRET` matches the web service |
