import assert from "node:assert/strict";
import { test } from "node:test";
import { addWorkingDays, etaLabel, sastDate, workingDaysBetween } from "./dates.ts";
import { distanceKm, formatDistance } from "./geo.ts";
import { calculateParcel } from "./packaging.ts";
import { assertValidPricingConfig, customerShippingPrice, InvalidPricingConfigError } from "./pricing.ts";
import { advanceStatus } from "./status.ts";
import { renderTrackingSummary } from "./messages.ts";

const exact = { pricingMode: "EXACT" as const, handlingFeeCents: 0, markupBps: 0, freeShippingThresholdCents: null };

test("customer pays the exact courier rate", () => {
  assert.equal(customerShippingPrice(8950, 50_000, exact).priceCents, 8950);
});

test("courier rate + handling adds markup and handling fee", () => {
  const price = customerShippingPrice(10_000, 50_000, { pricingMode: "RATE_PLUS_HANDLING", handlingFeeCents: 1500, markupBps: 1000, freeShippingThresholdCents: null });
  assert.equal(price.priceCents, 10_000 + 1000 + 1500);
});

test("free delivery over the threshold wins over any mode", () => {
  const cfg = { pricingMode: "RATE_PLUS_HANDLING" as const, handlingFeeCents: 1500, markupBps: 0, freeShippingThresholdCents: 50_000 };
  assert.deepEqual(
    [customerShippingPrice(9000, 49_999, cfg).priceCents, customerShippingPrice(9000, 50_000, cfg).priceCents],
    [10_500, 0],
  );
  assert.equal(customerShippingPrice(9000, 50_000, cfg).free, true);
});

test("negative or ambiguous pricing configuration is rejected", () => {
  assert.throws(() => assertValidPricingConfig({ ...exact, handlingFeeCents: -1 }), InvalidPricingConfigError);
  assert.throws(() => assertValidPricingConfig({ ...exact, freeShippingThresholdCents: -100 }), InvalidPricingConfigError);
  // EXACT with a handling fee is ambiguous — which one applies?
  assert.throws(() => assertValidPricingConfig({ ...exact, handlingFeeCents: 500 }), /only apply/);
  assert.throws(() => customerShippingPrice(-1, 0, exact), InvalidPricingConfigError);
});

const defaults = { defaultParcelLengthCm: 30, defaultParcelWidthCm: 20, defaultParcelHeightCm: 15, defaultParcelWeightGrams: 1000 };

test("packaging stacks fully-dimensioned items", () => {
  const parcel = calculateParcel(
    [
      { quantity: 2, weightGrams: 300, lengthCm: 10, widthCm: 20, heightCm: 5 },
      { quantity: 1, weightGrams: 500, lengthCm: 25, widthCm: 15, heightCm: 10 },
    ],
    defaults,
  );
  // dims sorted desc per item: [20,10,5]x2 and [25,15,10]
  assert.deepEqual(parcel, { lengthCm: 25, widthCm: 15, heightCm: 5 * 2 + 10, weightGrams: 300 * 2 + 500 + 100 });
});

test("packaging falls back to the default parcel when dimensions are missing", () => {
  const parcel = calculateParcel([{ quantity: 3, weightGrams: 800, lengthCm: null, widthCm: null, heightCm: null }], defaults);
  assert.deepEqual(parcel, { lengthCm: 30, widthCm: 20, heightCm: 15, weightGrams: 2500 });
});

test("working-day maths is in SAST and skips weekends", () => {
  // Friday 2026-09-25 16:00 SAST
  const friday = new Date("2026-09-25T14:00:00Z");
  assert.equal(sastDate(new Date("2026-09-25T22:30:00Z")), "2026-09-26"); // after SAST midnight
  assert.equal(sastDate(addWorkingDays(friday, 1)), "2026-09-28"); // Monday
  assert.equal(workingDaysBetween(friday, new Date("2026-09-29T08:00:00Z")), 2);
  assert.equal(etaLabel(2, 4), "2-4 working days");
  assert.equal(etaLabel(0, 0), "Today");
});

test("distance and its label", () => {
  const jabulani = { latitude: -26.2485, longitude: 23.8514 + 4 };
  assert.equal(distanceKm(jabulani, jabulani), 0);
  const d = distanceKm({ latitude: -26.2485, longitude: 27.8514 }, { latitude: -26.2595, longitude: 27.8514 });
  assert.ok(d > 1.1 && d < 1.3);
  assert.equal(formatDistance(1.234), "1.2 km away");
  assert.equal(formatDistance(0.42), "400 m away");
});

test("shipment status only moves forward, except problems", () => {
  assert.equal(advanceStatus("IN_TRANSIT", "BOOKED"), "IN_TRANSIT"); // stale replay
  assert.equal(advanceStatus("BOOKED", "IN_TRANSIT"), "IN_TRANSIT");
  assert.equal(advanceStatus("IN_TRANSIT", "EXCEPTION"), "EXCEPTION");
  assert.equal(advanceStatus("EXCEPTION", "OUT_FOR_DELIVERY"), "OUT_FOR_DELIVERY");
  assert.equal(advanceStatus("DELIVERED", "IN_TRANSIT"), "DELIVERED");
});

test("tracking summary matches the WhatsApp copy", () => {
  const text = renderTrackingSummary({
    shopName: "Sandile's Shop",
    orderNumber: "SHS-1048",
    providerCode: "PAXI",
    providerName: "PEP / PAXI",
    status: "IN_TRANSIT",
    destination: { kind: "PICKUP_POINT", location: { id: "x", externalId: "P1", name: "PEP Jabulani Mall" } },
    trackingNumber: null,
    trackingUrl: null,
    expectedDeliveryAt: null,
    now: new Date(),
  });
  assert.equal(
    text,
    "📦 Order SHS-1048\nCourier: PAXI\nDestination: PEP Jabulani Mall\nStatus: In transit\n\nWe'll message you when it is ready for collection.",
  );
});
