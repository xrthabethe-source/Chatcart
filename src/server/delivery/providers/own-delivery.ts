// "Own Delivery" — the seller delivers themselves (ManualDeliveryProvider
// in the architecture notes). The seller *is* the courier here, so their
// settings are the confirmation: door and same-day delivery are offered
// only inside the service area they define, and same-day only before
// their cut-off time. An address the platform can't place inside that
// area (no coordinates and no matching suburb) gets no option — never a
// guess.
import { z } from "zod";
import { etaLabel, parseTimeOfDay, sastDate, sastMinutesOfDay } from "../dates.ts";
import { distanceKm, hasCoordinates } from "../geo.ts";
import {
  ProviderNotSupportedError,
  type DeliveryProvider,
  type ProviderContext,
  type ProviderLocation,
  type RateOption,
  type RateRequest,
  type StreetAddress,
  type TrackingResult,
} from "../types.ts";

export const ownDeliveryConfigSchema = z.object({
  feeCents: z.number().int().min(0),
  // Service area: within `radiusKm` of the dispatch address (needs
  // coordinates on both ends) or any of the listed suburbs/towns.
  radiusKm: z.number().positive().max(200).optional(),
  serviceAreas: z.array(z.string().trim().min(1)).default([]),
  standardDays: z.number().int().min(0).max(14).default(2),
  sameDay: z
    .object({
      enabled: z.boolean().default(false),
      feeCents: z.number().int().min(0),
      cutoffTime: z.string().refine((v) => parseTimeOfDay(v) !== null, "Use HH:MM, e.g. 13:00"),
    })
    .optional(),
});
export type OwnDeliveryConfig = z.infer<typeof ownDeliveryConfigSchema>;

export class OwnDeliveryProvider implements DeliveryProvider {
  readonly code = "OWN_DELIVERY";
  readonly displayName = "Own delivery";

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
    return true;
  }

  parseConfig(config: unknown): OwnDeliveryConfig {
    return ownDeliveryConfigSchema.parse(config ?? {});
  }

  async getLocations(): Promise<ProviderLocation[]> {
    return [];
  }
  async searchLocations(): Promise<ProviderLocation[]> {
    return [];
  }

  async getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]> {
    if (request.destination.kind !== "ADDRESS" || !request.origin) return [];
    if (request.method !== "DOOR_COURIER" && request.method !== "SAME_DAY") return [];
    const config = this.parseConfig(ctx.config);
    if (!inServiceArea(request.origin, request.destination.address, config)) return [];

    if (request.method === "SAME_DAY") {
      const same = config.sameDay;
      if (!same?.enabled) return [];
      // Handling time pushes readiness past today → no same-day.
      if (sastDate(request.readyAt) !== sastDate(request.now)) return [];
      if (sastMinutesOfDay(request.now) >= parseTimeOfDay(same.cutoffTime)!) return [];
      return [{ method: "SAME_DAY", serviceCode: "OWN_SAME_DAY", serviceName: "Same day", rateCents: same.feeCents, etaMinDays: 0, etaMaxDays: 0, etaLabel: "Today" }];
    }

    const days = config.standardDays;
    return [
      {
        method: "DOOR_COURIER",
        serviceCode: "OWN_STANDARD",
        serviceName: "Seller delivery",
        rateCents: config.feeCents,
        etaMinDays: Math.max(1, days - 1),
        etaMaxDays: Math.max(1, days),
        etaLabel: etaLabel(Math.max(1, days - 1), Math.max(1, days)),
      },
    ];
  }

  async createShipment(): Promise<never> {
    throw new ProviderNotSupportedError(this.displayName, "automatic booking — update the delivery status from the order page");
  }
  async cancelShipment(): Promise<void> {
    // Nothing to cancel with a third party.
  }
  async getTracking(): Promise<TrackingResult> {
    throw new ProviderNotSupportedError(this.displayName, "provider tracking");
  }
  getTrackingUrl(): string | null {
    return null;
  }
}

export function inServiceArea(origin: StreetAddress, destination: StreetAddress, config: OwnDeliveryConfig): boolean {
  if (config.radiusKm && hasCoordinates(origin) && hasCoordinates(destination)) {
    if (distanceKm(origin, destination) <= config.radiusKm) return true;
  }
  const areas = config.serviceAreas.map(normalise);
  return areas.length > 0 && (areas.includes(normalise(destination.suburb)) || areas.includes(normalise(destination.city)));
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
