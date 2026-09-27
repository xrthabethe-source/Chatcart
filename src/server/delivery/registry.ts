import { CourierGuyDeliveryProvider } from "./providers/courier-guy.ts";
import { LocalCourierProvider } from "./providers/local-courier.ts";
import { OwnDeliveryProvider } from "./providers/own-delivery.ts";
import { PaxiDeliveryProvider } from "./providers/paxi.ts";
import { SellerCollectionProvider } from "./providers/seller-collection.ts";
import type { DeliveryProvider } from "./types.ts";

// Maps delivery_providers.code → adapter. Adding a courier = one adapter
// + one entry here (or, for same-day couriers speaking the local-courier
// contract, just a delivery_providers row with a LOCAL_COURIER_* code).
const fixed: Record<string, () => DeliveryProvider> = {
  PAXI: () => new PaxiDeliveryProvider(),
  COURIER_GUY: () => new CourierGuyDeliveryProvider(),
  OWN_DELIVERY: () => new OwnDeliveryProvider(),
  SELLER_COLLECTION: () => new SellerCollectionProvider(),
  LOCAL_COURIER: () => new LocalCourierProvider(),
};

export function getDeliveryAdapter(code: string, name?: string): DeliveryProvider {
  const make = fixed[code];
  if (make) return make();
  if (code.startsWith("LOCAL_COURIER_")) return new LocalCourierProvider(code, name ?? code);
  throw new Error(`No delivery adapter registered for provider code "${code}".`);
}

export function isRegisteredProviderCode(code: string): boolean {
  return code in fixed || /^LOCAL_COURIER_[A-Z0-9_]+$/.test(code);
}
