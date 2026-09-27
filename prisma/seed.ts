// Development seed: a demo shop with PAXI (assisted), own delivery and
// collection switched on, a few products, and a SAMPLE PAXI Point
// directory.
//
// The directory below is demo data with DEMO-* codes and approximate
// coordinates — not PAXI's official list. In production, load the real
// directory via POST /api/v1/admin/delivery-locations/import (or run
// PAXI in integrated mode, where points come from the PAXI API).
//
//   DATABASE_URL=... DELIVERY_CREDENTIALS_KEY=... npm run db:seed
import { db } from "../src/server/db.ts";
import { hashPassword } from "../src/server/services/auth.ts";
import { ensureDeliveryProviderCatalogue, ensureTenantDeliveryProviders } from "../src/server/services/delivery-catalogue.ts";
import { importLocations } from "../src/server/services/locations.ts";
import type { Prisma } from "@prisma/client";

const SAMPLE_POINTS = [
  ["DEMO-001", "PEP Jabulani Mall", "Jabulani", "Soweto", "1868", -26.2485, 27.8514],
  ["DEMO-002", "PEP Maponya Mall", "Pimville", "Soweto", "1809", -26.2614, 27.8845],
  ["DEMO-003", "PEP Protea Glen", "Protea Glen", "Soweto", "1819", -26.2771, 27.8127],
  ["DEMO-004", "PEP Tembisa Mall", "Tembisa", "Tembisa", "1632", -25.9963, 28.2268],
  ["DEMO-005", "PEP Tembisa Plaza", "Tembisa", "Tembisa", "1632", -25.9850, 28.2275],
  ["DEMO-006", "PEP Mabopane Station", "Mabopane", "Pretoria", "0190", -25.4990, 28.0960],
  ["DEMO-007", "PEP Khayelitsha Mall", "Khayelitsha", "Cape Town", "7784", -34.0350, 18.6780],
  ["DEMO-008", "PEP Pinetown", "Pinetown", "Durban", "3610", -29.8150, 30.8570],
] as const;

async function main() {
  await ensureDeliveryProviderCatalogue();
  await importLocations({
    providerCode: "PAXI",
    locations: SAMPLE_POINTS.map(([externalId, name, suburb, city, postcode, latitude, longitude]) => ({
      externalId,
      code: externalId,
      name,
      suburb,
      city,
      province: city === "Cape Town" ? "Western Cape" : city === "Durban" ? "KwaZulu-Natal" : "Gauteng",
      postcode,
      latitude,
      longitude,
    })),
  });

  const email = "demo@chatcart.test";
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const tenant = await db.tenant.create({ data: { name: "Chatcart Demo", slug: "demo", sellerDisplayName: "Sandile" } });
    user = await db.user.create({ data: { tenantId: tenant.id, email, name: "Sandile Mokoena", passwordHash: await hashPassword("demo-password-123") } });
  }
  const tenantId = user.tenantId;
  await ensureTenantDeliveryProviders(db, tenantId);

  const dispatch = {
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
  const configure = async (code: string, data: Prisma.TenantDeliveryProviderUpdateInput) => {
    const provider = await db.deliveryProvider.findUniqueOrThrow({ where: { code } });
    await db.tenantDeliveryProvider.update({ where: { tenantId_providerId: { tenantId, providerId: provider.id } }, data: { ...dispatch, ...data } });
  };
  await configure("PAXI", {
    enabled: true,
    mode: "ASSISTED",
    config: { tariff: [{ serviceCode: "STANDARD", name: "Standard", rateCents: 5995, etaMinDays: 7, etaMaxDays: 9 }] },
  });
  await configure("OWN_DELIVERY", {
    enabled: true,
    methods: ["DOOR_COURIER", "SAME_DAY"],
    config: { feeCents: 4000, radiusKm: 20, serviceAreas: ["Soweto"], standardDays: 2, sameDay: { enabled: true, feeCents: 7500, cutoffTime: "14:00" } },
  });
  await configure("SELLER_COLLECTION", { enabled: true, config: { feeCents: 0, instructions: "Mon–Sat 9:00–17:00, 1 Market St, Jabulani." } });

  for (const [name, priceCents, weightGrams] of [["Product A", 40_000, 500], ["Honey Sticks", 5_000, 150], ["Rooibos Energy Bites", 12_000, 300]] as const) {
    const existing = await db.product.findFirst({ where: { tenantId, name } });
    if (!existing) await db.product.create({ data: { tenantId, name, priceCents, weightGrams, lengthCm: 20, widthCm: 12, heightCm: 6 } });
  }

  console.log("Seeded demo shop: /shop/demo — seller login demo@chatcart.test / demo-password-123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
