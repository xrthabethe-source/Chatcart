import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { db } from "../db.ts";
import { signWebhook } from "../payments/yoco.ts";
import { getSessionUser } from "./auth.ts";
import { importMasterCatalogue, listCatalogueForShop, parseCatalogueCsv, setCatalogueSelection } from "./catalogue.ts";
import { createCart, getDeliveryMethods, getOrderForPayment, placeOrder, quoteDelivery, selectDeliveryQuote, setCartItem } from "./checkout.ts";
import { NotFoundError, UnauthenticatedError, ValidationError } from "./errors.ts";
import { checkInvite, createInvite, joinWithInvite } from "./invites.ts";
import { searchPickupPoints } from "./locations.ts";
import { getOnboardingStatus, setupQuickDelivery } from "./onboarding.ts";
import { connectYoco, handleYocoWebhook, setPaymentsFetchForTests, startYocoCheckout } from "./payments.ts";
import { setDefaultPaxiTariff } from "./platform-settings.ts";
import { createSeller, messagesFor, seedPaxiPoints } from "./test-helpers.ts";

after(async () => {
  setPaymentsFetchForTests(null);
  await db.$disconnect();
});

const ADDRESS = { street: "12 Vilakazi St", suburb: "Orlando West", city: "Soweto", postcode: "1804" };

async function joinAssociate(label: string) {
  const admin = await createSeller(`admin-${label}`);
  const invite = await createInvite(admin.user, { label: "Sandile" });
  const token = invite.url.split("/join/")[1]!;
  const { sessionToken } = await joinWithInvite(token, {
    name: "Sandile Mokoena",
    whatsappNumber: "082 555 1234",
    email: `${label}-${randomUUID()}@example.test`,
    password: "sandile-pass-1",
    associateId: "APL-001",
  });
  const user = (await getSessionUser(sessionToken))!;
  return { admin, invite, token, user };
}

test("invite link → shop in one step; single-use links can't be reused", async () => {
  const { invite, token, user, admin } = await joinAssociate("invite");
  assert.match(invite.url, /\/join\/[\w-]{20,}$/);
  assert.match(invite.whatsappText, /Hi Sandile!/);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assert.equal(tenant.name, "Sandile's Shop");
  assert.equal(tenant.whatsappNumber, "27825551234");
  assert.equal(tenant.associateId, "APL-001");
  assert.equal(tenant.invitedById, admin.tenant.id);

  await assert.rejects(() => checkInvite(token), NotFoundError);
  await assert.rejects(
    () => joinWithInvite(token, { name: "Someone", whatsappNumber: "0820000000", email: `x-${randomUUID()}@example.test`, password: "password-123" }),
    NotFoundError,
  );
  await assert.rejects(() => checkInvite("not-a-real-token"), NotFoundError);
});

test("catalogue CSV import, ticking products, and catalogue updates flowing to shops", async () => {
  const run = randomUUID().slice(0, 6);
  const rows = parseCatalogueCsv(
    `sku,name,price,description,image_url,weight_g\nGRW-${run},"GRW, Immune",R 850.00,"Box of 24 drops",https://img.example/grw.jpg,120\nAIR-${run},AIR,850,,,\n`,
  );
  assert.deepEqual(rows[0], {
    sku: `GRW-${run}`, name: "GRW, Immune", priceCents: 85_000, description: "Box of 24 drops", imageUrl: "https://img.example/grw.jpg",
    category: null, weightGrams: 120, lengthCm: null, widthCm: null, heightCm: null,
  });
  assert.throws(() => parseCatalogueCsv("sku,name\nA,B"), /price/);

  assert.deepEqual(await importMasterCatalogue({ products: rows }), { created: 2, updated: 0 });
  const { user } = await joinAssociate("catalogue");
  const catalogue = (await listCatalogueForShop(user)).filter((p) => p.sku.endsWith(run));
  assert.equal(catalogue.length, 2);
  assert.ok(catalogue.every((p) => !p.selected));

  const grw = catalogue.find((p) => p.sku === `GRW-${run}`)!;
  await setCatalogueSelection(user, { masterProductIds: [grw.id] });
  const product = await db.product.findFirstOrThrow({ where: { tenantId: user.tenantId, masterProductId: grw.id } });
  assert.deepEqual([product.name, product.priceCents, product.imageUrl, product.active], ["GRW, Immune", 85_000, "https://img.example/grw.jpg", true]);

  // Associate sets their own price; a catalogue update keeps it but
  // refreshes the photo and name.
  await db.product.update({ where: { id: product.id }, data: { priceCents: 79_900 } });
  await importMasterCatalogue({ products: [{ ...rows[0]!, name: "GRW Immune Drops", imageUrl: "https://img.example/grw2.jpg" }, rows[1]!] });
  const refreshed = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.deepEqual([refreshed.name, refreshed.imageUrl, refreshed.priceCents], ["GRW Immune Drops", "https://img.example/grw2.jpg", 79_900]);

  // Unticking hides the product but keeps it for order history.
  await setCatalogueSelection(user, { masterProductIds: [] });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).active, false);
});

