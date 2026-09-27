// "Collect from seller" — the customer collects from the seller's
// pickup/dispatch address. No third party involved.
import { z } from "zod";
import { workingDaysBetween } from "../dates.ts";
import {
  ProviderNotSupportedError,
  type DeliveryProvider,
  type ProviderContext,
  type ProviderLocation,
  type RateOption,
  type RateRequest,
  type TrackingResult,
} from "../types.ts";

export const sellerCollectionConfigSchema = z.object({
  feeCents: z.number().int().min(0).default(0),
  // Shown to the customer after ordering: hours, where to park, etc.
  instructions: z.string().trim().max(500).optional(),
});

export class SellerCollectionProvider implements DeliveryProvider {
  readonly code = "SELLER_COLLECTION";
  readonly displayName = "Customer collection";

  supportsPickupPoints() {
    return false;
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

  parseConfig(config: unknown) {
    return sellerCollectionConfigSchema.parse(config ?? {});
  }

  async getLocations(): Promise<ProviderLocation[]> {
    return [];
  }
  async searchLocations(): Promise<ProviderLocation[]> {
    return [];
  }

  async getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]> {
    if (request.method !== "SELLER_COLLECTION") return [];
    const config = this.parseConfig(ctx.config);
    const days = workingDaysBetween(request.now, request.readyAt);
    return [
      {
        method: "SELLER_COLLECTION",
        serviceCode: "COLLECT",
        serviceName: "Collect",
        rateCents: config.feeCents,
        etaMinDays: days,
        etaMaxDays: days,
        etaLabel: days <= 0 ? "Ready today" : days === 1 ? "Ready next working day" : `Ready in ${days} working days`,
      },
    ];
  }

  async createShipment(): Promise<never> {
    throw new ProviderNotSupportedError(this.displayName, "shipment booking");
  }
  async cancelShipment(): Promise<void> {}
  async getTracking(): Promise<TrackingResult> {
    throw new ProviderNotSupportedError(this.displayName, "provider tracking");
  }
  getTrackingUrl(): string | null {
    return null;
  }
}
