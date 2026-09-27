// Generic same-day courier adapter.
//
// Local same-day couriers rarely share an API shape, so rather than one
// adapter per courier this speaks a small, documented JSON contract that
// a courier (or a thin bridge in front of one) implements:
//
//   POST {baseUrl}/quotes
//     { pickup: Address, dropoff: Address, parcel: { lengthCm, widthCm, heightCm, weightKg }, readyAt }
//     → { available: boolean, reason?: string,
//         options: [{ code, name, priceCents, deliverBy? (ISO), etaLabel? }] }
//   POST {baseUrl}/deliveries
//     { quoteCode, reference, pickup, dropoff, sender, recipient, parcel }
//     → { id, trackingNumber, trackingUrl?, labelUrl?, deliverBy? }
//   GET  {baseUrl}/deliveries/{id}
//     → { status, deliverBy?, events: [{ id, status, description, at, location? }] }
//   POST {baseUrl}/deliveries/{id}/cancel → {}
//
//   status ∈ booked | collected | in_transit | out_for_delivery | delivered | failed | cancelled
//
// Same-day options are returned only when the courier answers
// `available: true` AND each option's `deliverBy` (when given) is today —
// the platform never promises same-day on its own.
//
// Platform admins register additional same-day couriers as
// delivery_providers rows with code LOCAL_COURIER_<NAME>, all served by
// this adapter with their own baseUrl/credentials (see registry.ts).
import { z } from "zod";
import { sastDate } from "../dates.ts";
import { joinUrl, requestJson } from "../http.ts";
import {
  ProviderUnavailableError,
  type CreateShipmentRequest,
  type CreatedShipment,
  type DeliveryProvider,
  type ProviderContext,
  type ProviderLocation,
  type RateOption,
  type RateRequest,
  type ShipmentRef,
  type ShipmentStatus,
  type StreetAddress,
  type TrackingResult,
} from "../types.ts";

export const localCourierConfigSchema = z.object({
  baseUrl: z.string().url(),
});

interface QuoteResponse {
  available?: boolean;
  options?: { code?: string; name?: string; priceCents?: number; deliverBy?: string; etaLabel?: string }[];
}

const STATUS_MAP: Record<string, ShipmentStatus> = {
  booked: "BOOKED",
  collected: "COLLECTED",
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  failed: "EXCEPTION",
  cancelled: "CANCELLED",
};

export class LocalCourierProvider implements DeliveryProvider {
  readonly code: string;
  readonly displayName: string;

  constructor(code = "LOCAL_COURIER", displayName = "Local same-day courier") {
    this.code = code;
    this.displayName = displayName;
  }

  supportsPickupPoints() {
    return false;
  }
  supportsDoorDelivery() {
    return false;
  }
  supportsSameDay() {
    return true;
  }
  supportsAssistedMode() {
    return false;
  }

  parseConfig(config: unknown) {
    return localCourierConfigSchema.parse(config ?? {});
  }

  private client(ctx: ProviderContext) {
    const apiKey = ctx.credentials?.apiKey;
    if (ctx.mode !== "INTEGRATED" || !apiKey) throw new ProviderUnavailableError(`${this.displayName} needs an API key.`);
    return { baseUrl: this.parseConfig(ctx.config).baseUrl, headers: { Authorization: `Bearer ${apiKey}` } };
  }

  async getLocations(): Promise<ProviderLocation[]> {
    return [];
  }
  async searchLocations(): Promise<ProviderLocation[]> {
    return [];
  }

