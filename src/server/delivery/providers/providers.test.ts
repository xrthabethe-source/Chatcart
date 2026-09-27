import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike, ProviderContext, RateRequest, StoredLocation } from "../types.ts";
import { CourierGuyDeliveryProvider, mapCourierGuyStatus } from "./courier-guy.ts";
import { LocalCourierProvider } from "./local-courier.ts";
import { OwnDeliveryProvider } from "./own-delivery.ts";
import { PaxiDeliveryProvider, mapPaxiStatus } from "./paxi.ts";

// Monday 2026-09-28, 10:00 SAST
const NOW = new Date("2026-09-28T08:00:00Z");

const origin = { street: "1 Market St", suburb: "Jabulani", city: "Soweto", province: "Gauteng", postcode: "1868", latitude: -26.2485, longitude: 27.8514 };
const home = { street: "12 Vilakazi St", suburb: "Orlando West", city: "Soweto", postcode: "1804", latitude: -26.2386, longitude: 27.9086 };
const parcel = { lengthCm: 30, widthCm: 20, heightCm: 15, weightGrams: 1200 };
const point: StoredLocation = { id: "loc-1", externalId: "P123", code: "PX123", name: "PEP Jabulani Mall", suburb: "Jabulani", city: "Soweto" };

function recorder(responses: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchFn };
}

function ctx(partial: Partial<ProviderContext>): ProviderContext {
  return { mode: "INTEGRATED", credentials: null, config: {}, fetch: async () => new Response("{}"), ...partial };
}

function rateRequest(method: RateRequest["method"], overrides: Partial<RateRequest> = {}): RateRequest {
  return {
    method,
    origin,
    destination: method === "PAXI_PICKUP" ? { kind: "PICKUP_POINT", location: point } : { kind: "ADDRESS", address: home },
    parcel,
    declaredValueCents: 80_000,
    readyAt: NOW,
    now: NOW,
    ...overrides,
  };
}

// ─── PAXI ────────────────────────────────────────────────────────────

test("PAXI assisted: rates come from the seller's tariff, search from the directory", async () => {
  const paxi = new PaxiDeliveryProvider();
  const searched: unknown[] = [];
  const c = ctx({
    mode: "ASSISTED",
    config: { tariff: [{ serviceCode: "STD", name: "Standard", rateCents: 6995, etaMinDays: 7, etaMaxDays: 9 }], maxParcelWeightGrams: 5000 },
    directory: { search: async (q) => (searched.push(q), [point]) },
  });
  const rates = await paxi.getRates(c, rateRequest("PAXI_PICKUP"));
  assert.deepEqual(rates.map((r) => [r.serviceCode, r.rateCents, r.etaLabel]), [["STD", 6995, "7-9 working days"]]);
  assert.deepEqual(await paxi.searchLocations(c, { text: "Tembisa" }), [point]);
  assert.equal(searched.length, 1);

  // Over PAXI's parcel limit → not offered at all.
  assert.deepEqual(await paxi.getRates(c, rateRequest("PAXI_PICKUP", { parcel: { ...parcel, weightGrams: 6000 } })), []);
  // Assisted mode can't book automatically.
  await assert.rejects(() => paxi.createShipment(c, {} as never), /without API credentials/);
});

test("PAXI assisted with no tariff offers nothing rather than a guessed price", async () => {
  const rates = await new PaxiDeliveryProvider().getRates(ctx({ mode: "ASSISTED", config: {} }), rateRequest("PAXI_PICKUP"));
  assert.deepEqual(rates, []);
});

test("PAXI integrated: locations and rates come from the API", async () => {
  const { calls, fetchFn } = recorder({
    "/points": { points: [{ id: 991, pointCode: "PX991", storeName: "PEP Maponya Mall", suburb: "Pimville", city: "Soweto", lat: -26.2614, lng: 27.8845 }] },
    "/rates": { rates: [{ serviceCode: "FAST", name: "Fast", price: 109.95, minDays: 3, maxDays: 5 }] },
  });
  const c = ctx({ credentials: { apiKey: "k" }, config: { api: { baseUrl: "https://paxi.example/api" } }, fetch: fetchFn });
  const paxi = new PaxiDeliveryProvider();
  const locations = await paxi.searchLocations(c, { near: { latitude: -26.25, longitude: 27.87 } });
  assert.deepEqual(locations[0], {
    externalId: "991", code: "PX991", name: "PEP Maponya Mall", address: null, suburb: "Pimville", city: "Soweto",
    province: null, postcode: null, latitude: -26.2614, longitude: 27.8845, kind: "PICKUP_POINT",
  });
  const rates = await paxi.getRates(c, rateRequest("PAXI_PICKUP"));
  assert.deepEqual(rates.map((r) => [r.serviceCode, r.rateCents, r.etaLabel]), [["FAST", 10_995, "3-5 working days"]]);
  assert.equal(new Headers(calls[0]!.init!.headers).get("Authorization"), "Bearer k");
});

