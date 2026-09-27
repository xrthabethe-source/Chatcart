// Seller "Delivery Settings": per-provider enablement, credentials,
// pricing, dispatch address, default parcel and handling time.
import { z } from "zod";
import { db, type DbClient } from "../db.ts";
import { decryptCredentials, encryptCredentials } from "../delivery/credentials.ts";
import { assertValidPricingConfig, InvalidPricingConfigError } from "../delivery/pricing.ts";
import { getDeliveryAdapter } from "../delivery/registry.ts";
import type { DeliveryMethod, DeliveryProvider, FetchLike, ProviderContext, StreetAddress } from "../delivery/types.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { NotFoundError, ValidationError, zodMessage } from "./errors.ts";
import { directoryFor } from "./locations.ts";
import type { Prisma } from "@prisma/client";

type TdpWithProvider = Prisma.TenantDeliveryProviderGetPayload<{ include: { provider: true } }>;

const METHOD_VALUES = ["PAXI_PICKUP", "DOOR_COURIER", "SAME_DAY", "SELLER_COLLECTION"] as const;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

export const updateDeliveryProviderSchema = z
  .object({
    enabled: z.boolean(),
    methods: z.array(z.enum(METHOD_VALUES)).max(4),
    mode: z.enum(["INTEGRATED", "ASSISTED"]),
    // undefined = keep existing, null = clear, object = replace.
    credentials: z.record(z.string(), z.string().trim().min(1).max(500)).nullable(),
    pricingMode: z.enum(["EXACT", "RATE_PLUS_HANDLING"]),
    handlingFeeCents: z.number().int().min(0).max(1_000_000),
    markupBps: z.number().int().min(0).max(10_000),
    freeShippingThresholdCents: z.number().int().min(0).max(100_000_000).nullable(),
    dispatchStreet: optionalText(200),
    dispatchSuburb: optionalText(100),
    dispatchCity: optionalText(100),
    dispatchProvince: optionalText(100),
    dispatchPostcode: optionalText(10),
    dispatchLatitude: z.number().min(-90).max(90).nullable(),
    dispatchLongitude: z.number().min(-180).max(180).nullable(),
    dispatchContactName: optionalText(100),
    dispatchContactPhone: optionalText(30),
    defaultParcelLengthCm: z.number().int().min(1).max(300),
    defaultParcelWidthCm: z.number().int().min(1).max(300),
    defaultParcelHeightCm: z.number().int().min(1).max(300),
    defaultParcelWeightGrams: z.number().int().min(1).max(100_000),
    handlingTimeDays: z.number().int().min(0).max(30),
    config: z.record(z.string(), z.unknown()),
  })
  .partial();
export type UpdateDeliveryProviderInput = z.input<typeof updateDeliveryProviderSchema>;

export function toSettingsView(row: TdpWithProvider) {
  const { credentialsEncrypted, ...rest } = row;
  const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
  return {
    ...rest,
    hasCredentials: !!credentialsEncrypted,
    capabilities: {
      pickupPoints: adapter.supportsPickupPoints(),
      doorDelivery: adapter.supportsDoorDelivery(),
      sameDay: adapter.supportsSameDay(),
      assistedMode: adapter.supportsAssistedMode(),
    },
  };
}
export type DeliveryProviderSettingsView = ReturnType<typeof toSettingsView>;

export async function listDeliverySettings(user: AuthenticatedUser) {
  const rows = await db.tenantDeliveryProvider.findMany({
    where: { tenantId: user.tenantId, provider: { active: true } },
    include: { provider: true },
    orderBy: { provider: { createdAt: "asc" } },
  });
  return rows.map(toSettingsView);
}

function supportedMethods(adapter: DeliveryProvider, code: string): DeliveryMethod[] {
  const methods: DeliveryMethod[] = [];
  if (adapter.supportsPickupPoints()) methods.push("PAXI_PICKUP");
  if (adapter.supportsDoorDelivery()) methods.push("DOOR_COURIER");
  if (adapter.supportsSameDay()) methods.push("SAME_DAY");
  if (code === "SELLER_COLLECTION") methods.push("SELLER_COLLECTION");
  return methods;
}