  async getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]> {
    if (request.method !== "SAME_DAY" || request.destination.kind !== "ADDRESS" || !request.origin) return [];
    const { baseUrl, headers } = this.client(ctx);
    const body = await requestJson<QuoteResponse>(ctx.fetch, this.displayName, joinUrl(baseUrl, "/quotes"), {
      method: "POST",
      headers,
      body: {
        pickup: address(request.origin),
        dropoff: address(request.destination.address),
        parcel: parcel(request.parcel),
        readyAt: request.readyAt.toISOString(),
      },
    });
    if (body.available !== true) return [];

    const today = sastDate(request.now);
    return (body.options ?? [])
      .filter((o) => o.code && typeof o.priceCents === "number" && Number.isInteger(o.priceCents) && o.priceCents >= 0)
      .filter((o) => !o.deliverBy || sastDate(new Date(o.deliverBy)) === today)
      .map((o) => ({
        method: "SAME_DAY" as const,
        serviceCode: o.code!,
        serviceName: o.name ?? "Same day",
        rateCents: o.priceCents!,
        etaMinDays: 0,
        etaMaxDays: 0,
        etaLabel: o.etaLabel ?? "Today",
        providerData: { deliverBy: o.deliverBy },
      }));
  }

  async createShipment(ctx: ProviderContext, request: CreateShipmentRequest): Promise<CreatedShipment> {
    const { baseUrl, headers } = this.client(ctx);
    if (request.destination.kind !== "ADDRESS" || !request.origin) throw new Error("Same-day delivery needs pickup and drop-off addresses.");
    const body = await requestJson<{ id?: string; trackingNumber?: string; trackingUrl?: string; labelUrl?: string; deliverBy?: string }>(
      ctx.fetch,
      this.displayName,
      joinUrl(baseUrl, "/deliveries"),
      {
        method: "POST",
        headers,
        body: {
          quoteCode: request.serviceCode,
          reference: request.orderNumber,
          pickup: address(request.origin),
          dropoff: address(request.destination.address),
          sender: request.sender,
          recipient: request.recipient,
          parcel: parcel(request.parcel),
        },
      },
    );
    if (!body.id || !body.trackingNumber) throw new ProviderUnavailableError(`${this.displayName} did not return a tracking number.`);
    return {
      providerShipmentRef: body.id,
      trackingNumber: body.trackingNumber,
      trackingUrl: body.trackingUrl ?? null,
      labelUrl: body.labelUrl ?? null,
      expectedDeliveryAt: body.deliverBy ? new Date(body.deliverBy) : null,
    };
  }

  async cancelShipment(ctx: ProviderContext, ref: ShipmentRef): Promise<void> {
    const { baseUrl, headers } = this.client(ctx);
    if (!ref.providerShipmentRef) throw new Error("No delivery id to cancel.");
    await requestJson(ctx.fetch, this.displayName, joinUrl(baseUrl, `/deliveries/${encodeURIComponent(ref.providerShipmentRef)}/cancel`), {
      method: "POST",
      headers,
    });
  }

  async getTracking(ctx: ProviderContext, ref: ShipmentRef): Promise<TrackingResult> {
    const { baseUrl, headers } = this.client(ctx);
    if (!ref.providerShipmentRef) throw new Error("No delivery id to track.");
    const body = await requestJson<{ status?: string; deliverBy?: string; events?: { id?: string; status?: string; description?: string; at?: string; location?: string }[] }>(
      ctx.fetch,
      this.displayName,
      joinUrl(baseUrl, `/deliveries/${encodeURIComponent(ref.providerShipmentRef)}`),
      { headers },
    );
    const events = (body.events ?? [])
      .map((e) => {
        const status = STATUS_MAP[e.status ?? ""];
        const occurredAt = e.at ? new Date(e.at) : null;
        if (!status || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
        return { status, description: e.description ?? status, location: e.location ?? null, occurredAt, dedupeKey: e.id ?? `${e.at}:${e.status}` };
      })
      .filter((e): e is NonNullable<typeof e> => !!e)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return {
      status: STATUS_MAP[body.status ?? ""] ?? events.at(-1)?.status ?? "BOOKED",
      events,
      expectedDeliveryAt: body.deliverBy ? new Date(body.deliverBy) : null,
    };
  }

  getTrackingUrl(): string | null {
    return null; // returned per shipment by createShipment
  }
}

function address(a: StreetAddress) {
  return {
    street: [a.complex, a.street].filter(Boolean).join(", "),
    suburb: a.suburb,
    city: a.city,
    province: a.province ?? null,
    postcode: a.postcode,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
  };
}

function parcel(p: RateRequest["parcel"]) {
  return { lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, weightKg: p.weightGrams / 1000 };
}
