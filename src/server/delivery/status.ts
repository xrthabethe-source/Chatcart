import type { DeliveryMethod, ShipmentStatus } from "./types.ts";

export const METHOD_LABELS: Record<DeliveryMethod, string> = {
  PAXI_PICKUP: "Collect at PEP / PAXI",
  DOOR_COURIER: "Courier to my door",
  SAME_DAY: "Same-day delivery",
  SELLER_COLLECTION: "Collect from seller",
};

export const METHOD_ORDER: DeliveryMethod[] = ["PAXI_PICKUP", "DOOR_COURIER", "SAME_DAY", "SELLER_COLLECTION"];

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  PENDING: "Awaiting payment",
  READY_TO_BOOK: "Ready to book",
  READY_FOR_REGISTRATION: "Ready for PAXI registration",
  BOOKED: "Booked with courier",
  COLLECTED: "Parcel collected",
  IN_TRANSIT: "In transit",
  READY_FOR_COLLECTION: "Ready for collection",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  EXCEPTION: "Delivery problem",
  CANCELLED: "Cancelled",
};

// Forward progress order. A tracking poll can report events out of order
// or replay old ones; a shipment never moves backwards on the strength of
// a stale event (EXCEPTION and CANCELLED are handled separately).
const PROGRESS: ShipmentStatus[] = [
  "PENDING",
  "READY_TO_BOOK",
  "READY_FOR_REGISTRATION",
  "BOOKED",
  "COLLECTED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "READY_FOR_COLLECTION",
  "DELIVERED",
];

export function isTerminal(status: ShipmentStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

/** The status a shipment should move to after `next` is reported. */
export function advanceStatus(current: ShipmentStatus, next: ShipmentStatus): ShipmentStatus {
  if (isTerminal(current)) return current;
  if (next === "CANCELLED" || next === "EXCEPTION") return next;
  if (current === "EXCEPTION") return next; // recovered after a problem
  return PROGRESS.indexOf(next) > PROGRESS.indexOf(current) ? next : current;
}

/** Statuses that trigger a customer WhatsApp notification. */
export const NOTIFY_ON: ShipmentStatus[] = [
  "BOOKED",
  "COLLECTED",
  "IN_TRANSIT",
  "READY_FOR_COLLECTION",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
];

/** Statuses a seller may set by hand (assisted / own delivery). */
export const SELLER_SETTABLE: ShipmentStatus[] = [
  "COLLECTED",
  "IN_TRANSIT",
  "READY_FOR_COLLECTION",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
];
