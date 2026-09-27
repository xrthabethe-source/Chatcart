import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../db.ts";
import { createCart, getDeliveryMethods, markOrderPaid, placeOrder, quoteDelivery, selectDeliveryQuote, setCartItem } from "./checkout.ts";
import { forgetPreferences, getReturningSuggestion } from "./customers.ts";
import { listDeliverySettings, setDeliveryFetchForTests } from "./delivery-settings.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { searchPickupPoints } from "./locations.ts";
import {
  createShipment,
  enterTrackingReference,
  exportPaxiRegistrationCsv,
  getOrderDetail,
  setShipmentStatus,
  shippingDetailsText,
  syncAllTracking,
} from "./shipments.ts";
import { addProduct, configureProvider, createSeller, fakeFetch, messagesFor, seedPaxiPoints } from "./test-helpers.ts";

after(async () => {
  setDeliveryFetchForTests(null);
  await db.$disconnect();
});

const PAXI_TARIFF = { tariff: [{ serviceCode: "STD", name: "Standard", rateCents: 5995, etaMinDays: 7, etaMaxDays: 9 }] };

test("PAXI assisted mode: select a point, order, register on the portal, notify", async () => {
  const { run, postcode } = await seedPaxiPoints();
  const { tenant, user } = await createSeller("paxi");
  await configureProvider(user, "PAXI", { enabled: true, mode: "ASSISTED", config: PAXI_TARIFF });
  const product = await addProduct(user, "Product A", 40_000);

  assert.deepEqual((await getDeliveryMethods(tenant.id)).map((m) => m.method), ["PAXI_PICKUP"]);

  // "Where would you like to collect?" — by suburb, and by location.
  const bySuburb = await searchPickupPoints(tenant.id, { text: `Tembisa${run}` });
  assert.deepEqual(bySuburb.map((p) => p.name), [`PEP Tembisa Mall ${run}`]);
  // (Filtered to this run's points: earlier runs left identical ones.)
  const mine = await searchPickupPoints(tenant.id, { text: run, latitude: -26.2440, longitude: 27.8560 });
  // Nearest first: Jabulani (~0.7 km), Maponya (~3 km), Tembisa (~45 km).
  assert.deepEqual(mine.map((p) => p.name), [`PEP Jabulani Mall ${run}`, `PEP Maponya Mall ${run}`, `PEP Tembisa Mall ${run}`]);
  assert.match(mine[0]!.distanceLabel!, /km away|m away/);
  const byPostcode = await searchPickupPoints(tenant.id, { text: postcode, limit: 20 });
  assert.ok(byPostcode.some((p) => p.name === `PEP Maponya Mall ${run}`));

  const cart = await createCart(tenant.id, "WEB");
  await setCartItem(tenant.id, cart.id, product.id, 2);
  const quote = await quoteDelivery(tenant.id, cart.id, { method: "PAXI_PICKUP", locationId: mine[0]!.id });
  assert.deepEqual(quote.options.map((o) => [o.serviceName, o.priceCents, o.etaLabel]), [["Standard", 5995, "7-9 working days"]]);
  await selectDeliveryQuote(tenant.id, cart.id, quote.options[0]!.quoteId);

  const { order } = await placeOrder(tenant.id, cart.id, { customerName: "Thandi", customerPhone: "082 123 4567", rememberPreferences: true });
  assert.match(order.number, /^SHS-\d+$/);
  // Orders carry only generic delivery fields.
  assert.equal(order.deliveryMethod, "PAXI_PICKUP");
  assert.equal(order.deliveryServiceCode, "STD");
  assert.equal(order.deliveryLocationId, mine[0]!.id);
  assert.equal(order.shippingCents, 5995);
  assert.equal(order.totalCents, 80_000 + 5995);
  const dest = order.deliveryDestination as { kind: string; location: Record<string, unknown> };
  assert.equal(dest.kind, "PICKUP_POINT");
  for (const field of ["externalId", "code", "name", "suburb", "city", "province", "postcode", "latitude", "longitude"]) {
    assert.ok(dest.location[field] !== undefined && dest.location[field] !== null, `destination stores ${field}`);
  }

  // Paid → lands in "Ready for PAXI registration".
  await markOrderPaid(tenant.id, order.id, "test-payment");
  let detail = await getOrderDetail(user, order.id);
  const shipment = detail.shipments[0]!;
  assert.equal(shipment.status, "READY_FOR_REGISTRATION");
  assert.equal(shipment.actions.enterTrackingReference, true);
  assert.equal(shipment.actions.createShipment, false);

  const csv = await exportPaxiRegistrationCsv(user);
  assert.match(csv, new RegExp(`${order.number},Thandi,0821234567,,PEP Jabulani Mall ${run},P${run}1,JAB-${run}`));
  const details = await shippingDetailsText(user, shipment.id);
  assert.match(details, new RegExp(`PAXI Point: PEP Jabulani Mall ${run}`));
  assert.match(details, new RegExp(`Point code: P${run}1`));

  detail = await enterTrackingReference(user, shipment.id, { trackingNumber: "PX-778812" });
  assert.equal(detail.shipments[0]!.status, "BOOKED");
  assert.equal(detail.shipments[0]!.trackingNumber, "PX-778812");
  assert.equal(detail.status, "SHIPPED");

  detail = await setShipmentStatus(user, shipment.id, { status: "READY_FOR_COLLECTION" });
  assert.equal(detail.status, "READY_FOR_COLLECTION");
  detail = await setShipmentStatus(user, shipment.id, { status: "DELIVERED" });
  assert.equal(detail.status, "COMPLETED");

  const sent = (await messagesFor(tenant.id)).map((m) => m.dedupeKey.split(":").at(-1));
  assert.deepEqual(sent, ["ORDER_PAID", "BOOKED", "READY_FOR_COLLECTION", "DELIVERED"]);
  const ready = (await messagesFor(tenant.id)).find((m) => m.dedupeKey.endsWith("READY_FOR_COLLECTION"))!;
  assert.match(ready.body, new RegExp(`ready for collection at PEP Jabulani Mall ${run}`));
  assert.equal(ready.status, "SENT");

  // Returning customer: offered the same PAXI point.
  const suggestion = await getReturningSuggestion(order.customerId);
  assert.equal(suggestion?.method, "PAXI_PICKUP");
  assert.equal(suggestion?.pickupLocation?.name, `PEP Jabulani Mall ${run}`);
  await forgetPreferences(tenant.id, order.customerId);
  assert.equal(await getReturningSuggestion(order.customerId), null);
});

