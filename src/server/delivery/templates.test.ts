import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fillTemplate, shipmentTemplate, WHATSAPP_TEMPLATES, type ShipmentSummaryInput } from "./messages.ts";
import { NOTIFY_ON } from "./status.ts";

const summary: ShipmentSummaryInput = {
  orderNumber: "SHS-1048",
  providerCode: "PAXI",
  providerName: "PEP / PAXI",
  status: "BOOKED",
  destination: { kind: "PICKUP_POINT", location: { id: "x", externalId: "P1", name: "PEP Jabulani Mall" } },
  trackingNumber: "PX-1",
  trackingUrl: null,
  expectedDeliveryAt: null,
  now: new Date(),
};

test("every notified status has a template whose placeholders match its parameters", () => {
  for (const status of NOTIFY_ON) {
    const t = shipmentTemplate({ ...summary, status });
    assert.ok(t, `template for ${status}`);
    const spec = WHATSAPP_TEMPLATES[t!.name];
    assert.ok(spec, `spec for ${t!.name}`);
    const placeholders = new Set([...spec!.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
    assert.equal(placeholders.size, t!.params.length, `${t!.name}: {{n}} count vs params`);
    assert.equal(spec!.example.length, t!.params.length, `${t!.name}: sample values`);
    assert.ok(t!.params.every((p) => p.trim().length > 0), `${t!.name}: no empty params (Meta rejects them)`);
  }
});

test("templates follow Meta's rules: no variable at the very start or end, none adjacent", () => {
  for (const t of Object.values(WHATSAPP_TEMPLATES)) {
    assert.doesNotMatch(t.body, /^\{\{\d+\}\}/, t.name);
    assert.doesNotMatch(t.body, /\{\{\d+\}\}$/, t.name);
    assert.doesNotMatch(t.body, /\}\}\s*\{\{/, t.name);
    assert.match(t.name, /^[a-z0-9_]+$/, t.name);
  }
});

test("docs/whatsapp-templates.md is up to date with the code", () => {
  const doc = readFileSync(new URL("../../../docs/whatsapp-templates.md", import.meta.url), "utf8");
  for (const t of Object.values(WHATSAPP_TEMPLATES)) {
    assert.ok(doc.includes("```\n" + t.body + "\n```"), `${t.name} body in docs — run scripts/generate-template-doc.ts`);
  }
});

test("a filled template reads naturally", () => {
  const t = shipmentTemplate({ ...summary, status: "READY_FOR_COLLECTION" })!;
  assert.equal(
    fillTemplate(WHATSAPP_TEMPLATES[t.name]!.body, t.params),
    "🎉 Order SHS-1048 is ready for collection at PEP Jabulani Mall. Take your ID and this order number with you.",
  );
});
