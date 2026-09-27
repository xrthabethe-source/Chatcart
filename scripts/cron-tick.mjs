// Runs every 15 minutes as a separate Railway cron service (see
// railway.cron.json and docs/deploy.md): asks the web app to refresh
// courier tracking and send any queued WhatsApp notifications, then exits.
//
//   APP_BASE_URL=https://… CRON_SECRET=… node scripts/cron-tick.mjs
const base = process.env.APP_BASE_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.error("APP_BASE_URL and CRON_SECRET must be set.");
  process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/api/v1/delivery/tracking/sync`;
const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
const text = await response.text();
if (!response.ok) {
  console.error(`Tracking sync failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  process.exit(1);
}
console.log(`Tracking sync OK: ${text}`);
