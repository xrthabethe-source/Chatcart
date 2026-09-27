// The Courier Guy, via the ShipLogic v2 API that powers TCG's business
// accounts (rates, shipments, tracking, labels, cancellation).
//
// Same-day is never assumed: a service is offered as SAME_DAY only when
// TCG's own quote says it delivers today (its `delivery_date_to` is
// today, SAST), and door delivery shows only services TCG returned for
// that address. Service names are mapped to simple customer labels
// ("Economy", "Fast", "Same day") via `config.serviceLevels`; unmapped
// codes keep TCG's own name.
//
// Integrated-only: without an API key there's nothing to quote from, so
// TCG is simply not offered (see supportsAssistedMode).
import { z } from "zod";
import { etaLabel, sastDate, workingDaysBetween } from "../dates.ts";
import { joinUrl, requestJson } from "../http.ts";
import {
  ProviderNotSupportedError,
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

const serviceLevel = z.object({
  name: z.string().trim().min(1).max(40),
  // Locker/kiosk services need a TCG pickup point, which checkout does
  // not collect yet — they're kept out of door-delivery options.
  kind: z.enum(["DOOR", "LOCKER", "KIOSK"]).default("DOOR"),
});

export const courierGuyConfigSchema = z.object({
  baseUrl: z.string().url().default("https://api.shiplogic.com"),
  // Public tracking page for customers, e.g. "https://<tcg tracking page>?ref={ref}".
  trackingUrlTemplate: z.string().url().includes("{ref}").optional(),
  // Keyed by TCG service level code, e.g. { "ECO": { "name": "Economy" }, "OVN": { "name": "Fast" } }.
  serviceLevels: z.record(z.string(), serviceLevel).default({}),
  // Codes never to offer (e.g. services the seller's account can't use).
  hiddenServiceCodes: z.array(z.string()).default([]),
});
export type CourierGuyConfig = z.infer<typeof courierGuyConfigSchema>;

interface TcgRate {
  rate?: number;
  service_level?: { id?: number; code?: string; name?: string; delivery_date_from?: string; delivery_date_to?: string };
}

interface TcgTrackingEvent {
  id?: number | string;
  date?: string;
  status?: string;
  message?: string;
  location?: string;
}

export class CourierGuyDeliveryProvider implements DeliveryProvider {
  readonly code = "COURIER_GUY";
  readonly displayName = "The Courier Guy";

  supportsPickupPoints() {
    return false;
  }
  supportsDoorDelivery() {
    return true;
  }
  supportsSameDay() {
    return true;
  }
  supportsAssistedMode() {
    return false;
  }

  parseConfig(config: unknown): CourierGuyConfig {
    return courierGuyConfigSchema.parse(config ?? {});
  }

  private client(ctx: ProviderContext) {
    const apiKey = ctx.credentials?.apiKey;
    if (ctx.mode !== "INTEGRATED" || !apiKey) {
      throw new ProviderUnavailableError("The Courier Guy needs an API key (Delivery settings → The Courier Guy).");
    }
    const config = this.parseConfig(ctx.config);
    return { config, headers: { Authorization: `Bearer ${apiKey}` } };
  }

  async getLocations(): Promise<ProviderLocation[]> {
    return [];
  }

  async searchLocations(): Promise<ProviderLocation[]> {
    return [];
  }

  async getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]> {
    if (request.method !== "DOOR_COURIER" && request.method !== "SAME_DAY") return [];
    if (request.destination.kind !== "ADDRESS" || !request.origin) return [];
    const { config, headers } = this.client(ctx);

    const body = await requestJson<{ rates?: TcgRate[] }>(ctx.fetch, this.displayName, joinUrl(config.baseUrl, "/v2/rates"), {
      method: "POST",
      headers,
      body: {
        collection_address: toTcgAddress(request.origin, "business"),
        delivery_address: toTcgAddress(request.destination.address, "residential"),
        parcels: [toTcgParcel(request.parcel)],
        declared_value: request.declaredValueCents / 100,
        collection_min_date: sastDate(request.readyAt),
        delivery_min_date: sastDate(request.readyAt),
      },
    });

    const today = sastDate(request.now);
    const options: RateOption[] = [];
    for (const rate of body.rates ?? []) {
      const level = rate.service_level;
      const code = level?.code;
      if (!code || typeof rate.rate !== "number" || rate.rate < 0) continue;
      if (config.hiddenServiceCodes.includes(code)) continue;
      const mapped = config.serviceLevels[code];
      if (mapped && mapped.kind !== "DOOR") continue;

      const to = level.delivery_date_to ? new Date(level.delivery_date_to) : null;
      const from = level.delivery_date_from ? new Date(level.delivery_date_from) : to;
      const confirmedToday = !!to && !Number.isNaN(to.getTime()) && sastDate(to) === today;
      if (request.method === "SAME_DAY" ? !confirmedToday : confirmedToday) continue;

      const minDays = from && !Number.isNaN(from.getTime()) ? workingDaysBetween(request.now, from) : null;
      const maxDays = to && !Number.isNaN(to.getTime()) ? workingDaysBetween(request.now, to) : null;
      options.push({
        method: request.method,
        serviceCode: code,
        serviceName: mapped?.name ?? (request.method === "SAME_DAY" ? "Same day" : level.name ?? code),
        rateCents: Math.round(rate.rate * 100),
        etaMinDays: minDays,
        etaMaxDays: maxDays,
        etaLabel: etaLabel(minDays, maxDays),
        providerData: { serviceLevelId: level.id, deliveryDateFrom: level.delivery_date_from, deliveryDateTo: level.delivery_date_to },
      });
    }
    return options.sort((a, b) => a.rateCents - b.rateCents);
  }

  async createShipment(ctx: ProviderContext, request: CreateShipmentRequest): Promise<CreatedShipment> {
    const { config, headers } = this.client(ctx);
    if (request.destination.kind !== "ADDRESS" || !request.origin) {
      throw new Error("The Courier Guy shipments need a dispatch address and a delivery address.");
    }
    const body = await requestJson<Record<string, unknown>>(ctx.fetch, this.displayName, joinUrl(config.baseUrl, "/v2/shipments"), {
      method: "POST",
      headers,
      body: {
        collection_address: toTcgAddress(request.origin, "business"),
        collection_contact: { name: request.sender.name, mobile_number: request.sender.phone },
        delivery_address: toTcgAddress(request.destination.address, "residential"),
        delivery_contact: {
          name: request.recipient.name,
          mobile_number: request.recipient.phone,
          email: request.recipient.email ?? undefined,
        },
        parcels: [toTcgParcel(request.parcel)],
        service_level_code: request.serviceCode,
        declared_value: request.declaredValueCents / 100,
        customer_reference: request.orderNumber,
        collection_min_date: sastDate(request.readyAt),
        delivery_min_date: sastDate(request.readyAt),
      },
    });

    const trackingNumber =
      (body.short_tracking_reference as string | undefined) ??
      (body.custom_tracking_reference as string | undefined) ??
      (body.tracking_reference as string | undefined);
    const id = body.id !== undefined ? String(body.id) : null;
    if (!trackingNumber || !id) throw new ProviderUnavailableError("The Courier Guy did not return a waybill number.");
    const expected = typeof body.estimated_delivery_to === "string" ? new Date(body.estimated_delivery_to) : null;

    return {
      providerShipmentRef: id,
      trackingNumber,
      trackingUrl: this.getTrackingUrl(ctx, { providerShipmentRef: id, trackingNumber }),
      labelUrl: await this.fetchLabelUrl(ctx, id).catch(() => null),
      expectedDeliveryAt: expected && !Number.isNaN(expected.getTime()) ? expected : null,
      providerData: { shipmentId: id },
    };
  }

  private async fetchLabelUrl(ctx: ProviderContext, shipmentId: string): Promise<string | null> {
    const { config, headers } = this.client(ctx);
    const body = await requestJson<{ url?: string }>(
      ctx.fetch,
      this.displayName,
      `${joinUrl(config.baseUrl, "/v2/shipments/label")}?id=${encodeURIComponent(shipmentId)}`,
      { headers },
    );
    return body.url ?? null;
  }

  async cancelShipment(ctx: ProviderContext, ref: ShipmentRef): Promise<void> {
    const { config, headers } = this.client(ctx);
    if (!ref.trackingNumber) throw new ProviderNotSupportedError(this.displayName, "cancelling a shipment without a waybill");
    await requestJson(ctx.fetch, this.displayName, joinUrl(config.baseUrl, "/v2/shipments/cancel"), {
      method: "POST",
      headers,
      body: { tracking_reference: ref.trackingNumber },
    });
  }

  async getTracking(ctx: ProviderContext, ref: ShipmentRef): Promise<TrackingResult> {
    const { config, headers } = this.client(ctx);
    if (!ref.trackingNumber) throw new Error("No waybill number to track.");
    const body = await requestJson<{ shipments?: { status?: string; estimated_delivery_to?: string; tracking_events?: TcgTrackingEvent[] }[] }>(
      ctx.fetch,
      this.displayName,
      `${joinUrl(config.baseUrl, "/v2/tracking/shipments")}?tracking_reference=${encodeURIComponent(ref.trackingNumber)}`,
      { headers },
    );
    const shipment = body.shipments?.[0];
    if (!shipment) throw new ProviderUnavailableError(`The Courier Guy has no shipment ${ref.trackingNumber}.`);

    const events = (shipment.tracking_events ?? [])
      .map((e) => {
        const status = mapCourierGuyStatus(e.status ?? "");
        const occurredAt = e.date ? new Date(e.date) : null;
        if (!status || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
        return {
          status,
          description: e.message || humanise(e.status ?? status),
          location: e.location ?? null,
          occurredAt,
          dedupeKey: e.id !== undefined ? String(e.id) : `${e.date}:${e.status}`,
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const expected = shipment.estimated_delivery_to ? new Date(shipment.estimated_delivery_to) : null;
    return {
      status: mapCourierGuyStatus(shipment.status ?? "") ?? events.at(-1)?.status ?? "BOOKED",
      events,
      expectedDeliveryAt: expected && !Number.isNaN(expected.getTime()) ? expected : null,
    };
  }

  getTrackingUrl(ctx: ProviderContext, ref: ShipmentRef): string | null {
    const template = this.parseConfig(ctx.config).trackingUrlTemplate;
    return template && ref.trackingNumber ? template.replace("{ref}", encodeURIComponent(ref.trackingNumber)) : null;
  }
}

function toTcgAddress(address: StreetAddress, type: "business" | "residential") {
  return {
    type,
    street_address: [address.complex, address.street].filter(Boolean).join(", "),
    local_area: address.suburb,
    city: address.city,
    zone: address.province ?? undefined,
    country: "ZA",
    code: address.postcode,
    lat: address.latitude ?? undefined,
    lng: address.longitude ?? undefined,
  };
}

function toTcgParcel(parcel: RateRequest["parcel"]) {
  return {
    submitted_length_cm: parcel.lengthCm,
    submitted_width_cm: parcel.widthCm,
    submitted_height_cm: parcel.heightCm,
    submitted_weight_kg: parcel.weightGrams / 1000,
  };
}

function humanise(value: string): string {
  const s = value.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function mapCourierGuyStatus(value: string): ShipmentStatus | null {
  switch (value.toLowerCase().replace(/[\s_]+/g, "-")) {
    case "submitted":
    case "pending-collection":
    case "collection-assigned":
      return "BOOKED";
    case "collected":
    case "at-origin-hub":
      return "COLLECTED";
    case "in-transit":
    case "at-hub":
    case "at-destination-hub":
    case "in-transit-to-destination":
      return "IN_TRANSIT";
    case "out-for-delivery":
    case "delivery-assigned":
      return "OUT_FOR_DELIVERY";
    case "ready-for-collection":
    case "at-locker":
      return "READY_FOR_COLLECTION";
    case "delivered":
    case "collected-by-recipient":
      return "DELIVERED";
    case "collection-exception":
    case "delivery-exception":
    case "failed-delivery":
    case "returned-to-sender":
      return "EXCEPTION";
    case "cancelled":
      return "CANCELLED";
    default:
      return null;
  }
}
