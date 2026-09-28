import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../db.ts";
import { ConflictError, ValidationError } from "./errors.ts";
import { dispatchOutbox } from "./notifications.ts";
import { createSeller, sender } from "./test-helpers.ts";
import { completeEmbeddedSignup, disconnectWhatsApp, getWhatsAppConnection, setGraphFetchForTests } from "./whatsapp-connect.ts";

const env = { META_APP_ID: "1234567890", META_EMBEDDED_SIGNUP_CONFIG_ID: "9876543210", WHATSAPP_META_APP_SECRET: "app-secret" };
const saved: Record<string, string | undefined> = {};
before(() => {
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setGraphFetchForTests(null);
  await db.$disconnect();
});

let seq = 0;
function uniqueIds() {
  seq++;
  const base = String(Date.now()).slice(-9) + String(seq).padStart(3, "0");
  return { waba: `5${base}`, phone: `1${base}` };
}

function metaApi(ids: { waba: string; phone: string }, options: { numbers?: string[] } = {}) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("Authorization") });
      if (url.includes("/oauth/access_token")) {
        return new URL(url).searchParams.get("code") === "good-code-from-fb-login"
          ? Response.json({ access_token: "EAAB-business-token", token_type: "bearer" })
          : Response.json({ error: { message: "Invalid verification code format.", code: 100 } }, { status: 400 });
      }
      if (url.includes("/phone_numbers")) {
        return Response.json({ data: (options.numbers ?? [ids.phone]).map((id) => ({ id, display_phone_number: "+27 82 555 1234", verified_name: "Sandile's Shop" })) });
      }
      if (url.endsWith("/subscribed_apps")) return Response.json({ success: true });
      if (url.endsWith("/register")) return Response.json({ success: true });
      if (url.includes("/message_templates") && method === "POST") return Response.json({ id: "tpl", status: "PENDING" });
      if (url.includes("/message_templates")) return Response.json({ data: [{ name: "order_paid", status: "APPROVED" }, { name: "shipment_booked", status: "PENDING" }] });
      return new Response("unexpected", { status: 404 });
    },
  };
}

test("Connect my WhatsApp: code exchanged, number verified, app subscribed, templates submitted", async () => {
  const { user } = await createSeller("wa-connect");
  const ids = uniqueIds();
  const api = metaApi(ids);
  setGraphFetchForTests(api.fetch);

  const result = await completeEmbeddedSignup(user, { code: "good-code-from-fb-login", wabaId: ids.waba, phoneNumberId: ids.phone, coexistence: true });
  assert.equal(result.connected, true);
  assert.equal(result.displayNumber, "+27 82 555 1234");
  assert.equal(result.coexistence, true);
  assert.deepEqual(result.templatesFailed, []);

  const paths = api.calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace(/^\/v[\d.]+/, "")}`);
  assert.equal(paths[0], "GET /oauth/access_token");
  assert.ok(paths.includes(`POST /${ids.waba}/subscribed_apps`));
  // Coexistence numbers stay on the WhatsApp Business app: no register call.
  assert.ok(!paths.some((p) => p.endsWith("/register")));
  const templates = api.calls.filter((c) => c.method === "POST" && c.url.includes("/message_templates"));
  assert.equal(templates.length, 8); // every customer template, not the seller alert
  assert.deepEqual((templates[0]!.body as { category: string }).category, "UTILITY");
  assert.ok(api.calls.slice(1).every((c) => c.auth === "Bearer EAAB-business-token"));

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assert.equal(tenant.whatsappPhoneId, ids.phone);
  assert.ok(tenant.whatsappAccessTokenEncrypted && !tenant.whatsappAccessTokenEncrypted.includes("EAAB"), "token stored encrypted");

  // Status page shows template approval progress.
  const status = await getWhatsAppConnection(user, true);
  assert.deepEqual(status.templates, { approved: 1, pending: 1, rejected: 0, total: 8 });

  // Messages now go out from the shop's own number with its own token.
  await db.outboundMessage.create({
    data: { tenantId: user.tenantId, toPhone: "27821234567", template: "shipment_delivered", templateParams: ["Shop", "SHS-1"], body: "✅", dedupeKey: `t-${ids.phone}` },
  });
  await dispatchOutbox(user.tenantId);
  const last = sender.sent.at(-1)!;
  assert.equal(last.phoneNumberId, ids.phone);
  assert.equal(last.accessToken, "EAAB-business-token");

  // Disconnect returns the shop to share-link mode.
  const off = await disconnectWhatsApp(user);
  assert.equal(off.connected, false);
  assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } })).whatsappPhoneId, null);
});

test("a brand-new API number is registered; coexistence isn't", async () => {
  const { user } = await createSeller("wa-register");
  const ids = uniqueIds();
  const api = metaApi(ids);
  setGraphFetchForTests(api.fetch);
  await completeEmbeddedSignup(user, { code: "good-code-from-fb-login", wabaId: ids.waba, phoneNumberId: ids.phone, coexistence: false });
  const register = api.calls.find((c) => c.url.endsWith(`/${ids.phone}/register`))!;
  assert.ok(register);
  assert.match((register.body as { pin: string }).pin, /^\d{6}$/);
});

test("the browser can't claim a number the Meta token doesn't own, or one another shop has", async () => {
  const a = await createSeller("wa-guard-a");
  const b = await createSeller("wa-guard-b");
  const ids = uniqueIds();

  // Token can only see a different number.
  setGraphFetchForTests(metaApi(ids, { numbers: ["999999999"] }).fetch);
  await assert.rejects(
    () => completeEmbeddedSignup(a.user, { code: "good-code-from-fb-login", wabaId: ids.waba, phoneNumberId: ids.phone }),
    /didn't confirm that WhatsApp number/,
  );
  // Bad code from the browser.
  setGraphFetchForTests(metaApi(ids).fetch);
  await assert.rejects(() => completeEmbeddedSignup(a.user, { code: "tampered-code-xyz", wabaId: ids.waba, phoneNumberId: ids.phone }), ValidationError);

  await completeEmbeddedSignup(a.user, { code: "good-code-from-fb-login", wabaId: ids.waba, phoneNumberId: ids.phone, coexistence: true });
  await assert.rejects(
    () => completeEmbeddedSignup(b.user, { code: "good-code-from-fb-login", wabaId: ids.waba, phoneNumberId: ids.phone, coexistence: true }),
    ConflictError,
  );
});
