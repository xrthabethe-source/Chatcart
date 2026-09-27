// Platform courier catalogue (delivery_providers) and each seller's
// per-provider settings rows (tenant_delivery_providers).
import { z } from "zod";
import { db, type DbClient } from "../db.ts";
import { getDeliveryAdapter, isRegisteredProviderCode } from "../delivery/registry.ts";
import type { DeliveryMethod } from "../delivery/types.ts";
import { ValidationError, zodMessage } from "./errors.ts";

interface CatalogueEntry {
  code: string;
  name: string;
  defaultMethods: DeliveryMethod[];
}

// Built-in providers, in the order sellers see them in Delivery Settings.
export const BUILT_IN_PROVIDERS: CatalogueEntry[] = [
  { code: "PAXI", name: "PEP / PAXI", defaultMethods: ["PAXI_PICKUP"] },
  { code: "COURIER_GUY", name: "The Courier Guy", defaultMethods: ["DOOR_COURIER", "SAME_DAY"] },
  { code: "LOCAL_COURIER", name: "Same-day courier", defaultMethods: ["SAME_DAY"] },
  { code: "OWN_DELIVERY", name: "Own delivery", defaultMethods: ["DOOR_COURIER"] },
  { code: "SELLER_COLLECTION", name: "Customer collection", defaultMethods: ["SELLER_COLLECTION"] },
];

export function defaultMethodsFor(code: string): DeliveryMethod[] {
  return BUILT_IN_PROVIDERS.find((p) => p.code === code)?.defaultMethods ?? (code.startsWith("LOCAL_COURIER") ? ["SAME_DAY"] : []);
}

function capabilities(code: string, name: string) {
  const adapter = getDeliveryAdapter(code, name);
  return {
    supportsPickupPoints: adapter.supportsPickupPoints(),
    supportsDoorDelivery: adapter.supportsDoorDelivery(),
    supportsSameDay: adapter.supportsSameDay(),
  };
}

/** Idempotently makes sure every built-in provider row exists. */
export async function ensureDeliveryProviderCatalogue(client: DbClient = db) {
  for (const entry of BUILT_IN_PROVIDERS) {
    await client.deliveryProvider.upsert({
      where: { code: entry.code },
      update: capabilities(entry.code, entry.name),
      create: { code: entry.code, name: entry.name, ...capabilities(entry.code, entry.name) },
    });
  }
}

/** Gives a tenant a (disabled) settings row for every active provider. */
export async function ensureTenantDeliveryProviders(client: DbClient, tenantId: string) {
  await ensureDeliveryProviderCatalogue(client);
  const providers = await client.deliveryProvider.findMany({ where: { active: true } });
  for (const provider of providers) {
    await client.tenantDeliveryProvider.upsert({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      update: {},
      create: {
        tenantId,
        providerId: provider.id,
        enabled: false,
        methods: defaultMethodsFor(provider.code),
        mode: getDeliveryAdapter(provider.code, provider.name).supportsAssistedMode() ? "ASSISTED" : "INTEGRATED",
      },
    });
  }
}

export const addProviderSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^LOCAL_COURIER_[A-Z0-9_]{2,30}$/, "Code must look like LOCAL_COURIER_<NAME>."),
  name: z.string().trim().min(2).max(60),
});

/**
 * Platform admin: register an additional same-day courier that speaks the
 * local-courier contract (see delivery/providers/local-courier.ts).
 */
export async function addSameDayProvider(input: z.input<typeof addProviderSchema>) {
  const parsed = addProviderSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  if (!isRegisteredProviderCode(parsed.data.code)) throw new ValidationError("Unsupported provider code.");
  const provider = await db.deliveryProvider.upsert({
    where: { code: parsed.data.code },
    update: { name: parsed.data.name, active: true },
    create: { code: parsed.data.code, name: parsed.data.name, ...capabilities(parsed.data.code, parsed.data.name) },
  });
  const tenants = await db.tenant.findMany({ select: { id: true } });
  for (const t of tenants) await ensureTenantDeliveryProviders(db, t.id);
  return provider;
}

export async function listDeliveryProviderCatalogue() {
  return db.deliveryProvider.findMany({ orderBy: { createdAt: "asc" } });
}