test("quick delivery setup turns on PEP/PAXI (platform prices) and collection in one step", async () => {
  const run = (await seedPaxiPoints()).run;
  await setDefaultPaxiTariff([{ serviceCode: "STANDARD", name: "Standard", rateCents: 5995, etaMinDays: 7, etaMaxDays: 9 }]);
  const { user } = await joinAssociate("delivery");
  await assert.rejects(() => setupQuickDelivery(user, { ...ADDRESS, paxi: false, collection: false }), /at least one/);

  const status = await setupQuickDelivery(user, { ...ADDRESS, paxi: true, collection: true });
  assert.deepEqual(status.steps, { products: false, delivery: true, payments: false });
  assert.deepEqual((await getDeliveryMethods(user.tenantId)).map((m) => m.label), ["Collect at PEP / PAXI", "Collect from Sandile"]);
  const points = await searchPickupPoints(user.tenantId, { text: `Tembisa${run}` });
  assert.equal(points.length, 1);
  assert.match(status.whatsappShareUrl, /^https:\/\/wa\.me\/\?text=/);
});

const YOCO_KEY = "sk_test_960bfde0VBrLlpK098e4ffeb53131";
const WEBHOOK_SECRET = "whsec_" + Buffer.from("chatcart-test-webhook-secret").toString("base64");

function yocoApi() {
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  let n = 0;
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
      if (url.endsWith("/webhooks")) return Response.json({ id: "wh_1", secret: WEBHOOK_SECRET });
      if (url.endsWith("/checkouts")) return Response.json({ id: `ch_${++n}_${randomUUID().slice(0, 6)}`, redirectUrl: "https://c.yoco.com/checkout/ch_1" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("nope", { status: 404 });
    },
  };
}

