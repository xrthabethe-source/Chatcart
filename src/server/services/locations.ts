// Pickup-point discovery ("Where would you like to collect?").
//
// Customers search by suburb, town, postcode or store name, or share
// their location. Results always come back as rows of delivery_locations
// — from the provider API in INTEGRATED mode (cached/upserted here so an
// order can reference a stable location id) or straight from the
// directory in ASSISTED mode — so checkout never cares which it was.
import { z } from "zod";
import { db, Prisma, type DbClient } from "../db.ts";
import { distanceKm, formatDistance, hasCoordinates } from "../delivery/geo.ts";
import { getDeliveryAdapter } from "../delivery/registry.ts";
import type { LocationDirectory, LocationSearch, ProviderLocation, StoredLocation } from "../delivery/types.ts";
import { DeliveryUnavailableError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";
import { enabledProvidersFor, providerContext } from "./delivery-settings.ts";

const DEFAULT_LIMIT = 8;
// Roughly 60 km: beyond that "nearby" stops being useful for collection.
const NEAR_BOX_DEGREES = 0.55;

type LocationRow = Awaited<ReturnType<typeof db.deliveryLocation.findFirstOrThrow>>;

export function toStoredLocation(row: LocationRow): StoredLocation {
  return {
    id: row.id,
    externalId: row.externalId,
    code: row.code,
    name: row.name,
    address: row.address,
    suburb: row.suburb,
    city: row.city,
    province: row.province,
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    kind: row.kind as StoredLocation["kind"],
  };
}

export function directoryFor(providerId: string, client: DbClient = db): LocationDirectory {
  return {
    async search(query: LocationSearch): Promise<StoredLocation[]> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      const text = query.text?.trim();
      if (!text && !query.near) return [];

      const textFilter = text
        ? /^\d{4}$/.test(text)
          ? Prisma.sql`AND postcode = ${text}`
          : Prisma.sql`AND (name ILIKE ${like(text)} OR suburb ILIKE ${like(text)} OR city ILIKE ${like(text)} OR code ILIKE ${like(text)} OR address ILIKE ${like(text)})`
        : Prisma.empty;

      if (query.near) {
        // Nearest first, in SQL: an equirectangular distance is exact
        // enough to *order* points a few km apart, and it keeps the
        // nearest point in the result however dense the directory is.
        const { latitude, longitude } = query.near;
        const rows = await client.$queryRaw<LocationRow[]>`
          SELECT id, provider_id AS "providerId", external_id AS "externalId", code, name, address, suburb, city,
                 province, postcode, latitude, longitude, kind, active, last_synced_at AS "lastSyncedAt"
          FROM delivery_locations
          WHERE provider_id = ${providerId}::uuid AND active
            AND latitude BETWEEN ${latitude - NEAR_BOX_DEGREES} AND ${latitude + NEAR_BOX_DEGREES}
            AND longitude BETWEEN ${longitude - NEAR_BOX_DEGREES} AND ${longitude + NEAR_BOX_DEGREES}
            ${textFilter}
          ORDER BY power(latitude - ${latitude}, 2) + power((longitude - ${longitude}) * cos(radians(${latitude})), 2)
          LIMIT ${limit}`;
        return rows.map(toStoredLocation);
      }

      const rows = await client.$queryRaw<LocationRow[]>`
        SELECT id, provider_id AS "providerId", external_id AS "externalId", code, name, address, suburb, city,
               province, postcode, latitude, longitude, kind, active, last_synced_at AS "lastSyncedAt"
        FROM delivery_locations
        WHERE provider_id = ${providerId}::uuid AND active ${textFilter}
        ORDER BY name
        LIMIT ${limit * 5}`;
      return rankByText(rows.map(toStoredLocation), text!).slice(0, limit);
    },
  };
}