test("preferences are not remembered without consent", async () => {
  const { run } = await seedPaxiPoints();
  const { tenant, user } = await createSeller("noconsent");
  await configureProvider(user, "PAXI", { enabled: true, mode: "ASSISTED", config: PAXI_TARIFF });
  const product = await addProduct(user, "Product A", 10_000);
  const [point] = await searchPickupPoints(tenant.id, { text: `Tembisa${run}` });
  const cart = await createCart(tenant.id, "WEB");
  await setCartItem(tenant.id, cart.id, product.id, 1);
  const q = await quoteDelivery(tenant.id, cart.id, { method: "PAXI_PICKUP", locationId: point!.id });
  await selectDeliveryQuote(tenant.id, cart.id, q.options[0]!.quoteId);
  const { order } = await placeOrder(tenant.id, cart.id, { customerName: "Sipho", customerPhone: "0831112222" });
  assert.equal(await getReturningSuggestion(order.customerId), null);
});

const tcgRates = {
  rates: [
    { rate: 89.5, service_level: { id: 1, code: "ECO", name: "Economy", delivery_date_from: "2099-01-05T17:00:00+02:00", delivery_date_to: "2099-01-07T17:00:00+02:00" } },
    { rate: 145, service_level: { id: 2, code: "OVN", name: "Overnight", delivery_date_from: "2099-01-02T17:00:00+02:00", delivery_date_to: "2099-01-02T17:00:00+02:00" } },
  ],
};