export async function updateDeliveryProvider(user: AuthenticatedUser, tenantDeliveryProviderId: string, input: UpdateDeliveryProviderInput) {
  const parsed = updateDeliveryProviderSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const patch = parsed.data;

  const existing = await db.tenantDeliveryProvider.findFirst({
    where: { id: tenantDeliveryProviderId, tenantId: user.tenantId },
    include: { provider: true },
  });
  if (!existing) throw new NotFoundError("Delivery provider");
  const adapter = getDeliveryAdapter(existing.provider.code, existing.provider.name);

  const { credentials, config, ...scalar } = patch;
  const next = { ...existing, ...scalar, config: config ?? (existing.config as Record<string, unknown>) };

  // Validate the merged result, not just the patch.
  const allowed = supportedMethods(adapter, existing.provider.code);
  const unsupported = next.methods.filter((m) => !allowed.includes(m));
  if (unsupported.length) throw new ValidationError(`${existing.provider.name} can't provide: ${unsupported.join(", ")}.`);
  if (next.mode === "ASSISTED" && !adapter.supportsAssistedMode()) {
    throw new ValidationError(`${existing.provider.name} needs API credentials (integrated mode).`);
  }
  try {
    assertValidPricingConfig(next);
  } catch (error) {
    if (error instanceof InvalidPricingConfigError) throw new ValidationError(error.message);
    throw error;
  }

  // A provider that's switched off may hold half-filled settings (the
  // seller is still setting it up); it must be valid before it goes on.
  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = adapter.parseConfig(next.config);
  } catch (error) {
    if (next.enabled) {
      const message = error instanceof z.ZodError ? zodMessage(error) : (error as Error).message;
      throw new ValidationError(`${existing.provider.name} settings: ${message}`);
    }
    parsedConfig = next.config;
  }
  if (JSON.stringify(parsedConfig).length > 20_000) throw new ValidationError("Settings are too large.");

  const credentialsEncrypted =
    credentials === undefined ? existing.credentialsEncrypted : credentials === null ? null : encryptCredentials(credentials);

  if (next.enabled) {
    if (next.methods.length === 0) throw new ValidationError("Choose at least one delivery option for this provider.");
    if (next.mode === "INTEGRATED" && !credentialsEncrypted) {
      throw new ValidationError(`Add your ${existing.provider.name} API credentials, or use assisted mode.`);
    }
    if (!next.dispatchStreet || !next.dispatchSuburb || !next.dispatchCity || !next.dispatchPostcode) {
      throw new ValidationError("Add your pickup/dispatch address (street, suburb, city and postcode).");
    }
    if (existing.provider.code === "PAXI" && next.mode === "ASSISTED" && ((parsedConfig.tariff as unknown[]) ?? []).length === 0) {
      throw new ValidationError("Add at least one PAXI price (e.g. Standard) so customers see a delivery cost.");
    }
  }

  const updated = await db.tenantDeliveryProvider.update({
    where: { id: existing.id },
    data: { ...scalar, config: parsedConfig as Prisma.InputJsonValue, credentialsEncrypted },
    include: { provider: true },
  });
  return toSettingsView(updated);
}

// ─── Used by checkout / shipments ─────────────────────────────────────

export function dispatchAddress(row: TdpWithProvider | Prisma.TenantDeliveryProviderGetPayload<object>): StreetAddress | null {
  if (!row.dispatchStreet || !row.dispatchSuburb || !row.dispatchCity || !row.dispatchPostcode) return null;
  return {
    recipientName: row.dispatchContactName,
    phone: row.dispatchContactPhone,
    street: row.dispatchStreet,
    suburb: row.dispatchSuburb,
    city: row.dispatchCity,
    province: row.dispatchProvince,
    postcode: row.dispatchPostcode,
    latitude: row.dispatchLatitude,
    longitude: row.dispatchLongitude,
  };
}

// Tests swap this to replay recorded courier responses.
let fetchImpl: FetchLike = (input, init) => fetch(input, init);
export function setDeliveryFetchForTests(fn: FetchLike | null) {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

export function providerContext(row: TdpWithProvider, client: DbClient = db): ProviderContext {
  return {
    mode: row.mode,
    credentials: decryptCredentials(row.credentialsEncrypted),
    config: (row.config ?? {}) as Record<string, unknown>,
    directory: directoryFor(row.providerId, client),
    fetch: fetchImpl,
  };
}

export async function enabledProvidersFor(tenantId: string, method?: DeliveryMethod, client: DbClient = db) {
  return client.tenantDeliveryProvider.findMany({
    where: { tenantId, enabled: true, provider: { active: true }, ...(method ? { methods: { has: method } } : {}) },
    include: { provider: true },
    orderBy: { provider: { createdAt: "asc" } },
  });
}