function like(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Exact suburb/town matches first, then store-name matches.
function rankByText(locations: StoredLocation[], text: string): StoredLocation[] {
  const t = text.toLowerCase();
  const score = (l: StoredLocation) =>
    (l.suburb?.toLowerCase() === t || l.city?.toLowerCase() === t ? 0 : 2) + (l.name.toLowerCase().includes(t) ? 0 : 1);
  return [...locations].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

async function upsertLocations(providerId: string, found: ProviderLocation[], client: DbClient): Promise<StoredLocation[]> {
  const stored: StoredLocation[] = [];
  for (const loc of found) {
    const data = {
      code: loc.code ?? null,
      name: loc.name,
      address: loc.address ?? null,
      suburb: loc.suburb ?? null,
      city: loc.city ?? null,
      province: loc.province ?? null,
      postcode: loc.postcode ?? null,
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
      kind: loc.kind ?? "PICKUP_POINT",
      active: true,
      lastSyncedAt: new Date(),
    };
    const row = await client.deliveryLocation.upsert({
      where: { providerId_externalId: { providerId, externalId: loc.externalId } },
      update: data,
      create: { providerId, externalId: loc.externalId, ...data },
    });
    stored.push(toStoredLocation(row));
  }
  return stored;
}

export interface PickupPointResult extends StoredLocation {
  providerCode: string;
  distanceKm: number | null;
  distanceLabel: string | null;
}

export const pickupSearchSchema = z
  .object({
    text: z.string().trim().min(2).max(80).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .refine((q) => q.text || (q.latitude !== undefined && q.longitude !== undefined), "Enter a suburb, town, postcode or store name.");

/** Pickup points near/matching the query across the seller's enabled pickup providers. */
export async function searchPickupPoints(tenantId: string, input: z.input<typeof pickupSearchSchema>): Promise<PickupPointResult[]> {
  const parsed = pickupSearchSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const q = parsed.data;
  const near = q.latitude !== undefined && q.longitude !== undefined ? { latitude: q.latitude, longitude: q.longitude } : undefined;
  const query: LocationSearch = { text: q.text, near, limit: q.limit ?? DEFAULT_LIMIT };

  const providers = await enabledProvidersFor(tenantId, "PAXI_PICKUP");
  if (providers.length === 0) throw new DeliveryUnavailableError("PEP / PAXI collection isn't available for this shop.");

  const results: PickupPointResult[] = [];
  for (const row of providers) {
    const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
    const ctx = providerContext(row);
    let found: ProviderLocation[];
    try {
      found = await adapter.searchLocations(ctx, query);
    } catch (error) {
      console.error(`Pickup point search failed for ${row.provider.code}:`, error);
      continue;
    }
    const stored = found.every((l): l is StoredLocation => "id" in l && typeof (l as StoredLocation).id === "string")
      ? (found as StoredLocation[])
      : await upsertLocations(row.providerId, found, db);
    for (const loc of stored) {
      const d = near && hasCoordinates(loc) ? distanceKm(near, loc) : null;
      results.push({ ...loc, providerCode: row.provider.code, distanceKm: d, distanceLabel: d === null ? null : formatDistance(d) });
    }
  }
  if (near) results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  return results.slice(0, query.limit);
}

export async function getLocation(id: string, client: DbClient = db): Promise<StoredLocation & { providerId: string }> {
  const row = await client.deliveryLocation.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Collection point");
  return { ...toStoredLocation(row), providerId: row.providerId };
}

// ─── Platform admin: directory import (ASSISTED-mode PAXI points) ────

const importRow = z.object({
  externalId: z.string().trim().min(1).max(60),
  code: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(250).nullable().optional(),
  suburb: z.string().trim().max(100).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  province: z.string().trim().max(100).nullable().optional(),
  postcode: z.string().trim().max(10).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  kind: z.enum(["PICKUP_POINT", "KIOSK", "LOCKER"]).optional(),
});

export const importLocationsSchema = z.object({
  providerCode: z.string().trim().min(1),
  locations: z.array(importRow).min(1).max(20_000),
  // Deactivate directory entries missing from this import (a full refresh).
  deactivateMissing: z.boolean().default(false),
});

export async function importLocations(input: z.input<typeof importLocationsSchema>) {
  const parsed = importLocationsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const provider = await db.deliveryProvider.findUnique({ where: { code: parsed.data.providerCode } });
  if (!provider) throw new NotFoundError("Delivery provider");

  const stored = await upsertLocations(provider.id, parsed.data.locations, db);
  let deactivated = 0;
  if (parsed.data.deactivateMissing) {
    const res = await db.deliveryLocation.updateMany({
      where: { providerId: provider.id, externalId: { notIn: parsed.data.locations.map((l) => l.externalId) }, active: true },
      data: { active: false },
    });
    deactivated = res.count;
  }
  return { imported: stored.length, deactivated };
}