test("The Courier Guy door delivery: live rates, pricing rules, booking, tracking sync", async () => {
  const { tenant, user } = await createSeller("tcg");
  await configureProvider(user, "COURIER_GUY", {
    enabled: true,
    mode: "INTEGRATED",
    methods: ["DOOR_COURIER", "SAME_DAY"],
    credentials: { apiKey: "secret-tcg-key" },
    pricingMode: "RATE_PLUS_HANDLING",
    handlingFeeCents: 1000,
    markupBps: 0,
    config: { serviceLevels: { ECO: { name: "Economy" }, OVN: { name: "Fast" } } },
  });
  // Credentials never leave the server.
  const view = (await listDeliverySettings(user)).find((r) => r.provider.code === "COURIER_GUY")!;
  assert.equal(view.hasCredentials, true);
  assert.equal(JSON.stringify(view).includes("secret-tcg-key"), false);
  assert.equal("credentialsEncrypted" in view, false);

  const product = await addProduct(user, "Product B", 25_000);
  const cart = await createCart(tenant.id, "WEB");
  await setCartItem(tenant.id, cart.id, product.id, 1);

  const api = fakeFetch({
    "/v2/rates": tcgRates,
    "/v2/shipments/label": { url: "https://labels.example/1.pdf" },
    "/v2/shipments": { id: 777, short_tracking_reference: "TCG777" },
    "/v2/tracking/shipments": {
      shipments: [{ status: "in-transit", tracking_events: [
        { id: 10, date: "2099-01-01T09:00:00+02:00", status: "collected", message: "Collected" },
        { id: 11, date: "2099-01-01T15:00:00+02:00", status: "in-transit", message: "At hub" },
      ] }],
    },
  });
  setDeliveryFetchForTests(api.fetch);

  const address = { street: "12 Vilakazi St", suburb: "Orlando West", city: "Soweto", postcode: "1804" };
  const now = new Date("2099-01-01T08:00:00Z");
  const door = await quoteDelivery(tenant.id, cart.id, { method: "DOOR_COURIER", address }, now);
  assert.deepEqual(door.options.map((o) => [o.serviceName, o.priceCents]), [["Economy", 8950 + 1000], ["Fast", 14_500 + 1000]]);

  // TCG didn't confirm any same-day service → none offered, alternatives given.
  const same = await quoteDelivery(tenant.id, cart.id, { method: "SAME_DAY", address }, now);
  assert.deepEqual(same.options, []);
  assert.deepEqual(same.alternatives.map((m) => m.method), ["DOOR_COURIER"]);

  await selectDeliveryQuote(tenant.id, cart.id, door.options[0]!.quoteId, now);
  const { order } = await placeOrder(tenant.id, cart.id, { customerName: "Lerato", customerPhone: "0715556666" }, now);
  assert.equal(order.shippingCents, 9950);
  await markOrderPaid(tenant.id, order.id, null);

  let detail = await getOrderDetail(user, order.id);
  assert.equal(detail.shipments[0]!.status, "READY_TO_BOOK");
  assert.equal(detail.shipments[0]!.actions.createShipment, true);

  detail = await createShipment(user, detail.shipments[0]!.id);
  assert.equal(detail.shipments[0]!.trackingNumber, "TCG777");
  assert.equal(detail.shipments[0]!.labelUrl, "https://labels.example/1.pdf");
  assert.equal(detail.shipments[0]!.actions.printLabel, true);

  await syncAllTracking();
  await syncAllTracking(); // re-poll: no duplicate events or messages
  detail = await getOrderDetail(user, order.id);
  assert.equal(detail.shipments[0]!.status, "IN_TRANSIT");
  assert.equal(detail.shipments[0]!.events.filter((e) => e.source === "PROVIDER").length, 2);
  const keys = (await messagesFor(tenant.id)).map((m) => m.dedupeKey.split(":").at(-1));
  assert.deepEqual(keys, ["ORDER_PAID", "BOOKED", "IN_TRANSIT"]);
});

