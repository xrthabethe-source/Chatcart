import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../db.ts";
import { markOrderPaid } from "./checkout.ts";
import { setDeliveryFetchForTests } from "./delivery-settings.ts";
import { enterTrackingReference, getOrderDetail } from "./shipments.ts";
import { addProduct, configureProvider, createSeller, fakeFetch, seedPaxiPoints } from "./test-helpers.ts";
import { handleWhatsAppMessage, parseAddress } from "./whatsapp-flow.ts";

/** The flow must reply (not stay silent) in these tests. */
async function hw(...args: Parameters<typeof handleWhatsAppMessage>) {
  const reply = await handleWhatsAppMessage(...args);
  assert.ok(reply, "expected a reply");
  return reply!;
}

after(async () => {
  setDeliveryFetchForTests(null);
  await db.$disconnect();
});

const PAXI = { enabled: true, mode: "ASSISTED" as const, config: { tariff: [{ serviceCode: "STD", name: "Standard", rateCents: 5995, etaMinDays: 7, etaMaxDays: 9 }] } };

test("WhatsApp: order → PEP/PAXI → pay → track → repeat purchase in a few taps", async () => {
  const { run } = await seedPaxiPoints();
  const { tenant, user } = await createSeller("wa");
  await configureProvider(user, "PAXI", PAXI);
  await configureProvider(user, "SELLER_COLLECTION", { enabled: true });
  await addProduct(user, "Product A", 40_000);
  const phone = "27821234567";
  const say = (text: string, extra: object = {}) => hw(tenant.id, { phone, profileName: "Thandi", text, ...extra });

  let reply = await say("I want 2 Product A");
  assert.match(reply.text, /^Added ✓ 2 × Product A\n\nHow would you like to receive your order\?/);
  assert.deepEqual(reply.options!.map((o) => o.title), ["🏪 Collect at PEP", "📦 Collect from Sandile"]);

  reply = await say("1");
  assert.match(reply.text, /Please send your suburb, town, postcode or PEP store name/);
  assert.equal(reply.requestLocation, true);

  reply = await say(`Tembisa${run}`);
  assert.match(reply.text, new RegExp(`Nearby PAXI Points:\\n\\n1\\. PEP Tembisa Mall ${run}`));

  reply = await say("1");
  assert.match(reply.text, new RegExp(`Collect at: PEP Tembisa Mall ${run}\\n\\nProducts R800\\nPAXI R59.95\\nTOTAL R859.95`));
  assert.deepEqual(reply.options!.map((o) => o.title), ["PAY SECURELY", "Change delivery"]);

  reply = await say("PAY");
  const number = /Order (SHS-\d+)/.exec(reply.text)![1]!;
  assert.match(reply.text, /Pay securely here:\nhttp.*\/pay\//);

  const order = await db.order.findFirstOrThrow({ where: { tenantId: tenant.id, number } });
  assert.equal(order.deliveryMethod, "PAXI_PICKUP");
  assert.equal(order.channel, "WHATSAPP");
  await markOrderPaid(tenant.id, order.id, "pf-1");

  reply = await say("Track");
  assert.equal(
    reply.text,
    `📦 Order ${number}\nCourier: PAXI\nDestination: PEP Tembisa Mall ${run}\nStatus: Preparing your order\n\nWe'll message you when it is ready for collection.`,
  );
  const shipmentId = (await getOrderDetail(user, order.id)).shipments[0]!.id;
  await enterTrackingReference(user, shipmentId, { trackingNumber: "PX-1" });
  reply = await say("track");
  assert.match(reply.text, /Status: Booked with courier\nTracking no: PX-1/);

  // Repeat purchase: remembered PAXI point, two taps to the total.
  reply = await say("1 Product A");
  assert.match(reply.text, new RegExp(`Last time you collected at:\\nPEP Tembisa Mall ${run}\\n\\nUse it again\\?`));
  reply = await hw(tenant.id, { phone, optionId: "yes" });
  assert.match(reply.text, /Products R400\nPAXI R59.95\nTOTAL R459.95/);

  // FORGET removes remembered details.
  await say("cancel");
  await say("FORGET");
  reply = await say("1 Product A");
  assert.match(reply.text, /How would you like to receive your order\?/);
});

test("WhatsApp: same-day unavailable offers standard courier / PAXI, reusing the address", async () => {
  await seedPaxiPoints();
  const { tenant, user } = await createSeller("wa-sd");
  await configureProvider(user, "PAXI", PAXI);
  await configureProvider(user, "COURIER_GUY", {
    enabled: true,
    mode: "INTEGRATED",
    methods: ["DOOR_COURIER", "SAME_DAY"],
    credentials: { apiKey: "k" },
    config: { serviceLevels: { ECO: { name: "Economy" }, OVN: { name: "Fast" } } },
  });
  await addProduct(user, "Honey Sticks", 5000);
  const future = { delivery_date_from: "2099-01-05T17:00:00+02:00", delivery_date_to: "2099-01-07T17:00:00+02:00" };
  setDeliveryFetchForTests(
    fakeFetch({ "/v2/rates": { rates: [{ rate: 99, service_level: { code: "ECO", name: "Economy", ...future } }] } }).fetch,
  );
  const phone = "27830000001";
  const say = (text: string) => hw(tenant.id, { phone, text });

  let reply = await say("3 honey sticks");
  const titles = reply.options!.map((o) => o.title);
  assert.deepEqual(titles, ["🏪 Collect at PEP", "🚚 Deliver to my door", "⚡ Same-day"]);
  reply = await say("3");
  assert.match(reply.text, /Street, Suburb, Town, Postcode/);
  reply = await say("12 Vilakazi St, Orlando West, Soweto, 1804");
  assert.match(reply.text, /^Same-day isn't available for this address\.\nYou can choose:\n\n1\. 🚚 Standard courier\n2\. 🏪 PEP\/PAXI collection/);

  reply = await say("1");
  // Only one door option was returned, so it's selected straight away.
  assert.match(reply.text, /Deliver to: 12 Vilakazi St, Orlando West, Soweto, 1804\n\nProducts R150\nDelivery R99\nTOTAL R249/);
});

test("address parsing", () => {
  assert.deepEqual(parseAddress("12 Vilakazi St, Orlando West, Soweto, 1804"), {
    street: "12 Vilakazi St", suburb: "Orlando West", city: "Soweto", postcode: "1804",
  });
  assert.deepEqual(parseAddress("Unit 4, Sunset Villas, 8 Main Rd, Tembisa, Kempton Park, 1632")?.street, "Unit 4, Sunset Villas, 8 Main Rd");
  assert.equal(parseAddress("Soweto"), null);
  assert.equal(parseAddress("12 Main, Suburb, Town, 18O4"), null);
});

test("WhatsApp: a shop with no products yet says so instead of an empty list", async () => {
  const { tenant } = await createSeller("wa-empty");
  const reply = await hw(tenant.id, { phone: "27830000009", text: "hi" });
  assert.match(reply.text, /still adding our products/);
});

test("WhatsApp coexistence: silent for ordinary chats, answers shoppers", async () => {
  const { tenant, user } = await createSeller("wa-quiet");
  await configureProvider(user, "SELLER_COLLECTION", { enabled: true });
  await addProduct(user, "Honey Sticks", 5000);
  const quiet = { quietUnlessShopping: true };
  const msg = (text: string) => handleWhatsAppMessage(tenant.id, { phone: "27830000077", text }, new Date(), quiet);

  assert.equal(await msg("Hi Sandile, are we still meeting tomorrow?"), null);
  assert.equal(await msg("hi"), null);
  assert.equal(await msg("cancel"), null);
  assert.match((await msg("menu"))!.text, /Welcome to/);
  const added = await msg("2 honey sticks");
  assert.match(added!.text, /Added ✓ 2 × Honey Sticks/);
  // Mid-order, plain replies are answered.
  assert.match((await msg("1"))!.text, /Collect from the seller|TOTAL/);
  assert.match((await msg("Track"))!.text, /I couldn't find any orders|Order/);
});