test("PAXI status mapping distinguishes 'collected by customer' from courier collection", () => {
  assert.equal(mapPaxiStatus("Parcel collected by customer"), "DELIVERED");
  assert.equal(mapPaxiStatus("Ready for collection"), "READY_FOR_COLLECTION");
  assert.equal(mapPaxiStatus("In transit"), "IN_TRANSIT");
  assert.equal(mapPaxiStatus("Dropped off at PEP"), "COLLECTED");
  assert.equal(mapPaxiStatus("something odd"), null);
});

// ─── The Courier Guy ─────────────────────────────────────────────────

const tcgRates = {
  rates: [
    { rate: 89.5, service_level: { id: 1, code: "ECO", name: "Economy", delivery_date_from: "2026-09-30T17:00:00+02:00", delivery_date_to: "2026-10-02T17:00:00+02:00" } },
    { rate: 145, service_level: { id: 2, code: "OVN", name: "Overnight Courier", delivery_date_from: "2026-09-29T17:00:00+02:00", delivery_date_to: "2026-09-29T17:00:00+02:00" } },
    { rate: 210, service_level: { id: 3, code: "SDX", name: "Same Day Express", delivery_date_from: "2026-09-28T17:00:00+02:00", delivery_date_to: "2026-09-28T17:00:00+02:00" } },
    { rate: 60, service_level: { id: 4, code: "LOX", name: "Locker to Locker", delivery_date_from: "2026-09-30T17:00:00+02:00", delivery_date_to: "2026-10-01T17:00:00+02:00" } },
  ],
};
const tcgConfig = { serviceLevels: { ECO: { name: "Economy" }, OVN: { name: "Fast" }, LOX: { name: "Locker", kind: "LOCKER" } } };

test("TCG door delivery: provider rates, simple names, no same-day or locker services", async () => {
  const { calls, fetchFn } = recorder({ "/v2/rates": tcgRates });
  const tcg = new CourierGuyDeliveryProvider();
  const rates = await tcg.getRates(ctx({ credentials: { apiKey: "tcg" }, config: tcgConfig, fetch: fetchFn }), rateRequest("DOOR_COURIER"));
  assert.deepEqual(
    rates.map((r) => [r.serviceName, r.rateCents, r.etaLabel]),
    [["Economy", 8950, "2-4 working days"], ["Fast", 14_500, "Next working day"]],
  );
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.delivery_address.local_area, "Orlando West");
  assert.equal(body.parcels[0].submitted_weight_kg, 1.2);
});

test("TCG same-day is offered only when TCG says it delivers today", async () => {
  const { fetchFn } = recorder({ "/v2/rates": tcgRates });
  const tcg = new CourierGuyDeliveryProvider();
  const c = ctx({ credentials: { apiKey: "tcg" }, config: tcgConfig, fetch: fetchFn });
  const today = await tcg.getRates(c, rateRequest("SAME_DAY"));
  assert.deepEqual(today.map((r) => [r.serviceCode, r.serviceName, r.etaLabel, r.rateCents]), [["SDX", "Same day", "Today", 21_000]]);

  const { fetchFn: late } = recorder({ "/v2/rates": { rates: tcgRates.rates.filter((r) => r.service_level.code !== "SDX") } });
  assert.deepEqual(await tcg.getRates({ ...c, fetch: late }, rateRequest("SAME_DAY")), []);
});

test("TCG is unavailable without an API key (never quoted in assisted mode)", async () => {
  await assert.rejects(() => new CourierGuyDeliveryProvider().getRates(ctx({ mode: "ASSISTED" }), rateRequest("DOOR_COURIER")), /API key/);
});