test("free delivery threshold and quote invalidation when the cart changes", async () => {
  await seedPaxiPoints();
  const { tenant, user } = await createSeller("free");
  await configureProvider(user, "PAXI", { enabled: true, mode: "ASSISTED", config: PAXI_TARIFF, freeShippingThresholdCents: 50_000 });
  const product = await addProduct(user, "Product C", 30_000);
  const [point] = await searchPickupPoints(tenant.id, { text: "Jabulani" });
  const cart = await createCart(tenant.id, "WEB");

  await setCartItem(tenant.id, cart.id, product.id, 1);
  let q = await quoteDelivery(tenant.id, cart.id, { method: "PAXI_PICKUP", locationId: point!.id });
  assert.equal(q.options[0]!.priceCents, 5995);
  await selectDeliveryQuote(tenant.id, cart.id, q.options[0]!.quoteId);

  // Adding an item clears the stale delivery price...
  const updated = await setCartItem(tenant.id, cart.id, product.id, 2);
  assert.equal(updated.shippingCents, null);
  await assert.rejects(() => placeOrder(tenant.id, cart.id, { customerName: "A", customerPhone: "0820001111" }), ValidationError);

  // ...and the re-quote reflects the free-delivery threshold.
  q = await quoteDelivery(tenant.id, cart.id, { method: "PAXI_PICKUP", locationId: point!.id });
  assert.equal(q.options[0]!.priceCents, 0);
  assert.equal(q.options[0]!.free, true);
});

test("settings validation rejects unsafe or incomplete configuration", async () => {
  const { user } = await createSeller("settings");
  await assert.rejects(() => configureProvider(user, "COURIER_GUY", { enabled: true, mode: "INTEGRATED" }), /API credentials/);
  await assert.rejects(() => configureProvider(user, "COURIER_GUY", { mode: "ASSISTED" }), /needs API credentials/);
  await assert.rejects(() => configureProvider(user, "PAXI", { enabled: true, mode: "ASSISTED", config: { tariff: [] } }), /PAXI price/);
  await assert.rejects(() => configureProvider(user, "PAXI", { methods: ["DOOR_COURIER"] }), /can't provide/);
  await assert.rejects(() => configureProvider(user, "PAXI", { handlingFeeCents: -5 }), ValidationError);
  await assert.rejects(() => configureProvider(user, "PAXI", { pricingMode: "EXACT", handlingFeeCents: 500 }), /only apply/);
  await assert.rejects(
    () => configureProvider(user, "SELLER_COLLECTION", { enabled: true, dispatchStreet: null }),
    /dispatch address/,
  );
});

test("sellers cannot see or act on another seller's orders", async () => {
  await seedPaxiPoints();
  const a = await createSeller("iso-a");
  const b = await createSeller("iso-b");
  await configureProvider(a.user, "SELLER_COLLECTION", { enabled: true, config: { instructions: "Ring the bell" } });
  const product = await addProduct(a.user, "Product D", 5000);
  const cart = await createCart(a.tenant.id, "WEB");
  await setCartItem(a.tenant.id, cart.id, product.id, 1);
  const q = await quoteDelivery(a.tenant.id, cart.id, { method: "SELLER_COLLECTION" });
  assert.equal(q.options[0]!.priceCents, 0);
  await selectDeliveryQuote(a.tenant.id, cart.id, q.options[0]!.quoteId);
  const { order } = await placeOrder(a.tenant.id, cart.id, { customerName: "Z", customerPhone: "0829990000" });
  await markOrderPaid(a.tenant.id, order.id, null);
  const shipmentId = (await getOrderDetail(a.user, order.id)).shipments[0]!.id;

  await assert.rejects(() => getOrderDetail(b.user, order.id), NotFoundError);
  await assert.rejects(() => setShipmentStatus(b.user, shipmentId, { status: "DELIVERED" }), NotFoundError);
  await assert.rejects(() => shippingDetailsText(b.user, shipmentId), NotFoundError);
  await assert.rejects(() => quoteDelivery(b.tenant.id, cart.id, { method: "SELLER_COLLECTION" }), NotFoundError);
  assert.equal((await exportPaxiRegistrationCsv(b.user)).trim().split("\n").length, 1);
});
