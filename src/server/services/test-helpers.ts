// Shared helpers for integration tests (not itself a *.test.ts file).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import type { FetchLike } from "../delivery/types.ts";
import { getSessionUser, registerSeller } from "./auth.ts";
import { ensureDeliveryProviderCatalogue } from "./delivery-catalogue.ts";
import { updateDeliveryProvider, listDeliverySettings, type UpdateDeliveryProviderInput } from "./delivery-settings.ts";
import { importLocations } from "./locations.ts";
import { createProduct } from "./products.ts";
import { ConsoleWhatsAppSender, setWhatsAppSenderForTests } from "./whatsapp-sender.ts";

export const sender = new ConsoleWhatsAppSender();
setWhatsAppSenderForTests(sender);

export async function createSeller(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const { tenant, sessionToken } = await registerSeller({ shopName: `${label} Shop`, name: "Sandile Mokoena", email, password: "correct-horse-battery" });
  const user = await getSessionUser(sessionToken);
  assert.ok(user);
  return { tenant, user: user! };
}

export const DISPATCH = {
  dispatchStreet: "1 Market St",
  dispatchSuburb: "Jabulani",
  dispatchCity: "Soweto",
  dispatchProvince: "Gauteng",
  dispatchPostcode: "1868",
  dispatchLatitude: -26.2485,
  dispatchLongitude: 27.8514,
  dispatchContactName: "Sandile",
  dispatchContactPhone: "0820000000",
};

export async function configureProvider(user: Awaited<ReturnType<typeof createSeller>>["user"], code: string, input: UpdateDeliveryProviderInput) {
  const row = (await listDeliverySettings(user)).find((r) => r.provider.code === code);
  assert.ok(row, `provider ${code} row`);
  return updateDeliveryProvider(user, row!.id, { ...DISPATCH, ...input });
}

// A small slice of the PAXI Point directory, unique per test run so
// tests never collide on externalId.
export async function seedPaxiPoints() {
  await ensureDeliveryProviderCatalogue();
  const run = randomUUID().slice(0, 8);
  await importLocations({
    providerCode: "PAXI",
    locations: [
      { externalId: `JAB-${run}`, code: `P${run}1`, name: `PEP Jabulani Mall ${run}`, suburb: "Jabulani", city: "Soweto", province: "Gauteng", postcode: "1868", latitude: -26.2485, longitude: 27.8514 },
      { externalId: `MAP-${run}`, code: `P${run}2`, name: `PEP Maponya Mall ${run}`, suburb: "Pimville", city: "Soweto", province: "Gauteng", postcode: "1809", latitude: -26.2614, longitude: 27.8845 },
      { externalId: `TEM-${run}`, code: `P${run}3`, name: `PEP Tembisa Mall ${run}`, suburb: `Tembisa${run}`, city: "Tembisa", province: "Gauteng", postcode: "1632", latitude: -25.9963, longitude: 28.2268 },
    ],
  });
  return run;
}

export async function addProduct(user: Awaited<ReturnType<typeof createSeller>>["user"], name: string, priceCents: number) {
  return createProduct(user, { name, priceCents, weightGrams: 400, lengthCm: 20, widthCm: 10, heightCm: 5 });
}

export function fakeFetch(routes: Record<string, unknown>): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200 });
    },
  };
}

export async function messagesFor(tenantId: string) {
  return db.outboundMessage.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}