test("TCG createShipment, tracking and cancellation", async () => {
  const { calls, fetchFn } = recorder({
    "/v2/shipments/label": { url: "https://labels.example/abc.pdf" },
    "/v2/shipments/cancel": {},
    "/v2/shipments": { id: 5501, short_tracking_reference: "TCG5501", estimated_delivery_to: "2026-10-01T17:00:00+02:00" },
    "/v2/tracking/shipments": {
      shipments: [{
        status: "out-for-delivery",
        estimated_delivery_to: "2026-09-29T17:00:00+02:00",
        tracking_events: [
          { id: 2, date: "2026-09-29T07:00:00+02:00", status: "out-for-delivery", message: "Out for delivery" },
          { id: 1, date: "2026-09-28T15:00:00+02:00", status: "collected", message: "Collected" },
        ],
      }],
    },
  });
  const tcg = new CourierGuyDeliveryProvider();
  const c = ctx({ credentials: { apiKey: "tcg" }, config: { trackingUrlTemplate: "https://track.example/?ref={ref}" }, fetch: fetchFn });
  const created = await tcg.createShipment(c, {
    orderNumber: "SHS-1049", serviceCode: "ECO", origin, sender: { name: "Seller", phone: "0820000000" },
    destination: { kind: "ADDRESS", address: home }, recipient: { name: "Thandi", phone: "27821234567" },
    parcel, declaredValueCents: 80_000, readyAt: NOW,
  });
  assert.equal(created.trackingNumber, "TCG5501");
  assert.equal(created.labelUrl, "https://labels.example/abc.pdf");
  assert.equal(created.trackingUrl, "https://track.example/?ref=TCG5501");
  assert.equal(JSON.parse(String(calls[0]!.init!.body)).customer_reference, "SHS-1049");

  const tracking = await tcg.getTracking(c, { trackingNumber: "TCG5501", providerShipmentRef: "5501" });
  assert.equal(tracking.status, "OUT_FOR_DELIVERY");
  assert.deepEqual(tracking.events.map((e) => [e.status, e.dedupeKey]), [["COLLECTED", "1"], ["OUT_FOR_DELIVERY", "2"]]);

  await tcg.cancelShipment(c, { trackingNumber: "TCG5501", providerShipmentRef: "5501" });
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init!.body)), { tracking_reference: "TCG5501" });
});

test("TCG status mapping", () => {
  assert.equal(mapCourierGuyStatus("in-transit"), "IN_TRANSIT");
  assert.equal(mapCourierGuyStatus("delivered"), "DELIVERED");
  assert.equal(mapCourierGuyStatus("collection-exception"), "EXCEPTION");
  assert.equal(mapCourierGuyStatus("mystery"), null);
});

// ─── Same-day: local courier + own delivery ──────────────────────────

test("local courier same-day needs the courier's explicit confirmation", async () => {
  const courier = new LocalCourierProvider();
  const cfg = { credentials: { apiKey: "lc" }, config: { baseUrl: "https://courier.example" } };
  const yes = recorder({ "/quotes": { available: true, options: [{ code: "SD", name: "Same day", priceCents: 9900, deliverBy: "2026-09-28T17:00:00+02:00" }] } });
  assert.equal((await courier.getRates(ctx({ ...cfg, fetch: yes.fetchFn }), rateRequest("SAME_DAY"))).length, 1);

  const no = recorder({ "/quotes": { available: false, options: [{ code: "SD", priceCents: 9900 }] } });
  assert.deepEqual(await courier.getRates(ctx({ ...cfg, fetch: no.fetchFn }), rateRequest("SAME_DAY")), []);

  const tomorrow = recorder({ "/quotes": { available: true, options: [{ code: "SD", priceCents: 9900, deliverBy: "2026-09-29T12:00:00+02:00" }] } });
  assert.deepEqual(await courier.getRates(ctx({ ...cfg, fetch: tomorrow.fetchFn }), rateRequest("SAME_DAY")), []);
});

test("own delivery: service area and same-day cut-off", async () => {
  const own = new OwnDeliveryProvider();
  const config = { feeCents: 3500, radiusKm: 15, sameDay: { enabled: true, feeCents: 6000, cutoffTime: "13:00" } };
  const c = ctx({ mode: "ASSISTED", config });
  assert.equal((await own.getRates(c, rateRequest("DOOR_COURIER")))[0]!.rateCents, 3500);
  assert.equal((await own.getRates(c, rateRequest("SAME_DAY")))[0]!.etaLabel, "Today");

  const afterCutoff = new Date("2026-09-28T11:30:00Z"); // 13:30 SAST
  assert.deepEqual(await own.getRates(c, rateRequest("SAME_DAY", { now: afterCutoff, readyAt: afterCutoff })), []);

  const far = { ...home, latitude: -33.92, longitude: 18.42 }; // Cape Town
  assert.deepEqual(await own.getRates(c, rateRequest("DOOR_COURIER", { destination: { kind: "ADDRESS", address: far } })), []);

  // No coordinates and not a listed area → not offered (no guessing).
  const unknown = { ...home, latitude: null, longitude: null };
  assert.deepEqual(await own.getRates(c, rateRequest("DOOR_COURIER", { destination: { kind: "ADDRESS", address: unknown } })), []);
  const listed = ctx({ mode: "ASSISTED", config: { ...config, serviceAreas: ["Orlando West"] } });
  assert.equal((await own.getRates(listed, rateRequest("DOOR_COURIER", { destination: { kind: "ADDRESS", address: unknown } }))).length, 1);
});
