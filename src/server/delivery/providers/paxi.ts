// PEP / PAXI — a first-class pickup-point provider.
//
// Two operating modes, with an identical customer experience:
//
// INTEGRATED — PAXI API credentials are configured. PAXI Point discovery,
//   rates, shipment creation and tracking go to the API.
//
// ASSISTED — no API access yet (PAXI API access needs commercial approval
//   and parcel volume). The customer still searches and selects a PAXI
//   Point, from the platform's PAXI Point directory (delivery_locations,
//   imported via the admin locations import). Rates come from the
//   seller's PAXI tariff in settings. After payment the shipment appears
//   in the seller's "Ready for PAXI registration" queue; the seller
//   registers it on the PAXI portal and enters the PAXI reference, which
//   is then attached to the order.
//
// About the API mapping: PAXI issues its API documentation with account
// approval. Endpoint paths are therefore configurable (`config.api`) and
// every response goes through the tolerant mappers at the bottom of this
// file, so aligning with the issued spec is a change to this one file.
import { z } from "zod";
import { etaLabel } from "../dates.ts";
import { joinUrl, requestJson } from "../http.ts";
import {
  ProviderNotSupportedError,
  ProviderUnavailableError,
  type CreateShipmentRequest,
  type CreatedShipment,
  type DeliveryProvider,
  type GeoPoint,
  type LocationSearch,
  type ProviderContext,
  type ProviderLocation,
  type RateOption,
  type RateRequest,
  type ShipmentRef,
  type ShipmentStatus,
  type TrackingResult,
} from "../types.ts";

const tariffEntry = z.object({
  serviceCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  rateCents: z.number().int().min(0),
  etaMinDays: z.number().int().min(0).max(30),
  etaMaxDays: z.number().int().min(0).max(30),
});

export const paxiConfigSchema = z.object({
  // Seller's PAXI prices, used in ASSISTED mode (the seller pays PAXI at
  // registration, so these are the rates they have agreed/see on PAXI).
  tariff: z.array(tariffEntry).max(10).default([]),
  maxParcelWeightGrams: z.number().int().positive().optional(),
  // e.g. "https://<paxi tracking page>?ref={ref}". Optional.
  trackingUrlTemplate: z.string().url().includes("{ref}").optional(),
  api: z
    .object({
      baseUrl: z.string().url(),
      locationsPath: z.string().default("/points"),
      ratesPath: z.string().default("/rates"),
      shipmentsPath: z.string().default("/shipments"),
      trackingPath: z.string().default("/shipments/{ref}/tracking"),
      cancelPath: z.string().default("/shipments/{ref}/cancel"),
    })
    .optional(),
});
export type PaxiConfig = z.infer<typeof paxiConfigSchema>;

export class PaxiDeliveryProvider implements DeliveryProvider {
  readonly code = "PAXI";
  readonly displayName = "PEP / PAXI";

  supportsPickupPoints() {
    return true;
  }
  supportsDoorDelivery() {
    return false;
  }
  supportsSameDay() {
    return false;
  }
  supportsAssistedMode() {
    return true;
  }

  parseConfig(config: unknown): PaxiConfig {
    const parsed = paxiConfigSchema.parse(config ?? {});
    for (const t of parsed.tariff) {
      if (t.etaMinDays > t.etaMaxDays) throw new Error(`PAXI tariff "${t.name}": minimum days exceed maximum days.`);
    }
    return parsed;
  }

  private api(ctx: ProviderContext) {
    const config = this.parseConfig(ctx.config);
    const apiKey = ctx.credentials?.apiKey;
    if (ctx.mode !== "INTEGRATED" || !config.api || !apiKey) return null;
    return { ...config.api, headers: { Authorization: `Bearer ${apiKey}` } };
  }

  async getLocations(ctx: ProviderContext, query: { near: GeoPoint; limit?: number }): Promise<ProviderLocation[]> {
    return this.searchLocations(ctx, { near: query.near, limit: query.limit });
  }

  async searchLocations(ctx: ProviderContext, query: LocationSearch): Promise<ProviderLocation[]> {
    const api = this.api(ctx);
    if (!api) {
      if (!ctx.directory) throw new ProviderUnavailableError("PAXI Point directory is not available.");
      return ctx.directory.search(query);
    }
    const params = new URLSearchParams();
    if (query.text) params.set("search", query.text);
    if (query.near) {
      params.set("lat", String(query.near.latitude));
      params.set("lng", String(query.near.longitude));
    }
    params.set("limit", String(query.limit ?? 10));
    const body = await requestJson<unknown>(ctx.fetch, this.displayName, `${joinUrl(api.baseUrl, api.locationsPath)}?${params}`, {
      headers: api.headers,
    });
    return listFrom(body, ["points", "locations", "data", "results"]).map(mapPaxiLocation).filter((l): l is ProviderLocation => !!l);
  }

