// The DeliveryProvider contract. Application code (checkout, the seller
// dashboard, the WhatsApp flow, tracking sync) only ever talks to this
// interface — never to a specific courier — so adding a courier means
// adding an adapter under ./providers and a row in delivery_providers,
// with no change to orders, carts or checkout.
//
// Adapters are deliberately free of database access: they receive
// everything they need in a ProviderContext and return plain data. The
// services persist the results. That keeps adapters unit-testable
// against recorded HTTP fixtures (see ./providers/*.test.ts).

export type DeliveryMethod = "PAXI_PICKUP" | "DOOR_COURIER" | "SAME_DAY" | "SELLER_COLLECTION";
export type ProviderMode = "INTEGRATED" | "ASSISTED";

export type ShipmentStatus =
  | "PENDING"
  | "READY_TO_BOOK"
  | "READY_FOR_REGISTRATION"
  | "BOOKED"
  | "COLLECTED"
  | "IN_TRANSIT"
  | "READY_FOR_COLLECTION"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "EXCEPTION"
  | "CANCELLED";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface StreetAddress {
  recipientName?: string | null;
  phone?: string | null;
  street: string;
  complex?: string | null;
  suburb: string;
  city: string;
  province?: string | null;
  postcode: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** A pickup point as returned by a provider (PAXI point, kiosk, locker). */
export interface ProviderLocation {
  externalId: string; // location_id
  code?: string | null; // location_code
  name: string;
  address?: string | null;
  suburb?: string | null;
  city?: string | null;
  province?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  kind?: "PICKUP_POINT" | "KIOSK" | "LOCKER";
}

/** A pickup point after it has been stored in delivery_locations. */
export interface StoredLocation extends ProviderLocation {
  id: string;
}

export interface LocationSearch {
  /** Free text: suburb, town, postcode or store name. */
  text?: string;
  near?: GeoPoint;
  limit?: number;
}

export interface Parcel {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
}

export type Destination =
  | { kind: "PICKUP_POINT"; location: StoredLocation }
  | { kind: "ADDRESS"; address: StreetAddress }
  | { kind: "SELLER_COLLECTION"; address: StreetAddress | null; instructions?: string | null };

export interface RateRequest {
  method: DeliveryMethod;
  origin: StreetAddress | null; // seller dispatch address
  destination: Destination;
  parcel: Parcel;
  declaredValueCents: number;
  /** Earliest date the seller can hand the parcel over (handling time). */
  readyAt: Date;
  now: Date;
}

export interface RateOption {
  method: DeliveryMethod;
  serviceCode: string;
  serviceName: string; // customer-facing: "Economy", "Fast", "Same day"
  rateCents: number; // what the provider charges (VAT inclusive)
  etaMinDays: number | null;
  etaMaxDays: number | null;
  etaLabel: string | null; // "2-4 working days", "Today"
  providerData?: Record<string, unknown>;
}

export interface ShipmentContact {
  name: string;
  phone: string;
  email?: string | null;
}

export interface CreateShipmentRequest {
  orderNumber: string;
  serviceCode: string;
  origin: StreetAddress | null;
  sender: ShipmentContact;
  destination: Destination;
  recipient: ShipmentContact;
  parcel: Parcel;
  declaredValueCents: number;
  readyAt: Date;
  quoteProviderData?: Record<string, unknown>;
}

export interface CreatedShipment {
  providerShipmentRef: string;
  trackingNumber: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  expectedDeliveryAt: Date | null;
  providerData?: Record<string, unknown>;
}

export interface TrackingEvent {
  status: ShipmentStatus;
  description: string;
  location?: string | null;
  occurredAt: Date;
  /** Stable per-event id so re-polling never duplicates an event. */
  dedupeKey: string;
}

export interface TrackingResult {
  status: ShipmentStatus;
  events: TrackingEvent[];
  expectedDeliveryAt: Date | null;
}

export interface ShipmentRef {
  providerShipmentRef: string | null;
  trackingNumber: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderContext {
  mode: ProviderMode;
  /** Decrypted credentials; null when none are configured. */
  credentials: Record<string, string> | null;
  /** The adapter's own non-secret settings (validated by the adapter). */
  config: Record<string, unknown>;
  /** Directory lookup for ASSISTED-mode location search. */
  directory?: LocationDirectory;
  fetch: FetchLike;
}

/** Local pickup-point directory (delivery_locations) for a provider. */
export interface LocationDirectory {
  search(query: LocationSearch): Promise<StoredLocation[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderNotSupportedError extends Error {
  constructor(provider: string, operation: string) {
    super(`${provider} does not support ${operation}.`);
    this.name = "ProviderNotSupportedError";
  }
}

export interface DeliveryProvider {
  readonly code: string;
  readonly displayName: string;

  supportsPickupPoints(): boolean;
  supportsDoorDelivery(): boolean;
  supportsSameDay(): boolean;
  /** Whether this adapter can run without API credentials (ASSISTED). */
  supportsAssistedMode(): boolean;

  /** Validates adapter-specific config; throws with a readable message. */
  parseConfig(config: unknown): Record<string, unknown>;

  getLocations(ctx: ProviderContext, query: { near: GeoPoint; limit?: number }): Promise<ProviderLocation[]>;
  searchLocations(ctx: ProviderContext, query: LocationSearch): Promise<ProviderLocation[]>;
  /**
   * Returns only services the provider confirms are available for this
   * request. Never returns guessed prices or promises.
   */
  getRates(ctx: ProviderContext, request: RateRequest): Promise<RateOption[]>;
  createShipment(ctx: ProviderContext, request: CreateShipmentRequest): Promise<CreatedShipment>;
  cancelShipment(ctx: ProviderContext, ref: ShipmentRef): Promise<void>;
  getTracking(ctx: ProviderContext, ref: ShipmentRef): Promise<TrackingResult>;
  getTrackingUrl(ctx: ProviderContext, ref: ShipmentRef): string | null;
}