test("Yoco: connect, pay by card, and only a signed webhook for the exact amount marks the order paid", async () => {
  await setDefaultPaxiTariff([{ serviceCode: "STANDARD", name: "Standard", rateCents: 5995, etaMinDays: 7, etaMaxDays: 9 }]);
  const { user } = await joinAssociate("yoco");
  const api = yocoApi();
  setPaymentsFetchForTests(api.fetch);

  await assert.rejects(() => connectYoco(user, { secretKey: "pk_test_abc" }), ValidationError);
  assert.deepEqual(await connectYoco(user, { secretKey: YOCO_KEY }), { connected: true, testMode: true });
  assert.match(String((api.calls[0]!.body as { url: string }).url), new RegExp(`/api/v1/payments/yoco/webhook/${user.tenantId}$`));
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assert.ok(tenant.yocoSecretKeyEncrypted && !tenant.yocoSecretKeyEncrypted.includes(YOCO_KEY), "key stored encrypted");

  // A customer order.
  await setupQuickDelivery(user, { ...ADDRESS, paxi: false, collection: true });
  const product = await db.product.create({ data: { tenantId: user.tenantId, name: "AIR", priceCents: 85_000 } });
  const cart = await createCart(user.tenantId, "WEB");
  await setCartItem(user.tenantId, cart.id, product.id, 1);
  const q = await quoteDelivery(user.tenantId, cart.id, { method: "SELLER_COLLECTION" });
  await selectDeliveryQuote(user.tenantId, cart.id, q.options[0]!.quoteId);
  const { order } = await placeOrder(user.tenantId, cart.id, { customerName: "Thandi", customerPhone: "0821234567" });

  const pay = await getOrderForPayment(order.id);
  assert.equal(pay.cardPayments, true);
  assert.match(pay.sellerWhatsAppUrl!, /^https:\/\/wa\.me\/27825551234\?text=Hi%20Sandile%2C%20I've%20just%20placed%20order/);

  const { redirectUrl } = await startYocoCheckout(order.id);
  assert.equal(redirectUrl, "https://c.yoco.com/checkout/ch_1");
  const checkoutCall = api.calls.at(-1)!;
  assert.equal((checkoutCall.body as { amount: number }).amount, 85_000);
  assert.equal(checkoutCall.headers.get("Authorization"), `Bearer ${YOCO_KEY}`);
  const checkout = await db.paymentCheckout.findFirstOrThrow({ where: { orderId: order.id } });

  const event = (amount: number) =>
    JSON.stringify({ id: "evt_1", type: "payment.succeeded", payload: { id: "p_1", amount, currency: "ZAR", status: "succeeded", metadata: { checkoutId: checkout.externalId } } });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const signed = (body: string) => ({ id: "msg_1", timestamp: ts, signature: signWebhook(WEBHOOK_SECRET, "msg_1", ts, body) });

  // Forged, replayed, or wrong amount: order stays unpaid.
  await assert.rejects(() => handleYocoWebhook(user.tenantId, { id: "msg_1", timestamp: ts, signature: "v1,Zm9yZ2Vk" }, event(85_000), now), UnauthenticatedError);
  const old = String(Math.floor(now / 1000) - 3600);
  await assert.rejects(
    () => handleYocoWebhook(user.tenantId, { id: "msg_1", timestamp: old, signature: signWebhook(WEBHOOK_SECRET, "msg_1", old, event(85_000)) }, event(85_000), now),
    UnauthenticatedError,
  );
  assert.deepEqual(await handleYocoWebhook(user.tenantId, signed(event(100)), event(100), now), { handled: false });
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");

  // The genuine event (fresh checkout, since the mismatch failed the first).
  const second = await startYocoCheckout(order.id);
  assert.ok(second.redirectUrl);
  const checkout2 = await db.paymentCheckout.findFirstOrThrow({ where: { orderId: order.id, status: "CREATED" } });
  const good = JSON.stringify({ type: "payment.succeeded", payload: { id: "p_2", amount: 85_000, currency: "ZAR", metadata: { checkoutId: checkout2.externalId } } });
  assert.deepEqual(await handleYocoWebhook(user.tenantId, signed(good), good, now), { handled: true });
  const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(paid.paymentRef, "yoco:p_2");
  // Webhook retries are harmless.
  assert.deepEqual(await handleYocoWebhook(user.tenantId, signed(good), good, now), { handled: true });

  // Customer confirmation + seller alert, both queued (shared number mode).
  const messages = await messagesFor(user.tenantId);
  assert.deepEqual(messages.map((m) => [m.template, m.toPhone]), [["order_paid", "27821234567"], ["seller_new_order", "27825551234"]]);
  assert.match(messages[0]!.body, /^✅ Sandile's Shop: payment of R850 received for order SHS-\d+\.\nDelivery: Collect from the seller/);
  assert.match(messages[1]!.body, /New paid order SHS-\d+ for R850\.\nCustomer: Thandi, 0821234567/);

  // Onboarding checklist now complete apart from products count.
  const status = await getOnboardingStatus(user);
  assert.equal(status.steps.payments, true);
  assert.equal(status.yocoConnected, true);
});

test("a shop can't be paid through another shop's webhook", async () => {
  const a = await joinAssociate("yoco-a");
  const b = await joinAssociate("yoco-b");
  setPaymentsFetchForTests(yocoApi().fetch);
  await connectYoco(a.user, { secretKey: YOCO_KEY });
  const body = JSON.stringify({ type: "payment.succeeded", payload: { amount: 1, metadata: { checkoutId: "ch_x" } } });
  const ts = String(Math.floor(Date.now() / 1000));
  // b has no Yoco connected → no secret → rejected.
  await assert.rejects(() => handleYocoWebhook(b.user.tenantId, { id: "m", timestamp: ts, signature: signWebhook(WEBHOOK_SECRET, "m", ts, body) }, body), UnauthenticatedError);
});