  async getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]> {
    if (request.method !== "PAXI_PICKUP" || request.destination.kind !== "PICKUP_POINT") return [];
    const config = this.parseConfig(ctx.config);
    if (config.maxParcelWeightGrams && request.parcel.weightGrams > config.maxParcelWeightGrams) return [];

    const api = this.api(ctx);
    if (api) {
      const body = await requestJson<unknown>(ctx.fetch, this.displayName, joinUrl(api.baseUrl, api.ratesPath), {
        method: "POST",
        headers: api.headers,
        body: {
          destinationPointCode: request.destination.location.code ?? request.destination.location.externalId,
          parcel: {
            lengthCm: request.parcel.lengthCm,
            widthCm: request.parcel.widthCm,
            heightCm: request.parcel.heightCm,
            weightKg: request.parcel.weightGrams / 1000,
          },
          declaredValue: request.declaredValueCents / 100,
        },
      });
      return listFrom(body, ["rates", "services", "options", "data"])
        .map((raw) => mapPaxiRate(raw))
        .filter((r): r is RateOption => !!r);
    }

    // ASSISTED: the seller's own PAXI tariff. No tariff → PAXI isn't
    // offered (rather than inventing a price).
    return config.tariff.map((t) => ({
      method: "PAXI_PICKUP" as const,
      serviceCode: t.serviceCode,
      serviceName: t.name,
      rateCents: t.rateCents,
      etaMinDays: t.etaMinDays,
      etaMaxDays: t.etaMaxDays,
      etaLabel: etaLabel(t.etaMinDays, t.etaMaxDays),
    }));
  }

  async createShipment(ctx: ProviderContext, request: CreateShipmentRequest): Promise<CreatedShipment> {
    const api = this.api(ctx);
    if (!api) throw new ProviderNotSupportedError(this.displayName, "automatic shipment creation without API credentials");
    if (request.destination.kind !== "PICKUP_POINT") throw new Error("PAXI shipments need a PAXI Point destination.");
    const loc = request.destination.location;
    const body = await requestJson<Record<string, unknown>>(ctx.fetch, this.displayName, joinUrl(api.baseUrl, api.shipmentsPath), {
      method: "POST",
      headers: api.headers,
      body: {
        reference: request.orderNumber,
        serviceCode: request.serviceCode,
        destinationPointCode: loc.code ?? loc.externalId,
        recipient: { name: request.recipient.name, mobile: request.recipient.phone, email: request.recipient.email ?? undefined },
        sender: { name: request.sender.name, mobile: request.sender.phone },
        parcel: {
          lengthCm: request.parcel.lengthCm,
          widthCm: request.parcel.widthCm,
          heightCm: request.parcel.heightCm,
          weightKg: request.parcel.weightGrams / 1000,
        },
        declaredValue: request.declaredValueCents / 100,
      },
    });
    const trackingNumber = str(body, ["trackingNumber", "tracking_number", "waybill", "reference", "parcelReference"]);
    const ref = str(body, ["id", "shipmentId", "shipment_id"]) ?? trackingNumber;
    if (!trackingNumber || !ref) throw new ProviderUnavailableError("PAXI did not return a tracking reference.");
    return {
      providerShipmentRef: ref,
      trackingNumber,
      trackingUrl: this.getTrackingUrl(ctx, { providerShipmentRef: ref, trackingNumber }),
      labelUrl: str(body, ["labelUrl", "label_url"]) ?? null,
      expectedDeliveryAt: date(body, ["expectedDeliveryDate", "estimatedDelivery"]),
      providerData: { raw: body },
    };
  }

  async cancelShipment(ctx: ProviderContext, ref: ShipmentRef): Promise<void> {
    const api = this.api(ctx);
    if (!api) throw new ProviderNotSupportedError(this.displayName, "cancellation without API credentials — cancel on the PAXI portal");
    const id = ref.providerShipmentRef ?? ref.trackingNumber;
    if (!id) throw new Error("No PAXI reference to cancel.");
    await requestJson(ctx.fetch, this.displayName, joinUrl(api.baseUrl, api.cancelPath.replace("{ref}", encodeURIComponent(id))), {
      method: "POST",
      headers: api.headers,
    });
  }

  async getTracking(ctx: ProviderContext, ref: ShipmentRef): Promise<TrackingResult> {
    const api = this.api(ctx);
    if (!api) throw new ProviderNotSupportedError(this.displayName, "tracking without API credentials");
    const id = ref.trackingNumber ?? ref.providerShipmentRef;
    if (!id) throw new Error("No PAXI reference to track.");
    const body = await requestJson<unknown>(
      ctx.fetch,
      this.displayName,
      joinUrl(api.baseUrl, api.trackingPath.replace("{ref}", encodeURIComponent(id))),
      { headers: api.headers },
    );
    const events = listFrom(body, ["events", "trackingEvents", "history", "data"])
      .map((raw, idx) => {
        const status = mapPaxiStatus(str(raw, ["status", "statusCode", "event"]) ?? "");
        const occurredAt = date(raw, ["date", "timestamp", "occurredAt", "eventDate"]);
        if (!status || !occurredAt) return null;
        return {
          status,
          description: str(raw, ["description", "message", "statusDescription"]) ?? status,
          location: str(raw, ["location", "branch", "pointName"]) ?? null,
          occurredAt,
          dedupeKey: str(raw, ["id", "eventId"]) ?? `${occurredAt.toISOString()}:${status}:${idx}`,
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const top = mapPaxiStatus(str(body, ["status", "currentStatus"]) ?? "") ?? events.at(-1)?.status ?? "BOOKED";
    return { status: top, events, expectedDeliveryAt: date(body, ["expectedDeliveryDate", "estimatedDelivery"]) };
  }

  getTrackingUrl(ctx: ProviderContext, ref: ShipmentRef): string | null {
    const template = this.parseConfig(ctx.config).trackingUrlTemplate;
    const id = ref.trackingNumber ?? ref.providerShipmentRef;
    return template && id ? template.replace("{ref}", encodeURIComponent(id)) : null;
  }
}

// ─── Tolerant response mappers ────────────────────────────────────────

type Raw = Record<string, unknown>;

function listFrom(body: unknown, keys: string[]): Raw[] {
  if (Array.isArray(body)) return body as Raw[];
  if (body && typeof body === "object") {
    for (const key of keys) {
      const value = (body as Raw)[key];
      if (Array.isArray(value)) return value as Raw[];
    }
  }
  return [];
}

function str(raw: unknown, keys: string[]): string | null {
  if (!raw || typeof raw !== "object") return null;
  for (const key of keys) {
    const value = (raw as Raw)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function num(raw: unknown, keys: string[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  for (const key of keys) {
    const value = Number((raw as Raw)[key]);
    if ((raw as Raw)[key] !== null && (raw as Raw)[key] !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function date(raw: unknown, keys: string[]): Date | null {
  const value = str(raw, keys);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function mapPaxiLocation(raw: Raw): ProviderLocation | null {
  const externalId = str(raw, ["id", "locationId", "location_id", "nodeId", "code", "pointCode"]);
  const name = str(raw, ["name", "storeName", "pointName", "displayName"]);
  if (!externalId || !name) return null;
  return {
    externalId,
    code: str(raw, ["code", "pointCode", "nodeCode", "storeCode", "location_code"]),
    name,
    address: str(raw, ["address", "streetAddress", "address1"]),
    suburb: str(raw, ["suburb", "area"]),
    city: str(raw, ["city", "town"]),
    province: str(raw, ["province", "region"]),
    postcode: str(raw, ["postcode", "postalCode", "postal_code"]),
    latitude: num(raw, ["latitude", "lat"]),
    longitude: num(raw, ["longitude", "lng", "lon"]),
    kind: "PICKUP_POINT",
  };
}

function mapPaxiRate(raw: Raw): RateOption | null {
  const serviceCode = str(raw, ["serviceCode", "code", "service"]);
  const amount = num(raw, ["price", "amount", "rate", "total"]);
  if (!serviceCode || amount === null || amount < 0) return null;
  const min = num(raw, ["minDays", "etaMinDays", "deliveryDaysMin"]);
  const max = num(raw, ["maxDays", "etaMaxDays", "deliveryDaysMax"]);
  return {
    method: "PAXI_PICKUP",
    serviceCode,
    serviceName: str(raw, ["name", "serviceName", "description"]) ?? serviceCode,
    rateCents: Math.round(amount * 100),
    etaMinDays: min,
    etaMaxDays: max,
    etaLabel: etaLabel(min, max),
    providerData: { raw },
  };
}

export function mapPaxiStatus(value: string): ShipmentStatus | null {
  const s = value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!s) return null;
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("collected by") || s.includes("delivered") || s.includes("completed")) return "DELIVERED";
  if (s.includes("ready") || s.includes("arrived at") || s.includes("awaiting collection")) return "READY_FOR_COLLECTION";
  if (s.includes("transit") || s.includes("hub") || s.includes("route")) return "IN_TRANSIT";
  if (s.includes("dropped") || s.includes("received") || s.includes("collected")) return "COLLECTED";
  if (s.includes("exception") || s.includes("fail") || s.includes("return")) return "EXCEPTION";
  if (s.includes("registered") || s.includes("created") || s.includes("booked")) return "BOOKED";
  return null;
}
